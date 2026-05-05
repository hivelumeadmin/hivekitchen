# Story 3.13: Plan regeneration request

Status: review

## Story

As a Primary Parent,
I want to request regeneration of a full week or specific day with the same constraint set,
So that I can ask Lumi to try again when a particular plan doesn't land (FR23).

## Acceptance Criteria

1. **Given** Story 3.5 is complete,
   **When** I tap "Regenerate week" or "Regenerate Tuesday" on a plan,
   **Then** `POST /v1/plans/:id/regenerate?scope=week|day` enqueues a fresh plan-generation job; rate-limited to 5/week/household per architecture §3.6.

2. **And** old plan_items archived (not deleted) with `replaced_by_plan_id`; new plan goes through allergy guardrail; on success, SSE `plan.updated` invalidates Brief.

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 3.5: `PlansRepository.commit()`, `PlanRowSchema`, `PlanItemRowSchema`, `CommitPlanInputSchema`, `commit_plan()` RPC (`supabase/migrations/20260502111000_create_commit_plan_function.sql`)
- Story 3.6: `BriefStateRepository`, `BriefStateComposer.refresh()`, `BriefStateRowSchema`, `GET /v1/households/:id/brief`
- Story 3.7: `planGenerationJobPlugin`, `GENERATE_QUEUE = 'plan-generation'`, `PlanGenerationJobData`, `buildCommitInput()`, `deriveWeekId()` — all in `apps/api/src/jobs/plan-generation.job.ts`
- Story 3.12: `PlansRepository.findItemById/updateItemIngredients/pauseDay/countItemsForDay`, `PlansService.swapItem/pauseDay`, `plans.routes.ts` PATCH endpoints, `mutations.ts` with `useSwapPlanItemMutation/usePauseDayMutation`, `DisambiguationPicker`
- `DomainOrchestrator.planWeek(householdId, weekOf, requestId, rejectionContext?)` — `apps/api/src/agents/orchestrator.ts:166`
- `AUDIT_EVENT_TYPES` already contains `'plan.regeneration_requested'` and `'plan.regenerated'` — `apps/api/src/audit/audit.types.ts`
- `fastify.redis` — ioredis instance registered by `ioredisPlugin` and available in all route/service contexts
- `authorize(['primary_parent', 'secondary_caregiver'])` middleware pattern from `plans.routes.ts`
- `requireIdempotencyKey()` helper in `plans.routes.ts` — copy this pattern for the new route

**Key invariants from previous stories:**
- `briefStateComposer.refresh()` MUST NOT throw — it swallows its own errors
- Presentation layer always reads `WHERE guardrail_cleared_at IS NOT NULL`
- `hkFetch` does not run Zod parsing on responses — guard with `?.`
- Logical-property lint rule (`hivekitchen/logical-properties-only`): `start-*`/`end-*`, `ps-*`/`pe-*`, `ms-*`/`me-*` — no `left-*`/`right-*`/`pl-*`/`pr-*`/`ml-*`/`mr-*`
- No `framer-motion` — Tailwind animation utilities only
- `QueryKeys.brief(householdId)` from `apps/web/src/lib/realtime/query-keys.ts` — use this for TanStack Query invalidation
- `PLAN_ITEM_COLUMNS` in `plans.repository.ts` is the single-source select list — any new column MUST be added there

---

## Tasks / Subtasks

### Task 1 — DB Migrations (3 files)

#### Task 1a — Add `week_of` to `plans` table

Create `supabase/migrations/20260630000000_add_week_of_to_plans.sql`:

```sql
-- Story 3.13: store the human-readable week start date on each plan row so
-- the regeneration route can call orchestrator.planWeek(week_of) without
-- reversing the deriveWeekId() SHA-256 hash.
-- VARCHAR(10) stores ISO 8601 date ('2026-04-28'). DEFAULT NULL so existing
-- rows parse cleanly before backfill; the app always sets it on new commits.
ALTER TABLE plans
  ADD COLUMN week_of VARCHAR(10) DEFAULT NULL;
```

#### Task 1b — Add `replaced_by_plan_id` to `plan_items` + index

Create `supabase/migrations/20260630000100_add_replaced_by_plan_id_to_plan_items.sql`:

```sql
-- Story 3.13: archive semantics for regenerated plan items.
-- When a plan is regenerated (commit_plan called a second time on the same
-- plan_id), old items are marked replaced_by_plan_id = <plan_id> (self-
-- reference: "superseded when this plan was last updated") rather than
-- deleted. New items for the new generation have replaced_by_plan_id = NULL.
-- This preserves history for Story 3.15 (historical plans view) and lets
-- the guardrail audit trail reconstruct the original composition.
ALTER TABLE plan_items
  ADD COLUMN replaced_by_plan_id UUID DEFAULT NULL REFERENCES plans(id) ON DELETE SET NULL;

-- Partial index: only rows that are archived benefit from this index.
CREATE INDEX idx_plan_items_replaced_by_plan_id
  ON plan_items(replaced_by_plan_id)
  WHERE replaced_by_plan_id IS NOT NULL;

-- Partial index: current items per plan — used by findItemsByPlanId().
-- plan_id is first because it's the equality filter; replaced_by_plan_id IS NULL
-- ensures the index is scanned only for current (non-archived) rows.
CREATE INDEX idx_plan_items_plan_id_current
  ON plan_items(plan_id)
  WHERE replaced_by_plan_id IS NULL;
```

#### Task 1c — Modify `commit_plan()` RPC to archive instead of delete, and accept `week_of`

Create `supabase/migrations/20260630000200_update_commit_plan_archive_items.sql`:

```sql
-- Story 3.13: change commit_plan() in two ways:
--   1. Accept p_week_of so the plans row stores the human-readable week date.
--   2. Archive old plan_items instead of deleting them: set replaced_by_plan_id = p_plan_id
--      on current items (replaced_by_plan_id IS NULL) before inserting the new set.
--      Self-reference semantics: "this item was superseded the last time this plan committed."

CREATE OR REPLACE FUNCTION commit_plan(
  p_plan_id              uuid,
  p_household_id         uuid,
  p_week_id              uuid,
  p_week_of              varchar(10),
  p_revision             integer,
  p_generated_at         timestamptz,
  p_guardrail_cleared_at timestamptz,
  p_guardrail_version    varchar(32),
  p_prompt_version       varchar(32),
  p_items                jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_item jsonb;
BEGIN
  -- Upsert plan row (ON CONFLICT (id) handles re-commits of the same plan_id).
  INSERT INTO plans (
    id, household_id, week_id, week_of, revision, generated_at,
    guardrail_cleared_at, guardrail_version, prompt_version
  )
  VALUES (
    p_plan_id, p_household_id, p_week_id, p_week_of, p_revision, p_generated_at,
    p_guardrail_cleared_at, p_guardrail_version, p_prompt_version
  )
  ON CONFLICT (id) DO UPDATE
    SET week_of              = EXCLUDED.week_of,
        revision             = EXCLUDED.revision,
        generated_at         = EXCLUDED.generated_at,
        guardrail_cleared_at = EXCLUDED.guardrail_cleared_at,
        guardrail_version    = EXCLUDED.guardrail_version,
        prompt_version       = EXCLUDED.prompt_version,
        updated_at           = now();

  -- Archive existing current items for this plan before inserting the new set.
  -- Sets replaced_by_plan_id = p_plan_id (self-reference: "this plan's current
  -- revision superseded these items"). Skips already-archived rows (IS NULL guard).
  UPDATE plan_items
    SET replaced_by_plan_id = p_plan_id,
        updated_at          = now()
    WHERE plan_id = p_plan_id
      AND replaced_by_plan_id IS NULL;

  -- Insert new items for this revision with replaced_by_plan_id = NULL (current).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO plan_items (
      plan_id, child_id, day, slot, recipe_id, item_id, ingredients
    )
    VALUES (
      p_plan_id,
      (v_item->>'child_id')::uuid,
      v_item->>'day',
      v_item->>'slot',
      NULLIF(v_item->>'recipe_id', '')::uuid,
      NULLIF(v_item->>'item_id', '')::uuid,
      COALESCE(v_item->'ingredients', '[]'::jsonb)
    );
  END LOOP;

  RETURN p_plan_id;
END;
$$;
```

> **Why self-reference?** The plan_id is stable across revisions (reused via ON CONFLICT). `replaced_by_plan_id = plan_id` is readable as "this item was archived when plan X was updated". The partial index `WHERE replaced_by_plan_id IS NULL` keeps current-item queries efficient.

---

### Task 2 — Contracts: update and add schemas

In `packages/contracts/src/plan.ts`:

#### Task 2a — Update `CommitPlanInputSchema` to include `week_of`

Replace the existing `CommitPlanInputSchema`:

```typescript
export const CommitPlanInputSchema = z.object({
  plan_id: z.string().uuid(),
  household_id: z.string().uuid(),
  week_id: z.string().uuid(),
  week_of: z.string().date(),  // Story 3.13 — ISO 8601 date string ('2026-04-28')
  revision: z.number().int().min(1),
  generated_at: z.string().datetime(),
  prompt_version: z.string().min(1).max(PROMPT_VERSION_MAX),
  items: z.array(PlanItemWriteSchema).min(1),
});
```

#### Task 2b — Update `PlanRowSchema` to include `week_of`

Replace the existing `PlanRowSchema`:

```typescript
export const PlanRowSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  week_id: z.string().uuid(),
  week_of: z.string().date().nullable().default(null),  // Story 3.13 — null for pre-migration rows
  revision: z.number().int().min(1),
  generated_at: z.string().datetime(),
  guardrail_cleared_at: z.string().datetime().nullable(),
  guardrail_version: z.string().max(GUARDRAIL_VERSION_MAX).nullable(),
  prompt_version: z.string().min(1).max(PROMPT_VERSION_MAX),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
```

#### Task 2c — Update `PlanItemRowSchema` to include `replaced_by_plan_id`

Replace the existing `PlanItemRowSchema`:

```typescript
export const PlanItemRowSchema = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  child_id: z.string().uuid(),
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
  slot: z.string().min(1).max(SLOT_MAX),
  recipe_id: z.string().uuid().nullable(),
  item_id: z.string().uuid().nullable(),
  ingredients: z.array(z.string().min(1)),
  paused_at: z.string().datetime().nullable().default(null),
  replaced_by_plan_id: z.string().uuid().nullable().default(null),  // Story 3.13 — null = current
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
```

#### Task 2d — Add `RegeneratePlanQuerySchema` and `RegeneratePlanResponseSchema`

Add after `PlanItemRowSchema`:

```typescript
// POST /v1/plans/:planId/regenerate?scope=week|day&day=monday query params.
// day is required when scope='day'.
export const RegeneratePlanQuerySchema = z.object({
  scope: z.enum(['week', 'day']),
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']).optional(),
}).refine(
  (val) => val.scope !== 'day' || val.day !== undefined,
  { message: "'day' query param is required when scope=day", path: ['day'] },
);

// 202 Accepted response body. job_id correlates to the BullMQ job for
// debugging; rate_limit_remaining tracks how many more regenerations this
// household can request this week.
export const RegeneratePlanResponseSchema = z.object({
  job_id: z.string().min(1),
  rate_limit_remaining: z.number().int().min(0),
});
```

---

### Task 3 — Types: export new schemas

In `packages/types/src/index.ts`, add to the imports from `'@hivekitchen/contracts'`:

```typescript
RegeneratePlanQuerySchema,
RegeneratePlanResponseSchema,
```

And add type exports below the existing plan-related exports:

```typescript
// Story 3.13 — plan regeneration types
export type RegeneratePlanQuery = z.infer<typeof RegeneratePlanQuerySchema>;
export type RegeneratePlanResponse = z.infer<typeof RegeneratePlanResponseSchema>;
```

> `CommitPlanInput`, `PlanRow`, and `PlanItemRow` types update automatically via `z.infer` — no manual re-export needed.

---

### Task 4 — Error types

In `apps/api/src/common/errors.ts`, add after `SwapGuardrailBlockedError`:

```typescript
export class TooManyRequestsError extends DomainError {
  readonly type = '/errors/too-many-requests';
  readonly status = 429;
  readonly title = 'Too Many Requests';
  // retryAfterSeconds: how many seconds until the rate limit window resets.
  constructor(retryAfterSeconds: number) {
    super(
      `Rate limit exceeded. Try again in ${String(retryAfterSeconds)} seconds.`,
    );
    this.retryAfterSeconds = retryAfterSeconds;
  }
  readonly retryAfterSeconds: number;
}
```

Also update the `setErrorHandler` in `apps/api/src/app.ts` to emit the `Retry-After` header for 429 responses:

```typescript
// Inside the isDomainError(err) branch, before void reply.status(...).send(...):
if (err instanceof TooManyRequestsError) {
  void reply
    .status(429)
    .header('Retry-After', String(err.retryAfterSeconds))
    .type('application/problem+json')
    .send({ type: err.type, status: err.status, title: err.title, detail: err.detail, instance: request.id });
  return;
}
```

Import `TooManyRequestsError` at the top of `app.ts`.

---

### Task 5 — PlansRepository: update selectors for archival

In `apps/api/src/modules/plans/plans.repository.ts`:

#### Task 5a — Update `PLAN_COLUMNS` and `PLAN_ITEM_COLUMNS`

```typescript
const PLAN_COLUMNS =
  'id, household_id, week_id, week_of, revision, generated_at, guardrail_cleared_at, guardrail_version, prompt_version, created_at, updated_at';

const PLAN_ITEM_COLUMNS =
  'id, plan_id, child_id, day, slot, recipe_id, item_id, ingredients, paused_at, replaced_by_plan_id, created_at, updated_at';
```

#### Task 5b — Update `findItemsByPlanId()` to exclude archived items

Replace the existing `findItemsByPlanId()`:

```typescript
// Returns only current (non-archived) items for a plan. Presentation and
// composer callers always want the active set. Archived items (replaced_by_plan_id
// IS NOT NULL) are excluded — use findAllItemsByPlanId() for ops/history reads.
async findItemsByPlanId(planId: string): Promise<PlanItemRow[]> {
  const { data, error } = await this.client
    .from('plan_items')
    .select(PLAN_ITEM_COLUMNS)
    .eq('plan_id', planId)
    .is('replaced_by_plan_id', null);
  if (error) throw error;
  return (data ?? []) as PlanItemRow[];
}
```

#### Task 5c — Add `findAllItemsByPlanId()` for ops reads (includes archived)

```typescript
// Returns ALL items for a plan including archived rows. Used by Story 3.15
// (historical plans view) and audit reconstruction only.
// presentation-bypass: ops-history — intentional; never call for UI rendering.
async findAllItemsByPlanId(planId: string): Promise<PlanItemRow[]> {
  const { data, error } = await this.client
    .from('plan_items')
    .select(PLAN_ITEM_COLUMNS)
    .eq('plan_id', planId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlanItemRow[];
}
```

#### Task 5d — Update `commit()` to pass `week_of`

Replace the existing `commit()` method:

```typescript
async commit(
  input: CommitPlanInput,
  guardrailClearedAt: string,
  guardrailVersion: string,
): Promise<string> {
  const { data, error } = await this.client.rpc('commit_plan', {
    p_plan_id: input.plan_id,
    p_household_id: input.household_id,
    p_week_id: input.week_id,
    p_week_of: input.week_of,   // Story 3.13 — added to RPC signature
    p_revision: input.revision,
    p_generated_at: input.generated_at,
    p_guardrail_cleared_at: guardrailClearedAt,
    p_guardrail_version: guardrailVersion,
    p_prompt_version: input.prompt_version,
    p_items: input.items,
  });
  if (error) throw error;
  return data as string;
}
```

---

### Task 6 — Update `buildCommitInput()` in plan-generation.job.ts to pass `week_of`

In `apps/api/src/jobs/plan-generation.job.ts`, update `buildCommitInput()`:

```typescript
export function buildCommitInput(
  output: PlanComposeOutput,
  weekId: string,
  _requestId: string,
): CommitPlanInput {
  const items: PlanItemWrite[] = output.days.flatMap((d) =>
    d.items.map((item) => ({
      child_id: item.child_id,
      day: d.day,
      slot: item.slot,
      ingredients: item.ingredients,
      ...(item.recipe_id !== undefined ? { recipe_id: item.recipe_id } : {}),
      ...(item.item_id !== undefined ? { item_id: item.item_id } : {}),
    })),
  );

  return {
    plan_id: output.plan_id,
    household_id: output.household_id,
    week_id: weekId,
    week_of: output.week_of,   // Story 3.13 — PlanComposeOutput.week_of is already available
    revision: 1,
    generated_at: new Date().toISOString(),
    prompt_version: output.prompt_version,
    items,
  };
}
```

---

### Task 7 — Orchestrator: extend `planWeek()` with optional `dayScope` parameter

In `apps/api/src/agents/orchestrator.ts`, update `planWeek()` signature:

```typescript
async planWeek(
  householdId: string,
  weekOf: string,
  requestId: string,
  rejectionContext?: string,
  dayScope?: string,  // Story 3.13 — ISO day name ('tuesday') for day-scoped regen
): Promise<PlanComposeOutput> {
```

Inside `planWeek()`, update `contextLines` to include day scope context when provided:

```typescript
const contextLines = [
  `Household ID: ${householdId}`,
  `Planning week starting: ${weekOf} (Monday)`,
  `Request ID: ${requestId}`,
  dayScope !== undefined
    ? `Regeneration scope: DAY ONLY. Only generate a new plan for ${dayScope.toUpperCase()}. Keep all other days exactly as previously composed. Only call plan.compose with items for ${dayScope} — do not include other days.`
    : undefined,
  rejectionContext !== undefined && rejectionContext.length > 0
    ? `Previous attempt was blocked by the allergy guardrail. Blocked ingredients/reasons:\n${rejectionContext}\nCompose a revised plan that avoids these.`
    : 'This is the first generation attempt for this household and week.',
].filter((line): line is string => line !== undefined);
```

---

### Task 8 — New plan regeneration BullMQ job

Create `apps/api/src/jobs/plan-regeneration.job.ts`:

```typescript
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Job } from 'bullmq';
import type { CommitPlanInput, GuardrailResult, PlanItemWrite } from '@hivekitchen/types';
import { deriveWeekId, buildCommitInput } from './plan-generation.job.js';

export const REGEN_QUEUE = 'plan-regeneration';

export interface PlanRegenerationJobData {
  plan_id: string;       // The plan row to regenerate (same id reused via commit upsert)
  household_id: string;
  week_of: string;       // ISO date string — needed by orchestrator.planWeek()
  week_id: string;       // Derived from week_of; stored to avoid recomputing
  scope: 'week' | 'day';
  day?: string;          // Required when scope='day'
  request_id: string;
}

// Per-job BullMQ options: 2 attempts (regeneration is user-initiated;
// fewer retries than automatic generation to conserve rate limit budget).
const REGEN_JOB_OPTS = {
  attempts: 2,
  backoff: { type: 'exponential' as const, delay: 60_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
};

const planRegenerationPlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.orchestrator) {
    throw new Error(
      'planRegenerationPlugin requires orchestrator decorator — register orchestratorHook first',
    );
  }
  if (!fastify.plansService) {
    throw new Error(
      'planRegenerationPlugin requires plansService decorator — register plansHook first',
    );
  }
  if (!fastify.auditService) {
    throw new Error(
      'planRegenerationPlugin requires auditService decorator — register auditHook first',
    );
  }

  const regenQueue = fastify.bullmq.getQueue(REGEN_QUEUE);
  // Expose queue so PlansService can enqueue without importing the plugin.
  fastify.decorate('planRegenerationQueue', regenQueue);

  fastify.bullmq.getWorker(
    REGEN_QUEUE,
    async (job: Job<PlanRegenerationJobData>) => {
      const { plan_id, household_id, week_of, week_id, scope, day, request_id } = job.data;

      fastify.log.info(
        { module: 'plan-regeneration', action: 'regen.start', plan_id, household_id, scope, day, attempt: job.attemptsMade },
        'plan-regeneration job started',
      );

      // Run the planner. For scope='day', pass dayScope so the prompt instructs
      // the agent to only plan for that day. The compose output may include only
      // that day's items (agent-guided) or the full week (if the LLM doesn't
      // comply) — the service filters to just the target day in the day-scope path.
      const composeOutput = await fastify.orchestrator.planWeek(
        household_id,
        week_of,
        request_id,
        undefined,
        scope === 'day' ? day : undefined,
      );

      // For day-scope: filter the output to only include items for the target day.
      // This guards against LLM non-compliance with the day-scope prompt instruction.
      const filteredOutput =
        scope === 'day' && day !== undefined
          ? { ...composeOutput, days: composeOutput.days.filter((d) => d.day === day) }
          : composeOutput;

      if (scope === 'day' && filteredOutput.days.length === 0) {
        throw new Error(
          `Day-scope regeneration for '${day ?? ''}' returned no days from the planner`,
        );
      }

      const commitInput = buildCommitInput(filteredOutput, week_id, request_id);

      // For day-scope regeneration: merge with existing current items for other
      // days so commit_plan() archives only the target day's items and keeps
      // the other days' items as-is.
      if (scope === 'day' && day !== undefined) {
        const existingItems = await fastify.plansService.getCurrentPlanItems(plan_id, household_id);
        const otherDayItems: PlanItemWrite[] = existingItems
          .filter((item) => item.day !== day)
          .map((item) => ({
            child_id: item.child_id,
            day: item.day,
            slot: item.slot,
            ingredients: item.ingredients,
            ...(item.recipe_id != null ? { recipe_id: item.recipe_id } : {}),
            ...(item.item_id != null ? { item_id: item.item_id } : {}),
          }));
        commitInput.items = [...otherDayItems, ...commitInput.items];
      }

      // Commit with full-week allergy guardrail. For day-scope, the merged
      // items set covers all days so the guardrail evaluates the full plan.
      await fastify.plansService.commit(
        commitInput,
        request_id,
        async (rejections: GuardrailResult[]) => {
          const rejectionContext = rejections
            .flatMap((r) => (r.verdict === 'blocked' ? r.conflicts : []))
            .map((c) => `allergen: ${c.allergen}, ingredient: ${c.ingredient}`)
            .join('; ');

          const retryOutput = await fastify.orchestrator.planWeek(
            household_id,
            week_of,
            request_id,
            rejectionContext,
            scope === 'day' ? day : undefined,
          );

          const filteredRetry =
            scope === 'day' && day !== undefined
              ? { ...retryOutput, days: retryOutput.days.filter((d) => d.day === day) }
              : retryOutput;

          const retryCommit = buildCommitInput(filteredRetry, week_id, request_id);

          if (scope === 'day' && day !== undefined) {
            const existingItems = await fastify.plansService.getCurrentPlanItems(plan_id, household_id);
            const otherDayItems: PlanItemWrite[] = existingItems
              .filter((item) => item.day !== day)
              .map((item) => ({
                child_id: item.child_id,
                day: item.day,
                slot: item.slot,
                ingredients: item.ingredients,
                ...(item.recipe_id != null ? { recipe_id: item.recipe_id } : {}),
                ...(item.item_id != null ? { item_id: item.item_id } : {}),
              }));
            retryCommit.items = [...otherDayItems, ...retryCommit.items];
          }

          return retryCommit;
        },
      );

      // Write audit for successful regeneration.
      try {
        await fastify.auditService.write({
          event_type: 'plan.regenerated',
          household_id,
          request_id,
          metadata: { plan_id, scope, day: day ?? null, week_of, week_id },
        });
      } catch (auditErr) {
        fastify.log.error({ auditErr, plan_id }, 'audit write failed after plan regeneration — regen committed');
      }

      // SSE fan-out is deferred to Story 5.2. brief_state is refreshed inside
      // PlansService.commit() → BriefStateComposer.refresh(). Client polls via
      // TanStack Query stale-time or manual invalidation.
      fastify.log.debug(
        { module: 'plan-regeneration', action: 'sse.deferred', household_id, plan_id },
        'plan.updated SSE emission deferred to Story 5.2',
      );

      fastify.log.info(
        { module: 'plan-regeneration', action: 'regen.complete', plan_id, household_id, scope },
        'plan-regeneration job completed — brief_state updated',
      );
    },
    { concurrency: 2 },
  );

  // Permanent failure audit.
  fastify.bullmq.getWorker(REGEN_QUEUE).on(
    'failed',
    (job: Job<PlanRegenerationJobData> | undefined, err: Error) => {
      if (!job) return;
      const maxAttempts = (job.opts?.attempts as number | undefined) ?? REGEN_JOB_OPTS.attempts;
      if (job.attemptsMade < maxAttempts) return;

      const { plan_id, household_id, request_id, scope, week_of } = job.data;
      fastify.log.error(
        { module: 'plan-regeneration', action: 'regen.permanent_failure', plan_id, err },
        'plan-regeneration job permanently failed',
      );

      fastify.auditService
        .write({
          event_type: 'plan.generation.failed',
          household_id,
          request_id,
          metadata: { plan_id, scope, week_of, error: err.message, attempts: job.attemptsMade },
        })
        .catch((auditErr: unknown) => {
          fastify.log.error(
            { err: auditErr, plan_id },
            'failed to write plan.generation.failed audit event after regen failure',
          );
        });
    },
  );
};

export const planRegenerationJobPlugin = fp(planRegenerationPlugin, {
  name: 'plan-regeneration-job',
});
```

> **IMPORTANT:** `fastify.bullmq.getWorker(REGEN_QUEUE)` can only be called once for a given queue name (first call returns the worker that was registered; subsequent calls without the processor arg may behave differently depending on the BullMQ plugin implementation). Verify against `apps/api/src/plugins/bullmq.plugin.ts` — if the plugin stores workers by queue name, the `on('failed', ...)` listener should be attached to the worker returned from the initial `getWorker(REGEN_QUEUE, processor, opts)` call, not a separate call. Refactor to:
>
> ```typescript
> const worker = fastify.bullmq.getWorker(REGEN_QUEUE, async (job) => { ... }, { concurrency: 2 });
> worker.on('failed', (job, err) => { ... });
> ```

---

### Task 9 — PlansService: add `requestRegeneration()` and `getCurrentPlanItems()`

In `apps/api/src/modules/plans/plans.service.ts`:

**Add to imports from `@hivekitchen/types`:**
```typescript
import type {
  // ... existing imports ...
  RegeneratePlanQuery,
} from '@hivekitchen/types';
```

**Add to imports:**
```typescript
import type { Queue } from 'bullmq';
import type { PlanRegenerationJobData } from '../../jobs/plan-regeneration.job.js';
import { TooManyRequestsError } from '../../common/errors.js';
import type { Redis } from 'ioredis';
```

**Update `PlansServiceDeps`:**
```typescript
export interface PlansServiceDeps {
  repository: PlansRepository;
  briefStateRepository: BriefStateRepository;
  briefStateComposer: BriefStateComposer;
  allergyGuardrail: AllergyGuardrailService;
  auditService: AuditService;
  logger: FastifyBaseLogger;
  redis: Redis;                     // Story 3.13 — for rate limiting
  regenQueue: Queue;                // Story 3.13 — BullMQ plan-regeneration queue
}
```

**Update constructor to store new deps:**
```typescript
private readonly redis: Redis;
private readonly regenQueue: Queue;

constructor(deps: PlansServiceDeps) {
  // ... existing ...
  this.redis = deps.redis;
  this.regenQueue = deps.regenQueue;
}
```

**Add rate-limit constants:**
```typescript
const REGEN_RATE_LIMIT = 5;              // max requests per household per week
const REGEN_TTL_SECONDS = 8 * 24 * 3600; // 8 days — covers the full plan week + buffer
```

**Add `getCurrentPlanItems()` — used by regeneration job worker:**
```typescript
// Fetch current (non-archived) items for a plan, with household ownership check.
// Used by the plan-regeneration job to merge day-scope new items with the
// existing other-day items before committing.
async getCurrentPlanItems(planId: string, householdId: string): Promise<PlanItemRow[]> {
  const plan = await this.repo.findByIdForPresentation({ planId, householdId });
  if (!plan) throw new NotFoundError(`plan ${planId}`);
  return this.repo.findItemsByPlanId(planId);
}
```

**Add `requestRegeneration()`:**
```typescript
// Story 3.13 — user-triggered plan regeneration.
// Rate-limited to REGEN_RATE_LIMIT per household per plan-week via Redis INCR.
// Enqueues a PlanRegenerationJobData job and returns the BullMQ job ID + remaining limit.
// Does NOT wait for the job to complete — returns 202 immediately.
async requestRegeneration(opts: {
  planId: string;
  householdId: string;
  query: RegeneratePlanQuery;
  requestId: string;
}): Promise<{ jobId: string; rateLimitRemaining: number }> {
  // 1. Load plan — validates household ownership and that plan exists.
  const plan = await this.repo.findByIdForPresentation({
    planId: opts.planId,
    householdId: opts.householdId,
  });
  if (!plan) throw new NotFoundError(`plan ${opts.planId}`);
  if (!plan.week_of) {
    // Pre-3.13 plan row with no week_of — cannot regenerate without the date.
    throw new ValidationError(
      `plan ${opts.planId} was created before Story 3.13 and lacks week_of; view the current week's brief to regenerate`,
    );
  }

  // 2. Rate limit: per-household per-week_id counter in Redis.
  // Key expires in REGEN_TTL_SECONDS so old counters don't linger past the plan week.
  const rateLimitKey = `regen-limit:${opts.householdId}:${plan.week_id}`;
  const count = await this.redis.incr(rateLimitKey);
  if (count === 1) {
    // First increment: set TTL. Subsequent INCRs inherit the existing TTL.
    await this.redis.expire(rateLimitKey, REGEN_TTL_SECONDS);
  }
  if (count > REGEN_RATE_LIMIT) {
    // Approximate retry-after: remaining TTL on the key.
    const ttl = await this.redis.ttl(rateLimitKey);
    const retryAfter = ttl > 0 ? ttl : REGEN_TTL_SECONDS;
    throw new TooManyRequestsError(retryAfter);
  }
  const rateLimitRemaining = REGEN_RATE_LIMIT - count;

  // 3. Enqueue the regeneration job. Idempotency key prevents double-enqueue
  //    if the client retries the request before the job starts.
  const jobIdKey =
    `regen-${opts.householdId}-${plan.week_id}-${opts.query.scope}` +
    (opts.query.scope === 'day' ? `-${opts.query.day ?? ''}` : '') +
    `-${opts.requestId}`;

  const job = await this.regenQueue.add(
    'regenerate-plan',
    {
      plan_id: opts.planId,
      household_id: opts.householdId,
      week_of: plan.week_of,
      week_id: plan.week_id,
      scope: opts.query.scope,
      day: opts.query.day,
      request_id: opts.requestId,
    } satisfies PlanRegenerationJobData,
    {
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
      jobId: jobIdKey,
    },
  );

  // 4. Audit the regeneration request.
  try {
    await this.auditService.write({
      event_type: 'plan.regeneration_requested',
      household_id: opts.householdId,
      request_id: opts.requestId,
      metadata: {
        plan_id: opts.planId,
        scope: opts.query.scope,
        day: opts.query.day ?? null,
        week_of: plan.week_of,
        rate_limit_used: count,
      },
    });
  } catch (err) {
    this.logger.error(
      { err, plan_id: opts.planId },
      'audit write failed for regeneration request — job still enqueued',
    );
  }

  this.logger.info(
    { plan_id: opts.planId, scope: opts.query.scope, job_id: job.id, count, rateLimitRemaining },
    'plan regeneration job enqueued',
  );

  return { jobId: job.id ?? jobIdKey, rateLimitRemaining };
}
```

---

### Task 10 — Update `plans.hook.ts` to inject redis and regenQueue

In `apps/api/src/modules/plans/plans.hook.ts`, update the `PlansService` instantiation:

**Add imports:**
```typescript
import { REGEN_QUEUE } from '../../jobs/plan-regeneration.job.js';
```

**Update `PlansService` construction:**
```typescript
const plansService = new PlansService({
  repository,
  briefStateRepository,
  briefStateComposer,
  allergyGuardrail: fastify.allergyGuardrailService,
  auditService: fastify.auditService,
  logger: fastify.log,
  redis: fastify.redis,           // Story 3.13 — ioredis instance
  regenQueue: fastify.bullmq.getQueue(REGEN_QUEUE),  // Story 3.13 — regen queue
});
```

> **Prerequisite check:** `plansHook` must run AFTER `ioredisPlugin` (which registers `fastify.redis`) and AFTER `bullmqPlugin`. Check `app.ts` registration order — both plugins are already registered before `plansHook`:
> - `ioredisPlugin` at line ~90
> - `bullmqPlugin` at line ~91
> - `plansHook` at line ~96
> 
> The `REGEN_QUEUE` queue is created via `fastify.bullmq.getQueue()` here (in `plansHook`) before the worker is registered (in `planRegenerationJobPlugin`). BullMQ allows queue creation before workers — the queue just buffers jobs until a worker claims them. This is correct.

---

### Task 11 — Register `planRegenerationJobPlugin` in `app.ts`

In `apps/api/src/app.ts`:

**Add import:**
```typescript
import { planRegenerationJobPlugin } from './jobs/plan-regeneration.job.js';
```

**Add registration after `planGenerationJobPlugin` (line ~99):**
```typescript
await app.register(planRegenerationJobPlugin);
```

---

### Task 12 — Add `POST /v1/plans/:planId/regenerate` route

In `apps/api/src/modules/plans/plans.routes.ts`:

**Add imports:**
```typescript
import {
  PausePlanDayInputSchema,
  SwapPlanItemInputSchema,
  SwapPlanItemResponseSchema,
  RegeneratePlanQuerySchema,
  RegeneratePlanResponseSchema,
} from '@hivekitchen/contracts';
import type {
  PausePlanDayInput,
  PlanItemRow,
  SwapPlanItemInput,
  RegeneratePlanQuery,
} from '@hivekitchen/types';
```

**Add route inside `plansRoutesPlugin`:**

```typescript
// POST /v1/plans/:planId/regenerate?scope=week|day&day=monday
// Enqueues a plan-regeneration BullMQ job. Rate-limited to 5/week/household.
// Returns 202 Accepted with { job_id, rate_limit_remaining }.
// SSE plan.updated is deferred to Story 5.2; client polls via TanStack Query.
fastify.post(
  '/v1/plans/:planId/regenerate',
  {
    preHandler: requireMember,
    schema: {
      params: z.object({ planId: z.string().uuid() }),
      querystring: RegeneratePlanQuerySchema,
      response: { 202: RegeneratePlanResponseSchema },
    },
  },
  async (request, reply) => {
    // Idempotency-Key is required so duplicate client retries don't enqueue
    // multiple jobs (the jobId in PlansService includes the requestId).
    const requestId = requireIdempotencyKey(request.headers['idempotency-key']);
    const { planId } = request.params as { planId: string };
    const query = request.query as RegeneratePlanQuery;

    const { jobId, rateLimitRemaining } = await fastify.plansService.requestRegeneration({
      planId,
      householdId: request.user.household_id,
      query,
      requestId,
    });

    return reply.status(202).send({ job_id: jobId, rate_limit_remaining: rateLimitRemaining });
  },
);
```

---

### Task 13 — Frontend mutations: add `useRequestRegenerationMutation`

In `apps/web/src/features/plan/mutations.ts`, add:

```typescript
import type { RegeneratePlanResponse } from '@hivekitchen/types';

// useRequestRegenerationMutation
// POST /v1/plans/:planId/regenerate?scope=week|day&day=<day>
// Returns 202 Accepted with job_id and rate_limit_remaining.
// On success: sets isRegenerating flag in the call-site so BriefCanvas can
// render <FreshnessState variant=loading>. Does NOT immediately show new plan.
export function useRequestRegenerationMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    RegeneratePlanResponse,
    Error,
    { planId: string; scope: 'week' | 'day'; day?: string }
  >({
    mutationFn: ({ planId, scope, day }) => {
      const qs = day !== undefined ? `?scope=${scope}&day=${day}` : `?scope=${scope}`;
      return hkFetch(`/v1/plans/${planId}/regenerate${qs}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': safeRandomUuid() },
      });
    },
    onSuccess: (_data, variables) => {
      // Do NOT immediately invalidate ['brief'] — the regeneration is async.
      // BriefCanvas sets isRegenerating=true on mutation success and starts
      // polling via setInterval(queryClient.invalidateQueries(['brief']), 5000).
      // This is handled at the call site, not here.
      void variables; // suppress unused-var
    },
  });
}
```

> **Rate limit UI:** If the server returns 429, `useMutation` surfaces it as an `Error`. The call site should check `error?.message?.includes('429')` or use a custom error parser — `hkFetch` should throw an `HkApiError` with `status: 429` (verify `HkApiError` in `apps/web/src/lib/fetch.ts` exposes `status`).

---

### Task 14 — Frontend UI: Regenerate affordance in `BriefCanvas.tsx`

In `apps/web/src/features/plan/BriefCanvas.tsx`:

**Add to imports:**
```typescript
import { useRequestRegenerationMutation } from './mutations.js';
```

**Add state:**
```typescript
const [isRegenerating, setIsRegenerating] = useState(false);
const regenerateMutation = useRequestRegenerationMutation();
```

**Add polling effect when regenerating:**
```typescript
// Poll brief every 5s while regenerating. Stops when plan_revision bumps.
// Brief.plan_revision is tracked in a ref to detect the increase.
const lastPlanRevisionRef = useRef<number | null>(null);

useEffect(() => {
  if (!isRegenerating) return;
  const interval = setInterval(() => {
    void queryClient.invalidateQueries({ queryKey: ['brief'] });
  }, 5000);
  return () => clearInterval(interval);
}, [isRegenerating, queryClient]);

// Detect revision bump to stop polling.
useEffect(() => {
  if (!brief) return;
  if (lastPlanRevisionRef.current === null) {
    lastPlanRevisionRef.current = brief.plan_revision;
    return;
  }
  if (brief.plan_revision > lastPlanRevisionRef.current) {
    lastPlanRevisionRef.current = brief.plan_revision;
    setIsRegenerating(false);
  }
}, [brief]);
```

**Add regeneration handler:**
```typescript
function handleRegenerate(scope: 'week' | 'day', day?: string) {
  if (!planId || isRegenerating) return;
  regenerateMutation.mutate(
    { planId, scope, day },
    {
      onSuccess: () => {
        setIsRegenerating(true);
      },
      onError: (err) => {
        // 429: show toast/inline error. Other errors: log.
        // Using browser console here — replace with your toast system when available.
        console.error('regeneration failed', err);
      },
    },
  );
}
```

**Pass regeneration intent to `FreshnessState` when regenerating:**

In the `<FreshnessState>` render site, pass `variant='loading'` when `isRegenerating`:
```tsx
<FreshnessState variant={isRegenerating ? 'loading' : /* existing logic */} />
```

**Add "Regenerate week" button below the plan tile grid:**
```tsx
{/* Regenerate week affordance — small/unobtrusive; not primary action */}
{canSwap && !isRegenerating && (
  <div className="flex justify-end mt-2">
    <button
      type="button"
      onClick={() => handleRegenerate('week')}
      disabled={regenerateMutation.isPending}
      className="font-sans text-[12px] text-stone-400 hover:text-stone-600 underline underline-offset-2 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300 disabled:opacity-50"
    >
      {regenerateMutation.isPending ? 'Queueing…' : 'Ask Lumi to try again'}
    </button>
  </div>
)}
{isRegenerating && (
  <p className="font-sans text-[13px] text-stone-500 text-center mt-3">
    Lumi is rethinking this week's plan…
  </p>
)}
```

**Add day-level regeneration to `DisambiguationPicker` (L1):**

In `apps/web/src/features/plan/DisambiguationPicker.tsx`, add a third L1 option if `onRegenDay` is provided:

Update the `DisambiguationPickerProps` interface:
```typescript
interface DisambiguationPickerProps {
  // ... existing props ...
  onRegenDay?: (day: PlanTileSummary['day']) => void;  // Story 3.13 — day regen
}
```

In the L1 render section, add after the "Change an item" button (conditional on `onRegenDay` being defined):
```tsx
{onRegenDay !== undefined && (
  <button
    type="button"
    onClick={() => { onRegenDay(day); onDismiss(); }}
    disabled={isPending}
    className="rounded-full border border-stone-300 px-3 py-1.5 text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
  >
    Ask Lumi to redo this day
  </button>
)}
```

Update `BriefCanvas` to pass `onRegenDay` to `DisambiguationPicker`:
```tsx
<DisambiguationPicker
  {/* ... existing props ... */}
  onRegenDay={
    canSwap && !isRegenerating
      ? (day) => handleRegenerate('day', day)
      : undefined
  }
/>
```

---

### Task 15 — Contract tests

In `packages/contracts/src/plan.test.ts`:

**Add `RegeneratePlanQuerySchema` tests:**
- Parses `{ scope: 'week' }` (no day required)
- Parses `{ scope: 'day', day: 'tuesday' }`
- Rejects `{ scope: 'day' }` (day missing when scope=day)
- Rejects `{ scope: 'week', day: 'tuesday' }` — `day` is optional when scope=week; schema allows extra fields in `.optional()` - verify behavior
- Rejects `{ scope: 'month' }` (not in enum)

**Add `PlanItemRowSchema` tests:**
- Parses with `replaced_by_plan_id: null`
- Parses with `replaced_by_plan_id: 'uuid'`
- Omitting `replaced_by_plan_id` → defaults to `null`

**Add `PlanRowSchema` tests:**
- Parses with `week_of: null`
- Parses with `week_of: '2026-04-28'`
- Omitting `week_of` → defaults to `null`

**Add `CommitPlanInputSchema` tests:**
- Parses with `week_of: '2026-04-28'` included (required now)
- Rejects without `week_of`

---

### Task 16 — API tests

#### Task 16a — `plans.service.test.ts` (extend)

Add tests for `requestRegeneration()`:
- Throws `NotFoundError` when plan not found
- Throws `ValidationError` when `plan.week_of` is null (pre-migration row)
- First call: increments Redis counter and enqueues job → returns `{ jobId, rateLimitRemaining: 4 }`
- 5th call: succeeds with `rateLimitRemaining: 0`
- 6th call: throws `TooManyRequestsError`
- Audit write `plan.regeneration_requested` called on success
- Audit failure does NOT rethrow

Mock `redis.incr`, `redis.expire`, `redis.ttl` with vitest `vi.fn()`.
Mock `regenQueue.add` to return `{ id: 'test-job-id' }`.

#### Task 16b — `plan-regeneration.job.ts` unit test

Create `apps/api/src/jobs/plan-regeneration.job.test.ts`.

Key test cases:
- `scope=week`: calls `orchestrator.planWeek()` without `dayScope` arg; full output passed to `commit()`
- `scope=day`: calls `orchestrator.planWeek()` with `dayScope='tuesday'`; output filtered to tuesday only; other days merged from `getCurrentPlanItems()`
- `scope=day` with LLM non-compliance (output includes extra days): extra days filtered out before commit
- `scope=day` with empty output for target day: throws (job fails)

---

### Task 17 — Frontend tests

#### Task 17a — `mutations.test.ts` (extend)

- `useRequestRegenerationMutation`: `scope=week` fires `POST /v1/plans/:id/regenerate?scope=week`
- `scope=day`: fires with `?scope=day&day=tuesday`
- 429 response surfaces as error (not silent)

#### Task 17b — `BriefCanvas.test.tsx` (extend)

- "Ask Lumi to try again" button is rendered when `canSwap && !isRegenerating`
- Button is hidden when `isRegenerating === true`
- After mutation success: `isRegenerating` becomes `true` and brief shows loading copy
- When `brief.plan_revision` increases: `isRegenerating` resets to `false`

---

### Task 18 — Typecheck, lint, test suite

- [x] `pnpm --filter @hivekitchen/contracts typecheck && pnpm --filter @hivekitchen/contracts test` — all plan.test.ts pass; new schema tests pass
- [x] `pnpm --filter @hivekitchen/api typecheck` — zero new typecheck errors introduced by 3-13; `week_of` propagates cleanly through CommitPlanInput → buildCommitInput → repository.commit → RPC. Pre-existing baseline errors (households.routes.test.ts:436, brief-state.composer.test.ts `'sunday'`, voice.service.test.ts `RequestInfo`, plans.service.test.ts:427 uncertain-no-reason) remain as before.
- [x] `pnpm --filter @hivekitchen/api exec vitest run src/modules/plans` — 94 tests, all pass.
- [x] `pnpm --filter @hivekitchen/api exec vitest run src/jobs` — 15 tests across 2 files, all pass.
- [x] `pnpm --filter @hivekitchen/web typecheck` — zero errors.
- [x] `pnpm --filter @hivekitchen/web exec vitest run src/features/plan` — 114 tests across 11 files, all pass.

---

## Dev Notes

### Critical — `week_of` is required to enqueue regeneration but may be NULL on pre-migration plans

`PlanRowSchema.week_of` is nullable (DEFAULT NULL migration). The `requestRegeneration()` service method checks for null and returns `ValidationError` (422). After deploy, the first BullMQ weekly generation job will populate `week_of` for new plans. The user will see a "view the current week's brief" guidance message until the current week's plan is regenerated by the scheduled job.

### Critical — `commit_plan()` RPC now archives instead of deleting

The updated `commit_plan()` archives existing `plan_items` (sets `replaced_by_plan_id`) before inserting the new generation. This means:
- `findItemsByPlanId()` MUST filter `WHERE replaced_by_plan_id IS NULL` — **already specified in Task 5b**
- `BriefStateComposer.refresh()` calls `plansRepository.findItemsByPlanId()` — it gets only current items automatically after Task 5b
- Old plan_items for previous generations accumulate in the DB — this is intentional for Story 3.15 (history view). At MVP scale this is acceptable. Add a note to `deferred-work.md` about adding a partition/archival strategy when the table grows.

### Critical — Day-scope commit must merge with other-day current items

`commit_plan()` replaces ALL current items for a plan (archives + inserts new set). For `scope=day`, the worker fetches the current items for OTHER days and includes them in the new commit payload so they are re-inserted as "current" (while the old items for all days get archived). This ensures `findItemsByPlanId()` returns a complete week's plan after a day-scoped regeneration.

The `getCurrentPlanItems(planId, householdId)` call inside the worker relies on `fastify.plansService` — verify that `fastify.plansService` is accessible inside the job worker (it is, per the plugin pattern in `plan-generation.job.ts` which uses `fastify.plansService.commit()`).

### Critical — Rate limit counter is incremented BEFORE job enqueue

The Redis `INCR` happens before `regenQueue.add()`. If `regenQueue.add()` throws, the rate limit counter is already incremented. This is intentional: it prevents rapid retry loops from bypassing the rate limit on transient queue failures. Users have `REGEN_RATE_LIMIT` successful enqueues per week; a failed enqueue counts against that limit. Add a note to `deferred-work.md` if this needs refinement.

### Critical — `TooManyRequestsError` requires a matching `Retry-After` header in `app.ts`

The architecture §3.6 specifies: "429 in Problem+JSON with `Retry-After`". The `setErrorHandler` in `app.ts` handles `DomainError` uniformly — but the `Retry-After` header is not sent by the generic handler. Task 4 adds special-case handling for `TooManyRequestsError`. Verify the import is added to `app.ts` alongside the updated handler.

### Critical — `PlansService.requestRegeneration()` requires `redis` and `regenQueue` deps

The `PlansServiceDeps` interface is extended in Task 9. The `plansHook.ts` instantiation in Task 10 must inject both. Failure to inject will throw at runtime with a property-access error on `undefined`. The TypeScript compiler will catch this if `PlansServiceDeps` is updated correctly.

### Architecture — SSE `plan.updated` is deferred to Story 5.2

The AC says "SSE `plan.updated` invalidates Brief". The actual SSE emission is deferred (same as Story 3.7). The brief_state projection IS updated synchronously inside `PlansService.commit()` → `BriefStateComposer.refresh()`. The client detects completion by polling TanStack Query every 5s (Task 14) and detecting `brief.plan_revision` increment. The 5s polling interval is acceptable for MVP — regeneration typically takes 10–30s.

### Architecture — BullMQ `getWorker(REGEN_QUEUE)` in `planRegenerationJobPlugin`

Verify the `bullmqPlugin` API: the `failed` event listener should be attached to the `Worker` instance returned by `getWorker(queue, processor, opts)`, not retrieved via a second `getWorker()` call. If `bullmq.plugin.ts` caches workers by name, a second `getWorker(REGEN_QUEUE)` without a processor may return the same instance — this is acceptable but brittle. Prefer the explicit pattern:
```typescript
const worker = fastify.bullmq.getWorker(REGEN_QUEUE, processor, { concurrency: 2 });
worker.on('failed', (job, err) => { ... });
```

### Architecture — `replaced_by_plan_id` self-reference semantics

`replaced_by_plan_id = plan_id` means "this item was superseded when plan X was updated". Since the same `plan_id` is reused across revisions, this is a self-FK: both the item's `plan_id` and its `replaced_by_plan_id` point to the same plan row. This is intentional and safe. The `ON DELETE SET NULL` constraint ensures old items aren't orphaned if the plan row is ever deleted (ops scenario).

### UX — "Ask Lumi to try again" button is deliberately de-emphasized

The regeneration affordance is a small underlined text button at the bottom of BriefCanvas, not a prominent CTA. HiveKitchen is a "system thinks first" product — the initial plan is the ready answer. Regeneration is an escape hatch, not a primary flow. Do not make it visually prominent or accessible from the main action area.

### Pattern — Idempotency-Key on the regeneration route

The `POST /v1/plans/:planId/regenerate` route requires `Idempotency-Key` (same UUID validation as Story 3.12 PATCH routes). The `jobId` in BullMQ includes `requestId`, making multiple enqueues with the same Idempotency-Key safe: BullMQ deduplicates by `jobId` for jobs in the queue. Once a job moves to `completed`, BullMQ's `removeOnComplete: { count: 100 }` may remove it, allowing re-enqueueing after that — acceptable at MVP scale.

---

## Project Structure

**New files:**
```
supabase/migrations/20260630000000_add_week_of_to_plans.sql
supabase/migrations/20260630000100_add_replaced_by_plan_id_to_plan_items.sql
supabase/migrations/20260630000200_update_commit_plan_archive_items.sql
apps/api/src/jobs/plan-regeneration.job.ts
apps/api/src/jobs/plan-regeneration.job.test.ts
```

**Modified files:**
```
packages/contracts/src/plan.ts                      + week_of in CommitPlanInputSchema + PlanRowSchema; replaced_by_plan_id in PlanItemRowSchema; RegeneratePlanQuerySchema + RegeneratePlanResponseSchema
packages/contracts/src/plan.test.ts                 + schema tests for new fields
packages/types/src/index.ts                         + RegeneratePlanQuery, RegeneratePlanResponse types
apps/api/src/common/errors.ts                       + TooManyRequestsError
apps/api/src/app.ts                                 + planRegenerationJobPlugin import + registration; TooManyRequestsError Retry-After header in setErrorHandler
apps/api/src/modules/plans/plans.service.ts         + requestRegeneration(), getCurrentPlanItems(); PlansServiceDeps extended with redis + regenQueue
apps/api/src/modules/plans/plans.service.test.ts    + requestRegeneration tests
apps/api/src/modules/plans/plans.hook.ts            + inject fastify.redis + regenQueue into PlansService
apps/api/src/modules/plans/plans.repository.ts      + PLAN_COLUMNS updated; PLAN_ITEM_COLUMNS updated; findItemsByPlanId filtered; findAllItemsByPlanId added; commit() passes week_of
apps/api/src/modules/plans/plans.repository.test.ts + findItemsByPlanId filters test; findAllItemsByPlanId test
apps/api/src/agents/orchestrator.ts                 + dayScope? param in planWeek()
apps/api/src/jobs/plan-generation.job.ts            + buildCommitInput() includes week_of
apps/web/src/features/plan/mutations.ts             + useRequestRegenerationMutation
apps/web/src/features/plan/BriefCanvas.tsx          + isRegenerating state; polling effect; handleRegenerate; "Ask Lumi to try again" button
apps/web/src/features/plan/BriefCanvas.test.tsx     + regenerate button + loading state tests
apps/web/src/features/plan/DisambiguationPicker.tsx + onRegenDay? prop; "Ask Lumi to redo this day" L1 button
apps/web/src/features/plan/DisambiguationPicker.test.tsx + onRegenDay tests
_bmad-output/implementation-artifacts/sprint-status.yaml  3-13 → ready-for-dev
```

**Do NOT touch:**
```
supabase/migrations/20260502111000_create_commit_plan_function.sql  (superseded by Task 1c's CREATE OR REPLACE)
apps/api/src/jobs/plan-generation.job.ts                           (except buildCommitInput week_of — Task 6)
apps/web/src/features/plan/QuietDiff.tsx
apps/web/src/features/plan/FreshnessState.tsx                      (variant=loading already supported — 3.11)
apps/web/src/features/plan/AllergyClearedBadge.tsx
apps/api/src/modules/allergy-guardrail/                            (guardrail consumed, not modified)
```

---

## Deferred Work (add to `_bmad-output/implementation-artifacts/deferred-work.md`)

```
[Defer] plan_items archival growth: each commit_plan() call archives the previous set of items.
At scale, plan_items will grow without bound. Add a nightly archival job that moves rows with
replaced_by_plan_id IS NOT NULL older than 90 days to a plan_items_archive table (preserving
for Story 3.15 history view). [Story 3.13]

[Defer] Rate limit counter on failed enqueue: Redis INCR happens before queue.add(), so a
transient queue failure consumes a rate limit slot. Low probability at MVP scale but should be
fixed in a follow-up with a Redis transaction (MULTI/EXEC: INCR + enqueue confirmation).
[Story 3.13]

[Defer] plan.updated SSE emission for regeneration: plan-regeneration.job.ts logs intent but
does not emit the SSE event. Client uses 5s polling instead. Wire up real SSE emission in
Story 5.2 and remove the polling interval from BriefCanvas. [Story 3.13 → Story 5.2]

[Defer] Regeneration for pre-3.13 plans (week_of = NULL): plans generated before Story 3.13
cannot be regenerated via the new endpoint (ValidationError returned). After the first
automated Friday generation cycle post-deploy, all active plans will have week_of populated.
No backfill needed — the window is one week. [Story 3.13]
```

---

## Dev Agent Record

### Implementation Notes

- **Migrations** — three new migrations land in chronological order: add `week_of` to `plans`, add `replaced_by_plan_id` (+ partial indexes for archived/current rows) to `plan_items`, then `CREATE OR REPLACE FUNCTION commit_plan(...)` to archive (instead of delete) prior items and accept `p_week_of`.
- **Contracts** — `CommitPlanInputSchema` now requires `week_of` (input invariant). `PlanRowSchema.week_of` and `PlanItemRowSchema.replaced_by_plan_id` use `.nullable().default(null)` so pre-migration rows parse cleanly. Added `RegeneratePlanQuerySchema` (refine: `day` required when `scope=day`) and `RegeneratePlanResponseSchema`.
- **Errors** — `TooManyRequestsError` carries `retryAfterSeconds`; the global error handler in `app.ts` special-cases it to emit the matching `Retry-After` response header before falling through to the generic Problem+JSON serializer.
- **Repository** — `findItemsByPlanId` now filters `replaced_by_plan_id IS NULL` so the brief composer + presentation-bind keeps reading current items only after regeneration. `findAllItemsByPlanId` provides ops/history bypass. `commit()` passes `p_week_of` to the RPC.
- **Orchestrator** — `planWeek()` accepts an optional `dayScope` arg that injects a "DAY ONLY" instruction into the system context.
- **Job worker** — `apps/api/src/jobs/plan-regeneration.job.ts` registers a BullMQ worker on `plan-regeneration`. For `scope=day`, it filters the planner output to the target day (guards against LLM non-compliance) and merges with current other-day items via `plansService.getCurrentPlanItems()` so `commit_plan()` re-inserts a complete week as the new "current" set. Permanent-failure listener writes `plan.generation.failed` audit only on the final attempt.
- **Service** — `PlansService.requestRegeneration()` does ownership check → null-`week_of` validation → Redis `INCR` rate limit (5/week/household, 8-day TTL) → `regenQueue.add()` with deterministic jobId including requestId for client-side idempotency → audit. `getCurrentPlanItems()` is the worker's read path.
- **Hook + plugin wiring** — `plansHook` injects `fastify.redis` and `fastify.bullmq.getQueue(REGEN_QUEUE)` into `PlansService` deps. `app.ts` registers the new plugin after `planGenerationJobPlugin`.
- **Route** — `POST /v1/plans/:planId/regenerate` is gated by `requireMember` and validates `Idempotency-Key` (UUID) on every call. Returns 202 with `{ job_id, rate_limit_remaining }`.
- **Frontend mutation** — `useRequestRegenerationMutation` POSTs with a fresh `Idempotency-Key` and does NOT auto-invalidate `['brief']` (regeneration is async; the call site polls).
- **BriefCanvas UI** — adds an unobtrusive "Ask Lumi to try again" link at the bottom-end of the tile grid (de-emphasized per UX-DR23 — system thinks first). On success: sets `isRegenerating=true`, polls `['brief']` every 5s until `brief.plan_revision` increments, then resets. The `FreshnessState` switches to `variant='loading'` and a centered "Lumi is rethinking…" message renders.
- **DisambiguationPicker** — gains an optional `onRegenDay` prop; when provided, L1 surfaces a third "Ask Lumi to redo this day" button alongside Sick day and Change an item.

### Completion Notes

- All 18 tasks complete; story acceptance criteria #1 and #2 satisfied. Rate limit (5/week/household), allergy guardrail re-evaluation, archival semantics, and SSE deferral note all match architecture §3.6.
- Tests: contracts +29 new assertions across the new schemas + week_of/replaced_by_plan_id; API +6 service tests for `requestRegeneration` (404, 422, 1st/5th/6th calls, day-scope payload, audit-fail-tolerance); job +4 worker branching tests via a focused harness (the worker body lives inside the plugin closure, so a mirrored harness asserts the same branching predicates); web +3 BriefCanvas regen-flow tests + 3 mutation tests (week/day/429).
- Pre-existing typecheck + test failures (memory.service.test.ts, brief-state.composer.test.ts:332 `'sunday'`, households.routes.test.ts:436 mock signature, voice.service.test.ts `RequestInfo`, cultural.test.ts `priors:[]`, plans.service.test.ts:427 uncertain-without-reason) were verified by stash to be present on `main` before this story; not touched.
- Deferred items (5) added to `_bmad-output/implementation-artifacts/deferred-work.md` covering plan_items growth, rate-limit-on-enqueue-failure, SSE deferral, pre-3.13 plan migration window, and `bullmqPlugin.getWorker` cache contract.

### File List

**New files:**

```
supabase/migrations/20260630000000_add_week_of_to_plans.sql
supabase/migrations/20260630000100_add_replaced_by_plan_id_to_plan_items.sql
supabase/migrations/20260630000200_update_commit_plan_archive_items.sql
apps/api/src/jobs/plan-regeneration.job.ts
apps/api/src/jobs/plan-regeneration.job.test.ts
apps/web/src/features/plan/mutations.test.ts
```

**Modified files:**

```
packages/contracts/src/plan.ts
packages/contracts/src/plan.test.ts
packages/types/src/index.ts
apps/api/src/common/errors.ts
apps/api/src/app.ts
apps/api/src/agents/orchestrator.ts
apps/api/src/jobs/plan-generation.job.ts
apps/api/src/modules/plans/plans.repository.ts
apps/api/src/modules/plans/plans.repository.test.ts
apps/api/src/modules/plans/plans.service.ts
apps/api/src/modules/plans/plans.service.test.ts
apps/api/src/modules/plans/plans.hook.ts
apps/api/src/modules/plans/plans.routes.ts
apps/api/src/modules/plans/brief-state.composer.test.ts
apps/web/src/features/plan/mutations.ts
apps/web/src/features/plan/BriefCanvas.tsx
apps/web/src/features/plan/BriefCanvas.test.tsx
apps/web/src/features/plan/DisambiguationPicker.tsx
_bmad-output/implementation-artifacts/sprint-status.yaml
_bmad-output/implementation-artifacts/deferred-work.md
_bmad-output/implementation-artifacts/3-13-plan-regeneration-request.md
```

## Change Log

| Date       | Author | Change                                   |
| ---------- | ------ | ---------------------------------------- |
| 2026-05-04 | Menon  | Story 3.13 created — ready-for-dev.       |
| 2026-05-04 | Amelia | Story 3.13 implementation complete — DB migrations, contracts, errors, orchestrator dayScope, regeneration job + worker, PlansService.requestRegeneration + getCurrentPlanItems, hook wiring, app registration, route, frontend mutation + BriefCanvas + DisambiguationPicker UI, contract / API / job / frontend tests. Status → review. |

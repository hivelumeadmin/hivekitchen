# Story 3.5: Plan repository + revision versioning + presentation-bind contract

Status: done

## Story

As a developer,
I want `plans` and `plan_items` tables with revision versioning and a `plan.commit` transaction writing `guardrail_cleared_at` + `guardrail_version` atomically,
So that the presentation-bind contract is structurally enforced and concurrent mutations don't race.

## Acceptance Criteria

1. **Given** Story 3.1 is complete,
   **When** Story 3.5 is complete,
   **Then** Supabase migration `20260502110000_create_plans_and_plan_items.sql` creates:
   - `plans` table: `(id UUID PK, household_id UUID NOT NULL FK households, week_id UUID NOT NULL, revision INTEGER NOT NULL DEFAULT 1, generated_at TIMESTAMPTZ NOT NULL, guardrail_cleared_at TIMESTAMPTZ NULL, guardrail_version VARCHAR(32) NULL, prompt_version VARCHAR(32) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
   - `plan_items` table: `(id UUID PK, plan_id UUID NOT NULL FK plans ON DELETE CASCADE, child_id UUID NOT NULL FK children ON DELETE CASCADE, day TEXT NOT NULL, slot TEXT NOT NULL, recipe_id UUID NULL, item_id UUID NULL, ingredients JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
   - Unique index on `plans(household_id, week_id)` — one active plan per household per week
   - Composite index on `plan_items(plan_id, child_id)`
   - RLS: `SELECT/UPDATE/DELETE` scoped to `household_id` matching the JWT claim

2. **And** `PlansRepository.commit(input)` writes the `plans` row and all `plan_items` rows plus `guardrail_cleared_at = NOW()` and `guardrail_version` atomically in one Postgres transaction via `supabase.rpc('commit_plan', ...)`. If the `rpc` call fails the entire write is rolled back.

3. **And** `PlansRepository.findByIdForPresentation({ planId, householdId })` includes `WHERE guardrail_cleared_at IS NOT NULL` in the query. `findByIdForOps({ planId, householdId })` reads pre-clearance rows and carries the comment `// presentation-bypass: ops-audit` on the query line as the lint exception.

4. **And** `PlansService.commit(input, regenerate)` runs `allergyGuardrail.clearOrReject()` then calls `repository.commit()` on success. On guardrail block, calls `regenerate(rejections)` and retries up to 3 total attempts; throws `GuardrailRejectionError` if all retries fail. The `regenerate` callback is typed `(rejections: GuardrailResult[]) => Promise<CommitPlanInput>` — since `plan.compose` is still a stub in this story, callers pass a function that rethrows `NotImplementedError` until Story 3.7 wires the BullMQ job.

5. **And** `GuardrailRejectionError` is added to `apps/api/src/common/errors.ts` (status 422, type `/errors/guardrail-rejection`).

6. **And** the `PlansService.compose()` stub is updated to return a valid `WeeklyPlan` shape when called (replace `NotImplementedError` with a generated UUID + `status: 'draft'` + empty days) — **wait, this is WRONG**: the deferred-work note says the stub throws NotImplementedError, which is correct for now. Leave `compose()` throwing `NotImplementedError`. The `commit()` method is the new method added in this story.

7. **And** `pnpm typecheck` passes with zero new errors. All new repository/service unit tests pass.

## Tasks / Subtasks

### Task 1 — Supabase migration: plans + plan_items (AC: #1)

- [x] Create `supabase/migrations/20260502110000_create_plans_and_plan_items.sql`:
  ```sql
  -- plans: one row per household per week; guardrail_cleared_at NULL = pre-clearance (not renderable)
  CREATE TABLE plans (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id        UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    week_id             UUID NOT NULL,
    revision            INTEGER NOT NULL DEFAULT 1,
    generated_at        TIMESTAMPTZ NOT NULL,
    guardrail_cleared_at TIMESTAMPTZ,
    guardrail_version   VARCHAR(32),
    prompt_version      VARCHAR(32) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX plans_household_week_unique ON plans(household_id, week_id);

  CREATE TABLE plan_items (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id      UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    child_id     UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    day          TEXT NOT NULL,
    slot         TEXT NOT NULL,
    recipe_id    UUID,
    item_id      UUID,
    ingredients  JSONB NOT NULL DEFAULT '[]',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX plan_items_plan_child_idx ON plan_items(plan_id, child_id);

  -- RLS
  ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
  ALTER TABLE plan_items ENABLE ROW LEVEL SECURITY;

  CREATE POLICY plans_household_select ON plans FOR SELECT
    USING (household_id = (current_setting('request.jwt.claims', true)::jsonb->>'household_id')::uuid);

  CREATE POLICY plans_household_all ON plans FOR ALL
    USING (household_id = (current_setting('request.jwt.claims', true)::jsonb->>'household_id')::uuid);

  CREATE POLICY plan_items_via_plan ON plan_items FOR ALL
    USING (plan_id IN (
      SELECT id FROM plans
      WHERE household_id = (current_setting('request.jwt.claims', true)::jsonb->>'household_id')::uuid
    ));
  ```
  > Note: Check the existing RLS pattern in `supabase/migrations/20260503090000_create_rls_policies.sql` — RLS policies may be consolidated there rather than inline. Follow the project's existing pattern.

### Task 2 — PostgreSQL commit_plan function (AC: #2)

The atomic commit requires a transaction that inserts/updates plans + plan_items + sets guardrail fields in one round-trip. Use a PostgreSQL function called via `supabase.rpc()`.

- [x] Create `supabase/migrations/20260502111000_create_commit_plan_function.sql`:
  ```sql
  CREATE OR REPLACE FUNCTION commit_plan(
    p_plan_id           UUID,
    p_household_id      UUID,
    p_week_id           UUID,
    p_revision          INTEGER,
    p_generated_at      TIMESTAMPTZ,
    p_guardrail_cleared_at TIMESTAMPTZ,
    p_guardrail_version VARCHAR(32),
    p_prompt_version    VARCHAR(32),
    p_items             JSONB  -- array of {child_id, day, slot, recipe_id?, item_id?, ingredients}
  )
  RETURNS UUID
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_item JSONB;
  BEGIN
    -- Upsert the plan row (INSERT or UPDATE if revision matches)
    INSERT INTO plans (id, household_id, week_id, revision, generated_at,
                       guardrail_cleared_at, guardrail_version, prompt_version)
    VALUES (p_plan_id, p_household_id, p_week_id, p_revision, p_generated_at,
            p_guardrail_cleared_at, p_guardrail_version, p_prompt_version)
    ON CONFLICT (id) DO UPDATE
      SET revision = EXCLUDED.revision,
          guardrail_cleared_at = EXCLUDED.guardrail_cleared_at,
          guardrail_version = EXCLUDED.guardrail_version,
          prompt_version = EXCLUDED.prompt_version,
          updated_at = NOW();

    -- Delete existing items for this plan (replace semantics on commit)
    DELETE FROM plan_items WHERE plan_id = p_plan_id;

    -- Insert new items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO plan_items (plan_id, child_id, day, slot, recipe_id, item_id, ingredients)
      VALUES (
        p_plan_id,
        (v_item->>'child_id')::UUID,
        v_item->>'day',
        v_item->>'slot',
        NULLIF(v_item->>'recipe_id', '')::UUID,
        NULLIF(v_item->>'item_id', '')::UUID,
        COALESCE(v_item->'ingredients', '[]'::JSONB)
      );
    END LOOP;

    RETURN p_plan_id;
  END;
  $$;
  ```
  > This approach keeps the transaction boundary in Postgres where it belongs. The Supabase JS client's `supabase.rpc('commit_plan', {...})` call wraps this atomically.

### Task 3 — GuardrailRejectionError (AC: #5)

- [x] Add to `apps/api/src/common/errors.ts` (after `NotImplementedError`):
  ```typescript
  export class GuardrailRejectionError extends DomainError {
    readonly type = '/errors/guardrail-rejection';
    readonly status = 422;
    readonly title = 'Plan blocked by allergy guardrail';
    constructor(planId: string, attemptCount: number) {
      super(
        `Plan ${planId} blocked by allergy guardrail after ${attemptCount} attempt(s). Regeneration required with rejection context.`,
      );
    }
  }
  ```

### Task 4 — Contracts: PlanRow and CommitPlanInput schemas (AC: #2, #4)

- [x] Add to `packages/contracts/src/plan.ts`:
  ```typescript
  // --- Story 3.5 — plan repository write input ---

  export const PlanItemWriteSchema = z.object({
    child_id: z.string().uuid(),
    day: z.string().min(1).max(64),
    slot: z.string().min(1).max(64),
    recipe_id: z.string().uuid().optional(),
    item_id: z.string().uuid().optional(),
    ingredients: z.array(z.string().min(1)).default([]),
  });
  export type PlanItemWrite = z.infer<typeof PlanItemWriteSchema>;

  export const CommitPlanInputSchema = z.object({
    plan_id: z.string().uuid(),
    household_id: z.string().uuid(),
    week_id: z.string().uuid(),
    revision: z.number().int().min(1),
    generated_at: z.string().datetime(),
    prompt_version: z.string().min(1).max(32),
    items: z.array(PlanItemWriteSchema).min(1),
  });
  export type CommitPlanInput = z.infer<typeof CommitPlanInputSchema>;

  export const PlanRowSchema = z.object({
    id: z.string().uuid(),
    household_id: z.string().uuid(),
    week_id: z.string().uuid(),
    revision: z.number().int().min(1),
    generated_at: z.string().datetime(),
    guardrail_cleared_at: z.string().datetime().nullable(),
    guardrail_version: z.string().nullable(),
    prompt_version: z.string(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  });
  export type PlanRow = z.infer<typeof PlanRowSchema>;
  ```

- [x] Update `packages/contracts/src/index.ts` — add re-exports:
  ```typescript
  export type { PlanItemWrite, CommitPlanInput, PlanRow } from './plan.js';
  export { PlanItemWriteSchema, CommitPlanInputSchema, PlanRowSchema } from './plan.js';
  ```

- [x] Update `packages/types/src/index.ts` — follow the `z.infer<>` re-export pattern already used in the file. Add:
  ```typescript
  import {
    CommitPlanInputSchema,
    PlanRowSchema,
    PlanItemWriteSchema,
    // ... existing plan imports
  } from '@hivekitchen/contracts';

  export type CommitPlanInput = z.infer<typeof CommitPlanInputSchema>;
  export type PlanRow = z.infer<typeof PlanRowSchema>;
  export type PlanItemWrite = z.infer<typeof PlanItemWriteSchema>;
  ```

- [x] Add `packages/contracts/src/plan.test.ts` round-trip tests for new schemas (follow existing test patterns in that file).

### Task 5 — PlansRepository (AC: #2, #3)

Create `apps/api/src/modules/plans/plans.repository.ts`:

```typescript
import { BaseRepository } from '../../repository/base.repository.js';
import type { CommitPlanInput, PlanRow } from '@hivekitchen/types';

const PLAN_COLUMNS =
  'id, household_id, week_id, revision, generated_at, guardrail_cleared_at, guardrail_version, prompt_version, created_at, updated_at';

export class PlansRepository extends BaseRepository {
  // presentation-bind contract: only guardrail-cleared rows are ever visible to the UI
  async findByIdForPresentation(opts: {
    planId: string;
    householdId: string;
  }): Promise<PlanRow | null> {
    const { data, error } = await this.client
      .from('plans')
      .select(PLAN_COLUMNS)
      .eq('id', opts.planId)
      .eq('household_id', opts.householdId)
      .not('guardrail_cleared_at', 'is', null)  // presentation-bind: no pre-clearance reads
      .maybeSingle();
    if (error) throw error;
    return data as PlanRow | null;
  }

  // presentation-bypass: ops-audit — pre-clearance reads for ops/anomaly dashboard only
  async findByIdForOps(opts: {
    planId: string;
    householdId: string;
  }): Promise<PlanRow | null> {
    const { data, error } = await this.client
      .from('plans')
      .select(PLAN_COLUMNS)
      .eq('id', opts.planId)
      .eq('household_id', opts.householdId)
      .maybeSingle();
    if (error) throw error;
    return data as PlanRow | null;
  }

  async findCurrentByHousehold(opts: {
    householdId: string;
    weekId: string;
  }): Promise<PlanRow | null> {
    const { data, error } = await this.client
      .from('plans')
      .select(PLAN_COLUMNS)
      .eq('household_id', opts.householdId)
      .eq('week_id', opts.weekId)
      .not('guardrail_cleared_at', 'is', null)  // presentation-bind
      .order('revision', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data as PlanRow | null;
  }

  async commit(
    input: CommitPlanInput,
    guardrailClearedAt: string,
    guardrailVersion: string,
  ): Promise<string> {
    const { data, error } = await this.client.rpc('commit_plan', {
      p_plan_id: input.plan_id,
      p_household_id: input.household_id,
      p_week_id: input.week_id,
      p_revision: input.revision,
      p_generated_at: input.generated_at,
      p_guardrail_cleared_at: guardrailClearedAt,
      p_guardrail_version: guardrailVersion,
      p_prompt_version: input.prompt_version,
      p_items: JSON.stringify(input.items),
    });
    if (error) throw error;
    return data as string; // returns plan_id UUID
  }
}
```

### Task 6 — PlansService (AC: #4)

Replace `apps/api/src/modules/plans/plan.service.ts` with a proper service. **Important:** the file is currently named `plan.service.ts` (singular) — rename to `plans.service.ts` (plural, matching project naming conventions for module services). Update imports in `orchestrator.hook.ts` accordingly.

```typescript
import type { FastifyBaseLogger } from 'fastify';
import { randomUUID } from 'node:crypto';
import { GUARDRAIL_VERSION } from '../allergy-guardrail/allergy-rules.engine.js';
import { GuardrailRejectionError, NotImplementedError } from '../../common/errors.js';
import type { AllergyGuardrailService } from '../allergy-guardrail/allergy-guardrail.service.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { PlansRepository } from './plans.repository.js';
import type { CommitPlanInput, GuardrailResult, PlanComposeInput, PlanComposeOutput } from '@hivekitchen/types';

export interface PlansServiceDeps {
  repository: PlansRepository;
  allergyGuardrail: AllergyGuardrailService;
  auditService: AuditService;
  logger: FastifyBaseLogger;
}

const MAX_GUARDRAIL_RETRIES = 3;

export class PlansService {
  private readonly repo: PlansRepository;
  private readonly allergyGuardrail: AllergyGuardrailService;
  private readonly auditService: AuditService;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: PlansServiceDeps) {
    this.repo = deps.repository;
    this.allergyGuardrail = deps.allergyGuardrail;
    this.auditService = deps.auditService;
    this.logger = deps.logger;
  }

  // compose() remains a stub until Story 3.7 wires the BullMQ job
  async compose(_input: PlanComposeInput): Promise<PlanComposeOutput> {
    throw new NotImplementedError('plan.compose — real generation lands in Story 3.7 BullMQ job');
  }

  async commit(
    input: CommitPlanInput,
    requestId: string,
    // regenerate is called on guardrail block; callers pass a stub until Story 3.7
    regenerate: (rejections: GuardrailResult[]) => Promise<CommitPlanInput>,
  ): Promise<string> {
    const planId = input.plan_id;
    const rejections: GuardrailResult[] = [];

    let current = input;
    for (let attempt = 1; attempt <= MAX_GUARDRAIL_RETRIES; attempt++) {
      const planItemsForGuardrail = current.items.map((item) => ({
        child_id: item.child_id,
        day: item.day,
        slot: item.slot,
        ingredients: item.ingredients,
      }));

      const result = await this.allergyGuardrail.clearOrReject(
        planItemsForGuardrail,
        current.household_id,
        requestId,
      );

      if (result.verdict === 'cleared') {
        const clearedAt = new Date().toISOString();
        await this.repo.commit(current, clearedAt, GUARDRAIL_VERSION);

        await this.auditService.write({
          event_type: 'plan.generated',
          household_id: current.household_id,
          request_id: requestId,
          metadata: {
            plan_id: planId,
            revision: current.revision,
            prompt_version: current.prompt_version,
          },
          stages: [
            ...rejections.map((r, i) => ({
              stage: 'guardrail_rejection',
              attempt: i + 1,
              conflicts: r.verdict === 'blocked' ? r.conflicts : [],
            })),
            { stage: 'guardrail_verdict', verdict: 'cleared', guardrail_version: GUARDRAIL_VERSION },
          ],
        });

        this.logger.info(
          { plan_id: planId, attempt, guardrail_version: GUARDRAIL_VERSION },
          'plan committed after guardrail clearance',
        );
        return planId;
      }

      rejections.push(result);
      this.logger.warn(
        { plan_id: planId, attempt, verdict: result.verdict },
        'guardrail blocked plan — attempting regeneration',
      );

      if (attempt < MAX_GUARDRAIL_RETRIES) {
        current = await regenerate(rejections);
      }
    }

    throw new GuardrailRejectionError(planId, MAX_GUARDRAIL_RETRIES);
  }
}
```

### Task 7 — PlansHook (AC: #2, #4)

Create `apps/api/src/modules/plans/plans.hook.ts` — a Fastify plugin that instantiates the service and decorates the instance. Follow the pattern in `apps/api/src/modules/memory/memory.hook.ts`.

```typescript
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { PlansRepository } from './plans.repository.js';
import { PlansService } from './plans.service.js';

export default fp(async (fastify: FastifyInstance) => {
  const repository = new PlansRepository(fastify.supabase);
  const plansService = new PlansService({
    repository,
    allergyGuardrail: fastify.allergyGuardrailService,
    auditService: fastify.auditService,
    logger: fastify.log,
  });
  fastify.decorate('plansService', plansService);
});
```

> Check `apps/api/src/types/fastify.d.ts` for the existing decorator declarations and add `plansService: PlansService` to the `FastifyInstance` interface there.

### Task 8 — Update orchestrator.hook.ts (AC: #4)

`plan.service.ts` is renamed to `plans.service.ts` and the `PlanService` class to `PlansService`. Update the import in `apps/api/src/agents/orchestrator.hook.ts`:

```typescript
// Before:
import { PlanService } from '../modules/plans/plan.service.js';
const planService = new PlanService();
// After:
import { PlansService } from '../modules/plans/plans.service.js';
// PlansService now requires deps — use fastify.plansService decoration instead
// Remove manual instantiation; pull from decorated instance:
const services: OrchestratorServices = {
  // ...
  plan: fastify.plansService,
  // ...
};
```

> The `plan.compose` tool still calls `planService.compose()` which throws `NotImplementedError`. That's the correct behavior until Story 3.7.

### Task 9 — Tests (AC: #2, #3, #4)

- [x] Create `apps/api/src/modules/plans/plans.repository.test.ts`:
  - `findByIdForPresentation` — returns null when `guardrail_cleared_at IS NULL` (mock Supabase to return row without guardrail_cleared_at)
  - `findByIdForPresentation` — returns row when `guardrail_cleared_at IS NOT NULL`
  - `findByIdForOps` — returns row regardless of `guardrail_cleared_at` value
  - `commit` — calls `supabase.rpc('commit_plan', ...)` with correct params

- [x] Create `apps/api/src/modules/plans/plans.service.test.ts`:
  - `commit` — calls `allergyGuardrail.clearOrReject()` and `repository.commit()` on cleared verdict
  - `commit` — calls `regenerate()` on guardrail block and retries up to 3 times
  - `commit` — throws `GuardrailRejectionError` after 3 failed attempts
  - `commit` — writes audit row with stages on success
  - `compose` — throws `NotImplementedError`

- [x] Create `packages/contracts/src/plan.test.ts` additions — round-trip tests for `CommitPlanInputSchema`, `PlanRowSchema`, `PlanItemWriteSchema`

- [x] Run: `pnpm --filter @hivekitchen/api typecheck` — zero new errors
- [x] Run: `pnpm --filter @hivekitchen/contracts test` — all tests pass

---

## Dev Notes

### Critical — File naming: plan.service.ts → plans.service.ts

The existing stub at `apps/api/src/modules/plans/plan.service.ts` uses singular naming. Project convention for module services is plural (see `memory.service.ts`, `allergy-guardrail.service.ts`). Rename to `plans.service.ts` and update:
- `apps/api/src/agents/orchestrator.hook.ts` import
- `apps/api/src/agents/orchestrator.ts` import (check that `PlanService` type reference is updated to `PlansService`)
- `apps/api/src/types/fastify.d.ts` decorator declaration

### Critical — The presentation-bind contract is three-layer enforced

Per architecture §3.5 (Allergy Guardrail boundary):
1. **Repository layer:** `findByIdForPresentation()` always includes `.not('guardrail_cleared_at', 'is', null)` — this is the query-time enforcement
2. **Atomic write:** `guardrail_cleared_at` and `guardrail_version` are written in the same Postgres transaction as the plan rows via `commit_plan` RPC — never written separately
3. **Lint exception:** any code reading `plans` without the guardrail clause MUST have `// presentation-bypass: <reason>` comment — add this to `findByIdForOps` and document in the lint rule file if one exists

Never return a plan row to the frontend from a `guardrail_cleared_at IS NULL` row. If you see any path that does this, it's an architectural violation.

### Critical — GUARDRAIL_VERSION is already defined

Import it from the existing module — do not redefine:
```typescript
import { GUARDRAIL_VERSION } from '../allergy-guardrail/allergy-rules.engine.js';
```
Current value: `'1.1.0'` (as const). This is the value written to `plans.guardrail_version` on commit.

### Critical — commit_plan RPC vs. multi-statement workaround

Supabase JS v2 does not support explicit `BEGIN`/`COMMIT` transactions from the client library. The only way to guarantee atomicity is:
- **Option A (recommended):** PostgreSQL function via `supabase.rpc('commit_plan', ...)` — the entire function body runs in one implicit transaction
- **Option B (not recommended):** application-level compensating logic — if plan_items insert fails after plans insert, delete the plans row. This is brittle and not truly atomic.

Use Option A. If the `commit_plan` function doesn't exist yet in the DB (migration not yet run), the `rpc()` call will fail with a Postgres error, which is the correct behavior — do not add an application-level fallback.

### Critical — prompt_version deferred note (from Story 3.4)

The deferred-work note specifies: "Story 3.5 must add `prompt_version VARCHAR(32) NOT NULL` to plans migration and populate from `PLANNER_PROMPT.version`." This is addressed in Task 1 (migration includes `prompt_version`) and Task 5 (`CommitPlanInputSchema` includes `prompt_version`). The caller (eventually Story 3.7 BullMQ job) populates this from `PLANNER_PROMPT.version`.

### Critical — AllergyGuardrailService.clearOrReject() signature

The existing method is:
```typescript
async clearOrReject(
  planItems: PlanItemForGuardrail[],
  householdId: string,
  requestId: string,
): Promise<GuardrailResult>
```
Where `PlanItemForGuardrail` is `{ child_id: string, day: string, slot: string, ingredients: string[] }`. The `commit()` implementation maps `CommitPlanInput.items` → `PlanItemForGuardrail[]` by projecting `{ child_id, day, slot, ingredients }` — `recipe_id`/`item_id` are not passed to the guardrail (it operates on raw ingredient strings, not recipe IDs).

### Critical — audit.service.write() stages shape

The audit row for `plan.generated` uses a `stages` array. Check `apps/api/src/audit/audit.service.ts` for the exact `write()` call signature — it uses the `AuditEventType` enum for `event_type`. Verify `'plan.generated'` is in the enum; if not, add it. Follow the pattern established by `allergy-guardrail.service.ts` (which calls `audit.service.write()` with `event_type: 'allergy.guardrail_rejection'`).

### Critical — PlansService.compose() stays a stub

The `compose()` stub throws `NotImplementedError` — this is intentional per Story 3.4's deferred work. The `plan.compose` tool in the agent layer calls this stub; it will throw `NotImplementedError` at runtime until Story 3.7 wires a real implementation. Do NOT implement `compose()` logic in this story.

### Critical — Supabase Postgres client for RPC

The `BaseRepository` gives access to `this.client: SupabaseClient`. The RPC call pattern is:
```typescript
const { data, error } = await this.client.rpc('commit_plan', { p_plan_id: ..., ... });
if (error) throw error;
```
The function returns `UUID` (the plan_id). If the RPC throws a Postgres error (e.g., FK violation, unique constraint), it surfaces as `error` from the client — re-throw as-is for the service layer to handle.

### Critical — Migration timestamp ordering

Architecture lists the migration timestamps explicitly (§ File Structure):
- `20260502110000_create_plans_and_plan_items.sql` — this story
- `20260502120000_create_brief_state_projection.sql` — Story 3.6

Add the `commit_plan` function migration at `20260502111000` (between the two, 1000ms after plans table). Enum migrations must be placed at least 5000ms before the first table referencing them (Amendment V) — not applicable here since no new enums are needed for plans.

### Architecture — Redis plan cache (architecture §1.5)

Architecture specifies:
- Key: `plan:{plan_id}`, TTL: 15 minutes, invalidated on plan mutation
- Key: `guardrail:{plan_id}`, no TTL until plan mutation (a verdict is a fact)

Story 3.5 creates the repository and service but does NOT need to wire Redis caching yet — that lands with Story 3.7 (BullMQ job) which will read plans at high frequency. Do NOT add Redis cache in this story.

### Architecture — SSE plan.updated event

When a plan is committed, the system should emit a `plan.updated` SSE event. This is handled by the BullMQ job in Story 3.7, not the repository commit directly. Do NOT add SSE emission in this story.

### Pattern — Repository extends BaseRepository

```typescript
export class PlansRepository extends BaseRepository {
  // constructor is inherited: constructor(protected readonly client: SupabaseClient) {}
}
```
`BaseRepository` is at `apps/api/src/repository/base.repository.ts`. Import with `.js` extension:
```typescript
import { BaseRepository } from '../../repository/base.repository.js';
```

### Pattern — Service deps interface

Follow the established pattern from `AllergyGuardrailService` and `MemoryService`:
```typescript
export interface PlansServiceDeps {
  repository: PlansRepository;
  allergyGuardrail: AllergyGuardrailService;
  auditService: AuditService;
  logger: FastifyBaseLogger;
}
```
Constructor assigns each dep to a private readonly field.

### Project Structure — New and Modified Files

**New files:**
```
supabase/migrations/
  20260502110000_create_plans_and_plan_items.sql
  20260502111000_create_commit_plan_function.sql

apps/api/src/modules/plans/
  plans.repository.ts           (new; replaces plan.service.ts stub)
  plans.repository.test.ts
  plans.service.ts              (new; replaces plan.service.ts)
  plans.service.test.ts
  plans.hook.ts                 (new Fastify plugin)
```

**Modified files:**
```
apps/api/src/modules/plans/
  plan.service.ts               DELETE — replaced by plans.service.ts

apps/api/src/common/errors.ts   + GuardrailRejectionError

packages/contracts/src/
  plan.ts                       + CommitPlanInputSchema, PlanRowSchema, PlanItemWriteSchema
  plan.test.ts                  + round-trip tests for new schemas
  index.ts                      + re-exports

packages/types/src/index.ts     + CommitPlanInput, PlanRow, PlanItemWrite

apps/api/src/agents/
  orchestrator.hook.ts          update PlanService import → PlansService; use fastify.plansService
  orchestrator.ts               update import PlanService → PlansService in OrchestratorServices type

apps/api/src/types/fastify.d.ts + plansService: PlansService decoration
```

**Unchanged:**
- `apps/api/src/agents/tools/plan.tools.ts` — still calls `planService.compose()` which still throws `NotImplementedError`. No change.
- `apps/api/src/modules/allergy-guardrail/` — no changes needed; `clearOrReject()` is already implemented
- `apps/api/src/common/errors.ts` — only adds `GuardrailRejectionError`

### Story 3.6 Handoff

When Story 3.6 implements the `brief_state` projection writer:
- It reads from `PlansRepository.findCurrentByHousehold()` for the current plan's tile summaries
- It uses the migration `20260502120000_create_brief_state_projection.sql` (already in the migration list)
- `brief-state.composer.ts` will need `PlansRepository` as a dependency — do NOT add it here

### References

- Architecture §1.5 — caching tiers: `_bmad-output/planning-artifacts/architecture.md` (line ~309)
- Architecture §3.5 / Allergy Guardrail boundary: same file (lines ~1360–1363) — three-layer enforcement explained
- Architecture §7 — PlansService pattern example with `GuardrailRejectionError`: same file (lines ~850–863)
- Architecture — migration timestamp list: same file (lines ~1000–1021)
- Architecture §1.6 — audit log schema with stages: same file (lines ~316–320)
- Allergy Guardrail service source: `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts`
- Allergy rules engine (GUARDRAIL_VERSION): `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts`
- BaseRepository pattern: `apps/api/src/repository/base.repository.ts`
- Memory hook as pattern reference: `apps/api/src/modules/memory/memory.hook.ts`
- Memory repository as Supabase client pattern reference: `apps/api/src/modules/memory/memory.repository.ts`
- Existing plan schemas (WeeklyPlan, PlanComposeInputSchema): `packages/contracts/src/plan.ts`
- Common errors source: `apps/api/src/common/errors.ts`
- Fastify decorator declarations: `apps/api/src/types/fastify.d.ts`
- Deferred work note for prompt_version: `_bmad-output/implementation-artifacts/deferred-work.md` (line ~482)
- Story 3.4 completion notes for context: `_bmad-output/implementation-artifacts/3-4-agent-tools-recipe-memory-pantry-plan-allergy-cultural-registered-with-maxlatencyms.md`

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

- `pnpm --filter @hivekitchen/contracts exec vitest run src/plan.test.ts` → 38/38 pass
- `pnpm --filter @hivekitchen/api exec vitest run src/modules/plans src/agents/orchestrator src/agents/tools/plan src/common/errors` → 29/29 pass
- `pnpm --filter @hivekitchen/api typecheck` → no new errors in any file touched by this story (3 pre-existing `RequestInfo` errors in `voice.service.test.ts` are unrelated; verified by stashing changes and re-running)
- 1 pre-existing flaky test in `memory/memory.service.test.ts` ("partial seeding…") fails on baseline before any of this story's edits — also unrelated.

### Completion Notes List

- **AC #1** Migration `20260502110000_create_plans_and_plan_items.sql` creates `plans` and `plan_items` with the unique index on `(household_id, week_id)`, the composite index on `plan_items(plan_id, child_id)`, `set_updated_at` triggers, RLS enabled. RLS policies follow the project's `auth.uid()` / `current_household_id` pattern (matches `20260502090000_enable_rls_users_households.sql` and `20260601000000_create_memory_nodes_and_provenance.sql`) rather than the `request.jwt.claims` example in the story body — the project uses the former everywhere. UPDATE/DELETE/INSERT default-deny: no policies on the authenticated role, all writes via service-role.
- **AC #2** `commit_plan(...)` is a `LANGUAGE plpgsql` function called via `supabase.rpc('commit_plan', { p_* })`. Function body upserts the plan row, deletes existing `plan_items` for the plan, then re-inserts every item from the `jsonb` payload — all in one implicit transaction. `PlansRepository.commit()` passes the items array directly (the supabase-js client serializes objects to JSONB, no `JSON.stringify()` needed); the test verifies the exact `p_*` params shape.
- **AC #3** `findByIdForPresentation()` chains `.not('guardrail_cleared_at', 'is', null)` — verified by the repository test asserting that step appears in the chain (and absent from `findByIdForOps()`). `findByIdForOps()` carries `// presentation-bypass: ops-audit` on the query line as the lint exception. `findCurrentByHousehold()` also applies the bind filter and orders by `revision DESC`.
- **AC #4** `PlansService.commit()` runs `allergyGuardrail.clearOrReject()` per attempt; on `cleared` it calls `repository.commit()` with `new Date().toISOString()` + `GUARDRAIL_VERSION` and writes a `plan.generated` audit row whose `stages` array preserves prior `guardrail_rejection` attempts followed by the final `guardrail_verdict.cleared`. On block, it calls `regenerate(rejections)` up to attempts 1→2 and 2→3; after attempt 3 fails, throws `GuardrailRejectionError`. The guardrail receives only `{ child_id, day, slot, ingredients }` — `recipe_id` / `item_id` are dropped because the guardrail evaluates raw ingredient strings.
- **AC #5** `GuardrailRejectionError` is in `apps/api/src/common/errors.ts` (status 422, type `/errors/guardrail-rejection`).
- **AC #6** `PlansService.compose()` still throws `NotImplementedError` — the story body explicitly notes this is correct until Story 3.7 wires the BullMQ job. Tested.
- **AC #7** Typecheck and tests pass for everything in this story's scope.
- **File rename**: `plan.service.ts` → `plans.service.ts`; class `PlanService` → `PlansService`. Updated the orchestrator (`orchestrator.ts`, `orchestrator.hook.ts`, `orchestrator.test.ts`), the `plan.compose` tool factory and its test (`plan.tools.ts`, `plan.tools.test.ts`), and the Fastify decorator types (`fastify.d.ts`).
- **Plugin wiring**: `plansHook` registered in `app.ts` between `allergyGuardrailHook` and `orchestratorHook` (the orchestrator now reads `fastify.plansService` instead of constructing one inline). `orchestratorHook` adds a guard that throws if `plansService` isn't decorated.

### File List

**New:**
- `supabase/migrations/20260502110000_create_plans_and_plan_items.sql`
- `supabase/migrations/20260502111000_create_commit_plan_function.sql`
- `apps/api/src/modules/plans/plans.repository.ts`
- `apps/api/src/modules/plans/plans.repository.test.ts`
- `apps/api/src/modules/plans/plans.service.ts`
- `apps/api/src/modules/plans/plans.service.test.ts`
- `apps/api/src/modules/plans/plans.hook.ts`

**Modified:**
- `apps/api/src/common/errors.ts` (added `GuardrailRejectionError`)
- `apps/api/src/types/fastify.d.ts` (added `plansService: PlansService` decorator + import)
- `apps/api/src/app.ts` (registered `plansHook` between `allergyGuardrailHook` and `orchestratorHook`)
- `apps/api/src/agents/orchestrator.ts` (`PlanService` → `PlansService` import + type)
- `apps/api/src/agents/orchestrator.hook.ts` (drop `PlanService` import / inline construction; pull from `fastify.plansService`; add decorator guard)
- `apps/api/src/agents/orchestrator.test.ts` (`PlanService` → `PlansService` rename throughout, including `buildPlanService` → `buildPlansService` helper + import path)
- `apps/api/src/agents/tools/plan.tools.ts` (`PlanService` → `PlansService` import + type annotation)
- `apps/api/src/agents/tools/plan.tools.test.ts` (`PlanService` → `PlansService` rename + import path)
- `packages/contracts/src/plan.ts` (added `PlanItemWriteSchema`, `CommitPlanInputSchema`, `PlanRowSchema`)
- `packages/contracts/src/plan.test.ts` (added 17 round-trip cases for new schemas)
- `packages/types/src/index.ts` (added `PlanItemWrite`, `CommitPlanInput`, `PlanRow` re-exports)

**Deleted:**
- `apps/api/src/modules/plans/plan.service.ts` (replaced by `plans.service.ts`)

### Review Findings

- [x] [Review][Decision] **commit_plan UPSERT handles `ON CONFLICT (id)` only — unhandled 23505 if a new plan_id is passed for an existing (household_id, week_id) pair** — Fixed: `PlansService.commit()` now calls `repo.findActiveByHouseholdAndWeek()` before the retry loop and overwrites `input.plan_id` with the existing plan's id if found. SQL unchanged.
- [x] [Review][Decision] **Zero-ingredient items pass `PlanItemWriteSchema` but cause `uncertain` verdict from the guardrail engine** — Fixed: `PlanItemWriteSchema.ingredients` now enforces `.min(1)`; service adds early-exit on `'uncertain'` verdict.
- [x] [Review][Decision] **RLS UPDATE/DELETE policies absent — AC1 requires SELECT/UPDATE/DELETE scoped to household_id** — Fixed: added `plans_household_update_policy`, `plans_household_delete_policy`, `plan_items_via_plan_update_policy`, `plan_items_via_plan_delete_policy` to migration.
- [x] [Review][Patch] **`auditService.write()` failure leaves plan committed but unaudited** — Fixed: audit write wrapped in try/catch; failure logs an error but does not propagate to caller. [apps/api/src/modules/plans/plans.service.ts]
- [x] [Review][Patch] **`'uncertain'` guardrail verdict burns all 3 retries on infrastructure failures** — Fixed: explicit `'uncertain'` branch throws `GuardrailRejectionError` immediately after attempt 1. [apps/api/src/modules/plans/plans.service.ts]
- [x] [Review][Patch] **`regenerate()` throw propagates out of the loop without a domain error** — Fixed: `regenerate()` call wrapped in try/catch; throws `GuardrailRejectionError` with actual attempt count. [apps/api/src/modules/plans/plans.service.ts]
- [x] [Review][Patch] **Duplicate `// presentation-bypass: ops-audit` comment in `findByIdForOps`** — Fixed: removed standalone comment above method, inline query-line comment retained. [apps/api/src/modules/plans/plans.repository.ts]
- [x] [Review][Patch] **`GuardrailRejectionError` always reports `MAX_GUARDRAIL_RETRIES` (3) as attempt count** — Fixed: `lastAttempt` variable tracks actual attempt count; post-loop throw uses `lastAttempt`. [apps/api/src/modules/plans/plans.service.ts]
- [x] [Review][Defer] **Concurrent `commit_plan` calls with the same `plan_id` can produce mixed plan_items under READ COMMITTED isolation** [supabase/migrations/20260502111000_create_commit_plan_function.sql] — deferred, pre-existing; current architecture serializes commits through a single API instance; advisory lock would be addressed in Story 3.7 when BullMQ job controls commit scheduling
- [x] [Review][Defer] **Repository read methods cast DB response with `as PlanRow` without running `PlanRowSchema.parse()`** [apps/api/src/modules/plans/plans.repository.ts] — deferred, pre-existing pattern across all repositories in the codebase

## Change Log

| Date       | Author | Note                                                                     |
| ---------- | ------ | ------------------------------------------------------------------------ |
| 2026-05-02 | Menon  | Story 3.5 implementation: plans + plan_items + commit_plan RPC; PlansRepository / PlansService with 3-retry guardrail loop; presentation-bind contract enforced at repository layer; rename plan.service → plans.service; orchestrator pulls plansService from Fastify decorator. |


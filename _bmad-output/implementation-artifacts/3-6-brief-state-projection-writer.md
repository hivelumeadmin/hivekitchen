# Story 3.6: brief_state projection writer

Status: done

## Story

As a developer,
I want the `brief_state` Postgres table maintained by an application writer that updates on `plan.updated`/`memory.updated`/`thread.turn` events,
So that Brief reads are O(1) single-row lookups serving the <3s render SLO and silent staleness is impossible (architecture §1.5).

## Acceptance Criteria

1. **Given** migration creates `brief_state(household_id PK, moment_headline, lumi_note, memory_prose, plan_tile_summaries JSONB, generated_at, plan_revision)`,
   **When** any of the three triggering events fire,
   **Then** `apps/api/src/modules/plans/brief-state.composer.ts` recomposes the projection row idempotently; writes are guarded by `plan_revision` to avoid stale overwrite.

2. **And** `GET /v1/households/:householdId/brief` reads single-row from the projection; never composes at request time.

3. **And** projection write failure logs `error` and emits `brief.projection.failure` audit row but does not block the triggering event.

## Tasks / Subtasks

### Task 1 — Extend audit_event_type enum (AC: #3)

- [x] Create `supabase/migrations/20260502121000_add_brief_projection_failure_event_type.sql`:
  ```sql
  -- Extends the audit_event_type enum used by the audit_log table.
  -- Architecture §4.2: enum extension requires this migration AND the TypeScript
  -- AUDIT_EVENT_TYPES update in audit.types.ts; both must ship together.
  -- Must run AFTER 20260502120000_create_brief_state_projection.sql.
  ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'brief.projection.failure';
  ```

- [x] In `apps/api/src/audit/audit.types.ts`, add `'brief.projection.failure'` to the `AUDIT_EVENT_TYPES` const array. Place it in the `// plan` category (it is plan-adjacent). Both the migration and this TypeScript change ship in the same PR.

### Task 2 — brief_state migration (AC: #1)

- [x] Create `supabase/migrations/20260502120000_create_brief_state_projection.sql`:
  ```sql
  -- One row per household. Maintained by the application writer; never a materialized view.
  -- Architecture §1.5: Tier B projection — O(1) read by household_id for the <3s Brief SLO.
  CREATE TABLE brief_state (
    household_id        UUID PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
    moment_headline     TEXT NOT NULL DEFAULT '',
    lumi_note           TEXT NOT NULL DEFAULT '',
    memory_prose        TEXT NOT NULL DEFAULT '',
    plan_tile_summaries JSONB NOT NULL DEFAULT '[]',
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    plan_revision       INTEGER NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER set_brief_state_updated_at
    BEFORE UPDATE ON brief_state
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

  ALTER TABLE brief_state ENABLE ROW LEVEL SECURITY;

  -- SELECT only: household members can read their own row.
  -- All writes go through the API service-role client (bypasses RLS) — no INSERT/UPDATE policies.
  CREATE POLICY brief_state_select_policy ON brief_state
    FOR SELECT
    USING (
      household_id IN (
        SELECT household_id FROM users WHERE id = auth.uid()
      )
    );
  ```

  > **Critical RLS pattern**: Use `auth.uid()` (matching `20260502090000_create_memory_nodes_and_provenance.sql`). Do NOT use `request.jwt.claims` — the epics mention it but the codebase uses `auth.uid()` throughout. Story 3.5 completion notes confirm this.
  >
  > **Write policies intentionally absent**: All mutations go through the API service-role client. Follow the `memory_nodes` and `plan_items` pattern — no INSERT/UPDATE/DELETE policies on service-role writes.

### Task 3 — Contracts: PlanItemRow, PlanTileSummary, BriefStateRow, BriefResponse (AC: #1, #2)

- [x] Add to `packages/contracts/src/plan.ts` (after Story 3.5's schemas, before the end of the file):
  ```typescript
  // --- Story 3.6 — brief_state projection schemas ---

  export const PlanItemRowSchema = z.object({
    id: z.string().uuid(),
    plan_id: z.string().uuid(),
    child_id: z.string().uuid(),
    day: z.string().min(1).max(SLOT_MAX),
    slot: z.string().min(1).max(SLOT_MAX),
    recipe_id: z.string().uuid().nullable(),
    item_id: z.string().uuid().nullable(),
    ingredients: z.array(z.string().min(1)),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  });
  export type PlanItemRow = z.infer<typeof PlanItemRowSchema>;

  // PlanTileItemSchema is the per-child-slot entry within a day's tile.
  // recipe_id / item_id are optional because the plan item may not have them resolved yet
  // (real recipe resolution lands in Story 3.7 when the planner agent is fully wired).
  const PlanTileItemSchema = z.object({
    child_id: z.string().uuid(),
    slot: z.string().min(1).max(SLOT_MAX),
    ingredients: z.array(z.string().min(1)),
    recipe_id: z.string().uuid().optional(),
    item_id: z.string().uuid().optional(),
  });

  export const PlanTileSummarySchema = z.object({
    day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
    items: z.array(PlanTileItemSchema),
  });
  export type PlanTileSummary = z.infer<typeof PlanTileSummarySchema>;

  export const BriefStateRowSchema = z.object({
    household_id: z.string().uuid(),
    moment_headline: z.string(),
    lumi_note: z.string(),
    memory_prose: z.string(),
    plan_tile_summaries: z.array(PlanTileSummarySchema),
    generated_at: z.string().datetime(),
    plan_revision: z.number().int().min(0),
    updated_at: z.string().datetime(),
  });
  export type BriefStateRow = z.infer<typeof BriefStateRowSchema>;

  // API response shape for GET /v1/households/:id/brief.
  // brief is null when no projection exists yet (no plan committed for this household).
  export const BriefResponseSchema = z.object({
    brief: BriefStateRowSchema.nullable(),
  });
  ```

- [x] Update `packages/contracts/src/index.ts` — add re-exports:
  ```typescript
  export {
    PlanItemRowSchema,
    PlanTileSummarySchema,
    BriefStateRowSchema,
    BriefResponseSchema,
  } from './plan.js';
  export type { PlanItemRow, PlanTileSummary, BriefStateRow } from './plan.js';
  ```

- [x] Update `packages/types/src/index.ts` — follow the existing `z.infer<typeof schema>` re-export pattern. Add:
  ```typescript
  import {
    PlanItemRowSchema,
    PlanTileSummarySchema,
    BriefStateRowSchema,
    // ...existing plan imports
  } from '@hivekitchen/contracts';

  export type PlanItemRow = z.infer<typeof PlanItemRowSchema>;
  export type PlanTileSummary = z.infer<typeof PlanTileSummarySchema>;
  export type BriefStateRow = z.infer<typeof BriefStateRowSchema>;
  ```

- [x] Add round-trip tests in `packages/contracts/src/plan.test.ts` (follow the existing test structure):
  - `PlanItemRowSchema` — valid parse; reject missing `plan_id`; confirm `recipe_id` accepts null
  - `PlanTileSummarySchema` — valid parse; reject unknown day value; confirm `items` array validated
  - `BriefStateRowSchema` — valid parse; confirm `plan_tile_summaries` is validated
  - `BriefResponseSchema` — valid with `null` brief; valid with a complete `BriefStateRow`

### Task 4 — PlansRepository: add findItemsByPlanId (AC: #1)

- [x] Add to `apps/api/src/modules/plans/plans.repository.ts`:
  ```typescript
  // Add import for PlanItemRow at the top:
  import type { CommitPlanInput, PlanRow, PlanItemRow } from '@hivekitchen/types';

  // Add constant:
  const PLAN_ITEM_COLUMNS =
    'id, plan_id, child_id, day, slot, recipe_id, item_id, ingredients, created_at, updated_at';

  // Add method to PlansRepository class:
  async findItemsByPlanId(planId: string): Promise<PlanItemRow[]> {
    const { data, error } = await this.client
      .from('plan_items')
      .select(PLAN_ITEM_COLUMNS)
      .eq('plan_id', planId);
    if (error) throw error;
    return (data ?? []) as PlanItemRow[];
  }
  ```

  > `PlanItemRow` is the read shape (with nullable `recipe_id`/`item_id`). `PlanItemWriteSchema` is the write input. They are NOT the same — do not confuse them.

### Task 5 — BriefStateRepository (AC: #1, #3)

- [x] Create `apps/api/src/modules/plans/brief-state.repository.ts`:
  ```typescript
  import { BaseRepository } from '../../repository/base.repository.js';
  import type { BriefStateRow } from '@hivekitchen/types';
  import type { PlanTileSummary } from '@hivekitchen/types';

  const BRIEF_STATE_COLUMNS =
    'household_id, moment_headline, lumi_note, memory_prose, plan_tile_summaries, generated_at, plan_revision, updated_at';

  export interface BriefStateUpsertInput {
    household_id: string;
    moment_headline: string;
    lumi_note: string;
    memory_prose: string;
    plan_tile_summaries: PlanTileSummary[];
    generated_at: string;
    plan_revision: number;
  }

  export class BriefStateRepository extends BaseRepository {
    async findByHousehold(householdId: string): Promise<BriefStateRow | null> {
      const { data, error } = await this.client
        .from('brief_state')
        .select(BRIEF_STATE_COLUMNS)
        .eq('household_id', householdId)
        .maybeSingle();
      if (error) throw error;
      return (data as BriefStateRow | null) ?? null;
    }

    // Idempotent upsert with application-level plan_revision guard.
    // Skips the write if the stored revision is already >= incoming revision,
    // preventing stale background recompose from clobbering a fresher write.
    // Race condition is benign at single-instance scale; Story 3.7's job queue
    // serializes commits per household (same deferral as PlansService commit_plan advisory lock).
    async upsert(input: BriefStateUpsertInput): Promise<void> {
      const current = await this.findByHousehold(input.household_id);
      if (current && current.plan_revision >= input.plan_revision) {
        return; // stale write — skip
      }
      const { error } = await this.client
        .from('brief_state')
        .upsert(
          { ...input, updated_at: new Date().toISOString() },
          { onConflict: 'household_id' },
        );
      if (error) throw error;
    }
  }
  ```

### Task 6 — BriefStateComposer (AC: #1, #2, #3)

- [x] Create `apps/api/src/modules/plans/brief-state.composer.ts`:
  ```typescript
  import type { FastifyBaseLogger } from 'fastify';
  import type { PlansRepository } from './plans.repository.js';
  import type { BriefStateRepository, BriefStateUpsertInput } from './brief-state.repository.js';
  import type { AuditService } from '../../audit/audit.service.js';
  import type { PlanItemRow, PlanTileSummary } from '@hivekitchen/types';

  export interface BriefStateComposerDeps {
    plansRepository: PlansRepository;
    briefStateRepository: BriefStateRepository;
    auditService: AuditService;
    logger: FastifyBaseLogger;
  }

  const SCHOOL_DAYS = [
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  ] as const;
  type SchoolDay = (typeof SCHOOL_DAYS)[number];

  export class BriefStateComposer {
    private readonly plansRepo: PlansRepository;
    private readonly briefStateRepo: BriefStateRepository;
    private readonly auditService: AuditService;
    private readonly logger: FastifyBaseLogger;

    constructor(deps: BriefStateComposerDeps) {
      this.plansRepo = deps.plansRepository;
      this.briefStateRepo = deps.briefStateRepository;
      this.auditService = deps.auditService;
      this.logger = deps.logger;
    }

    // Called after plan commit, memory update, or thread turn.
    // MUST NOT throw — all errors are caught, logged, and audited.
    // The triggering event always succeeds regardless of projection write outcome.
    async refresh(householdId: string, weekId: string, requestId: string): Promise<void> {
      try {
        // Only guardrail-cleared plans ever populate the projection (presentation-bind contract).
        const plan = await this.plansRepo.findCurrentByHousehold({ householdId, weekId });
        if (!plan) {
          this.logger.debug(
            { household_id: householdId, week_id: weekId },
            'brief_state refresh skipped — no cleared plan found for this week',
          );
          return;
        }

        const items = await this.plansRepo.findItemsByPlanId(plan.id);
        const upsertInput: BriefStateUpsertInput = {
          household_id: householdId,
          moment_headline: '', // stub — Story 3.7 wires LLM-generated planner output
          lumi_note: '',       // stub — Story 3.7 wires LLM-generated planner output
          memory_prose: '',    // stub — Story 5.11 wires memory prose composition
          plan_tile_summaries: this.buildTileSummaries(items),
          generated_at: new Date().toISOString(),
          plan_revision: plan.revision,
        };

        await this.briefStateRepo.upsert(upsertInput);

        this.logger.info(
          { household_id: householdId, plan_id: plan.id, revision: plan.revision },
          'brief_state projection refreshed',
        );
      } catch (err) {
        this.logger.error(
          { household_id: householdId, week_id: weekId, err },
          'brief_state projection refresh failed',
        );
        try {
          await this.auditService.write({
            event_type: 'brief.projection.failure',
            household_id: householdId,
            request_id: requestId,
            metadata: {
              week_id: weekId,
              error: err instanceof Error ? err.message : String(err),
            },
          });
        } catch (auditErr) {
          this.logger.error(
            { household_id: householdId, auditErr },
            'audit write failed for brief.projection.failure',
          );
        }
      }
    }

    private buildTileSummaries(items: PlanItemRow[]): PlanTileSummary[] {
      const byDay = new Map<SchoolDay, PlanTileSummary['items']>();
      for (const item of items) {
        if (!SCHOOL_DAYS.includes(item.day as SchoolDay)) continue;
        const day = item.day as SchoolDay;
        const existing = byDay.get(day) ?? [];
        existing.push({
          child_id: item.child_id,
          slot: item.slot,
          ingredients: item.ingredients,
          ...(item.recipe_id != null ? { recipe_id: item.recipe_id } : {}),
          ...(item.item_id != null ? { item_id: item.item_id } : {}),
        });
        byDay.set(day, existing);
      }
      return SCHOOL_DAYS
        .filter((day) => byDay.has(day))
        .map((day) => ({ day, items: byDay.get(day)! }));
    }
  }
  ```

### Task 7 — PlansService: add getBrief + briefStateComposer wiring (AC: #2, #3)

- [x] Update `apps/api/src/modules/plans/plans.service.ts`:

  **Imports to add:**
  ```typescript
  import type { BriefStateComposer } from './brief-state.composer.js';
  import type { BriefStateRepository } from './brief-state.repository.js';
  import type { BriefStateRow } from '@hivekitchen/types';
  ```

  **Update `PlansServiceDeps`:**
  ```typescript
  export interface PlansServiceDeps {
    repository: PlansRepository;
    briefStateRepository: BriefStateRepository; // NEW
    briefStateComposer: BriefStateComposer;     // NEW
    allergyGuardrail: AllergyGuardrailService;
    auditService: AuditService;
    logger: FastifyBaseLogger;
  }
  ```

  **Constructor additions:**
  ```typescript
  private readonly briefStateRepo: BriefStateRepository;
  private readonly briefStateComposer: BriefStateComposer;

  constructor(deps: PlansServiceDeps) {
    this.repo = deps.repository;
    this.briefStateRepo = deps.briefStateRepository;    // NEW
    this.briefStateComposer = deps.briefStateComposer;  // NEW
    // ...existing assignments
  }
  ```

  **Add `getBrief` method (reads projection; never composes at call time):**
  ```typescript
  async getBrief(householdId: string): Promise<BriefStateRow | null> {
    return this.briefStateRepo.findByHousehold(householdId);
  }
  ```

  **In `commit()`, after the `await this.repo.commit(current, clearedAt, GUARDRAIL_VERSION)` line:**
  ```typescript
  // Refresh projection — awaited but non-blocking (composer catches errors internally).
  // commit() still returns planId even if the projection write fails.
  await this.briefStateComposer.refresh(current.household_id, current.week_id, requestId);
  ```

  Place the `refresh()` call BEFORE the `audit.service.write()` block so failures in projection
  do not interfere with the audit write path. The try/catch around `auditService.write()` is
  unchanged.

### Task 8 — Plans hook: construct and decorate briefStateComposer (AC: #1, #2, #3)

- [x] Update `apps/api/src/modules/plans/plans.hook.ts`:

  **Imports to add:**
  ```typescript
  import { BriefStateRepository } from './brief-state.repository.js';
  import { BriefStateComposer } from './brief-state.composer.js';
  ```

  **Inside the plugin body:**
  ```typescript
  const repository = new PlansRepository(fastify.supabase);
  const briefStateRepository = new BriefStateRepository(fastify.supabase);
  const briefStateComposer = new BriefStateComposer({
    plansRepository: repository,
    briefStateRepository,
    auditService: fastify.auditService,
    logger: fastify.log,
  });
  const plansService = new PlansService({
    repository,
    briefStateRepository,
    briefStateComposer,
    allergyGuardrail: fastify.allergyGuardrailService,
    auditService: fastify.auditService,
    logger: fastify.log,
  });
  fastify.decorate('plansService', plansService);
  fastify.decorate('briefStateComposer', briefStateComposer); // exposed for future memory/thread triggers
  ```

  > Add the decorator guard:
  > ```typescript
  > if (fastify.hasDecorator('briefStateComposer')) {
  >   throw new Error('briefStateComposer already decorated — check plugin registration order');
  > }
  > ```

- [x] Update `apps/api/src/types/fastify.d.ts`:

  **Add import:**
  ```typescript
  import type { BriefStateComposer } from '../modules/plans/brief-state.composer.js';
  ```

  **Add to `FastifyInstance` interface:**
  ```typescript
  briefStateComposer: BriefStateComposer;
  ```

### Task 9 — GET /v1/households/:householdId/brief route (AC: #2)

- [x] Add to `apps/api/src/modules/households/households.routes.ts`:

  **Add imports at top:**
  ```typescript
  import { BriefResponseSchema } from '@hivekitchen/contracts';
  ```

  **Add route inside the `householdsRoutesPlugin` async function:**
  ```typescript
  const requireParentOrCaregiver = authorize(['primary_parent', 'secondary_caregiver']);

  fastify.get(
    '/v1/households/:householdId/brief',
    {
      preHandler: requireParentOrCaregiver,
      schema: {
        params: z.object({ householdId: z.string().uuid() }),
        response: { 200: BriefResponseSchema },
      },
    },
    async (request, reply) => {
      const { householdId } = request.params as { householdId: string };
      // Scope guard: users can only read their own household's brief.
      if (householdId !== request.user.household_id) {
        return reply.status(403).send({
          type: '/errors/forbidden',
          status: 403,
          title: 'Forbidden',
          detail: 'Cannot access another household brief',
        });
      }
      const brief = await fastify.plansService.getBrief(householdId);
      return { brief };
    },
  );
  ```

  > Import `z` from `'zod'` if not already imported in this file. The `authorize` helper is already imported (`import { authorize } from '../../middleware/authorize.hook.js'`).
  >
  > Do NOT call `briefStateComposer.refresh()` from this route handler. The projection is read-only here — never composed on request.

### Task 10 — Tests (AC: all)

- [x] Create `apps/api/src/modules/plans/brief-state.composer.test.ts`:
  - `refresh()` — finds cleared plan, reads items, builds tile summaries, calls `upsert()`
  - `refresh()` — returns early when `findCurrentByHousehold()` returns `null` (no cleared plan)
  - `refresh()` — when `findItemsByPlanId()` throws, catches error, logs, writes audit `brief.projection.failure`, does NOT rethrow
  - `refresh()` — when `upsert()` throws, same error-handling path as above
  - `refresh()` — when audit write also throws in the error path, logs the secondary error without rethrowing
  - `buildTileSummaries` (via `refresh()`) — items grouped correctly by day; non-school days skipped; days with items ordered Mon→Fri

  > Test pattern: use Vitest `vi.fn()` mocks for `PlansRepository`, `BriefStateRepository`, and `AuditService`. Each test builds a `BriefStateComposer` with injected mocks. Follow the mock patterns in `apps/api/src/modules/plans/plans.service.test.ts`.

- [x] Add round-trip tests in `packages/contracts/src/plan.test.ts` for:
  - `PlanItemRowSchema` — valid parse; `recipe_id: null` accepted; missing `plan_id` rejected
  - `PlanTileSummarySchema` — valid parse; unknown `day` value rejected
  - `BriefStateRowSchema` — valid parse with `plan_tile_summaries: []`; invalid tile rejected
  - `BriefResponseSchema` — `{ brief: null }` valid; `{ brief: <valid row> }` valid

- [x] Run: `pnpm --filter @hivekitchen/api typecheck` — zero new errors
- [x] Run: `pnpm --filter @hivekitchen/api exec vitest run src/modules/plans/brief-state` — all tests pass
- [x] Run: `pnpm --filter @hivekitchen/contracts test` — all tests pass

---

## Dev Notes

### Critical — audit_event_type Postgres enum must be extended before TypeScript code ships

Architecture §4.2: "Adding an event_type requires extending the `audit_event_type` Postgres enum (a migration) AND extending the TypeScript enum mirror in `audit.types.ts`. Both ship together."

The migration `20260502121000_add_brief_projection_failure_event_type.sql` runs at DB deploy. The TypeScript `AUDIT_EVENT_TYPES` array update runs at app deploy. If the TypeScript side ships before the DB migration, Postgres will reject `INSERT INTO audit_log ... WHERE event_type = 'brief.projection.failure'` with a type violation. Do NOT add only the TypeScript change.

`ALTER TYPE ... ADD VALUE IF NOT EXISTS` is idempotent — safe to re-run. Postgres 12+ supports this inside a transaction (Supabase uses PG14+).

### Critical — BriefStateComposer MUST NOT throw

`BriefStateComposer.refresh()` catches ALL exceptions internally. This is not optional — the AC explicitly states the projection write failure must not block the triggering event. The pattern:
1. Outer try/catch wraps ALL repo operations
2. On error: `logger.error(...)` then write `brief.projection.failure` audit row
3. Inner try/catch around the audit write (in case the audit DB is also down)
4. Return normally (never rethrow)

In `PlansService.commit()`, `await this.briefStateComposer.refresh(...)` is called — it is safe to await because the composer swallows its own errors. The plan commit return value (`planId`) is never conditional on the projection write.

### Critical — moment_headline, lumi_note, and memory_prose are stubs

Set all three to `''` (empty string) in `BriefStateComposer.refresh()`. Real content lands in later stories:
- `moment_headline` / `lumi_note`: Story 3.7 wires the planner agent result (from `PLANNER_PROMPT`) into the commit flow
- `memory_prose`: Story 5.11 wires the memory prose composition from `memory_nodes`

Do NOT add LLM calls or memory queries to the composer in this story. The empty-string defaults are the correct initial state.

### Critical — RLS pattern: auth.uid(), NOT request.jwt.claims

The epics AC mentions `request.jwt.claims` in the context of the plans migration, but the codebase's actual RLS policies use `auth.uid()`. Story 3.5 completion notes confirm:

> "RLS policies follow the project's `auth.uid()` / `current_household_id` pattern (matches `20260502090000_enable_rls_users_households.sql` and `20260601000000_create_memory_nodes_and_provenance.sql`) rather than the `request.jwt.claims` example in the story body"

Use:
```sql
USING (household_id IN (SELECT household_id FROM users WHERE id = auth.uid()))
```

NOT `request.jwt.claims`.

### Critical — Write policies intentionally absent on brief_state

No INSERT/UPDATE/DELETE RLS policies. All writes to `brief_state` go through the API service-role client (same as `memory_nodes`, `plan_items`). The service-role client bypasses RLS. Adding write policies would require every write to run under a household-scoped JWT, which is not the current architecture for service-to-DB writes.

### Critical — Only guardrail-cleared plans update the projection

`PlansRepository.findCurrentByHousehold()` enforces `.not('guardrail_cleared_at', 'is', null)`. The composer calls this method. If a plan hasn't cleared the allergy guardrail, `findCurrentByHousehold()` returns `null` and the composer returns early without writing. This is correct per the presentation-bind contract: the Brief must NEVER show data derived from a pre-clearance plan.

### Critical — plan_revision guard prevents stale overwrite; TOCTOU deferred

The `BriefStateRepository.upsert()` does a read-then-write to check `plan_revision`. This has a TOCTOU race: two concurrent writes for the same household could both read a stale revision and both write. Story 3.5 deferred the same race (advisory lock on the commit flow) to Story 3.7. Story 3.6 defers the concurrent brief-state write race to Story 3.7 as well, since Story 3.7's BullMQ job will serialize commits per household anyway. Document in a deferred-work note.

### Critical — PlanItemRow vs PlanItemWriteSchema are different shapes

`PlanItemWriteSchema` (Story 3.5) is the write input: `recipe_id?: string` (optional, never null).
`PlanItemRowSchema` (Story 3.6) is the read output from DB: `recipe_id: string | null` (nullable, DB returns null not undefined).

Do NOT try to use `PlanItemWriteSchema` for repository reads. Add `PlanItemRow` as a new type in contracts.

### Architecture — Only plan.updated trigger is wired in Story 3.6

Architecture §1.5 says the composer refreshes on three events: `plan.updated`, `memory.updated`, `thread.turn`. Story 3.6 wires only `plan.updated` (via `PlansService.commit()`). The other two are deferred:

- `memory.updated` → `MemoryService` calls `fastify.briefStateComposer.refresh()` in Story 5.11
- `thread.turn` → thread turn handler calls `fastify.briefStateComposer.refresh()` in a future Epic 5 story

This is why `briefStateComposer` is registered as a Fastify decorator — so future stories can access it from `fastify.briefStateComposer` without coupling to the plans module.

### Architecture — GET /v1/households/:id/brief never composes at request time

This is a hard rule from architecture §1.5. The handler calls `plansService.getBrief(householdId)` which is a single-row SELECT from `brief_state`. It does NOT:
- Call `briefStateComposer.refresh()`
- Join with `plans`, `plan_items`, or `memory_nodes`
- Run any LLM inference

If the `brief_state` row doesn't exist (no plan committed yet), return `{ brief: null }`. The frontend handles the empty state.

### Architecture — brief.updated SSE event is NOT part of this story

The integration path shows: "commit → `brief-state.composer` updates projection → SSE `plan.updated` to any connected clients." The SSE `plan.updated` emission is Story 3.7's responsibility (the BullMQ job is the trigger point that also drives SSE). The current SSE route (`events.routes.ts`) is a stub from Story 1.10 with no real fan-out (Redis pub/sub is Story 5.2). Do NOT add SSE emission in Story 3.6.

### Architecture — brief_state row is nullable until first plan commit

The `BriefResponseSchema` wraps `brief` as `.nullable()`. Before any plan has been committed and cleared for a household, `GET /v1/households/:id/brief` returns `{ brief: null }`. The frontend `<BriefCanvas>` must render an empty/skeleton state when `brief === null`.

### Pattern — BriefStateRepository extends BaseRepository

```typescript
export class BriefStateRepository extends BaseRepository {
  // constructor inherited: constructor(protected readonly client: SupabaseClient) {}
}
```

Import: `import { BaseRepository } from '../../repository/base.repository.js';` (`.js` extension required for ESM in `apps/api`).

### Pattern — buildTileSummaries groups plan_items by day

The `plan_items` table has one row per child × day × slot combination. For the same plan_id, Monday lunch for Child A and Monday lunch for Child B are two rows with `day = 'monday'`. The composer groups them into one `PlanTileSummary` with two `items` entries.

SCHOOL_DAYS order (`monday`→`friday`) is the canonical display order. Days with no items (e.g., school holiday) are omitted from the array.

### Pattern — refresh() call site in PlansService.commit()

Place `await this.briefStateComposer.refresh(current.household_id, current.week_id, requestId)` immediately AFTER `await this.repo.commit(current, clearedAt, GUARDRAIL_VERSION)` and BEFORE the `try { await this.auditService.write(...) }` block. This preserves the commit → projection → audit sequence. The audit write already has its own try/catch; the composer's try/catch is independent.

### Project Structure — New and Modified Files

**New files:**
```
supabase/migrations/
  20260502120000_create_brief_state_projection.sql
  20260502121000_add_brief_projection_failure_event_type.sql

apps/api/src/modules/plans/
  brief-state.repository.ts
  brief-state.composer.ts
  brief-state.composer.test.ts
```

**Modified files:**
```
apps/api/src/modules/plans/
  plans.repository.ts       + findItemsByPlanId() + PlanItemRow import + PLAN_ITEM_COLUMNS const
  plans.service.ts          + getBrief() + briefStateRepository + briefStateComposer deps
                              + refresh() call in commit() after repo.commit()
  plans.hook.ts             + BriefStateRepository + BriefStateComposer construction
                              + fastify.decorate('briefStateComposer', ...)

apps/api/src/audit/
  audit.types.ts            + 'brief.projection.failure' in AUDIT_EVENT_TYPES

apps/api/src/types/
  fastify.d.ts              + import BriefStateComposer
                              + briefStateComposer: BriefStateComposer in FastifyInstance

apps/api/src/modules/households/
  households.routes.ts      + GET /v1/households/:householdId/brief route
                              + import BriefResponseSchema from '@hivekitchen/contracts'

packages/contracts/src/
  plan.ts                   + PlanItemRowSchema, PlanTileSummarySchema, BriefStateRowSchema,
                              BriefResponseSchema, PlanTileItemSchema (not exported)
  plan.test.ts              + round-trip tests for new schemas
  index.ts                  + re-exports for new schemas and types

packages/types/src/
  index.ts                  + PlanItemRow, PlanTileSummary, BriefStateRow re-exports
```

**Unchanged:**
- `supabase/migrations/20260502110000_create_plans_and_plan_items.sql` — Story 3.5; no changes
- `supabase/migrations/20260502111000_create_commit_plan_function.sql` — Story 3.5; no changes
- `apps/api/src/agents/` — no changes; `plan.compose` still throws `NotImplementedError`
- `apps/api/src/modules/allergy-guardrail/` — no changes
- `apps/api/src/app.ts` — no changes needed; `plansHook` already registered

### Story 3.7 Handoff

When Story 3.7 implements the BullMQ plan-generation job:
- The job calls `PlansService.commit(input, requestId, regenerate)` as today
- `commit()` already calls `briefStateComposer.refresh()` after the repo write
- Story 3.7 also emits the SSE `plan.updated` event after the projection update
- `moment_headline` and `lumi_note` are populated by extracting the planner agent's headline output from the `WeeklyPlan` shape returned by `orchestrator.planWeek()` — at that point, `BriefStateComposer.refresh()` receives them as parameters (API change to `refresh()` signature) or they're written by the caller before `commit()` is called. Story 3.7 resolves this design detail.

### References

- Architecture §1.5 — Tier B `brief_state` projection design (line ~308)
- Architecture §4.2 — audit event taxonomy; enum extension pattern (line ~758)
- Architecture §5.1 — error handling; services throw domain errors only (line ~779)
- Architecture integration path (line ~1391): `GET /v1/households/:id/brief → plans.service.getBrief`
- Architecture migration list (line ~1010): `20260502120000_create_brief_state_projection.sql`
- Story 3.5 completion notes §Story 3.6 Handoff: `_bmad-output/implementation-artifacts/3-5-plan-repository-revision-versioning-presentation-bind-contract.md`
- Story 3.5 completion notes — RLS uses `auth.uid()` pattern, confirmed
- `BaseRepository` pattern: `apps/api/src/repository/base.repository.ts`
- `PlansRepository` as Supabase client pattern: `apps/api/src/modules/plans/plans.repository.ts`
- `PlansService.commit()` as integration point: `apps/api/src/modules/plans/plans.service.ts`
- `plans.hook.ts` as Fastify plugin pattern: `apps/api/src/modules/plans/plans.hook.ts`
- `audit.types.ts` AUDIT_EVENT_TYPES array: `apps/api/src/audit/audit.types.ts`
- `fastify.d.ts` decorator declarations: `apps/api/src/types/fastify.d.ts`
- `households.routes.ts` route/auth pattern: `apps/api/src/modules/households/households.routes.ts`
- Epics Story 3.6 spec: `_bmad-output/planning-artifacts/epics.md` (line 1239)
- `PlanUpdatedEvent` and `InvalidationEvent` contract: `packages/contracts/src/events.ts`

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- `pnpm --filter @hivekitchen/contracts exec vitest run src/plan.test.ts` → 52/52 pass (incl. 14 new round-trip tests).
- `pnpm --filter @hivekitchen/api exec vitest run src/modules/plans/brief-state` → 6/6 BriefStateComposer tests pass.
- `pnpm --filter @hivekitchen/api exec vitest run src/modules/plans` → 27/27 plans-module tests pass (no regressions in PlansService / PlansRepository).
- `pnpm --filter @hivekitchen/api exec vitest run src/modules/households` → 12/12 households-module tests pass.
- `pnpm --filter @hivekitchen/api typecheck` → zero new errors. Pre-existing failures unrelated to Story 3.6 remain (`plans.service.test.ts` line ~332 — `verdict: 'uncertain'` discriminated-union missing `reason`; `voice.service.test.ts` `RequestInfo` global), confirmed by stash-comparison test on a clean working tree.
- `pnpm --filter @hivekitchen/api test` → 1 pre-existing failure in `memory.service.test.ts` (`MemoryService.seedFromOnboarding > partial seeding`); confirmed pre-existing — not introduced by Story 3.6.

### Completion Notes List

- Implemented all 10 tasks from the story spec, satisfying AC #1, #2, and #3.
- **AC #1**: `brief_state(household_id PK, moment_headline, lumi_note, memory_prose, plan_tile_summaries JSONB, generated_at, plan_revision)` migration created. `BriefStateComposer.refresh()` recomposes idempotently. Stale-overwrite guard implemented in `BriefStateRepository.upsert()` via read-then-write `plan_revision >= incoming` skip; the inherent TOCTOU race is documented and deferred to Story 3.7's BullMQ per-household serialization.
- **AC #2**: `GET /v1/households/:householdId/brief` route added; reads single-row from `brief_state` via `PlansService.getBrief()`. Never composes at request time. Forbidden-cross-household check uses domain `ForbiddenError` (the global error handler maps it to RFC 7807 problem+JSON), keeping the route's 200-response schema valid for fastify-type-provider-zod.
- **AC #3**: `BriefStateComposer.refresh()` wraps every repo call in a try/catch; on failure logs `error` and writes `brief.projection.failure` audit row with a nested try/catch around the audit write. The triggering `PlansService.commit()` flow always returns `planId` regardless of projection-write outcome (verified by the awaited but non-throwing call site).
- **RLS pattern**: brief_state RLS uses the codebase pattern `household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())`, matching `memory_nodes` and `plans`. Story spec snippet referenced an alternate `IN (...)` form; codebase precedent wins (Story 3.5 completion notes confirm this).
- **Stub fields**: `moment_headline`, `lumi_note`, `memory_prose` written as `''` per spec — to be wired in Story 3.7 (planner agent output) and Story 5.11 (memory prose composer).
- **Trigger coverage in this story**: Only `plan.updated` is wired (via `PlansService.commit()`). `memory.updated` and `thread.turn` are deferred to Stories 5.11 / Epic 5; the composer is registered as a Fastify decorator (`fastify.briefStateComposer`) so future stories can call `refresh()` without coupling to the plans module.
- **Audit enum extension**: SQL migration `20260502121000_add_brief_projection_failure_event_type.sql` and TypeScript `AUDIT_EVENT_TYPES` array updated together (architecture §4.2 invariant).
- **Re-export pattern**: `packages/contracts/src/index.ts` already uses `export * from './plan.js'`, so the new schemas are automatically available downstream — no edit needed there. `packages/types/src/index.ts` was extended with explicit `z.infer` exports following the existing per-schema pattern.
- **Test test fixture**: `plans.service.test.ts` was extended with `buildBriefStateRepo()` / `buildBriefStateComposer()` helpers and threaded into all five `new PlansService({...})` constructions to keep the existing happy-path / failure-path coverage intact.

### File List

**New files:**

- `supabase/migrations/20260502120000_create_brief_state_projection.sql`
- `supabase/migrations/20260502121000_add_brief_projection_failure_event_type.sql`
- `apps/api/src/modules/plans/brief-state.repository.ts`
- `apps/api/src/modules/plans/brief-state.composer.ts`
- `apps/api/src/modules/plans/brief-state.composer.test.ts`

**Modified files:**

- `apps/api/src/audit/audit.types.ts` — added `'brief.projection.failure'` to `AUDIT_EVENT_TYPES`.
- `apps/api/src/modules/plans/plans.repository.ts` — added `PLAN_ITEM_COLUMNS`, `findItemsByPlanId()`, and `PlanItemRow` import.
- `apps/api/src/modules/plans/plans.service.ts` — `briefStateRepository` + `briefStateComposer` deps; `getBrief()`; `briefStateComposer.refresh()` call inside `commit()` after `repo.commit()`.
- `apps/api/src/modules/plans/plans.service.test.ts` — added `buildBriefStateRepo()` / `buildBriefStateComposer()` helpers; threaded into all `new PlansService({...})` constructions.
- `apps/api/src/modules/plans/plans.hook.ts` — constructs `BriefStateRepository` + `BriefStateComposer`; decorates `briefStateComposer`; pre-decorate guard.
- `apps/api/src/types/fastify.d.ts` — added `briefStateComposer: BriefStateComposer` to `FastifyInstance`.
- `apps/api/src/modules/households/households.routes.ts` — added `GET /v1/households/:householdId/brief`; imports `BriefResponseSchema`, `ForbiddenError`, `z`.
- `packages/contracts/src/plan.ts` — added `PlanItemRowSchema`, `PlanTileItemSchema` (private), `PlanTileSummarySchema`, `BriefStateRowSchema`, `BriefResponseSchema`.
- `packages/contracts/src/plan.test.ts` — added 14 round-trip tests across the four new schemas.
- `packages/types/src/index.ts` — added `PlanItemRow`, `PlanTileSummary`, `BriefStateRow`, `BriefResponse` `z.infer` exports.

### Change Log

| Date       | Change                                                                                                       | Author           |
| ---------- | ------------------------------------------------------------------------------------------------------------ | ---------------- |
| 2026-05-02 | Story 3.6 implemented: brief_state migration, repository, composer, GET /brief route, contracts, tests; status → review. | claude-opus-4-7 |

### Review Findings

- [x] [Review][Decision] `PlanItemRowSchema.day` uses `z.string()` instead of a school-day enum — is this intentional for the raw DB read shape, or should it be `z.enum([...SCHOOL_DAYS])`? `buildTileSummaries` silently drops non-school-day values; a loose schema means a misspelled day (e.g. `'Monday'`, `'mon'`) causes silent data loss in the projection rather than a validation error at the boundary. [`packages/contracts/src/plan.ts`]
- [x] [Review][Patch] `buildTileSummaries` non-null assertion `byDay.get(day)!` should use `?? []` fallback — logically safe but relies on implicit coupling between the `.filter` and `.map` that TypeScript cannot verify statically. [`apps/api/src/modules/plans/brief-state.composer.ts:124`]
- [x] [Review][Patch] Missing test: `GET /v1/households/:householdId/brief` scope guard (`householdId !== request.user.household_id`) has no test coverage — a reversed condition would not be caught. [`apps/api/src/modules/households/households.routes.ts:135-152`]
- [x] [Review][Patch] Missing test: `buildTileSummaries` with empty `items` array (zero-item plan should return `plan_tile_summaries: []`, not cause an error). [`apps/api/src/modules/plans/brief-state.composer.test.ts`]
- [x] [Review][Defer] TOCTOU race in `BriefStateRepository.upsert()` — read-then-write revision check is not atomic; two concurrent commits can both pass the guard and both write, last-write wins. Documented in code; deferred to Story 3.7's BullMQ per-household advisory lock. [`apps/api/src/modules/plans/brief-state.repository.ts:35-47`] — deferred, pre-existing
- [x] [Review][Defer] `plansService` decorator missing startup guard — `fastify.plansService.getBrief()` called at request time in `householdsRoutes` with no boot-time `hasDecorator()` guard. Registration order in `app.ts` is the implicit contract; fragile if order ever changes. [`apps/api/src/modules/households/households.routes.ts:149`] — deferred, pre-existing
- [x] [Review][Defer] `generated_at` uses Node.js clock (`new Date().toISOString()`) rather than DB `now()` — benign at single-instance scale; could produce inconsistent ordering in a multi-instance deployment. Address in a hardening pass when horizontal scaling is introduced. [`apps/api/src/modules/plans/brief-state.composer.ts:72`] — deferred, pre-existing

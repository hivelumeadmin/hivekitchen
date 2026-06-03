# Story 3-DM-E1: Adjacent table cleanup — day_overrides rename + enum trim + final pass

Status: done

## Story

As Epic 3 data-model solutioning,
We want to rename `day_overrides` → `plan_day_context`, trim the pause-overlapping enum values, drop the stale flat methods from the repository, and batch any remaining small cleanup items,
So that the canonical model is fully consistent, table names match their purpose, and the codebase contains zero references to `day_overrides` / `DayOverride` / `override_type`.

## Acceptance Criteria

1. **`day_overrides` table renamed to `plan_day_context`.** RLS policies and indexes follow the rename automatically; no orphan references remain.

2. **`day_override_type` enum REPLACED with `plan_day_context_type`** containing only:
   `'half_day'`, `'field_trip'`, `'post_dentist'`, `'early_release'`, `'sport_practice'`, `'test_day'`

3. **Pause-overlapping values REMOVED.** `'bag_suspended'` and `'sick_day'` no longer exist in the enum or any schema.

4. **`override_type` column renamed to `context_type`** on the `plan_day_context` table.

5. **`recipes.instructions` column dropped if present** (defensive `DROP COLUMN IF EXISTS`; A1 should have already removed it — no references remain in the codebase per scan).

6. **`plan_slots.main_assignment_id` FK gains `ON DELETE CASCADE`.** The C1 migration created the FK with no `ON DELETE` action (defaults to RESTRICT). Adding CASCADE closes the deletion-order gap documented in `scripts/clear-load-test-plans.ts`. Use CASCADE (not SET NULL) because a `slot_kind='main'` CHECK requires `main_assignment_id IS NOT NULL` — SET NULL would violate the check.

7. **Repository + service files renamed and class names updated.** Flat (plan_item_id-based) methods removed from the repository. Tree-shape methods become the canonical (unprefixed) API.

8. **Contracts + types renamed.** `DayOverrideTypeSchema` → `PlanDayContextTypeSchema`; `DayOverrideSchema` → `PlanDayContextSchema`; field `override_type` → `context_type`; field `plan_item_id` → `plan_slot_id`; `SetDayOverrideInputSchema` → `SetPlanDayContextInputSchema`.

9. **All consumers updated.** `grep -rn "day_overrides\|DayOverride\|override_type\|day_override_type\|DayOverridesService\|DayOverridesRepository" apps/ packages/ scripts/` returns 0 meaningful hits.

10. **Tests pass at new baseline.** 3 pre-existing failures in `day-overrides.repository.test.ts` are eliminated (those 3 tests tested the stale flat `upsert()` and are deleted). Net API test failures: ≤19 (was 22 — removes 3 day-overrides.repository failures).

11. **`scripts/clear-load-test-plans.ts` simplified.** The manual deletion-order workaround comment is removed; the script simplifies to a single `DELETE FROM plans WHERE household_id = '...'` after confirming the full cascade chain.

## Dependencies & Context

**Predecessor:** 3-DM-D1 (done 2026-06-02). C1 migration `20261010000000` truncated and retargeted `day_overrides` (plan_item_id → plan_slot_id), but did NOT rename the table or slim the enum.

**Parallel-safe with:** nothing. D1 is done; E1 is the final phase.

**What C1/C2 left for E1:**
- `day_overrides` table still exists with the old name and the full 8-value enum.
- `day-overrides.repository.ts` still has flat methods (`upsert()`, `revert()`, `confirm()`, `findActiveById()`, `findActivePausingForChildOnDate()`, `findActiveByHousehold()`) that reference `plan_item_id` — a column dropped in C1. These cause 3 test failures (see Task 8).
- The tree-shape methods have `Tree` suffix: `upsertTree`, `revertTree`, `findActiveByIdTree`.
- `DayOverrideSchema` still has `plan_item_id` (flat field, stale post-C1 tree retarget).
- `plan_slots.main_assignment_id` FK has no `ON DELETE` action; `scripts/clear-load-test-plans.ts` deletes plan_days/plan_main_assignments/plans in explicit order to work around it.
- Service-level explicit rejection of `bag_suspended`/`sick_day` exists in `setOverrideTree()` (ConflictError path) — redundant after the enum narrows.

**Downstream blockers:** None. E1 is the final phase of the 3-DM sprint.

**Key invariants:**
- Table rename is cosmetic; semantics are unchanged.
- Pause-overlapping enum values were doing two jobs; canonical model splits them — `plan_days.paused_at` / `paused_reason` owns the pause grain. E1 finishes the split by trimming the enum.
- `early_release` stays in the enum (event-only; no composition/pause effect).

## Tasks / Subtasks

### Task 1 — DB migration

**File:** `supabase/migrations/20261012000000_plan_day_context_rename.sql`

```sql
-- Story 3-DM-E1 — Adjacent table cleanup.
--
-- 1. Rename day_overrides → plan_day_context
-- 2. Replace day_override_type enum with plan_day_context_type (drop bag_suspended, sick_day)
-- 3. Rename override_type column → context_type
-- 4. Drop recipes.instructions if still present (defensive)
-- 5. Fix plan_slots.main_assignment_id FK: add ON DELETE CASCADE

-- 1. Rename table.
ALTER TABLE day_overrides RENAME TO plan_day_context;

-- 2a. Create new enum with only the composition-context values.
CREATE TYPE plan_day_context_type AS ENUM (
  'half_day', 'field_trip', 'post_dentist',
  'early_release', 'sport_practice', 'test_day'
);

-- 2b. Guard: delete any rows with pause-overlapping values before the type swap.
-- C1 already migrated bag_suspended/sick_day rows to plan_days.paused_at;
-- this is defensive cleanup for any dev-environment stragglers.
DELETE FROM plan_day_context WHERE override_type IN ('bag_suspended', 'sick_day');

-- 2c. Swap the column type.
ALTER TABLE plan_day_context
  ALTER COLUMN override_type TYPE plan_day_context_type
  USING override_type::text::plan_day_context_type;

-- 3. Rename the column.
ALTER TABLE plan_day_context RENAME COLUMN override_type TO context_type;

-- 2d. Drop old enum (after the column type swap succeeds).
DROP TYPE day_override_type;

-- 4. Defensive drop of recipes.instructions (should be gone from A1).
ALTER TABLE recipes DROP COLUMN IF EXISTS instructions;

-- 5a. Verify constraint name before dropping.
--     Postgres generates: plan_slots_main_assignment_id_fkey
--     Confirm with: SELECT constraint_name FROM information_schema.table_constraints
--                   WHERE table_name = 'plan_slots' AND constraint_type = 'FOREIGN KEY';
--     If different, update the DROP + ADD below.
ALTER TABLE plan_slots
  DROP CONSTRAINT plan_slots_main_assignment_id_fkey,
  ADD CONSTRAINT plan_slots_main_assignment_id_fkey
    FOREIGN KEY (main_assignment_id)
    REFERENCES plan_main_assignments(id)
    ON DELETE CASCADE;

-- Down (best-effort dev rollback):
-- ALTER TABLE plan_slots
--   DROP CONSTRAINT plan_slots_main_assignment_id_fkey,
--   ADD CONSTRAINT plan_slots_main_assignment_id_fkey
--     FOREIGN KEY (main_assignment_id) REFERENCES plan_main_assignments(id);
-- ALTER TABLE plan_day_context RENAME COLUMN context_type TO override_type;
-- CREATE TYPE day_override_type AS ENUM (
--   'bag_suspended','half_day','field_trip','sick_day',
--   'post_dentist','early_release','sport_practice','test_day'
-- );
-- ALTER TABLE plan_day_context
--   ALTER COLUMN override_type TYPE day_override_type
--   USING override_type::text::day_override_type;
-- DROP TYPE plan_day_context_type;
-- ALTER TABLE plan_day_context RENAME TO day_overrides;
```

**Pre-migration constraint name check (run before applying):**
```sql
SELECT constraint_name FROM information_schema.table_constraints
WHERE table_name = 'plan_slots' AND constraint_type = 'FOREIGN KEY'
  AND constraint_name LIKE '%main_assignment_id%';
```
Expected: `plan_slots_main_assignment_id_fkey`. If different, update the DROP + ADD in the migration.

**Verification gate (run after migration):**
```sql
-- Must return 0 (table renamed):
SELECT count(*) FROM information_schema.tables WHERE table_name = 'day_overrides';
-- Must return 1 (new name exists):
SELECT count(*) FROM information_schema.tables WHERE table_name = 'plan_day_context';
-- Must return 0 (old enum gone):
SELECT count(*) FROM pg_type WHERE typname = 'day_override_type';
-- Must return 1 (new enum exists):
SELECT count(*) FROM pg_type WHERE typname = 'plan_day_context_type';
-- Must return plan_day_context_type (column renamed and retyped):
SELECT data_type FROM information_schema.columns
WHERE table_name = 'plan_day_context' AND column_name = 'context_type';
-- Must return 0 (no override_type column):
SELECT count(*) FROM information_schema.columns
WHERE table_name = 'plan_day_context' AND column_name = 'override_type';
-- Must return ON DELETE CASCADE (FK fixed):
SELECT rc.delete_rule FROM information_schema.referential_constraints rc
JOIN information_schema.table_constraints tc ON rc.constraint_name = tc.constraint_name
WHERE tc.table_name = 'plan_slots' AND tc.constraint_name LIKE '%main_assignment_id%';
```

Apply with: `supabase db push --include-all` or `supabase migration up`.
**USER-SIDE GATE** — migration drops columns and renames the table against linked remote Supabase. Apply only after all code changes are committed, following C1/D1 apply precedent.

### Task 2 — Contracts: rename `day-override.ts` → `plan-day-context.ts` (AC #2, #3, #8)

**File to rename:** `packages/contracts/src/day-override.ts` → `packages/contracts/src/plan-day-context.ts`

Replace entire content:

```typescript
import { z } from 'zod';

// Story 3-DM-E1 — plan_day_context (renamed from day_overrides).
// FR118, FR119 — day-level context hints for composition-changing events.
// Pause semantics (bag_suspended, sick_day) live on plan_days.paused_at + paused_reason.
//
// Mirrors:
//   - supabase/migrations/20261012000000_plan_day_context_rename.sql
//   - apps/api/src/modules/plans/plan-day-context.repository.ts

export const PlanDayContextTypeSchema = z.enum([
  'half_day',
  'field_trip',
  'post_dentist',
  'early_release',
  'sport_practice',
  'test_day',
]);

export const PlanDayContextSchema = z.object({
  id: z.string().uuid(),
  plan_slot_id: z.string().uuid(),
  child_id: z.string().uuid(),
  household_id: z.string().uuid(),
  override_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),  // YYYY-MM-DD
  context_type: PlanDayContextTypeSchema,
  is_lumi_proposed: z.boolean(),
  confirmed_at: z.string().datetime({ offset: true }).nullable(),
  reverted_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const SetPlanDayContextInputSchema = z
  .object({
    context_type: PlanDayContextTypeSchema,
    override_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    child_id: z.string().uuid(),
    is_lumi_proposed: z.boolean().default(false),
  })
  .strict()
  .refine(
    (data) => data.override_date >= new Date().toISOString().slice(0, 10),
    { message: 'override_date must be today or in the future', path: ['override_date'] },
  );

export const SetPlanDayContextResponseSchema = z.object({
  override: PlanDayContextSchema,
  regen_triggered: z.boolean(),
});
```

**`packages/contracts/src/index.ts`:**
- Replace `export * from './day-override.js';` → `export * from './plan-day-context.js';`

**`packages/contracts/src/plan.ts`:** Two schema renames at the bottom of the file:
- `DayOverrideSlotParamSchema` → `PlanDayContextSlotParamSchema`
- `DayOverrideSlotRevertParamSchema` → `PlanDayContextSlotRevertParamSchema`
- The content of these schemas (fields: `planId`, `planSlotId`, `overrideId`) is unchanged.

**`packages/types/src/index.ts`:**
```typescript
// Replace:
export type DayOverrideType = z.infer<typeof DayOverrideTypeSchema>;
export type DayOverride = z.infer<typeof DayOverrideSchema>;
export type SetDayOverrideInput = z.infer<typeof SetDayOverrideInputSchema>;
export type SetDayOverrideResponse = z.infer<typeof SetDayOverrideResponseSchema>;
export type DayOverrideSlotParam = z.infer<typeof DayOverrideSlotParamSchema>;
export type DayOverrideSlotRevertParam = z.infer<typeof DayOverrideSlotRevertParamSchema>;

// With:
export type PlanDayContextType = z.infer<typeof PlanDayContextTypeSchema>;
export type PlanDayContext = z.infer<typeof PlanDayContextSchema>;
export type SetPlanDayContextInput = z.infer<typeof SetPlanDayContextInputSchema>;
export type SetPlanDayContextResponse = z.infer<typeof SetPlanDayContextResponseSchema>;
export type PlanDayContextSlotParam = z.infer<typeof PlanDayContextSlotParamSchema>;
export type PlanDayContextSlotRevertParam = z.infer<typeof PlanDayContextSlotRevertParamSchema>;
```

### Task 3 — Repository: rename + remove flat methods (AC #7, #9)

**File to rename:** `apps/api/src/modules/plans/day-overrides.repository.ts` → `plan-day-context.repository.ts`

Complete rewrite of the file:

```typescript
import { BaseRepository } from '../../repository/base.repository.js';
import type { PlanDayContext } from '@hivekitchen/types';

const OVERRIDE_COLUMNS =
  'id, plan_slot_id, child_id, household_id, override_date, context_type, is_lumi_proposed, confirmed_at, reverted_at, created_at, updated_at';

// Story 3-DM-E1 — post-rename interface. plan_slot_id is the canonical FK.
export interface UpsertPlanDayContextInput {
  planSlotId: string;
  childId: string;
  householdId: string;
  overrideDate: string;
  contextType: string;
  isLumiProposed: boolean;
}

export class PlanDayContextRepository extends BaseRepository {
  // Insert-then-update split so confirmed_at on an existing parent-confirmed
  // row is never overwritten by a Lumi-proposed follow-up.
  async upsert(input: UpsertPlanDayContextInput): Promise<PlanDayContext> {
    const nowIso = new Date().toISOString();
    const confirmedAt = input.isLumiProposed ? null : nowIso;

    const { data: insertData, error: insertError } = await this.client
      .from('plan_day_context')
      .insert({
        plan_slot_id: input.planSlotId,
        child_id: input.childId,
        household_id: input.householdId,
        override_date: input.overrideDate,
        context_type: input.contextType,
        is_lumi_proposed: input.isLumiProposed,
        confirmed_at: confirmedAt,
        reverted_at: null,
        updated_at: nowIso,
      })
      .select(OVERRIDE_COLUMNS)
      .single();

    if (!insertError) return insertData as PlanDayContext;

    // Unique conflict on (plan_slot_id, child_id, override_date).
    if (insertError.code === '23505') {
      const { data, error } = await this.client
        .from('plan_day_context')
        .update({
          context_type: input.contextType,
          is_lumi_proposed: input.isLumiProposed,
          reverted_at: null,
          updated_at: nowIso,
        })
        .eq('plan_slot_id', input.planSlotId)
        .eq('child_id', input.childId)
        .eq('override_date', input.overrideDate)
        .select(OVERRIDE_COLUMNS)
        .single();
      if (error) throw error;
      return data as PlanDayContext;
    }

    throw insertError;
  }

  async revert(
    overrideId: string,
    householdId: string,
    planSlotId: string,
  ): Promise<PlanDayContext | null> {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.client
      .from('plan_day_context')
      .update({ reverted_at: nowIso, updated_at: nowIso })
      .eq('id', overrideId)
      .eq('household_id', householdId)
      .eq('plan_slot_id', planSlotId)
      .is('reverted_at', null)
      .select(OVERRIDE_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    return (data as PlanDayContext | null) ?? null;
  }

  async findActiveById(
    overrideId: string,
    householdId: string,
    planSlotId: string,
  ): Promise<PlanDayContext | null> {
    const { data, error } = await this.client
      .from('plan_day_context')
      .select(OVERRIDE_COLUMNS)
      .eq('id', overrideId)
      .eq('household_id', householdId)
      .eq('plan_slot_id', planSlotId)
      .is('reverted_at', null)
      .maybeSingle();
    if (error) throw error;
    return (data as PlanDayContext | null) ?? null;
  }

  // Active (non-reverted) context rows for a household on today or future dates.
  async findActiveByHousehold(householdId: string): Promise<PlanDayContext[]> {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await this.client
      .from('plan_day_context')
      .select(OVERRIDE_COLUMNS)
      .eq('household_id', householdId)
      .gte('override_date', today)
      .is('reverted_at', null);
    if (error) throw error;
    return (data ?? []) as PlanDayContext[];
  }

  // Nightly soft-revert of rows whose override_date is strictly before today (UTC).
  async revertExpired(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();
    const { data, error } = await this.client
      .from('plan_day_context')
      .update({ reverted_at: nowIso, updated_at: nowIso })
      .lt('override_date', today)
      .is('reverted_at', null)
      .select('id');
    if (error) throw error;
    return (data ?? []).length;
  }
}
```

**Note:** The flat methods (`upsert` keyed on `plan_item_id`, `confirm`, `findActivePausingForChildOnDate`) and the stale `OVERRIDE_COLUMNS`/`UpsertDayOverrideInput` are NOT carried forward — they're removed entirely. The 3 failing tests tested the flat `upsert()`; they are deleted in Task 8.

### Task 4 — Service: rename + remove PAUSING_OVERRIDES guard (AC #7, #9)

**File to rename:** `apps/api/src/modules/plans/day-overrides.service.ts` → `plan-day-context.service.ts`

Key changes (preserve all existing logic, only rename + trim):

1. **Class rename:** `DayOverridesService` → `PlanDayContextService`; `DayOverridesServiceDeps` → `PlanDayContextServiceDeps`
2. **Type imports:** `DayOverride` → `PlanDayContext`, `DayOverrideType` → `PlanDayContextType`, `SetDayOverrideInput` → `SetPlanDayContextInput`
3. **Repository import:** `DayOverridesRepository` → `PlanDayContextRepository` (from `./plan-day-context.repository.js`)
4. **Remove `PAUSING_OVERRIDES` set and the ConflictError guard** in `setOverrideTree()`:
   ```typescript
   // DELETE these lines:
   const PAUSING_OVERRIDES = new Set<DayOverrideType>(['bag_suspended', 'sick_day']);
   
   // DELETE from setOverrideTree():
   if (opts.input.override_type === 'bag_suspended' || opts.input.override_type === 'sick_day') {
     throw new ConflictError(...)
   }
   ```
   The enum no longer contains these values; the Fastify route handler rejects unknown values before the service is called.

5. **Method renames:**
   - `setOverrideTree` → `setOverride`
   - `revertOverrideTree` → `revertOverride`
   
6. **Repo method call renames:**
   - `this.repo.upsertTree(...)` → `this.repo.upsert(...)`; update arg key `overrideType` → `contextType`
   - `this.repo.revertTree(...)` → `this.repo.revert(...)`
   - `this.repo.findActiveByIdTree(...)` → `this.repo.findActiveById(...)`
   
7. **Input field rename** in method body:
   - `opts.input.override_type` → `opts.input.context_type` (everywhere in `setOverride()`)
   
8. **Audit metadata key rename:**
   - `override_type: opts.input.override_type` → `context_type: opts.input.context_type`
   - `override_type: reverted.override_type` → `context_type: reverted.context_type` (in `revertOverride()`)

9. **Remove the `ConflictError` import** if it's no longer used after removing the PAUSING_OVERRIDES guard. (Check: is ConflictError used elsewhere in the service? If not, drop the import.)

### Task 5 — fastify.d.ts + plans.hook.ts (AC #9)

**`apps/api/src/types/fastify.d.ts`:**
- Replace: `dayOverridesService: DayOverridesService;`
- With: `planDayContextService: PlanDayContextService;`
- Update import: `DayOverridesService` → `PlanDayContextService`, path `'../modules/plans/day-overrides.service.js'` → `'../modules/plans/plan-day-context.service.js'`

**`apps/api/src/modules/plans/plans.hook.ts`:**
- `DayOverridesRepository` → `PlanDayContextRepository` (import + instantiation)
- `DayOverridesService` → `PlanDayContextService` (import + instantiation)
- Local variable names: `dayOverridesRepository` → `planDayContextRepository`, `dayOverridesService` → `planDayContextService`
- `fastify.hasDecorator('dayOverridesService')` → `fastify.hasDecorator('planDayContextService')`
- `fastify.decorate('dayOverridesService', ...)` → `fastify.decorate('planDayContextService', ...)`

### Task 6 — plans.routes.ts (AC #9)

In `apps/api/src/modules/plans/plans.routes.ts`:

1. Update imports: `DayOverrideSlotParamSchema` → `PlanDayContextSlotParamSchema`, `DayOverrideSlotRevertParamSchema` → `PlanDayContextSlotRevertParamSchema`, `SetDayOverrideInputSchema` → `SetPlanDayContextInputSchema`, `SetDayOverrideResponseSchema` → `SetPlanDayContextResponseSchema`
2. Route handler references:
   - `fastify.dayOverridesService.setOverrideTree(...)` → `fastify.planDayContextService.setOverride(...)`
   - `fastify.dayOverridesService.revertOverrideTree(...)` → `fastify.planDayContextService.revertOverride(...)`

**Input field change in the route body:** The request body schema now uses `context_type` instead of `override_type`. This is a **breaking API change** (pre-beta, acceptable). Fastify route validates the incoming body against `SetPlanDayContextInputSchema`, which has `context_type`. No additional change needed in the route handler itself since it passes the body as-is to the service.

### Task 7 — Jobs + orchestrator (AC #9)

**`apps/api/src/jobs/plan-generation.job.ts`:**
- `import { DayOverridesRepository } from ...` → `import { PlanDayContextRepository } from '../modules/plans/plan-day-context.repository.js'`
- `new DayOverridesRepository(...)` → `new PlanDayContextRepository(...)`
- Local variable `dayOverridesRepository` → `planDayContextRepository`

**`apps/api/src/jobs/plan-regeneration.job.ts`:**
- Same pattern as plan-generation.job.ts above.

**`apps/api/src/jobs/planner-context.loader.ts`:**
- `DayOverridesRepository` → `PlanDayContextRepository` (import + function param type)
- `dayOverridesRepository` parameter name → `planDayContextRepository`
- Any `override.override_type` field reads → `override.context_type`

**`apps/api/src/agents/orchestrator.ts`:**
- Any inline literal `override_type:` keys → `context_type:`
- Any `override.override_type` reads → `override.context_type`
- Type imports if any: `DayOverride` → `PlanDayContext`, `DayOverrideType` → `PlanDayContextType`

**`apps/api/src/jobs/day-override-revert.job.ts`:**
- Update import path: `day-overrides.repository.js` → `plan-day-context.repository.js`
- `DayOverridesRepository` → `PlanDayContextRepository`
- `new DayOverridesRepository(...)` → `new PlanDayContextRepository(...)`
- (File rename is optional — the job's behavior is unchanged; updating the import is sufficient)

### Task 7b — Web consumers (AC #9)

**`apps/web/src/features/plan/mutations.ts`:**
- `DayOverride` → `PlanDayContext`, `DayOverrideType` → `PlanDayContextType`, `SetDayOverrideInput` → `SetPlanDayContextInput`
- Any `override_type` field in mutation payloads → `context_type`
- Any response field reads `override.override_type` → `override.context_type`

**`apps/web/src/features/plan/OverridePicker.tsx`:**
- `DayOverrideType` → `PlanDayContextType`
- Any `type: DayOverrideType` prop or state type → `PlanDayContextType`
- Any value comparisons on `override_type` → `context_type` (if applicable)

**`apps/web/src/features/plan/OverridePicker.test.tsx`:**
- `DayOverrideType` → `PlanDayContextType`
- Any `override_type` → `context_type` in test payloads/assertions

### Task 8 — Test files: rename + fix failures (AC #10)

**`apps/api/src/modules/plans/day-overrides.repository.test.ts` → `plan-day-context.repository.test.ts`:**

This file currently has 14 tests: 3 failing (`DayOverridesRepository.upsert` describe, testing the flat `insert`-based `upsert()`) and 11 passing.

Changes:
1. **DELETE the entire `DayOverridesRepository.upsert` describe block** (lines 65–123) — these test the removed flat method.
2. Class rename: `DayOverridesRepository` → `PlanDayContextRepository`, import path update.
3. Add `PLAN_SLOT_ID` constant (e.g. `'55555555-5555-4555-8555-555555555555'`).
4. Update `SAMPLE_OVERRIDE`: `plan_item_id: PLAN_ITEM_ID` → `plan_slot_id: PLAN_SLOT_ID`; `override_type: 'sport_practice'` → `context_type: 'sport_practice'`.
5. Remove `PLAN_ITEM_ID` constant (no longer needed) OR keep it if still referenced elsewhere in the file.
6. Add `'insert'` to the `ops` array in `buildChainClient` (the new `upsert()` calls `.insert()`).
7. Update `DayOverridesRepository.revert` describe → `PlanDayContextRepository.revert`:
   - Both calls `repo.revert(OVERRIDE_ID, HOUSEHOLD_ID)` need a third arg `PLAN_SLOT_ID`: `repo.revert(OVERRIDE_ID, HOUSEHOLD_ID, PLAN_SLOT_ID)`
8. `DayOverridesRepository.revertExpired` → `PlanDayContextRepository.revertExpired` (rename describe, no logic change).
9. **ADD new describe block** for `PlanDayContextRepository.upsert` (replaces the deleted flat tests):

```typescript
describe('PlanDayContextRepository.upsert', () => {
  it('inserts a parent-initiated context row with confirmed_at set', async () => {
    const { client, steps } = buildChainClient({ data: SAMPLE_OVERRIDE, error: null });
    const repo = new PlanDayContextRepository(client);

    const result = await repo.upsert({
      planSlotId: PLAN_SLOT_ID,
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      overrideDate: '2026-05-06',
      contextType: 'sport_practice',
      isLumiProposed: false,
    });

    expect(result).toEqual(SAMPLE_OVERRIDE);
    const insertStep = steps.find((s) => s.op === 'insert');
    expect(insertStep).toBeDefined();
    const payload = insertStep!.args[0] as { confirmed_at: string | null; plan_slot_id: string };
    expect(payload.plan_slot_id).toBe(PLAN_SLOT_ID);
    expect(payload.confirmed_at).not.toBeNull();
  });

  it('leaves confirmed_at null for Lumi-proposed rows', async () => {
    const { client, steps } = buildChainClient({
      data: { ...SAMPLE_OVERRIDE, is_lumi_proposed: true, confirmed_at: null },
      error: null,
    });
    const repo = new PlanDayContextRepository(client);

    await repo.upsert({
      planSlotId: PLAN_SLOT_ID,
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      overrideDate: '2026-05-06',
      contextType: 'sport_practice',
      isLumiProposed: true,
    });

    const insertStep = steps.find((s) => s.op === 'insert');
    const payload = insertStep!.args[0] as { confirmed_at: string | null };
    expect(payload.confirmed_at).toBeNull();
  });
});
```

**`apps/api/src/modules/plans/day-overrides.service.tree.test.ts` → `plan-day-context.service.test.ts`:**

1. Class renames: `DayOverridesService` → `PlanDayContextService`, `DayOverridesRepository` → `PlanDayContextRepository`
2. Import renames: `./day-overrides.service.js` → `./plan-day-context.service.js`, `./day-overrides.repository.js` → `./plan-day-context.repository.js`
3. **Delete** the two rejection tests for `bag_suspended` and `sick_day` (they tested a service guard that's removed after the enum narrows; Zod rejects these values at schema level now).
4. Method renames in `buildService()`:
   - `upsertTree` → `upsert`, `revertTree` → `revert`, `findActiveByIdTree` → `findActiveById`
   - Mock properties: `{ upsert, revert, findActiveById }`
5. Method renames in tests: `setOverrideTree` → `setOverride`, `revertOverrideTree` → `revertOverride`
6. Input type: `SetDayOverrideInput` → `SetPlanDayContextInput`; `input()` helper field `override_type` → `context_type`
7. Assertion updates:
   - `expect(mocks.upsertTree)` → `expect(mocks.upsert)`
   - `expect(mocks.revertTree)` → `expect(mocks.revert)`
   - `overrideType: 'field_trip'` → `contextType: 'field_trip'` in `toHaveBeenCalledWith` assertions
   - Audit metadata assertion: `override_type: 'field_trip'` → `context_type: 'field_trip'`
8. Describe names: `DayOverridesService.setOverrideTree` → `PlanDayContextService.setOverride`, etc.

**`apps/api/src/modules/plans/plans.routes.test.ts`:**

1. `MOCK_OVERRIDE`: `plan_item_id: '...'` → `plan_slot_id: SAMPLE_SLOT_ID`; `override_type: 'field_trip'` → `context_type: 'field_trip'`
2. Interface `DayOverridesServiceMocks` → `PlanDayContextServiceMocks`: `setOverrideTree` → `setOverride`, `revertOverrideTree` → `revertOverride`
3. `buildDayOverridesService` → `buildPlanDayContextService` (rename function + all call sites)
4. Decorator key: `'dayOverridesService'` → `'planDayContextService'`
5. `VALID_BODY`: `override_type: 'field_trip'` → `context_type: 'field_trip'`
6. Assertions: `dayOverridesService.setOverrideTree` → `planDayContextService.setOverride`; `dayOverridesService.revertOverrideTree` → `planDayContextService.revertOverride`
7. Test description strings: update "setOverrideTree" → "setOverride", "revertOverrideTree" → "revertOverride"

**`apps/api/src/jobs/planner-context.loader.test.ts`:**
- `makeOverride()` helper: `override_type` → `context_type`
- Class/type references if any.

**`apps/api/src/agents/orchestrator.test.ts`:**
- Test fixtures: `override_type: 'sport_practice'` → `context_type: 'sport_practice'`

**`apps/web/src/features/plan/OverridePicker.test.tsx`:**
- `DayOverrideType` → `PlanDayContextType`; `override_type` → `context_type`

**E2E test:**
- `apps/web/test/e2e/3-19-day-level-context-overrides.spec.ts`: request bodies `override_type` → `context_type`; response field reads `override_type` → `context_type`

### Task 9 — Simplify clear-load-test-plans.ts (AC #11)

After the CASCADE migration is applied and verified, simplify `scripts/clear-load-test-plans.ts`:

**Before:** 3-step manual deletion (plan_days → plan_main_assignments → plans) with a comment explaining the FK gap.

**After (once cascade chain confirmed):**
```typescript
// Verify full cascade chain before committing this simplification:
// plans → (ON DELETE CASCADE) → plan_days → (ON DELETE CASCADE) → plan_slots
// plans → (ON DELETE CASCADE) → plan_main_assignments → (ON DELETE CASCADE via E1) → plan_slots
//
// If plan_days.plan_id has ON DELETE CASCADE to plans AND plan_slots.plan_day_id
// has ON DELETE CASCADE to plan_days, a single DELETE FROM plans cascades everything.
const { error } = await supabase.from('plans').delete().eq('household_id', HH);
if (error) { console.error('plans delete failed:', error.message); return; }
console.log('OK');
```

**Note:** Before simplifying, verify `plan_days.plan_id` and `plan_slots.plan_day_id` both have `ON DELETE CASCADE`. If any link in the chain is missing, keep the manual order for those links.

### Task 10 — Final orphan scrub + sprint status (AC #9, #10)

**Orphan check (must return 0 meaningful hits):**
```
grep -rn "day_overrides\|DayOverride\|override_type\|day_override_type" apps/ packages/ scripts/
grep -rn "DayOverridesService\|DayOverridesRepository\|DayOverridesServiceDeps" apps/ packages/
```
Expected: 0 matches (excluding any remaining comments that reference the old names in an explanatory context — those should be updated too).

**TypeScript check** (`pnpm -r exec --if-present tsc --noEmit`):
- API baseline: ≤13 errors (all pre-existing)
- Web baseline: ≤3 errors (all pre-existing)
- Contracts: 0 errors
- Types: 0 errors

**Test check** (`pnpm --filter @hivekitchen/api test`):
- Expected: ≤19 failing tests (was 22; removed 3 day-overrides.repository failures)
- The 10 originally-failing files shrink to 9 (day-overrides.repository is no longer in the set)
- Web: 374/374 (unchanged)

**Sprint status:** Update `_bmad-output/implementation-artifacts/sprint-status.yaml`:
- `3-dm-e1-adjacent-cleanup`: `backlog` → `review`
- `last_updated` field

**Migration apply** — USER-SIDE GATE. After code ships:
- Run `supabase db push --include-all`
- Run the verification SQL from Task 1
- Verify `scripts/clear-load-test-plans.ts` still works (or simplify per Task 9)

## Test Plan

**`plan-day-context.repository.test.ts`** (~14 net tests — same count as before, different distribution):
- Delete 3 flat upsert tests → add 2 new tree-shape upsert tests
- Net change: -3 +2 = 11 from old passing + 2 new = 13 tests total
- All should pass after the rename

**`plan-day-context.service.test.ts`** (~8 tests — was 10, delete 2 rejection tests for bag_suspended/sick_day):
- Mechanical rename; all should pass

**`plans.routes.test.ts`** (~mechanical updates to 4-5 override-related tests):
- VALID_BODY field rename, mock function rename, assertion field renames

**No new test files** for the migration — verification is via SQL checks.

## Rollback

- **Task 1 (migration):** Run the down migration. No data loss (DELETE of bag_suspended/sick_day rows is safe — C1 migrated those to plan_days.paused_at; dev-environment only).
- **Tasks 2–5 (contracts/types/repository/service):** Revert file renames and content changes.
- **Task 6–7 (routes/jobs/web):** Revert import updates and field name changes.
- **Task 8 (tests):** Revert test renames and content changes; the 3 flat upsert tests can be restored from git history.
- Task 9 is optional; clear-load-test-plans.ts can stay in its manual-order form indefinitely.

## Dev Notes

### Architecture compliance

- **`plan_day_context` is a hint layer, not the pause layer.** The canonical pause grain lives on `plan_days.paused_at` / `paused_reason` and `plan_slot_variations.paused_at`. `plan_day_context` captures composition-changing events (field_trip, sport_practice, etc.) so the planner can adjust meal content. Do not re-introduce pause-overlapping logic here.

- **No business logic in the migration.** The SQL is purely a rename + enum swap. No conditional logic, no Zod parsing in SQL.

- **API wire format change (`override_type` → `context_type`)** is a breaking change. This is acceptable pre-beta. The web client must send `context_type` in the POST body; response returns `context_type`. Update both the web mutation payloads and any hardcoded field reads.

### Constraint name verification (Task 1)

Before running the migration's `ALTER TABLE plan_slots DROP CONSTRAINT ...`, verify the actual constraint name with:
```sql
SELECT constraint_name FROM information_schema.table_constraints
WHERE table_name = 'plan_slots' AND constraint_type = 'FOREIGN KEY';
```
PostgreSQL auto-names inline FKs as `{table}_{column}_fkey`, so `plan_slots_main_assignment_id_fkey` is expected. If it differs, update the migration before applying.

### Flat method removal scope

The removed flat methods (`upsert`/`revert`/`confirm`/`findActiveById`/`findActivePausingForChildOnDate` with `plan_item_id`) were disabled by C1 (which dropped `plan_item_id` from the DB). They were intentionally kept in place by C2 pending this E1 rename. Remove them entirely — no shim, no deprecation marker.

### `COMPOSITION_CHANGING_OVERRIDES` set

The `COMPOSITION_CHANGING_OVERRIDES` set in the service is still valid and should be kept. Only `PAUSING_OVERRIDES` and the associated ConflictError guard are removed. `early_release` stays excluded from both sets (event-only).

### Service method rename in planner-context.loader.ts

The `planner-context.loader.ts` function signature takes `dayOverridesRepository: DayOverridesRepository`. After E1, this becomes `planDayContextRepository: PlanDayContextRepository`. The callers (`plan-generation.job.ts`, `plan-regeneration.job.ts`) pass the instantiated repository — update variable names in those files too.

### Source-tree files touched

**New:**
- `supabase/migrations/20261012000000_plan_day_context_rename.sql`

**Renamed — packages:**
- `packages/contracts/src/day-override.ts` → `plan-day-context.ts`

**Modified — packages:**
- `packages/contracts/src/index.ts` — update re-export
- `packages/contracts/src/plan.ts` — rename DayOverrideSlotParam* schemas
- `packages/types/src/index.ts` — rename type exports

**Renamed — apps/api:**
- `apps/api/src/modules/plans/day-overrides.repository.ts` → `plan-day-context.repository.ts`
- `apps/api/src/modules/plans/day-overrides.repository.test.ts` → `plan-day-context.repository.test.ts`
- `apps/api/src/modules/plans/day-overrides.service.ts` → `plan-day-context.service.ts`
- `apps/api/src/modules/plans/day-overrides.service.tree.test.ts` → `plan-day-context.service.test.ts`

**Modified — apps/api:**
- `apps/api/src/types/fastify.d.ts`
- `apps/api/src/modules/plans/plans.hook.ts`
- `apps/api/src/modules/plans/plans.routes.ts`
- `apps/api/src/modules/plans/plans.routes.test.ts`
- `apps/api/src/jobs/plan-generation.job.ts`
- `apps/api/src/jobs/plan-regeneration.job.ts`
- `apps/api/src/jobs/planner-context.loader.ts`
- `apps/api/src/jobs/planner-context.loader.test.ts`
- `apps/api/src/jobs/day-override-revert.job.ts` (import update only; no rename needed)
- `apps/api/src/agents/orchestrator.ts`
- `apps/api/src/agents/orchestrator.test.ts`

**Modified — apps/web:**
- `apps/web/src/features/plan/mutations.ts`
- `apps/web/src/features/plan/OverridePicker.tsx`
- `apps/web/src/features/plan/OverridePicker.test.tsx`
- `apps/web/test/e2e/3-19-day-level-context-overrides.spec.ts`

**Modified — scripts:**
- `scripts/clear-load-test-plans.ts` (simplification, after cascade verified)

## Previous Story Intelligence

From 3-DM-D1 (done 2026-06-02):

- **D1 baseline:** API 22 tests failing (pre-existing — 10 file categories: `auth.routes`, `children.repository`, `extra-library.repository`, `day-overrides.repository`, `onboarding.tools`, `audit.types`, `catalog-seed.service`, `lunch-link.routes`, `memory.service`, `plan-adjustment.service`). Web 374/374. API typecheck 13, Web 3, Contracts 1, Types 1.
- **E1 closes the 3-test day-overrides.repository failures.** Those 3 tests called `repo.upsert(planItemId, ...)` — flat method that references the dropped `plan_item_id` column. Mock doesn't have `.insert()` in its op list so it throws `"this.client.from(...).insert is not a function"`. Fix: delete the 3 tests and add tests for the canonical tree-shape `upsert(planSlotId, ...)`.
- **C2 deferred:** "Day-overrides.repository ×3 failures DELIBERATELY NOT fixed in C2 — the right delete pass is E1's day_overrides → plan_day_context rename." This is that pass.
- **D1 and E1 are parallel-safe** per the D1 story; D1 is now done so this is a clean sequential handoff.

## Git Intelligence Summary

```
2a3cbcf chore(3-dm-d1): close out — review patches applied, story done
e68aa1c feat(3-dm-d1): brief_state payload consolidation + plan_state write path migration
416efb2 feat(3-dm-c2): Phase C cleanup — close out post-cutover loose ends
```

Suggested commit cadence (follow per-task pattern from D1):
- `feat(3-dm-e1): Task 1 — plan_day_context migration + enum swap + FK cascade fix`
- `feat(3-dm-e1): Tasks 2-3 — PlanDayContextSchema + PlanDayContextRepository (remove flat methods)`
- `feat(3-dm-e1): Task 4 — PlanDayContextService rename + remove PAUSING_OVERRIDES guard`
- `feat(3-dm-e1): Tasks 5-7 — fastify.d.ts + hook + routes + jobs + web wiring`
- `chore(3-dm-e1): Task 8 — test renames + 3 flat-upsert deletions + new upsert tests`
- `chore(3-dm-e1): Task 9 — simplify clear-load-test-plans.ts after cascade lands`
- `feat(3-dm-e1): close out — orphan scrub clean, tests at new baseline`

## Latest Tech Information

- **PostgreSQL RENAME TABLE** takes an ACCESS EXCLUSIVE lock but is nearly instantaneous (metadata-only). Safe in pre-beta with no concurrent traffic.
- **Enum value drop in Postgres** requires the create-new-enum + cast + drop-old pattern (used in Task 1). Postgres cannot drop individual enum values directly.
- **Supabase JS client** — after the table rename, `supabase.from('plan_day_context')` is the correct call. `supabase.from('day_overrides')` will return a PostgREST 404 after the migration applies. Code changes must land before (or atomically with) the migration in the deployment order.
- **Zod 3.23** — `z.enum(['half_day', ...])` is the correct form. The `PlanDayContextTypeSchema` enum has 6 values. TypeScript `PlanDayContextType` infers as the union.

## Project Context Reference

- **Contracts are the wire truth.** `PlanDayContextSchema` must match the `plan_day_context` table after migration: `plan_slot_id`, `context_type`, no `plan_item_id`, no `override_type`.
- **No `any` at API boundaries.** The repository casts remain type-safe after the rename since `PlanDayContext` is the inferred type from `PlanDayContextSchema`.
- **One logical change per commit.** Migration commit is independent and revertable.

## Story Completion Status

Ultimate context engine analysis completed — comprehensive developer guide created. Story status: `ready-for-dev`.

The developer has:
- ✅ Exact migration SQL with constraint-name pre-check and verification gates
- ✅ CASCADE (not SET NULL) decision justified by the `slot_kind='main'` CHECK constraint
- ✅ Full contracts rename (including field renames: `override_type` → `context_type`, `plan_item_id` → `plan_slot_id`)
- ✅ Complete repository rewrite (remove flat methods, rename tree methods, single OVERRIDE_COLUMNS)
- ✅ Service trim (PAUSING_OVERRIDES removed, method renames, input field rename)
- ✅ All consumers identified: fastify.d.ts, plans.hook.ts, plans.routes.ts, 3 jobs, orchestrator, web OverridePicker + mutations
- ✅ Test fix strategy: delete 3 flat-upsert tests + add 2 new tree-shape upsert tests (net baseline -3 failures)
- ✅ Orphan scrub grep command to confirm clean close-out
- ✅ Migration apply is USER-SIDE GATE (destructive — renames live table)
- ✅ Baseline: API ≤19 failures post-E1 (was 22), Web 374/374, typecheck clean

## Dev Agent Record

### Implementation Plan / Decisions

Executed as a pure rename + enum-trim sweep across DB → contracts → types → repository → service → wiring → jobs → web → tests. All 11 ACs satisfied at the code/contract/test level. Decisions and deviations from the story's stated scope (all surfaced rather than silent):

- **Web mutation hooks renamed** (`useSetDayOverrideMutation` → `useSetPlanDayContextMutation`, `useRevertDayOverrideMutation` → `useRevertPlanDayContextMutation`). Story Task 7b named only type/field renames, but AC#9 requires **zero `DayOverride` references** and the hook names contained it. Call sites (`OverridePicker.tsx`, `OverridePicker.test.tsx`) updated in lockstep.
- **`OverridePicker.tsx` lost two options.** `bag_suspended` ("No lunch needed") and `sick_day` ("Sick day") were dropped from the enum (AC#3); the `OVERRIDE_OPTIONS` array is typed to `PlanDayContextType`, so keeping them would be a web typecheck error. Removed both (six options remain). **Product note / follow-up:** the picker no longer offers a sick-day / no-lunch path. The canonical pause grain lives on `plan_days.paused_at` / `plan_slot_variations.paused_at`; wiring a pause UI to those routes is a separate slice. (The old service already *rejected* those two values with a ConflictError, so the buttons were already non-functional in production.)
- **Contracts test file** `day-override.test.ts` → `plan-day-context.test.ts` (Story Task 8 omitted it). While rewriting it I fixed a **copied time-bomb**: the input-schema success test used `override_date: '2026-05-06'`, which the schema's `refine(override_date >= today)` now rejects (today is past that). Switched the fixture to a future date (`2099-01-15`), matching the `plans.routes.test.ts` pattern.
- **`plan-generation.job.ts` audit metadata** — the story's Task 7 listed this file for the repository instantiation only, but it also built `plan.extra_proposal_created` audit metadata with `override_type: p.override_type`. Renamed to `context_type` (both the key and the `PlannerExtraProposal` field read) — caught by the AC#9 orphan grep, not the initial scan.
- **`scripts/dev-db-reset.ts`** `clearTable('day_overrides')` → `'plan_day_context'` (not in the story File List; required by AC#9's `scripts/` grep). Pre-existing dead reference `clearTable('plan_items')` on the next line (table dropped in C1) was **left untouched** — out of E1 scope, surfaced here for a follow-up.
- **e2e specs (`3-19`, `3-12`) — minimal scope.** These specs are already stale from the C1 cutover (they target the pre-tree `/items/*/override` route and key tiles by `plan_item_id`) and are not part of the pass gate (Playwright, not the vitest API/web suites). I made the minimal AC#9-satisfying + enum-coherent edits: renamed `override_type` → `context_type`, removed the tests that exercise the now-removed `sick_day`/`bag_suspended` buttons, and narrowed "eight options" → six. I did **not** migrate the `/items/` → `/slots/` route shape or the `plan_item_id` tile keys — that is pre-existing C1/D1 e2e debt, not E1's rename. Flagged as deferred.
- **Migration is a USER-SIDE GATE.** `20261012000000_plan_day_context_rename.sql` is authored and ready but **not applied** — it renames a live table + swaps an enum + drops a column against linked remote Supabase. Deferred to the user per C1/D1 apply precedent, along with the Task-1 verification SQL and the `clear-load-test-plans.ts` cascade re-check. The `clear-load-test-plans.ts` simplification (single `DELETE FROM plans`) was authored after verifying the full cascade chain in the C1 migration (`plan_main_assignments.plan_id`, `plan_days.plan_id`, `plan_slots.plan_day_id`, `plan_slot_variations.plan_slot_id` all `ON DELETE CASCADE`; E1 adds the missing `plan_slots.main_assignment_id` CASCADE).
- **Flat methods removed entirely** (`confirm`, `findActivePausingForChildOnDate`, and the `plan_item_id`-keyed `upsert`/`revert`/`findActiveById`) — confirmed zero live callers before deletion. The Tree-suffixed methods became the canonical unprefixed API.

### Completion Notes

- **AC#9 orphan grep is clean:** `grep -rn "day_overrides|DayOverride|override_type|day_override_type|DayOverridesService|DayOverridesRepository"` across `apps/ packages/ scripts/` (`.ts`/`.tsx`) returns **0 hits**. (One historical comment in `brief-state.composer.ts` references `day-overrides.service` with hyphens — not in the grep pattern, pre-existing Phase-9 narration, left untouched.)
- **Verification (automated gates):**
  - API tests: **19 failed / 1281 passed / 13 skipped** — matches the predicted new baseline exactly (was 22; the 3 `day-overrides.repository` flat-upsert failures are eliminated). All 9 failing files are the pre-existing set (`auth.routes`, `children.repository`, `extra-library.repository`, `onboarding.tools`, `audit.types`, `catalog-seed.service`, `lunch-link.routes`, `memory.service`, `plan-adjustment.service`) — none E1-touched.
  - Web tests: **374/374** green.
  - Typecheck: API **11** (≤13 baseline), Web **3** (baseline), Contracts **1** / Types **1** (the pre-existing `heart-notes.ts` `$ZodIssue` baseline — AC#10's "0 errors" expectation was optimistic; actual baseline is 1/1 per D1). **Zero new errors** from the rename.
  - The 5 directly-changed API test files (`plan-day-context.repository`, `plan-day-context.service`, `plans.routes`, `planner-context.loader`, `orchestrator`) all pass (112 tests). Contracts `plan-day-context.test.ts` passes.
- **Not committed** — work left in the working tree on `main` (project convention forbids committing to `main`). Suggested per-task commit cadence is in the story's Git Intelligence Summary; create a `feat/3-dm-e1-plan-day-context-rename` branch to land it.

### File List

**New:**
- `supabase/migrations/20261012000000_plan_day_context_rename.sql`

**Renamed — packages/contracts:**
- `src/day-override.ts` → `src/plan-day-context.ts`
- `src/day-override.test.ts` → `src/plan-day-context.test.ts`

**Modified — packages:**
- `packages/contracts/src/index.ts` — re-export `./plan-day-context.js`
- `packages/contracts/src/plan.ts` — `DayOverrideSlotParamSchema`/`DayOverrideSlotRevertParamSchema` → `PlanDayContextSlotParamSchema`/`PlanDayContextSlotRevertParamSchema`
- `packages/types/src/index.ts` — `PlanDayContextType`/`PlanDayContext`/`SetPlanDayContextInput`/`SetPlanDayContextResponse`/`PlanDayContextSlotParam`/`PlanDayContextSlotRevertParam`

**Renamed — apps/api:**
- `src/modules/plans/day-overrides.repository.ts` → `src/modules/plans/plan-day-context.repository.ts` (flat methods removed)
- `src/modules/plans/day-overrides.repository.test.ts` → `src/modules/plans/plan-day-context.repository.test.ts` (3 flat-upsert tests deleted, 3 tree-shape tests added)
- `src/modules/plans/day-overrides.service.ts` → `src/modules/plans/plan-day-context.service.ts` (PAUSING_OVERRIDES + ConflictError guard removed)
- `src/modules/plans/day-overrides.service.tree.test.ts` → `src/modules/plans/plan-day-context.service.test.ts` (2 rejection tests deleted)

**Modified — apps/api:**
- `src/types/fastify.d.ts` — decorator `planDayContextService`
- `src/modules/plans/plans.hook.ts` — repo/service/decorator renames
- `src/modules/plans/plans.routes.ts` — schema imports + `setOverride`/`revertOverride`
- `src/modules/plans/plans.routes.test.ts` — mock/fixture/assertion renames (`plan_slot_id`, `context_type`)
- `src/jobs/plan-generation.job.ts` — repo rename + audit-metadata `context_type`
- `src/jobs/plan-regeneration.job.ts` — repo rename
- `src/jobs/planner-context.loader.ts` — repo param + `context_type` reads/writes
- `src/jobs/planner-context.loader.test.ts` — type/field renames + removed-enum test values
- `src/jobs/day-override-revert.job.ts` — import + instantiation rename (file not renamed — behavior unchanged)
- `src/agents/orchestrator.ts` — `PlannerExtraProposal.context_type` + prompt line
- `src/agents/orchestrator.test.ts` — proposal fixture `context_type`

**Modified — apps/web:**
- `src/features/plan/mutations.ts` — type imports + hook renames (`useSetPlanDayContextMutation`, `useRevertPlanDayContextMutation`)
- `src/features/plan/OverridePicker.tsx` — type/hook renames; dropped `bag_suspended`/`sick_day` options; `context_type`
- `src/features/plan/OverridePicker.test.tsx` — six-options + fixture/field renames
- `test/e2e/3-19-day-level-context-overrides.spec.ts` — `context_type`, dropped `bag_suspended` test, six options
- `test/e2e/3-12-per-slot-swap-pause.spec.ts` — removed the sick-day-via-override describe block + unused consts

**Modified — scripts:**
- `scripts/clear-load-test-plans.ts` — simplified to a single `DELETE FROM plans` (post-cascade)
- `scripts/dev-db-reset.ts` — `day_overrides` → `plan_day_context`

## Review Findings

Code review run 2026-06-02 — 3-layer adversarial pass (Blind Hunter + Edge Case Hunter + Acceptance Auditor). All 11 ACs pass. 5 patches, 5 deferred, 8 dismissed.

### Patches

- [x] [Review][Patch] P1 — upsert conflict path: use `.maybeSingle()` not `.single()` to avoid `null as PlanDayContext` return on concurrent delete [plan-day-context.repository.ts:60]
- [x] [Review][Patch] P2 — migration `DROP CONSTRAINT plan_slots_main_assignment_id_fkey` has no `IF EXISTS` guard; if constraint name differs the entire migration rolls back [20261012000000_plan_day_context_rename.sql:44]
- [x] [Review][Patch] P3 — no test for 23505 conflict path in `PlanDayContextRepository.upsert`; the conflict branch (insert-then-update) has zero test coverage [plan-day-context.repository.test.ts]
- [x] [Review][Patch] P4 — no test asserting `early_release` does NOT trigger regen (regression guard for `COMPOSITION_CHANGING_OVERRIDES`) [plan-day-context.service.test.ts]
- [x] [Review][Patch] P5 — cascade comment in `clear-load-test-plans.ts` incomplete (missing `plan_day_context` in chain) [scripts/clear-load-test-plans.ts]

### Deferred

- [x] [Review][Defer] D1 — upsert conflict path doesn't set `confirmed_at` when parent re-upserts over a Lumi-proposed row [plan-day-context.repository.ts:47-63] — deferred, pre-existing C1 behavior; Lumi-proposed override wiring is deferred to a future slice
- [x] [Review][Defer] D2 — `dev-db-reset.ts` still calls `clearTable('plan_items')` after C1 dropped that table; post-migration the script may abort mid-run [scripts/dev-db-reset.ts:120] — deferred, pre-existing C1 dead code; explicitly out of E1 scope per dev agent notes
- [x] [Review][Defer] D3 — `revertExpired()` uses UTC date math; reverts US-timezone school-day rows ~5h before the school day ends [plan-day-context.repository.ts:125] — deferred, pre-existing design from C1; pre-beta acceptable
- [x] [Review][Defer] D4 — `OverridePicker` `activeOverride.type` not in `OVERRIDE_OPTIONS` silently suppresses the active-override banner during the deploy window [apps/web/src/features/plan/OverridePicker.tsx:55-57] — deferred, self-resolving after migration deletes `bag_suspended`/`sick_day` rows
- [x] [Review][Defer] D5 — BullMQ queue/scheduler/worker names in `day-override-revert.job.ts` still reference old `day-override-revert` naming [apps/api/src/jobs/day-override-revert.job.ts] — deferred, out of E1 scope; renaming live BullMQ queues requires coordinated deploy, not a rename-in-place

## Change Log

| Date | Change |
|------|--------|
| 2026-06-02 | Story file authored — comprehensive context from codebase scan, D1 intelligence, canonical-data-model-design.md §8.1 + §10.5. |
| 2026-06-02 | Implemented E1: renamed `day_overrides` → `plan_day_context` (table + enum `day_override_type` → `plan_day_context_type`, dropping `bag_suspended`/`sick_day`; column `override_type` → `context_type`); added `plan_slots.main_assignment_id` ON DELETE CASCADE + defensive `recipes.instructions` drop; removed flat repository methods; renamed repository/service/contracts/types + all consumers (routes, hook, fastify.d.ts, 3 jobs, orchestrator, web mutations/OverridePicker); dropped the removed-enum UI options. AC#9 orphan grep clean. Gates: API 19-fail new baseline (was 22, −3 day-overrides.repository), Web 374/374, typecheck zero-new (API 11, Web 3, Contracts 1, Types 1). Migration apply + verification SQL remain USER-SIDE GATES. Status → review. |
| 2026-06-02 | Code review complete — 3-layer pass; 5 patches, 5 deferred, 8 dismissed. All 11 ACs pass. |

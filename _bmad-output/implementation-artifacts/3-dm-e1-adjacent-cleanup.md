# Story 3-DM-E1: Adjacent table cleanup — day_overrides rename + enum trim + final pass

Status: planned

## Story

As Epic 3 data-model solutioning,
We want to rename `day_overrides` → `plan_day_context`, trim the pause-overlapping enum values, and batch any remaining small cleanup items,
So that the canonical model is fully consistent and the table names match their actual purpose.

## Acceptance Criteria

1. `day_overrides` table renamed to `plan_day_context`.
2. `day_override_type` enum REPLACED with `plan_day_context_type` containing only:
   - `'half_day'`, `'field_trip'`, `'post_dentist'`, `'early_release'`, `'sport_practice'`, `'test_day'`
3. Pause-overlapping values REMOVED:
   - `'bag_suspended'` and `'sick_day'` no longer exist in the enum
   - Any rows with these values were either migrated to `plan_days.paused_at` + `paused_reason` (during C1) or deleted as stale
4. `override_type` column renamed to `context_type` (better matches the table's new name).
5. If `recipes.instructions` column still exists (unlikely — should be dropped by A1), drop it now.
6. **`plan_slots.main_assignment_id` FK gains `ON DELETE SET NULL` (or `CASCADE`)** — surfaced during C1 Phase 9c apply. The original migration created `main_assignment_id uuid REFERENCES plan_main_assignments(id)` with no `ON DELETE` action, so cascading a `DELETE FROM plans` hits a FK constraint when Postgres tries to delete `plan_main_assignments` while `plan_slots` still references them. Cleanup scripts work around this by deleting `plan_days → plan_main_assignments → plans` in explicit order. Adding the cascade action closes the gap; `SET NULL` is the right semantic because the slot row can outlive its M-assignment in degenerate states (e.g. an in-flight swap that nulls the assignment but keeps the slot row).
7. Any other small cleanup discovered during phases A-D batched here (TBD per phase outcomes).
8. Repository + service files renamed: `day-overrides.repository.ts` → `plan-day-context.repository.ts`; same for service.

## Dependencies & Context

**Design references:**
- Authoritative: canonical `§8.1` (day_overrides → plan_day_context rename + enum trim) and `§10.5` (Phase E scope)
- Breakdown: phase-4 doc Story E1

**Story dependencies:** C1 must merge first (pause-overlapping values must have moved to `plan_days.paused_at` first; otherwise the DELETE in this story drops live data).

**Downstream blockers:** None — this is the final phase.

**Key invariants:**
- Renaming a table is purely cosmetic; semantic stays the same
- Pause-overlapping enum values were doing two jobs; canonical model splits them — this story finishes that split

## Tasks / Subtasks

### Task 1 — Table rename

- [ ] Create `supabase/migrations/<timestamp>_plan_day_context_rename.sql`
- [ ] `ALTER TABLE day_overrides RENAME TO plan_day_context;`
- [ ] Indexes and RLS policies follow the rename automatically; verify no orphan references

### Task 2 — Enum swap (non-trivial — Postgres can't drop enum values directly)

- [ ] Create the new enum:
  ```sql
  CREATE TYPE plan_day_context_type AS ENUM (
    'half_day', 'field_trip', 'post_dentist',
    'early_release', 'sport_practice', 'test_day'
  );
  ```
- [ ] Delete rows with deprecated values (C1 should have already migrated, but guard against stragglers):
  ```sql
  DELETE FROM plan_day_context WHERE override_type IN ('bag_suspended', 'sick_day');
  ```
- [ ] Swap the column type:
  ```sql
  ALTER TABLE plan_day_context
    ALTER COLUMN override_type TYPE plan_day_context_type
    USING override_type::text::plan_day_context_type;
  ```
- [ ] Rename column:
  ```sql
  ALTER TABLE plan_day_context RENAME COLUMN override_type TO context_type;
  ```
- [ ] Drop old enum:
  ```sql
  DROP TYPE day_override_type;
  ```

### Task 3 — recipes.instructions catch-up (defensive)

- [ ] `grep` for `recipes.instructions` references; if any remain, audit + fix
- [ ] If the column still exists in DB (shouldn't after A1):
  ```sql
  ALTER TABLE recipes DROP COLUMN IF EXISTS instructions;
  ```

### Task 3b — plan_slots.main_assignment_id cascade fix (surfaced by C1 9c)

- [ ] Add ON DELETE SET NULL to the existing FK:
  ```sql
  ALTER TABLE plan_slots
    DROP CONSTRAINT plan_slots_main_assignment_id_fkey,
    ADD CONSTRAINT plan_slots_main_assignment_id_fkey
      FOREIGN KEY (main_assignment_id)
      REFERENCES plan_main_assignments(id)
      ON DELETE SET NULL;
  ```
- [ ] Verify the plan_slots CHECK constraint still permits `main_assignment_id = NULL` only for non-main slots; the migration as-written requires it NOT NULL when `slot_kind = 'main'`. Decision moment:
  - Option A: keep the CHECK strict and use ON DELETE CASCADE instead (the slot dies with its M-assignment — usually desired)
  - Option B: relax the CHECK to allow `main` slots with NULL main_assignment_id transiently (matches SET NULL semantics; messier rendering invariant for the UI)
  Pick CASCADE unless a specific use case for SET NULL emerges.
- [ ] Delete `scripts/clear-load-test-plans.ts`'s manual dependency-order
  cleanup (it works around this gap); replace with the simpler
  `DELETE FROM plans WHERE household_id = '...'` once cascade lands.
- [ ] Re-test the load-test cleanup path after the migration applies.

### Task 4 — File renames

- [ ] `apps/api/src/modules/plans/day-overrides.repository.ts` → `plan-day-context.repository.ts`
- [ ] `apps/api/src/modules/plans/day-overrides.repository.test.ts` → `plan-day-context.repository.test.ts`
- [ ] `apps/api/src/modules/plans/day-overrides.service.ts` → `plan-day-context.service.ts`
- [ ] `apps/api/src/modules/plans/day-overrides.service.test.ts` → `plan-day-context.service.test.ts`
- [ ] Update all import statements across the codebase

### Task 5 — Contracts

- [ ] `packages/contracts/src/day-override.ts` → rename to `plan-day-context.ts`
- [ ] `DayOverrideTypeSchema` → renamed `PlanDayContextTypeSchema`; values match new enum
- [ ] Update import statements

### Task 6 — Final orphan cleanup

- [ ] `grep -rn "day_overrides\|DayOverride\|override_type" apps/api/src` — should return 0 hits
- [ ] Fix any stragglers

## Test Plan

- Rename test files; update enum value assertions
- Update day-override service tests to use new `context_type` name + reduced enum set
- Estimated: ~5 test changes

## Rollback

Revert PR. Restore old table name and enum values. The DELETEd rows from Task 2 are lost (acceptable per hard cutover; they should have been migrated to plan_days.paused_at in C1 anyway).

# Story 3-DM-C1: Plan structure — atomic cutover (the big one)

Status: planned

## Story

As Epic 3 data-model solutioning,
We want to atomically cut over from flat `plan_items` to the canonical 4-table tree (`plan_main_assignments` + `plan_days` + `plan_slots` + `plan_slot_variations`) in a single coordinated PR — including the orchestrator tool schema rewrite and planner prompt rewrite,
So that the family-first model has its first-class data home AND the bolt-on accumulation on `plan_items` retires entirely.

## Acceptance Criteria

1. All 7 new enums exist per `canonical §3.2`:
   - `weekday` (Mon-Sat, **including Saturday**)
   - `slot_kind` (main, snack, extra)
   - `extra_kind` (8 values per canonical)
   - `portion_size` (small, regular, large)
   - `texture_level` (soft, normal, diced, finger)
   - `spice_level` (mild, regular, spicy)
   - `pause_reason` (sick_day, holiday, snow_day, field_trip, half_day, other)
2. Four new tables exist with full constraints per `canonical §3.4–§3.7`:
   - `plan_main_assignments` (with `sequence BETWEEN 1 AND 6` per Q3)
   - `plan_days` (with pause consistency CHECK)
   - `plan_slots` (with XOR CHECK enforcing slot_kind ↔ FK presence)
   - `plan_slot_variations`
3. `commit_plan()` RPC rewritten per `canonical §3.9` discipline:
   - One transaction (never staged)
   - Insert order: plans → plan_main_assignments → plan_days → plan_slots → plan_slot_variations
   - Multi-row INSERTs per table (not per row)
   - Plans row UPDATE last (just before COMMIT)
4. `BriefStateComposer.refresh()` rewritten to read from the new tree per `canonical §9.1`.
5. `PlanComposeOutputSchema` in contracts rewritten to tree shape per `canonical §10.7`.
6. Orchestrator `plan.compose` tool schema updated to tree shape.
7. Planner prompt examples in `apps/api/src/agents/prompts/planner.prompt.ts` rewritten with at least 2 representative tree-shape examples (one shared-Main day, one allergen-fork split day).
8. Adjacent services migrated:
   - `plan-adjustment.service.ts` operates on `plan_slots` + `plan_slot_variations`
   - `day-overrides.service.ts` FK retargets to `plan_slot_id` (or `plan_day_id`); pause-overlapping types DROP here (move to paused_at on the appropriate row)
   - `variant-proposal.service.ts` FK retargets per Q4 (`plan_slot_variation_id` replaces `plan_item_id`)
9. `plan_items` table DROPPED (CASCADE drops old FK relationships).
10. `plans.week_id` column DROPPED (`week_of` is sole identifier).
11. Test factories from A3 updated to produce tree shape; old `buildPlanItem` removed.
12. **Pre-cutover gates passed**:
    - Load test on `commit_plan()`: 100 concurrent calls complete under p99 budget (TBD specify budget in implementation spec — propose 250ms p99 for 6-day plan with 18 variations)
    - Synthetic plan_compose runs validate tree-shape tool I/O against stubbed LLM responses

## Dependencies & Context

**Design references:**
- Authoritative: `canonical §3` (Plan Structure — full DDL for all 4 tables + enums) and `§3.9` (commit_plan pattern) and `§9` (query patterns) and `§10.7` (orchestrator + prompt scope)
- Breakdown: phase-4 doc Story C1

**Story dependencies:**
- **A1 must land** (recipe_steps + finish_time_minutes — referenced by plan_main_assignments FK chain)
- **A2 must land** (snack fold — `plan_slots.recipe_id` is the single FK for all slot kinds)
- **A3 must land** (test factories — refactor scope is huge without them)
- **B1 must land** (children profile attrs for variation auto-derivation by Lumi)
- **B2 must land** (household_allergens single-source for guardrail re-eval during commit)
- **D1 recommended** (plans.state instead of brief_state.plan_state — cleaner cutover)

**Downstream blockers:** C2 (cleanup), E1 (adjacent table cleanup that depends on C1's deletes).

**Key invariants:**
- All family-first memories apply: [[family-first-main-then-variations]], [[three-main-weekly-pattern]], [[three-slot-weighted-structure]], [[day-detail-action-vocabulary]], [[recipe-vs-method-distinction]], [[prep-and-finish-are-activity-modes]], [[cooking-time-budgets]]
- This is the ATOMIC migration — all schema + RPC + composer + orchestrator + prompt changes ship in ONE PR

## Tasks / Subtasks

### Task 1 — Schema creation

- [ ] Create `supabase/migrations/<timestamp>_plan_structure_canonical.sql`
- [ ] All 7 enum `CREATE TYPE` statements
- [ ] `CREATE TABLE plan_main_assignments (...)` per canonical §3.4
- [ ] `CREATE TABLE plan_days (...)` per canonical §3.5
- [ ] `CREATE TABLE plan_slots (...)` per canonical §3.6 with XOR-CHECK
- [ ] `CREATE TABLE plan_slot_variations (...)` per canonical §3.7
- [ ] All indexes per canonical sections
- [ ] RLS on all 4 new tables (service-role-only writes; authenticated SELECT inherits via plans household scope)

### Task 2 — RPC rewrite

- [ ] DROP old `commit_plan(uuid, uuid, uuid, varchar, integer, timestamptz, timestamptz, varchar, varchar, jsonb)`
- [ ] CREATE new `commit_plan()` function signature accepts tree-shaped jsonb
- [ ] Implement per `canonical §3.9` discipline:
  - Parents-first insert order
  - Multi-row INSERTs
  - Plans UPDATE last
  - Single transaction; no error catching at row level (let CHECK violations roll back the whole txn)

### Task 3 — Composer rewrite

- [ ] `BriefStateComposer.refresh()` rewritten per `canonical §9.1`:
  - 8 parallel reads via `Promise.all`: plan + main_assignments + plan_days + plan_slots + plan_slot_variations + children + suppression + ratings
  - Build payload tree in-memory
  - Single upsert via `briefStateRepo.upsert({ payload, plan_revision })`
- [ ] `BriefStateComposer.buildTileSummaries()` rewritten to walk the tree
- [ ] Old methods that operated on flat `plan_items` array removed

### Task 4 — Repository rewrite

- [ ] `PlansRepository`:
  - `findItemsByPlanId` REMOVED
  - `findItemById` REMOVED
  - NEW: `findMainAssignmentsByPlanId(planId)`
  - NEW: `findDaysByPlanId(planId)`
  - NEW: `findSlotsByDayId(dayId)` and `findSlotsByPlanId(planId)` (batch query)
  - NEW: `findVariationsBySlotIds(slotIds)`
  - NEW: `swapDays(planId, dayA, dayB)` — for canvas drag-drop (single UPDATE pair in txn per `canonical §9.3`)
  - NEW: `updateVariation(variationId, patch)` — per `canonical §9.4`
  - NEW: `pauseDayById(dayId, reason)` — per `canonical §9.5`
  - NEW: `pauseChildOnDay(childId, dayId)` — per `canonical §9.6`
  - NEW: `swapMain(mainAssignmentId, newRecipeId)` — per `canonical §9.7`
- [ ] `PlanComposeItemSchema` REMOVED
- [ ] `PlanItemRowSchema` REMOVED
- [ ] All `plan_items` table references in any code REMOVED

### Task 5 — Contracts rewrite

- [ ] `packages/contracts/src/plan.ts`:
  - `PlanComposeOutputSchema` rewritten to tree shape per `canonical §10.7` example
  - NEW schemas: `PlanMainAssignmentSchema`, `PlanDaySchema`, `PlanSlotSchema`, `PlanSlotVariationSchema`
  - OLD schemas removed: `PlanItemRowSchema`, `PlanComposeItemSchema`
- [ ] `packages/types/src/index.ts`: types regenerate
- [ ] All consumers update import statements

### Task 6 — Orchestrator + prompt rewrite

- [ ] `apps/api/src/agents/orchestrator.ts`: `plan.compose` tool I/O schema updated to tree shape
- [ ] `apps/api/src/agents/prompts/planner.prompt.ts`:
  - Replace flat-array examples with tree-shape examples (min 2: one shared-Main day, one allergen-fork day)
  - Update the system prompt to describe the new tree structure
- [ ] **Prompt rollback plan documented**: if bad-output rate >5% post-cutover, restore prompt-only to prior version while example library is refined
- [ ] Synthetic plan_compose runs (Vitest, stubbed LLM) validate tool I/O before live planner

### Task 7 — Adjacent services migration

- [ ] `plan-adjustment.service.ts`:
  - Operations targeting old plan_items → target plan_slots (slot-level) or plan_slot_variations (per-child)
- [ ] `day-overrides.service.ts`:
  - FK retarget: `day_overrides.plan_item_id` → `plan_slot_id` (or `plan_day_id` depending on override scope)
  - Pause-overlapping enum values DROPPED (`bag_suspended`, `sick_day` move to `plan_days.paused_at` + `paused_reason`)
- [ ] `variant-proposal.service.ts` per Q4:
  - Rename `plan_item_id` column → `plan_slot_variation_id`
  - Update FK to `plan_slot_variations(id)`
  - Update service write/read paths

### Task 8 — Plan generation job

- [ ] `apps/api/src/jobs/plan-generation.job.ts`:
  - `buildCommitInput()` builds the tree shape (not flat array)
  - Adapt to the new `commit_plan()` signature

### Task 9 — Drops

- [ ] `DROP TABLE plan_items CASCADE;` (acceptable per hard-cutover decision)
- [ ] `ALTER TABLE plans DROP COLUMN week_id;`
- [ ] Re-add proper FK constraints on `day_overrides` (or `plan_day_context` per E1) and `variant_proposals` to point at the new tree tables

### Task 10 — Pre-cutover gates

- [ ] **Load test gate**: spin up 100 concurrent `commit_plan()` calls against staging; assert p99 < specified budget (250ms proposed)
- [ ] **Synthetic plan_compose gate**: stub LLM responses with tree-shape outputs; validate tool I/O, schema parse, downstream commit
- [ ] Both gates must pass before the PR is mergeable

### Task 11 — Test factory updates

- [ ] `apps/api/test/factories/plan.factory.ts` REWRITTEN to produce tree shape
- [ ] OLD `buildPlanItem` REMOVED; REPLACED by `buildPlanSlot` + `buildPlanSlotVariation`
- [ ] NEW: `buildPlanMainAssignment`, `buildPlanDay`
- [ ] All plan-related tests refactored to use new factories (~60-80 test changes, mechanical via TypeScript-guided refactor)

## Test Plan

- ~60-80 test changes across plan tests, composer tests, orchestrator tests, day-overrides tests, variant-proposal tests, plan-adjustment tests
- TypeScript compiler is the primary breakage detector (all tests Vitest-mocked per Phase 3 Q3)
- New test additions:
  - Tree-shape `commit_plan()` integration test
  - Synthetic plan_compose with stubbed LLM (Task 6)
  - 100-concurrent load test scenario (Task 10)

## Rollback

Revert PR + restore from backup. **Pre-beta hard cutover** means this is acceptable per Menon 2026-05-31.

If cutover fails at the prompt regression layer (Task 6): restore the prior planner prompt while keeping the new schema/code (Lumi reverts to emitting v1 flat-array; the new schema accepts via translation shim — DOCUMENT THIS RESCUE PATH but don't build it unless cutover fails).

# Story 3-DM-A2: Snack SKU fold — migrate to recipes, drop snack_skus

Status: planned

## Story

As Epic 3 data-model solutioning,
We want to fold the `snack_skus` table into `recipes` (10 seed rows become recipes with `applicable_slots=['snack']`),
So that snack/main/extra all share one canonical catalog with one FK column (`plan_slots.recipe_id`) — the dual-FK pattern (`recipe_id` + `item_sku_id`) that Story 3.20 introduced retires cleanly.

## Acceptance Criteria

1. All 10 existing `snack_skus` seed rows exist in `recipes` with `applicable_slots = ['snack']`.
2. Allergen translation correct: `contains_peanut=true` → `recipes.allergen_flags` includes `'peanut'`; same for the other 8 FALCPA flags.
3. Compatibility translation correct: `is_halal=true` → `cultural_tags` includes `'halal'`; `is_kosher` → `'kosher'`; `is_vegetarian` → `dietary_flags` includes `'vegetarian'`; `is_vegan` → `'vegan'`.
4. Existing `plan_items.item_sku_id` non-null references repointed to `plan_items.recipe_id` pointing at the new recipes rows.
5. `plan_items.item_sku_id` column dropped.
6. `snack_skus` table dropped.
7. `SnackSkusRepository` file deleted from `apps/api/src/modules/plans/`.
8. `PlanComposeItemSchema.superRefine` (the `recipe_id`/`item_sku_id` XOR validator) removed from contracts.
9. Planner orchestrator emits `recipe_id` for snack-slot items (not `item_sku_id`); planner prompt examples updated.
10. NO `brand` or `is_packaged_item` columns added to recipes (per Q4 decision — trust the parent).

## Dependencies & Context

**Design references:**
- Authoritative: canonical `§4.4` (snack_skus fold rationale) and `§10.4` (Q4 decision)
- Breakdown: phase-4 doc Story A2

**Story dependencies:** **A1 must land first** — A2's recipe inserts need the `recipe_steps` table for any minimal "pack as-is" step (or recipes with zero steps are allowed; verify with A1 spec).

**Downstream blockers:** C1 (plan_slots.recipe_id is the single FK — pattern is established here).

**Key invariants:**
- [[shared-recipe-default]] — snacks are first-class within the recipes catalog after the fold.
- Story 3.20 retirement: the dual-FK pattern goes away; pre-beta hard cutover means no coexistence period.

## Tasks / Subtasks

### Task 1 — Allergen translation migration

- [ ] Create `supabase/migrations/<timestamp>_snack_skus_fold.sql`
- [ ] INSERT INTO recipes SELECT FROM snack_skus, translating columns:
  - Translate 9 `contains_*` booleans → `allergen_flags` via `ARRAY_REMOVE(ARRAY[...], NULL)` pattern (full SQL in phase-4 doc Story A2)
  - Translate `is_vegetarian/is_vegan` → `dietary_flags` similarly
  - Translate `is_halal/is_kosher` → `cultural_tags`
  - Set `applicable_slots = ARRAY['snack']`
  - Set `source = 'curated'`, `visibility = 'shared'`
  - `ON CONFLICT (id) DO NOTHING` for idempotency
- [ ] Confirm recipe row count after insert matches `snack_skus` source count

### Task 2 — Repoint plan_items references

- [ ] `UPDATE plan_items SET recipe_id = item_sku_id WHERE item_sku_id IS NOT NULL AND recipe_id IS NULL;`
- [ ] Verify no rows have both `recipe_id` AND `item_sku_id` non-null after update (XOR was enforced at Zod layer; should be clean)
- [ ] Capture row count for audit

### Task 3 — Drop column + table

- [ ] `ALTER TABLE plan_items DROP COLUMN item_sku_id;`
- [ ] `DROP TABLE snack_skus;`

### Task 4 — Code cleanup

- [ ] DELETE `apps/api/src/modules/plans/snack-skus.repository.ts`
- [ ] DELETE `apps/api/src/modules/plans/snack-skus.repository.test.ts`
- [ ] `apps/api/src/modules/plans/plans.service.ts`: remove `snackSkusRepository` dep + its uses
- [ ] `apps/api/src/agents/orchestrator.ts`: `plan.compose` tool emits `recipe_id` for snacks (drop `item_sku_id` field)
- [ ] `apps/api/src/agents/prompts/planner.prompt.ts`: snack-slot examples updated

### Task 5 — Contracts cleanup

- [ ] `packages/contracts/src/plan.ts`: `PlanComposeItemSchema` drops `item_sku_id`; remove the slot-conditional `superRefine` for SKU
- [ ] `PlanItemRowSchema` drops `item_sku_id`
- [ ] `packages/contracts/src/index.ts`: drop `SnackSkuSchema` export
- [ ] `packages/types/src/index.ts`: drop `SnackSku` type export

### Task 6 — Vocabulary cross-check

- [ ] Confirm the strings produced by translation (`'peanut'`, `'tree_nut'`, `'dairy'`, etc.) exist in `allergen_tags` vocabulary with `is_active = true`. Per `recipes` write convention, the service-layer validates these.
- [ ] If any string is missing from vocab: ADD via separate `INSERT INTO allergen_tags` in same migration

## Test Plan

- Delete `snack-skus.repository.test.ts`
- Update `plans.service.test.ts` snack-slot test cases to expect `recipe_id` not `item_sku_id`
- Update `orchestrator.test.ts` snack examples
- Update `plan-generation.job.test.ts` if it covers snack-slot composition
- Estimated: ~10 test changes; all Vitest mocks

## Rollback

Revert PR. Pre-beta hard cutover means we don't expect to roll back — but if needed:
1. Restore `snack_skus` table from canonical `§4.4` historic schema
2. Re-insert the 10 seed rows from `20260730000000_create_snack_skus_and_item_sku_id.sql`
3. The new recipes rows can stay (idempotent) — they just won't be referenced
4. Restore `plan_items.item_sku_id` column + re-derive from `recipe_id` via reverse-mapping

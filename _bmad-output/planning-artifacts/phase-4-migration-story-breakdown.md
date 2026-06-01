---
status: phase-4-draft
date: 2026-05-31
author: Menon (with Sally facilitating)
phase: 4
scope: |
  Decomposes the canonical lunch-planning data model (canonical-data-model-design.md)
  into 9 migration stories across 5 phases. Each story carries pre-conditions,
  acceptance criteria, migration SQL outline, code-touch inventory, test-suite delta,
  and rollback path. Designed so Epic-3 solutioning can pick stories up and slice
  them into implementation tickets without re-deriving design rationale.
project_name: HiveKitchen
inputs:
  - canonical-data-model-design.md (Phase 3 final — the authoritative design reference)
  - current-data-model-snapshot.md (Phase 1 inventory)
  - ux-design-spec-family-first-lunch.md
---

# Phase 4 — Migration Story Breakdown

**How to use this doc.** Each story below is a self-contained unit of work — bounded scope, explicit dependencies, clear acceptance criteria. Epic 3 solutioning can pick any story, expand it into Slice files, and hand it to Amelia. Full DDL specifications live in `canonical-data-model-design.md` (referenced as `canonical §X.Y` below); this doc focuses on the **work** — what changes, what depends on what, what rolls back.

**Sequencing reminder:**
```
A (3 stories) ──┬─→ C (2 stories) ──→ E (1 story)
                │
B (2 stories) ──┤
                │
D (1 story) ────┘
```

Phases A, B, D ship in parallel. Phase C waits for A and B (recipes + children must be canonical before plan structure can reference them). Phase E is the final cleanup pass.

**Total:** 9 stories. ~3 sprints if A/B/D run parallel with available capacity.

---

## Phase A — Recipe & Snack canonical + test factories + Saturday audit

*Sprint 1. Parallel-safe with B and D.*

### Story A1 — Recipe canonical: structured method steps + finish_time_minutes

**Dependencies:** none — starts immediately.

**Acceptance criteria:**
1. `recipes.finish_time_minutes int CHECK (>=0)` column exists; existing rows have `NULL` until next recipe-agent fetch populates.
2. `recipe_steps` table exists per `canonical §4.3` (id, recipe_id FK, sequence smallint UNIQUE per recipe, mode `step_mode` enum, text 1–600 chars). Two indexes: `(recipe_id, sequence)` and `(recipe_id, mode)`.
3. `step_mode` enum exists: `('prep', 'finish')`.
4. All pre-migration `recipes.instructions` jsonb arrays backfilled into `recipe_steps` rows. Mode default: `'prep'` for all backfilled steps (Lumi re-tags on next fetch via story 3-31).
5. `recipes.instructions` column dropped.
6. RecipesRepository updated to read/write recipe_steps via the `RecipeAgent.extractMethod()` pathway.
7. All recipe-related tests still green.

**Migration SQL outline:**
```sql
-- Up
CREATE TYPE step_mode AS ENUM ('prep', 'finish');
ALTER TABLE recipes ADD COLUMN finish_time_minutes int CHECK (finish_time_minutes >= 0);
CREATE TABLE recipe_steps (...);  -- full DDL in canonical §4.3
CREATE INDEX recipe_steps_recipe_seq_idx ON recipe_steps (recipe_id, sequence);
CREATE INDEX recipe_steps_recipe_mode_idx ON recipe_steps (recipe_id, mode);

-- Backfill (one-shot script — apps/api/scripts/backfill-recipe-steps.ts)
-- For each recipe with non-null instructions jsonb array:
--   For each element with index i: INSERT INTO recipe_steps (recipe_id, sequence, mode, text) VALUES (?, i+1, 'prep', element)
-- Service-role only; bypasses RLS.

-- Down
ALTER TABLE recipes DROP COLUMN finish_time_minutes;
DROP TABLE recipe_steps;
DROP TYPE step_mode;

-- Post-backfill verification (gate before drop):
-- SELECT count(*) FROM recipes WHERE instructions IS NOT NULL AND id NOT IN (SELECT DISTINCT recipe_id FROM recipe_steps);
-- Must return 0.

-- After verification passes:
ALTER TABLE recipes DROP COLUMN instructions;
```

**Code-touch inventory:**
- `supabase/migrations/<timestamp>_recipe_canonical.sql` (new)
- `apps/api/scripts/backfill-recipe-steps.ts` (new)
- `apps/api/src/modules/recipe/recipes.repository.ts` — add `findStepsByRecipeId()`, update `insertRecipe()` to write recipe_steps, remove `instructions` from `RecipeRow`
- `apps/api/src/modules/recipe/recipe.service.ts` — wire RecipeAgent.extractMethod → recipe_steps insert
- `apps/api/src/agents/recipe-agent.ts` — emit structured steps with mode tags (extends slice 2.6-s3 work)
- `packages/contracts/src/recipe.ts` — `RecipeRowSchema` drops `instructions`; new `RecipeStepSchema` + `RecipeStepsArraySchema`; `RecipeAgentExtractionSchema` updated to emit structured steps

**Test-suite delta:**
- All recipe.repository tests that mock `instructions` → update to mock `recipe_steps` queries
- New unit tests for `recipe_steps` CRUD via repository
- RecipeAgent extraction tests update to validate mode-tagged step emission
- Estimated: ~15-20 test changes; all mocked (per Phase 3 Q3 — no real-DB sequencing)

**Rollback:** revert PR. Re-add `instructions` column if needed (down migration restores). Re-deploy. Recipe-agent reverts to emitting `instructions` jsonb.

---

### Story A2 — Snack SKU fold: migrate to recipes, drop snack_skus

**Dependencies:** A1 must land first (`recipe_steps` table exists for the snack inserts that need minimal "pack as-is" steps).

**Acceptance criteria:**
1. All 10 `snack_skus` seed rows exist in `recipes` with `applicable_slots = ['snack']`.
2. Allergen translation correct: `contains_peanut=true` → `allergen_flags` includes `'peanut'`, etc. (9-way mapping documented in migration comments).
3. Compatibility translation correct: `is_halal=true` → `cultural_tags` includes `'halal'`; `is_kosher` → `'kosher'`; `is_vegetarian` → `dietary_flags` includes `'vegetarian'`; `is_vegan` → `'vegan'`.
4. Existing `plan_items.item_sku_id` references repointed to `plan_items.recipe_id` (pointing at the new recipes rows).
5. `plan_items.item_sku_id` column dropped.
6. `snack_skus` table dropped.
7. `SnackSkusRepository` deleted from codebase.
8. `PlanComposeItemSchema.superRefine` (the recipe_id/item_sku_id XOR validator) removed from contracts.
9. Planner orchestrator emits `recipe_id` for snack-slot items (not `item_sku_id`).

**Migration SQL outline:**
```sql
-- Up
-- 1. Insert snack_skus seed rows as recipes
INSERT INTO recipes (id, canonical_name, ingredients, ingredient_keys, primary_ingredient_key,
                     allergen_flags, dietary_flags, cultural_tags, cuisine_tags,
                     applicable_slots, source, visibility, is_active)
SELECT
  id,
  name,
  '[]'::jsonb,  -- snacks have no structured ingredients in the original SKU schema
  ARRAY[]::text[],
  NULL,
  -- Translate 9 booleans into allergen_flags array
  ARRAY_REMOVE(ARRAY[
    CASE WHEN contains_peanut    THEN 'peanut'    ELSE NULL END,
    CASE WHEN contains_tree_nut  THEN 'tree_nut'  ELSE NULL END,
    CASE WHEN contains_dairy     THEN 'dairy'     ELSE NULL END,
    CASE WHEN contains_egg       THEN 'egg'       ELSE NULL END,
    CASE WHEN contains_wheat     THEN 'wheat'     ELSE NULL END,
    CASE WHEN contains_soy       THEN 'soy'       ELSE NULL END,
    CASE WHEN contains_fish      THEN 'fish'      ELSE NULL END,
    CASE WHEN contains_shellfish THEN 'shellfish' ELSE NULL END,
    CASE WHEN contains_sesame    THEN 'sesame'    ELSE NULL END
  ], NULL),
  ARRAY_REMOVE(ARRAY[
    CASE WHEN is_vegetarian THEN 'vegetarian' ELSE NULL END,
    CASE WHEN is_vegan      THEN 'vegan'      ELSE NULL END
  ], NULL),
  ARRAY_REMOVE(ARRAY[
    CASE WHEN is_halal  THEN 'halal'  ELSE NULL END,
    CASE WHEN is_kosher THEN 'kosher' ELSE NULL END
  ], NULL),
  ARRAY[]::text[],
  ARRAY['snack']::text[],
  'curated',
  'shared',
  is_active
FROM snack_skus
ON CONFLICT (id) DO NOTHING;  -- idempotent for re-runs

-- 2. Repoint plan_items.item_sku_id → recipe_id
UPDATE plan_items
SET recipe_id = item_sku_id
WHERE item_sku_id IS NOT NULL AND recipe_id IS NULL;

-- 3. Drop the now-unused column + table
ALTER TABLE plan_items DROP COLUMN item_sku_id;
DROP TABLE snack_skus;

-- Down (best-effort — hard cutover so we don't expect to use this)
-- Restore snack_skus table from canonical §4.4 historic schema (would need to refetch)
-- The recipes rows can stay; they're idempotent.
```

**Code-touch inventory:**
- `supabase/migrations/<timestamp>_snack_skus_fold.sql` (new)
- `apps/api/src/modules/plans/snack-skus.repository.ts` — DELETE file
- `apps/api/src/modules/plans/snack-skus.repository.test.ts` — DELETE file
- `apps/api/src/modules/plans/plans.service.ts` — remove `snackSkusRepository` dep, update planner-emit handling
- `apps/api/src/agents/orchestrator.ts` — update plan.compose tool to emit `recipe_id` for snacks instead of `item_sku_id`
- `apps/api/src/agents/prompts/planner.prompt.ts` — update snack-slot examples
- `packages/contracts/src/plan.ts` — `PlanComposeItemSchema` drops `item_sku_id`; `superRefine` simplified; `PlanItemRowSchema` drops `item_sku_id`
- `packages/contracts/src/index.ts` — drop `SnackSkuSchema` export
- `packages/types/src/index.ts` — drop `SnackSku` type export

**Test-suite delta:**
- Delete `snack-skus.repository.test.ts`
- Update `plans.service.test.ts` snack-slot test cases to expect `recipe_id` not `item_sku_id`
- Update `orchestrator.test.ts` snack examples
- Estimated: ~10 test changes

**Rollback:** revert PR. Hard cutover means we don't expect to roll back; if needed, the 10 seed snack_skus rows can be re-inserted via the original migration script.

---

### Story A3 — Test factories + Saturday-support audit

**Dependencies:** none — can start in parallel with A1.

**Acceptance criteria:**
1. New module `apps/api/test/factories/index.ts` exists with these named exports: `buildPlan`, `buildPlanItem` (for current shape — will be swapped to tree-shape factories in C1), `buildBriefState`, `buildChild`, `buildRecipe`.
2. All existing inline `buildPlanRow`, `buildPlanItem`, `buildPlanRowOverrides` helpers in test files are deleted; tests import from the factories module.
3. Factory functions accept `Partial<T>` overrides and return fully-populated rows with sensible defaults.
4. **Saturday audit findings + fixes:**
   - `PlanComposeDaySchema` in `packages/contracts/src/plan.ts` enum updated to include `'saturday'`
   - `deriveWeekId` and `getCurrentWeekMonday` reviewed; if either special-cases Mon-Fri only, fix
   - `brief-state.composer.ts` `SCHOOL_DAYS` constant remains Mon-Sat (already correct; verify)
   - Planner prompt examples updated to include Saturday in at least one example plan
   - Client-side `WallCardSwipeStack` and any 5-day grid renderers reviewed for hardcoded 5-column assumptions
   - Cron schedules (plan-generation, lunch-link-key-rotation, day-override-revert) reviewed for Mon-Fri assumptions
5. A `_bmad-output/implementation-artifacts/saturday-audit-findings.md` doc lists every grep result + fix applied + items intentionally left as Mon-Fri (with reasoning).

**Migration SQL outline:** none — this story is purely code + tests + audit.

**Code-touch inventory:**
- `apps/api/test/factories/index.ts` (new)
- `apps/api/test/factories/plan.factory.ts` (new)
- `apps/api/test/factories/recipe.factory.ts` (new)
- `apps/api/test/factories/child.factory.ts` (new)
- `apps/api/test/factories/brief-state.factory.ts` (new)
- All 10 test files identified in Phase 3 Q2 — refactor to import from factories
- `packages/contracts/src/plan.ts` — `PlanComposeDaySchema` enum
- `apps/api/src/agents/prompts/planner.prompt.ts` — Saturday in examples
- `apps/web/src/features/day-detail/data/multiChildMockData.ts` — verify Saturday support (likely already fine)
- Cron job files in `apps/api/src/jobs/` — review for Mon-Fri hardcoding

**Test-suite delta:**
- This story IS the test-suite delta for downstream phases. ~20-30 test files touched; refactor to import factories instead of inline builders. Net code reduction.

**Rollback:** revert PR. Tests fall back to inline builders. No DB impact.

---

## Phase B — Child Profile & Allergen consolidation

*Sprint 1. Parallel-safe with A and D.*

### Story B1 — Child profile attributes + bag_composition_pattern enum promotion

**Dependencies:** none — starts immediately.

**Acceptance criteria:**
1. Three new enums exist: `appetite_level ('light', 'normal', 'heavy')`, `texture_needs ('soft', 'mixed', 'normal')`, `spice_tolerance ('mild', 'regular', 'spicy')`.
2. `bag_composition_pattern` enum exists with the 4 canonical values; the existing `children.bag_composition_pattern` text-with-CHECK column promoted to the enum (existing values map cleanly).
3. `children` table has new columns: `appetite_level appetite_level NOT NULL DEFAULT 'normal'`, `texture_needs texture_needs NOT NULL DEFAULT 'normal'`, `spice_tolerance spice_tolerance NOT NULL DEFAULT 'mild'`.
4. `children.bag_composition_pattern` is NOT NULL DEFAULT `'main_plus_snack_plus_extra'` (was nullable text).
5. Drops: `children.bag_composition` (jsonb, superseded by enum), `children.allergen_rule_version` (versioning moves to allergen_tags vocab).
6. ChildrenRepository updated to read/write new columns; old `bag_composition` read paths removed.
7. Onboarding moments that capture these attributes (if any exist; otherwise deferred to Epic 3 onboarding story) updated.

**Migration SQL outline:**
```sql
-- Up
CREATE TYPE appetite_level AS ENUM ('light', 'normal', 'heavy');
CREATE TYPE texture_needs AS ENUM ('soft', 'mixed', 'normal');
CREATE TYPE spice_tolerance AS ENUM ('mild', 'regular', 'spicy');
CREATE TYPE bag_composition_pattern AS ENUM (
  'main_only', 'main_plus_snack', 'main_plus_extra', 'main_plus_snack_plus_extra'
);

ALTER TABLE children
  ADD COLUMN appetite_level   appetite_level NOT NULL DEFAULT 'normal',
  ADD COLUMN texture_needs    texture_needs  NOT NULL DEFAULT 'normal',
  ADD COLUMN spice_tolerance  spice_tolerance NOT NULL DEFAULT 'mild';

-- Promote bag_composition_pattern to enum
ALTER TABLE children DROP CONSTRAINT children_bag_composition_pattern_valid;
ALTER TABLE children ALTER COLUMN bag_composition_pattern TYPE bag_composition_pattern
  USING bag_composition_pattern::bag_composition_pattern;
ALTER TABLE children ALTER COLUMN bag_composition_pattern SET NOT NULL;
ALTER TABLE children ALTER COLUMN bag_composition_pattern SET DEFAULT 'main_plus_snack_plus_extra';

-- Drop superseded columns
ALTER TABLE children DROP CONSTRAINT children_bag_main_true;
ALTER TABLE children DROP COLUMN bag_composition;
ALTER TABLE children DROP COLUMN allergen_rule_version;

-- Down (rare; hard cutover)
ALTER TABLE children ADD COLUMN bag_composition jsonb NOT NULL DEFAULT '{"main":true,"snack":true,"extra":true}'::jsonb;
ALTER TABLE children ADD COLUMN allergen_rule_version text NOT NULL DEFAULT 'v1';
ALTER TABLE children DROP COLUMN appetite_level, texture_needs, spice_tolerance;
ALTER TABLE children ALTER COLUMN bag_composition_pattern TYPE text;
-- etc.
```

**Code-touch inventory:**
- `supabase/migrations/<timestamp>_child_profile_attrs.sql` (new)
- `apps/api/src/modules/children/children.repository.ts` — add columns to `CHILD_COLUMNS`, update Zod row schema
- `packages/contracts/src/children.ts` — extend `ChildSchema` with new enum fields; remove `bag_composition` jsonb shape
- `apps/api/src/modules/onboarding/onboarding-moment-*.ts` — if any moment captures these attributes, surface them (else flag for Epic 3 onboarding follow-up)
- `apps/api/src/agents/recipe-agent.ts` and orchestrator — use these attributes when proposing per-child variations (becomes load-bearing in C1)

**Test-suite delta:**
- Update children.repository.test.ts to expect new columns
- New unit tests for default values on insert
- Update onboarding service tests if moments capture attributes
- Use `buildChild` factory from A3 once that lands
- Estimated: ~8-10 test changes

**Rollback:** revert PR. Down migration restores `bag_composition` jsonb and `allergen_rule_version`. Default values backfill cleanly.

---

### Story B2 — Allergen consolidation: household_allergens + drop legacy columns + household_cultural_identifiers

**Dependencies:** none independent of B1 (can land in either order — same-day deploy preferred). Does NOT depend on A.

**Acceptance criteria:**
1. `household_allergens` table exists per `canonical §6.2` (id, household_id, nullable child_id, encrypted allergen, allergen_hash, source enum incl. `'child_medical'` for migrated child_allergens rows, optional reason, COALESCE-sentinel UNIQUE, 2 indexes).
2. `household_cultural_identifiers` table exists per `canonical §6.1` (household_id, cultural_tag, enforcement, source).
3. All `child_allergens` rows backfilled into `household_allergens` with `child_id` preserved, `source='child_medical'` (or original source if non-medical).
4. All `households.declared_allergens` (encrypted jsonb arrays) decrypted, then re-encrypted as individual `household_allergens` rows with `child_id=NULL`.
5. All `households.cultural_identifiers` decrypted, parsed, inserted as `household_cultural_identifiers` rows.
6. All `households.dietary_preferences` (encrypted jsonb arrays) decrypted and inserted into existing `dietary_preferences` table with `child_id=NULL`.
7. `child_allergens` table DROPPED.
8. `households.declared_allergens`, `households.cultural_identifiers`, `households.dietary_preferences` columns DROPPED.
9. `children.declared_allergens`, `children.cultural_identifiers`, `children.dietary_preferences` columns DROPPED.
10. AllergyGuardrailService updated: single query `SELECT allergen FROM household_allergens WHERE household_id = ?` replaces the previous multi-source assembly.

**Migration SQL outline:**
```sql
-- Up
CREATE TABLE household_allergens (...);  -- full DDL in canonical §6.2
CREATE INDEX household_allergens_household_idx ON household_allergens (household_id);
CREATE INDEX household_allergens_child_idx ON household_allergens (child_id) WHERE child_id IS NOT NULL;

CREATE TABLE household_cultural_identifiers (...);  -- full DDL in canonical §6.1

-- Backfill (one-shot Node script — apps/api/scripts/backfill-household-allergens.ts)
-- Step 1: Migrate child_allergens → household_allergens (1:1 with child_id preserved)
-- INSERT INTO household_allergens (id, household_id, child_id, allergen, allergen_hash, source, created_at, updated_at)
-- SELECT id, household_id, child_id, allergen, allergen_hash,
--   CASE WHEN source = 'onboarding_declared' THEN 'child_medical' ELSE source END,
--   created_at, updated_at
-- FROM child_allergens;

-- Step 2: For each household.declared_allergens row (encrypted jsonb):
--   - Decrypt to get jsonb array
--   - For each allergen string: encrypt + hash + INSERT into household_allergens with child_id=NULL
--   - source='backfill_migration'

-- Step 3: For each household.cultural_identifiers row:
--   - Decrypt to get jsonb array of cultural_tag values
--   - For each tag: INSERT INTO household_cultural_identifiers
--   - Validate against cultural_tags vocab table

-- Step 4: For each household.dietary_preferences row:
--   - Decrypt to get jsonb array
--   - For each tag: INSERT INTO dietary_preferences (existing table) with child_id=NULL
--   - Validate against dietary_tags vocab

-- Step 5 (gate before drops): verify counts match
-- expected_count = (SELECT count(*) FROM child_allergens) + (encrypted-decryption counts)
-- actual_count = (SELECT count(*) FROM household_allergens)
-- abort if mismatch

-- Step 6: drops
DROP TABLE child_allergens;
ALTER TABLE households DROP COLUMN declared_allergens, cultural_identifiers, dietary_preferences;
ALTER TABLE children   DROP COLUMN declared_allergens, cultural_identifiers, dietary_preferences;

-- Down (best-effort)
-- Restore child_allergens table; backfill from household_allergens WHERE child_id IS NOT NULL
-- Restore households encrypted columns; aggregate household_allergens WHERE child_id IS NULL into jsonb arrays + re-encrypt
-- Restore children encrypted columns (likely empty in production-of-pre-beta; can be NULLs)
```

**Code-touch inventory:**
- `supabase/migrations/<timestamp>_household_allergens_consolidation.sql` (new)
- `apps/api/scripts/backfill-household-allergens.ts` (new)
- `apps/api/src/modules/children/child-allergens.repository.ts` — replace with `household-allergens.repository.ts`
- `apps/api/src/modules/children/child-allergens.repository.test.ts` — replace
- `apps/api/src/modules/households/household-allergens.repository.ts` (new)
- `apps/api/src/modules/households/household-cultural-identifiers.repository.ts` (new)
- `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts` — collapse multi-source read into single household_allergens query
- `apps/api/src/modules/children/children.service.ts` — onboarding write paths route to household_allergens with child_id, household_cultural_identifiers
- `apps/api/src/modules/households/households.repository.ts` — drop encrypted-column read/write paths
- `packages/contracts/src/children.ts` — drop encrypted-array fields from ChildSchema
- `packages/contracts/src/index.ts` — new `HouseholdAllergenSchema`, `HouseholdCulturalIdentifierSchema`

**Test-suite delta:**
- Replace child_allergens tests with household_allergens tests (~15 test cases)
- Update guardrail tests to expect single-source query
- Update household-profile tests to drop encrypted-column assertions
- Estimated: ~25 test changes

**Rollback:** revert PR. Down migration restores tables. Backfill data loss is acceptable (pre-beta).

---

## Phase D — Brief State Cleanup

*Sprint 0.5. Parallel-safe with A and B.*

### Story D1 — Brief state payload consolidation + plan_state moves to plans

**Dependencies:** none — parallel-safe with A and B. Does NOT block C (C1 reads from plan_state on plans, which this story creates).

**Acceptance criteria:**
1. `plans` table has new columns: `state plan_state_enum NULL`, `state_set_at timestamptz NULL`, `state_message text CHECK (char_length(state_message) <= 500)`.
2. `brief_state.payload jsonb NOT NULL DEFAULT '{}'` column exists.
3. `BriefStatePayloadSchema` defined in `packages/contracts/src/brief-state.ts` (new file) — validates the structure that includes `tile_summaries`, `cleared_allergies`, `scaffolding_diff`, `plan_state_snapshot` mirror.
4. Existing `brief_state` jsonb columns (`plan_tile_summaries`, `cleared_allergies`, `scaffolding_diff`) one-shot migrated into `payload`.
5. Existing `brief_state.plan_state`, `plan_state_set_at`, `plan_state_message` migrated into `plans` table.
6. Columns dropped: `brief_state.plan_tile_summaries`, `brief_state.cleared_allergies`, `brief_state.scaffolding_diff`, `brief_state.plan_state`, `brief_state.plan_state_set_at`, `brief_state.plan_state_message`.
7. BriefStateComposer writes the new `payload` shape; reads `plans.state` (not brief_state.plan_state).
8. SSE plan_state event uses `plans.state` as the source.

**Migration SQL outline:**
```sql
-- Up
ALTER TABLE plans
  ADD COLUMN state plan_state_enum,
  ADD COLUMN state_set_at timestamptz,
  ADD COLUMN state_message text CHECK (state_message IS NULL OR char_length(state_message) <= 500);

ALTER TABLE brief_state ADD COLUMN payload jsonb NOT NULL DEFAULT '{}';

-- One-shot data migration
UPDATE plans p
SET state = bs.plan_state,
    state_set_at = bs.plan_state_set_at,
    state_message = bs.plan_state_message
FROM brief_state bs
WHERE bs.plan_id = p.id AND bs.plan_state IS NOT NULL;

UPDATE brief_state
SET payload = jsonb_build_object(
  'tile_summaries', plan_tile_summaries,
  'cleared_allergies', cleared_allergies,
  'scaffolding_diff', scaffolding_diff
);

-- Drops
ALTER TABLE brief_state
  DROP COLUMN plan_tile_summaries,
  DROP COLUMN cleared_allergies,
  DROP COLUMN scaffolding_diff,
  DROP COLUMN plan_state,
  DROP COLUMN plan_state_set_at,
  DROP COLUMN plan_state_message;

-- Down — restore columns + redistribute payload back
```

**Code-touch inventory:**
- `supabase/migrations/<timestamp>_brief_state_payload.sql` (new)
- `apps/api/src/modules/plans/brief-state.composer.ts` — single payload write replaces 3+ column writes
- `apps/api/src/modules/plans/brief-state.repository.ts` — schema update
- `apps/api/src/modules/plans/plans.repository.ts` — add state read/write methods
- `apps/api/src/modules/plans/plans.service.ts` — degraded-plan handler writes to plans.state (not brief_state.plan_state)
- `apps/api/src/agents/orchestrator.hook.ts` — SSE plan_state event sources from plans
- `packages/contracts/src/plan.ts` — `PlanRowSchema` gains state fields
- `packages/contracts/src/brief-state.ts` (new) — `BriefStatePayloadSchema`

**Test-suite delta:**
- BriefStateComposer.test.ts — refactor to assert single payload write
- plans.service.test.ts — degraded-plan tests assert state on plans, not brief_state
- Estimated: ~10 test changes

**Rollback:** revert PR. Down migration restores columns + redistributes payload back.

---

## Phase C — Plan Structure (atomic cutover)

*Sprint 1.5. Depends on A1, A2, B1, B2. (D1 strongly recommended but not strictly required — C1 can read brief_state without payload migration if needed.)*

### Story C1 — Plan structure: atomic cutover (the big one)

**Dependencies:** A1 (recipe_steps + finish_time_minutes), A2 (snack fold → recipe_id is single FK), B1 (children profile attrs for variation derivation), B2 (household_allergens single-source for guardrail). D1 not strict-required.

**Acceptance criteria:**
1. All 7 new enum types exist (`weekday` including Saturday, `slot_kind`, `extra_kind`, `portion_size`, `texture_level`, `spice_level`, `pause_reason`).
2. Four new tables exist with full constraints per `canonical §3.4-§3.7`: `plan_main_assignments`, `plan_days`, `plan_slots`, `plan_slot_variations`.
3. `commit_plan()` RPC rewritten per `canonical §3.9` discipline (one txn, parents-first, multi-row inserts, plans UPDATE last). Load test: 100 concurrent calls complete under p99 budget (specify budget in story spec).
4. `BriefStateComposer.refresh()` rewritten to read from the new tree (per `canonical §9.1`).
5. `PlanComposeOutputSchema` in contracts rewritten to tree shape (per `canonical §10.7`).
6. Orchestrator `plan.compose` tool schema updated to tree shape.
7. Planner prompt examples in `apps/api/src/agents/prompts/planner.prompt.ts` rewritten with at least 2 representative tree-shape examples (one shared-Main day, one allergen-fork day).
8. `plan-adjustment.service`, `day-overrides.service`, `variant-proposal.service` migrated to new tables (variant_proposals.plan_slot_variation_id replaces plan_item_id per Q4).
9. `plan_items` table DROPPED.
10. `plans.week_id` column DROPPED.
11. All plan-related tests use `buildPlan*` factories from A3 (now updated to produce tree shape).
12. Synthetic plan_compose runs validate tree-shape tool I/O against stubbed LLM responses (catches prompt regression before live planner).

**Migration SQL outline:**
```sql
-- Up — single atomic PR; this is a long migration
CREATE TYPE weekday AS ENUM ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday');
CREATE TYPE slot_kind AS ENUM ('main', 'snack', 'extra');
CREATE TYPE extra_kind AS ENUM ('drink', 'extra_snack', 'protein_boost', 'sports_add', 'sweet', 'toddler_safe', 'allergy_substitute', 'custom');
CREATE TYPE portion_size AS ENUM ('small', 'regular', 'large');
CREATE TYPE texture_level AS ENUM ('soft', 'normal', 'diced', 'finger');
CREATE TYPE spice_level AS ENUM ('mild', 'regular', 'spicy');
CREATE TYPE pause_reason AS ENUM ('sick_day', 'holiday', 'snow_day', 'field_trip', 'half_day', 'other');

CREATE TABLE plan_main_assignments (...);  -- canonical §3.4
CREATE TABLE plan_days (...);               -- canonical §3.5
CREATE TABLE plan_slots (...);              -- canonical §3.6 with XOR-CHECK
CREATE TABLE plan_slot_variations (...);    -- canonical §3.7

-- Drop the old function; create rewritten version
DROP FUNCTION commit_plan(uuid, uuid, uuid, varchar, integer, timestamptz, timestamptz, varchar, varchar, jsonb);
CREATE OR REPLACE FUNCTION commit_plan(...) RETURNS uuid LANGUAGE plpgsql AS $$ ... $$;  -- per §3.9 pattern

-- Hard cutover: drop plan_items (no production data per Menon 2026-05-31)
DROP TABLE plan_items CASCADE;  -- CASCADE drops day_overrides FK + variant_proposals FK; we'll re-add proper FKs

-- Drop plans.week_id (week_of is now sole identifier)
ALTER TABLE plans DROP COLUMN week_id;

-- Down — extensive; restore old plan_items table + commit_plan() + composer logic
```

**Code-touch inventory:**
- `supabase/migrations/<timestamp>_plan_structure_canonical.sql` (very large; one migration file)
- `apps/api/src/modules/plans/plans.repository.ts` — full rewrite; replace `PlanItemRow` queries with tree-walking queries
- `apps/api/src/modules/plans/brief-state.composer.ts` — full rewrite per `canonical §9.1`
- `apps/api/src/modules/plans/plans.service.ts` — `commit()` wraps new RPC; `swapItem` becomes `swapDay`+`updateVariation`
- `apps/api/src/modules/plans/plan-adjustment.service.ts` — operates on plan_slots + plan_slot_variations now
- `apps/api/src/modules/plans/day-overrides.service.ts` — FK retarget (plan_item_id → plan_slot_id); pause-overlapping types DROPPED here too (those move to plan_days.paused_at / plan_slot_variations.paused_at)
- `apps/api/src/modules/plans/variant-proposal.service.ts` — FK retarget per Q4 (plan_item_id → plan_slot_variation_id)
- `apps/api/src/modules/plans/lunch-link-session.repository.ts` — if it references plan_items, update
- `apps/api/src/agents/orchestrator.ts` — tool schema rewrite for plan.compose
- `apps/api/src/agents/prompts/planner.prompt.ts` — full prompt example rewrite for tree shape
- `apps/api/src/jobs/plan-generation.job.ts` — `buildCommitInput()` builds the tree, not flat array
- `packages/contracts/src/plan.ts` — `PlanComposeOutputSchema` tree; `PlanItemRowSchema` deleted; new `PlanMainAssignmentSchema`, `PlanDaySchema`, `PlanSlotSchema`, `PlanSlotVariationSchema`
- `apps/api/test/factories/plan.factory.ts` — refactor to produce tree shape; old `buildPlanItem` removed (replaced by `buildPlanSlot` + `buildPlanSlotVariation`)
- All plan-related test files — update to use new factories + assert against new tree shape
- `apps/web/src/features/day-detail/data/multiChildMockData.ts` — already tree-shaped; mock stays; production hooks update

**Test-suite delta:**
- ~60-80 test changes across plan tests, composer tests, orchestrator tests, day-overrides tests, variant-proposal tests, plan-adjustment tests
- TypeScript compiler is the primary breakage detector (all tests mocked — Phase 3 Q3 finding)
- Net: tests get simpler (factories handle the tree; assertions are tree-walks not array-iterations)

**Pre-cutover gates:**
1. Load test on `commit_plan()`: 100 concurrent calls, p99 latency budget met
2. Synthetic plan_compose runs against stubbed LLM responses validating tree shape

**Rollback path:** revert PR + restore from backup. **Pre-beta this is acceptable** per Menon 2026-05-31. Production launch is Oct 1; if cutover fails badly, we have multiple sprints of buffer.

---

### Story C2 — Phase C cleanup

**Dependencies:** C1.

**Acceptance criteria:**
1. Any test breakage discovered post-C1 merge is fixed.
2. Load-test findings from §3.9 gate are addressed (e.g., index tuning if commit_plan() falls outside p99 budget).
3. Planner-prompt regression metrics in place: bad-output rate instrumented; rollback prompt-only path documented.
4. Any orphaned references to removed columns (`plan_items.*`, `plans.week_id`, `brief_state.plan_state*`) cleaned up.

**Migration SQL outline:** none — code cleanup only.

**Code-touch inventory:** TBD per C1's actual blast radius.

**Test-suite delta:** TBD.

**Rollback:** revert specific fixes; C1 stays.

---

## Phase E — Adjacent table cleanup

*Sprint 0.5. Final pass.*

### Story E1 — Adjacent table cleanup

**Dependencies:** C1 (variant_proposals FK retargeting must happen as part of C1, not here; this story just renames day_overrides and trims its enum).

**Acceptance criteria:**
1. `day_overrides` table renamed to `plan_day_context`.
2. Pause-overlapping `day_override_type` enum values dropped: `'bag_suspended'` and `'sick_day'` (those moved to `plan_days.paused_at` + `paused_reason` in C1).
3. Remaining `day_override_type` values: `'half_day'`, `'field_trip'`, `'post_dentist'`, `'early_release'`, `'sport_practice'`, `'test_day'`.
4. If `recipes.instructions` column still exists (didn't drop in A1), drop it now.
5. Any other small cleanup discovered during phases A-D batched here.

**Migration SQL outline:**
```sql
ALTER TABLE day_overrides RENAME TO plan_day_context;

-- Enum value drop is non-trivial; create new enum + swap
CREATE TYPE plan_day_context_type AS ENUM (
  'half_day', 'field_trip', 'post_dentist',
  'early_release', 'sport_practice', 'test_day'
);

-- Remove rows with the deprecated values first (or migrate to plan_days.paused_at if needed)
DELETE FROM plan_day_context WHERE override_type IN ('bag_suspended', 'sick_day');

ALTER TABLE plan_day_context ALTER COLUMN override_type TYPE plan_day_context_type
  USING override_type::text::plan_day_context_type;
DROP TYPE day_override_type;

ALTER TABLE plan_day_context RENAME COLUMN override_type TO context_type;
```

**Code-touch inventory:**
- `supabase/migrations/<timestamp>_plan_day_context_rename.sql` (new)
- `apps/api/src/modules/plans/day-overrides.repository.ts` → rename to `plan-day-context.repository.ts`
- `apps/api/src/modules/plans/day-overrides.service.ts` → rename to `plan-day-context.service.ts`
- All call sites for the renamed module

**Test-suite delta:**
- Rename test files; update enum value assertions
- Estimated: ~5 test changes

**Rollback:** revert PR. Restore old table/enum names.

---

## Dependency graph (visual)

```
A1 ──────┬─→ A2
         │
         └─→ A3 ──┐
                  │
                  ├──→ C1 ──→ C2 ──→ E1
                  │
B1 ──────┬─→ B2 ──┤
         │        │
         ─────────┤
                  │
D1 ───────────────┘
```

A1 is the only true blocker for A2 (snack fold needs recipe_steps for minimal "pack as-is" rows). A3 (factories + Saturday audit) is parallel-safe with A1/A2. B1 and B2 are independent of A. D1 is independent of all. **C1 needs A2 + B1 + B2 + A3 (factories for tests) at minimum; D1 strongly recommended.** E1 closes after C2.

## Sprint allocation (proposed)

| Sprint | Stories |
|---|---|
| **Sprint 1** | A1, A2, A3, B1, B2, D1 — all 6 ship in parallel with adequate team capacity |
| **Sprint 2** | C1 (the big atomic cutover; includes the load-test gate) |
| **Sprint 3** | C2 (cleanup) + E1 — finishing pass |

**Net: 3 sprints (6-8 weeks).** Comfortable fit inside the 5-month pre-Oct-1 window with iteration room.

## How Epic 3 solutioning picks this up

Each story above is ready to be expanded into Slice files following the existing project pattern (`_bmad-output/implementation-artifacts/<slice-id>-<short-name>.md`). The acceptance criteria become the slice's AC list; the migration SQL outline becomes the slice's "DB changes" section; the code-touch inventory becomes the slice's "Files touched" table.

For each story, the canonical-data-model-design.md is the authoritative design reference — slices should LINK to specific canonical §X.Y sections rather than duplicating the design rationale. This keeps slice files focused on **what to do** and prevents the design rationale from drifting across multiple artifacts.

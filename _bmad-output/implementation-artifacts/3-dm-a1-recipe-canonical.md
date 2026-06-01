# Story 3-DM-A1: Recipe canonical — structured method steps + finish_time_minutes

Status: done

## Story

As Epic 3 data-model solutioning,
We want to give recipes a structured method shape (`recipe_steps` with mode tags) and a `finish_time_minutes` column,
So that the Wall Card's Prep/Finish toggle has a real data backing and the dual-budget design (Finish ≤15 / Total ≤40) can be enforced at the recipe layer.

## Acceptance Criteria

1. `recipes.finish_time_minutes int CHECK (>=0)` column exists. Existing rows have `NULL` until next recipe-agent fetch populates.
2. `recipe_steps` table exists per `canonical-data-model-design.md §4.3` (id, recipe_id FK ON DELETE CASCADE, sequence smallint UNIQUE per recipe, mode `step_mode` enum, text 1–600 chars). Two indexes: `(recipe_id, sequence)` and `(recipe_id, mode)`.
3. `step_mode` enum exists with values `('prep', 'finish')`.
4. All pre-migration `recipes.instructions` jsonb arrays backfilled into `recipe_steps` rows. Default mode `'prep'` for all backfilled steps; Lumi re-tags on next recipe-agent fetch (story 3-31 owns mode tagging going forward).
5. `recipes.instructions` column dropped after backfill verification (gate query returns zero rows).
6. `RecipesRepository` updated to read/write `recipe_steps` via the `RecipeAgent.extractMethod()` pathway; `findStepsByRecipeId(recipeId)` returns steps ordered by `sequence`.
7. `RecipeRowSchema` in contracts drops `instructions`; new `RecipeStepSchema` exported.
8. All recipe-related tests still green via the test factories (depends on A3 if running tests; otherwise use existing fixture patterns).

## Dependencies & Context

**Design references:**
- Authoritative: `_bmad-output/planning-artifacts/canonical-data-model-design.md` §4.1–§4.3 (recipe shape) and §10.5 (Phase A scope)
- Breakdown: `_bmad-output/planning-artifacts/phase-4-migration-story-breakdown.md` Story A1
- Snapshot context: `_bmad-output/planning-artifacts/current-data-model-snapshot.md` §1.4 (current recipes shape with opaque instructions jsonb)

**Story dependencies:** none — starts immediately.

**Downstream blockers:** A2 (snack fold needs recipe_steps for minimal seed rows); C1 (plan structure references finish_time_minutes via plan-level rollup).

**Key invariants:**
- [[recipe-vs-method-distinction]] — Recipe always shown; Method only when cook doesn't know it. Structured `recipe_steps` is the data backing for this distinction.
- [[prep-and-finish-are-activity-modes]] — mode tag on each step (prep | finish) is what the Wall Card filter consumes.

## Tasks / Subtasks

### Task 1 — Schema additions

- [ ] Create `supabase/migrations/<timestamp>_recipe_canonical.sql`
- [ ] `CREATE TYPE step_mode AS ENUM ('prep', 'finish');`
- [ ] `ALTER TABLE recipes ADD COLUMN finish_time_minutes int CHECK (finish_time_minutes >= 0);`
- [ ] `CREATE TABLE recipe_steps (...)` per canonical §4.3 full DDL
- [ ] `CREATE INDEX recipe_steps_recipe_seq_idx ON recipe_steps (recipe_id, sequence);`
- [ ] `CREATE INDEX recipe_steps_recipe_mode_idx ON recipe_steps (recipe_id, mode);`
- [ ] RLS on `recipe_steps` mirrors `recipes` (service-role only writes; authenticated SELECT inherits via the recipe's RLS policy)

### Task 2 — Backfill script

- [ ] Create `apps/api/scripts/backfill-recipe-steps.ts`
- [ ] Iterate recipes WHERE `instructions IS NOT NULL`
- [ ] For each recipe, extract jsonb array, INSERT one row per step with `sequence = i+1`, `mode = 'prep'`, `text = element`
- [ ] Service-role client (bypasses RLS)
- [ ] Run as one-shot post-migration

### Task 3 — Backfill verification gate

- [ ] Run gate query:
  ```sql
  SELECT count(*) FROM recipes
  WHERE instructions IS NOT NULL AND id NOT IN (SELECT DISTINCT recipe_id FROM recipe_steps);
  ```
- [ ] Must return 0 before proceeding to Task 4
- [ ] Capture verification output in story PR description

### Task 4 — Drop instructions column

- [ ] Add to migration: `ALTER TABLE recipes DROP COLUMN instructions;`
- [ ] Ship in same PR as backfill (only after Task 3 passes)

### Task 5 — Repository + contract updates

- [ ] `RecipesRepository`: add `findStepsByRecipeId(recipeId): Promise<RecipeStep[]>`
- [ ] `RecipesRepository.insertRecipe()`: accept `steps: RecipeStep[]` param and write to `recipe_steps` in same transaction as recipe insert
- [ ] `packages/contracts/src/recipe.ts`: `RecipeRowSchema` drops `instructions`; export new `RecipeStepSchema`, `RecipeStepsArraySchema`
- [ ] `RecipeAgentExtractionSchema` updated so the agent emits structured `{ steps: [{ mode, text }] }` instead of flat `instructions`

### Task 6 — Recipe agent emit shape

- [ ] `RecipeAgent.extractMethod()` returns structured steps
- [ ] Agent prompt updated to ask LLM for `{ mode: 'prep'|'finish', text: '...' }` per step
- [ ] Conservative fallback: if LLM emits flat strings, default mode to `'prep'`

## Test Plan

- Update `recipes.repository.test.ts` to mock `recipe_steps` queries via `findStepsByRecipeId`
- New unit tests for `recipe_steps` CRUD (insert sequence collision, mode filter, cascade on recipe delete)
- Update RecipeAgent extraction tests to assert mode-tagged step emission
- Use `buildRecipe` factory from A3 once that lands (this story can land before A3; tests temporarily use inline `buildRecipe` + new inline `buildRecipeStep`)
- Estimated: ~15-20 test changes; all Vitest mocks (no real-DB sequencing)

## Rollback

Revert PR. Re-add `instructions` column via down migration (text jsonb default null). Existing recipes work normally. Recipe-agent reverts to emitting `instructions` jsonb.

Pre-beta hard cutover: backup recipes table before migration; restore from backup if rollback needed.

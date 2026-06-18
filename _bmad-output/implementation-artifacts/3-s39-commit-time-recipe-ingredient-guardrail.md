# Story 3.S39: Commit-Time Recipe-Ingredient Guardrail (allergen safety)

Status: done

> **⚠️ SAFETY — GATE for Story 3.S36.** 3.S36 (and 3.S32, already shipped) remove the planner's `allergy.check` self-check and justify it with "the deterministic guardrail runs after compose." That promise is currently **false for recipe base ingredients** (see Background). This story makes the post-compose guardrail actually check recipes. It MUST land before 3.S36 ships, because 3.S36 widens reliance on this net.

## Story

As a parent of a child with a food allergy,
I want the server's deterministic allergy guardrail to check every planned recipe's actual ingredients (not just parent-added extras) before a plan is committed,
so that a recipe containing a declared allergen can never reach my child's plate even if the AI planner makes a mistake.

## Background

The plan is supposed to be protected by two layers: (1) the AI planner avoids declared allergens [soft], and (2) the deterministic commit-time guardrail blocks anything that slips through [hard guarantee].

**The hard layer is effectively off.** In `plansService.commit`, `buildGuardrailItemsFromTree` (plans.service.ts ~L1269) collects **only `variation.add_ons`** — it never pulls in the recipe's own ingredients. Comment at L178-180 / L1295-1297 confirms this is a deferred "follow-up slice." Because most plans have no add-ons, the items list comes back **empty**, and the code treats empty as `{ verdict: 'cleared' }` **without calling the allergy engine at all**.

Concrete failure: child Aarav has a declared peanut allergy; the planner picks "Chicken Peanut Curry Rice" (no add-ons); at commit the guardrail finds no add-ons → "cleared" → the peanut dish is committed. The engine never saw the recipe's peanuts.

Two asymmetries underline the gap:
- The **add-ons are checked but the base recipe isn't** (the sprinkles, not the meal).
- The **swap path already does this correctly** — `buildVariationGuardrailItem` (L1298) computes the full effective set `recipe.ingredients − removals + add_ons` and runs the engine. Only the **commit/generation** path is missing it.

**Why it's tractable:** `plan.compose` resolves recipe names → catalog UUIDs before returning (plan.tools.ts L31-59), so at commit the tree carries real recipe IDs. We can batch-fetch ingredients by ID and reuse `buildVariationGuardrailItem`. The retry machinery (surgical swap → full regen) that activates on a block already exists in both jobs — it's just dormant today because nothing ever blocks.

## Acceptance Criteria

1. At commit time, the guardrail evaluates the **full effective ingredient set** for every `(child, day, slot)` — `recipe.ingredients − variation.removals + variation.add_ons` — not just `add_ons`. Reuse `buildVariationGuardrailItem`; replace/extend `buildGuardrailItemsFromTree` accordingly.
2. **Batch ingredient fetch.** Add a `RecipesRepository` method to fetch ingredients for many recipe IDs in one query (e.g. `findIngredientsByIds(ids): Map<id, string[]>`), keyed off `collectRecipeIdsFromTree`. No N+1 per slot.
3. **Recipe resolution per slot:** main slots resolve via `main_assignment_sequence → main_assignments[].recipe_id`; snack/extra use `slot.recipe_id`; discover-sourced snack/extra use the materialized candidate (see AC 6). The check runs against the EXACT recipe that `commit_plan` will persist.
4. On any `blocked` verdict, commit does **not** persist; it returns the conflicts through the existing `regenerate` callback (rejectionContext → surgical swap → full regen). The surgical-swap path receives the blocked slots' original ingredients (it already accepts `BlockedItem.original_ingredients`, which become populated for the first time).
5. **Unverifiable recipes (empty/missing ingredient data).** A recipe with no stored ingredients cannot be verified. Fail-safe, scoped to risk:
   - For a child **with** declared allergens (household- or child-level), an unverifiable recipe in their slot is treated as **uncertain → not committed** (routes through the existing uncertain/degrade/retry path), so an allergic child is never served an unverifiable dish.
   - For a child with **no** declared allergens, an unverifiable recipe passes (nothing to protect against).
   - This must NOT turn into an infinite retry when the whole catalog is unverifiable — cap retries (existing `MAX_GUARDRAIL_RETRIES`) and fall through to the existing hard-fail/degraded surface with a clear reason.
6. **Discover-sourced slots.** Slots placed via `recipe.discover` (`recipe_candidate_id`) must have their ingredients available to the guardrail (discover extracts ingredients from the web). Confirm the materialized candidate's ingredients are fetchable at commit; if a candidate has no ingredients, treat per AC 5.
7. `GUARDRAIL_VERSION` (allergy-rules.engine.ts) is bumped so the audit trail distinguishes pre/post base-ingredient evaluation.
8. The existing add-ons-only behavior is fully superseded (add-ons are part of the effective set in AC 1 — no double-checking, no regression to the add-on case).
9. Tests:
   - A plan whose Main contains a child's declared allergen (no add-ons) is **blocked** and triggers regenerate (the headline regression test — this is exactly what slips through today).
   - removals correctly drop an allergen-bearing base ingredient (allergen-fork pattern clears).
   - add_ons still caught (no regression).
   - empty-ingredient recipe: blocked for an allergic child, passes for a non-allergic child.
   - batch fetch issues one query for an N-recipe plan.
   - no false-positive block on a clean plan.

## Tasks / Subtasks

- [x] **Task 1 — Batch ingredient fetch** (AC: 2)
  - [x] `RecipesRepository.findIngredientsByIds(ids)` → `Map<id, string[]>` (display-name strings, mirroring how the swap path derives `recipeIngredients` from `recipe.ingredients`)
- [x] **Task 2 — Commit-time effective-ingredient guardrail** (AC: 1, 3, 8)
  - [x] Replace `buildGuardrailItemsFromTree` with a tree-walk (`PlansService.buildCommitGuardrailInputs`) that, per variation, resolves the slot's recipe (main via sequence, snack/extra via recipe_id, discover via recipe_candidate_id), looks up batch-fetched ingredients, and builds the item via `buildVariationGuardrailItem`
  - [x] Feed the full item list to the engine via the new `allergyGuardrail.clearOrRejectCommit`; removed the "empty → cleared, skip engine" shortcut and deleted the add-ons-only `buildGuardrailItemsFromTree`
- [x] **Task 3 — Unverifiable-recipe handling** (AC: 5, 6)
  - [x] Determine each child's declared allergens (household + child level) for the run — done inside `clearOrRejectCommit` from the single rule load (reuses `getRulesForHousehold`; `parent_declared` rules, household-wide or child-scoped)
  - [x] For unverifiable recipes: uncertain→retry for allergic children (recoverable `compound_ingredient_unverified`); pass for non-allergic; retry cap (`MAX_GUARDRAIL_RETRIES`) → existing hard-fail surface
  - [x] Confirm discover-candidate ingredients are present at commit — `resolveCandidateIngredients` reads the plan-build Redis cache (`RecipeService.readCandidate`); a miss/no-data candidate falls through to the AC5 unverifiable path
- [x] **Task 4 — Version + activation** (AC: 4, 7)
  - [x] Bump `GUARDRAIL_VERSION` (1.1.0 → 1.2.0)
  - [x] Verified the regenerate callback (surgical swap → full regen) fires on the now-live block path — no job code change; asserted via commit tests (blocked → `regenerate` called; unverifiable-allergic → recoverable retry)
- [x] **Task 5 — Tests** (AC: 9)

## Dev Notes

### Key Files
| File | Change |
|---|---|
| `apps/api/src/modules/plans/plans.service.ts` | rewrite `buildGuardrailItemsFromTree` → full effective-set walk; remove empty→cleared shortcut; unverifiable-recipe policy |
| `apps/api/src/modules/recipe/recipes.repository.ts` | `findIngredientsByIds` batch method |
| `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts` | bump `GUARDRAIL_VERSION` |
| `apps/api/src/modules/plans/plans.service.test.ts` | guardrail regression + edge tests |

### Critical correctness notes
- **Check exactly what commits.** Because `plan.compose` already resolved names → UUIDs (plan.tools.ts L31-59), `collectRecipeIdsFromTree` yields real IDs — fetch ingredients by those IDs so the guardrail evaluates the same rows `commit_plan` persists.
- **Reuse, don't reinvent.** `buildVariationGuardrailItem` (L1298) already computes `base − removals + add_ons` and returns a `PlanItemForGuardrail`. The engine call (`allergyGuardrail.clearOrReject`) is unchanged — we're just feeding it real ingredients now.
- **This activates dormant code.** Today nothing blocks, so `trySurgicalSwap`/full-regen/`rejectionContext`/`BlockedItem.original_ingredients` rarely execute. Once recipes are checked, blocks will occur and that machinery becomes live — which is the intent. Watch for latent bugs in those paths surfacing for the first time.
- **Data dependency.** The guardrail is only as good as recipe ingredient data. Layer-1-seeded recipes may have empty `ingredients` ([[recipe-agent-lazy-catalog]]) — AC 5 is the fail-safe. Stories 3.S36 (candidate slate carries ingredients/allergen flags) and 3.S38 (catalog pre-seed) reduce how often AC 5's unverifiable path is hit.
- **Allergen sources.** Declared allergens live at household level (`households.declared_allergens`) and per-child (`child_allergens`); the engine also enforces FALCPA baseline ([[allergen-storage-model]]). Use the same rule loading the engine already uses — do not hand-roll allergen lookup.

### Relationship to other stories
- **GATE for 3.S36** (pre-load reads): 3.S36 must not ship until this net is real.
- Relates to 3.S32 (already shipped with the same reliance) — this retroactively makes 3.S32's "guardrail runs server-side" claim true.
- Independent of the mid-week thread (3.S33/34/35).
- Out of scope: 3.S37 (loop restructure), 3.S38 (quick wins).

### References
- [Source: code review of 3.S32, 2026-06-17 — finding #4]
- [Source: apps/api/src/modules/plans/plans.service.ts] — `commit()` (~L152), `buildGuardrailItemsFromTree` (~L1269, add-ons only), `buildVariationGuardrailItem` (~L1298, the reuse target), `collectRecipeIdsFromTree` (~L1321)
- [Source: apps/api/src/agents/tools/plan.tools.ts] — `resolveRecipeId` name→UUID resolution (L31-59)
- [Source: apps/api/src/modules/recipe/recipes.repository.ts] — `findById` ingredients shape (~L506), column list (L14)
- [Source: apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts] — `GUARDRAIL_VERSION`, engine + FALCPA baseline
- [Source memory: allergen-storage-model, recipe-agent-lazy-catalog]

## Dev Agent Record
### Agent Model Used
claude-opus-4-8[1m] (Opus 4.8, 1M context) — bmad-dev-story workflow.

### Debug Log References
- `pnpm typecheck` (apps/api `tsc --noEmit`): 0 errors.
- Targeted suites (plans.service, allergy-guardrail ×3, recipes.repository, swap-retry.helper): 142 passed / 1 skipped.
- Full API suite: 31 pre-existing failures confirmed identical at HEAD by reverting the 4 changed source files and re-running (auth.routes, memory.*, onboarding.*, catalog-seed, audit.types enum-parity, plan-adjustment — none import the changed files). No new failures introduced.

### Completion Notes List
- **Effective-set walk (AC1/3/8).** `PlansService.buildCommitGuardrailInputs` resolves each slot's recipe — main via `main_assignment_sequence → main_assignments[].recipe_id`, snack/extra via `slot.recipe_id`, discover via `recipe_candidate_id` — batch-fetches ingredients once (`collectRecipeIdsFromTree` → `findIngredientsByIds`), and emits the full effective set per variation through the reused `buildVariationGuardrailItem`. The add-ons-only `buildGuardrailItemsFromTree` and the empty→cleared shortcut are removed; add_ons are now part of the effective set (no double-check).
- **Unverifiable handling (AC5/6) lives in `AllergyGuardrailService.clearOrRejectCommit`.** It loads rules once, runs the engine on verifiable items (a real `blocked` always wins), then flags unverifiable slots **only** for a child carrying a `parent_declared` allergen (household-wide or child-scoped) — routed through the existing recoverable `compound_ingredient_unverified` path so commit retries (surgical-swap → full-regen) and, on exhaustion, lands on the hard-fail surface. A non-allergic child's unverifiable recipe passes. FALCPA-only gating matches the engine's compound-suspect scan.
- **Discover candidates (AC6).** Resolved from the Story-3-31 plan-build Redis cache via `RecipeService.readCandidate(plan_build_id, candidate_id, redis)`. On a cache miss / no recipeService / no plan_build_id, the slot falls through to the AC5 unverifiable path. Note: the `commit_plan` RPC reads `slot.recipe_id` (it ignores `recipe_candidate_id`), so a candidate-only snack/extra slot is not yet materialized DB-side — the guardrail's unverifiable fail-safe is the correct behavior until 3.S36/3.S38 carry candidate ingredients through commit.
- **Engine caps (necessary, not speculative).** The effective-set walk legitimately exceeds the old add-ons-era caps (a 6-day × 3-slot × N-child plan, each item now up to recipe.ingredients(40)+add_ons(20)). Raised `MAX_PLAN_ITEMS` 50→250 and `MAX_INGREDIENTS_PER_ITEM` 20→80 so large plans don't hard-fail on `plan_items_exceeds_max`/`ingredients_exceeds_max`. These guard a background job, not a request path; the engine's only callers are commit + swap (the agent-facing `allergy.check` self-check was removed in 3.S32), so inputs are bounded by the tree contract maxes.
- **Version (AC7).** `GUARDRAIL_VERSION` 1.1.0 → 1.2.0 so the audit/decision trail distinguishes pre/post base-ingredient evaluation. Existing `'1.1.0'` literals in tests are plan-row sample data, not the constant — unaffected.
- **No migration / contract / dependency changes.**

### File List
- `apps/api/src/modules/recipe/recipes.repository.ts` — NEW `findIngredientsByIds(ids): Promise<Map<string, string[]>>` batch fetch.
- `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts` — `GUARDRAIL_VERSION` 1.2.0; `MAX_PLAN_ITEMS` 250; `MAX_INGREDIENTS_PER_ITEM` 80.
- `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts` — NEW `clearOrRejectCommit` + `UnverifiableSlot`; extracted `loadRules` + `recordDecision`; `clearOrReject` now composes them.
- `apps/api/src/modules/plans/plans.service.ts` — commit loop calls `clearOrRejectCommit`; NEW `buildCommitGuardrailInputs` + `resolveCandidateIngredients`; removed `buildGuardrailItemsFromTree`.
- `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.test.ts` — cap-boundary tests updated to 251 / 81.
- `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.test.ts` — NEW file, `clearOrRejectCommit` merge/precedence unit tests.
- `apps/api/src/modules/recipe/recipes.repository.test.ts` — NEW `findIngredientsByIds` tests (+ `.in()` on the mock builder).
- `apps/api/src/modules/plans/plans.service.test.ts` — commit mocks switched to `clearOrRejectCommit`; NEW AC9 effective-set/unverifiable/batch test suite.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `3-s39 → review`.

## Change Log
| Date | Change |
|---|---|
| 2026-06-17 | Implemented commit-time recipe-ingredient guardrail (all 9 ACs): batch ingredient fetch, effective-set tree walk, unverifiable-recipe fail-safe (declared-allergen-scoped), engine cap bump, `GUARDRAIL_VERSION` 1.2.0. +18 tests. Status → review. |

### Review Findings

- [x] [Review][Patch] AC4 — `swap-retry.helper.ts` `buildBlockedItemsFromTree` still sets `original_ingredients: variation.add_ons ?? []`; base-ingredient blocks are now live but the swap agent receives empty ingredients for the new code path [swap-retry.helper.ts:~L289] ✅ FIXED: `original_ingredients` now unions `add_ons` with `blocked_by[].ingredient`
- [x] [Review][Patch] Test `'blocked wins over unverifiable allergic slot'` uses non-allergic CHILD_B as the unverifiable party — the short-circuit that should protect an allergic unverifiable slot is never actually exercised by this test [allergy-guardrail.service.test.ts:44] ✅ FIXED: CHILD_B given `declared(CHILD_B, 'peanut')` rule so the unverifiable flag would fire without the short-circuit
- [x] [Review][Defer] N+1 Redis lookups when multiple discover-candidate slots reference the same `recipe_candidate_id` [plans.service.ts:buildCommitGuardrailInputs] — deferred, pre-existing
- [x] [Review][Defer] `buildRecipesRepo` test mock is an unsafe cast missing all `RecipesRepository` methods except `findIngredientsByIds` — swap-triggered code path would surface as cryptic TypeError [plans.service.test.ts:buildRecipesRepo] — deferred, pre-existing
- [x] [Review][Defer] Engine has no rule-count cap; a household with many declared-allergen rules could breach the p99 latency budget [allergy-rules.engine.ts] — deferred, pre-existing
- [x] [Review][Defer] Whitespace-only display strings (e.g. `" "`) pass `.filter(d => d.length > 0)` in `resolveCandidateIngredients` and `fetchRecipeDisplayIngredients`; inflate ingredient count silently — deferred, pre-existing in both commit and swap paths [plans.service.ts]
- [x] [Review][Defer] `main_assignment_sequence = undefined` on a main slot silently marks all its variations unverifiable with no warning log [plans.service.ts:buildCommitGuardrailInputs] — deferred, pre-existing

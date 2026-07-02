# Story 3.S36: Pre-load Planner Reads (child signals + pantry + recipe candidates)

Status: done

> **⚠️ GATED BY Story 3.S39.** This story further reduces the planner's allergen self-checking on the promise that the deterministic commit-time guardrail catches violations. That guardrail does not check recipe base ingredients today — **3.S39 must land first.**

## Story

As the HiveKitchen engineering team,
I want the planner's read-only inputs (child rating signals, pantry inventory, and a candidate recipe slate) pre-assembled and injected into context before the agentic loop,
so that the planner composes directly from context instead of spending one LLM turn per read tool — taking the typical run from ~8–10 turns down to ~1–2.

## Background

This is **Optimization #1** from the 2026-06-17 orchestration efficiency review, and a direct extension of the 3-S32 KitchenMap pre-load pattern.

Today (`orchestrator.ts` `planWeek`) every read is a separate LLM turn, and each turn replays the entire growing message history:

| Turn(s) | Tool | After this story |
|---|---|---|
| 1 | `child_signal` | **pre-loaded → tool removed** |
| 1 | `pantry.read` | **pre-loaded → tool removed** |
| ~2–3 | `recipe.search` | **pre-loaded candidate slate → fallback-only** |
| ~3 | `recipe.fetch` | **fallback-only** (slate carries ingredients + allergen flags) |
| 0–10 | `recipe.discover` | **fallback-only** (unchanged gating) |
| 1 | `plan.compose` | terminal (unchanged) |

Turns ≈ read-tool calls, so eliminating the reads is what cuts cost. `child_signal` and `pantry` are complete reads → pre-load fully and remove from `toolsAllowed` (same move 3-S32 made for `memory.recall`). Recipe reads need a fallback (a specific slot may need something not in the slate) → pre-load a candidate slate and **demote** `recipe.search/fetch/discover` to fallback-only via prompt gating (exactly how `recipe.discover` is gated today).

This is read-only and additive: if a pre-loaded block is empty/unavailable, the corresponding tool fallback still works.

## Acceptance Criteria

1. **Child-signal pre-load.** The job assembles child rating signals (via the existing `loadChildSignal` assembler) and `planWeek` renders them as a context block (e.g. `<child_signals>`), grouped per child (liked / disliked / family-liked), with the FR125 absence-neutrality note. `child_signal` is **removed from `PLANNER_PROMPT.toolsAllowed`** (kept in `TOOL_MANIFEST` for other callers). `PLANNING_CORE` updated to say the signals are pre-loaded — do not call `child_signal`.
2. **Pantry pre-load.** The job loads a pantry snapshot and `planWeek` renders it as a context block (`<pantry>`). `pantry.read` is **removed from `toolsAllowed`** (kept in `TOOL_MANIFEST`). Prompt updated: pantry is pre-loaded — do not call `pantry.read`.
3. **Candidate recipe slate.** The job assembles a ranked candidate slate (household catalog previews ranked by usage/confidence + child-signal bias, grouped by slot suitability, each with `name`, `cuisine_tags`, allergen flags, and the key ingredients needed to judge fit) and `planWeek` renders it as a context block (`<recipe_candidates>`). The planner composes using these `name`s as `recipe_id` (server resolves name → catalog id, per existing convention).
4. **Recipe tools demoted to fallback-only.** `recipe.search`, `recipe.fetch`, `recipe.discover` REMAIN in `toolsAllowed`. `PLANNING_CORE` updated: compose from `<recipe_candidates>`; call `recipe.search`/`recipe.fetch` ONLY when a slot cannot be filled from the slate, and `recipe.discover` only under its existing gate (slate + search both insufficient).
5. **Fallback contract.** When any pre-loaded block is empty (no signals, empty pantry, empty catalog → empty slate), the planner still composes — falling back to the retained tools for recipes, and treating absent signals/pantry as "no data" (never as a constraint).
6. `PLANNER_PROMPT.version` bumped (e.g. `v2.7.0`) with history comment; tool-list + version tests updated.
7. Unit tests: each block renders from a fixture and is absent/empty-safe; `toolsAllowed` no longer contains `child_signal`/`pantry.read` but still contains the three recipe tools; orchestrator test asserts the blocks appear in the user message.
8. **No new turns on the happy path.** With a populated catalog, a warm-path run issues `plan.compose` as effectively its first/only tool call (assert via the existing iteration tool-trace in an orchestrator test, or a turn-count assertion).

## Block formats (sketch — finalize in dev)

```
<child_signals>
Layla: liked [Chana Masala Wraps, Dosa]; disliked [capsicum]; (family_liked: paneer)
Zara: (no recent signals)
NOTE: absence of a signal = no data; never infer dislike from absence (FR125).
</child_signals>

<pantry>
on_hand: [basmati rice, chickpeas, paneer, cucumber, ...]
</pantry>

<recipe_candidates>
main:
  - { name: "Chana Masala Wraps", cuisine: ["indian"], allergens: [], key_ingredients: [chickpea, wrap], confidence: 92 }
  - { name: "Paneer Paratha Roll", cuisine: ["indian"], allergens: [dairy, wheat], ... }
snack: [ ... ]
extra: [ ... ]
</recipe_candidates>
```

## Tasks / Subtasks

- [x] **Task 1 — Child-signal pre-load** (AC: 1, 5, 7)
  - [x] Job: assemble signals (`loadChildSignal`); pass to `planWeek` via a new `PlanWeekOptions` field (e.g. `childSignals?`)
  - [x] `renderPlannerChildSignalsBlock()` in orchestrator.ts; inject into contextLines
  - [x] Remove `child_signal` from `toolsAllowed`; update `PLANNING_CORE`

- [x] **Task 2 — Pantry pre-load** (AC: 2, 5, 7)
  - [x] Job: load pantry snapshot; pass via `PlanWeekOptions` (`pantrySnapshot?`)
  - [x] `renderPlannerPantryBlock()`; inject; remove `pantry.read` from `toolsAllowed`; update prompt

- [x] **Task 3 — Candidate recipe slate** (AC: 3, 4, 5, 7) — *heaviest task; may split if estimate runs large*
  - [x] RecipeService/RecipesRepository: a "candidate slate" query (catalog previews ranked by usage/confidence + signal bias, grouped by slot suitability, with allergen flags + key ingredients)
  - [x] Job: assemble slate; pass via `PlanWeekOptions` (`recipeCandidates?`)
  - [x] `renderPlannerRecipeCandidatesBlock()`; inject
  - [x] Demote `recipe.search/fetch/discover` to fallback in `PLANNING_CORE` (compose-from-slate first)

- [x] **Task 4 — Prompt version + tests** (AC: 6, 7, 8)
  - [x] Bump version + history comment
  - [x] planner.prompt.test.ts / plan.tools.test.ts: version + tool-list assertions
  - [x] orchestrator.test.ts: blocks render; empty-safe; happy-path issues `plan.compose` first

## Dev Notes

### Key Files
| File | Change |
|---|---|
| `apps/api/src/agents/orchestrator.ts` | new `PlanWeekOptions` fields + `renderPlanner{ChildSignals,Pantry,RecipeCandidates}Block()`; inject into contextLines |
| `apps/api/src/agents/prompts/planner.prompt.ts` | remove `child_signal`+`pantry.read` from toolsAllowed; demote recipe tools; prompt + version |
| `apps/api/src/jobs/plan-generation.job.ts` (+ `planner-context.loader.ts`) | assemble signals/pantry/slate; pass in opts (both planWeek call sites) |
| `apps/api/src/jobs/plan-regeneration.job.ts` | same opts wiring (regeneration uses the same planner) |
| `apps/api/src/modules/recipe/recipe.service.ts` + `recipes.repository.ts` | candidate-slate query |
| tests | orchestrator / prompt / job |

### Notes
- Mirror 3-S32 exactly: render a context block + drop the now-redundant tool from `toolsAllowed` (signals/pantry) OR gate it as fallback (recipes). The KitchenMap block already carries `recipes.favourites` (top-10) — the slate is the broader, slot-grouped superset; consider whether to fold favourites into the slate to avoid duplication.
- `loadChildSignal` already exists (`child-signal.assembler.ts`); the tool just wraps it — pre-loading calls the same assembler from the job.
- Recipe candidates must include enough to **avoid `recipe.fetch`** for slate items: allergen flags + key ingredients inline. That's what removes the fetch turns.
- Cold-start (empty catalog) still falls back to `recipe.discover`; see Story 3.S38 for moving catalog seeding off the planning hot path.
- Wire identically into BOTH `plan-generation.job.ts` and `plan-regeneration.job.ts` (and both `planWeek` calls in each), as 3-S32 did.

### Relationship to other stories
- **GATED BY 3-S39** (commit-time recipe-ingredient guardrail) — do not ship until the deterministic allergen net checks recipe ingredients.
- Extends **3-S32** (KitchenMap pre-load, the proven pattern).
- **Enables 3-S37** (single-pass orchestration — only safe to collapse the loop once reads are pre-loaded).
- Independent of the mid-week stories (3-S33/34/35); composes cleanly with them.

### References
- [Source: orchestration efficiency review 2026-06-17] — Optimization #1
- [Source: apps/api/src/agents/orchestrator.ts] — `renderPlannerKitchenMapBlock` (3-S32 pattern), `planWeek` loop
- [Source: apps/api/src/modules/child-preferences/child-signal.assembler.ts] — `loadChildSignal`
- [Source: apps/api/src/modules/recipe/recipe.service.ts] — `search`/`fetch` (slate query basis)

## Dev Agent Record
### Agent Model Used
claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References
- `pnpm --filter @hivekitchen/api typecheck` → 0 errors.
- Targeted suites (orchestrator + orchestrator.planweek + planner.prompt + planner-context.loader + plan.tools) → 114/114 then 122/122 green post plan.tools fix.
- Full `src/jobs src/agents` → 432 pass / 4 fail (memory.tools ×2, onboarding.tools ×2 — confirmed pre-existing via `git stash` on clean tree, fail identically without this change).
- Full API suite → 1920 pass / 31 fail / 13 skip — the 31 = documented pre-existing baseline (auth/memory/onboarding/catalog-seed/audit-types/children/households/lumi/lunch-link/plan-adjustment/extra-library/memory-context); NONE in any file this story touched.
- ESLint on changed files → the 10 reported errors are all pre-existing baseline (`eqeqeq` `!= null` + the `_job` no-unused-vars on lines that merely shifted under my insertions); 0 new errors in any added code.

### Completion Notes List
- **AC1 (child-signal pre-load):** `PlanWeekOptions.childSignals?: ChildSignalOutput`; `renderPlannerChildSignalsBlock()` renders `<child_signals>` per child (liked/disliked with slot_kind for FR124) + a `family_liked` summary + the FR125 absence note. `child_signal` removed from `PLANNER_PROMPT.toolsAllowed` (kept in `TOOL_MANIFEST`). Job assembles via the existing `loadChildSignal` (lookback 30, matching the tool).
- **AC2 (pantry pre-load):** `PlanWeekOptions.pantrySnapshot?`; `renderPlannerPantryBlock()` renders `<pantry>`. `pantry.read` removed from `toolsAllowed` (kept in manifest). New `loadPantrySnapshotForHousehold()` calls `PantryService.read` and **swallows failure → empty snapshot** — `PantryService` is unimplemented until Epic 6 (`read()` throws `NotImplementedError`), so the block is empty today but the wiring is forward-compatible (block populates with no job change when pantry lands).
- **AC3/4 (candidate slate + demotion):** new `RecipesRepository.findCandidateSlateForHousehold()` (household_recipe_usage⋈recipes, banned excluded; superset of `findCatalogProjectionForHousehold` adding applicable_slots + ingredient_keys). `loadRecipeCandidatesForHousehold()` ranks (favourite → liked-signal → confidence → use_count → name) and groups into main/snack/extra by applicable_slots (default 'main'), caps 12/slot and 6 key-ingredients/candidate. `renderPlannerRecipeCandidatesBlock()` renders `<recipe_candidates>`. Recipe tools stay in `toolsAllowed`; `PLANNING_CORE` demotes search/fetch to "FALLBACK ONLY" and keeps the existing discover gate.
- **AC5 (fallback contract):** every render fn returns `''` when its input is empty → no block; all three loaders `.catch → undefined/empty`; recipe tools retained for cold-start. Covered by empty-safe unit tests on each render fn + the "omits all three blocks" planWeek test + the pantry-unimplemented loader test.
- **AC6 (version):** `PLANNER_PROMPT.version` v2.6.0 → **v2.7.0** with history comment; planner.prompt.test + plan.tools.test version/tool-list assertions updated.
- **AC7/8 (tests):** orchestrator.test gains render-fn suites (populated + empty-safe), a planWeek-injection test (all three blocks appear in the user message), an empty-safe planWeek test, and an AC8 warm-path test asserting `plan.compose` is the first/only call (`completeWithMessages` called once). loader tests cover pantry mapping/empty-fallback + slate rank/group/cap/bias.
- **Reconciliation (slate location):** Task 3 sketched "RecipeService/RecipesRepository". Implemented the raw query on `RecipesRepository` but put the rank/group assembly in `planner-context.loader.ts` (pure, `assembleRecipeCandidateSlate`, unit-tested) — this follows the established loader convention (every other Planner* shape is mapped in that file) and avoids a type-only cycle between `recipe.service.ts` and `orchestrator.ts`. `RecipeService` left untouched.
- **Block placement:** the three new blocks render immediately after the KitchenMap `<user_profile>` block (still first, preserving the 3-S32 prefix-cache test) and before the `Household ID:` line, keeping all run-invariant context at the leading edge of the prompt.
- **Gate:** 3-S39 (commit-time recipe-ingredient guardrail) is complete (CODE REVIEW DONE per the latest sprint log), so the gating precondition for this story is satisfied.
- No migration, no contract change, no new deps, no web change.

### File List
- `apps/api/src/agents/orchestrator.ts` — `PlanWeekOptions` += childSignals/pantrySnapshot/recipeCandidates; `PlannerPantrySnapshot`/`PlannerRecipeCandidate`/`PlannerRecipeCandidateSlate` interfaces; `renderPlannerChildSignalsBlock`/`renderPlannerPantryBlock`/`renderPlannerRecipeCandidatesBlock`; inject blocks into contextLines; ChildSignalOutput import; MAX_PLAN_ITERATIONS comment.
- `apps/api/src/agents/prompts/planner.prompt.ts` — version v2.7.0 + history; remove child_signal + pantry.read from toolsAllowed; rewrite Pre-loaded Context / child-signal / pantry / tool-usage sections (recipe tools fallback-only).
- `apps/api/src/modules/recipe/recipes.repository.ts` — `findCandidateSlateForHousehold`; `CandidateSlateRow` (+ private join shape).
- `apps/api/src/jobs/planner-context.loader.ts` — `loadPantrySnapshotForHousehold`, `loadRecipeCandidatesForHousehold`, `assembleRecipeCandidateSlate` (+ rank/group/bias helpers).
- `apps/api/src/jobs/plan-generation.job.ts` — construct RecipesRepository + PantryService; load childSignals/pantrySnapshot/recipeCandidates; pass to both planWeek calls.
- `apps/api/src/jobs/plan-regeneration.job.ts` — same wiring; pass to both planWeek calls.
- `apps/api/src/agents/orchestrator.test.ts` — render-fn suites + planWeek pre-load injection/empty-safe/AC8 suites (+ imports).
- `apps/api/src/jobs/planner-context.loader.test.ts` — pantry + slate (assemble/load) suites (+ imports).
- `apps/api/src/agents/prompts/planner.prompt.test.ts` — v2.7.0 + 4-tool allow-list + pre-load directive assertions.
- `apps/api/src/agents/tools/plan.tools.test.ts` — version assertion v2.6.0 → v2.7.0.

### Review Findings

- [x] [Review][Patch] **P1: Unsanitized `child_name`/`recipe_name` in `renderPlannerChildSignalsBlock` — LLM prompt injection via angle-bracket sequences** [`apps/api/src/agents/orchestrator.ts:~1397-1415`] — FIXED: added `sanitizePromptField()` helper (strips `<>/\n`) applied to all user-controlled fields in the block.
- [x] [Review][Patch] **P2: `findCandidateSlateForHousehold` filters `is_active` in app-layer instead of SQL — inactive recipes returned across the wire on every plan run** [`apps/api/src/modules/recipe/recipes.repository.ts:~758-761`] — FIXED: added `.filter('recipes.is_active', 'eq', 'true')` at SQL level; app-level check retained as safety net.
- [x] [Review][Patch] **P3: `loadPantrySnapshotForHousehold` bare catch swallows all errors silently — no log emitted** [`apps/api/src/jobs/planner-context.loader.ts:~159-169`] — FIXED: catch now scoped to `instanceof NotImplementedError` (silent empty snapshot); other errors re-thrown to caller's `.catch()` which logs warn.
- [x] [Review][Patch] **P4: `getTimezone` throws `ValidationError` (400) for null household timezone — server data-integrity issue exposed as client error** [`apps/api/src/modules/households/households.repository.ts:~143-146`] — FIXED: added `DataIntegrityError` (status 500) to `errors.ts`; `getTimezone` now throws `DataIntegrityError` for null timezone.
- [x] [Review][Defer] **D-3S36-CR1: TOCTOU double-enqueue under concurrent `POST /v1/plans/generate` requests** [`apps/api/src/modules/plans/plans.service.ts`] — deferred, pre-existing (mirrors D-3S34-CR1)
- [x] [Review][Defer] **D-3S36-CR2: `applicable_slots` unrecognized values cause recipe to silently drop from all candidate groups** [`apps/api/src/jobs/planner-context.loader.ts:~203-208`] — deferred, pre-existing
- [x] [Review][Defer] **D-3S36-CR3: PostgREST array normalization in `findCandidateSlateForHousehold` — `raw.recipes[0]` silently drops extra elements if join shape changes** [`apps/api/src/modules/recipe/recipes.repository.ts:~774`] — deferred, defensive code already in place
- [x] [Review][Defer] **D-3S36-CR4: Pantry `on_hand.join(', ')` breaks when item names contain commas** [`apps/api/src/agents/orchestrator.ts:~1427`] — deferred until Epic 6 pantry lands
- [x] [Review][Defer] **D-3S36-CR5: Redis INCR + EXPIRE non-atomic — counter persists without TTL on crash between calls** [`apps/api/src/modules/plans/plans.service.ts:~664-666`] — deferred, pre-existing pattern (matches D-3S34-CR2 pattern)
- [x] [Review][Defer] **D-3S36-CR6: BullMQ `job.id` null on duplicate-key enqueue — 202 response conflates "already running" with "new job created"** [`apps/api/src/modules/plans/plans.service.ts:~682-712`] — deferred, accepted idempotency key design
- [x] [Review][Defer] **D-3S36-CR7: FR125 absence-neutrality note absent from prompt when household has zero child signals (block returns '')** [`apps/api/src/agents/orchestrator.ts`] — deferred, cold-start path falls back to recipe tools; AC5 fallback contract satisfied
- [x] [Review][Defer] **D-3S36-CR8: `loadRecipeCandidatesForHousehold` swallows DB connection errors — cascade failure masked at recipe-tool layer** [`apps/api/src/jobs/plan-generation.job.ts:~401-411`] — deferred, warn log is emitted; cascade is expected retry behaviour
- [x] [Review][Defer] **D-3S36-CR9: `CandidateSlateJoinedRecipe` types `applicable_slots`/`ingredient_keys` as `string[] | null` but columns are `NOT NULL` — dead null guards mislead future maintainers** [`apps/api/src/modules/recipe/recipes.repository.ts:~96-98`] — deferred, no runtime impact

## Change Log
| Date | Change |
|---|---|
| 2026-06-18 | Story 3-S36 implemented (dev-story). Pre-loaded planner reads — `<child_signals>`/`<pantry>`/`<recipe_candidates>` context blocks; child_signal + pantry.read removed from toolsAllowed; recipe tools demoted to fallback-only; PLANNER_PROMPT v2.7.0. New RecipesRepository.findCandidateSlateForHousehold + loader assembly. Wired into both jobs (both planWeek call sites each). +new tests across orchestrator/loader/prompt. No migration/contract/dep/web change. Status → review. |

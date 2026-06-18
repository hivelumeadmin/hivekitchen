# Story 3.S36: Pre-load Planner Reads (child signals + pantry + recipe candidates)

Status: ready-for-dev

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

- [ ] **Task 1 — Child-signal pre-load** (AC: 1, 5, 7)
  - [ ] Job: assemble signals (`loadChildSignal`); pass to `planWeek` via a new `PlanWeekOptions` field (e.g. `childSignals?`)
  - [ ] `renderPlannerChildSignalsBlock()` in orchestrator.ts; inject into contextLines
  - [ ] Remove `child_signal` from `toolsAllowed`; update `PLANNING_CORE`

- [ ] **Task 2 — Pantry pre-load** (AC: 2, 5, 7)
  - [ ] Job: load pantry snapshot; pass via `PlanWeekOptions` (`pantrySnapshot?`)
  - [ ] `renderPlannerPantryBlock()`; inject; remove `pantry.read` from `toolsAllowed`; update prompt

- [ ] **Task 3 — Candidate recipe slate** (AC: 3, 4, 5, 7) — *heaviest task; may split if estimate runs large*
  - [ ] RecipeService/RecipesRepository: a "candidate slate" query (catalog previews ranked by usage/confidence + signal bias, grouped by slot suitability, with allergen flags + key ingredients)
  - [ ] Job: assemble slate; pass via `PlanWeekOptions` (`recipeCandidates?`)
  - [ ] `renderPlannerRecipeCandidatesBlock()`; inject
  - [ ] Demote `recipe.search/fetch/discover` to fallback in `PLANNING_CORE` (compose-from-slate first)

- [ ] **Task 4 — Prompt version + tests** (AC: 6, 7, 8)
  - [ ] Bump version + history comment
  - [ ] planner.prompt.test.ts / plan.tools.test.ts: version + tool-list assertions
  - [ ] orchestrator.test.ts: blocks render; empty-safe; happy-path issues `plan.compose` first

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
### Debug Log References
### Completion Notes List
### File List
## Change Log

# Story 3.S37: Single-Pass Orchestration (assemble → compose → verify)

Status: done

## Story

As the HiveKitchen engineering team,
I want `planWeek` to run as a bounded "compose → verify → (optional) one targeted swap" flow instead of an open-ended 80-iteration ReAct loop,
so that the orchestration is simpler to reason about, the iteration ceiling reflects reality, and the happy path is a single LLM call.

## Background

This is **Optimization #2** from the 2026-06-17 efficiency review. It depends on **Story 3.S36** (once every read is pre-loaded, the planner has nothing to fetch on the happy path, so the open ReAct loop is no longer needed).

Today `planWeek` (`orchestrator.ts`) runs `for i < MAX_PLAN_ITERATIONS = 80`, calling gpt-4o each iteration and reacting to whatever tools it returns, until `plan.compose` lands. That open loop made sense when the planner discovered facts turn-by-turn. After 3-S36 the only state-changing tool is `plan.compose`; everything else is a rarely-used read fallback. So the control flow should be:

1. **Assemble** (deterministic, already done in the job + 3-S36 context blocks) — no LLM.
2. **Compose** — ideally one `plan.compose` call; allow a small bounded number of fallback read turns ONLY if the model needs a recipe not in the slate.
3. **Verify** — the deterministic commit-time guardrail (`plansService.commit`); on a block, do ONE surgical swap (`trySurgicalSwap`, already exists) before the heavier full-regen fallback.

The retry/regeneration machinery already exists in the jobs — this story tightens the loop ceiling and formalizes "fallback-bounded, compose-first," it does not rebuild the guardrail.

## Acceptance Criteria

1. `MAX_PLAN_ITERATIONS` is reduced from 80 to a small bound (recommend ~8) that still tolerates the rare fallback (a few `recipe.search/fetch/discover` turns) plus the existing self-correction detours, but reflects the post-3-S36 reality. The new value is documented with the turn math.
2. The happy path (populated slate) completes in a **single `plan.compose` turn** — no read-tool turns. (Assert via the iteration tool-trace.)
3. Fallback still works: if the model calls a retained read tool (recipe.*), the loop services it and continues, up to the bound. Exceeding the bound throws the existing "did not call plan.compose within N iterations" error (unchanged behavior, lower N).
4. The two self-correction paths (stopped-without-compose nudge; `plan.compose` validation error fed back) are preserved and counted within the bound.
5. Guardrail-block path is **surgical-swap-first** (already wired via `trySurgicalSwap` in both jobs); confirm full-regen remains only as the last resort when the swap can't cover all blocked slots. No new LLM calls added to the verify path.
6. No behavioral change to a successfully composed plan's shape, commit, brief-state refresh, audit, or post-commit steps.
7. Tests: happy path = 1 compose turn; a simulated fallback (slate insufficient → one recipe.search → compose) stays within the bound; exceeding the bound throws; existing orchestrator/commit tests stay green.

## Tasks / Subtasks

- [x] **Task 1 — Tighten the loop** (AC: 1, 2, 3, 4)
  - [x] Lower `MAX_PLAN_ITERATIONS` (~8) with a documented turn-budget comment
  - [x] Confirm the loop still services fallback read tools + both self-correction detours within the bound
  - [x] Keep the tool-trace + the "did not call plan.compose" terminal error (lower N)

- [x] **Task 2 — Confirm/clean the verify path** (AC: 5, 6)
  - [x] Verify `trySurgicalSwap` runs before full-regen in both `plan-generation.job.ts` and `plan-regeneration.job.ts` (it does today — assert with a test, don't rebuild)
  - [x] Remove now-dead branches if the iteration reduction makes any unreachable (surgical: only if clearly dead) — none; lowering 80→8 changes only the ceiling, every branch (fallback read tools, stop-nudge, validation-error feedback) is still reachable

- [x] **Task 3 — Tests** (AC: 2, 3, 7)
  - [x] orchestrator.test.ts: happy path issues `plan.compose` as the first/only tool call; fallback path stays within bound; over-bound throws

## Dev Notes

### Key Files
| File | Change |
|---|---|
| `apps/api/src/agents/orchestrator.ts` | lower `MAX_PLAN_ITERATIONS`; loop-bound comments; (optional) prune unreachable branches |
| `apps/api/src/agents/orchestrator.test.ts` | turn-count + fallback-bound tests |
| `apps/api/src/jobs/plan-generation.job.ts` / `plan-regeneration.job.ts` | confirm surgical-swap-first (test only, likely no code change) |

### Notes
- This is deliberately a **small, low-risk** structural tightening, not a rewrite. The big turn reduction comes from 3-S36; this story makes the loop's shape honest (ceiling ~8, compose-first) and locks in compose-first + surgical-swap-first with tests.
- Do NOT remove the fallback read tools or the full-regen last resort — they're the safety valve for cold-start / slate-miss.
- The commit-time guardrail's base-ingredient gap (it currently only checks `add_ons`) is a SEPARATE correctness concern (review finding #4), intentionally out of scope here.
- `temperature` for the compose call is addressed in Story 3.S38.

### Relationship to other stories
- **Depends on 3-S36** (pre-loaded reads).
- Sibling to **3-S38** (quick wins). Independent of mid-week 3-S33/34/35.

### References
- [Source: orchestration efficiency review 2026-06-17] — Optimization #2
- [Source: apps/api/src/agents/orchestrator.ts] — `planWeek` loop (~L424-632), `MAX_PLAN_ITERATIONS` (~L346)
- [Source: apps/api/src/jobs/plan-generation.job.ts] — `commit()` callback, `trySurgicalSwap`, full-regen fallback

## Dev Agent Record
### Agent Model Used
claude-opus-4-8[1m] (Claude Code dev-story workflow)

### Debug Log References
- `npx vitest run src/agents/orchestrator.test.ts` → 67/67 green (incl. 3 new 3-S37 loop-bound tests)
- `npx vitest run src/jobs/swap-retry.helper.test.ts` → 12/12 green (incl. 2 new 3-S37 surgical-first ordering tests)
- `npx vitest run src/jobs/plan-generation.job.test.ts src/jobs/planner-context.loader.test.ts` → 50/50 green
- `npx tsc --noEmit` (apps/api) → exit 0, zero errors
- `npx vitest run src/agents/ src/jobs/` → 437 pass / 4 fail; the 4 fails are the documented pre-existing baseline (`memory.tools` ×2, `onboarding.tools` ×2 — untouched by this story)
- `npx eslint` on changed files: test files clean; `orchestrator.ts` reports only 8 pre-existing `eqeqeq` (`!= null`) baseline errors on untouched lines (319/560/564/614/631/635/671/1286) — zero new

### Completion Notes List
- **Task 1 (AC1–4):** `MAX_PLAN_ITERATIONS` lowered 80 → 8 in `orchestrator.ts` with a documented turn-budget comment. Turn math: 1 (warm plan.compose) + ≤3 cold-start fallback reads (search→fetch→discover) + ≤2 self-correction detours (stop-nudge, validation-error feedback) ≈ 6 worst-case; 8 leaves a 2-turn margin. No control-flow change — the fallback read-tool servicing, both self-correction detours, the tool-trace Redis write, and the terminal "did not call plan.compose within N iterations" error are all preserved; only the ceiling moved (the error message now reports `8`).
- **Task 2 (AC5, 6):** Confirmed by inspection + test that both jobs are surgical-swap-first: each regenerate callback runs `trySurgicalSwap(...)` and only calls the flagship `orchestrator.planWeek(...)` full-regen when it returns `null` (`plan-generation.job.ts:484`, `plan-regeneration.job.ts:294`). No new LLM calls added to the verify path. No dead branches resulted from the iteration reduction. No production code changed in either job.
- **Task 3 (AC2, 3, 7):** Added 3 orchestrator loop-bound tests (happy path = 1 compose turn; one recipe.search fallback then compose = 2 turns within bound; never-composes throws at exactly 8 iterations) and 2 swap-retry-helper ordering tests (covering swap → non-null, `planWeek` never invoked; uncovered swap → null with `swapBlockedItems` attempted first, `planWeek` never invoked by the helper). The over-bound test asserts the literal `within 8 iterations` message, locking the documented bound.
- AC6 holds: the successful-compose path (tree shape, commit, brief-state refresh, audit, post-commit variant/degraded/nudge steps) is untouched.

### File List
- `apps/api/src/agents/orchestrator.ts` — lowered `MAX_PLAN_ITERATIONS` 80→8 + turn-budget comment (Task 1)
- `apps/api/src/agents/orchestrator.test.ts` — new `planWeek loop bound (Story 3-S37)` describe block (3 tests)
- `apps/api/src/jobs/swap-retry.helper.test.ts` — new `surgical-swap-first ordering (Story 3-S37)` describe block (2 tests)

### Review Findings

- [x] [Review][Patch] Turn-budget comment overstates margin — worst-case path reaches 8 turns with zero headroom when cold-start + both self-correction detours compound [orchestrator.ts, near `MAX_PLAN_ITERATIONS` constant]
- [x] [Review][Defer] Validation-error retry uncapped — repeated `plan.compose` failures can exhaust full 8-turn budget [orchestrator.ts] — deferred, pre-existing behavior (unchanged from 80-turn bound)
- [x] [Review][Defer] No test exercises stop-nudge or validation-error self-correction paths (AC4 coverage gap) [orchestrator.test.ts] — deferred, beyond Task 3 scope per spec
- [x] [Review][Defer] Job-level surgical-swap ordering confirmed via helper test only, not direct job callback test [plan-generation.job.ts:484, plan-regeneration.job.ts:294] — deferred, justified by shared helper assertion
- [x] [Review][Defer] `plan-generation.job.ts` full-regen fallback doesn't forward `slotScopeContext` [plan-generation.job.ts:~525] — deferred, pre-existing asymmetry vs. plan-regeneration.job.ts:348
- [x] [Review][Defer] `lastAttemptComposeOutput` not updated after surgical swap success in plan-generation.job [plan-generation.job.ts:~492] — deferred, pre-existing asymmetry vs. plan-regeneration.job.ts:379
- [x] [Review][Defer] `mergeSlot` keeps old `recipe_candidate_id` when swap replaces slot with different provenance [swap-retry.helper.ts] — deferred, pre-existing

## Change Log
| Date | Change |
|---|---|
| 2026-06-18 | 3-S37 implemented (dev-story): `MAX_PLAN_ITERATIONS` 80→8 with documented turn-budget; 5 new tests (3 orchestrator loop-bound + 2 swap-retry surgical-first ordering); surgical-swap-first verify path confirmed in both jobs. No production change beyond the constant + comment. Status → review. |

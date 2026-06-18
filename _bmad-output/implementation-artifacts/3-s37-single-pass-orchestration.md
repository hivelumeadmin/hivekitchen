# Story 3.S37: Single-Pass Orchestration (assemble → compose → verify)

Status: ready-for-dev

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

- [ ] **Task 1 — Tighten the loop** (AC: 1, 2, 3, 4)
  - [ ] Lower `MAX_PLAN_ITERATIONS` (~8) with a documented turn-budget comment
  - [ ] Confirm the loop still services fallback read tools + both self-correction detours within the bound
  - [ ] Keep the tool-trace + the "did not call plan.compose" terminal error (lower N)

- [ ] **Task 2 — Confirm/clean the verify path** (AC: 5, 6)
  - [ ] Verify `trySurgicalSwap` runs before full-regen in both `plan-generation.job.ts` and `plan-regeneration.job.ts` (it does today — assert with a test, don't rebuild)
  - [ ] Remove now-dead branches if the iteration reduction makes any unreachable (surgical: only if clearly dead)

- [ ] **Task 3 — Tests** (AC: 2, 3, 7)
  - [ ] orchestrator.test.ts: happy path issues `plan.compose` as the first/only tool call; fallback path stays within bound; over-bound throws

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
### Debug Log References
### Completion Notes List
### File List
## Change Log

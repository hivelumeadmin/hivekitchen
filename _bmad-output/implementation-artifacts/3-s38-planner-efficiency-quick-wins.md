# Story 3.S38: Planner Efficiency Quick Wins (temperature, catalog pre-seed, batch nudge)

Status: ready-for-dev

## Story

As the HiveKitchen engineering team,
I want a few low-risk, independent tweaks to the planner — lower compose temperature, catalog pre-seeding off the planning hot path, and a batch-search prompt nudge,
so that we cut schema-retry turns and remove the cold-start `recipe.discover` storm without waiting on the larger pre-load/restructure work.

## Background

This is **Optimization #3** from the 2026-06-17 efficiency review — three independent quick wins. None depend on 3-S36/3-S37; this story can land first and gives immediate value.

1. **Temperature.** `planWeek`'s loop calls gpt-4o at `temperature: 0.7` (`orchestrator.ts` ~L433). The 3-S32 dev notes flag 0.7 as a driver of `plan.compose` schema deviations — each deviation costs a self-correction turn (and a `planner.bad_output` audit). The loop is compose-dominated, so a lower temperature reduces retries.
2. **Catalog cold-start.** `recipes` starts empty ([[recipe-agent-lazy-catalog]]); when the catalog is unseeded, `recipe.search` returns nothing and the planner falls to `recipe.discover` — up to ~10 calls at **8 s each** on the planning hot path. If catalog seeding (`catalog-seed.job`) is guaranteed to run and complete before the first plan, the discover storm never hits planning. This task is **verify-then-fix**: confirm seeding precedes first composition; if not, wire it.
3. **Batch-search nudge.** The loop already executes multiple `toolCalls` from a single response, but gpt-4o emits them one-per-turn. A prompt nudge to batch independent searches reduces turns when fallback search is used. (Lower value once 3-S36 demotes search to fallback — include only if cheap.)

## Acceptance Criteria

1. Planner compose temperature lowered (recommend `0.1–0.2`) for the `planWeek` loop's `completeWithMessages` call. If a per-call temperature is preferable (lower only on the compose-likely turn), that's acceptable; simplest is lowering the loop temperature since the loop is compose-dominated. Document the chosen value.
2. **Catalog pre-seed verified.** Confirm whether `catalog-seed.job` reliably runs and completes for a household before its first `plan-generation`/on-demand composition. Document the finding. If seeding does NOT precede first composition, wire it so the planner's first run has a non-empty catalog (e.g. trigger/await seed at onboarding completion or before the first compose) — keeping `recipe.discover` as the fallback, not the default.
3. **Batch-search nudge** added to `PLANNING_CORE` (only if 3-S36 hasn't already made search fallback-only; if it has, this AC is a no-op and may be dropped with a note).
4. `PLANNER_PROMPT.version` bumped if prompt text changes; version/tool tests updated accordingly.
5. Tests: temperature value asserted in the planner call; any prompt change covered; catalog-seed ordering covered by a job/integration test or documented as a verified invariant.

## Tasks / Subtasks

- [ ] **Task 1 — Lower compose temperature** (AC: 1, 5)
  - [ ] Set the planner loop temperature to the chosen low value in `orchestrator.ts`
  - [ ] Assert it in orchestrator.test.ts (the `completeWithMessages` options)

- [ ] **Task 2 — Catalog pre-seed: verify then fix** (AC: 2, 5)
  - [ ] Trace `catalog-seed.job` trigger vs. first composition (onboarding → seed → first plan ordering)
  - [ ] Document the finding in the Dev Agent Record
  - [ ] If seeding does not precede first composition, wire it (trigger/await at the right point); otherwise no code change — record the invariant

- [ ] **Task 3 — Batch-search nudge** (AC: 3, 4) — *skip if 3-S36 already landed search-as-fallback*
  - [ ] Add a one-line batching instruction to `PLANNING_CORE`; bump version if changed

## Dev Notes

### Key Files
| File | Change |
|---|---|
| `apps/api/src/agents/orchestrator.ts` | planner loop `temperature` |
| `apps/api/src/agents/prompts/planner.prompt.ts` | (optional) batch nudge + version |
| `apps/api/src/jobs/catalog-seed.job.ts` + onboarding/finalize path | (only if Task 2 finds a gap) ensure seed precedes first compose |
| tests | orchestrator temperature; seed ordering |

### Notes
- These are independent — ship Task 1 alone if Task 2's investigation runs long.
- Task 2 is the highest-value item: it removes the worst-case cold-start latency (10 × 8 s discover). It may turn out to already be guaranteed (then it's a documented invariant + a guard test).
- Keep `recipe.discover` as the genuine fallback for cultural-variety gaps even with a seeded catalog — this story removes discover from the *default* path, not from the toolset.
- Interaction with 3-S36: if 3-S36 lands first, search/fetch are already fallback-only, so Task 3 is moot and Task 2 matters even more (the slate is built from the catalog).

### Relationship to other stories
- Independent of 3-S36 / 3-S37; can land first (lowest risk, immediate value).
- Mid-week stories (3-S33/34/35) unaffected.

### References
- [Source: orchestration efficiency review 2026-06-17] — Optimization #3
- [Source: apps/api/src/agents/orchestrator.ts] — `completeWithMessages` call options (~L431-436)
- [Source: apps/api/src/jobs/catalog-seed.job.ts] — catalog seeding job
- [Source: apps/api/src/agents/recipe-agent.ts] — `discover` (Tavily, 8 s budget)
- [Source memory: recipe-agent-lazy-catalog] — empty-catalog cold-start model

## Dev Agent Record
### Agent Model Used
### Debug Log References
### Completion Notes List
### File List
## Change Log

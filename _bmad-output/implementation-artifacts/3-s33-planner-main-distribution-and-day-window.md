# Story 3.S33: Planner Main Distribution + Day-Window Plumbing

Status: done

## Story

As a parent receiving a freshly generated plan,
I want no two consecutive days to share the same Main, and I want the planner to be able to compose only a subset of the week's days,
so that my week has built-in variety by default and the planner can support mid-week (partial-week) composition (Story 3.S34).

## Background

This is the planner-layer foundation for on-demand / mid-week plan composition. It does two independent-but-related things, both in the planner layer (`orchestrator.ts` + `planner.prompt.ts`):

1. **Day-window plumbing** — adds an optional `plannedDays` to `PlanWeekOptions` so a caller can tell the planner "compose ONLY these weekdays." When absent, behavior is unchanged (full default week). Story 3.S34 supplies the value; this story only wires the plumbing + prompt instruction.

2. **No-consecutive-Main distribution rule** — replaces the long-standing 3-Main consecutive-pairing default (M1 Mon+Tue, M2 Wed+Thu, M3 Fri) with a rule that **no two consecutive days share a Main on any generation** (first generation, week-scope regen, guardrail retry). Users may still swap to make adjacent days match — that is a deliberate user edit, not generation.

**Decision record (2026-06-17):** the no-consecutive-Main rule is **global** (all first-generation AND regeneration), **prompt-only** (best-effort; no deterministic validator). Confirmed by Menon. This supersedes the [[three-main-weekly-pattern]] memory, which must be updated when this ships.

Both changes live in `PLANNING_CORE`, so the Main rule applies automatically to every `planWeek()` call. The day-window line mirrors the existing `dayScope` / `slotScopeContext` pattern.

## Acceptance Criteria

1. `PlanWeekOptions` (orchestrator.ts) has an optional `plannedDays?: readonly Weekday[]` field. `Weekday` imported from `@hivekitchen/types`.
2. When `opts.plannedDays` is present and non-empty, `planWeek()` renders a high-priority constraint line and unshifts it onto `contextLines` (same mechanism as `slotScopeContext`), e.g.:
   `PARTIAL WEEK: Compose plan_days entries for ONLY these weekdays: wednesday, thursday, friday. Do NOT emit any plan_days entry for any other weekday — the omitted days are intentionally left empty (the plan starts mid-week).`
3. When `opts.plannedDays` is `undefined` or empty, no partial-week line is rendered and the planner composes the full default week exactly as before (no behavioral change).
4. `PLANNING_CORE` is updated so the planner distributes Mains such that **no two consecutive days reference the same Main** on any generation. The guidance includes: 2-day window → 2 distinct Mains; 3+ days → a Main may repeat but never on adjacent days; keep ~2–3 distinct Mains per full week for variety. The illustrative full-week distribution becomes `M1, M2, M1, M3, M2` (Mon..Fri), presented as a guideline, not a rigid template.
5. The pre-existing "3-Main weekly pattern (M1 Mon+Tue, M2 Wed+Thu, M3 Fri-flex) is the default" text in `PLANNING_CORE` is removed/replaced (it directly contradicts AC 4).
6. The two worked examples in `PLANNING_CORE` are verified to not model adjacent-same-Main day mappings; adjusted if they do. (Today both examples are single-day, so likely no change — confirm.)
7. `PLANNER_PROMPT.version` is bumped to `v2.6.0` with a version-history comment.
8. **(Best-effort, may defer)** For day-scope regeneration (`opts.dayScope` set), the planner is given the adjacent days' current Mains so it can avoid matching them. Implemented via an optional `adjacentMains?: ReadonlyArray<{ day: Weekday; main_name: string }>` on `PlanWeekOptions`, rendered into the day-scope context line when present. If this materially complicates the slice, it may be deferred to a follow-up and logged in deferred-work.md.
9. Unit tests: `plannedDays` injection (present → partial-week line appears first; absent → user message unchanged); prompt-content assertions for the new Main-distribution guidance; version bump test.

## Prompt Update (PLANNING_CORE)

**Replace** the current main_assignments description:

> ```
> main_assignments  — your 3 Main bases for the week (M1, M2, M3). Each carries
>                     a sequence (1..6) and a recipe_id. The 3-Main weekly pattern
>                     (M1 Mon+Tue, M2 Wed+Thu, M3 Fri-flex) is the default.
> ```

**With** distribution guidance along these lines:

> ```
> main_assignments  — your 2–3 Main bases for the week. Each carries a sequence
>                     (1..6) and a recipe_id.
>
> Main distribution rule (applies every time you compose, including regeneration):
> - NO two consecutive days may share the same Main. Adjacent days must differ.
> - A 2-day plan uses 2 distinct Mains (e.g. A, B).
> - A 3+ day plan may reuse a Main, but never on adjacent days (e.g. A, B, A — not A, A, B).
> - For a full Mon–Fri week, distribute ~2–3 distinct Mains non-consecutively,
>   e.g. M1, M2, M1, M3, M2. This is a guideline, not a fixed template.
> - The parent may later swap to make adjacent days match if they wish — that is
>   their choice and is not your concern when generating.
> ```

## Tasks / Subtasks

- [x] **Task 1 — plannedDays plumbing** (AC: 1, 2, 3)
  - [x] Add `plannedDays?: readonly Weekday[]` to `PlanWeekOptions`; import `Weekday` from `@hivekitchen/types` (check existing imports first)
  - [x] Destructure `plannedDays` in `planWeek()`
  - [x] Build a `plannedDaysContext` string when present & non-empty; `unshift` it onto `contextLines` (after `uncertainContext`/`slotScopeContext` precedence — partial-week framing is a primary constraint)
  - [x] No-op when absent/empty

- [x] **Task 2 — No-consecutive-Main rule in PLANNING_CORE** (AC: 4, 5, 6, 7)
  - [x] Replace the 3-Main consecutive-pairing text with the distribution rule (see **Prompt Update**)
  - [x] Verify both worked examples don't model adjacent-same-Main; adjust if needed
  - [x] Bump `PLANNER_PROMPT.version` to `v2.6.0` + history comment

- [x] **Task 3 — (best-effort) day-scope neighbor Mains** (AC: 8)
  - [x] Add optional `adjacentMains?` to `PlanWeekOptions`; render into the day-scope context line when present
  - [x] (Story 3.S34/regeneration job populates it from the previous plan's day→Main map — this story only adds the plumbing + prompt rendering)
  - [x] If complexity is high, defer with a deferred-work.md note

- [x] **Task 4 — Tests** (AC: 9)
  - [x] orchestrator.test.ts: plannedDays present → user message starts with the PARTIAL WEEK line; absent → unchanged
  - [x] planner.prompt.test.ts: asserts the no-consecutive guidance is present; version is `v2.6.0`
  - [x] plan.tools.test.ts: version assertion updated to `v2.6.0`

## Dev Notes

### Key Files

| File | Change |
|---|---|
| `apps/api/src/agents/orchestrator.ts` | `plannedDays?` (+ optional `adjacentMains?`) on `PlanWeekOptions`; render partial-week + neighbor-Main context lines in `planWeek()` |
| `apps/api/src/agents/prompts/planner.prompt.ts` | Replace 3-Main pairing default with no-consecutive distribution rule; bump to v2.6.0 |
| `apps/api/src/agents/orchestrator.test.ts` | plannedDays injection tests |
| `apps/api/src/agents/prompts/planner.prompt.test.ts` | Main-rule + version assertions |
| `apps/api/src/agents/tools/plan.tools.test.ts` | version assertion |

### Notes

- The partial-week constraint should sit at/near position 0 of `contextLines` (use `unshift`, like `slotScopeContext` at orchestrator.ts ~398 and `uncertainContext` ~405). The KitchenMap block (Story 3.S32) is also first for prefix-cache; partial-week framing is a per-run constraint, so unshifting it above the KitchenMap block is acceptable (the KitchenMap block changes the cache prefix per household anyway).
- `PlanComposeTreeOutputSchema.days` is already `.min(1).max(DAYS_PER_PLAN_MAX)` with no Monday-start/contiguity rule, so a partial-week emission is already schema-valid — no contract change needed.
- Prompt is currently `v2.5.0` (Story 3.S32). This story → `v2.6.0`.
- This story has standalone value: the Main-distribution rule improves variety in ALL plans immediately, even before Stories 3.S34/3.S35 land.
- After ship, update the [[three-main-weekly-pattern]] memory to reflect the no-consecutive rule.

### References

- [Source: apps/api/src/agents/orchestrator.ts] — `PlanWeekOptions` (~L123), `planWeek()` contextLines assembly (~L375), `slotScopeContext`/`uncertainContext` unshift (~L398-405)
- [Source: apps/api/src/agents/prompts/planner.prompt.ts] — PLANNING_CORE main_assignments text (~L37-49), worked examples, version block
- [Source: packages/contracts/src/plan.ts] — `WeekdaySchema` (~L366), `PlanComposeTreeOutputSchema.days` (~L687)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (bmad-dev-story workflow)

### Debug Log References

- Targeted suites green: `orchestrator.test.ts` + `planner.prompt.test.ts` + `plan.tools.test.ts` → 71/71 pass.
- `pnpm --filter @hivekitchen/api typecheck` → 0 errors.
- Full `src/agents/` run: 309 pass / 4 fail. The 4 failures are in `memory.tools.test.ts` (×2) and `onboarding.tools.test.ts` (×2) — neither the tests nor their source files are in this story's change set; they are the documented pre-existing baseline (per the 3-s39 sprint note: "auth/memory/onboarding/... unrelated"). Not introduced here.

### Completion Notes List

- **AC1–3 (Task 1):** `plannedDays?: readonly Weekday[]` added to `PlanWeekOptions`; `Weekday` folded into the existing `@hivekitchen/types` type-only import (alongside `KitchenMap`). Destructured in `planWeek()`. When present & non-empty, a `PARTIAL WEEK: …` line is `unshift`-ed onto `contextLines` AFTER the `slotScopeContext`/`uncertainContext` unshifts, so it lands at position 0 (primary constraint). No-op when `undefined` or `[]` (length guard).
- **AC4–7 (Task 2):** `PLANNING_CORE` `main_assignments` description rewritten from the 3-Main consecutive-pairing default to the no-consecutive distribution rule (verbatim from the story's Prompt Update). The old "M1 Mon+Tue, M2 Wed+Thu, M3 Fri-flex" line is removed. `PLANNER_PROMPT.version` → `v2.6.0` with a version-history comment block.
- **AC6:** Both worked examples are single-day (Example 1 = Monday, Example 2 = Wednesday), so neither models an adjacent-same-Main mapping. No change required — confirmed.
- **AC8 (Task 3):** Implemented (not deferred) — low complexity. Optional `adjacentMains?: ReadonlyArray<{ day: Weekday; main_name: string }>` added to `PlanWeekOptions`; when `dayScope` is set and `adjacentMains` is non-empty, a clause is appended to the existing day-scope context line listing the neighbour days' Mains with a "do NOT assign the same Main" instruction. Populated by the regen caller in a later story (3-S34/regeneration job).
- **AC9 (Task 4):** 5 new orchestrator tests (PARTIAL-WEEK present-first / absent / empty; adjacentMains present-appends / absent-omits) + 2 new planner-prompt tests (distribution-rule present; old pairing default gone) + version-bump assertions updated in `planner.prompt.test.ts` and `plan.tools.test.ts`.
- **Memory follow-up:** [[three-main-weekly-pattern]] memory updated to record that the consecutive M1 Mon+Tue / M2 Wed+Thu pairing is superseded by the no-consecutive-Main rule (per Dev Notes "After ship, update the memory").
- No contract, migration, dependency, or web change. `PlanComposeTreeOutputSchema.days` already allows a non-contiguous subset, so partial-week emission is schema-valid with no contract change.

### File List

- `apps/api/src/agents/orchestrator.ts` (modified — `Weekday` import; `plannedDays?` + `adjacentMains?` on `PlanWeekOptions`; destructure; day-scope adjacent-Main clause; PARTIAL WEEK unshift)
- `apps/api/src/agents/prompts/planner.prompt.ts` (modified — no-consecutive distribution rule; version → v2.6.0 + history comment)
- `apps/api/src/agents/orchestrator.test.ts` (modified — partial-week & adjacent-Main injection describe block, 5 tests)
- `apps/api/src/agents/prompts/planner.prompt.test.ts` (modified — version v2.6.0 + distribution-rule assertions)
- `apps/api/src/agents/tools/plan.tools.test.ts` (modified — version assertion → v2.6.0)
- `C:\Users\menon\.claude\projects\F--development-hivekitchen\memory\three-main-weekly-pattern.md` (modified — superseded note)

### Review Findings

- [x] [Review][Patch] `plannedDays` + `dayScope` coexist with no guard — LLM receives contradictory top-level framing (PARTIAL WEEK vs DAY ONLY) with no defined winner [apps/api/src/agents/orchestrator.ts:435-441] — FIXED: early throw in planWeek() + test
- [x] [Review][Defer] `last_used_at: null` renders as `""` in YAML — empty string is semantically wrong for a date field; ideally `'null'` string or omit the key [apps/api/src/agents/orchestrator.ts:1217] — deferred, pre-existing (3-s32 patch)
- [x] [Review][Defer] No ordering-regression test: `plannedDays` position-0 guarantee not verified when `uncertainContext` is also set simultaneously [apps/api/src/agents/orchestrator.test.ts] — deferred, pre-existing test coverage gap
- [x] [Review][Defer] `main_assignments` sequence number ambiguity for 2-day plans — prompt says "2 distinct Mains" but schema accepts any sequence (1..6); non-contiguous sequences produce undefined day→Main join behavior [apps/api/src/agents/prompts/planner.prompt.ts] — deferred, pre-existing schema gap

## Change Log

- 2026-06-17 — Implemented Story 3.S33 (dev-story): planner Main-distribution rule (no two consecutive days share a Main, all generations) + `plannedDays` / `adjacentMains` day-window plumbing on `PlanWeekOptions`. Prompt → v2.6.0. +7 tests; typecheck clean; targeted suites 71/71 green. No contract/migration/dep change.

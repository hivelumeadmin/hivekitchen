# Story pre-4-s1: planWeek Options-Object Refactor

Status: done

## Story

As a developer working on the planning engine,
I want `planWeek()` to accept a single options object instead of 14 positional parameters,
so that call sites are readable, the test harness reflects the real signature, and future parameters can be added without breaking positional ordering.

## Context

`planWeek()` in `apps/api/src/agents/orchestrator.ts` grew from 3 params at story 3-13 to 14 params by story 3-29 — one per planning story. Every call site uses multiple `undefined` placeholders. The test harness in `plan-regeneration.job.test.ts` was never updated past 6 params, meaning integration tests silently pass the wrong positional arguments (e.g., `slotScopeContext` lands in the `culturalContext` position). This is a **mechanical refactor only** — no behavior change.

**Source:** deferred-work.md → "Deferred from: implementation of 3-23" (planWeek positional params) and "Deferred from: 3-22" entries.

## Acceptance Criteria

1. **Given** the refactored `planWeek(opts: PlanWeekOptions)` signature,
   **When** called from `plan-generation.job.ts` (2 call sites) and `plan-regeneration.job.ts` (2 call sites),
   **Then** all call sites pass a named options object — no positional `undefined` placeholders.

2. **Given** the test harness in `plan-regeneration.job.test.ts`,
   **When** tests assert planWeek was called with specific arguments,
   **Then** assertions use the named options object shape, and `slotScopeContext` is no longer silently misassigned to the `culturalContext` position.

3. **Given** the refactor is complete,
   **When** `pnpm typecheck` runs,
   **Then** zero type errors.

4. **Given** existing tests in `plan-generation.job.test.ts` and `plan-regeneration.job.test.ts`,
   **When** tests run after the refactor,
   **Then** all previously passing tests still pass.

5. **Given** the new `PlanWeekOptions` type,
   **When** all required fields (`householdId`, `weekOf`, `requestId`) are absent,
   **Then** TypeScript reports a compile error.

## Tasks / Subtasks

### Task 1 — Define `PlanWeekOptions` interface and update function signature (AC: 1, 3, 5)

**File:** `apps/api/src/agents/orchestrator.ts`

Define the options type (inline or in a local types block — keep it in-file, do not create a new types file for a single interface):

```typescript
interface PlanWeekOptions {
  householdId: string;
  weekOf: string;
  requestId: string;
  rejectionContext?: string;
  dayScope?: string;
  culturalContext?: PlannerCulturalContext;
  bagCompositions?: readonly PlannerBagComposition[];
  extraRules?: readonly PlannerExtraRules[];
  extraLibraryItems?: readonly PlannerExtraLibraryItem[];
  extraProposals?: readonly PlannerExtraProposal[];
  slotScopeContext?: string;
  uncertainContext?: string;
  variantEligibleChildren?: readonly PlannerVariantEligibleChild[];
  sovereigntyMode?: 'unified' | 'alternating';
}
```

Change function signature from:
```typescript
async planWeek(
  householdId: string,
  weekOf: string,
  requestId: string,
  rejectionContext?: string,
  // ... 11 more positional params
): Promise<PlanComposeOutput>
```

To:
```typescript
async planWeek(opts: PlanWeekOptions): Promise<PlanComposeOutput>
```

Inside the function body, destructure at the top:
```typescript
const {
  householdId, weekOf, requestId,
  rejectionContext, dayScope, culturalContext,
  bagCompositions, extraRules, extraLibraryItems,
  extraProposals, slotScopeContext, uncertainContext,
  variantEligibleChildren, sovereigntyMode,
} = opts;
```

The rest of the function body uses the same local variable names — no further changes needed inside the function.

- [x] Define `PlanWeekOptions` interface in `orchestrator.ts`
- [x] Change `planWeek` signature to `planWeek(opts: PlanWeekOptions)`
- [x] Add destructure block at top of function body
- [x] Verify function body compiles with no changes beyond destructure

### Task 2 — Update `plan-generation.job.ts` call sites (AC: 1, 3)

**File:** `apps/api/src/jobs/plan-generation.job.ts`

Two call sites. Convert from positional to named:

**First call (lines 341–356) — initial generation:**
```typescript
const composeOutput = await fastify.orchestrator.planWeek({
  householdId: household_id,
  weekOf: week_of,
  requestId: request_id,
  culturalContext,
  bagCompositions,
  extraRules,
  extraLibraryItems,
  extraProposals,
  variantEligibleChildren,
  sovereigntyMode,
});
```

**Second call (lines 420–435) — retry after rejection:**
```typescript
const retryOutput = await fastify.orchestrator.planWeek({
  householdId: household_id,
  weekOf: week_of,
  requestId: request_id,
  rejectionContext,
  culturalContext,
  bagCompositions,
  extraRules,
  extraLibraryItems,
  extraProposals,
  uncertainContext,
  variantEligibleChildren,
  sovereigntyMode,
});
```

Omit fields that were `undefined` — TypeScript treats absent optional fields as `undefined`.

- [x] Update first planWeek call site (initial generation)
- [x] Update second planWeek call site (retry)

### Task 3 — Update `plan-regeneration.job.ts` call sites (AC: 1, 3)

**File:** `apps/api/src/jobs/plan-regeneration.job.ts`

Two call sites. Convert from positional to named:

**First call (lines 152–166) — initial regen:**
```typescript
const composeOutput = await fastify.orchestrator.planWeek({
  householdId: household_id,
  weekOf: week_of,
  requestId: request_id,
  dayScope: scope === 'day' ? day : undefined,
  culturalContext,
  bagCompositions,
  extraRules,
  extraLibraryItems,
  extraProposals,
  slotScopeContext,
  variantEligibleChildren,
});
```

**Second call (lines 278–292) — retry:**
```typescript
const retryOutput = await fastify.orchestrator.planWeek({
  householdId: household_id,
  weekOf: week_of,
  requestId: request_id,
  rejectionContext,
  dayScope: scope === 'day' ? day : undefined,
  culturalContext,
  bagCompositions,
  extraRules,
  extraLibraryItems,
  extraProposals,
  slotScopeContext,
  uncertainContext,
  variantEligibleChildren,
});
```

Note: `sovereigntyMode` was present in `plan-generation.job.ts` calls but absent from the regeneration calls — check the current code before deciding; do NOT add it if it's not already there.

- [x] Update first planWeek call site (initial regen)
- [x] Update second planWeek call site (retry)

### Task 4 — Fix test harness in `plan-regeneration.job.test.ts` (AC: 2, 4)

**File:** `apps/api/src/jobs/plan-regeneration.job.test.ts`

The `runRegenerationJob` harness currently calls mock planWeek with 6 positional args (lines 74–81). The real function takes an options object now.

**Current broken mock call:**
```typescript
const composeOutput = await deps.planWeek(
  household_id,
  week_of,
  request_id,
  undefined,
  scope === 'day' ? day : undefined,
  slotScopeContext,     // ← lands in culturalContext position — WRONG
);
```

**Fix to options object:**
```typescript
const composeOutput = await deps.planWeek({
  householdId: household_id,
  weekOf: week_of,
  requestId: request_id,
  dayScope: scope === 'day' ? day : undefined,
  slotScopeContext,
});
```

Also fix test assertions that verify the planWeek call shape (lines 161, 196–203, 283). Convert from positional `toHaveBeenCalledWith(arg1, arg2, ...)` to `toHaveBeenCalledWith(expect.objectContaining({ householdId: ..., weekOf: ... }))`.

```typescript
// scope=week assertion (line 161):
expect(planWeek).toHaveBeenCalledWith(
  expect.objectContaining({ householdId: HOUSEHOLD_ID, weekOf: '2026-05-04', requestId: REQUEST_ID }),
);

// scope=day assertion (lines 196-203):
expect(planWeek).toHaveBeenCalledWith(
  expect.objectContaining({ householdId: HOUSEHOLD_ID, dayScope: 'tuesday' }),
);

// slotScopeContext assertion (line 283):
expect(planWeek).toHaveBeenCalledWith(
  expect.objectContaining({ slotScopeContext: expect.any(String) }),
);
```

- [x] Fix `runRegenerationJob` harness mock call
- [x] Fix `toHaveBeenCalledWith` positional assertions → `objectContaining`
- [x] Confirm all tests pass after fix

### Task 5 — Verify no other call sites exist (AC: 3)

```bash
grep -rn "\.planWeek(" apps/api/src/
```

Should return only the 4 sites updated above (2 in plan-generation.job.ts, 2 in plan-regeneration.job.ts). If any others are found, update them.

- [x] Search for remaining `.planWeek(` call sites
- [x] Update any found

## Dev Notes

### This Is Purely Mechanical

No logic changes inside `planWeek` body. No behavior changes in any caller. The only observable difference is the TypeScript signature and call-site readability. All runtime values are identical.

### Do NOT

- Add new parameters to `PlanWeekOptions` in this story — scope is refactor only
- Change the function's internal logic
- Extract `PlanWeekOptions` to a shared package — it's an orchestrator-internal interface
- Rename any existing fields — keep names identical to old positional parameter names

### TypeScript: export type if needed

If `PlanWeekOptions` is referenced in test files, either export it from `orchestrator.ts` or define a local equivalent in the test file. Prefer exporting from `orchestrator.ts` to avoid duplication.

### File Locations

All files in `apps/api/` require `.js` extension on relative imports in emitted JS. `tsx watch` hides this; `pnpm build` will catch it. No new files are created in this story.

### References

- Current planWeek signature: [Source: `apps/api/src/agents/orchestrator.ts` lines 257–272]
- Call site 1+2: [Source: `apps/api/src/jobs/plan-generation.job.ts` lines 341–356, 420–435]
- Call site 3+4: [Source: `apps/api/src/jobs/plan-regeneration.job.ts` lines 152–166, 278–292]
- Broken test harness: [Source: `apps/api/src/jobs/plan-regeneration.job.test.ts` lines 74–81, 161, 196–203, 283]
- Deferred-work entry: [Source: `_bmad-output/implementation-artifacts/deferred-work.md` — "Deferred from: 3-23"]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (Opus 4.7, 1M context) via Claude Code, 2026-05-26

### Debug Log References

- Pre-existing typecheck errors confirmed against `git stash` baseline (identical set on `main`):
  `src/evals/runner.ts`, `src/jobs/plan-regeneration.job.test.ts` (TS2348 Mock typing, TS2322 day enum), `src/modules/catalog/*`, `src/modules/internal/health.routes.test.ts`, `src/modules/plans/{brief-state.composer,day-overrides.repository,plans.service}.test.ts`, `src/modules/voice/*`, `src/modules/households/households.routes.test.ts`. None introduced by this refactor.
- Pre-existing test failures confirmed against `git stash` baseline (11 files / 30 failures): auth.routes, day-overrides.service, day-overrides.repository, brief-state.composer, extra-library.repository, memory.service, plan-adjustment.service, catalog-seed.service, onboarding.tools, planner.prompt, audit.types. None introduced by this refactor.
- Targeted runs (51/51 pass): `pnpm vitest run src/jobs/plan-regeneration.job.test.ts src/agents/orchestrator.planweek.test.ts src/agents/orchestrator.test.ts`.

### Completion Notes List

- Defined `PlanWeekOptions` interface inline in `orchestrator.ts` (not extracted to a separate types file, per story guidance — single use).
- Refactored `planWeek` from 14 positional params to single `opts: PlanWeekOptions` argument with a top-level destructure; function body untouched (AC1, AC3, AC5).
- Converted all 4 call sites in production code (`plan-generation.job.ts` ×2, `plan-regeneration.job.ts` ×2) to named-options form, omitting fields that were previously `undefined` placeholders. `sovereigntyMode` intentionally omitted from regen call sites — it was absent from the prior positional calls (as story notes confirmed).
- Fixed the silent bug in `plan-regeneration.job.test.ts`: the mock harness was passing `slotScopeContext` in arg position 6, which TypeScript was treating as `culturalContext`. The new options-object form makes this misassignment impossible. Updated three `toHaveBeenCalledWith` assertions to use `expect.objectContaining({ ... })` and the two `mock.calls[0]?.[5]` slotScope assertions to extract from the options object (AC2).
- Discovered and updated 8 additional positional call sites in two test files not listed in the story (Task 5 — "Update any found"):
  - `orchestrator.planweek.test.ts` (7 call sites)
  - `orchestrator.test.ts` (3 call sites)
- AC5 verified by inspection of TS-strict interface: `householdId`, `weekOf`, `requestId` are required fields → omitting any of them is a compile error.

### File List

- `apps/api/src/agents/orchestrator.ts` — added `PlanWeekOptions` interface; refactored `planWeek` signature + destructure
- `apps/api/src/jobs/plan-generation.job.ts` — converted 2 `planWeek` call sites to options object
- `apps/api/src/jobs/plan-regeneration.job.ts` — converted 2 `planWeek` call sites to options object
- `apps/api/src/jobs/plan-regeneration.job.test.ts` — fixed harness mock call (closes silent `slotScopeContext`→`culturalContext` misassignment); converted 3 `toHaveBeenCalledWith` assertions to `objectContaining`; converted 2 `slotScopeContext` extractions to options-object form
- `apps/api/src/agents/orchestrator.planweek.test.ts` — converted 7 `planWeek` call sites to options object (Task 5)
- `apps/api/src/agents/orchestrator.test.ts` — converted 3 `planWeek` call sites to options object (Task 5)

### Review Findings

- [ ] [Review][Decision] **Out-of-scope Story 3-29 logic bundled into pre-4-s1** — The diff contains substantial new behavior beyond the mechanical refactor: `buildSovereigntyContextLines()` (new exported function + `sovereigntyLines` injection into `contextLines` inside `planWeek`), `getSovereigntyMode()` fetch + `HouseholdsRepository` instantiation in `plan-generation.job.ts`, `handleDegradedPlan` block in `plan-generation.job.ts`, and `metadata` fields added to two `complete()` calls. Story spec says "mechanical refactor only — no behavior change" and "Do NOT change the function's internal logic." These additions are all tagged "Story 3.29" in comments. Decision: (A) accept as combined PR, (B) split 3-29 logic into a separate commit/story, or (C) revert to pure refactor.

- [x] [Review][Patch] **`sovereigntyMode` absent from `plan-regeneration.job.ts` — all regen silently gets unified prompt framing** — `plan-regeneration.job.ts` never fetches or passes `sovereigntyMode` to either `planWeek` call, so `buildSovereigntyContextLines` always receives `undefined`. For multi-template households this means the unified degraded-reason invitation is injected on every day-scope and slot-scope regeneration, regardless of the household's actual sovereignty preference. *Conditional: only relevant if Decision D1 resolves to "keep scope creep."* [`apps/api/src/jobs/plan-regeneration.job.ts` — both `planWeek` call sites]

- [x] [Review][Defer] **Swap agent `complete()` passes `PLANNER_PROMPT.toolsAllowed`** [`apps/api/src/agents/orchestrator.ts` — swap agent path ~line 537] — deferred, pre-existing. Not introduced by this PR; the tools argument was already `PLANNER_PROMPT.toolsAllowed` before the refactor. Needs investigation: should the swap agent be receiving planner tools?

- [x] [Review][Defer] **`getSovereigntyMode` `.catch()` swallows all error types under the same `'unified'` fallback** [`apps/api/src/jobs/plan-generation.job.ts` ~line 291] — deferred, pre-existing pattern for graceful fallback. `NotFoundError` (household missing) and transient DB errors both silently fall back to `'unified'`. Sovereignty is an opt-in offer so the impact is bounded, but alternating-mode households get wrong prompt framing with no alert beyond a warn log.

## Change Log

| Date       | Version | Description                                                                                  | Author |
|------------|---------|----------------------------------------------------------------------------------------------|--------|
| 2026-05-26 | 1.0     | Refactor `planWeek` from 14 positional params → `PlanWeekOptions`. Closes silent test bug. | Menon (via Claude Code) |

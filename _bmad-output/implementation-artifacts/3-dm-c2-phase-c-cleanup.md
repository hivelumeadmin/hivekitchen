# Story 3-DM-C2: Phase C cleanup — post-cutover fixes + load-test findings

Status: planned

## Story

As Epic 3 data-model solutioning,
We want to address any test breakage, load-test findings, or planner prompt regressions that surface after C1's atomic cutover,
So that Phase C closes cleanly before Phase E's adjacent cleanup begins.

## Acceptance Criteria

1. Any test breakage discovered post-C1 merge is fixed (TypeScript-guided; should be exhaustively caught at C1 merge time but a long tail can emerge).
2. Load-test findings from C1's §3.9 gate are addressed:
   - If `commit_plan()` p99 exceeded budget at 100 concurrent calls → add indexes, tune txn scope, or relax budget after analysis
   - Capture findings + decisions in story PR description
3. Planner-prompt regression metrics in place:
   - Bad-output rate instrumented (e.g., audit-log event when `PlanComposeOutputSchema.parse()` fails on LLM response)
   - Rollback prompt-only path documented (revert just `planner.prompt.ts` to prior version; new schema accepts via best-effort parse)
4. Any orphaned references to removed columns/tables cleaned up:
   - `plan_items.*` orphaned references
   - `plans.week_id` orphaned references
   - `brief_state.plan_state*` orphaned references
   - Any stale type imports or test fixtures
5. Deferred-work log updated with any findings not addressed in this story.

## Dependencies & Context

**Design references:**
- Authoritative: canonical §10.5 (Phase C scope) and §10.6 (deferred runtime optimizations)
- Breakdown: phase-4 doc Story C2

**Story dependencies:** C1 must merge first.

**Downstream blockers:** E1 (adjacent table cleanup pass).

**Key invariants:**
- Don't expand scope: this story handles fallout from C1, not new design work
- If a finding warrants its own story, file as a follow-up and defer here

## Tasks / Subtasks

### Task 1 — Test backlog burn-down

- [ ] Run full test suite (`pnpm test`) and address failures one by one
- [ ] Focus on integration-style tests that may have been missed in C1's mechanical refactor
- [ ] Update `apps/api/test/factories/` with any missing helpers discovered

### Task 2 — Load test analysis + tuning

- [ ] Review C1 load-test results
- [ ] If p99 met → file as "gate passed" in story PR
- [ ] If p99 exceeded → analyze:
  - Lock contention on `plans` row? (consider moving plans UPDATE earlier in some paths if §3.9 pattern proves too contentious)
  - Multi-row INSERT size? (try batching variations differently)
  - Index inefficiency? (EXPLAIN ANALYZE the slow queries)
- [ ] Add fixes via additional migration if needed (e.g., new compound indexes)

### Task 3 — Planner prompt regression watch

- [ ] Add instrumentation: log when `PlanComposeOutputSchema.parse()` fails on planner output
- [ ] Set up alerting threshold (e.g., >5% failure rate in any 1-hour window)
- [ ] Document rollback path in `_bmad-output/implementation-artifacts/planner-prompt-rollback.md`:
  - How to revert `planner.prompt.ts` to prior version
  - Any compatibility shim needed for the new schema to accept old flat-array output (likely just a translation layer in `buildCommitInput`)

### Task 4 — Orphan reference audit

- [ ] `grep -rn "plan_items" apps/api/src` — should return 0 results in code (only migration history mentions)
- [ ] `grep -rn "plans.week_id" apps/api/src` — same
- [ ] `grep -rn "brief_state.plan_state" apps/api/src` — same
- [ ] `grep -rn "item_sku_id" apps/api/src` — same
- [ ] `grep -rn "snack_skus" apps/api/src` — same (excluding migration files)
- [ ] Address any hits

### Task 5 — Deferred-work updates

- [ ] If any findings from Tasks 1-4 are deferred rather than fixed, log them in `_bmad-output/implementation-artifacts/deferred-work.md` with rationale

## Test Plan

This story IS test maintenance. No new tests required beyond what's needed to close failing ones.

## Rollback

Revert specific fixes. C1 stays.

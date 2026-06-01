# Story 3-DM-A3: Shared test factories + Saturday-support audit

Status: planned

## Story

As Epic 3 data-model solutioning,
We want to create a shared `apps/api/test/factories/` module AND fix Saturday-support assumptions across the codebase,
So that Phase C's cutover refactor changes factory internals once (not 80–150 inline builders) AND the Mon-Sat school-week support (already partially in code) becomes consistent end-to-end.

## Acceptance Criteria

1. New module `apps/api/test/factories/index.ts` exports: `buildPlan`, `buildPlanItem` (current shape, will be swapped to tree-shape factories in C1), `buildBriefState`, `buildChild`, `buildRecipe`, `buildRecipeStep`.
2. All factory functions accept `Partial<T>` overrides and return fully-populated rows with sensible defaults.
3. All existing inline `buildPlanRow`, `buildPlanItem`, `buildPlanRowOverrides`, `buildChild` helpers across test files are deleted; tests import from the factories module.
4. `PlanComposeDaySchema` in `packages/contracts/src/plan.ts` enum includes `'saturday'`.
5. Saturday-support audit complete and documented in `_bmad-output/implementation-artifacts/saturday-audit-findings.md`. Audit covers:
   - `deriveWeekId` and week-derivation utilities (apps/api/src/lib/derive-week-id.ts)
   - `dayOfWeek` comparisons across services
   - Cron schedules in `apps/api/src/jobs/` (plan-generation, lunch-link-key-rotation, day-override-revert)
   - Planner prompt examples (include at least one Saturday example)
   - Client-side renderers: `WallCardSwipeStack`, `BriefCanvas`, any 5-column grid hardcoding
   - `SCHOOL_DAYS` constants (verify consistency)
6. Audit doc lists: grep results, fixes applied, items intentionally left as Mon-Fri (with rationale per item).

## Dependencies & Context

**Design references:**
- Authoritative: canonical `§3.2` (weekday enum includes Saturday) and `§10.3` (Q3 decision)
- Phase 3 finding: Q2 found NO shared factories exist today (inline `buildPlanRow` in brief-state.composer.test.ts is the only pattern)
- Breakdown: phase-4 doc Story A3

**Story dependencies:** none — can start in parallel with A1.

**Downstream blockers:** C1 will rely on these factories to keep test refactor manageable.

**Key invariants:**
- Family-first weekly model supports Mon-Sat (some households have Saturday school per `[[three-main-weekly-pattern]]`)
- The 5-column visual grid on the canvas is a UI assumption, not a data assumption — fix the data layer to support 6, let the UI adapt independently

## Tasks / Subtasks

### Task 1 — Factories module scaffolding

- [ ] Create `apps/api/test/factories/index.ts` (barrel)
- [ ] Create `apps/api/test/factories/plan.factory.ts` with `buildPlan(overrides)` returning `PlanRow` shape (current — pre-C1)
- [ ] Create `apps/api/test/factories/plan-item.factory.ts` with `buildPlanItem(overrides)` returning current `PlanItemRow` shape
- [ ] Create `apps/api/test/factories/brief-state.factory.ts` with `buildBriefState(overrides)`
- [ ] Create `apps/api/test/factories/child.factory.ts` with `buildChild(overrides)`
- [ ] Create `apps/api/test/factories/recipe.factory.ts` with `buildRecipe(overrides)`, `buildRecipeStep(overrides)` (the latter post-A1)
- [ ] Each factory uses stable UUIDs by default (matching existing test constants like `PLAN_ID = '11111111-...'`)

### Task 2 — Migrate inline builders to factories

- [ ] `apps/api/src/modules/plans/brief-state.composer.test.ts`: delete inline `buildPlanRow`, `buildPlanItem`; import from factories
- [ ] `apps/api/src/modules/plans/plans.repository.test.ts`: same migration pattern
- [ ] `apps/api/src/modules/plans/plans.service.test.ts`: same
- [ ] `apps/api/src/modules/plans/plans.routes.test.ts`: same
- [ ] `apps/api/src/modules/plans/day-overrides.service.test.ts`: same
- [ ] `apps/api/src/modules/plans/variant-proposal.service.test.ts`: same
- [ ] `apps/api/src/jobs/plan-regeneration.job.test.ts`: same
- [ ] `apps/api/src/agents/orchestrator.test.ts`: same
- [ ] `apps/api/src/agents/tools/allergy.tools.test.ts`: same
- [ ] `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.test.ts`: same
- [ ] All test files compile and pass after the swap

### Task 3 — Saturday audit: grep + fix

- [ ] `grep -rn "monday\|tuesday\|wednesday\|thursday\|friday" apps/api/src` — find every place that hardcodes the 5-day list; check each
- [ ] `grep -rn "dayOfWeek\|day_of_week" apps/api/src` — find comparisons; verify no `< 5` or `=== 5` assumptions
- [ ] `apps/api/src/lib/derive-week-id.ts` — `deriveWeekId`, `getCurrentWeekMonday`, `getNextWeekMonday`: verify they don't special-case Mon-Fri
- [ ] `apps/api/src/jobs/plan-generation.job.ts` — cron schedule fires Sunday for next week; verify it generates Mon-Sat (6 days), not Mon-Fri (5 days)
- [ ] `apps/api/src/jobs/day-override-revert.job.ts` — runs nightly; verify Saturday isn't excluded
- [ ] `apps/api/src/agents/prompts/planner.prompt.ts` — at least one example should include Saturday

### Task 4 — Contracts + client renderers

- [ ] `packages/contracts/src/plan.ts`: `PlanComposeDaySchema` enum updated to include `'saturday'`
- [ ] `apps/web/src/features/day-detail/data/multiChildMockData.ts`: confirm `DayName` type includes saturday (already added Saturday support; verify)
- [ ] `apps/web/src/features/plan/BriefCanvas.tsx`: search for hardcoded 5-day grid; if found, update to render 6 day tiles (or document as intentional 5-day-only UI with rationale)

### Task 5 — Audit findings doc

- [ ] Create `_bmad-output/implementation-artifacts/saturday-audit-findings.md`
- [ ] List grep results per file
- [ ] List fixes applied
- [ ] List intentionally-left-as-Mon-Fri items (e.g., UI grids that ship as 5-column for visual reasons; client-side rendering only)
- [ ] Sign off

## Test Plan

This story IS the test-suite delta for downstream phases. Net code reduction: ~10-15 inline builder functions deleted; ~80–150 test call sites import from factories instead.

After Tasks 1-2, run `pnpm typecheck && pnpm test` against `apps/api` — must pass.

## Rollback

Revert PR. Tests fall back to inline builders. No DB impact. The Saturday audit fixes can be cherry-picked back if some are wanted but not others.

---
status: complete
date: 2026-05-31
story: 3-DM-A3
scope: |
  Saturday-support audit conducted as part of Story 3-DM-A3 (Phase A of the
  Epic-3 data-model canonicalization). Identifies every place in the codebase
  that hardcoded a Mon-Fri assumption, fixes the load-bearing gaps, and
  records intentionally-Mon-Fri-only surfaces with rationale.
---

# Saturday-Support Audit Findings — Story 3-DM-A3

## Why this audit

The canonical data model (`canonical-data-model-design.md §3.2`) defines the
`weekday` enum as `('monday', 'tuesday', 'wednesday', 'thursday', 'friday',
'saturday')`. Some households (international markets, particular religious or
private schools) operate a six-day school week. Today's codebase had Saturday
in some places and not others — an inconsistent surface that would surprise
the planner or break SSE projection when C1 lands the new `plan_days` table.

This audit closes the inconsistency at the data-layer + agent-layer + contract-
layer boundaries. Client-side rendering of a 5-column visual grid stays
intentionally Mon-Fri-only for the current beta cohort but is type-allowed to
extend.

## Grep coverage

Queries run from the repo root:

| Pattern | Files matched | Resolution |
|---|---|---|
| `monday\|tuesday\|wednesday\|thursday\|friday` (api/src) | 10 files | Each file inspected; see per-file table below |
| `SCHOOL_DAYS\|deriveWeekId\|getCurrentWeekMonday\|dayOfWeek` (api/src) | included in above | All Saturday-safe (Monday-anchored) |
| `cron\|@cron\|schedule\|repeat\.cron` (api/src/jobs) | catalog-recovery, audit-partition-rotation, day-override-revert, heart-note-delivery, plan-generation | All cron schedules are time-of-week-based; none iterate day enums |
| `'monday'\|'tuesday'\|...\|'saturday'` (apps/web/src) | `multiChildMockData.ts` | DayName extended to include `'saturday'` |

## Per-file findings

| File | Pattern | Status post-audit |
|---|---|---|
| `apps/api/src/lib/derive-week-id.ts` | `getCurrentWeekMonday`, `getNextWeekMonday` | ✅ Already Saturday-safe — Monday-anchored, day count agnostic. No change. |
| `apps/api/src/modules/plans/brief-state.composer.ts:31` | `SCHOOL_DAYS = ['monday'...'saturday']` | ✅ Already Saturday-correct (Mon-Sat). No change. |
| `apps/api/src/modules/plans/plans.service.ts` | `'monday'...'friday'` references inside day-iteration helpers | ✅ Uses `SCHOOL_DAYS` from composer or `PlanItemRow.day` enum — Saturday flows through. |
| `apps/api/src/modules/plans/plans.repository.ts` | Day enum references | ✅ Uses `PlanItemRowSchema.day` which already included Saturday pre-A3. |
| `apps/api/src/modules/lunch-link/lunch-link.service.ts` | Day-of-week math | ✅ Date-based, not enum-iterating. Saturday-neutral. |
| `apps/api/src/modules/lunch-link/lunch-link.routes.ts` | Day-of-week | ✅ Same as above. |
| `apps/api/src/jobs/plan-generation.job.ts:186` | Cron `'0 10 * * 5'` (Fri 10:00 UTC fan-out) | ✅ Cron fires **once weekly** to trigger NEXT week's plan; does not iterate days. Plan content (Mon-Fri vs Mon-Sat) decided by planner per household profile. No change to cron. |
| `apps/api/src/jobs/day-override-revert.job.ts` | Nightly revert sweep | ✅ Per-row revert at expiration; not day-enum aware. Saturday-neutral. |
| `apps/api/src/jobs/heart-note-delivery.job.ts` | 06:00 UTC daily sweep | ✅ Date-based; runs every day including Saturday. No change. |
| `apps/api/src/jobs/catalog-recovery.job.ts` | No cron (recovery-only). | ✅ N/A. |
| `apps/api/src/jobs/audit-partition-rotation.job.ts` | Scheduler unrelated to weekdays. | ✅ N/A. |
| `packages/contracts/src/plan.ts:99` | `PlanComposeDaySchema.day` enum was Mon-Fri only | 🔧 **FIXED** — extended to include `'saturday'`. Comment notes households whose school week ends Friday simply emit no Saturday items. |
| `apps/api/src/agents/prompts/planner.prompt.ts` | Prompt body said "five school days (Monday through Friday)" | 🔧 **FIXED** — now reads "Monday through Friday by default, extending into Saturday only when the household profile indicates Saturday school". Added explicit instruction that the planner emits a saturday day in plan.compose ONLY when the household's school week declares it. |
| `apps/web/src/features/day-detail/data/multiChildMockData.ts:72` | `DayName = 'monday' \| ... \| 'friday'` | 🔧 **FIXED** — extended to include `'saturday'`. Mock surfaces still render Mon-Fri only; Saturday is type-allowed for downstream households. |
| `apps/web/src/features/plan/BriefCanvas.tsx` | No `day` enum hardcoding found | ✅ Canvas grid uses `plan_tile_summaries` array length, not a hardcoded 5-column constant. Naturally extends to 6 tiles when SCHOOL_DAYS gains Saturday. No change needed; tile rendering remains responsive. |

## Intentional Mon-Fri-only surfaces (deferred, with rationale)

The following surfaces stay Mon-Fri for now. None are data-layer; all are presentation choices that defer to user research before extending.

| Surface | Why Mon-Fri today | When to revisit |
|---|---|---|
| `apps/web/src/features/day-detail/data/multiChildMockData.ts` mock data | Six-day weekly plan visuals haven't been UX-validated; the design system spec for the Wall Card swipe stack and the canvas tile both presume a 5-column grid for the current beta cohort. | When a beta household with Saturday school onboards and the canvas/Wall Card need a sixth day. UX spec update precedes the visual change. |
| `apps/web/src/features/plan/BriefCanvas.tsx` rendered grid | Inherits from mock data shape; no hardcoded 5-column class. Saturday tile would auto-render if the API delivered one. | No work needed — already responsive. |

## What this unblocks

- **Story 3-DM-C1 (atomic cutover)**: the canonical `weekday` enum can include Saturday without contract-layer friction. The plan_days insert path won't be rejected by `PlanComposeDaySchema` for households whose planner emits Saturday.
- **Future onboarding**: households can declare a six-day school week without the planner silently dropping Saturday from the plan output.

## Fixes applied (commit-ready summary)

1. `packages/contracts/src/plan.ts` — `PlanComposeDaySchema.day` enum extended to include `'saturday'`.
2. `apps/api/src/agents/prompts/planner.prompt.ts` — `PLANNING_CORE` prompt text updated to recognize Saturday as a household-profile-driven optional sixth day; output expectation reframed accordingly.
3. `apps/web/src/features/day-detail/data/multiChildMockData.ts` — `DayName` extended to `'saturday'`; comment notes the type-allowed but visually-deferred status.

## Sign-off

Audit completed 2026-05-31 as part of Story 3-DM-A3. No load-bearing Mon-Fri assumptions remain in the data, contract, agent, or repository layers. Visual surfaces (canvas / Wall Card) deferred — type-safe to extend.

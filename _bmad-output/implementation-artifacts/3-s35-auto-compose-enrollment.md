# Story 3.S35: Auto-Compose Enrollment + Weekly Cron Gating

Status: ready-for-dev

## Story

As a parent who has composed my first plan,
I want next week's plan to be auto-composed for me every Friday evening unless I turn it off,
so that after the first manual plan I never have to think about generating again — and brand-new households are not auto-composed until they opt in by composing once.

## Background

Today the Friday cron (`plan-generation.job.ts` scheduler, `0 10 * * 5` UTC → fires 18:00 household-local Friday) fans out to **every active household** and composes next Monday's plan. Under the new model (confirmed 2026-06-17):

- The **first** plan is user-initiated (Story 3.S34).
- After that, the household is **auto-composed for the coming week, default Friday evening** (the cron's existing timing — "not Sunday evening"), and the parent can toggle this off.
- Brand-new households (no plan yet) are **no longer** auto-composed until they compose once.

This story gates the existing cron and adds the per-household preference + toggle. It depends on **Story 3.S34** (the first-plan concept).

**Behavior change to call out:** today the cron creates the first plan for new households automatically. After this story, new households must compose once (Story 3.S34) before the cron maintains the cadence. This is intended.

## Acceptance Criteria

1. Migration: add `households.auto_compose_enabled boolean NOT NULL DEFAULT true`. (Default true + the has-plan gate below means: zero-plan households are skipped regardless; once a household has a plan, auto-compose is on unless toggled off.)
2. The Friday cron fan-out (`SCHEDULE_QUEUE` worker in `plan-generation.job.ts`) enqueues a per-household job ONLY when BOTH:
   - the household has at least one existing plan, AND
   - `auto_compose_enabled = true`.
   Households failing either check are skipped (logged at debug/info with a reason).
3. **Idempotent skip:** the cron does not enqueue (or the worker no-ops) for a household that already has a plan for the target week (`week_id = deriveWeekId(nextMonday)`). This prevents overwriting a plan a user already composed on-demand for that week (e.g. a Thursday on-demand compose for next week, followed the next day by the Friday cron targeting the same week).
4. `PATCH /v1/households/:householdId/auto-compose` (or `/v1/users/me/...` per existing settings convention) toggles `auto_compose_enabled`; authorized for `primary_parent` (mirror existing settings-toggle routes); writes an audit event.
5. `GET` exposure of the current value (either a dedicated GET or inclusion in an existing household/profile settings response) so the web toggle can hydrate.
6. Web: a settings toggle ("Auto-compose next week's plan — Friday evening") that reads + optimistically updates the preference. Surfaced after the first plan exists (consistent with "once first plan is composed the user can decide").
7. Tests: migration column; cron gating (skipped when no plan / when disabled / when target week already composed; enqueued when has-plan + enabled + target week empty); toggle route (200 + audit, 403 for guest_author); web toggle (read + optimistic update).

## Decisions baked in

- **Default Friday evening** — unchanged from the existing scheduler (`0 10 * * 5` UTC → per-household delay to 18:00 local). No new schedule/time columns in this story; the toggle is on/off only. (A future story could add a configurable weekday/time.)
- **Default enabled = true** at the column level; the manual-first requirement is enforced by the has-plan gate (AC 2), not by an explicit enrollment write. No separate "enroll on first compose" step is needed.

## Tasks / Subtasks

- [ ] **Task 1 — Migration** (AC: 1)
  - [ ] `households.auto_compose_enabled boolean NOT NULL DEFAULT true` (timestamped migration in `supabase/migrations/`)
  - [ ] If the field should appear in any KitchenMap/household projection, add it; the planner does not need it, so projection changes are optional

- [ ] **Task 2 — Cron gating + idempotent skip** (AC: 2, 3)
  - [ ] In the `SCHEDULE_QUEUE` worker, when iterating active households, skip those without `auto_compose_enabled` and those with zero plans
  - [ ] Before enqueueing a per-household job, check for an existing plan at `(household_id, deriveWeekId(weekOf))`; skip if present (idempotent). Batch this check to avoid N+1 where practical
  - [ ] Repository support: a "has any plan" check and/or a batched "which of these households already have a plan for week_id" query (extend `PlansRepository` / `HouseholdsRepository`)

- [ ] **Task 3 — Preference read/write** (AC: 4, 5)
  - [ ] Repository + service getters/setters for `auto_compose_enabled`
  - [ ] `PATCH .../auto-compose` (primary_parent) + audit event (add type to `AUDIT_EVENT_TYPES`)
  - [ ] GET exposure (dedicated or folded into existing settings response)
  - [ ] Contracts schema + types

- [ ] **Task 4 — Web toggle** (AC: 6)
  - [ ] Settings toggle with read + optimistic update (mirror existing notification/accessibility toggle pattern)

- [ ] **Task 5 — Tests** (AC: 7)

## Dev Notes

### Key Files

| File | Change |
|---|---|
| `supabase/migrations/<ts>_household_auto_compose_enabled.sql` (new) | add column |
| `apps/api/src/jobs/plan-generation.job.ts` | gate fan-out on has-plan + enabled; idempotent target-week skip |
| `apps/api/src/modules/households/households.repository.ts` | preference getter/setter; has-plan / batched existing-plan lookup (may live in `plans.repository.ts`) |
| `apps/api/src/modules/households/households.routes.ts` (or users) | PATCH/GET toggle |
| `packages/contracts/src/...` | toggle request/response schema |
| `apps/api/src/audit/...` | new audit event type |
| `apps/web/...` | settings toggle |

### Notes

- The cron already paginates active households via `householdsRepo.findAllActive(offset, PAGE_SIZE)`. Add the `auto_compose_enabled` filter there (or filter in-loop) and a batched existing-plan check for the target week to keep it O(pages), not O(households) round-trips.
- `deriveWeekId(weekOf)` is the canonical week key; `PlansRepository.findByHouseholdAndWeek` is the per-household existence check (batch a variant for the fan-out).
- Idempotent skip (AC 3) is what makes the manual+auto cadence safe: an on-demand next-week compose on Thu won't be clobbered by Friday's cron.
- Keep the existing scheduler cron string and per-household 18:00-local delay (`getLocalSixPmUtcMs`) — that IS "Friday evening."
- Migration requires a `supabase db push --include-all` USER-SIDE GATE (note in sprint-status when moving to review).

### References

- [Source: apps/api/src/jobs/plan-generation.job.ts] — `SCHEDULE_QUEUE` worker, `findAllActive` pagination, `getLocalSixPmUtcMs`, GENERATE_QUEUE enqueue, `jobId: plan-gen-{hh}-{weekOf}`
- [Source: apps/api/src/lib/derive-week-id.ts] — `getNextWeekMonday`, `deriveWeekId`
- [Source: apps/api/src/modules/plans/plans.repository.ts] — `findByHouseholdAndWeek`
- [Source: Story 3.S34] — first-plan concept + on-demand path this enrollment follows
- [Source: existing settings toggles] — caption-only / notification-prefs PATCH + optimistic web toggle pattern (see Epic 5 stories)

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

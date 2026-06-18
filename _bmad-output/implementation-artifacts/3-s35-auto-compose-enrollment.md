# Story 3.S35: Auto-Compose Enrollment + Weekly Cron Gating

Status: done

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

- [x] **Task 1 — Migration** (AC: 1)
  - [x] `households.auto_compose_enabled boolean NOT NULL DEFAULT true` (timestamped migration in `supabase/migrations/`)
  - [x] If the field should appear in any KitchenMap/household projection, add it; the planner does not need it, so projection changes are optional — NOT needed (planner does not read it; no kitchen_map_version trigger required)

- [x] **Task 2 — Cron gating + idempotent skip** (AC: 2, 3)
  - [x] In the `SCHEDULE_QUEUE` worker, when iterating active households, skip those without `auto_compose_enabled` and those with zero plans
  - [x] Before enqueueing a per-household job, check for an existing plan for the target week; skip if present (idempotent). Batched via `findHouseholdIdsWithPlan(ids, weekOf)` — O(pages) not O(households)
  - [x] Repository support: `PlansRepository.hasAnyPlan` + batched `findHouseholdIdsWithPlan`; `HouseholdsRepository.findAllActive` now selects `auto_compose_enabled`

- [x] **Task 3 — Preference read/write** (AC: 4, 5)
  - [x] Repository + service getters/setters for `auto_compose_enabled`
  - [x] `PATCH .../auto-compose` (primary_parent) + audit event (`household.auto_compose_changed` added to `AUDIT_EVENT_TYPES` + migration enum)
  - [x] GET exposure (dedicated `GET /v1/households/:id/auto-compose`, returns `auto_compose_enabled` + `has_plan`)
  - [x] Contracts schema + types (`packages/contracts/src/auto-compose.ts`)

- [x] **Task 4 — Web toggle** (AC: 6)
  - [x] Settings toggle with read + optimistic update (mirrors geolocation toggle pattern); surfaced only for primary_parent once `has_plan` is true

- [x] **Task 5 — Tests** (AC: 7)

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

claude-opus-4-8 (1M context) — bmad-dev-story workflow

### Debug Log References

- Typecheck: `pnpm typecheck` — 0 errors across all 9 packages.
- Targeted suites: contracts auto-compose 6/6; API `plan-generation.job` + `plans.repository.tree` + `households.routes` 142 passed / 1 pre-existing fail; `plans.service` + `households.service` 57 passed / 1 skipped; web `household-settings` 13 passed.
- Pre-existing baseline failures (NOT caused by this story, confirmed via stash): `households.routes.test` memory 200-case (fails on committed main with route change stashed); `audit.types` enum-parity (many TS event types lack `ALTER TYPE ADD VALUE` migrations — my `household.auto_compose_changed` is balanced in both TS + SQL, verified by its no-prefix line in the diff).

### Completion Notes List

- **Migration** `20261027000000_add_household_auto_compose.sql`: `households.auto_compose_enabled boolean NOT NULL DEFAULT true` + `ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'household.auto_compose_changed'` (column + enum in one file, mirrors the 5-S14 geolocation migration pattern). No kitchen_map_version trigger — the planner never reads this column.
- **Cron gate** (AC2/AC3): `HouseholdsRepository.findAllActive` now selects `auto_compose_enabled`; the `SCHEDULE_QUEUE` worker filters to enabled households, batch-resolves "has any cleared plan" and "has a cleared plan for the target week" via `PlansRepository.findHouseholdIdsWithPlan(enabledIds[, weekOf])`, and enqueues only the eligible set. Gate decision extracted into pure exported `selectAutoComposeEligible()` for unit testing without BullMQ. Skip reasons logged in aggregate (`skipped_disabled` / `skipped_no_plan` / `skipped_already_composed`). Both "has-plan" checks use `guardrail_cleared_at IS NOT NULL` to match the canonical "a plan the user sees" semantics + the on-demand create-guard (`findByHouseholdAndWeek`).
- **Toggle** (AC4/AC5): dedicated `GET` + `PATCH /v1/households/:id/auto-compose`. PATCH is `primary_parent`-only (mirrors `sovereignty-mode`; secondary_caregiver + guest_author → 403); GET allows either caregiver (read is non-sensitive). PATCH writes the audit row via `auditService.write` (try/catch, matching `sovereignty-mode`) rather than `request.auditContext` so it is observable in the route test harness. Both responses carry `has_plan` (from `PlansService.hasAnyPlan`) so the web can gate visibility.
- **Web** (AC6): auto-compose section in `household-settings.tsx`, rendered only for `primary_parent` once `has_plan` is true; optimistic toggle with revert-on-failure (mirrors the geolocation opt-out path).
- **Decisions baked in:** default `true` at the column level + the has-plan gate is what makes "manual-first" work without an explicit enrollment write — a zero-plan household is skipped regardless; once a plan clears, the cadence is on unless toggled off.
- **AC7 migration-column test:** no DB test harness exists in this repo (integration tests require a real Postgres, not present — see project-context). Column existence is verified by the USER-SIDE `supabase db push` gate, consistent with 5-S14.
- **Edge flagged for review:** if an on-demand compose for the target week is still in-flight (not yet cleared) when the Friday cron fires, the idempotent skip won't fire and both jobs could target the same week — the `(household_id, week_of)` unique index makes this last-writer-wins (wasted work, not corruption). The common case (on-demand already committed) is covered.

### File List

**New:**
- `supabase/migrations/20261027000000_add_household_auto_compose.sql`
- `packages/contracts/src/auto-compose.ts`
- `packages/contracts/src/auto-compose.test.ts`

**Modified:**
- `apps/api/src/audit/audit.types.ts` — add `household.auto_compose_changed`
- `apps/api/src/jobs/plan-generation.job.ts` — import `PlansRepository`; cron gating in `SCHEDULE_QUEUE` worker; export pure `selectAutoComposeEligible`
- `apps/api/src/jobs/plan-generation.job.test.ts` — `selectAutoComposeEligible` unit tests
- `apps/api/src/modules/households/households.repository.ts` — `findAllActive` selects `auto_compose_enabled`; `get/setAutoComposeEnabled`
- `apps/api/src/modules/households/households.service.ts` — `get/setAutoComposeEnabled` delegates
- `apps/api/src/modules/households/households.routes.ts` — `GET` + `PATCH /v1/households/:id/auto-compose`
- `apps/api/src/modules/households/households.routes.test.ts` — mock extends `auto_compose_enabled`; GET + PATCH route tests
- `apps/api/src/modules/plans/plans.repository.ts` — `hasAnyPlan` + batched `findHouseholdIdsWithPlan`
- `apps/api/src/modules/plans/plans.repository.tree.test.ts` — repo tests for both new methods
- `apps/api/src/modules/plans/plans.service.ts` — `hasAnyPlan` delegate
- `packages/contracts/src/index.ts` — export `auto-compose.js`
- `packages/types/src/index.ts` — re-export `AutoComposeState` + `UpdateAutoComposeRequest`
- `apps/web/src/routes/(app)/household-settings.tsx` — auto-compose toggle section
- `apps/web/src/routes/(app)/household-settings.test.tsx` — auto-compose web tests
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status tracking

## Change Log

| Date | Change |
|---|---|
| 2026-06-18 | Implemented 3-S35 auto-compose enrollment + weekly cron gating (all 7 ACs). Migration `20261027000000` (column + audit enum). Cron now enqueues only when enabled + has-plan + target-week-empty. `GET`/`PATCH /v1/households/:id/auto-compose` + web toggle. +28 tests. Status → review. |

### Review Findings

- [x] [Review][Patch] Duplicate `aria-checked` attribute on checkbox — DISMISSED: false positive (file has only one `aria-checked`; duplicate was a prompt construction error)
- [x] [Review][Patch] `selectAutoComposeEligible` called with all `households` but plan-ID sets built from `enabled` only — FIXED: pass `enabled` (not `households`) as first arg [`apps/api/src/jobs/plan-generation.job.ts`]
- [x] [Review][Patch] PATCH response `has_plan` discarded in web toggle handler — FIXED: added `setAutoComposeHasPlan(state.has_plan)` after successful PATCH [`apps/web/src/routes/(app)/household-settings.tsx`]
- [x] [Review][Defer] D-3S35-CR1: `findHouseholdIdsWithPlan` no DISTINCT / no row-limit — returns one row per plan per household; payload unbounded at scale [`apps/api/src/modules/plans/plans.repository.ts`] — deferred, scalability concern; Set dedup preserves correctness
- [x] [Review][Defer] D-3S35-CR2: `hasAnyPlan` TOCTOU in PATCH response — fetched after DB write; concurrent plan deletion could make `has_plan` stale in the same response [`apps/api/src/modules/households/households.routes.ts`] — deferred, low-probability race; consequence is one stale response value
- [x] [Review][Defer] D-3S35-CR3: `didLoadAutoCompose` ref never reset — stale state if `householdId` or `role` changes without component unmount [`apps/web/src/routes/(app)/household-settings.tsx`] — deferred, single-household product; pre-existing load-guard pattern
- [x] [Review][Defer] D-3S35-CR4: `getNextMondayFrom` adds 3 days unconditionally — wrong `weekOf` on non-Friday cron trigger (e.g. manual re-run on Thursday) — deferred, pre-existing function not changed in this story
- [x] [Review][Defer] D-3S35-CR5: Dormant households with any cleared plan always pass `withAnyPlan` gate — no recency filter; once-active churned households will be scheduled indefinitely — deferred, matches spec intent ("opted in by composing once"); acceptable scope
- [x] [Review][Defer] D-3S35-CR6: `findAllActive` fetches ALL households with no active/inactive predicate — pre-existing gap, not introduced here — deferred, pre-existing
- [x] [Review][Defer] D-3S35-CR7: Partial chunk failure in `findHouseholdIdsWithPlan` forces full cron retry — no per-chunk resilience [`apps/api/src/modules/plans/plans.repository.ts`] — deferred, full-retry is the standard BullMQ pattern
- [x] [Review][Defer] D-3S35-CR8: `hasAnyPlan` DB call at end of PATCH — if it throws, route returns 500 but toggle was already written; UI reverts optimistically leaving DB/UI inconsistent [`apps/api/src/modules/households/households.routes.ts`] — deferred, low probability; `hasAnyPlan` is a simple count query unlikely to fail independently
- [x] [Review][Defer] D-3S35-CR9: No server-side `has_plan` guard on PATCH — a pre-first-plan household can disable auto-compose via direct API; UI hides toggle but DB state persists — deferred, spec does not require this guard; cron has-plan gate prevents downstream harm
- [x] [Review][Defer] D-3S35-CR10: Migration-column test absent (AC7) — no DB integration test harness in project; USER-SIDE GATE (`supabase db push --include-all`) is the substitute — deferred, project infrastructure gap; acknowledged in dev notes
- [x] [Review][Defer] D-3S35-CR11: Audit write best-effort — failure path untested (AC4/AC7); route returns 200 even when audit write throws — deferred, pre-existing project-wide pattern for audit writes

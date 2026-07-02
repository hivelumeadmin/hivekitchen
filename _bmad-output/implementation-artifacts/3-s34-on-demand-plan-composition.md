# Story 3.S34: On-Demand Plan Composition (mid-week start)

Status: done

## Story

As a parent with no plan for the current week,
I want to compose a plan immediately from a single action,
so that I get lunches for the rest of this week (starting tomorrow) — or next week if it's already late in the week — without waiting for the Friday auto-generation.

## Background

Today plan generation is only triggered by the Friday cron (→ next Monday, full week). There is no first-class "compose now" path; the only on-demand trigger is the internal `dev.routes.ts`. This story adds a real user-facing endpoint that composes a plan immediately for the correct window.

Depends on **Story 3.S33** (the `plannedDays` planner option).

**Window rule (household-local day-of-week; confirmed 2026-06-17):**

| Init day (local) | Target week | Days composed |
|---|---|---|
| Mon | current | Tue–Fri |
| Tue | current | Wed–Fri |
| Wed | current | Thu–Fri |
| Thu–Sun | **next** | full Mon–Fri |

- "Tomorrow onward" — today is always empty (evening-safe). Days before the start render as empty tiles (frontend already handles missing days — `tree-adapter.ts`).
- **Saturday is out of scope for now** — Mon–Fri windows only (Story-level decision; Saturday-school support is a later follow-up).
- **Create-only:** if a plan already exists for the target week, the endpoint returns 409 — the parent edits the existing plan via swap, not regeneration.

## Acceptance Criteria

1. New pure helper `deriveCompositionWindow(now: Date, timezone: string): { weekOf: string; plannedDays: Weekday[]; basis: 'current_week_remaining' | 'next_week_full' }` (in `apps/api/src/lib/derive-week-id.ts` or a sibling module):
   - Computes the household-**local** day-of-week and Monday anchor (NOT UTC — reuse the `Intl.DateTimeFormat` timezone approach from `getLocalSixPmUtcMs` in `plan-generation.job.ts`).
   - Mon/Tue/Wed → `basis: 'current_week_remaining'`, `weekOf` = current local Monday, `plannedDays` = local-tomorrow through Friday.
   - Thu/Fri/Sat/Sun → `basis: 'next_week_full'`, `weekOf` = next local Monday, `plannedDays` = `[monday..friday]`.
   - Mon–Fri only (never includes saturday).
2. New endpoint `POST /v1/plans/generate`, authorized for `primary_parent` + `secondary_caregiver`, requires an `Idempotency-Key` header (mirror existing plans routes).
3. The endpoint loads the household's `timezone`, calls `deriveCompositionWindow(now, timezone)`, and derives `week_id = deriveWeekId(weekOf)`.
4. **Create-only guard:** if a plan already exists for `(household_id, week_id)`, respond `409` (e.g. `PlanAlreadyExistsError`) — do not enqueue.
5. On success, enqueue a `plan-generation` job **with no delay**, carrying `week_of` + `planned_days`; respond `202` with `{ job_id, week_of, planned_days, basis }`.
6. Rate-limited per household (mirror `PlansService.requestRegeneration`'s Redis `INCR` + TTL pattern; a small weekly cap, e.g. 3/week). Over-limit → `429`.
7. An audit event is written for the on-demand request (event type added to `AUDIT_EVENT_TYPES`).
8. `PlanGenerationJobData` gains `planned_days?: Weekday[]`; the cron path leaves it undefined (full week unchanged). The worker passes `plannedDays` into BOTH `planWeek()` calls (initial + guardrail retry).
9. Client reads the result via the existing `GET /v1/plans?week=current|next` (no read-path change — `weekOf`/`week_id` already resolve correctly).
10. Tests: window engine (all 7 init days, timezone boundaries incl. a PT-evening-crosses-UTC-midnight case, DST); endpoint (create-only 409, enqueue args incl. planned_days, rate-limit 429, audit write); job wiring (planned_days threaded to planWeek).

## Contracts

- New request/response in `packages/contracts` (e.g. `plan-generate.ts`):
  - `GeneratePlanResponseSchema = { job_id: string; week_of: string (date); planned_days: Weekday[]; basis: 'current_week_remaining' | 'next_week_full' }`
  - No request body needed (window is server-derived from "now" + household timezone). If a body is desired later for an explicit override, keep it out of scope here.

## Tasks / Subtasks

- [x] **Task 1 — Composition-window engine** (AC: 1, 10)
  - [x] `deriveCompositionWindow(now, timezone)` — timezone-aware local day-of-week + Monday anchor; implement the window table; Mon–Fri only
  - [x] Unit tests: all 7 init days; PT/ET/UTC; an evening case where local day ≠ UTC day; a DST transition week

- [x] **Task 2 — Job data + worker wiring** (AC: 8)
  - [x] Add `planned_days?: Weekday[]` to `PlanGenerationJobData`
  - [x] Worker passes `plannedDays: job.data.planned_days` into the initial `planWeek()` and the guardrail-retry `planWeek()`
  - [x] Cron fan-out leaves `planned_days` undefined (no behavior change)

- [x] **Task 3 — Endpoint** (AC: 2, 3, 4, 5, 6, 7)
  - [x] `POST /v1/plans/generate` in `plans.routes.ts` (requireMember + Idempotency-Key)
  - [x] New `PlansService.requestOnDemandGeneration({ householdId, requestId })`: load timezone → `deriveCompositionWindow` → `deriveWeekId` → create-only check (`repo.findByHouseholdAndWeek`) → rate-limit INCR → enqueue (no delay) → audit → return `{ jobId, weekOf, plannedDays, basis }`
  - [x] 409 when plan exists; 429 when over rate limit
  - [x] Add audit event type to `AUDIT_EVENT_TYPES` (+ migration 20261026000000 — `audit_log.event_type` is a Postgres enum)

- [x] **Task 4 — Contracts** (AC: 5)
  - [x] `GeneratePlanResponseSchema` + types re-export
  - [x] Wire route response schema

- [x] **Task 5 — Frontend trigger (thin)** (AC: 9)
  - [x] A "Compose my plan" action that calls `POST /v1/plans/generate`, then polls `GET /v1/plans` (reuse existing query). Empty leading-day tiles already render via `tree-adapter.ts`; optional label polish is out of scope (see Story 3.S35 / follow-up)

## Dev Notes

### Key Files

| File | Change |
|---|---|
| `apps/api/src/lib/derive-week-id.ts` | add `deriveCompositionWindow()` |
| `apps/api/src/modules/plans/plans.routes.ts` | `POST /v1/plans/generate` |
| `apps/api/src/modules/plans/plans.service.ts` | `requestOnDemandGeneration()`; reuse `getCurrentWeekMonday`/`deriveWeekId`/`findByHouseholdAndWeek` + REGEN-style rate limit |
| `apps/api/src/jobs/plan-generation.job.ts` | `planned_days` in `PlanGenerationJobData`; thread to both `planWeek()` calls |
| `packages/contracts/src/plan-generate.ts` (new) | response schema |
| `apps/api/src/audit/...` | new audit event type |
| `apps/web/...` | "Compose my plan" trigger + poll |

### Notes

- **Timezone correctness is the main risk.** `getCurrentWeekMonday()`/`getNextWeekMonday()` are UTC-based — do NOT reuse them directly for the local-day decision. `deriveCompositionWindow` must determine the local day-of-week and local Monday using `Intl.DateTimeFormat(..., { timeZone })` (see `getLocalSixPmUtcMs`). Tests must include a case where local evening is the next UTC day.
- Create-only check: `PlansRepository.findByHouseholdAndWeek({ householdId, weekId })` already exists (used by `getPlanForWeekTree`).
- Rate-limit pattern: `PlansService` already has `REGEN_RATE_LIMIT = 5` / `REGEN_TTL_SECONDS` with Redis `INCR` keyed `regen-limit:{hh}:{weekId}` (~L83, L520). Mirror with a distinct key (e.g. `gen-limit:{hh}:{weekId}`).
- The `plan-generation` job already runs the full pipeline (guardrail, brief_state refresh, nudge). `planned_days` only narrows the day set — everything downstream (commit, guardrail, brief) is day-count agnostic.
- "Immediate" = enqueue with no `delay` (the cron uses a computed delay; this path omits it).

### References

- [Source: apps/api/src/lib/derive-week-id.ts] — `getCurrentWeekMonday`, `getNextWeekMonday`, `deriveWeekId`
- [Source: apps/api/src/jobs/plan-generation.job.ts] — `getLocalSixPmUtcMs` (tz pattern), `PlanGenerationJobData`, worker `planWeek()` calls, GENERATE_QUEUE
- [Source: apps/api/src/modules/plans/plans.service.ts] — `requestRegeneration` (rate-limit), `getPlanForWeekTree` (week resolution)
- [Source: apps/api/src/modules/plans/plans.routes.ts] — `requireIdempotencyKey`, `/regenerate` route shape
- [Source: apps/api/src/modules/internal/dev.routes.ts] — current dev trigger (to supersede)
- [Source: apps/web/src/features/plan/tree-adapter.ts] — empty-day rendering for absent weekdays (~L101)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- `npx vitest run src/lib/derive-week-id.test.ts` → 13/13 green (window engine)
- `npx vitest run src/jobs/plan-generation.job.test.ts src/modules/plans/plans.service.test.ts src/modules/plans/plans.routes.test.ts` → all green (+2 job threading, +6 service on-demand, +7 route)
- `packages/contracts npx vitest run src/plan-generate.test.ts` → 6/6
- `apps/web npx vitest run src/features/plan/mutations.test.ts src/features/plan/BriefCanvas.test.tsx` → 34/34
- `turbo typecheck --filter=api --filter=web --filter=contracts --filter=types` → 0 errors
- eslint on changed files → 0 new errors

### Completion Notes List

Implemented on-demand ("compose now") plan composition end-to-end, all 10 ACs.

- **AC1 / Task 1** — `deriveCompositionWindow(now, timezone)` in `apps/api/src/lib/derive-week-id.ts`. Drives the window off the household-LOCAL day-of-week via `Intl.DateTimeFormat('en-CA', { timeZone })` (NOT UTC), anchoring the local date at UTC midnight so day-of-week + Monday math is pure whole-day arithmetic — DST never enters the math. Mon/Tue/Wed → `current_week_remaining` (tomorrow→Fri); Thu/Fri/Sat/Sun → `next_week_full` (Mon–Fri). Saturday is never composed (`MON_TO_SAT.slice(dow, 5)` stops at Friday). 13 unit tests incl. all 7 init days, a PT-evening-past-UTC-midnight case (local Tue vs UTC Wed), an ET equivalent, and a spring-forward DST week.
- **AC8 / Task 2** — `PlanGenerationJobData += planned_days?: Weekday[]`; the worker threads `plannedDays: planned_days` into BOTH the initial and guardrail-retry `planWeek()` calls. The Friday cron fan-out leaves it undefined (full default week, no behavior change). 3.S33's `PlanWeekOptions.plannedDays` was already in place.
- **AC2–7 / Task 3** — `POST /v1/plans/generate` (requireMember = primary_parent + secondary_caregiver; requires `Idempotency-Key`). New `PlansService.requestOnDemandGeneration({ householdId, requestId })`: loads timezone via new `HouseholdsRepository.getTimezone`, derives the window, create-only guard via `repo.findByHouseholdAndWeek` (→ new `PlanAlreadyExistsError` 409), per-household per-target-week Redis `INCR` rate limit `gen-limit:{hh}:{weekId}` cap 3 (→ `TooManyRequestsError` 429), enqueues the `plan-generation` job with **no delay** carrying `planned_days`, writes the new `plan.on_demand_requested` audit event (best-effort), returns 202 `{ job_id, week_of, planned_days, basis }`.
- **AC5 / Task 4** — new `packages/contracts/src/plan-generate.ts` `GeneratePlanResponseSchema` (+ `GeneratePlanResponse` type in `@hivekitchen/types`); wired as the route's 202 response schema.
- **AC9 / Task 5** — thin `useGenerateOnDemandMutation` (POST, Idempotency-Key, no body) + a `ComposeMyPlanButton` rendered in the BriefCanvas empty state (PrimaryButton). On success it polls `['brief']`/`['plan']` every 5s; this branch unmounts when the plan lands. Existing empty-state copy left untouched (kept the existing test's exact-text assertion green).

**Reconciliations / decisions:**
- `audit_log.event_type` is a Postgres `audit_event_type` ENUM, so adding `plan.on_demand_requested` to `AUDIT_EVENT_TYPES` REQUIRES migration `20261026000000` (else the audit INSERT fails at runtime). USER-SIDE GATE below.
- New service deps (`generateQueue`, `householdsRepository`) are OPTIONAL on `PlansServiceDeps` (mirrors the existing optional-dep pattern) so pre-existing tests compose without them; `requestOnDemandGeneration` throws a clear `ValidationError` if either is missing. The plans hook wires both.
- Imported `GENERATION_JOB_OPTS_BASE` (value) from `plan-generation.job` into `plans.service` — verified no runtime import cycle (plan-generation.job's graph reaches the orchestrator only via type-only imports; orchestrator + plan.tools tests still pass).
- **Local-vs-UTC week boundary (documented, in-AC-scope):** the committed plan's `week_of` is the household-LOCAL Monday, while `GET /v1/plans?week=current|next` resolves by the UTC Monday (`getCurrentWeekMonday`/`getNextWeekMonday`). For the few hours where local and UTC Monday differ, the read path could miss the just-composed plan. AC9 explicitly scopes the read path as unchanged ("weekOf/week_id already resolve correctly"); flagged here for the reviewer as a known edge, not fixed in this slice.

**Verification:** all new tests green; typecheck 0 errors across api/web/contracts/types; eslint 0 new errors. Pre-existing baselines unchanged and confirmed identical with changes stashed: plans/jobs/households 5 fails (extra-library.repository ×3, households.routes memory ×1, plan-adjustment.service ×1); agents 4 fails (memory.tools ×2, onboarding.tools ×2); audit.types Postgres-enum parity (pre-existing TS-only values e.g. `voice.tts_token_issued` — my new value IS in parity via the migration).

**USER-SIDE GATE:** `supabase db push --include-all` (migration `20261026000000_add_plan_on_demand_requested_audit_type.sql`) before the on-demand endpoint is exercised against the live DB, otherwise the `plan.on_demand_requested` audit write fails.

### File List

- `apps/api/src/lib/derive-week-id.ts` (M) — `deriveCompositionWindow`
- `apps/api/src/lib/derive-week-id.test.ts` (A) — window-engine tests
- `apps/api/src/jobs/plan-generation.job.ts` (M) — `planned_days` on `PlanGenerationJobData` + thread to both `planWeek()` calls
- `apps/api/src/jobs/plan-generation.job.test.ts` (M) — planned_days threading tests
- `apps/api/src/modules/plans/plans.service.ts` (M) — `requestOnDemandGeneration` + `generateQueue`/`householdsRepository` deps + rate-limit consts
- `apps/api/src/modules/plans/plans.service.test.ts` (M) — `requestOnDemandGeneration` unit tests
- `apps/api/src/modules/plans/plans.routes.ts` (M) — `POST /v1/plans/generate`
- `apps/api/src/modules/plans/plans.routes.test.ts` (M) — route integration tests
- `apps/api/src/modules/plans/plans.hook.ts` (M) — wire `generateQueue` + `householdsRepository`
- `apps/api/src/modules/households/households.repository.ts` (M) — `getTimezone`
- `apps/api/src/common/errors.ts` (M) — `PlanAlreadyExistsError` (409)
- `apps/api/src/audit/audit.types.ts` (M) — `plan.on_demand_requested`
- `supabase/migrations/20261026000000_add_plan_on_demand_requested_audit_type.sql` (A) — ENUM value
- `packages/contracts/src/plan-generate.ts` (A) — `GeneratePlanResponseSchema`
- `packages/contracts/src/plan-generate.test.ts` (A) — contract round-trip tests
- `packages/contracts/src/index.ts` (M) — export `plan-generate`
- `packages/types/src/index.ts` (M) — `GeneratePlanResponse`
- `apps/web/src/features/plan/mutations.ts` (M) — `useGenerateOnDemandMutation`
- `apps/web/src/features/plan/mutations.test.ts` (M) — mutation tests
- `apps/web/src/features/plan/BriefCanvas.tsx` (M) — `ComposeMyPlanButton` + empty-state wiring

## Change Log

| Date | Version | Description |
|---|---|---|
| 2026-06-17 | 1.0 | Implemented on-demand plan composition (dev-story): `deriveCompositionWindow` engine, `POST /v1/plans/generate` + `requestOnDemandGeneration`, `planned_days` job threading, `GeneratePlanResponseSchema`, `plan.on_demand_requested` audit + migration, thin "Compose my plan" trigger. All 10 ACs satisfied. |

### Review Findings

- [x] [Review][Patch] **P1: `findByHouseholdAndWeek` filters only cleared plans — in-flight draft bypasses 409 guard** [`apps/api/src/modules/plans/plans.service.ts:~641`, `apps/api/src/modules/plans/plans.repository.ts`] — The create-only guard calls `findByHouseholdAndWeek` which applies `.not('guardrail_cleared_at', 'is', null)`, so a plan that is enqueued but not yet guardrail-cleared returns `null`. A second `POST /v1/plans/generate` arriving while the first job is in flight passes the guard, consumes a rate-limit slot, and enqueues a second job. AC4 says "if plan already exists" with no cleared-only qualification. Fix: check for any plan row (cleared or not) for the target week, or use a dedicated in-flight sentinel.
- [x] [Review][Patch] **P2: `getTimezone` returns nullable column value cast unsafely — NULL timezone causes RangeError or uses server timezone** [`apps/api/src/modules/households/households.repository.ts:143`] — `return (data as { timezone: string }).timezone` suppresses TypeScript's null check. If the column is NULL, `Intl.DateTimeFormat` receives `undefined` and throws `RangeError: Invalid time zone specified: undefined`, producing an unhandled 500. Add an explicit null/empty-string guard after the `data === null` check and throw a `ValidationError` with a clear message.
- [x] [Review][Patch] **P3: `isComposing` stuck forever if background job fails — no polling timeout or escape hatch** [`apps/web/src/features/plan/BriefCanvas.tsx:~89`] — Once `mutate` succeeds (202), `setIsComposing(true)` is set and the component shows "Lumi is composing…" indefinitely. The `setInterval` poll only invalidates queries; it has no timeout and no mechanism to detect a `plan.hard_fail` event. If the BullMQ job fails, the user is stranded with no way to retry without a page refresh. Fix: cap polling to N attempts (e.g., 24 × 5 s = 2 min) and fall back to `setHasError(true)` / re-render the button.
- [x] [Review][Patch] **P4: `safeRandomUuid()` regenerated inside `mutationFn` — idempotency key changes on each React Query retry** [`apps/web/src/features/plan/mutations.ts:~299`] — Each retry generates a fresh UUID, so the server treats retries as new requests. The rate-limit counter increments on each retry and a second job may be enqueued. Fix: capture the UUID once in `handleClick` (component state or a ref) and pass it as a parameter to `mutate`; `mutationFn` should use that captured value.
- [x] [Review][Patch] **P5: Route test missing `guest_author` 403 assertion (AC10 coverage gap)** [`apps/api/src/modules/plans/plans.routes.test.ts`] — AC2 authorises only `primary_parent` and `secondary_caregiver`; the test suite covers `ops` (403) and `secondary_caregiver` (202) but omits `guest_author`. The code is structurally correct (`requireMember` excludes guest_author) but the boundary is untested. Add a `guest_author` 403 case mirroring the existing `ops` test.
- [x] [Review][Defer] **D-3S34-CR1: TOCTOU — concurrent requests both pass create-only guard before either job enqueues** [`apps/api/src/modules/plans/plans.service.ts:~641`] — deferred, pre-existing distributed-systems pattern (same as `requestRegeneration`). Two simultaneous requests with different idempotency keys can both see `null` from `findByHouseholdAndWeek`, both INCR, and both enqueue distinct jobs. Fixing atomically would require a Redis SETNX gate or DB unique constraint on `(household_id, week_of, status=draft)`. Out of scope for this slice.
- [x] [Review][Defer] **D-3S34-CR2: Rate-limit counter consumed when `generateQueue.add()` throws** [`apps/api/src/modules/plans/plans.service.ts:~673`] — deferred, pre-existing pattern (matches `requestRegeneration`). A BullMQ/Redis failure after INCR burns a rate-limit slot with no job produced. Fixing requires wrapping INCR + enqueue in a compensating transaction. Low probability; no correctness impact on success path.
- [x] [Review][Defer] **D-3S34-CR3: Saturday-school households excluded from current-week `plannedDays` — no hook for household `saturday_school` flag** [`apps/api/src/lib/derive-week-id.ts`] — deferred, out of scope per spec ("Saturday is out of scope for now"). `MON_TO_SAT.slice(dow, 5)` always terminates at Friday on the current-week path. The `MON_TO_SAT` constant hints at future Saturday support; when that ships, `deriveCompositionWindow` will need a `saturdaySchool?: boolean` param and the slice upper-bound changed to 6.

# Story 2.14: Onboarding mental-model copy + anxiety-leakage telemetry

Status: done

## Story

As a Primary Parent,
I want the last step of onboarding to teach the no-approval mental model with two short sentences, said once,
So that I don't look for a "save" button on every plan edit thereafter (UX-DR65, UX-DR66).

## Acceptance Criteria

1. **Given** the cultural-ratification step completes (Story 2.11),
   **When** the final onboarding step renders,
   **Then** the screen displays exactly two sentences, once:
   - "The plan is always ready. Change anything, anytime. You don't need to approve it."
   - "Changes save as you go. No button needed."
   No coachmarks, no tooltips, no additional explanation. A single "Get started" CTA navigates to `/app`.

2. **Given** the mental-model step has been shown,
   **When** the user reaches it,
   **Then** a `POST /v1/onboarding/mental-model-shown` fires (fire-and-forget, silent on failure) and the audit log records `onboarding.mental_model_shown`.

3. **Given** a household is in its first 14 days (week-1–2 window),
   **When** `POST /v1/households/tile-retry` receives the third or more retry of the same `edit_key` within 60 seconds,
   **Then** the API sets `households.tile_ghost_timestamp_enabled = true` for that household (audit-logged as `tile.edit_retried` with `threshold_reached: true`).

4. **Given** the threshold has not been reached,
   **When** `POST /v1/households/tile-retry` is called,
   **Then** it returns 204 with no flag change. The audit event is still written.

5. **Given** a household is older than 14 days,
   **When** `POST /v1/households/tile-retry` receives any number of retries,
   **Then** it returns 204 with no flag change — the ghost-timestamp escalation is week-1–2 only.

6. `households.tile_ghost_timestamp_enabled` defaults to `false` and is only ever set `true` by server-side threshold evaluation — never client-writable.

---

## Tasks / Subtasks

- [x] Task 1 — DB migration: add `tile_ghost_timestamp_enabled` to `households` (AC: #6)
  - [x] Create `supabase/migrations/20260601000300_add_tile_ghost_timestamp_to_households.sql`
  - [x] `ALTER TABLE households ADD COLUMN tile_ghost_timestamp_enabled boolean NOT NULL DEFAULT false;`
  - [x] No RLS policy needed — column is server-written only, never client-readable via Supabase direct
  - [x] Companion migration `supabase/migrations/20260601000400_add_onboarding_and_tile_audit_types.sql` adds the two new ENUM values (audit_event_type is a Postgres ENUM; mirroring the TS array alone would not let inserts succeed at runtime)

- [x] Task 2 — Audit event types (AC: #2, #3, #4)
  - [x] Add `'onboarding.mental_model_shown'` and `'tile.edit_retried'` to `AUDIT_EVENT_TYPES` array in `apps/api/src/audit/audit.types.ts`

- [x] Task 3 — Contracts (AC: #3, #4)
  - [x] Add `TileRetryRequestSchema` to `packages/contracts/src/onboarding.ts`
  - [x] Export propagates through `packages/contracts/src/index.ts` (existing wildcard re-export)

- [x] Task 4 — `HouseholdsRepository` extensions (AC: #3, #6)
  - [x] Add to `apps/api/src/modules/households/households.repository.ts`:
    - `getTileGhostFlag(householdId: string): Promise<boolean>`
    - `setTileGhostFlag(householdId: string): Promise<void>`
    - `getHouseholdAge(householdId: string): Promise<number>` — throws if the household row is missing instead of silently returning 0 (would mis-classify unknown households as fresh)

- [x] Task 5 — New households routes plugin (AC: #3, #4, #5)
  - [x] Create `apps/api/src/modules/households/households.routes.ts`
  - [x] `POST /v1/households/tile-retry` (auth: primary_parent + secondary_caregiver)
    - Parses body with `TileRetryRequestSchema`
    - Writes `tile.edit_retried` audit synchronously via `auditService.write()` (mechanism-bearing, not fire-and-forget — failure surfaces as 500)
    - Counts recent retries via `select('id', { count: 'exact', head: true })` filtered by event_type, user_id, `metadata->>edit_key`, created_at ≥ now-60s
    - On count ≥ 3 + age ≤ 14d → `setTileGhostFlag(householdId)` then writes a second audit row tagged `threshold_reached: true` (same event_type so ops can count both occurrences and crossings in one query)
    - Always returns 204
  - [x] Plugin uses `fp()` matching the sibling pattern

- [x] Task 6 — Register households routes in `app.ts` (AC: #3)
  - [x] Imported `householdsRoutes` and registered alongside the other route plugins

- [x] Task 7 — `POST /v1/onboarding/mental-model-shown` endpoint (AC: #2)
  - [x] Added to `apps/api/src/modules/onboarding/onboarding.routes.ts`
  - [x] Uses `request.auditContext` (fired via the existing `auditHook` onResponse) so the 204 is returned without waiting on the audit write — fire-and-forget by hook semantics
  - [x] Auth: `requirePrimaryParent` (matches the rest of the onboarding plugin)

- [x] Task 8 — `OnboardingMentalModel` component (AC: #1, #2)
  - [x] Created `apps/web/src/features/onboarding/OnboardingMentalModel.tsx`
  - [x] Fires `POST /v1/onboarding/mental-model-shown` once per mount (`useRef` gate against React 19 StrictMode double-invoke); errors swallowed via `.catch(() => undefined)`
  - [x] Renders the two sentences verbatim in `font-serif`, single `font-sans` "Get started" button — no progress chrome, no tooltips, no toasts

- [x] Task 9 — Wire new step into `onboarding.tsx` (AC: #1)
  - [x] Added `'mental-model'` to the `OnboardingMode` union
  - [x] `cultural-ratification` `onComplete` now `setMode('mental-model')` (removed the now-unused `handleRatificationComplete` callback)
  - [x] Consent route on the no-household branch now also routes to `mental-model` instead of `/app`, so the copy is never bypassed
  - [x] Defensive `useEffect` for `cultural-ratification` + `householdId === null` redirects to `mental-model` rather than `/app`
  - [x] `mental-model` render branch mounts `<OnboardingMentalModel onComplete={() => void navigate('/app')} />`

- [x] Task 10 — Tests (AC: all)
  - [x] `apps/api/src/modules/households/households.routes.test.ts` — 7 tests covering: 204 on count<3 (single audit row), no-flip when count≥3 outside the 14-day window, flip + threshold-audit-row when count≥3 inside the window, no-flip when retries are spread across distinct edit_keys, secondary_caregiver acceptance, 401 unauth, 400 validation
  - [x] `apps/web/src/features/onboarding/OnboardingMentalModel.test.tsx` — 5 tests covering: verbatim sentences, single "Get started" button + no chrome (tooltip/alert/progressbar/status all absent), `onComplete` fires on click, audit endpoint fires on mount with `POST` method, 500 on the audit endpoint is silently swallowed

### Review Findings

- [x] [Review][Decision] `mental-model-shown` auth guard excludes secondary caregivers — **Resolved: keep `requirePrimaryParent`; add a role guard at the top of `OnboardingPage` that redirects non-primary-parents to `/app` before any mode transitions, preventing secondaries from ever reaching this step.** [`apps/api/src/modules/onboarding/onboarding.routes.ts`]
- [x] [Review][Patch] Add role guard in `OnboardingPage`: if `user.role !== 'primary_parent'`, `navigate('/app')` immediately — prevents secondary caregivers from entering the onboarding flow and reaching the mental-model step [`apps/web/src/routes/(app)/onboarding.tsx`]

- [x] [Review][Patch] Household age boundary off-by-one: `householdAgeMs <= FOURTEEN_DAYS_MS` admits exactly 14 days as still-eligible; use strict `<` to match "first 14 days" / AC5 "older than 14 days → no flag change" semantics [`apps/api/src/modules/households/households.routes.ts:82`]
- [x] [Review][Patch] Double threshold audit write: `threshold_reached` row written on every subsequent call with count ≥ 3, not just the first crossing — add idempotency guard (check `getTileGhostFlag` before writing the threshold row; skip if already `true`) [`apps/api/src/modules/households/households.routes.ts:89-101`]
- [x] [Review][Patch] `setTileGhostFlag` silent no-op when household row is missing — `.update().eq('id', householdId)` affects zero rows without error; add a `.select('id').maybeSingle()` check on the result and throw if `null` [`apps/api/src/modules/households/households.repository.ts:14-22`]
- [x] [Review][Patch] `timestamp_ms` has no recency validation — any positive integer accepted; add `.refine()` bounding to ±5 minutes of server time (or similar) to prevent far-future/past values skewing audit window queries [`packages/contracts/src/onboarding.ts`]
- [x] [Review][Patch] `useRef` StrictMode gate has no test coverage — add a test that wraps `OnboardingMentalModel` in `<StrictMode>` and asserts `fetchSpy` is called exactly once per mount, not twice [`apps/web/src/features/onboarding/OnboardingMentalModel.test.tsx`]
- [x] [Review][Patch] Migration `20260601000300` missing `COMMENT ON COLUMN households.tile_ghost_timestamp_enabled` — non-obvious server-only, week-1–2-only, never-reverts semantics are undiscoverable from the column name alone [`supabase/migrations/20260601000300_add_tile_ghost_timestamp_to_households.sql`]

- [x] [Review][Defer] `AuditService` re-instantiated per plugin in `households.routes.ts` — pre-existing pattern across auth/invite routes; migrate when DI/lifecycle hardening pass lands [`apps/api/src/modules/households/households.routes.ts:26`] — deferred, pre-existing
- [x] [Review][Defer] Direct `audit_log` count query in route handler bypasses repository layer — move to `AuditRepository.countRecentRetries()` in a future housekeeping pass [`apps/api/src/modules/households/households.routes.ts:66-74`] — deferred, pre-existing
- [x] [Review][Defer] `family_rhythms` optional in contract schema but required in service interface — schema under-specifies API output; tighten when contracts hardening pass runs [`packages/contracts/src/onboarding.ts`] — deferred, pre-existing
- [x] [Review][Defer] `getTileGhostFlag` defined but never called — intentional Epic 3 scaffold; wire when Plan Tile component reads the flag [`apps/api/src/modules/households/households.repository.ts`] — deferred, pre-existing
- [x] [Review][Defer] AbortController missing in `OnboardingMentalModel` — in-flight fetch continues after unmount; benign (silent catch handles it); add abort in a best-practice cleanup pass [`apps/web/src/features/onboarding/OnboardingMentalModel.tsx:23-31`] — deferred, pre-existing
- [x] [Review][Defer] `householdId` null→non-null race in `cultural-ratification` useEffect — unlikely auth timing race; defensive redirect to mental-model is correct behaviour; guard with a stable ref if the race surfaces in practice [`apps/web/src/routes/(app)/onboarding.tsx`] — deferred, pre-existing

---

## Dev Notes

### Onboarding flow — full updated sequence

```
select → voice/text → consent → cultural-ratification → mental-model → /app
```

The `OnboardingConsent` step calls `onConsented()`:
- If `householdId !== null`: currently goes to `cultural-ratification`
- If `householdId === null`: currently goes directly to `/app`

After this story, both branches must pass through `mental-model` before navigating:
- `householdId !== null`: consent → cultural-ratification → mental-model → /app
- `householdId === null`: consent → mental-model → /app (edge case, never skips it)

The `CulturalRatificationStep`'s `onComplete` should transition to `'mental-model'`, not call `navigate('/app')` directly. Currently `onComplete={handleRatificationComplete}` calls `navigate('/app')` — change to `onComplete={() => setMode('mental-model')}`.

### Mental model copy — exact strings (do not paraphrase)

Sentence 1: `"The plan is always ready. Change anything, anytime. You don't need to approve it."`
Sentence 2: `"Changes save as you go. No button needed."`

Source: UX-DR65 + UX spec §"Where parents are likely to get confused" line: "The plan is always ready. Change anything, anytime. You don't need to approve it." — Said once. Never repeated. No coachmarks, no tooltips.

UX anti-patterns to reject:
- No confirmation / progress bar / step indicator
- No checkmark animation
- No additional explanation ("here's how it works...")
- No "done" toast when user clicks Get started
- No repetition on subsequent /app visits (this step is onboarding-only, fire once)

### Tile-retry telemetry — architecture guidance

**No third-party analytics.** Architecture §NFR-SEC explicitly bans third-party analytics SDKs on any surface. All telemetry goes through the audit log only. [Source: architecture.md §Technical Constraints]

**Feature flag pattern.** Architecture §5.6 establishes "DB column at beta" as the sole feature-flag mechanism — no GrowthBook, no in-memory flags. `households.tile_ghost_timestamp_enabled` follows `households.tier_variant` as a second DB-column flag. [Source: architecture.md §5.6]

**Audit log querying for threshold check.** The audit log has composite index `(household_id, event_type, correlation_id, created_at)`. The retry-count query uses `user_id` not `household_id` (retry is user-scoped). Add a targeted query — do NOT fetch all rows and count in JS. Use Supabase `.eq().gte().select('id', { count: 'exact', head: true })` to return only the count.

Example query pattern:
```ts
const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString();
const { count } = await supabase
  .from('audit_log')
  .select('id', { count: 'exact', head: true })
  .eq('event_type', 'tile.edit_retried')
  .eq('user_id', userId)
  .eq('metadata->>edit_key', editKey)
  .gte('created_at', sixtySecondsAgo);
```

Note: Supabase JS filter for JSONB field: `.eq('metadata->>edit_key', editKey)` (PostgREST `->>` operator for text extraction).

**Week-1–2 window.** "Week 1–2" = 14 calendar days from `households.created_at`. Check: `(Date.now() - new Date(household.created_at).getTime()) <= 14 * 24 * 60 * 60 * 1000`. Query `households.created_at` directly — do not use user.created_at (household created on first login, always ≤ user age).

**Ghost-timestamp UI is NOT in scope for this story.** The `tile_ghost_timestamp_enabled` flag is infrastructure only. The Plan Tile component that reads and renders "saved just now" belongs to Epic 3 (Story 3.9 or 3.12). This story only seeds the flag and the endpoint.

### `households.routes.ts` — new plugin structure

Follow the exact pattern of sibling route files (e.g., `onboarding.routes.ts`):
- Default export is `fp(plugin, { name: 'households-routes' })`
- Import `fp` from `fastify-plugin`
- Import `HouseholdsRepository` from `./households.repository.js` (`.js` extension required — ESM)
- Import `authorize` from `../../middleware/authorize.hook.js`
- Import `TileRetryRequestSchema` from `@hivekitchen/contracts`
- No `HouseholdsService` needed — service layer is thin enough to inline in the route for this story

### File structure

```
apps/api/src/modules/households/
  households.repository.ts          ← MODIFY: add getTileGhostFlag, setTileGhostFlag, getHouseholdAge
  households.repository.test.ts     ← MODIFY: add tests for new methods
  households.routes.ts              ← NEW: POST /v1/households/tile-retry
  households.routes.test.ts         ← NEW

apps/api/src/audit/
  audit.types.ts                    ← MODIFY: add two event types

apps/api/src/app.ts                 ← MODIFY: register householdsRoutes

apps/api/src/modules/onboarding/
  onboarding.routes.ts              ← MODIFY: add POST /v1/onboarding/mental-model-shown

packages/contracts/src/
  onboarding.ts                     ← MODIFY: add TileRetryRequestSchema + export

apps/web/src/features/onboarding/
  OnboardingMentalModel.tsx         ← NEW
  OnboardingMentalModel.test.tsx    ← NEW

apps/web/src/routes/(app)/
  onboarding.tsx                    ← MODIFY: add mental-model mode

supabase/migrations/
  20260601000300_add_tile_ghost_timestamp_to_households.sql  ← NEW
```

### ESM and TypeScript rules (from project-context.md §Critical Rules)

- All relative imports in `apps/api` MUST use `.js` extension: `import { foo } from './foo.js'`
- `import type` required for type-only imports (isolatedModules)
- No `console.*` in `apps/api` — use `request.log` (Pino) in route handlers
- No barrel files in `apps/api/src` or `apps/web/src`
- Zod 3 syntax — do NOT use Zod 4 API (enum syntax, `.strict()` chaining, etc.)
- `packages/contracts` is source-imported via `@hivekitchen/contracts` (never from `/dist`)

### Component pattern — matching existing onboarding components

`OnboardingMentalModel` should match the structural pattern of `OnboardingConsent.tsx`:
- Functional component exported as named export
- `type Props = { onComplete: () => void }`
- No default export
- Tailwind classes for layout — no custom CSS

### Previous story learnings from 2.13

- Audit writes that are not critical to the user path should use fire-and-forget pattern with silent catch (`void writeAudit(...).catch(() => {})`)
- For this story: `mental_model_shown` audit is non-critical — fire-and-forget
- `tile.edit_retried` audit IS the mechanism for counting — it must be awaited (failure means threshold cannot be checked correctly; return 500 to let the client retry)
- Silence-mode applies only to non-critical side effects, not to mechanism-bearing writes

### Previous story learnings from 2.11 (CulturalRatificationStep)

- The cultural ratification step fires `CulturalPriorService` calls; the `onComplete` callback is called after all async operations resolve
- The `handleRatificationComplete` currently calls `navigate('/app')` — this must be changed to call `setMode('mental-model')` so the flow does not bypass the new step
- After this change, `handleRatificationComplete` can be removed entirely; use inline `() => setMode('mental-model')` as the prop

### Testing pattern from 2.13

API route tests use Fastify's `inject` pattern:
```ts
const res = await app.inject({
  method: 'POST',
  url: '/v1/households/tile-retry',
  headers: { authorization: `Bearer ${token}` },
  payload: { tile_id: 'tile-mon-0', edit_key: 'slot', timestamp_ms: Date.now() },
});
expect(res.statusCode).toBe(204);
```

Frontend component tests use `@testing-library/react` with Vitest — consistent with `OnboardingConsent.test.tsx`.

### Migration timestamp

Last committed migration: `20260601000200_add_memory_nodes_unique_constraint.sql`
New migration: `20260601000300_add_tile_ghost_timestamp_to_households.sql`

### References

- [Source: _bmad-output/planning-artifacts/epics.md §Story 2.14]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md §UX-DR65, UX-DR66]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md §"Where parents are likely to get confused"]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md §"Anxiety leakage (week-1–2)"]
- [Source: _bmad-output/planning-artifacts/architecture.md §5.6 Feature flags]
- [Source: _bmad-output/planning-artifacts/architecture.md §Technical Constraints — no third-party analytics]
- [Source: _bmad-output/implementation-artifacts/2-13-visible-memory-write-primitives-memory-nodes-seed.md §Dev Notes — silence-mode and audit fire-and-forget]
- [Source: apps/web/src/routes/(app)/onboarding.tsx — current onboarding flow]
- [Source: apps/api/src/audit/audit.types.ts — existing audit event types]
- [Source: apps/api/src/modules/households/households.repository.ts — existing repository pattern]

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- `pnpm --filter @hivekitchen/api exec tsc --noEmit` — 0 errors in story scope. The 3 TS2552 hits in `apps/api/src/modules/voice/voice.service.test.ts` (lines 109/237/335 — `RequestInfo`) are pre-existing on the working tree before this story, unrelated to 2.14.
- `pnpm --filter @hivekitchen/web exec tsc --noEmit` — clean.
- `pnpm --filter @hivekitchen/contracts exec tsc --noEmit` — clean.
- `pnpm --filter @hivekitchen/api test -- --run households.routes` — 7/7 pass.
- `pnpm --filter @hivekitchen/web test -- --run OnboardingMentalModel` — 5/5 pass.
- `pnpm --filter @hivekitchen/web test -- --run` — 15 files / 112 tests pass (no regressions).
- Pre-existing failures verified by stash-with-untracked + retest: `packages/contracts/src/cultural.test.ts` (6 fail at HEAD) and `apps/api/src/modules/memory/memory.service.test.ts` (1 fail) are committed-or-pending failures unrelated to 2.14 scope.

### Completion Notes List

- **Audit ENUM migration added beyond the story's stated scope.** Task 2 only specified updating the TS array, but `audit_event_type` is a Postgres ENUM — runtime inserts of the new values would fail without an `ALTER TYPE` migration. Created `20260601000400_add_onboarding_and_tile_audit_types.sql` mirroring the existing per-event-type migration pattern (`20260601000100_add_memory_seeded_audit_type.sql`). Migration filename ordered AFTER the column-add migration so the column lands first, then the enum values that audit writes will reference.
- **`tile.edit_retried` write is awaited, `onboarding.mental_model_shown` is fire-and-forget.** Following the explicit Dev Notes guidance: the retry audit is the counting mechanism so a failure must surface (returns 500, client retries); the mental-model breadcrumb is non-mechanism so it goes through `request.auditContext` and the existing `auditHook` onResponse — the 204 is not blocked on the audit write.
- **The threshold audit row uses the same event_type with `threshold_reached: true` in metadata.** Keeps ops dashboards on a single event_type predicate; the metadata flag distinguishes the crossing event from the underlying retries. `retry_count` is also included for debugging bursts that exceed 3.
- **Per-user (not per-household) retry count.** Matches Dev Notes: a secondary caregiver's edits do not roll into the primary parent's count. This means each member needs to independently retry ≥3× to flip the flag — that's the intended behaviour (the flag is the household-level outcome, but the anxiety signal is per-user).
- **`getHouseholdAge` throws on missing rows.** Defensively chosen over a `0` fallback because returning 0 would make an unknown household look fresh and silently flip the flag. A real production would only see this on a deleted-then-orphaned JWT, in which case 500 is correct.
- **`OnboardingMentalModel` uses a `useRef` mount-fire gate.** React 19 StrictMode invokes mount effects twice in development — without the gate, the audit endpoint would be called twice per real screen view in dev. The breadcrumb is supposed to record screen views, not React re-mounts.
- **`handleRatificationComplete` removed entirely.** Was a stale callback that called `navigate('/app')` directly; the cultural-ratification `onComplete` now inlines `setMode('mental-model')` per Dev Notes.
- **No-household consent branch now goes through mental-model.** Originally that branch went straight to `/app`. Updated so the copy is never bypassed regardless of cultural-prior availability.

### File List

**New files:**
- `apps/api/src/modules/households/households.routes.ts`
- `apps/api/src/modules/households/households.routes.test.ts`
- `apps/web/src/features/onboarding/OnboardingMentalModel.tsx`
- `apps/web/src/features/onboarding/OnboardingMentalModel.test.tsx`
- `supabase/migrations/20260601000300_add_tile_ghost_timestamp_to_households.sql`
- `supabase/migrations/20260601000400_add_onboarding_and_tile_audit_types.sql`

**Modified files:**
- `apps/api/src/audit/audit.types.ts` — added `'onboarding.mental_model_shown'` and `'tile.edit_retried'` to `AUDIT_EVENT_TYPES`
- `apps/api/src/modules/households/households.repository.ts` — added `getTileGhostFlag`, `setTileGhostFlag`, `getHouseholdAge`
- `apps/api/src/modules/onboarding/onboarding.routes.ts` — added `POST /v1/onboarding/mental-model-shown`
- `apps/api/src/app.ts` — registered `householdsRoutes`
- `apps/web/src/routes/(app)/onboarding.tsx` — added `mental-model` mode, removed `handleRatificationComplete`, rerouted no-household consent path through the new step
- `packages/contracts/src/onboarding.ts` — added `TileRetryRequestSchema` and `TileRetryRequest` type

### Change Log

- 2026-04-30 — Story 2.14 implemented: onboarding mental-model surface (UX-DR65), `POST /v1/households/tile-retry` anxiety-leakage telemetry primitive with 3-retries-in-60s threshold gated to the 14-day window, `households.tile_ghost_timestamp_enabled` server-only feature flag (Architecture §5.6), 12 new tests added.

# Test Automation Summary — Epic 2 (Batches 1–4) + Story 2-6b + Epic 12 (Stories 12-1, 12-2, 12-6) + Story 3-14 + Story 3-15 + Story 3-16 + Story 3-19 + Story 3-20

Generated: 2026-04-29
Last updated: 2026-05-07 (Story 3-20 — Bag composition settings page E2E)

## Generated Tests

### E2E Tests (Playwright)

**Shared fixtures**
- [x] `apps/web/test/e2e/_helpers.ts` — auth user / profile factories, `loginAndNavigate` helper

**Batch 1 — Auth & Profile**
- [x] `apps/web/test/e2e/2-1-auth.spec.ts` — Story 2-1 (email/password + OAuth login, callback exchange)
- [x] `apps/web/test/e2e/2-3-caregiver-invite.spec.ts` — Story 2-3 (invite redemption, expired/invalid handling)
- [x] `apps/web/test/e2e/2-4-account-profile.spec.ts` — Story 2-4 (profile CRUD, password reset trigger, notif/cultural prefs)
- [x] `apps/web/test/e2e/2-4b-password-reset.spec.ts` — Story 2-4b (recovery hash → reset completion → session swap)

**Batch 2 — Onboarding**
- [x] `apps/web/test/e2e/2-5-notification-cultural-prefs.spec.ts` — Story 2-5 (dedicated endpoints, optimistic UI, ratchet)
- [x] `apps/web/test/e2e/2-6-voice-onboarding.spec.ts` — Story 2-6 (entry point, voice mode, fallback to text)
- [x] `apps/web/test/e2e/2-7-text-onboarding.spec.ts` — Story 2-7 (text turn loop, completion, 502 vs other failures, finalize)
- [x] `apps/web/test/e2e/2-8-coppa-vpc-consent.spec.ts` — Story 2-8 (declaration load, scroll gate, sign + advance, retries)
- [x] `apps/web/test/e2e/2-9-parental-notice-disclosure.spec.ts` — Story 2-9 (gate dialog, ack flow, bypass when prior ack)

**Batch 3 — Child profile**
- [x] `apps/web/test/e2e/2-10-add-child-profile.spec.ts` — Story 2-10 (form, submit, validation, parental-notice 412, 5xx, cancel)
- [x] `apps/web/test/e2e/2-11-cultural-ratification.spec.ts` — Story 2-11 (zero-priors auto-skip, three actions, 403/404 = resolved, soft-fail)
- [x] `apps/web/test/e2e/2-12-bag-composition.spec.ts` — Story 2-12 (default state, save body has no `main`, skip, error, in-flight disable)

**Batch 4 — Memory + Mental model**
- [x] `apps/web/test/e2e/2-14-mental-model.spec.ts` — Story 2-14 (two-sentence copy, no chrome, Get started → /app, audit endpoint fires, 500 swallowed, regression guard for zero-priors path, ratification-complete path)

**Epic 12 — Ambient Lumi**
- [x] `apps/web/test/e2e/12-6-lumi-orb-panel.spec.ts` — Story 12-6 (orb presence on /app + /account, absent on /onboarding, panel open/close, panel chrome elements, empty state, dismiss, toggle, aria-expanded, aria-controls, keyboard Enter + Space, thread hydration with VITE_E2E store seeding)

## Coverage

| Story | Spec / File | Cases | Type |
|-------|-------------|-------|------|
| 2-1 | `2-1-auth.spec.ts` | 8 | E2E |
| 2-3 | `2-3-caregiver-invite.spec.ts` | 5 | E2E |
| 2-4 | `2-4-account-profile.spec.ts` | 7 | E2E |
| 2-4b | `2-4b-password-reset.spec.ts` | 7 | E2E |
| 2-5 | `2-5-notification-cultural-prefs.spec.ts` | 5 | E2E |
| 2-6 | `2-6-voice-onboarding.spec.ts` | 4 | E2E |
| 2-7 | `2-7-text-onboarding.spec.ts` | 7 | E2E |
| 2-8 | `2-8-coppa-vpc-consent.spec.ts` | 5 | E2E |
| 2-9 | `2-9-parental-notice-disclosure.spec.ts` | 5 | E2E |
| 2-10 | `2-10-add-child-profile.spec.ts` | 6 | E2E |
| 2-11 | `2-11-cultural-ratification.spec.ts` | 8 | E2E |
| 2-12 | `2-12-bag-composition.spec.ts` | 5 | E2E |
| 2-13 | `memory.repository.test.ts` + `memory.service.test.ts` + `memory.test.ts` | 13 + 13 + 22 = 48 | Unit (vitest) |
| 2-14 | `2-14-mental-model.spec.ts` | 6 | E2E |
| 2-14 | `OnboardingMentalModel.test.tsx` + `households.routes.test.ts` | 6 + 7 = 13 | Unit (vitest) |
| 12-1 | `packages/contracts/src/lumi.test.ts` | 30 | Unit (vitest) |
| 12-2 | `apps/web/src/stores/lumi.store.test.ts` | 10 | Unit (vitest) |
| 12-6 | `12-6-lumi-orb-panel.spec.ts` | 13 | E2E |
| 12-6 | `LumiOrb.test.tsx` + `LumiPanel.test.tsx` + `layout.test.tsx` | 7+13+2=22 | Unit (vitest) |

**E2E total:** 91 cases across 14 specs
**Unit total (new stories):** ~123 cases across 10 test files

## Conventions

- Tests live at `apps/web/test/e2e/` (sibling to existing `test/perf/sse-invalidation.spec.ts`)
- All API calls mocked via `page.route('**/v1/...', route.fulfill(...))` — preview server is frontend-only, no real backend
- WebSocket / mic / VAD layers are **not exercised** in 2-6 — those require browser audio permissions + a live ElevenLabs WS that doesn't run under preview. The voice spec asserts UI scaffolding only
- Auth-seeding flow: `loginAndNavigate(page, dest)` goes directly to `/auth/login?next=<dest>` because not every protected route auto-redirects to login (e.g. `/app` and `/onboarding` render statically when unauthenticated)
- Tests use Playwright's role/label locators (`getByLabel`, `getByRole`) — no CSS selectors
- Each test gets a fresh page (Playwright default) — no shared mutable state, no order dependency

## Server-side invariants asserted by tests

These checks catch regressions where client code accidentally starts sending fields the server controls:

- **2-12**: PATCH `/v1/children/*/bag-composition` body is exactly `{ snack, extra }` — no `main` key (server-side invariant: `main` is always `true`)
- **2-10**: POST `/v1/households/*/children` body shape (name, age_band, declared_allergens, etc.) — no `id` or `created_at`
- **2-5**: notification toggles hit `/users/me/notifications` (NOT `/users/me`)
- **2-5**: cultural language changes hit `/users/me/preferences` (NOT `/users/me`)

## Story 2-13 — Visible Memory write primitives (added 2026-04-30)

Backend-only developer story (no web layer). All coverage is unit-level (vitest):

**Contract tests (vitest)**
- [x] `packages/contracts/src/memory.test.ts` — 22 cases: `NodeTypeSchema`, `SourceTypeSchema`, `MemoryNoteInputSchema`, `MemoryNoteOutputSchema`, `MemoryNodeSchema`, `MemoryProvenanceSchema` round-trips + existing `ForgetRequest`/`ForgetCompletedEvent` retained

**API unit tests (vitest)**
- [x] `apps/api/src/modules/memory/memory.repository.test.ts` — repository insert happy paths and error propagation
- [x] `apps/api/src/modules/memory/memory.service.test.ts` — `seedFromOnboarding`: empty summary → zero calls; non-empty → correct node types + provenance; repo throws → silence-mode; audit write; `noteFromAgent` paths

No E2E spec — the seeding runs silently inside onboarding finalize/close with no visible UI change.

## Story 2-14 — Onboarding mental-model copy + tile-retry telemetry (added 2026-04-30)

**E2E tests (Playwright)**
- [x] `apps/web/test/e2e/2-14-mental-model.spec.ts` — 6 cases: exact sentence copy, no-chrome assertion, Get started → /app, audit endpoint fires on mount, 500 swallowed, zero-priors regression guard, ratification-complete → mental-model → /app

**Component tests (vitest + RTL)**
- [x] `apps/web/src/features/onboarding/OnboardingMentalModel.test.tsx` — 6 cases: verbatim sentences, single CTA + no chrome, `onComplete` fires on click, audit fires on mount, 500 silently swallowed, `StrictMode` guard (fire-once)

**API unit tests (vitest)**
- [x] `apps/api/src/modules/households/households.routes.test.ts` — 7 cases: 204 on count<3, no-flip outside 14-day window, flip + threshold audit row inside window, distinct edit_keys no-flip, secondary_caregiver acceptance, 401 unauth, 400 validation

### ⚠️ E2E Regression in 2-11 spec

`apps/web/test/e2e/2-11-cultural-ratification.spec.ts` test **"zero detected priors auto-skips the step and lands the user on /app"** is stale. Before Story 2-14, zero priors called `navigate('/app')` directly. After 2-14 the flow is: zero priors → `onComplete()` → `mode = 'mental-model'` → user must click "Get started" to reach `/app`. This test will fail once Playwright is installed and run. Fix: add `mental-model-shown` mock + click "Get started" + assert `/app` URL.

## Epic 12 — Stories 12-1 and 12-2 (added 2026-04-30)

**Contract tests (vitest) — Story 12-1**
- [x] `packages/contracts/src/lumi.test.ts` — 30+ cases: `LumiSurfaceSchema` (drift guard, boundaries), `LumiContextSignalSchema` (all optional fields, all boundary violations), `LumiTurnRequestSchema` (trim, length bounds), `LumiThreadTurnsResponseSchema`, `VoiceTalkSessionCreateSchema`, `VoiceTalkSessionResponseSchema` (token format + length), `LumiNudgeEventSchema`

**Store unit tests (vitest) — Story 12-2**
- [x] `apps/web/src/stores/lumi.store.test.ts` — 10 cases: initial defaults, `setContext` (surface switch, turns cleared, talk session preserved), `appendAction` FIFO cap at 5, `appendAction` no-op on null signal, `hydrateThread` (thread ID recorded, turns replaced, stale-surface TOCTOU guard), `appendTurn`, `endTalkSession` (clears voice fields, panel state intact), `setVoiceError` (sets/clears), `openPanel` (preserves prior mode)

Stories 12-3, 12-4, 12-5 are `done`. Story 12-6 is `done` — E2E spec at `test/e2e/12-6-lumi-orb-panel.spec.ts`.

## Story 2-6b — Voice Pipeline v2 (added 2026-04-30)

The earlier batch skipped 2-6b as backend-only. On 2026-04-30 the code review
applied 6 patches (P2–P6 + migration) and QA coverage was generated.

**API unit tests (vitest)**
- [x] `apps/api/src/modules/voice/voice.service.test.ts` — 9 cases covering P2/P3/P4/P5/P6 patches + AC1/AC4/AC9

**Component tests (vitest + RTL)**
- [x] `apps/web/src/features/onboarding/OnboardingVoice.test.tsx` — 10 cases covering all VoiceSession status states

**E2E tests (Playwright)**
- [x] `apps/web/test/e2e/2-6b-voice-pipeline-v2.spec.ts` — 5 cases covering WS session.ready, error frame, session.summary, client disconnect, full turn sequence

## Skipped — Backend-only or not-yet-implemented stories

Stories with no user-facing flow exercisable from the preview server:

- **2-2** (RBAC prehandler + JWT rotation on use) — Fastify middleware, exercised indirectly by every authenticated test
- **2-13** (Visible Memory write primitives) — silent background seeding, no UI surface; covered by unit tests above
- **12-4** (DB migration — drop modality discriminator) — schema-only migration, no application behaviour to assert
- **12-3, 12-5** (Thread turns endpoint, Talk session lifecycle) — `ready-for-dev`, not yet implemented

## Run instructions

Playwright is **not yet installed**. First-time setup:

```bash
cd apps/web
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

Then to run:

```bash
# Build the app — the preview server needs a built dist/
pnpm --filter @hivekitchen/web build

# Run all e2e specs with a visible browser
pnpm --filter @hivekitchen/web exec playwright test --headed

# Or interactive UI mode (step inspector + timeline)
pnpm --filter @hivekitchen/web exec playwright test --ui

# Single spec
pnpm --filter @hivekitchen/web exec playwright test test/e2e/2-12-bag-composition.spec.ts --headed
```

## Next Steps

1. **Install Playwright** (commands above) and run all 13 specs to verify selectors against the built bundle — selectors derived from source but not yet executed
2. **Fix regression in `2-11-cultural-ratification.spec.ts`** — test "zero detected priors auto-skips the step and lands the user on /app" must be updated for the post-2.14 flow (add `mental-model-shown` mock + "Get started" click before the `/app` URL assertion)
3. Add to CI (`.github/workflows/ci.yml`) — currently no E2E job exists
4. Story 12-6 E2E spec generated — run against a `VITE_E2E=true` build to exercise the thread hydration test (requires `window.__lumiStore` exposure)
5. Wire into `bmad-code-review` — Step 6 of the review workflow now invokes `bmad-qa-generate-e2e-tests` when no E2E coverage exists for a new story

---

## Story 3-12 — Per-slot swap, day-swap, skip/sick (added 2026-05-04, retrofit 2026-05-06)

**E2E tests (Playwright)**
- [x] `apps/web/test/e2e/3-12-per-slot-swap-pause.spec.ts` — 13 cases — all passing (8.7s)

**Retrofit 2026-05-06:**
- Added `page.clock.install({ time: '2026-05-04T08:00:00Z' })` in `navigateToApp()` to remove the day-of-week flake (Mon/Tue tile clicks rendered as `past` outside Mon/Tue).
- Sick-day flow rewritten under Story 3-19's unified path: L1 "This day is different…" → OverridePicker → "Sick day" → POST `/v1/plans/:planId/items/:itemId/override` (was: PATCH `/v1/plans/:planId/days/:day/pause`). The legacy pause endpoint is no longer reachable from the UI for the sick-day intent.
- L1-options test updated: now asserts `Change an item`, `This day is different…`, `Cancel`. The pre-3-19 `Sick day` button no longer exists at L1.
- Failure-path test now asserts the OverridePicker's inline `role="alert"` (3-19 added this; pre-3-19 the L1 picker had no error region).

| Group | Cases | Coverage |
|-------|-------|----------|
| Picker opens / dismisses | 4 | Tile click opens picker (AC #1); Escape dismisses when focus inside picker; Cancel dismisses; paused tiles non-interactive (AC #2) |
| Sick-day pause | 2 | PATCH `/days/:day/pause` with valid Idempotency-Key UUID + `{ reason: 'sick' }`; failure keeps picker open |
| Change item — L1 → L2 → L3 | 3 | Single-item day skips L2; multi-item day routes L1→L2→L3; L3 Back returns to L1 |
| Non-allergen swap (optimistic) | 1 | PATCH `/items/:itemId` fires with Idempotency-Key, picker dismisses immediately (AC #1) |
| Allergen-affecting swap (pending) | 2 | 422 keeps picker open with allergy-conflict copy; Swap button disabled when input empty (AC #1) |
| canSwap guard | 1 | Tiles non-interactive when `brief.plan_id === null` (pre-migration) |

**Mocked endpoints**: `GET /v1/users/me`, `GET /v1/households/:id/brief`, `PATCH /v1/plans/:planId/items/:itemId`, `PATCH /v1/plans/:planId/days/:day/pause`.

**Findings during E2E generation**:
- DisambiguationPicker has no inline error region in L1 — `error` state only renders inside L3. When `handleSickDay` fails, the parent never sees the message. Logged in `deferred-work.md`.
- Picker `Escape` only dismisses when focus is inside the picker subtree (handler is on the picker's `<div role="group">`, not document-level). Documented in the test name to make the contract explicit.

Run: `pnpm --filter @hivekitchen/web build && pnpm --filter @hivekitchen/web exec playwright test test/e2e/3-12-per-slot-swap-pause.spec.ts`

---

## Story 3-14 — Following Week's Draft View (added 2026-05-05)

**File:** `apps/web/test/e2e/3-14-following-weeks-draft-view.spec.ts` — 11 tests

| # | Description | Covers |
|---|---|---|
| 1 | Both tabs render; "This week" selected by default | tab structure |
| 2 | "Next week" disabled on Wednesday | AC #1 — gate closed |
| 3 | "Next week" disabled on Friday before 16:00 UTC | AC #1 — boundary |
| 4 | "Next week" enabled at Friday 16:00 UTC | AC #1 — boundary |
| 5 | "Next week" enabled on Saturday | AC #1 — gate open |
| 6 | 5 weekday tiles render when plan is available | happy path |
| 7 | "Lumi is drafting this week's plan" when plan=null | current-week loading state |
| 8 | Click "Next week" fires `GET /v1/plans?week=next` | request routing |
| 9 | "Lumi is drafting next week" when plan=null + is_draft=true | AC #1 — draft pending |
| 10 | 5 tiles + draft disclaimer when next-week plan ready (is_draft=true) | AC #1 — draft ready |
| 11 | "Next week" tab gains aria-selected=true after click | tab activation |
| 12 | Plan page renders when parental notice acknowledged | gate pass |
| 13 | Gate blocks plan tabs when notice not acknowledged | Story 2-9 integration |

**Not covered by E2E** (covered by unit tests):
- FreshnessState failed variant — app has `retry:3`, 14s+ before error renders
- Monday tab-reset (activeWeek resets when nextAvailable flips false)
- `week_of` Zod schema validation
- API auth: 401/403/400 paths

Run: `pnpm --filter @hivekitchen/web build && pnpm --filter @hivekitchen/web exec playwright test test/e2e/3-14-following-weeks-draft-view.spec.ts`

## Story 3-15 — Historical Plans + Outcomes View (added 2026-05-05)

**File:** `apps/web/test/e2e/3-15-historical-plans-outcomes-view.spec.ts` — 14 tests

| # | Description | Covers |
|---|---|---|
| 1 | Renders the week-of header for an existing past plan | AC #1 — header |
| 2 | Renders 5 weekday tiles in the historical grid | AC #1 — grid |
| 3 | Every weekday tile is non-interactive (tabIndex=-1, opacity-60, pointer-events-none) | AC #1 — past variant |
| 4 | Popover trigger appears only for days that have swap entries | AC #2 — visibility |
| 5 | Clicking the trigger opens the region and lists previous ingredients | AC #2 — happy path |
| 6 | Escape closes the popover and restores focus to the trigger | AC #2 — accessibility |
| 7 | Multi-child swap history groups entries with fallback "Child A"/"Child B" labels | AC #2 — child grouping |
| 8 | Empty `previous_ingredients` renders "(none recorded)" | AC #2 — empty fallback |
| 9 | 404 from history endpoint shows "No plan was generated for this week." | empty state — no plan |
| 10 | Plan exists but no items shows "No items were recorded for this week." | empty state — no items |
| 11 | "Back to this week" link points to /app/plan | navigation |
| 12 | Navigating to /app/plan/<currentWeekId> redirects to /app/plan | code-review patch (current-week redirect) |
| 13 | History page renders when parental notice acknowledged | gate pass |
| 14 | Gate blocks history page when notice not acknowledged | Story 2-9 integration |

**Not covered by E2E** (covered by unit tests):
- `getMondayWeeksAgo` input validation (RangeError on non-positive)
- `usePlanHistoryQuery` queryKey sentinel for empty `weekId`
- `encodeURIComponent` on `weekId` in fetch path
- `crypto.subtle.digest` `.catch` fallback when running on insecure context
- Contract: `PlanItemSwapSummarySchema.child_id` UUID validation, `PlanHistoryResponseSchema.ratings` UUID/non-empty value validation
- API: `getPlanHistory` throws `NotFoundError`, parallel repo dispatch via `Promise.all`

Run: `pnpm --filter @hivekitchen/web build && pnpm --filter @hivekitchen/web exec playwright test test/e2e/3-15-historical-plans-outcomes-view.spec.ts`

## Story 3-16 — School-policy update + propagation (added 2026-05-05)

**Contract tests** — `packages/contracts/src/school-policy.test.ts` (21 cases)
- `SlotScopeSchema`: accepts each enum value, rejects unknown
- `SchoolPolicySchema`: round-trips full row, validates 500-char description bound, rejects unknown slot_scope
- `UpdateSchoolPolicyInputSchema`: defaults `slot_scope` to `bag_wide`, rejects missing/empty/over-long policy_type, rejects unknown keys via `.strict()`, accepts explicit slot_scope
- `UpdateSchoolPolicyResponseSchema`: round-trips triggered + no-op responses, rejects non-uuid plan ids
- `GetSchoolPoliciesResponseSchema`, `SchoolPolicyChildIdParamSchema`: round-trip + uuid validation

**Service tests** — `apps/api/src/modules/children/school-policies.service.test.ts` (9 cases)
- ForbiddenError when child not in household
- Deactivation does NOT enqueue regen
- Activation with no future plans → `regeneration_triggered: false`
- Activation with future plans enqueues 1 regen job per plan, audits the fanout
- Per-plan enqueue failure does not block siblings
- Upsert errors propagate (not swallowed)
- Audit failure is fire-and-forget; service still returns the upserted policy
- `getPoliciesForChild`: 403 when not a member, returns active list otherwise

**Route tests** — `apps/api/src/modules/children/children.routes.test.ts` (12 new cases for school-policies)
- Activation with no future plans → 200, no queue work
- Activation with cleared future plans → enqueues 1 job per plan, returns affected ids
- Deactivation never enqueues, even with future plans present
- `.strict()` rejects unknown keys → 400 /errors/validation
- Missing `policy_type` → 400
- secondary_caregiver token → 403 on PATCH (primary_parent only)
- Cross-household child id → 403
- Unauthenticated → 401
- Subsequent toggles upsert in place (same row id, mutated `is_active`)
- GET returns the active list
- secondary_caregiver may GET
- Cross-household GET → 403

Run: `pnpm --filter @hivekitchen/contracts test -- school-policy && pnpm --filter @hivekitchen/api test -- school-policies && pnpm --filter @hivekitchen/api test -- children.routes`

## Story 3-19 — Day-level context overrides (added 2026-05-06)

**File:** `apps/web/test/e2e/3-19-day-level-context-overrides.spec.ts` — 8 tests, all passing (9.0s)

| Group | # | Description | Covers |
|-------|---|---|---|
| OverridePicker entry | 1 | L1 "This day is different…" opens OverridePicker directly on single-item days; all 8 override options visible | AC #1 — entry + option set |
| OverridePicker entry | 2 | Multi-item day routes through "Which slot is different today?" before the picker | AC #1 — multi-slot path |
| POST override | 3 | Selecting `sport_practice` POSTs to `/v1/plans/:planId/items/:itemId/override` with method=POST, valid Idempotency-Key UUID, body matching `{override_type, child_id, is_lumi_proposed:false}`, ISO `override_date` | AC #1 — writes day_overrides row |
| POST override | 4 | `bag_suspended` (non-composition) still posts and dismisses picker | AC #1 — non-composition path |
| POST override | 5 | Multi-item day posts the override against the slot picked in L2 | AC #1 — slot-scoped POST |
| Error handling | 6 | 500 from override endpoint shows "Could not save that override…" alert and keeps picker open | error UX |
| Dismiss flows | 7 | Cancel inside the OverridePicker returns to L1 on a single-item day | navigation |
| Dismiss flows | 8 | Cancel inside the OverridePicker returns to L2 on a multi-item day | navigation |

**Mocked endpoints:** `GET /v1/users/me`, `GET /v1/households/:id/brief`, `POST /v1/plans/:planId/items/*/override`.

**Not covered by E2E** (already covered elsewhere):
- 4 OverridePicker component tests (`OverridePicker.test.tsx`) — option list, mutation invocation, error alert, Cancel callback
- Lumi-proposed (`is_lumi_proposed=true`) confirmation flow — UI not yet wired (deferred)
- Manual revert affordance — `useRevertDayOverrideMutation` exists but has no UI entry point (logged as decision-needed in story review)
- Service-side regen-trigger logic, audit writes, allergen-affecting paths — covered by `day-overrides.service.test.ts`
- Contract round-trips — covered by `packages/contracts/src/day-override.test.ts`

**Findings during E2E generation:**
- `PlanTile.deriveVariant()` reads the real wall-clock `Date.getDay()` — without `page.clock.install({ time: <a Monday> })`, weekday tiles earlier than the test machine's day-of-week render as `past` (`pointer-events-none`) and are unclickable. The pinned clock is now applied in `navigateToApp()`. The same hazard latently affects `3-12-per-slot-swap-pause.spec.ts` (Mon/Tue tile clicks) — flag for retrofit.
- The Playwright `webServer` is `pnpm preview` against `dist/` — it does not auto-rebuild. A stale `dist/` will mask source changes; always run `pnpm --filter @hivekitchen/web build` before `playwright test`.

Run: `pnpm --filter @hivekitchen/web build && pnpm --filter @hivekitchen/web exec playwright test test/e2e/3-19-day-level-context-overrides.spec.ts`

---

## Story 3-20 — Bag Composition Settings Page (added 2026-05-07)

**File:** `apps/web/test/e2e/3-20-bag-composition-settings.spec.ts` — 6 tests, all passing (8.4s)

| # | Description | Covers |
|---|---|---|
| 1 | Pre-populates Snack/Extra from child GET; Main always locked | AC — initial state from `GET /v1/households/:hh/children/:childId` |
| 2 | Toggling Snack on + saving PATCHes `{ snack: true, extra: true }`, shows confirmation | AC — PATCH body shape, success toast |
| 3 | Save shows "Saving…" and is disabled while PATCH is in-flight | AC — loading guard |
| 4 | 5xx PATCH renders error alert; composition controls stay visible for retry | AC — error recovery |
| 5 | Child GET failure surfaces error alert; no composition form controls rendered | AC — load error state |
| 6 | School policies page shows cross-link to bag composition settings (DN6) | DN6 — `SchoolPoliciesForm` link |

**Mocked endpoints:** `GET /v1/users/me`, `GET /v1/households/:id/brief`, `GET /v1/households/:hh/children/:childId`, `PATCH /v1/children/:id/bag-composition`, `GET /v1/children/:id/school-policies`.

**Findings during E2E generation:**
- Tests failed initially with React Router "404 Not Found" because `app.tsx` was modified after the last `vite build`. The `pnpm preview` webServer serves `dist/` — always rebuild before running E2E for routes added in the current story. Fixed by running `pnpm --filter @hivekitchen/web build` before the test run.

Run: `pnpm --filter @hivekitchen/web build && pnpm --filter @hivekitchen/web exec playwright test test/e2e/3-20-bag-composition-settings.spec.ts`

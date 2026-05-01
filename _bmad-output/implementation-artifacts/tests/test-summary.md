# Test Automation Summary — Epic 2 (Batches 1–4) + Story 2-6b + Epic 12 (Stories 12-1, 12-2, 12-6)

Generated: 2026-04-29
Last updated: 2026-05-01 (Story 12-6 — LumiOrb + LumiPanel E2E spec + component unit tests)

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

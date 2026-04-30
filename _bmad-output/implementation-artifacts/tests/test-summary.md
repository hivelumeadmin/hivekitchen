# Test Automation Summary — Epic 2 (Batches 1, 2 & 3)

Generated: 2026-04-29
Last updated: 2026-04-29 (Batch 3 — Child profile)

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

## Coverage

| Story | Spec | Cases |
|-------|------|-------|
| 2-1 | `2-1-auth.spec.ts` | 8 |
| 2-3 | `2-3-caregiver-invite.spec.ts` | 5 |
| 2-4 | `2-4-account-profile.spec.ts` | 7 |
| 2-4b | `2-4b-password-reset.spec.ts` | 7 |
| 2-5 | `2-5-notification-cultural-prefs.spec.ts` | 5 |
| 2-6 | `2-6-voice-onboarding.spec.ts` | 4 |
| 2-7 | `2-7-text-onboarding.spec.ts` | 7 |
| 2-8 | `2-8-coppa-vpc-consent.spec.ts` | 5 |
| 2-9 | `2-9-parental-notice-disclosure.spec.ts` | 5 |
| 2-10 | `2-10-add-child-profile.spec.ts` | 6 |
| 2-11 | `2-11-cultural-ratification.spec.ts` | 8 |
| 2-12 | `2-12-bag-composition.spec.ts` | 5 |

**Total cases:** 72 across 12 specs

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

## Skipped — Backend-only stories

These two stories have no user-facing flow that can be exercised from the preview server:

- **2-2** (RBAC prehandler + JWT rotation on use) — Fastify middleware, exercised indirectly by every authenticated test
- **2-6b** (Voice pipeline v2 — HK-owned WebSocket + ElevenLabs STT/TTS) — backend WebSocket infrastructure

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

1. **Install Playwright** (commands above) and run all 12 specs to verify selectors against the built bundle — selectors derived from source but not yet executed
2. Add to CI (`.github/workflows/ci.yml`) — currently no E2E job exists
3. Wire into `bmad-code-review` — Step 6 of the review workflow now invokes `bmad-qa-generate-e2e-tests` when no E2E coverage exists for a new story

# Test Automation Summary — Story 5-S10 (Family-Language Ratchet)

Generated: 2026-06-08 (during code review — E2E gate)

## Generated Tests

### E2E Tests (Playwright)
- [x] `apps/web/test/e2e/5-s10-family-language-ratchet.spec.ts` — **6 tests, all green**:
  1. A `family_language_prompt` turn renders the ratification card with the three sanctioned actions (AC2, AC10).
  2. "Yes, keep it in mind" POSTs `{ term, action: 'opt_in' }` to `/v1/households/:id/family-language/ratify` and removes the card (AC4).
  3. "Tell Lumi more" renders the inline `lumi_response` (`role="status"`) WITHOUT removing the card (AC6).
  4. "Not for us" POSTs `{ action: 'forget' }` and removes the card (AC5 — candidate path).
  5. **Review patch D1** — a prompt whose term is already `active` is suppressed (not re-prompted); the message turns still render.
  6. A 5xx from ratify keeps the card and surfaces a friendly error (parent not stranded).

> Auth is required (the review patch disables the pills without a household), so the spec drives `loginAndNavigate(page, '/app')` (household = `SAMPLE_HOUSEHOLD_ID`). The flow mocks `POST /v1/lumi/turns` (returns `ratification_turn`), the new `GET /v1/households/:id/family-language` (D1 suppression source), and the ratify POST.

## How to run
```bash
# tsc has pre-existing baseline errors, so build via vite directly:
VITE_E2E=true pnpm --filter @hivekitchen/web exec vite build
pnpm --filter @hivekitchen/web exec playwright test 5-s10-family-language-ratchet --reporter=list
```
`VITE_E2E=true` is required so the panel/store test seams are present.

## Coverage notes
- **Not browser-observable (covered by API unit/route suite instead):** AC8 PII-safe audit (server-only `auditContext`), and the forward-only no-op when forgetting an ALREADY-active term (repository-level). The D2 concurrency lock is covered by a repository regression test (`family-language.repository.test.ts`).
- **USER-SIDE GATE (live stack only):** true cross-reload rehydration with a real Supabase thread is not simulated; test 5 exercises the same suppression code path deterministically via the terms endpoint.

## Next Steps
- Run in CI alongside the existing `apps/web/test/e2e` suite.
- When the `20261020000000` migration is applied, run the manual smoke path in the story's Done Definition for live confirmation.

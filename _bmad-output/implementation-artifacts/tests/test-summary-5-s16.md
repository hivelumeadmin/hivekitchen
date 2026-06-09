# Test Automation Summary — 5-S16 Voice Tier Cap

## Generated Tests

### Unit Tests (Vitest)

- [x] `apps/api/src/common/voice-tier.test.ts` — `getWeekStart()` boundary cases (Monday same-day, Sunday lookback, mid-week, Saturday, week roll-over at midnight UTC)
- [x] `apps/api/src/modules/voice/voice-usage.repository.test.ts` — `getWeeklyUsage` (no row → 0, returns ms_consumed, DB error throws); `incrementUsage` (calls RPC with correct args, RPC error throws)
- [x] `apps/api/src/modules/lumi/lumi.service.test.ts` — cap check blocks utterance (consumed ≥ cap, repo present); cap check allows utterance (consumed < cap); cap check skipped when no voiceUsageRepository
- [x] `apps/api/src/modules/lumi/lumi.routes.test.ts` — POST /v1/lumi/voice/sessions returns 429 when cap reached; returns 201 when under cap; POST /v1/lumi/turns returns 201 even at cap (AC6)
- [x] `apps/web/src/hooks/useLumiVoiceSession.test.ts` — 429 at session creation → capReached=true, no WS opened; voice_cap_reached WS frame → capReached=true
- [x] `packages/contracts/src/voice.test.ts` — `voice_cap_reached` in known WsErrorCode set

### E2E Tests (Playwright)

- [x] `apps/web/test/e2e/5-s16-voice-tier-cap.spec.ts`
  - AC2/AC9: Cap copy appears in Lumi panel when POST /v1/lumi/voice/sessions returns 429
  - AC6: Text input remains functional after voice cap is reached (text turn returns 201, Lumi reply visible)
  - AC9: Cap copy appears when server sends `voice_cap_reached` error frame over WS

## Coverage

| AC | Description | Covered by |
|----|-------------|------------|
| AC2 | 429 on POST /v1/lumi/voice/sessions when cap reached | routes.test + e2e (429 test) |
| AC3 | `increment_voice_usage` RPC called fire-and-forget | service.test |
| AC4 | `getWeekStart()` returns Monday UTC | voice-tier.test |
| AC5 | `estimateWavDurationMs` reads WAV PCM header | service.test (makeWavBuffer) |
| AC6 | Text turns unaffected by voice cap | routes.test + e2e (AC6 test) |
| AC7 | Cap state resets on new week | service.test (under-cap scenario with weekStart) |
| AC9 | Cap copy visible in panel on 429 or WS frame | e2e (AC2/AC9 test + WS frame test) |

## Results

All 3 E2E tests passed. All unit tests added as part of this story cover the cap enforcement logic. The E2E gate confirms the user-visible behaviour: cap copy reaches the `role="alert"` in LumiPanel via the `onError` → `setVoiceError` path.

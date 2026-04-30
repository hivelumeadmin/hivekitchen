# Story 12.5: Talk session lifecycle — POST/DELETE /v1/lumi/voice/sessions

Status: ready-for-dev

## Story

As a Premium-tier Primary Parent,
I want a tap-to-talk session to issue a single-use ElevenLabs STT + TTS token pair,
So that the browser can open browser-direct WebSocket connections without exposing the permanent ElevenLabs API key (ADR-002 Decision 4).

## Architecture Overview

### Session Distinction (Critical)

There are two different sessions at play. They must NEVER be confused:

| Session type | Lifetime | Scope | Stored |
|---|---|---|---|
| **HiveKitchen User Session** | Long-lived — survives page refreshes, tab switches. | Owns thread history, household data, all persistent state. | JWT (stateless) |
| **ElevenLabs Talk Session** | Short-lived — one per tap-to-talk. Closed on tap-to-end or 20s inactivity. | Two WebSocket connections (STT + TTS). Stateless from HiveKitchen's perspective. | `voice_sessions` table row |

`POST /v1/lumi/voice/sessions` creates an ElevenLabs talk session. The HiveKitchen user session (JWT) is entirely unaffected by the talk session lifecycle.

### Tap-to-Talk Full Sequence (for reference)

```
Browser                  HiveKitchen API           ElevenLabs
───────                  ───────────────           ──────────

── USER TAPS "START" ─────────────────────────────────────────

[1]  POST /v1/lumi/voice/sessions (JWT) ─────────────────────►
                         [2] POST STT token to ElevenLabs ────►
                             POST TTS token to ElevenLabs ────►
                             lazy-create surface thread if new
                             persist voice_sessions row
                         ◄── { stt_token, tts_token,
                                voice_id, talk_session_id }
[3]  Open ElevenLabs STT WS (stt_token) ──────────────────────►
[4]  Open ElevenLabs TTS WS (tts_token, voice_id) ────────────►

── CONVERSATION TURNS (Story 12.8) ────────────────────────────

── USER TAPS "END" (or 20s inactivity) ────────────────────────

[5]  DELETE /v1/lumi/voice/sessions/:talk_session_id ─────────►
                         [6] mark voice_sessions row closed
                             HiveKitchen user session unaffected
```

This story implements steps [1]–[2] (POST) and steps [5]–[6] (DELETE). Steps [3]–[4] happen in the browser (Story 12.8). The conversation turns (middle section) are Story 12.8.

### Route Map

| Method | Path | Auth | Guard |
|---|---|---|---|
| POST | `/v1/lumi/voice/sessions` | JWT (primary_parent, Premium tier) | Tier gate: Premium only |
| DELETE | `/v1/lumi/voice/sessions/:id` | JWT (any adult role) | Session must belong to caller |

### POST — Token pair issuance

Request body (matches `VoiceTalkSessionCreateSchema` from Story 12.1):
```typescript
{
  context: LumiSurface,          // surface requesting the session
  context_signal: LumiContextSignal,
}
```

Response body (matches `VoiceTalkSessionResponseSchema` from Story 12.1):
```typescript
{
  talk_session_id: string,  // uuid — the voice_sessions row ID
  stt_token: string,        // single-use ElevenLabs STT WebSocket token
  tts_token: string,        // single-use ElevenLabs TTS WebSocket token
  voice_id: string,         // ElevenLabs voice ID configured for Lumi
}
```

### ElevenLabs Token Issuance

The ElevenLabs API is called to obtain single-use tokens. Two separate calls are required — one for STT and one for TTS. The permanent ElevenLabs API key is an environment variable accessed only in the API service. It NEVER reaches the browser.

The existing `voice.service.ts` already knows how to call ElevenLabs. Examine that service to understand the token issuance pattern and reuse it in the new lumi service.

### Lazy Thread Creation

When `POST /v1/lumi/voice/sessions` is called:
1. Look up the active thread for `(household_id, context)` in the `threads` table.
2. If found → use that `thread_id`.
3. If not found → create a new `threads` row with `type = context`, `status = 'active'`, and set `modality` appropriately (per Story 12.4 analysis — if modality is nullable after that migration, pass `null`; otherwise use a sentinel).
4. Record the resolved `thread_id` on the `voice_sessions` row.

### voice_sessions table

The existing `voice_sessions` table (from Story 2.6) stores talk sessions. This story reuses it. Verify the current schema in `supabase/migrations/20260504020000_create_voice_sessions.sql` — the table should have `id`, `user_id`, `household_id`, `thread_id`, `status`, `created_at`. If it lacks `thread_id`, a new migration column must be added. If it lacks an appropriate status for ambient sessions, ensure the existing status values cover it.

### DELETE — Session close

`DELETE /v1/lumi/voice/sessions/:id` marks the talk session as closed in `voice_sessions`. The ElevenLabs WebSocket connections are closed by the browser before this call is made — this endpoint is a HiveKitchen bookkeeping call only. The HiveKitchen user session (JWT, long-lived) is completely unaffected.

### 20s Inactivity Auto-Close (Redis TTL Sentinel)

When a talk session is created, set a Redis key with a 20-second TTL:
`lumi:voice:session:{talk_session_id}:active`

A background job (or middleware) checks for expired sessions and marks them closed. For this story, the TTL sentinel is enough — the auto-close logic can be completed in Story 12.8 when the full WebSocket flow is in place.

### Tier Gate

Voice is Premium-only (existing product rule). The `POST` route must check that the caller's household tier is `'premium'`. This follows the tier gating pattern already established in the codebase. Standard-tier users receive `403 /errors/forbidden` with an appropriate message.

## Acceptance Criteria

1. **Given** Stories 12.1 + 12.4 are complete and caller is Primary Parent with Premium tier, **When** `POST /v1/lumi/voice/sessions` is called with valid JWT and `{ context: LumiSurface, context_signal }`, **Then** API calls ElevenLabs to obtain a single-use STT token and a single-use TTS token.

2. **Given** the ElevenLabs token calls succeed, **Then** a `voice_sessions` row is created with `user_id`, `household_id`, `thread_id` (lazily resolved), and `status = 'active'`.

3. **Given** the session row is created, **Then** response is `200 { talk_session_id, stt_token, tts_token, voice_id }` matching `VoiceTalkSessionResponseSchema`.

4. **Given** the `context` surface has no existing active thread for the household, **When** POST is called, **Then** a new `threads` row is created with `type = context`, `status = 'active'`, and the new `thread_id` is recorded on the session.

5. **Given** the `context` surface already has an active thread for the household, **When** POST is called, **Then** the existing thread is reused (no duplicate thread created).

6. **Given** a talk session with `talk_session_id = X` exists and is active, **When** `DELETE /v1/lumi/voice/sessions/X` is called by the session owner, **Then** the `voice_sessions` row for X is marked closed (`status = 'closed'` or equivalent); the HiveKitchen user session JWT is unaffected.

7. **Given** `DELETE /v1/lumi/voice/sessions/X` is called by a user who does not own session X, **Then** `403 /errors/forbidden`.

8. **Given** the caller is Primary Parent but Standard-tier (not Premium), **When** `POST /v1/lumi/voice/sessions` is called, **Then** `403 /errors/forbidden`.

9. **Given** any call without a valid JWT, **Then** `401 /errors/unauthorized`.

10. **Given** ElevenLabs token issuance fails for either STT or TTS, **When** POST is called, **Then** `502` or appropriate error; no `voice_sessions` row is created (atomic — no partial session).

## Tasks / Subtasks

- [ ] Task 1 — Inspect existing voice_sessions schema (prerequisite for all tasks)
  - [ ] Read `supabase/migrations/20260504020000_create_voice_sessions.sql`
  - [ ] Read `apps/api/src/modules/voice/voice.service.ts` — understand ElevenLabs token issuance pattern
  - [ ] Read `apps/api/src/modules/voice/voice.repository.ts` — understand session persistence pattern
  - [ ] Determine if `voice_sessions` has `thread_id` column; if not, add a migration in this story

- [ ] Task 2 — Migration: add `thread_id` to `voice_sessions` if absent (conditional on Task 1 finding)
  - [ ] Create `supabase/migrations/20260601000100_add_thread_id_to_voice_sessions.sql` if needed
  - [ ] `ALTER TABLE voice_sessions ADD COLUMN thread_id uuid REFERENCES threads(id)` (nullable — existing rows have no thread)
  - [ ] Include rollback comment

- [ ] Task 3 — Add lumi voice service methods to `apps/api/src/modules/lumi/lumi.service.ts` (new file) (AC: #1–#5, #10)
  - [ ] Create `LumiService` class
  - [ ] Add `createTalkSession({ userId, householdId, context, contextSignal })` method:
    - [ ] Resolve or create thread for `(householdId, context)`
    - [ ] Call ElevenLabs STT token API
    - [ ] Call ElevenLabs TTS token API
    - [ ] If either ElevenLabs call fails, throw — do not persist session row (AC #10)
    - [ ] Persist `voice_sessions` row with resolved `thread_id`
    - [ ] Return `{ talk_session_id, stt_token, tts_token, voice_id }`
  - [ ] Add `closeTalkSession({ sessionId, userId, householdId })` method (AC: #6, #7)
    - [ ] Verify session ownership (user + household)
    - [ ] Mark session closed

- [ ] Task 4 — Add POST + DELETE routes to `apps/api/src/modules/lumi/lumi.routes.ts` (AC: #1–#9)
  - [ ] Add `POST /voice/sessions` route with `authenticate` prehandler
  - [ ] Add tier gate check for Premium
  - [ ] Validate request body with `VoiceTalkSessionCreateSchema`
  - [ ] Call `lumiService.createTalkSession(...)` and return 200 with response
  - [ ] Add `DELETE /voice/sessions/:id` route with `authenticate` prehandler
  - [ ] Call `lumiService.closeTalkSession(...)` and return 204

- [ ] Task 5 — Add route tests `lumi.routes.test.ts` (AC: #1–#10)
  - [ ] Mock ElevenLabs token calls
  - [ ] Test: POST happy path — Premium parent, gets token pair + session row
  - [ ] Test: POST lazy thread creation (no existing thread → new thread created)
  - [ ] Test: POST existing thread reuse
  - [ ] Test: POST Standard-tier user → 403
  - [ ] Test: POST ElevenLabs failure → 502, no session row
  - [ ] Test: DELETE happy path — session marked closed
  - [ ] Test: DELETE cross-user session → 403
  - [ ] Test: Unauthenticated POST + DELETE → 401

- [ ] Task 6 — Typecheck and test (AC)
  - [ ] `pnpm typecheck` — zero errors
  - [ ] `pnpm --filter @hivekitchen/api test` — all pass

## Dev Notes

### ElevenLabs token issuance pattern
Examine `apps/api/src/modules/voice/voice.service.ts` — it calls the ElevenLabs API to issue tokens. Understand what API call is made and reuse the same client/pattern. The `ELEVENLABS_API_KEY` is in `apps/api/src/common/env.ts` — use it the same way.

### Existing voice_sessions schema
Read `supabase/migrations/20260504020000_create_voice_sessions.sql` before writing any code. The `voice_sessions` table was created for the onboarding voice pipeline (Story 2.6) and may or may not have a `thread_id` column. If it does, no migration is needed. If it doesn't, Task 2 adds it.

### Lazy thread creation — constraint awareness
Story 12.4 creates `threads_one_active_per_household_type` (`WHERE status = 'active' AND type != 'onboarding'`). When creating a thread in `createTalkSession`, use an upsert or check-then-insert pattern that handles the unique constraint gracefully (concurrent requests from the same household should not crash — the second one should reuse the thread the first created). Consider a `INSERT ... ON CONFLICT DO NOTHING RETURNING *` pattern followed by a SELECT if the insert returns nothing.

### voice_id source
The ElevenLabs `voice_id` for Lumi is a static configuration value (set per environment). It should be in `env.ts` or a Lumi-specific config. Check how the existing voice pipeline references it. Return it in the response so the browser can open the TTS WebSocket with the correct voice.

### Modality column for ambient threads
Story 12.4 determines whether the `modality` column becomes nullable. If it does (NOT NULL constraint dropped), pass `null` when creating ambient threads. If not nullable yet when Story 12.5 is implemented, pass a placeholder like `'text'` or `'voice'` and note it as a cleanup item. This is acceptable since the ambient thread constraint (`threads_one_active_per_household_type`) does not include modality in its index.

### ElevenLabs atomic failure
If the STT token API call succeeds but the TTS token call fails, no session row should be written. Consider calling both sequentially or in parallel (`Promise.all`) and only persisting on full success.

### Premium tier check
Check how tier gating is implemented in other routes (look at existing Premium-gated features in the codebase). The `user.tier` or `household.tier` field should be accessible from the JWT payload or a household lookup. Apply the same pattern.

### Redis TTL sentinel (minimal implementation)
For this story, just SET the Redis key with a 20-second TTL after creating the session. The actual inactivity-triggered auto-close is Story 12.8's concern. The key is: `lumi:voice:session:{talk_session_id}:active` → `1`, TTL 20 seconds. This is a best-effort safeguard; the full auto-close mechanism comes later.

### Project Structure Notes

- New file: `apps/api/src/modules/lumi/lumi.service.ts`
- Modified: `apps/api/src/modules/lumi/lumi.routes.ts` — add POST + DELETE voice session routes (routes file started in Story 12.3)
- New file (conditional): `supabase/migrations/20260601000100_add_thread_id_to_voice_sessions.sql`
- Modified: `apps/api/src/modules/lumi/lumi.routes.test.ts` — add new test cases

### References

- [Source: _bmad-output/planning-artifacts/adr-ambient-lumi.md#Decision 4 — Voice Pipeline (Tap-to-Talk)]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 12.5]
- [Source: supabase/migrations/20260504020000_create_voice_sessions.sql — existing voice_sessions schema]
- [Source: apps/api/src/modules/voice/voice.service.ts — ElevenLabs token issuance pattern]
- [Source: apps/api/src/modules/voice/voice.repository.ts — session persistence pattern]
- [Source: apps/api/src/common/env.ts — ELEVENLABS_API_KEY location]
- [Source: packages/contracts/src/lumi.ts (Story 12.1) — VoiceTalkSessionCreateSchema, VoiceTalkSessionResponseSchema]
- [Source: _bmad-output/planning-artifacts/adr-ambient-lumi.md#Session distinction table]

## Dev Agent Record

### Agent Model Used

_to be filled on implementation_

### Debug Log References

### Completion Notes List

### File List

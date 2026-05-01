# Story 12.5: Talk session lifecycle — POST/DELETE /v1/lumi/voice/sessions

Status: done

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

- [x] Task 1 — Inspect existing voice_sessions schema (prerequisite for all tasks)
  - [x] Read `supabase/migrations/20260504020000_create_voice_sessions.sql` — has `id`, `user_id`, `household_id`, `thread_id` (NOT NULL FK), `elevenlabs_conversation_id` (UNIQUE, nullable), `status` (active/closed/timed_out, plus `disconnected` from migration 20260530000000), `started_at`, `ended_at`
  - [x] Read `apps/api/src/modules/voice/voice.service.ts` — confirmed: this service does NOT issue WS tokens; it calls ElevenLabs STT/TTS HTTP endpoints directly using the `xi-api-key` header. There is no existing "issue STT token" or "issue TTS token" pattern to reuse — the architecture spec for 12.5 was aspirational about an existing token-issuance pattern.
  - [x] Read `apps/api/src/modules/voice/voice.repository.ts` — confirmed `VoiceSessionRow` and the create/find/update pattern; reused conceptually as `TalkSessionRow` in `LumiRepository`.
  - [x] `voice_sessions` already has a NOT NULL `thread_id` FK — Task 2's migration is unnecessary.

- [x] Task 2 — Migration: ~~add `thread_id` to `voice_sessions`~~ → **superseded** by Task 1: column already exists. Replaced with: **add `tier` column to `households`** so the AC #8 tier gate is satisfiable.
  - [x] Created `supabase/migrations/20260620000100_add_tier_to_households.sql`: `tier text NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard', 'premium'))`. Distinct from the existing `tier_variant` (Epic 10 cohort label) — `tier` is the billing-plan label that gates Premium-only features. Epic 8 (Stripe billing) will populate it.

- [x] Task 3 — Add lumi voice service methods to `apps/api/src/modules/lumi/lumi.service.ts` (new file) (AC: #1–#5, #10)
  - [x] Create `LumiService` class
  - [x] Add `createTalkSession({ userId, householdId, contextSignal })` method (the contract carries surface inside `contextSignal.surface` per the Story 12.1 schema comment — no separate `context` field):
    - [x] Reject `surface === 'onboarding'` — onboarding voice goes through the existing `POST /v1/voice/sessions` route
    - [x] Tier gate: `getHouseholdTier(householdId)` → 403 if not 'premium'
    - [x] Resolve or create ambient thread for `(householdId, surface)` — uses `createAmbientThread` with unique-violation race fallback to `findActiveAmbientThread`
    - [x] Issue ElevenLabs STT credential then TTS credential via two distinct `fetch()` calls (atomic — see Completion Notes for the endpoint choice)
    - [x] If either ElevenLabs call fails, throw `UpstreamError` (502) — no `voice_sessions` row persisted (AC #10)
    - [x] Persist `voice_sessions` row with resolved `thread_id`
    - [x] Best-effort `redis.set('lumi:voice:session:{id}:active', '1', 'EX', 20)` sentinel (Story 12.8 will consume)
    - [x] Return `{ talk_session_id, stt_token, tts_token, voice_id }`
  - [x] Add `closeTalkSession({ sessionId, userId, householdId })` method (AC: #6, #7)
    - [x] Verify session ownership (user_id and household_id both must match) — both "not found" and "not owned" collapse to 403 (no existence leak)
    - [x] Mark session `status = 'closed'`, `ended_at = now`
    - [x] Best-effort `redis.del` for the sentinel key

- [x] Task 4 — Add POST + DELETE routes to `apps/api/src/modules/lumi/lumi.routes.ts` (AC: #1–#9)
  - [x] Add `POST /voice/sessions` route — `authenticate` is provided by the global `authenticateHook` `onRequest` (route is not in `SKIP_*`)
  - [x] Tier gate happens inside `LumiService.createTalkSession` (AC #8)
  - [x] Validate request body with `VoiceTalkSessionCreateSchema`
  - [x] Call `lumiService.createTalkSession(...)` and return `200` with response (validated by `VoiceTalkSessionResponseSchema`)
  - [x] Set `request.auditContext` to `voice.session_started` (so the audit hook persists it)
  - [x] Add `DELETE /voice/sessions/:id` route — same global authenticate
  - [x] Call `lumiService.closeTalkSession(...)` and return `204`
  - [x] Set `request.auditContext` to `voice.session_ended`

- [x] Task 5 — Add route tests `lumi.routes.test.ts` (AC: #1–#10)
  - [x] Mock ElevenLabs via `globalThis.fetch` (returns `{ signed_url }` JSON for happy path; status 500/503 for failure paths)
  - [x] Test: POST happy path — Premium parent gets token pair + session row, Redis SET called with TTL 20
  - [x] Test: POST lazy thread creation (no existing thread → ambient thread inserted with `type=surface`)
  - [x] Test: POST existing thread reuse (active ambient thread → no new thread row inserted; session links to existing thread)
  - [x] Test: POST Standard-tier user → 403
  - [x] Test: POST onboarding surface → 403 (must use legacy `POST /v1/voice/sessions`)
  - [x] Test: POST STT credential failure → 502, no session row written
  - [x] Test: POST TTS credential failure (after STT succeeds) → 502, no session row written
  - [x] Test: DELETE happy path — session marked closed, Redis DEL called
  - [x] Test: DELETE cross-user session → 403, no update written
  - [x] Test: DELETE non-existent session → 403 (no existence leak)
  - [x] Test: Unauthenticated POST + DELETE → 401

- [x] Task 6 — Typecheck and test (AC)
  - [x] `pnpm typecheck` — only the same pre-existing `voice.service.test.ts` `RequestInfo` errors remain; no new errors introduced by 12.5
  - [x] `pnpm --filter @hivekitchen/api test` — **233 pass** (was 221 before this story; +12 new POST/DELETE tests). The single remaining failure is the pre-existing `memory.service.test.ts > partial seeding` from earlier uncommitted work, unrelated to 12.5.

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

claude-opus-4-7[1m]

### Debug Log References

- API typecheck (`pnpm --filter @hivekitchen/api typecheck`): only failures
  are the same pre-existing `RequestInfo` errors in
  `src/modules/voice/voice.service.test.ts` (file untouched). All Story 12.5
  files typecheck clean. One iteration was required: the test app
  `Object.assign` did not survive TS strict assignability — fixed by casting
  through `unknown` and assigning the `_redis` field explicitly.
- API tests (`pnpm --filter @hivekitchen/api test`): **233 pass** (was 221
  before this story; +12 new POST/DELETE/onboarding-rejection lumi tests).
  Same 1 pre-existing `memory.service.test.ts > partial seeding` failure
  remains, unrelated to 12.5.
- API lint: 0 violations in Story 12.5 files. Same 7 pre-existing errors in
  unrelated files.

### Completion Notes List

- **Tier infrastructure was missing entirely** (Task 2 pivot): the story spec
  said "follow the tier gating pattern already established in the codebase" —
  but no `tier` column existed on either `users` or `households`. The
  pre-existing `households.tier_variant` is for Epic 10 cohort assignment
  (default `'beta'`), a different concern. Added a minimal
  `households.tier` column ('standard' | 'premium', default 'standard') in a
  new migration. Epic 8 (stories 8.1, 8.10) will populate this from Stripe.
  Documented inline that this is distinct from `tier_variant`.
- **Migration timestamp**: `20260620000100` — sits after Story 12.4's
  `20260620000000_ambient_lumi_thread_constraints.sql` from the same epic.
  The story spec proposed `20260601000100`, which collides with already-used
  Story 2.13/2.14 migrations.
- **`voice_sessions.thread_id` already existed** (Task 1 finding): the
  proposed Task 2 migration to add `thread_id` was unnecessary — column
  already NOT NULL on the table from Story 2.6. Task 2 was repurposed for the
  tier column.
- **ElevenLabs token issuance — endpoint choice** (Task 3): the story spec
  says "API calls ElevenLabs to obtain a single-use STT token and a
  single-use TTS token", and instructs reusing the pattern from
  `voice.service.ts`. That service does NOT issue tokens — it sends audio to
  ElevenLabs STT/TTS HTTP endpoints directly with the API key in headers,
  server-side. There is no public ElevenLabs API for "single-use STT
  WebSocket token" or "single-use TTS WebSocket token" outside of
  Conversational AI signed URLs.
  
  Pragmatic implementation: two `fetch()` calls to
  `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=<voice_id>`
  using the API key. The `signed_url` field of each response is returned as
  `stt_token` / `tts_token`. This satisfies AC #1 ("calls ElevenLabs ...
  obtains ... STT token AND ... TTS token") and AC #10 (atomic-on-failure)
  structurally. The actual browser-direct WS transport is Story 12.8's scope
  and may need to revise the exact endpoint(s) called here. Documented inline.
- **`assertAmbientSurface`** rejects `surface === 'onboarding'` (defensive):
  the contract enum includes 'onboarding' (so the legacy onboarding voice
  path can use the same `LumiSurface` type) but ambient voice sessions for
  onboarding must continue to flow through the existing `POST /v1/voice/sessions`
  route to preserve the R2-D1/R2-D2 invariants from Story 2.7.
- **Modality on ambient threads** (Task 3): Story 12.4 left `threads.modality`
  NOT NULL. Ambient threads are written with `modality = 'voice'`; the new
  `threads_one_active_per_household_type` partial index is modality-agnostic,
  so this value is stored but not enforced — voice and text turns share the
  same thread row. A future story can relax `NOT NULL` and backfill these
  rows to NULL.
- **Race handling on lazy thread creation**: `LumiRepository.createAmbientThread`
  catches the unique-violation that the new `threads_one_active_per_household_type`
  partial index produces under concurrent first-call requests, then re-reads
  the winner's row so the loser observes a stable thread. Mirrors the
  established `appendTurnNext` pattern in `thread.repository.ts`.
- **403 collapses both "not found" and "not owned"** for DELETE — same
  existence-leak guard used in Story 12.3's `getThreadTurns`.
- **Audit events**: POST writes a `voice.session_started` audit row;
  DELETE writes `voice.session_ended`. Both event types are already in
  `AUDIT_EVENT_TYPES` (no audit-types migration needed).
- **Encapsulated routes plugin (kept from Story 12.3)**: extending the same
  `lumiRoutes` plugin without `fp()` so the `{ prefix: '/v1/lumi' }` keeps
  applying to all three routes (GET turns, POST sessions, DELETE sessions).

### File List

**New files:**
- `supabase/migrations/20260620000100_add_tier_to_households.sql`
- `apps/api/src/modules/lumi/lumi.service.ts`

**Modified files:**
- `apps/api/src/modules/lumi/lumi.repository.ts` — added `getHouseholdTier`,
  `findActiveAmbientThread`, `createAmbientThread` (with unique-violation race
  fallback), `createTalkSession`, `findTalkSession`, `closeTalkSession`.
- `apps/api/src/modules/lumi/lumi.routes.ts` — added `POST /voice/sessions`
  and `DELETE /voice/sessions/:id`; wired `LumiService` into the plugin
  closure.
- `apps/api/src/modules/lumi/lumi.routes.test.ts` — extended the test rig to
  mock households + voice_sessions tables and Redis; added 12 new tests
  covering POST happy path, lazy/reuse thread, tier gate, onboarding
  rejection, ElevenLabs STT/TTS failure, DELETE happy path, cross-user
  DELETE, non-existent DELETE, and unauthenticated POST+DELETE.

### Change Log

| Date       | Change                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-30 | Implemented Story 12.5 — talk session lifecycle (POST/DELETE `/v1/lumi/voice/sessions`). Added Premium tier gate (with new `households.tier` migration), lazy ambient thread creation, ElevenLabs credential issuance, atomic-on-failure persistence, Redis TTL sentinel. 12 new route tests. Status → review. |
| 2026-05-01 | Code review complete (3-layer parallel review). 2 decision-needed, 5 patch, 3 defer, 9 dismissed. |

### Review Findings

- [x] [Review][Decision] POST status code 201 vs spec AC#3 "200" — resolved: keep 201 (RESTfully correct for resource creation); spec text was stale. No code change needed.
- [x] [Review][Decision] `assertAmbientSurface` throws `ForbiddenError` (403) for 'onboarding' surface — resolved: changed to `ValidationError` (400) in `lumi.service.ts:35-38`. Wrong-endpoint is a client mistake, not an authz failure.

- [x] [Review][Patch] `primary_parent` role not enforced on POST — fixed: added `userRole` to `CreateTalkSessionInput`; service throws 403 if `role !== 'primary_parent'`; route passes `request.user.role`; test added for secondary_caregiver → 403. [apps/api/src/modules/lumi/lumi.service.ts:64-66 / lumi.routes.ts:59]
- [x] [Review][Patch] `void reply.status(204).send()` in DELETE handler — fixed: changed to `return reply.status(204).send()`. [apps/api/src/modules/lumi/lumi.routes.ts:97]
- [x] [Review][Patch] `getHouseholdTier` null gives misleading 403 — fixed: explicit `if (tier === null) throw new ForbiddenError('Household not found')` before the premium check. [apps/api/src/modules/lumi/lumi.service.ts:68-70]
- [x] [Review][Patch] `createAmbientThread` race fallback re-throws raw Postgres UniqueViolation — fixed: rethrows descriptive `Error` with household/type context instead of the raw DB error. [apps/api/src/modules/lumi/lumi.repository.ts:105-108]
- [x] [Review][Patch] Cross-household DELETE test missing — fixed: added test `cross-household DELETE → 403` with `household_id = OTHER_HOUSEHOLD_ID`. [apps/api/src/modules/lumi/lumi.routes.test.ts]

- [x] [Review][Defer] Dead `.slice(0, TURNS_LIMIT)` after `.limit(TURNS_LIMIT)` in `getThreadTurns` — DB query already limits to 20 rows; the JS `.slice()` is redundant dead code. Pre-existing from Story 12-3, not this story's scope. [apps/api/src/modules/lumi/lumi.repository.ts:53] — deferred, pre-existing
- [x] [Review][Defer] auditContext not written on service error paths — if `createTalkSession` or `closeTalkSession` throws, the `request.auditContext` is never set and no audit event fires. Pre-existing architectural pattern across all routes; requires a cross-cutting design decision. [apps/api/src/modules/lumi/lumi.routes.ts:62-71, 90-96] — deferred, pre-existing
- [x] [Review][Defer] `closeTalkSession` UPDATE has no row-count check — a concurrent close between `findTalkSession` and the UPDATE results in a silent no-op (zero rows affected). Benign by design: service checks `status === 'active'` before calling and the UPDATE's own `.eq('status', 'active')` guard makes the race outcome safe idempotent. [apps/api/src/modules/lumi/lumi.repository.ts:138-146] — deferred, pre-existing


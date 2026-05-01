# Story 12.3: Thread turns endpoint — GET /v1/lumi/threads/:threadId/turns

Status: done

## Story

As a developer,
I want an authenticated endpoint to retrieve persisted turns for a surface thread,
So that the Lumi panel can hydrate from the server on mount, reconnect, or manual refresh.

## Architecture Overview

### Role in the Architecture

This endpoint is the **resync fallback** for the Lumi panel — not the primary update path during active sessions. Per ADR-002 Decision 4: during an active voice session, transcript and Lumi response text are appended directly to the panel via the active WebSocket channels. The panel calls this endpoint:

- On panel open (first mount, or re-open after close)
- On WebSocket reconnect after a dropped connection
- On explicit user refresh

### Route

| Method | Path | Auth | Guard |
|---|---|---|---|
| GET | `/v1/lumi/threads/:threadId/turns` | JWT (any adult role) | Thread must belong to caller's household |

### Response

Returns the last 20 turns from the thread ordered ascending by `server_seq`. The frontend renders them top-to-bottom as a conversation history.

```typescript
// Response shape — matches LumiThreadTurnsResponseSchema from lumi.ts (Story 12.1)
{
  thread_id: string,  // uuid
  turns: Turn[],      // last 20, ascending server_seq
}
```

### Module Location

New lumi module at `apps/api/src/modules/lumi/`. This story creates the initial module scaffold with a single route. Future stories (12.10, 12.11) will add more routes to this module.

```
apps/api/src/modules/lumi/
  lumi.routes.ts       ← new — GET /v1/lumi/threads/:threadId/turns
  lumi.repository.ts   ← new — DB query for thread turns
```

### Repository Query

Query `thread_turns` joined against `threads` to verify household ownership. Use Supabase client pattern matching the existing `voice.repository.ts`.

```typescript
// Fetch last 20 turns for a thread, scoped to household
async function getThreadTurns(threadId: string, householdId: string): Promise<Turn[]> {
  // 1. Verify the thread belongs to the household
  const thread = await supabase
    .from('threads')
    .select('id, household_id')
    .eq('id', threadId)
    .single();

  if (!thread || thread.household_id !== householdId) throw ForbiddenError;

  // 2. Fetch last 20 turns ordered by server_seq ascending
  const turns = await supabase
    .from('thread_turns')
    .select('*')
    .eq('thread_id', threadId)
    .order('server_seq', { ascending: true })
    .limit(20);

  return turns.map(mapRowToTurn);
}
```

Note: `.limit(20)` with `.order('server_seq', { ascending: true })` returns the OLDEST 20, not the NEWEST 20. To get the LAST 20 (most recent), use descending order + limit + reverse: `.order('server_seq', { ascending: false }).limit(20)`, then reverse the result array before returning.

### Wire into app.ts

Register the lumi routes plugin in `apps/api/src/app.ts` under the `/v1/lumi` prefix, matching the existing modules pattern.

## Acceptance Criteria

1. **Given** Story 12.1 is complete and the `thread_turns` table exists, **When** `GET /v1/lumi/threads/:threadId/turns` is called with a valid JWT for a household that owns the thread, **Then** response is `200` with body matching `LumiThreadTurnsResponseSchema`: `{ thread_id, turns: Turn[] }` where turns are the last 20 ordered by `server_seq` ascending.

2. **Given** the thread belongs to household A, **When** the request JWT is for household B, **Then** response is `403 /errors/forbidden`.

3. **Given** the `threadId` does not exist in the `threads` table, **When** `GET /v1/lumi/threads/:threadId/turns` is called, **Then** response is `403 /errors/forbidden` (do not leak thread existence to unauthorized callers).

4. **Given** a thread with fewer than 20 turns, **When** the endpoint is called, **Then** all turns are returned (no padding or error).

5. **Given** a thread with more than 20 turns, **When** the endpoint is called, **Then** only the 20 most recent turns are returned, ordered ascending by `server_seq`.

6. **Given** the route is registered, **When** `GET /v1/lumi/threads/:threadId/turns` is called without a JWT, **Then** response is `401 /errors/unauthorized`.

7. **Given** the lumi module is wired, **When** `pnpm --filter @hivekitchen/api test` runs, **Then** all tests pass including new route tests for this endpoint.

## Tasks / Subtasks

- [x] Task 1 — Create `apps/api/src/modules/lumi/lumi.repository.ts` (AC: #1, #2, #3, #4, #5)
  - [x] Scaffold lumi module directory: `apps/api/src/modules/lumi/`
  - [x] Create `LumiRepository` class following the pattern in `voice.repository.ts` (extends `BaseRepository`)
  - [x] Add `getThreadTurns(threadId: string, householdId: string): Promise<Turn[]>` method
  - [x] Verify thread household ownership before fetching turns; throw `ForbiddenError` for both "thread not found" and "thread belongs to another household" (collapse to a single 403 to avoid existence leak)
  - [x] Fetch last 20 turns: `.order('server_seq', { ascending: false }).limit(20)`, reverse result for ascending display order
  - [x] Map DB rows to `Turn` type (import from `@hivekitchen/types`); reuse `TURN_COLUMNS` and `TurnRow` from the existing `thread.repository.ts`

- [x] Task 2 — Create `apps/api/src/modules/lumi/lumi.routes.ts` (AC: #1, #2, #3, #6)
  - [x] Create Fastify plugin for the lumi module (encapsulated — **not** wrapped in `fp()` so the registration `prefix` actually applies; voice routes use `fp()` because they declare absolute paths and don't rely on a registered prefix)
  - [x] Register `GET /threads/:threadId/turns` route
  - [x] `authenticate` prehandler: applied globally via the existing `authenticateHook` `onRequest` hook in `app.ts`; route is not in `SKIP_EXACT`/`SKIP_PREFIXES`, so the global hook enforces 401 already — no per-route prehandler needed
  - [x] Extract `household_id` from `request.user` JWT payload
  - [x] Call `lumiRepository.getThreadTurns(threadId, householdId)`
  - [x] Return `200 { thread_id: threadId, turns }` on success
  - [x] Propagate `ForbiddenError` as `403` (handled by existing error plugin)
  - [x] Validate response with `LumiThreadTurnsResponseSchema` (import from `@hivekitchen/contracts`)

- [x] Task 3 — Register lumi routes in `apps/api/src/app.ts` (AC: #1, #6)
  - [x] Import and register the lumi routes plugin with prefix `/v1/lumi`

- [x] Task 4 — Add route tests `apps/api/src/modules/lumi/lumi.routes.test.ts` (AC: #1–#7)
  - [x] Mock Supabase client following the pattern in `voice.routes.test.ts`
  - [x] Test: `GET /v1/lumi/threads/:threadId/turns` with valid JWT + owned thread → 200 with turns
  - [x] Test: turns returned in ascending `server_seq` order
  - [x] Test: cross-household thread access → 403
  - [x] Test: non-existent thread → 403
  - [x] Test: thread with fewer than 20 turns → all turns returned
  - [x] Test: thread with more than 20 turns → only 20 most recent
  - [x] Test: unauthenticated request → 401

- [x] Task 5 — Typecheck and test (AC: #7)
  - [x] `pnpm typecheck` — only pre-existing `voice.service.test.ts` errors remain; no errors introduced by Story 12.3
  - [x] `pnpm --filter @hivekitchen/api test` — 221 pass (7 new lumi tests added; only pre-existing `memory.service.test.ts` partial-seeding failure remains, unrelated to 12.3)

## Dev Notes

### Module scaffold pattern
Follow the existing module structure in `apps/api/src/modules/voice/`. Each module has a `.routes.ts` and `.repository.ts`. Services are added when needed (Story 12.9 will add `lumi.service.ts`).

### Thread ownership check — 403 not 404
Return `403` for both "thread not found" and "thread belongs to another household." Do not differentiate — returning `404` for a non-existent thread leaks thread existence information to unauthorized callers. Collapse both cases to `ForbiddenError`.

### server_seq type
`server_seq` is a bigint in the DB. Supabase returns it as a string. The `Turn` contract accepts `string`, `bigint`, or `number` for `server_seq` via the `SequenceId` union. Map the raw string directly — no conversion needed. [Source: packages/contracts/src/thread.ts — SequenceId definition]

### Fetching last 20 — descending then reverse
To get the 20 most recent turns in ascending display order:
1. Query with `.order('server_seq', { ascending: false }).limit(20)` — returns newest 20
2. Reverse the array before returning — gives ascending order for display

### authenticate hook
Use the existing `authenticate` prehandler at `apps/api/src/middleware/authenticate.hook.ts`. Apply as `preHandler: [authenticate]` on the route. [Source: apps/api/src/modules/voice/voice.routes.ts — same pattern]

### JSON body parsing for turns
The `body` column in `thread_turns` is a JSONB column. Supabase returns it pre-parsed as a JS object. Map it directly to `TurnBody` — no `JSON.parse()` needed (same pattern as `bag_composition` in children repository).

### Route registration prefix
The lumi module routes are registered at `/v1/lumi` in `app.ts`. The route handler registers `GET /threads/:threadId/turns` — the full path becomes `GET /v1/lumi/threads/:threadId/turns`.

### Project Structure Notes

- New directory: `apps/api/src/modules/lumi/`
- New file: `apps/api/src/modules/lumi/lumi.repository.ts`
- New file: `apps/api/src/modules/lumi/lumi.routes.ts`
- New file: `apps/api/src/modules/lumi/lumi.routes.test.ts`
- Modified: `apps/api/src/app.ts` — register lumi routes plugin

### References

- [Source: _bmad-output/planning-artifacts/adr-ambient-lumi.md#Decision 4 — Chat sync — zero polling]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 12.3]
- [Source: apps/api/src/modules/voice/voice.repository.ts — repository pattern]
- [Source: apps/api/src/modules/voice/voice.routes.ts — route registration + authenticate hook]
- [Source: apps/api/src/modules/voice/voice.routes.test.ts — test mock pattern]
- [Source: supabase/migrations/20260504010000_create_thread_turns.sql — thread_turns schema]
- [Source: packages/contracts/src/thread.ts — Turn schema, SequenceId type]
- [Source: packages/contracts/src/lumi.ts (Story 12.1) — LumiThreadTurnsResponseSchema]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- API typecheck (`pnpm --filter @hivekitchen/api typecheck`): only failures are
  the pre-existing `RequestInfo` errors in `src/modules/voice/voice.service.test.ts`
  (file untouched by 12.3). All Story 12.3 files typecheck clean.
- API tests (`pnpm --filter @hivekitchen/api test`): **221 pass** (was 214 before
  this story; +7 new lumi route tests). The single remaining failure is the
  pre-existing `memory.service.test.ts > partial seeding` test from a prior
  uncommitted story — unrelated to 12.3.
- API lint (`pnpm --filter @hivekitchen/api lint`): 0 violations in Story 12.3
  files. Remaining 7 errors are all in pre-existing files (`children.routes.test.ts`,
  `households.repository.ts`, `households.routes.test.ts`, `voice.service.ts`).
- Initial test run revealed 6 of 7 lumi tests returning `404` instead of the expected
  status — root cause: the routes plugin was wrapped in `fp()` (copying the
  voice-routes pattern), which opts the plugin out of encapsulation **including**
  the registration `prefix`. Removed `fp()` so the `{ prefix: '/v1/lumi' }` option
  in `app.ts` actually applies. After the fix, all 7 tests pass.

### Completion Notes List

- **Encapsulation vs. fastify-plugin** (Task 2): the existing voice routes plugin
  uses `fp()` because it declares absolute paths (e.g., `/v1/voice/sessions`) and
  doesn't rely on a registered prefix. The story explicitly requires the lumi
  plugin to be registered under a `/v1/lumi` prefix, so this plugin is left
  encapsulated — no `fp()` wrapper. Documented inline in `lumi.routes.ts`.
- **403 collapses both "not found" and "wrong household"** (Task 1): per the Dev
  Notes requirement to avoid leaking thread existence. The repository's ownership
  check throws a single `ForbiddenError('Thread not accessible')` for both cases.
- **Descending-then-reverse for last 20 ascending** (Task 1): used the standard
  idiom `.order('server_seq', { ascending: false }).limit(20)` and `.slice().reverse()`
  in JS. Documented inline.
- **Response validation via `LumiThreadTurnsResponseSchema`** (Task 2): wired as
  `schema.response[200]`. `Turn.server_seq` is the `SequenceId` union — Supabase
  returns the bigint column as a JS number for values within `Number.MAX_SAFE_INTEGER`,
  which the union accepts via its `z.number().int().nonnegative()` arm without
  triggering the bigint-transform (verified by all 7 tests passing including the
  ordering and >20 cases).
- **Module scaffold**: created `apps/api/src/modules/lumi/`. Story 12.10/12.11
  will add more routes; this is the initial scaffold.
- **No `lumi.service.ts`**: Story 12.9 introduces it. This story keeps the route
  thin (route → repository) per the existing pattern for read-only endpoints.

### File List

**New files:**
- `apps/api/src/modules/lumi/lumi.repository.ts`
- `apps/api/src/modules/lumi/lumi.routes.ts`
- `apps/api/src/modules/lumi/lumi.routes.test.ts`

**Modified files:**
- `apps/api/src/app.ts` — registered `lumiRoutes` with `{ prefix: '/v1/lumi' }`.

### Review Findings

- [x] [Review][Decision] **Story 12-5 code pre-implemented in Story 12-3 files** — `lumi.routes.ts` contains `POST /voice/sessions` and `DELETE /voice/sessions/:id` (Story 12-5 scope). `lumi.repository.ts` contains `getHouseholdTier`, `findActiveAmbientThread`, `createAmbientThread`, `createTalkSession`, `findTalkSession`, `closeTalkSession` (Story 12-5 scope). `lumi.routes.test.ts` includes 12 voice-session tests (Stories 12-5 scope). `lumi.routes.ts` imports `LumiService` (Story 12.9 scope per Dev Notes). Decision: accept pre-implementation and review 12-5/12-9 code in this pass, or revert to 12-3 spec scope?
- [x] [Review][Decision] **`app.ts` contains hook/route registrations from other stories** — `memoryHook` (Story 2-13), `allergyGuardrailHook` (Story 3-1), and `householdsRoutes` (separate households story) are registered alongside `lumiRoutes`. These belong in their respective story reviews. Decision: accept as a bundled app.ts delta or revert to 12-3-only change?
- [x] [Review][Patch] `closeTalkSession` UPDATE has no `status` guard — TOCTOU with concurrent ElevenLabs webhook that writes terminal status; a stale-read service guard passes, then the unscoped UPDATE overwrites `timed_out`/`disconnected` back to `closed` [`lumi.repository.ts:138`]
- [x] [Review][Patch] `closeTalkSession` UPDATE is unscoped — no `household_id` or `user_id` column filter at the DB level; repository method signature carries no ownership context [`lumi.repository.ts:138`]
- [x] [Review][Patch] `createAmbientThread` race-fallback does not verify the winner is still `active` — re-read winner may have been closed between insert failure and the return; caller proceeds with a closed `ThreadRow` and binds a new `voice_session` to it [`lumi.repository.ts:102`]
- [x] [Review][Patch] `POST /voice/sessions` responds `200` for resource creation — REST semantics require `201 Created` [`lumi.routes.ts:47`]
- [x] [Review][Patch] `.slice()` in `getThreadTurns` is a no-op (no args = full copy) — if DB `.limit(20)` is ever not honoured the response exceeds 20 turns with no JS-layer cap; fix: `.slice(0, TURNS_LIMIT).reverse()` [`lumi.repository.ts:43`]
- [x] [Review][Patch] `threads` table mock does not branch on query shape — ownership check and `findActiveAmbientThread` both use `.select().eq()` but resolve to the same mock leaf; tests do not faithfully represent distinct query paths [`lumi.routes.test.ts:117`]
- [x] [Review][Patch] AC#5 test provides exactly 20 mocked rows (not 21+) — the `.limit(20)` cap is asserted by trust, not observation; test cannot distinguish a capped query from a pass-through [`lumi.routes.test.ts:440`]
- [x] [Review][Defer] Two-query TOCTOU in `getThreadTurns` — no transaction between ownership check and turns fetch; service-role bypasses RLS so low probability in practice [`lumi.repository.ts:28`] — deferred, low production risk under service-role pattern
- [x] [Review][Defer] `findActiveAmbientThread` omits `modality` filter diverging from `thread.repository.ts` — intentional per ADR-002 (ambient threads don't discriminate on modality); `assertAmbientSurface` guard prevents onboarding surface from reaching this path [`lumi.repository.ts:68`] — deferred, intentional design per ADR
- [x] [Review][Defer] Duplicate `voice.session_ended` audit events when DELETE called on already-closed session — service skips repository write but route sets `auditContext` unconditionally; Story 12-5 scope [`lumi.routes.ts:90`] — deferred to Story 12-5 review

### Change Log

| Date       | Change                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| 2026-04-30 | Implemented Story 12.3 — `GET /v1/lumi/threads/:threadId/turns`. New lumi module scaffold with repository + routes + 7 route tests. Status → review. |
| 2026-04-30 | Code review complete — 2 decisions resolved, 7 patches applied, 3 deferred, 4 dismissed. Status → done. |


# Story 12.3: Thread turns endpoint — GET /v1/lumi/threads/:threadId/turns

Status: ready-for-dev

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

- [ ] Task 1 — Create `apps/api/src/modules/lumi/lumi.repository.ts` (AC: #1, #2, #3, #4, #5)
  - [ ] Scaffold lumi module directory: `apps/api/src/modules/lumi/`
  - [ ] Create `LumiRepository` class following the pattern in `voice.repository.ts`
  - [ ] Add `getThreadTurns(threadId: string, householdId: string): Promise<Turn[]>` method
  - [ ] Verify thread household ownership before fetching turns; return empty array or throw ForbiddenError if mismatch or not found
  - [ ] Fetch last 20 turns: `.order('server_seq', { ascending: false }).limit(20)`, reverse result for ascending display order
  - [ ] Map DB rows to `Turn` type (import from `@hivekitchen/types`)

- [ ] Task 2 — Create `apps/api/src/modules/lumi/lumi.routes.ts` (AC: #1, #2, #3, #6)
  - [ ] Create Fastify plugin for the lumi module
  - [ ] Register `GET /threads/:threadId/turns` route
  - [ ] Apply `authenticate` prehandler (existing hook — rejects 401 if no valid JWT)
  - [ ] Extract `household_id` from `request.user` JWT payload
  - [ ] Call `lumiRepository.getThreadTurns(threadId, householdId)`
  - [ ] Return `200 { thread_id: threadId, turns }` on success
  - [ ] Propagate `ForbiddenError` as `403` (handled by existing error plugin)
  - [ ] Validate response with `LumiThreadTurnsResponseSchema` (import from `@hivekitchen/contracts`)

- [ ] Task 3 — Register lumi routes in `apps/api/src/app.ts` (AC: #1, #6)
  - [ ] Import and register the lumi routes plugin with prefix `/v1/lumi`
  - [ ] Follow the existing module registration pattern (see how `voice.routes.ts` is registered)

- [ ] Task 4 — Add route tests `apps/api/src/modules/lumi/lumi.routes.test.ts` (AC: #1–#7)
  - [ ] Mock Supabase client following the pattern in `voice.routes.test.ts`
  - [ ] Test: `GET /v1/lumi/threads/:threadId/turns` with valid JWT + owned thread → 200 with turns
  - [ ] Test: turns returned in ascending `server_seq` order
  - [ ] Test: cross-household thread access → 403
  - [ ] Test: non-existent thread → 403
  - [ ] Test: thread with fewer than 20 turns → all turns returned
  - [ ] Test: thread with more than 20 turns → only 20 most recent
  - [ ] Test: unauthenticated request → 401

- [ ] Task 5 — Typecheck and test (AC: #7)
  - [ ] `pnpm typecheck` — zero errors
  - [ ] `pnpm --filter @hivekitchen/api test` — all pass

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

_to be filled on implementation_

### Debug Log References

### Completion Notes List

### File List

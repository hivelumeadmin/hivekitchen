# Story 5-S4: Thread Sequencing + SSE Resync

Status: done

<!-- folds: 5.1 (server_seq + resync), 5.17 (anomaly beacon) -->
<!-- cited PRD: FR28 (full), Foundation Gate 1 -->

## Story

As a Parent with multiple tabs open,
I want missed coordination thread turns to be automatically recovered when my SSE connection drops and reconnects,
so that both tabs always show a consistent, gap-free view of packer assignments and coordination events.

## Acceptance Criteria

1. **Given** two tabs open on `/app`, **When** one tab's SSE socket is dropped (e.g. via DevTools) and the other tab assigns a packer (writing `thread_turn` seq=2), **Then** after the dropped tab reconnects and receives the next `thread.turn` event (seq=3), it detects the sequence gap and fires `GET /v1/lumi/threads/:id/turns?from_seq=2`.

2. **Given** a `thread.turn` SSE event arrives with `receivedSeq > prevSeq + 1`, **When** gap recovery fires, **Then** `hkFetch` calls `GET /v1/lumi/threads/:id/turns?from_seq={prevSeq+1}` using the auth store's access token.

3. **Given** `GET /v1/lumi/threads/:threadId/turns?from_seq=N`, **When** processed, **Then** only turns with `server_seq >= N` are returned, in ascending `server_seq` order (no TURNS_LIMIT cap applied when `from_seq` is present).

4. **Given** the missed turns are fetched, **When** merged into the React Query cache for `QueryKeys.thread(threadId)`, **Then** the cache contains all turns in correct `server_seq` order with no duplicates.

5. **Given** `PATCH /v1/households/:id/days/:date/packer` successfully writes a coordination thread turn, **When** the turn is committed to `thread_turns`, **Then** a `thread.turn` SSE event is emitted to all open household tabs carrying `{ type: 'thread.turn', thread_id, turn: { id, thread_id, server_seq: String(turn.server_seq), created_at, role, body, modality } }`.

6. **Given** a `thread.turn` SSE event is received without a gap (`receivedSeq === prevSeq + 1n` or no prior seq), **When** handled, **Then** the turn is appended to the cache normally with no extra fetch — no regression on the non-gap path.

7. **Given** `GET /v1/lumi/threads/:threadId/turns?from_seq=N` where `:threadId` belongs to a different household, **When** processed, **Then** the API returns `403 Forbidden` (ownership check already in `getThreadTurns` — no new code needed).

8. **Given** `GET /v1/lumi/threads/:threadId/turns` with no `from_seq`, **When** processed, **Then** behavior is unchanged — returns last 20 turns in ascending order (backward-compat; the existing LumiPanel and 12-S8/S9 flows must not regress).

---

## Tasks / Subtasks

### Task 1 — API: Emit `thread.turn` SSE from PATCH /packer (AC: #5, #6)

- [x] 1.1 In `apps/api/src/modules/households/households.routes.ts`, inside the best-effort `try` block for the coordination thread write, capture the return value of `appendTurnNext` and emit a `thread.turn` SSE event:

  ```ts
  // Inside the existing try-catch around the thread write:
  try {
    let thread = await threadRepository.findActiveThreadByHousehold(
      householdId, 'coordination', 'text',
    );
    if (!thread) {
      thread = await threadRepository.createThread(householdId, 'coordination', 'text');
    }
    const turn = await threadRepository.appendTurnNext({
      threadId: thread.id,
      role: 'system',
      body: {
        type: 'system_event',
        event: 'packer.assigned',
        payload: { date, packer_user_id: body.packer_user_id, packer_display_name: packerDisplayName },
      },
      modality: 'text',
    });
    // NEW: emit thread.turn so clients track server_seq for gap detection
    fastify.sseDispatcher.emit(
      householdId,
      'message',
      JSON.stringify({
        type: 'thread.turn',
        thread_id: thread.id,
        turn: {
          id: turn.id,
          thread_id: turn.thread_id,
          server_seq: String(turn.server_seq),  // bigint → string (JSON-safe; SequenceId accepts numeric string)
          created_at: turn.created_at,
          role: turn.role,
          body: turn.body,
          modality: turn.modality,
        },
      }),
    );
  } catch (err) {
    fastify.log.warn({ err }, 'packer: failed to write coordination thread turn');
  }
  ```

  **Why `String(turn.server_seq)`:** PostgreSQL `bigint` comes back as a string from Supabase-js. `JSON.stringify` does not serialize `bigint` natively. The `SequenceId` schema in `packages/contracts/src/thread.ts` accepts a `z.string().regex(/^\d+$/)` branch, so a numeric string round-trips correctly. Always stringify to be safe, even if the runtime value happens to be a JS `number`.

- [x] 1.2 Write tests appended to `apps/api/src/modules/households/households.routes.test.ts`:
  - `PATCH /v1/households/:id/days/:date/packer` (assigning a user) — verifies `sseDispatcher.emit` is called **twice**: once for `packer.assigned` and once for `thread.turn` (check `JSON.parse(calls[1][2]).type === 'thread.turn'`)
  - `PATCH /v1/households/:id/days/:date/packer` (unassign, `null`) — verifies `thread.turn` SSE is NOT emitted when `packer.assigned` SSE is also suppressed (null path: only thread write is attempted; check emit call count)

  **Note:** The current tests mock `threadRepository` with the stub pattern used in 5-S3. Extend the mock to return a `TurnRow`-shaped object from `appendTurnNext` with a deterministic `server_seq: '1'`, `id`, `created_at`, etc.

---

### Task 2 — API: `from_seq` on `GET /v1/lumi/threads/:threadId/turns` (AC: #3, #7, #8)

- [x] 2.1 Add a `ThreadTurnsQuerySchema` to `apps/api/src/modules/lumi/lumi.routes.ts`:

  ```ts
  const ThreadTurnsQuerySchema = z.object({
    from_seq: z.string().regex(/^\d+$/).optional(),
  });
  ```

- [x] 2.2 Update the `GET /threads/:threadId/turns` route handler to extract `from_seq` from the query string and pass it down:

  ```ts
  fastify.get(
    '/threads/:threadId/turns',
    {
      schema: {
        params: ThreadTurnsParamsSchema,
        querystring: ThreadTurnsQuerySchema,
        response: { 200: LumiThreadTurnsResponseSchema },
      },
    },
    async (request) => {
      const { threadId } = request.params as z.infer<typeof ThreadTurnsParamsSchema>;
      const query = request.query as z.infer<typeof ThreadTurnsQuerySchema>;
      const fromSeq = query.from_seq !== undefined ? BigInt(query.from_seq) : undefined;
      const turns = await repository.getThreadTurns(threadId, request.user.household_id, fromSeq);
      return { thread_id: threadId, turns };
    },
  );
  ```

- [x] 2.3 Update `LumiRepository.getThreadTurns` in `apps/api/src/modules/lumi/lumi.repository.ts` to accept an optional `fromSeq: bigint`:

  ```ts
  async getThreadTurns(
    threadId: string,
    householdId: string,
    fromSeq?: bigint,
  ): Promise<Turn[]> {
    // Existing ownership check (unchanged):
    const { data: thread, error: threadError } = await this.client
      .from('threads')
      .select('id, household_id')
      .eq('id', threadId)
      .maybeSingle();
    if (threadError) throw threadError;
    if (!thread || (thread as { household_id: string }).household_id !== householdId) {
      throw new ForbiddenError('Thread not accessible');
    }

    if (fromSeq !== undefined) {
      // from_seq path: ascending order, no cap — fetch all turns from that seq onward
      const { data, error } = await this.client
        .from('thread_turns')
        .select(TURN_COLUMNS)
        .eq('thread_id', threadId)
        .gte('server_seq', fromSeq.toString())
        .order('server_seq', { ascending: true });
      if (error) throw error;
      return ((data as TurnRow[] | null) ?? []).map(mapRowToTurn);
    }

    // Default path (unchanged): newest 20 descending, reversed for display
    const { data, error } = await this.client
      .from('thread_turns')
      .select(TURN_COLUMNS)
      .eq('thread_id', threadId)
      .order('server_seq', { ascending: false })
      .limit(TURNS_LIMIT);
    if (error) throw error;
    const rows = ((data as TurnRow[] | null) ?? []).slice(0, TURNS_LIMIT).reverse();
    return rows.map(mapRowToTurn);
  }
  ```

  **Why `.gte('server_seq', fromSeq.toString())`:** Supabase-js `.gte()` compares the stored `bigint` column. Passing the value as a string works because PostgREST coerces it. If you pass a JS `bigint` directly, Supabase-js may throw a serialization error — use `.toString()`.

- [x] 2.4 Write tests appended to `apps/api/src/modules/lumi/lumi.routes.test.ts` (or `lumi.repository.test.ts` for the repo unit tests):
  - `GET /v1/lumi/threads/:id/turns` — no `from_seq` → returns last 20 descending-reversed (existing test, verify it still passes with the updated signature)
  - `GET /v1/lumi/threads/:id/turns?from_seq=2` — returns only turns with seq ≥ 2, in ascending order
  - `GET /v1/lumi/threads/:id/turns?from_seq=99` — returns empty array when no turns exist with that seq
  - `GET /v1/lumi/threads/:id/turns?from_seq=abc` — returns 400 (Zod regex rejects non-numeric)
  - `GET /v1/lumi/threads/:id/turns?from_seq=1` — cross-household 403 (ownership check covers this)
  - Repository unit test: `getThreadTurns(threadId, householdId, 2n)` calls `.gte('server_seq', '2')` and returns ascending rows

---

### Task 3 — Web: Gap recovery in SSE bridge (AC: #1, #2, #4)

- [x] 3.1 Add an import of `hkFetch` and `LumiThreadTurnsResponseSchema` at the top of `apps/web/src/lib/realtime/sse.ts`:

  ```ts
  import { InvalidationEvent, LumiThreadTurnsResponseSchema } from '@hivekitchen/contracts';
  import { hkFetch } from '@/lib/fetch.js';
  ```

  **CRITICAL — `hkFetch` double-encoding trap (repeated from 5-S2 and 5-S3):**  
  `hkFetch` in `apps/web/src/lib/fetch.ts` auto-JSON-stringifies `init.body`. Always pass raw objects, not `JSON.stringify(...)`. For the GET request in this story, there is no body — just a query parameter on the URL — so the trap does not apply here.

- [x] 3.2 Add a `fetchAndMergeMissedTurns` helper inside the `createSseBridge` factory (above `handleMessage`):

  ```ts
  async function fetchAndMergeMissedTurns(
    threadId: string,
    fromSeq: bigint,
  ): Promise<void> {
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL ?? '';
      const response = await hkFetch<z.infer<typeof LumiThreadTurnsResponseSchema>>(
        `/v1/lumi/threads/${threadId}/turns?from_seq=${fromSeq.toString()}`,
        { method: 'GET' },
        LumiThreadTurnsResponseSchema,
      );
      if (!response.turns.length) return;
      queryClient.setQueryData(
        QueryKeys.thread(threadId),
        (old: unknown) => {
          const existing = Array.isArray(old) ? old : [];
          // Deduplicate by id; prefer fetched turns (they may have fresher data)
          const existingIds = new Set(existing.map((t: { id: string }) => t.id));
          const fresh = response.turns.filter((t) => !existingIds.has(t.id));
          // Merge and sort by server_seq ascending (bigint-safe string compare)
          return [...existing, ...fresh].sort((a, b) => {
            const sa = BigInt(a.server_seq);
            const sb = BigInt(b.server_seq);
            return sa < sb ? -1 : sa > sb ? 1 : 0;
          });
        },
      );
    } catch {
      // Best-effort — gap recovery failure is non-fatal; the user can reload.
      if (import.meta.env.DEV) {
        console.warn('[sse] gap recovery fetch failed for thread', threadId, 'from_seq', fromSeq.toString());
      }
    }
  }
  ```

  **Note on `hkFetch` signature:** Check `apps/web/src/lib/fetch.ts` for the actual signature. The function accepts `(url, init?, schema?)`. Pass `LumiThreadTurnsResponseSchema` as the third argument so the response is Zod-parsed before being returned. If the signature differs, adjust accordingly — the key constraint is that the response is validated before merging into the cache.

- [x] 3.3 Modify the `thread.turn` case in `handleMessage` to invoke gap recovery when a gap is detected:

  ```ts
  case 'thread.turn': {
    const threadId = event.thread_id;
    const receivedSeq = BigInt(event.turn.server_seq);
    const prevSeq = threadSeqs.get(threadId);

    if (prevSeq !== undefined && receivedSeq > prevSeq + 1n) {
      // Gap detected — report beacon stub (5-S18 will wire the real POST).
      reportThreadIntegrityAnomaly({
        thread_id: threadId,
        expected_seq: prevSeq + 1n,
        received_seq: receivedSeq,
      });
      // Gap recovery: fetch missed turns from prevSeq+1 onward (includes current turn).
      // Fire-and-forget — the merge is idempotent so the subsequent setQueryData
      // below will be deduplicated when fetchAndMergeMissedTurns resolves.
      void fetchAndMergeMissedTurns(threadId, prevSeq + 1n);
    }

    // Advance cursor only on forward progress.
    if (prevSeq === undefined || receivedSeq > prevSeq) {
      threadSeqs.set(threadId, receivedSeq);
    }

    // Append current turn normally — fetchAndMergeMissedTurns deduplicates by id.
    queryClient.setQueryData(
      QueryKeys.thread(threadId),
      (old: unknown) => {
        if (!Array.isArray(old)) return [event.turn];
        return [...old, event.turn];
      },
    );
    break;
  }
  ```

  **Why fire-and-forget + append current turn immediately:** The current turn is already the correct next event from the server's perspective. Appending it immediately keeps the UI responsive. The `fetchAndMergeMissedTurns` call resolves async and inserts the missing seq=N–M turns; the `sort` inside deduplicates seq=receivedSeq if the fetch also returns it, leaving the cache in correct server_seq order.

- [x] 3.4 Write tests in `apps/web/src/lib/realtime/sse.test.ts`:

  - `thread.turn` — no gap (prevSeq=1n, receivedSeq=2n) → `hkFetch` NOT called; turn appended
  - `thread.turn` — gap detected (prevSeq=1n, receivedSeq=3n) → `hkFetch` called with `/v1/lumi/threads/:id/turns?from_seq=2`; `reportThreadIntegrityAnomaly` called
  - `thread.turn` — first event (no prevSeq) → no gap recovery; turn appended; `threadSeqs` seeded
  - `thread.turn` — gap recovery merges missed turns into cache in seq order before current turn

  **Note on mocking `hkFetch`:** The test file likely already uses `vi.mock('@/lib/fetch.js')` for other tests. Add `hkFetch` to the mock if not already present. If `sse.test.ts` does not yet mock `hkFetch`, introduce the mock following the existing `msw` or `vi.mock` pattern in the file.

---

## Dev Notes

### CRITICAL: `server_seq` is a PostgreSQL `bigint` — always stringify for SSE emission

PostgreSQL `bigint` columns come back from Supabase-js as strings (e.g. `"1"` not `1`). When emitting the `thread.turn` SSE payload, always serialize `server_seq` as `String(turn.server_seq)` to avoid `JSON.stringify` silently dropping a native `bigint`. The `SequenceId` schema in `packages/contracts/src/thread.ts` accepts numeric strings via the `z.string().regex(/^\d+$/).transform(s => BigInt(s))` branch.

### CRITICAL: `TurnRow.server_seq` TypeScript type vs. runtime value

`ThreadRepository.TurnRow` declares `server_seq: number`. At runtime, Supabase-js returns it as a `string` for `bigint` columns. Wrap with `String(...)` unconditionally — this is safe for both `number` and `string` values.

### CRITICAL: `hkFetch` signature in `apps/web/src/lib/fetch.ts`

Read `apps/web/src/lib/fetch.ts` before implementing Task 3.2. The exact overload signature for the schema-parsing path needs to match how it is called. Common pattern from prior stories (e.g. 7-S3 edit-a-sentence):
```ts
// DO NOT use JSON.stringify on the body argument — hkFetch auto-stringifies init.body
body: { key: 'value' }   // ✅
body: JSON.stringify(...)  // ❌ double-encoded
```
For the GET request in this story there is no body, so the trap is irrelevant.

### CRITICAL: `sse.ts` is a factory, not a singleton

`createSseBridge(queryClient)` is called in the app's root provider. The `fetchAndMergeMissedTurns` helper must close over `queryClient` (which is already the case if defined inside the factory). Do not export it or make it module-level — it needs the queryClient reference.

### CRITICAL: `from_seq` Supabase-js `.gte()` value must be a string

When calling Supabase PostgREST `.gte('server_seq', value)` on a `bigint` column, pass the value as a string: `.gte('server_seq', fromSeq.toString())`. Passing a `bigint` directly will cause a Supabase-js serialization error.

### No `thread.resync` server emission in this slice

The `thread.resync` SSE event is server-initiated (e.g. server detects missed turns via `Last-Event-ID`). This slice implements CLIENT-DRIVEN gap recovery only. The `thread.resync` handler already in `sse.ts` is unchanged — it handles hypothetical future server-push resyncs. The comment "Story 5.1 will plumb from_seq into the loader" was written before renumbering; it refers to this slice.

### The packer PATCH handler `appendTurnNext` is already best-effort

The existing try-catch around the thread write (from 5-S3) wraps the `appendTurnNext` call. Task 1.1 simply captures the return value of that call and emits the SSE inside the same try-catch. If `appendTurnNext` fails, the catch logs a warning and the SSE is NOT emitted — which is the correct behavior (no thread turn means no sequence to track).

### `thread.turn` SSE is a NEW emission alongside `packer.assigned` — not replacing it

The `packer.assigned` event (emitted in Step C of the PATCH handler) invalidates `QueryKeys.packers(householdId)` for the brief canvas. The `thread.turn` event (Task 1.1, emitted in Step D's try-catch) seeds the sequence tracker in `sse.ts`. Both must be emitted on a successful packer assignment. They serve different purposes and must coexist.

### Null-assignment path: `thread.turn` still emitted (if thread write succeeds)

When `packer_user_id: null`, Step C (packer.assigned SSE) is suppressed per the contract constraint. However, the thread write (Step D) is still attempted — clearing an assignment IS a coordination event worth recording. If the thread write succeeds, Task 1.1's `thread.turn` emission fires normally. This is intentional (matches 5-S3 D6 deferred reasoning: "arguably correct for audit completeness").

### `fetchAndMergeMissedTurns` is fire-and-forget — verify idempotency

The current turn is appended immediately by `queryClient.setQueryData` at the end of the `thread.turn` handler. `fetchAndMergeMissedTurns` resolves async and re-merges all turns starting from the gap. The `sort` by `server_seq` produces a deterministic result regardless of insertion order. The dedup by `id` prevents the current turn from appearing twice if it is also returned by the `from_seq` fetch (which it will be, since `from_seq = prevSeq+1 ≤ receivedSeq` and the DB has the current turn).

### Existing `thread.resync` SSE handler — no changes needed

`sse.ts` already handles `thread.resync`:
```ts
case 'thread.resync':
  threadSeqs.delete(event.thread_id);
  void queryClient.invalidateQueries({ queryKey: QueryKeys.thread(event.thread_id) });
  break;
```
This is a coarser "invalidate everything" fallback for server-initiated resyncs. It remains unchanged. This slice adds the fine-grained client-detected path.

### Source file map

| What | Where |
|------|-------|
| Packer PATCH handler (ADD thread.turn emission) | `apps/api/src/modules/households/households.routes.ts` |
| Thread repository `appendTurnNext` return type reference | `apps/api/src/modules/threads/thread.repository.ts` |
| SSE dispatcher (REUSE) | `apps/api/src/plugins/sse-dispatcher.plugin.ts` |
| `thread.turn` SSE event contract (REUSE) | `packages/contracts/src/events.ts` line: `z.object({ type: z.literal('thread.turn'), ... })` |
| `LumiRepository.getThreadTurns` (MODIFY: add `fromSeq?`) | `apps/api/src/modules/lumi/lumi.repository.ts` |
| Lumi routes (MODIFY: add querystring schema, pass fromSeq) | `apps/api/src/modules/lumi/lumi.routes.ts` |
| `LumiThreadTurnsResponseSchema` (REUSE) | `packages/contracts/src/lumi.ts` |
| SSE bridge (MODIFY: gap recovery) | `apps/web/src/lib/realtime/sse.ts` |
| Thread integrity stub (UNCHANGED) | `apps/web/src/lib/realtime/thread-integrity.ts` |
| `hkFetch` (REUSE — read signature first) | `apps/web/src/lib/fetch.ts` |
| Query keys (NO CHANGE needed) | `apps/web/src/lib/realtime/query-keys.ts` |

### Test baselines (post 5-S3 done, 5 review patches applied)

- **API:** ~1680 pass / 20 fail — the 20 pre-existing failures are auth×7 / children.repository×3 / extra-library×3 / lunch-link-dev / onboarding.tools / audit-parity-drift / catalog-seed / households-memory-200-case / plan-adjustment / memory-partial-seeding — none in the lumi or households domain
- **Web:** ~517 pass / 0 fail
- **Contracts:** 693 pass / 4 fail (cultural + heart-notes baseline)

Expected additions: +2 API household route tests, +4 API lumi route/repo tests, +4 web sse tests = ~10 new tests.

### No new migrations, no new contracts, no new external dependencies

This slice is purely wiring:
- API: one new query param on an existing endpoint, one new SSE emission in an existing handler
- Web: one helper function added to the existing SSE bridge factory, one import added

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context)

### Debug Log References

_None_

### Completion Notes List

All 3 tasks / 11 subtasks complete; all 8 ACs satisfied. Purely wiring — no migration, no contract change, no new dependency.

**What shipped**
- **Task 1 (API):** `PATCH /v1/households/:id/days/:date/packer` now captures the `appendTurnNext` return and emits a second SSE — `thread.turn` carrying `{ thread_id, turn: { id, thread_id, server_seq: String(...), created_at, role, body, modality } }` — inside the existing best-effort try-catch (AC #5, #6). `server_seq` is unconditionally `String(...)` (bigint→numeric string; `JSON.stringify` drops native bigint; `SequenceId` accepts the numeric-string branch).
- **Task 2 (API):** `GET /v1/lumi/threads/:threadId/turns` gained an optional `from_seq` querystring (`ThreadTurnsQuerySchema`, numeric-string regex). When present, `LumiRepository.getThreadTurns(threadId, householdId, fromSeq?)` runs an ascending, uncapped `.gte('server_seq', fromSeq.toString())` scan; absent, behavior is byte-for-byte unchanged (newest-20-desc-reversed). Ownership 403 check is shared by both paths (AC #3, #7, #8). `.gte` is passed `fromSeq.toString()` (supabase-js cannot serialize a JS bigint into a PostgREST value).
- **Task 3 (Web):** Added `fetchAndMergeMissedTurns` inside the `createSseBridge` factory (closes over `queryClient`). On a forward gap in the `thread.turn` handler it fires `GET …?from_seq={prevSeq+1}` fire-and-forget, Zod-parses the response, and merges into `QueryKeys.thread(threadId)` deduped-by-id and sorted ascending by `server_seq` (bigint-safe). The current turn is still appended synchronously; the merge dedups it (AC #1, #2, #4).

**Spec ↔ codebase reconciliations (deviations from the story's literal snippets)**
1. **`hkFetch` has NO schema parameter.** The story's Task 3.2 snippet calls `hkFetch(url, init, schema)`, but the actual signature in `apps/web/src/lib/fetch.ts` is `hkFetch<T>(path, init)` (two args). Implemented as `const raw = await hkFetch<unknown>(...)` then `LumiThreadTurnsResponseSchema.parse(raw)` — response is still Zod-validated before the cache merge, which is the story's stated key constraint. Also dropped the snippet's unused `apiBase` line: `hkFetch` already prepends `VITE_API_BASE_URL`, so passing a path is correct (prepending it again would double the base).
2. **Anomaly report kept broad; only the gap-recovery fetch is narrowed.** The story's Task 3.3 snippet changes the anomaly condition to `receivedSeq > prevSeq + 1n`, which would silently regress two existing 5-S1 integrity tests that assert `reportThreadIntegrityAnomaly` fires on duplicates and out-of-order events. Implemented the surgical superset: keep the existing `receivedSeq !== prevSeq + 1n` anomaly report (preserves all 5 existing integrity tests) and gate ONLY the new `fetchAndMergeMissedTurns` call on the forward-gap branch `> prevSeq + 1n` (duplicates/out-of-order have nothing to fetch). Satisfies AC #1/#2 without regression.
3. **Null-packer path emits `thread.turn` (resolved a contradiction inside the story).** Task 1.2's bullet says the unassign path should emit NO `thread.turn`, but the Task 1.1 code places the emit unconditionally after `appendTurnNext` (which runs on both assign and clear), and the "Null-assignment path" Dev Note explicitly says the emit "fires normally … This is intentional." Implemented per the code + the detailed Dev Note: clearing an assignment still writes a coordination turn, so `thread.turn` still emits (only `packer.assigned` is suppressed on null). Updated the existing 5-S3 test "200 — null clears … emits no SSE" accordingly (now asserts exactly one emit, of type `thread.turn`).
4. **`thread.resync` handler left unchanged** per Dev Notes (client-driven recovery is the new path; the coarse server-push resync handler is untouched).

**Test changes**
- Updated 2 existing 5-S3 packer tests in `households.routes.test.ts`: the assign test now asserts **2** emits (packer.assigned + thread.turn, server_seq `'1'`, role `system`); the null test asserts **1** emit (thread.turn only). Extended the `thread_turns` insert mock to return `thread_id` + `modality` so the emitted payload is realistic.
- Added 4 lumi route tests (`from_seq=2` ascending + `.gte` called with `'2'`; `from_seq=99` empty; `from_seq=abc` → 400; cross-household + from_seq → 403) and 2 repo unit tests (gte-string coercion + ascending rows; cross-household ForbiddenError). Extended the lumi `thread_turns` mock to a thenable chain supporting both the default `.eq().order().limit()` and the from_seq `.eq().gte().order()` shapes.
- Added 4 web sse tests (no-gap → no fetch; gap → fetch `?from_seq=2` + anomaly; first-event seeds cursor; merge produces `[1,2,3]` order via a stateful query-client + `vi.waitFor`). Added `vi.mock('@/lib/fetch.js')`.

**Verification (baselines confirmed via `git stash`)**
- API: 1679 pass / 20 fail — the 20 failures are the exact documented pre-existing baseline (auth / children.repository / extra-library / lunch-link-dev / plan-adjustment / etc.); none in lumi or households domain. +6 new tests, all green.
- Web: 519 pass / 2 fail — the 2 failures (`sse.test.ts` stale `packer.assigned` per-date-key assertion + `PackerAssignmentDialog.test.tsx` missing `initialPackerUserId`) are pre-existing 5-S3 test debt, confirmed failing identically on clean `main` (515/2). +4 new tests, all green.
- Typecheck: API 12=12, web 6=6 — **0 new errors** (all in untouched files: evals/runner, voice, health, child-bag-composition, heart-notes contract baseline).
- Lint: changed lumi/web files clean; `households.routes.test.ts` 39=39 (pre-existing `_col`/`_cols` mock-param debt, untouched).

**Pre-existing issues noticed (NOT fixed — out of 5-S4 scope, flagged for 5-S3 follow-up):** `sse.test.ts > packer.assigned calls invalidateQueries with packer key` asserts the stale per-date `['packer', date]` key, but the 5-S3 handler invalidates `QueryKeys.packers(householdId)`; and `PackerAssignmentDialog.test.tsx` is missing the `initialPackerUserId` prop added in 5-S3 review. Both fail on `main` independently of this slice.

### File List

- `apps/api/src/modules/households/households.routes.ts` (modified — emit `thread.turn` SSE in packer PATCH)
- `apps/api/src/modules/households/households.routes.test.ts` (modified — 2 packer tests + thread_turns mock)
- `apps/api/src/modules/lumi/lumi.routes.ts` (modified — `ThreadTurnsQuerySchema` + pass `fromSeq`)
- `apps/api/src/modules/lumi/lumi.repository.ts` (modified — `getThreadTurns` optional `fromSeq`)
- `apps/api/src/modules/lumi/lumi.routes.test.ts` (modified — 4 from_seq route tests + mock chain)
- `apps/api/src/modules/lumi/lumi.repository.test.ts` (modified — 2 getThreadTurns fromSeq unit tests)
- `apps/web/src/lib/realtime/sse.ts` (modified — `fetchAndMergeMissedTurns` + gap-recovery branch + imports)
- `apps/web/src/lib/realtime/sse.test.ts` (modified — 4 gap-recovery tests + hkFetch mock)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — status → review)

### Review Findings

- [x] [Review][Patch] Duplicate/out-of-order SSE turns unconditionally appended to cache [`apps/web/src/lib/realtime/sse.ts:205-211`] — Fixed: wrapped the final `setQueryData` in `if (prevSeq === undefined || receivedSeq > prevSeq)` to match the cursor-advance guard. Duplicate/out-of-order events now skip the cache write.
- [x] [Review][Patch] Clear-path test doesn't verify `thread.turn` SSE payload shape [`apps/api/src/modules/households/households.routes.test.ts`] — Fixed: added `turn.server_seq` numeric-string regex check, `turn.role === 'system'`, and `turn.modality` defined assertion to the null-clears test.
- [x] [Review][Patch] No test for `appendTurnNext` failure path [`apps/api/src/modules/households/households.routes.test.ts`] — Fixed: added `simulateThreadInsertError` flag to `PackersState` + two new tests verifying emit count = 1 (assign path) and 0 (clear path) when the thread insert fails.
- [x] [Review][Defer] `getNextSeq` string+1 arithmetic may produce `"51"` instead of `6` [`apps/api/src/modules/lumi/lumi.repository.ts:198`] — deferred, pre-existing: `row.server_seq` typed as `number` but Supabase-js returns bigint as string; `"5"+1="51"` is JS string concat. Affects `lumi.repository.ts` and `thread.repository.ts` equally. Investigate at the PostgreSQL/supabase-js layer before beta; may already be an existing known issue if small-integer bigints come back as numbers.
- [x] [Review][Defer] Cross-household ownership check two-query race in `getThreadTurns` [`apps/api/src/modules/lumi/lumi.repository.ts:37-43`] — deferred, pre-existing: two separate queries (threads then thread_turns) could in theory race if thread is deleted between them; empty result returned rather than error. Pre-existing codebase-wide pattern.
- [x] [Review][Defer] `threadSeqs` Map never evicted [`apps/web/src/lib/realtime/sse.ts:77`] — deferred, pre-existing: the closure-level map grows for every thread seen in a session with no TTL or eviction. Memory leak and stale-cursor accumulation over long sessions. Pre-existing design — acceptable at current scale; revisit at Epic 9.
- [x] [Review][Defer] `from_seq=0` returns all turns uncapped — deferred, by design: the `fromSeq` path has no `.limit()` per spec ("no TURNS_LIMIT cap when from_seq is present"). `from_seq=0` would return entire thread history in one query. Authenticated + household-scoped endpoint; acceptable at beta scale; cap if threads grow large pre-launch.
- [x] [Review][Defer] In-flight gap recovery merge after `thread.resync` produces unpredictable cache state — deferred, known limitation: if SSE drops and reconnects during an in-flight `fetchAndMergeMissedTurns`, the resync invalidation and the async merge settle in undefined order. The refetch triggered by invalidation should eventually win. Pre-existing fire-and-forget trade-off.
- [x] [Review][Defer] Orphaned coordination thread if `appendTurnNext` fails after `createThread` — deferred, pre-existing: the lazy-create pattern (find-or-create thread) means a newly-created coordination thread with no turns exists if `appendTurnNext` throws. The next PATCH will reuse it and emit `server_seq=1`; this may trigger a spurious out-of-order anomaly on clients that had a prior cursor. Pre-existing pattern from 5-S3.
- [x] [Review][Defer] `SequenceId` schema defined in two places without shared import — deferred, pre-existing: `events.ts` and `thread.ts` each define `SequenceId` independently. Divergence risk. Pre-existing.
- [x] [Review][Defer] `from_seq` > PostgreSQL BIGINT_MAX gives opaque error — deferred, negligible at beta scale: no upper-bound guard; values > 2^63-1 would produce an opaque PostgREST error. Acceptable until seq values approach that range.
- [x] [Review][Defer] Reconnect + gap scenario untested at E2E level — deferred, unit test architecture limitation: AC1's two-tab disconnect/reconnect scenario is architecturally correct (threadSeqs persists across reconnects in the same bridge instance) but not covered by any E2E test. Playwright test could cover this with devtools network throttle.

### Change Log

| Date | Change |
|------|--------|
| 2026-06-07 | Implemented 5-S4 Thread Sequencing + SSE Resync — all 3 tasks / 11 subtasks / 8 ACs. Status → review. |
| 2026-06-07 | Code review complete — 3 patches, 10 deferred, 11 dismissed. |
| 2026-06-07 | All 3 review patches applied and verified. Status → done. |

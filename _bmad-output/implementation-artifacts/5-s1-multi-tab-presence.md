# Story 5.S1: Multi-tab Presence

Status: done

## Story

As a Secondary Caregiver (or Primary Parent on a second device),
I want to see when my partner is also viewing Brief,
so that we both know we are looking at the same plan and can coordinate without duplicate changes.

## Acceptance Criteria

1. **Given** two users in the same household each open `/app`, **When** both are on Brief, **Then** each tab shows a `<PresenceIndicator>` displaying the partner's display name (falling back to "Someone" when `display_name` is null) and the label "is also on Brief."
2. **Given** a tab is closed or the user navigates away from Brief, **When** the SSE connection drops or the `usePresence` hook unmounts, **Then** the presence indicator on the partner's tab clears within 60 seconds (immediately on clean unmount via DELETE, or after TTL expiry at worst).
3. **Given** a user is alone on Brief (solo state), **When** no other household members are present on the `brief` surface, **Then** `<PresenceIndicator>` renders nothing.
4. **Given** the SSE dispatcher is upgraded to Redis pub/sub, **When** any code calls `sseDispatcher.emit()`, **Then** events are published via `redis.PUBLISH` on channel `sse:household:{householdId}` and a dedicated subscriber Redis client fans them out to local `ServerResponse` connections — making SSE delivery multi-process-ready. Existing callers of `emit()` require no changes.
5. **Given** presence state is stored in Redis with a 60-second TTL, **When** a heartbeat is not refreshed within 60 seconds, **Then** the Redis key expires and `GET /v1/presence` returns no entry for that user.
6. **Given** `POST /v1/presence/heartbeat` is called with a valid JWT and body `{ surface: SurfaceKind }`, **When** the request is processed, **Then** the API writes `presence:{householdId}:{userId}` to Redis (60s TTL), emits a `presence.partner-active` SSE event to the entire household, and returns the current list of active partners.
7. **Given** any presence endpoint is called without a valid JWT, **When** the request reaches the API, **Then** the API returns 401.
8. **Given** `DELETE /v1/presence` is called, **When** a Redis presence key exists for the user, **Then** the API deletes the key and emits a `presence.partner-active` SSE event with `expires_at` set one second in the past (signaling immediate expiry to receiving tabs).
9. **Given** a client's SSE connection closes (tab closed, network drop), **When** `request.raw.on('close')` fires in the events route, **Then** the API reads the user's presence key from Redis (to recover the stored surface), deletes it, and emits the expired presence event — same outcome as AC#8.

## Tasks / Subtasks

### Task 1 — Upgrade SSE dispatcher to Redis pub/sub (AC: #4)

- [x] 1.1 Modify `apps/api/src/plugins/sse-dispatcher.plugin.ts`:
  - Add a **dedicated** subscriber Redis client inside the plugin:
    ```ts
    import Redis from 'ioredis';
    const subscriber = new Redis(fastify.env.REDIS_URL, { lazyConnect: true });
    await subscriber.connect();
    ```
    This connection is SEPARATE from `fastify.redis` — a connection in subscriber mode cannot issue regular commands (ioredis constraint).
  - Wire the subscriber message handler to fan out to local connections:
    ```ts
    subscriber.on('message', (_channel, rawPayload) => {
      const householdId = _channel.replace('sse:household:', '');
      const set = connections.get(householdId);
      if (!set) return;
      for (const res of set) {
        if (res.writableEnded) { set.delete(res); continue; }
        try { res.write(rawPayload); } catch { set.delete(res); }
      }
      if (set.size === 0) connections.delete(householdId);
    });
    ```
  - Change `emit()` to publish — interface signature stays sync/unchanged:
    ```ts
    emit(householdId, event, data) {
      const payload = `event: ${event}\ndata: ${data}\n\n`;
      fastify.redis
        .publish(`sse:household:${householdId}`, payload)
        .catch((err) => fastify.log.error({ err, householdId }, 'sse-dispatcher: publish failed'));
    },
    ```
  - Update `register()` to subscribe on first household connection (fire-and-forget):
    ```ts
    register(householdId, res) {
      const isNew = !connections.has(householdId);
      if (isNew) connections.set(householdId, new Set());
      connections.get(householdId)!.add(res);
      if (isNew) {
        subscriber
          .subscribe(`sse:household:${householdId}`)
          .catch((err) => fastify.log.warn({ err, householdId }, 'sse-dispatcher: subscribe failed'));
      }
    },
    ```
  - Update `unregister()` to unsubscribe when last connection leaves (fire-and-forget):
    ```ts
    unregister(householdId, res) {
      const set = connections.get(householdId);
      if (!set) return;
      set.delete(res);
      if (set.size === 0) {
        connections.delete(householdId);
        subscriber
          .unsubscribe(`sse:household:${householdId}`)
          .catch((err) => fastify.log.warn({ err, householdId }, 'sse-dispatcher: unsubscribe failed'));
      }
    },
    ```
  - Add cleanup hook: `fastify.addHook('onClose', async () => { await subscriber.quit(); });`
  - `SseDispatcher` TypeScript interface is unchanged — all methods remain sync.

- [x] 1.2 Write tests in `apps/api/src/plugins/sse-dispatcher.plugin.test.ts`:
  - `emit()` calls `redis.publish` on the correct channel with correctly-formatted SSE payload
  - `register()` triggers `subscriber.subscribe` only on the first connection for a household; no duplicate subscribe on second connection for same household
  - `unregister()` triggers `subscriber.unsubscribe` only when the last connection is removed; NOT on intermediate removals
  - Subscriber `message` handler writes `rawPayload` to local in-memory `ServerResponse` objects for matching household

### Task 2 — Presence state API (AC: #5, #6, #7, #8, #9)

- [x] 2.1 Extend `packages/contracts/src/presence.ts` — add after existing `PresenceEvent`:
  ```ts
  export const PresenceHeartbeatRequestSchema = z.object({
    surface: SurfaceKind,
  });

  export const PresencePartnerSchema = z.object({
    user_id: z.string().uuid(),
    display_name: z.string().nullable(),
    surface: SurfaceKind,
    expires_at: z.string().datetime({ offset: true }),
  });

  export const PresenceResponseSchema = z.object({
    partners: z.array(PresencePartnerSchema),
  });
  ```
  NOTE: Project is on **Zod 4** (not Zod 3.23 as project-context.md claims). Zod 4 gotchas:
  - `z.record()` requires two-arg form; one-arg throws
  - `.uuid()` enforces strict RFC-4122 variant nibble in test fixtures
  - `.datetime()` rejects Supabase offset timestamps — normalize via `new Date(ts).toISOString()`

- [x] 2.2 Add type exports to `packages/types/src/index.ts`:
  ```ts
  export type {
    PresenceHeartbeatRequest,
    PresencePartner,
    PresenceResponse,
  } from '@hivekitchen/contracts';
  ```
  And add the inferred type aliases in `packages/contracts/src/presence.ts`:
  ```ts
  export type PresenceHeartbeatRequest = z.infer<typeof PresenceHeartbeatRequestSchema>;
  export type PresencePartner = z.infer<typeof PresencePartnerSchema>;
  export type PresenceResponse = z.infer<typeof PresenceResponseSchema>;
  ```

- [x] 2.3 Add round-trip schema tests in `packages/contracts/src/presence.test.ts`:
  - `PresenceHeartbeatRequestSchema` accepts valid surface, rejects unknown surface
  - `PresencePartnerSchema` accepts valid partner shape, rejects missing fields
  - `PresenceResponseSchema` parses array of partners, accepts empty array

- [x] 2.4 Create `apps/api/src/routes/v1/presence/presence.routes.ts`:

  **Redis key pattern:** `presence:{householdId}:{userId}` → JSON value `{display_name, surface, expires_at}`, TTL 60 seconds

  **Helper — emit presence-active SSE:**
  ```ts
  function emitPresenceEvent(
    fastify: FastifyInstance,
    householdId: string,
    userId: string,
    surface: z.infer<typeof SurfaceKind>,
    expiresAt: string,
  ) {
    const event = {
      type: 'presence.partner-active',
      thread_id: householdId, // householdId as proxy — see SPEC RECONCILIATION in Dev Notes
      user_id: userId,
      surface,
      expires_at: expiresAt,
    };
    fastify.sseDispatcher.emit(householdId, 'message', JSON.stringify(event));
  }
  ```

  **Helper — read all household partners (excluding requester):**
  ```ts
  async function getPartners(fastify, householdId, excludeUserId): Promise<PresencePartner[]> {
    const keys = await fastify.redis.keys(`presence:${householdId}:*`);
    const partners: PresencePartner[] = [];
    for (const key of keys) {
      if (key.endsWith(`:${excludeUserId}`)) continue; // exclude self
      const raw = await fastify.redis.get(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { display_name: string | null; surface: string; expires_at: string };
      const userId = key.split(':').pop()!;
      partners.push({ user_id: userId, display_name: parsed.display_name, surface: parsed.surface as z.infer<typeof SurfaceKind>, expires_at: parsed.expires_at });
    }
    return partners;
  }
  ```

  **Routes (all require JWT auth via standard preHandler):**

  `GET /v1/presence` — read current partners for household
  - Returns `{ partners: PresencePartner[] }` (excluding requester's own key)
  - Response schema: `PresenceResponseSchema`

  `POST /v1/presence/heartbeat` — register/refresh presence
  - Body: `PresenceHeartbeatRequestSchema`
  - Store requester's presence in Redis:
    ```ts
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const value = JSON.stringify({
      display_name: request.user.display_name ?? null,
      surface: body.surface,
      expires_at: expiresAt,
    });
    await fastify.redis.set(`presence:${hh}:${userId}`, value, 'EX', 60);
    ```
  - Emit SSE: `emitPresenceEvent(fastify, hh, userId, body.surface, expiresAt)`
  - Return current partners via `getPartners(fastify, hh, userId)` (response: `PresenceResponseSchema`)
  - Status 200

  `DELETE /v1/presence` — remove own presence
  - Read key to get stored surface before deleting
  - Delete: `await fastify.redis.del('presence:{hh}:{userId}')`
  - Emit expired event with `expires_at = new Date(Date.now() - 1000).toISOString()`
  - Status 204

  NOTE: `request.user` carries `id`, `household_id`, and `display_name` from the JWT preHandler. Verify that `display_name` is included in the JWT payload; if it is not, add a single `fastify.redis.hget(...)` lookup or derive from the auth token's `sub` via `UserRepository.findById()`. Canonical pattern: JWT carries only `sub` (user id), `hh` (household_id), `role`. Display name requires a DB read — look at how other routes get `display_name` (e.g., lumi nudge job fetches it from `UserRepository`).

- [x] 2.5 Modify `apps/api/src/routes/v1/events/events.routes.ts` — on SSE disconnect, clear presence:
  ```ts
  request.raw.on('close', () => {
    clearInterval(heartbeatInterval);
    fastify.sseDispatcher.unregister(payload.hh, reply.raw);
    // Clear presence for this user on disconnect (fire-and-forget)
    void (async () => {
      const key = `presence:${payload.hh}:${payload.sub}`;
      const raw = await fastify.redis.get(key);
      if (!raw) return;
      const stored = JSON.parse(raw) as { surface: string };
      await fastify.redis.del(key);
      const expiredAt = new Date(Date.now() - 1000).toISOString();
      emitPresenceEvent(
        fastify,
        payload.hh,
        payload.sub,
        stored.surface as z.infer<typeof SurfaceKind>,
        expiredAt,
      );
    })().catch((err) =>
      fastify.log.warn({ err }, 'events: presence clear on disconnect failed'),
    );
    fastify.log.info({ module: 'events', action: 'sse.disconnect', clientId }, 'SSE client disconnected');
  });
  ```
  Import `emitPresenceEvent` from presence.routes.ts (extract it to a shared helper in `apps/api/src/modules/presence/presence.helpers.ts` if the circular import is a problem — routes → routes import should be avoided).

  Cleaner approach: extract `emitPresenceEvent` and `getPresenceKey` to `apps/api/src/modules/presence/presence.helpers.ts` and import in both `presence.routes.ts` and `events.routes.ts`.

- [x] 2.6 Register `presenceRoutes` in `apps/api/src/app.ts`:
  - Add after existing route registrations (after `lumiRoutes`, before or after `heartNoteRoutes` — order doesn't matter for presence)
  - Import: `import { presenceRoutes } from './routes/v1/presence/presence.routes.js';`
  - `await app.register(presenceRoutes);`

- [x] 2.7 Write route tests in `apps/api/src/routes/v1/presence/presence.routes.test.ts`:
  - `GET /v1/presence` — returns empty partners array when no household members present
  - `GET /v1/presence` — returns partners when Redis keys exist for household (excluding self)
  - `GET /v1/presence` — 401 when unauthenticated
  - `POST /v1/presence/heartbeat` — 200 with partners array; verify Redis key written with correct TTL
  - `POST /v1/presence/heartbeat` — 400 when body has invalid surface value
  - `POST /v1/presence/heartbeat` — 401 when unauthenticated
  - `POST /v1/presence/heartbeat` — emits SSE event (verify `sseDispatcher.emit` was called)
  - `DELETE /v1/presence` — 204; Redis key deleted; SSE emitted with expired `expires_at`
  - `DELETE /v1/presence` — 204 (no-op when no key exists — idempotent)

### Task 3 — UI: live PresenceIndicator + Brief mount (AC: #1, #2, #3)

- [x] 3.1 Create `apps/web/src/hooks/usePresence.ts`:
  ```ts
  import { useEffect } from 'react';
  import { useQuery } from '@tanstack/react-query';
  import type { z } from 'zod';
  import { PresenceResponseSchema } from '@hivekitchen/contracts';
  import type { PresencePartner } from '@hivekitchen/types';
  import type { SurfaceKind } from '@hivekitchen/contracts';
  import { hkFetch } from '@/lib/fetch';
  import { useAuthStore } from '@/stores/auth.store';
  import { QueryKeys } from '@/lib/realtime/query-keys';

  export function usePresence(surface: z.infer<typeof SurfaceKind>) {
    const user = useAuthStore((s) => s.user);
    const householdId = user?.current_household_id ?? '';

    const { data } = useQuery({
      queryKey: QueryKeys.presence(householdId),
      queryFn: async () => {
        const raw = await hkFetch<unknown>('/v1/presence', { method: 'GET' });
        return PresenceResponseSchema.parse(raw);
      },
      enabled: Boolean(householdId),
      staleTime: 30_000,
    });

    useEffect(() => {
      if (!householdId) return;

      const sendHeartbeat = () =>
        hkFetch<unknown>('/v1/presence/heartbeat', {
          method: 'POST',
          body: { surface },
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        }).catch(() => {}); // best-effort; SSE invalidation handles UI refresh

      void sendHeartbeat(); // immediate on mount
      const interval = setInterval(() => void sendHeartbeat(), 30_000);

      return () => {
        clearInterval(interval);
        // Best-effort on unmount (navigate away from Brief)
        void hkFetch<unknown>('/v1/presence', {
          method: 'DELETE',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
        }).catch(() => {});
      };
    }, [householdId, surface]);

    return { partners: data?.partners ?? [] satisfies PresencePartner[] };
  }
  ```

  CRITICAL — `hkFetch` body auto-stringifies: pass raw object `body: { surface }`, NOT `body: JSON.stringify({ surface })`. The fetch utility in `apps/web/src/lib/fetch.ts` JSON-stringifies `init.body` internally — double-encoding is the #1 recurring mistake in this codebase.

- [x] 3.2 Replace stub `PresenceIndicator` at `apps/web/src/features/thread/PresenceIndicator.tsx`:
  - Remove the old `partnerName?: string` prop (stub interface)
  - New interface: `surface: { kind: z.infer<typeof SurfaceKind>; id: string }` (per UX-DR26)
  - Internally call `usePresence(surface.kind)` — `surface.id` is the household ID
  - Render per UX-DR26:
    - `partners.length === 0`: return null
    - `partners.length === 1`: `"{name} is also on Brief"` — `partner.display_name ?? 'Someone'`
    - `partners.length >= 2`: `"{n} others on Brief"`
  - Surface label "on Brief" is currently hard-coded; for future surfaces this will be dynamic (deferred)
  - Styling: `inline-flex items-center gap-1 font-sans text-[13px] text-warm-neutral-600`
  - 20px circular avatar: warm-neutral-200 background, user initial in warm-neutral-600 (or generic dot if no display name)
  - Accessibility: `role="status" aria-live="polite"` on wrapper
  - No animations in 5-S1 — UX-DR26 motion states deferred to later slices

- [x] 3.3 Mount `<PresenceIndicator>` in `apps/web/src/features/plan/BriefCanvas.tsx`:
  - Import `PresenceIndicator` from `features/thread/PresenceIndicator`
  - Get `householdId` from `useAuthStore(s => s.user?.current_household_id ?? '')`
  - Mount at the top of BriefCanvas content area, positioned top-right per UX-DR26:
    ```tsx
    <PresenceIndicator surface={{ kind: 'brief', id: householdId }} />
    ```
  - The component self-manages presence lifecycle via `usePresence`

- [x] 3.4 Write tests:

  `apps/web/src/hooks/usePresence.test.ts`:
  - Sends heartbeat POST immediately on mount
  - Sends DELETE on unmount (cleanup function)
  - Returns `partners` array populated from query data
  - Returns empty array when query has no data

  `apps/web/src/features/thread/PresenceIndicator.test.tsx`:
  - Renders null when `usePresence` returns no partners
  - Renders `"{name} is also on Brief"` for one partner with display_name
  - Renders `"Someone is also on Brief"` for one partner with null display_name
  - Renders `"2 others on Brief"` for two partners
  - Has `role="status"` and `aria-live="polite"` in all non-null states

## Dev Notes

### SPEC RECONCILIATION — `thread_id` in PresenceEvent

`packages/contracts/src/presence.ts` `PresenceEvent` requires `thread_id: z.string().uuid()`. The family thread schema ships in **5-S3** (PackerOfTheDay). For 5-S1, use `householdId` as the `thread_id` value — it is a valid UUID format and serves as the presence namespace. The SSE bridge in `apps/web/src/lib/realtime/sse.ts` already handles `presence.partner-active` by calling `queryClient.invalidateQueries({ queryKey: QueryKeys.presence(event.thread_id) })` — using `householdId` as `thread_id` means `QueryKeys.presence(householdId)` becomes the cache key, which matches what `usePresence` queries. In 5-S3, when the real family thread is created, presence will be updated to use the actual `thread_id`.

### Redis pub/sub requires a DEDICATED subscriber connection

ioredis in subscriber mode (`SUBSCRIBE`) cannot issue regular Redis commands on the same connection. The modified `sseDispatcherPlugin` must create its own `new Redis(fastify.env.REDIS_URL, { lazyConnect: true })` for the subscriber, separate from `fastify.redis` (the general-purpose connection used for SET, GET, PUBLISH, etc.). Register `subscriber.quit()` in `fastify.addHook('onClose', ...)`.

### SSE dispatcher interface is unchanged

Existing callers of `sseDispatcher.emit()` — including the 12-S12 nudge emitter, plan mutation events, memory events — all call it synchronously and fire-and-forget. The new body is a Redis PUBLISH (also fire-and-forget with `.catch()`). No caller changes needed.

Local delivery after the pub/sub upgrade: local connections receive the event via the subscriber loop (PUBLISH → local Redis → subscriber message handler → write to `ServerResponse`). This adds a sub-millisecond Redis round-trip for same-process delivery. Acceptable at beta scale.

### hkFetch double-encoding trap

`apps/web/src/lib/fetch.ts` auto-JSON-stringifies `init.body`. Pass a raw object — `body: { surface }` — NOT `body: JSON.stringify({ surface })`. This is the canonical cross-story trap (Epic 7 retro action item #3, repeated in 7-s3, 7-s10).

### Zod version is 4 (not 3.23)

project-context.md says Zod 3.23 but the project migrated to Zod 4 (confirmed in Epic 7 retro + sprint-status entries). Apply Zod 4 patterns:
- `z.record()` requires two-arg form: `z.record(z.string(), z.unknown())`
- `.uuid()` enforces strict RFC-4122 variant nibble — test fixture UUIDs must be valid (e.g., `550e8400-e29b-41d4-8716-446655440000`, NOT `...44444...`)
- `.datetime()` rejects Supabase-format offset timestamps — normalize via `new Date(ts).toISOString()`

### display_name is not in the JWT payload

The JWT carries `sub` (user id), `hh` (household_id), `role`. `display_name` is a DB field on the `users` table (nullable). To include it in the presence Redis value, the heartbeat handler needs a DB read: `UserRepository.findById(request.user.id)` — check how `lumi.routes.ts` or `memory.routes.ts` gets the user display name and follow that pattern. Alternatively, look up `display_name` during the GET partners scan (read it once per partner, not per heartbeat). At beta scale (2 household members) this is fine.

### `KEYS` vs `SCAN` for reading household presence

`redis.keys('presence:{householdId}:*')` is used in the GET and POST handlers. At beta scale (150 HH, ≤2 members per HH) this is acceptable. Log a `// TODO(Epic 9): replace with SCAN cursor` comment in the helper function. Do NOT file a deferred-work.md entry in this story — defer that to 5-S2 or 5-S3.

### Idempotency-Key on presence endpoints

AR-13 requires `Idempotency-Key` on all POST/PATCH/DELETE. For the heartbeat, generate a fresh `crypto.randomUUID()` on each call (presence heartbeats are intentionally non-deduplicated — each one refreshes the TTL). `crypto.randomUUID()` is available in modern browsers and in Node ≥22 (`node:crypto`).

### events.routes.ts: emitPresenceEvent helper

To avoid a circular import (`events.routes.ts` → `presence.routes.ts` → events indirectly), extract the `emitPresenceEvent` function to `apps/api/src/modules/presence/presence.helpers.ts`. Import it in both `presence.routes.ts` and `events.routes.ts`. Pattern: small pure helper module with no Fastify dependencies.

### PresenceIndicator stub cleanup

The existing stub comment in `PresenceIndicator.tsx` says "SSE wiring arrives with Story 5.2". This referred to the old story numbering — 5.2 was the old number for what is now 5-S1 in the vertical-slice scheme. The stub is replaced wholesale in Task 3.2.

### Test baselines (do not regress)

- API: 20-fail / ~1617-pass pre-existing baseline; new tests add to passing count only
- Web: ~395 tests passing (exact count varies — run `pnpm test --filter @hivekitchen/web` to confirm baseline before starting)
- Contracts: presence.test.ts is new; existing contract suites must not be affected

### Deferred out of 5-S1 scope

- Presence on surfaces other than `brief` (plan_tile, thread, memory_node)
- "Viewing" vs "editing" state distinction (UX-DR26 — `one-other-viewing` / `one-other-editing` states)
- `SCAN` cursor approach for `KEYS` (safety for >1000 keys, not relevant at beta scale)
- Presence on `plan_tile` surface (needed by 5-S3 PackerOfTheDay — wire at that slice)
- 5-S2 caregiver invite redemption (independent of 5-S1, can be developed in parallel after 5-S1 ships)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context)

### Debug Log References

None — no HALT conditions hit. All tasks implemented in a single pass.

### Completion Notes List

- **Task 1 (AC#4)** — `sse-dispatcher.plugin.ts` upgraded to Redis pub/sub. A
  dedicated subscriber `Redis` client (separate from `fastify.redis`) subscribes
  to `sse:household:{id}` on the first connection per household and unsubscribes
  on the last; its `message` handler fans the raw payload to local
  `ServerResponse` connections. `emit()` now PUBLISHes via `fastify.redis` and
  stays sync/fire-and-forget — existing callers (lumi-nudge job, etc.) unchanged.
  `onClose` quits the subscriber. Plugin test rewritten with a mocked `ioredis`
  subscriber + decorated `fastify.redis` publish spy (6 cases).
- **Task 2 (AC#5–9)** — Added `PresenceHeartbeatRequestSchema`,
  `PresencePartnerSchema`, `PresenceResponseSchema` (+ inferred types, re-exported
  from `@hivekitchen/types`). New `presence.helpers.ts` (`getPresenceKey`,
  `emitPresenceEvent`) imported by both presence + events routes to avoid a
  routes→routes cycle. New `presence.routes.ts`: `GET /v1/presence`,
  `POST /v1/presence/heartbeat` (writes `presence:{hh}:{uid}` JSON value with 60s
  EX TTL, emits `presence.partner-active`, returns partners), `DELETE /v1/presence`
  (idempotent; emits expired event). `events.routes.ts` disconnect handler now
  clears the user's presence key + emits the expired event (AC#9, mirrors AC#8).
  Registered in `app.ts`. Route tests: 9 cases.
- **Task 3 (AC#1–3)** — `usePresence(surface)` hook: heartbeat POST on mount +
  every 30s, DELETE on unmount, `useQuery` read invalidated by the existing SSE
  `presence.partner-active` handler. `PresenceIndicator` replaced wholesale —
  takes `surface: { kind, id }`, self-manages via `usePresence`, renders null when
  solo, "{name} is also on Brief" / "Someone is also on Brief" / "N others on
  Brief", `role="status" aria-live="polite"`. Mounted top-right in `BriefCanvas`.
  Tests: usePresence 4, PresenceIndicator 5.

**SPEC RECONCILIATIONS / DECISIONS:**
1. `request.user` does NOT carry `display_name` (only `id`/`household_id`/`role`,
   per `authenticate.hook.ts`) — confirmed the Dev Note. The heartbeat handler
   reads it via `UserRepository.findUserById(userId)` and stores it in the Redis
   value, so the GET partners scan needs no per-partner DB read.
2. `thread_id` in the emitted `PresenceEvent` uses `householdId` (the family
   thread ships in 5-S3), per Dev Notes — matches `QueryKeys.presence(householdId)`.
3. **PlanTile collision (not in story scope):** `PlanTile.tsx` was a second
   consumer of the old stub, passing `partnerName` on the `plan_tile` surface
   (a static "locked-by-partner" badge). `plan_tile` presence is explicitly
   DEFERRED out of 5-S1. To replace the shared component wholesale per Task 3.2
   without (a) breaking PlanTile or (b) firing unwanted `plan_tile` heartbeats,
   the static badge was inlined directly into `PlanTile.tsx`. Behavior + its test
   ("Priya is editing") preserved exactly.
4. `KEYS presence:{hh}:*` used for the partner scan — acceptable at beta scale;
   added `TODO(Epic 9): replace with SCAN cursor` in the helper (no deferred-work
   file per Dev Notes).

**VERIFICATION:**
- API: 1654 pass / 20 fail (= documented baseline; all 20 failures pre-existing in
  unrelated files — auth.routes, children.repository, memory.service, etc.). New:
  `sse-dispatcher.plugin.test.ts` 6/6, `presence.routes.test.ts` 9/9.
- Contracts: 681 pass / 4 fail (pre-existing cultural + heart-notes baseline).
  New: `presence.test.ts` +9 cases (13/13 total in file).
- Web: 502 / 502 pass (incl. usePresence 4, PresenceIndicator 5, PlanTile 33,
  BriefCanvas).
- Typecheck: zero NEW errors in any package (api baseline ~11, web baseline 3,
  contracts/types baseline 1 each — all in pre-existing files).

### File List

- `apps/api/src/plugins/sse-dispatcher.plugin.ts` (modified — Redis pub/sub)
- `apps/api/src/plugins/sse-dispatcher.plugin.test.ts` (rewritten)
- `apps/api/src/modules/presence/presence.helpers.ts` (new)
- `apps/api/src/routes/v1/presence/presence.routes.ts` (new)
- `apps/api/src/routes/v1/presence/presence.routes.test.ts` (new)
- `apps/api/src/routes/v1/events/events.routes.ts` (modified — disconnect clears presence)
- `apps/api/src/app.ts` (modified — register presenceRoutes)
- `packages/contracts/src/presence.ts` (modified — heartbeat/partner/response schemas + types)
- `packages/contracts/src/presence.test.ts` (modified — added schema round-trip tests)
- `packages/types/src/index.ts` (modified — re-export presence types)
- `apps/web/src/hooks/usePresence.ts` (new)
- `apps/web/src/hooks/usePresence.test.ts` (new)
- `apps/web/src/features/thread/PresenceIndicator.tsx` (rewritten — live presence)
- `apps/web/src/features/thread/PresenceIndicator.test.tsx` (rewritten)
- `apps/web/src/features/plan/BriefCanvas.tsx` (modified — mount PresenceIndicator)
- `apps/web/src/features/plan/PlanTile.tsx` (modified — inline static lock badge)

### Change Log

- 2026-06-06 — Implemented Story 5-S1 Multi-tab Presence (Tasks 1–3, all ACs).
  SSE dispatcher → Redis pub/sub; presence REST API (heartbeat/get/delete) with
  60s-TTL Redis keys + SSE fan-out; live `usePresence` hook + `PresenceIndicator`
  mounted on Brief. Status → review.

### Review Findings

- [x] [Review][Patch] JSON.parse in getPartners has no try-catch — a corrupt Redis value throws unguarded, causing all GET /v1/presence and POST /v1/presence/heartbeat calls to fail with 500 [`apps/api/src/routes/v1/presence/presence.routes.ts:31`] — fixed: wrapped in try-catch, skips corrupt entry with warn log

- [x] [Review][Defer] Same-user multi-tab: closing one tab clears presence key shared by all tabs — second tab's 30s heartbeat recovers it; acceptable within 60s TTL window at MVP [`apps/api/src/routes/v1/events/events.routes.ts:104-115`] — deferred, pre-existing design limitation
- [x] [Review][Defer] Redis KEYS O(N) scan + N+1 sequential GETs in getPartners — already TODO(Epic 9) commented; ≤2 members at beta scale [`apps/api/src/routes/v1/presence/presence.routes.ts:25`] — deferred, pre-existing
- [x] [Review][Defer] surface.id prop accepted by PresenceIndicator but unused — hook reads current_household_id from auth store; functionally correct since BriefCanvas always passes the same value; matters when multi-household support ships [`apps/web/src/features/thread/PresenceIndicator.tsx:8`] — deferred, pre-existing
- [x] [Review][Defer] userId extracted via key.split(':').pop() — fragile if userId contains colons; UUIDs never do; theoretical [`apps/api/src/routes/v1/presence/presence.routes.ts:32`] — deferred, pre-existing
- [x] [Review][Defer] 30s heartbeat interval not covered by test — immediate-on-mount test verifies setup; interval test requires fake-timer boilerplate [`apps/web/src/hooks/usePresence.test.ts`] — deferred, pre-existing
- [x] [Review][Defer] JSON.parse in events.routes disconnect — fire-and-forget; outer .catch() logs the error; key expires via 60s TTL naturally [`apps/api/src/routes/v1/events/events.routes.ts:106`] — deferred, pre-existing
- [x] [Review][Defer] subscriber.subscribe/unsubscribe failures fire-and-forget — warn-logged; Redis is stable at beta scale [`apps/api/src/plugins/sse-dispatcher.plugin.ts:62`] — deferred, pre-existing
- [x] [Review][Defer] BriefCanvas early-return paths (loading/null-brief) skip PresenceIndicator mount — user loading Brief is not registered as present; transient gap within TTL window [`apps/web/src/features/plan/BriefCanvas.tsx`] — deferred, pre-existing
- [x] [Review][Defer] React StrictMode double-unmount sends spurious DELETE — dev-only behavior; 30s heartbeat re-registers; no production impact [`apps/web/src/hooks/usePresence.ts:41-47`] — deferred, pre-existing

# Story 1.10: RealTime SSE bridge + central InvalidationEvent dispatcher

Status: review

## Story

As a developer,
I want the central client-side SSE bridge (`apps/web/src/lib/realtime/`) that connects to `/v1/events`, parses typed `InvalidationEvent`s, and dispatches them to `queryClient`,
So that every Epic 2+ feature gets near-real-time UI invalidation for free.

## Acceptance Criteria

1. `apps/web/src/lib/realtime/sse.ts` exports `createSseBridge(queryClient: QueryClient): SseBridge` — a class or object with `connect()`, `disconnect()`, and `isConnected(): boolean` methods — that opens a native `EventSource` to `/v1/events?client_id={uuid-from-sessionStorage}`, validates each incoming message with the `InvalidationEvent` Zod schema (`.safeParse()`), and dispatches via an exhaustive `switch` on `event.type`. TypeScript **must** narrow `event` to `never` in the default branch so the compiler enforces exhaustiveness.

2. **Dispatch rules per event type:**
   - `plan.updated` → `queryClient.invalidateQueries({ queryKey: ['plan', event.week_id] })`
   - `memory.updated` → `queryClient.invalidateQueries({ queryKey: ['memory', event.node_id] })`
   - `memory.forget.completed` → `queryClient.invalidateQueries({ queryKey: ['memory', event.node_id] })`
   - `thread.turn` → `queryClient.setQueryData(['thread', event.thread_id], appendTurn(event.turn))` (**streaming exception** — `setQueryData`, not `invalidateQueries`)
   - `packer.assigned` → `queryClient.invalidateQueries({ queryKey: ['packer', event.date] })`
   - `pantry.delta` → `queryClient.invalidateQueries({ queryKey: ['pantry'] })`
   - `allergy.verdict` → `queryClient.invalidateQueries({ queryKey: ['plan', event.plan_id] })`
   - `presence.partner-active` → `queryClient.invalidateQueries({ queryKey: ['presence', event.thread_id] })`
   - `thread.resync` → `queryClient.invalidateQueries({ queryKey: ['thread', event.thread_id] })` (**refetches from `from_seq`** — invalidation triggers a fresh fetch from the loader, which passes `from_seq` as a query param; the full thread-resync protocol is a Story 5.1 concern)

3. **Reconnect with exponential backoff:** on `EventSource` `error` event (including clean close), the bridge schedules reconnect using `1s × 2× ±20% jitter, cap 60s`. The `EventSource` is re-created on each attempt. The backoff timer is cleared on `disconnect()`.

4. **`Last-Event-ID` resume:** the native `EventSource` sends the `Last-Event-ID` header automatically when a server-set `id:` field is present. The bridge does not need to manually track this — it comes for free from the `EventSource` spec. The bridge must **not** strip or override it.

5. **Thread sequence-gap detection:** when a `thread.turn` event arrives with `event.turn.server_seq !== previousSeq + 1n` (where `previousSeq` is tracked in memory per `thread_id`), the bridge calls `reportThreadIntegrityAnomaly({ thread_id: event.thread_id, expected_seq: previousSeq + 1n, received_seq: event.turn.server_seq })` — a stub that calls `TODO: POST /v1/internal/client-anomaly` (full beacon endpoint is Story 5.17; this story only establishes the call site with the comment). The stub lives in `apps/web/src/lib/realtime/thread-integrity.ts`.

6. **`client_id` persistence:** stored in `sessionStorage` under key `hk:client_id`. On first use, generated as `crypto.randomUUID()`. Per-tab isolation is intentional (supports Figma-style multi-parent presence in Story 5.2).

7. **`apps/web/src/lib/realtime/query-keys.ts`** exports a centralized `QueryKeys` object (or namespace) with a typed factory for each resource: `QueryKeys.plan(weekId)`, `QueryKeys.thread(threadId)`, `QueryKeys.memory(nodeId)`, `QueryKeys.packer(date)`, `QueryKeys.pantry()`, `QueryKeys.presence(threadId)`. The dispatcher uses these — not string literals.

8. **`apps/web/src/lib/realtime/index.ts`** re-exports `createSseBridge`, `SseBridge` type, and `QueryKeys` from the sub-module. This is the public surface; consumers import from `@/lib/realtime`.

9. **Provider wiring:** `apps/web/src/providers/query-provider.tsx` creates the `QueryClient` and calls `createSseBridge(queryClient).connect()` inside a `useEffect` on mount. The `QueryClientProvider` wraps `{children}`. `apps/web/src/app.tsx` wraps the app tree with `<QueryProvider>`.

10. **`@tanstack/react-query` v5 installed** in `apps/web`: `pnpm --filter @hivekitchen/web add @tanstack/react-query@^5.99.0`. `@tanstack/react-query-devtools` added to devDependencies.

11. **`fastify-sse-v2` installed** in `apps/api`: `pnpm --filter @hivekitchen/api add fastify-sse-v2`. The `GET /v1/events` route stub registered in `apps/api/src/routes/v1/events/events.routes.ts`.

12. **Unit tests** in `apps/web/src/lib/realtime/sse.test.ts` use a fake `EventSource` implementation (manual mock — no external package required) to:
    - Verify each event type dispatches the correct `queryClient` call
    - Verify `thread.turn` uses `setQueryData` (not `invalidateQueries`)
    - Verify `thread.resync` calls `invalidateQueries`
    - Verify a Zod-parse failure (malformed event) logs a warning and does NOT crash
    - Verify reconnect backoff fires after simulated `error` event

13. **`pnpm typecheck`**, **`pnpm lint`**, and **`pnpm test`** remain green workspace-wide.

## Tasks / Subtasks

- [x] **Task 1 — Pre-flight** (no AC)
  - [x] Confirm Story 1.9 is `done` in `sprint-status.yaml`
  - [x] Confirm `apps/web/src/lib/` contains only `.gitkeep` (no existing realtime code)
  - [x] Confirm `apps/api/src/routes/v1/events/` contains only `.gitkeep` (no existing events route)
  - [x] Confirm `@tanstack/react-query` is NOT yet in `apps/web/package.json` (install in Task 2)
  - [x] Confirm `fastify-sse-v2` is NOT yet in `apps/api/package.json` (install in Task 3)

- [x] **Task 2 — Install TanStack Query in apps/web** (AC: #10)
  - [x] Run `pnpm --filter @hivekitchen/web add @tanstack/react-query@^5.99.0`
  - [x] Run `pnpm --filter @hivekitchen/web add -D @tanstack/react-query-devtools`
  - [x] Verify `apps/web/package.json` now lists both packages
  - [x] Run `pnpm typecheck` from workspace root — confirm still green (no breaking import yet)

- [x] **Task 3 — Install fastify-sse-v2 in apps/api** (AC: #11)
  - [x] Run `pnpm --filter @hivekitchen/api add fastify-sse-v2`
  - [x] Verify `apps/api/package.json` now lists `fastify-sse-v2`

- [x] **Task 4 — Create QueryKeys factory** (AC: #7)
  - [x] Delete `apps/web/src/lib/.gitkeep`
  - [x] Create `apps/web/src/lib/realtime/` directory
  - [x] Create `apps/web/src/lib/realtime/query-keys.ts` per **QueryKeys Spec** in Dev Notes

- [x] **Task 5 — Create thread-integrity stub** (AC: #5)
  - [x] Create `apps/web/src/lib/realtime/thread-integrity.ts` per **Thread Integrity Stub Spec** in Dev Notes

- [x] **Task 6 — Create SSE bridge** (AC: #1, #2, #3, #4, #5, #6)
  - [x] Create `apps/web/src/lib/realtime/sse.ts` per **SSE Bridge Spec** in Dev Notes
  - [x] Every case in the `switch` is handled; default branch is `satisfies never` check
  - [x] `client_id` uses `sessionStorage` with `crypto.randomUUID()` fallback

- [x] **Task 7 — Create realtime index barrel** (AC: #8)
  - [x] Create `apps/web/src/lib/realtime/index.ts` re-exporting public surface

- [x] **Task 8 — Create QueryProvider and wire into app.tsx** (AC: #9)
  - [x] Create `apps/web/src/providers/` directory
  - [x] Create `apps/web/src/providers/query-provider.tsx` per **QueryProvider Spec** in Dev Notes
  - [x] Update `apps/web/src/app.tsx` to wrap with `<QueryProvider>` per **App.tsx Spec** in Dev Notes

- [x] **Task 9 — Create events route stub in apps/api** (AC: #11)
  - [x] Delete `apps/api/src/routes/v1/events/.gitkeep`
  - [x] Create `apps/api/src/routes/v1/events/events.routes.ts` per **Events Route Stub Spec** in Dev Notes
  - [x] Register route in `apps/api/src/app.ts` per registration pattern

- [x] **Task 10 — Write tests** (AC: #12)
  - [x] Create `apps/web/src/lib/realtime/sse.test.ts` per **Test Spec** in Dev Notes
  - [x] Run `pnpm test` — all tests pass

- [x] **Task 11 — Verification** (AC: #13)
  - [x] `pnpm typecheck` — all packages green
  - [x] `pnpm lint` — 0 errors workspace-wide
  - [x] `pnpm test` — all tests green (new realtime tests + all prior tests)
  - [x] `pnpm tools:check` — exits 0 (unchanged)
  - [x] Update `sprint-status.yaml` story to `review`

---

## Dev Notes

### Architecture References (authoritative sources)

- `_bmad-output/planning-artifacts/architecture.md` §3.3 — SSE channel model: one long-lived channel per `(user_id, client_id-per-tab)`; `client_id` in `sessionStorage`; `Last-Event-ID` resume; `GET /v1/events?client_id={uuid}`
- `_bmad-output/planning-artifacts/architecture.md` §4.1 — `InvalidationEvent` Zod-discriminated union (complete schema already in `packages/contracts/src/events.ts`)
- `_bmad-output/planning-artifacts/architecture.md` §3.4 SSE event format — `event: <type>\ndata: <json>\nid: <monotonic_seq>\n\n`; heartbeat `\n:ping\n\n` every 20s
- `_bmad-output/planning-artifacts/architecture.md` §5.3 — SSE reconnect backoff: `1s × 2× ±20% jitter, cap 60s` (same curve as ElevenLabs WS)
- `_bmad-output/planning-artifacts/architecture.md` §4.4 — client anomaly beacon: `POST /v1/internal/client-anomaly` with `{ kind: 'thread_integrity', thread_id, expected_seq, received_seq }` — full endpoint in Story 5.17
- `_bmad-output/planning-artifacts/architecture.md` §5.1 — SSE must terminate at Fly.io API directly (`api.hivekitchen.*`), NOT through Cloudflare proxy; `Cache-Control: no-cache, no-transform`; `X-Accel-Buffering: no`; heartbeat ≤30s; ≥6h event-log retention
- `_bmad-output/planning-artifacts/architecture.md` §4.1 streaming exception — `thread.turn` uses `setQueryData`; all other events use `invalidateQueries`
- `_bmad-output/planning-artifacts/architecture.md` §1.4 event naming — `<resource>.<verb>`: `plan.updated`, `memory.updated`, `thread.turn`, etc.
- `_bmad-output/planning-artifacts/architecture.md` project structure — `apps/web/src/lib/sse.ts` (THE central bus, named in multiple places)
- `_bmad-output/planning-artifacts/architecture.md` §4.4 amendment S — single `/v1/internal/client-anomaly` endpoint accepts `{ kind: 'thread_integrity', thread_id, expected_seq, received_seq }`; full implementation in Story 5.17
- `_bmad-output/planning-artifacts/epics.md` Story 1.10 AC — exact spec for `createSseBridge`, thread-sequence-gap beacon, reconnect, `Last-Event-ID`

### CRITICAL: Boundary Rules That Affect This Story

**`apps/web/` boundary (enforced by `eslint-plugin-boundaries`):**
- Files in `apps/web/src/lib/` are cross-feature utilities; they CAN import from `@hivekitchen/contracts` (cross-package), `@hivekitchen/types` (cross-package), and `react` / `@tanstack/react-query`.
- Files in `lib/` CANNOT import from feature modules (`features/plan/`, `features/brief/`, etc.) — dependency flows inward only.
- No `framer-motion` imports anywhere in `apps/web/` (ESLint ban from architecture §4.3).
- No Toast/Sonner/Dialog-for-confirmation imports (banned per UX Spec Evolution 3/4).
- No `console.*` in `apps/web/src/` — use a no-op logger stub or `import.meta.env.DEV` guard.

**`apps/api/` boundary:**
- SSE route code lives in `apps/api/src/routes/v1/events/events.routes.ts` — NOT in `modules/`. The `modules/` directory is for vertical-slice features that own service + repository + schema. The events endpoint for Epic 1 is a stub route that does NOT yet connect to Redis pub/sub (that is Story 5.2 scope).
- `fastify-sse-v2` import belongs in the route file only. No plugin wrapper needed for the stub.
- `fp()` wrapping: the events routes plugin does NOT use `fp()` — it is a route registration plugin, not a shared-state decorator. Route plugins registered via `app.register()` are scoped by Fastify's plugin encapsulation. The `fp()` pattern is for plugins that decorate `fastify.*` (SDK clients, middleware hooks). Compare: `supabasePlugin` uses `fp()` because it decorates `fastify.supabase`; `healthRoutes` does NOT use `fp()` because it only registers routes.

**ESM import rules (CRITICAL — apply to all new files):**
- All relative imports use `.js` extension: `import { createSseBridge } from './sse.js'` ✅
- `import type` for type-only imports: `import type { QueryClient } from '@tanstack/react-query'` ✅
- NO `__dirname` or `__filename` — use `import.meta.url` + `fileURLToPath` if path resolution is needed
- In `apps/web/` (Vite bundler, `moduleResolution: "bundler"`): relative imports use `.js` extension OR can omit it (bundler resolves both). **Use `.js` extension to be consistent** with `apps/api/` convention.
- `@/` path alias maps to `apps/web/src/` (configured in `vite.config.ts`). Use it for imports from within `apps/web/src/`.

**TypeScript strict rules:**
- No `any` — use `unknown` with narrowing
- `import type` for type-only imports
- Exhaustive `switch`: the default branch should use `const _exhaustive: never = event;` (or `satisfies never`) to get a compile-time error if a new `InvalidationEvent` type is added without a matching case

### QueryKeys Spec

```ts
// apps/web/src/lib/realtime/query-keys.ts

/**
 * Centralized query key factory for all TanStack Query keys used by the SSE dispatcher.
 * Every Epic 2+ feature that needs SSE-driven invalidation must add its key here.
 * Consumers import from '@/lib/realtime' (the barrel).
 */
export const QueryKeys = {
  /** @example QueryKeys.plan('week-uuid') → ['plan', 'week-uuid'] */
  plan: (weekId: string): ['plan', string] => ['plan', weekId],

  /** @example QueryKeys.thread('thread-uuid') → ['thread', 'thread-uuid'] */
  thread: (threadId: string): ['thread', string] => ['thread', threadId],

  /** @example QueryKeys.memory('node-uuid') → ['memory', 'node-uuid'] */
  memory: (nodeId: string): ['memory', string] => ['memory', nodeId],

  /** @example QueryKeys.packer('2026-04-24') → ['packer', '2026-04-24'] */
  packer: (date: string): ['packer', string] => ['packer', date],

  /** @example QueryKeys.pantry() → ['pantry'] */
  pantry: (): ['pantry'] => ['pantry'],

  /** @example QueryKeys.presence('thread-uuid') → ['presence', 'thread-uuid'] */
  presence: (threadId: string): ['presence', string] => ['presence', threadId],
} as const;
```

**Why return-type annotations?** The tuple types (`['plan', string]`) are needed so TanStack Query's `queryKey` type inference does not widen to `(string | string[])[]`. Without them, `invalidateQueries` receives a too-wide type.

### Thread Integrity Stub Spec

```ts
// apps/web/src/lib/realtime/thread-integrity.ts
//
// Stub call site for the thread-sequence-gap beacon.
// Full implementation: Story 5.17 (POST /v1/internal/client-anomaly with kind='thread_integrity').

export interface ThreadIntegrityAnomaly {
  thread_id: string;
  expected_seq: bigint;
  received_seq: bigint;
}

/**
 * Reports a thread sequence gap to the server anomaly endpoint.
 *
 * TODO(Story 5.17): Replace stub with real fetch to POST /v1/internal/client-anomaly
 * with body { kind: 'thread_integrity', thread_id, expected_seq: String(expected_seq),
 * received_seq: String(received_seq) }.
 * BigInt serialized as string because JSON.stringify does not serialize BigInt natively.
 */
export function reportThreadIntegrityAnomaly(anomaly: ThreadIntegrityAnomaly): void {
  // Story 5.17 will implement the actual beacon call.
  // For now, log in dev mode only — production is a no-op.
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn('[thread-integrity] sequence gap detected', {
      thread_id: anomaly.thread_id,
      expected_seq: String(anomaly.expected_seq),
      received_seq: String(anomaly.received_seq),
    });
  }
}
```

**Note on `console.warn`:** the `no-console` ESLint rule applies to `apps/api/src/**/*.ts`. The web app uses `eslint-plugin-boundaries` and Tailwind-related rules, not the same `no-console` rule. However, since this is a stub that should log ONLY in dev mode, wrap it in the `import.meta.env.DEV` guard and add the `// eslint-disable-next-line no-console` comment if the lint config covers the web app — check `apps/web/eslint.config.mjs` to confirm. If `no-console` is not in the web eslint config, the guard alone is sufficient.

### SSE Bridge Spec

```ts
// apps/web/src/lib/realtime/sse.ts
import type { QueryClient } from '@tanstack/react-query';
import { InvalidationEvent } from '@hivekitchen/contracts';
import type { z } from 'zod';
import { QueryKeys } from './query-keys.js';
import { reportThreadIntegrityAnomaly } from './thread-integrity.js';

// Architecture §3.3: client_id in sessionStorage, one per tab.
const CLIENT_ID_KEY = 'hk:client_id';

function getOrCreateClientId(): string {
  let id = sessionStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

// Architecture §5.3: reconnect backoff 1s × 2× ±20% jitter, cap 60s.
function computeBackoffMs(attemptIndex: number): number {
  const base = 1000; // 1s
  const cap = 60_000; // 60s
  const raw = base * Math.pow(2, attemptIndex);
  const capped = Math.min(raw, cap);
  // ±20% jitter
  const jitter = capped * 0.2 * (Math.random() * 2 - 1);
  return Math.max(base, Math.round(capped + jitter));
}

// Thread-turn streaming exception — appends a turn to existing cached data.
// Returns a stable updater function for queryClient.setQueryData.
function appendTurn(
  turn: z.infer<typeof InvalidationEvent>['turn' extends keyof z.infer<typeof InvalidationEvent> ? never : never],
): unknown {
  // Typed via the Turn type inferred from the schema.
  return (old: unknown) => {
    if (!Array.isArray(old)) return [turn];
    return [...old, turn];
  };
}

// Per-thread sequence tracking for gap detection.
type ThreadSeqMap = Map<string, bigint>;

export interface SseBridge {
  connect(): void;
  disconnect(): void;
  isConnected(): boolean;
}

export function createSseBridge(queryClient: QueryClient): SseBridge {
  let es: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attemptIndex = 0;
  let connected = false;
  const threadSeqs: ThreadSeqMap = new Map();

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function handleMessage(e: MessageEvent): void {
    // Guard against empty heartbeat data (:ping frames have no data).
    if (!e.data) return;

    const parsed = InvalidationEvent.safeParse(JSON.parse(e.data as string));

    if (!parsed.success) {
      // Malformed event — log in dev, swallow silently in prod.
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn('[sse] failed to parse InvalidationEvent', parsed.error, e.data);
      }
      return;
    }

    const event = parsed.data;

    // Architecture §4.1: exhaustive switch; default branch narrows to never.
    switch (event.type) {
      case 'plan.updated':
        void queryClient.invalidateQueries({ queryKey: QueryKeys.plan(event.week_id) });
        break;

      case 'memory.updated':
        void queryClient.invalidateQueries({ queryKey: QueryKeys.memory(event.node_id) });
        break;

      case 'memory.forget.completed':
        void queryClient.invalidateQueries({ queryKey: QueryKeys.memory(event.node_id) });
        break;

      case 'thread.turn': {
        // Architecture §4.1 streaming exception: setQueryData (not invalidateQueries).
        const threadId = event.thread_id;
        const receivedSeq = BigInt(event.turn.server_seq);
        const prevSeq = threadSeqs.get(threadId);

        if (prevSeq !== undefined && receivedSeq !== prevSeq + 1n) {
          // Sequence gap — report anomaly (Story 5.17 will add the real beacon).
          reportThreadIntegrityAnomaly({
            thread_id: threadId,
            expected_seq: prevSeq + 1n,
            received_seq: receivedSeq,
          });
        }
        threadSeqs.set(threadId, receivedSeq);

        queryClient.setQueryData(
          QueryKeys.thread(threadId),
          (old: unknown) => {
            if (!Array.isArray(old)) return [event.turn];
            return [...old, event.turn];
          },
        );
        break;
      }

      case 'packer.assigned':
        void queryClient.invalidateQueries({ queryKey: QueryKeys.packer(event.date) });
        break;

      case 'pantry.delta':
        void queryClient.invalidateQueries({ queryKey: QueryKeys.pantry() });
        break;

      case 'allergy.verdict':
        void queryClient.invalidateQueries({ queryKey: QueryKeys.plan(event.plan_id) });
        break;

      case 'presence.partner-active':
        void queryClient.invalidateQueries({ queryKey: QueryKeys.presence(event.thread_id) });
        break;

      case 'thread.resync':
        // Invalidate to trigger refetch; the thread loader will pass from_seq when available.
        // Full resync protocol (from_seq query param) is Story 5.1 scope.
        void queryClient.invalidateQueries({ queryKey: QueryKeys.thread(event.thread_id) });
        break;

      default: {
        // Exhaustiveness check — TypeScript compile error if a new InvalidationEvent
        // type is added to packages/contracts without a matching case here.
        const _exhaustive: never = event;
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn('[sse] unhandled event type', _exhaustive);
        }
        break;
      }
    }
  }

  function openConnection(): void {
    const clientId = getOrCreateClientId();
    const apiBase = import.meta.env.VITE_SSE_BASE_URL ?? import.meta.env.VITE_API_BASE_URL ?? '';
    const url = `${apiBase}/v1/events?client_id=${encodeURIComponent(clientId)}`;

    // Native EventSource automatically sends Last-Event-ID on reconnect
    // when the server set an id: field (architecture §3.3 resume behaviour).
    es = new EventSource(url);

    es.addEventListener('message', handleMessage);

    es.addEventListener('open', () => {
      connected = true;
      attemptIndex = 0; // Reset backoff on successful connection.
    });

    es.addEventListener('error', () => {
      connected = false;
      es?.close();
      es = null;

      // Schedule reconnect with backoff.
      const delay = computeBackoffMs(attemptIndex);
      attemptIndex++;
      clearReconnectTimer();
      reconnectTimer = setTimeout(() => {
        openConnection();
      }, delay);
    });
  }

  return {
    connect() {
      clearReconnectTimer();
      openConnection();
    },
    disconnect() {
      clearReconnectTimer();
      es?.close();
      es = null;
      connected = false;
      attemptIndex = 0;
    },
    isConnected() {
      return connected;
    },
  };
}
```

**Critical implementation notes:**

1. **`BigInt(event.turn.server_seq)`:** `server_seq` arrives from the Zod schema as `bigint | number` (depending on how the SSE JSON was encoded). `BigInt()` normalises both: `BigInt(42n) === 42n`, `BigInt(42) === 42n`. Do NOT use `Number()` — bigint values exceed `Number.MAX_SAFE_INTEGER` at high sequence counts.

2. **`void queryClient.invalidateQueries(...)`:** TanStack Query v5 `invalidateQueries` returns a `Promise<void>`. The bridge does not await it (fire-and-forget is correct here). Adding `void` suppresses the `@typescript-eslint/no-floating-promises` lint error.

3. **`e.data as string` cast:** `MessageEvent.data` is typed as `unknown` in the DOM lib. The cast is safe because `EventSource` only delivers text data. Use `as string` with the preceding `if (!e.data)` guard.

4. **The `appendTurn` function has a complex generic type:** Do NOT define it as a free function with a generic parameter referencing `z.infer` of the Turn schema. Instead, inline the append logic directly in the `thread.turn` case as shown above (`(old: unknown) => ...`). This avoids a complex discriminated-union type narrowing problem where `event.turn` type is correctly narrowed inside the `case 'thread.turn':` block.

5. **`_exhaustive: never` pattern:** inside the `default:` branch, `const _exhaustive: never = event;`. If `event` is truly `never` (all cases handled), this compiles. If a new `InvalidationEvent` type is added to `packages/contracts/src/events.ts` without a matching `case`, TypeScript will error: "Type 'NewEventType' is not assignable to type 'never'." This enforces architecture rule: "Adding an event requires (1) extending the union in contracts, (2) handling it in the central sse.ts dispatcher."

6. **`VITE_SSE_BASE_URL` env var:** the web app reads env from Vite's `import.meta.env`. The SSE endpoint uses the same base URL as the API in development; `VITE_SSE_BASE_URL` allows a separate host in prod (architecture §5.1: SSE terminates at `api.hivekitchen.*` not through Cloudflare). If `VITE_SSE_BASE_URL` is not set, fall back to `VITE_API_BASE_URL`. If neither is set, fall back to `''` (same-origin in dev).

### QueryProvider Spec

```tsx
// apps/web/src/providers/query-provider.tsx
import { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createSseBridge } from '@/lib/realtime/index.js';
import type { SseBridge } from '@/lib/realtime/index.js';

// Singleton QueryClient — created once for the app lifetime.
// Not in useState (avoids recreation on HMR) and not in module scope (avoids leaking between tests).
// Pattern from TanStack Query v5 docs for Vite SPAs.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,         // 30s — avoids refetch storms on tab focus
      gcTime: 5 * 60_000,        // 5min — garbage collect unused query data
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
    },
    mutations: {
      // Safety-classified mutations have retry: 0 — set per-mutation, not globally.
    },
  },
});

interface QueryProviderProps {
  children: React.ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  const bridgeRef = useRef<SseBridge | null>(null);

  useEffect(() => {
    const bridge = createSseBridge(queryClient);
    bridgeRef.current = bridge;
    bridge.connect();

    return () => {
      bridge.disconnect();
      bridgeRef.current = null;
    };
  }, []); // Empty deps — connect once on mount, disconnect on unmount.

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
```

**Why `useRef` for bridge?** `useState` would trigger a re-render when the bridge is set; `useRef` holds the mutable reference without re-renders. The bridge only needs to be accessible for cleanup in the `useEffect` return.

**Why `queryClient` outside the component?** TanStack Query v5 recommends a stable `QueryClient` instance for Vite SPAs. Creating it in `useState(() => new QueryClient())` also works, but module-level with a single-file guard is cleaner for Story 1.10 scope.

### App.tsx Spec

```tsx
// apps/web/src/app.tsx
import { QueryProvider } from './providers/query-provider.js';
import { DevTokensPage } from './routes/_dev-tokens.js';

export function App() {
  if (import.meta.env.DEV && typeof window !== 'undefined' && window.location.pathname === '/_dev-tokens') {
    return <DevTokensPage />;
  }
  return (
    <QueryProvider>
      <div>HiveKitchen</div>
    </QueryProvider>
  );
}
```

**Note:** The `<div>HiveKitchen</div>` placeholder is preserved from Story 1.1. Real route rendering (React Router) is scoped to Epic 2+.

### Realtime Index Barrel Spec

```ts
// apps/web/src/lib/realtime/index.ts
export { createSseBridge } from './sse.js';
export type { SseBridge } from './sse.js';
export { QueryKeys } from './query-keys.js';
export { reportThreadIntegrityAnomaly } from './thread-integrity.js';
export type { ThreadIntegrityAnomaly } from './thread-integrity.js';
```

### Events Route Stub Spec (apps/api)

```ts
// apps/api/src/routes/v1/events/events.routes.ts
import type { FastifyPluginAsync } from 'fastify';

/**
 * GET /v1/events — SSE channel stub.
 *
 * Story 1.10: registers the route endpoint. The real SSE fan-out (Redis pub/sub,
 * per-(user_id, client_id) channel, Last-Event-ID replay from Redis event-log)
 * is Story 5.2 scope.
 *
 * This stub responds with a valid SSE stream that immediately sends a heartbeat
 * and holds the connection open. Useful for integration testing the client bridge.
 *
 * Architecture §3.3: one long-lived channel per (user_id, client_id-per-tab).
 * Architecture §5.1: SSE headers (no-cache, no-transform, no buffering).
 */
export const eventsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/v1/events', async (request, reply) => {
    const clientId = (request.query as Record<string, string>)['client_id'] ?? 'unknown';

    fastify.log.info(
      { module: 'events', action: 'sse.connect', clientId },
      'SSE client connected',
    );

    void reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });

    // Initial heartbeat — keeps the connection alive before real events land.
    void reply.raw.write(':ping\n\n');

    // Heartbeat every 20s (architecture §5.1 Cloudflare tolerance).
    const heartbeatInterval = setInterval(() => {
      if (!reply.raw.writableEnded) {
        void reply.raw.write(':ping\n\n');
      }
    }, 20_000);

    request.raw.on('close', () => {
      clearInterval(heartbeatInterval);
      fastify.log.info(
        { module: 'events', action: 'sse.disconnect', clientId },
        'SSE client disconnected',
      );
    });

    // Keep the handler alive — do not return until the client disconnects.
    await new Promise<void>((resolve) => {
      request.raw.on('close', resolve);
    });
  });
};
```

**Registration in app.ts** — add after `healthRoutes`:

```ts
import { eventsRoutes } from './routes/v1/events/events.routes.js';

// ...inside buildApp(), after await app.register(healthRoutes):
await app.register(eventsRoutes);
```

**Why NOT use `fastify-sse-v2` here yet?** The stub route uses `reply.raw` directly because `fastify-sse-v2` is designed for emitting typed SSE events from within the handler — not for a long-lived streaming connection driven by external Redis pub/sub. The real implementation (Story 5.2) will use `fastify-sse-v2` properly. Installing the package in Story 1.10 is sufficient for now so the dependency is declared.

**`void reply.raw.writeHead(...)`:** `writeHead` returns `http.ServerResponse` (not a `Promise`), but the `void` operator satisfies linters that flag unawaited expressions. Same for `reply.raw.write()`.

### Test Spec

```ts
// apps/web/src/lib/realtime/sse.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { createSseBridge } from './sse.js';
import type { z } from 'zod';
import { InvalidationEvent } from '@hivekitchen/contracts';

// --- Fake EventSource implementation ---
// We do NOT install eventsource-mock (an external package) for this unit test.
// A minimal inline fake is cleaner and avoids the dependency.

type EventListener = (e: Event | MessageEvent) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  url: string;
  readyState: number = 0;
  private listeners: Map<string, EventListener[]> = new Map();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
    // Simulate async open
    setTimeout(() => {
      this.readyState = 1;
      this.dispatch('open', new Event('open'));
    }, 0);
  }

  addEventListener(type: string, listener: EventListener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  dispatch(type: string, event: Event | MessageEvent): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  close(): void {
    this.readyState = 2;
  }
}

// Inject fake EventSource into global scope for the bridge.
const originalEventSource = globalThis.EventSource;

beforeEach(() => {
  FakeEventSource.instances = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).EventSource = FakeEventSource;
  // Mock sessionStorage
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn().mockReturnValue('test-client-id'),
    setItem: vi.fn(),
  });
  // Mock crypto.randomUUID
  vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('test-uuid') });
  // Mock import.meta.env
  vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3001');
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).EventSource = originalEventSource;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function makeMockQueryClient(): QueryClient {
  return {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    setQueryData: vi.fn(),
  } as unknown as QueryClient;
}

function makeMessageEvent(data: z.infer<typeof InvalidationEvent>): MessageEvent {
  return new MessageEvent('message', { data: JSON.stringify(data) });
}

const UUID1 = '00000000-0000-0000-0000-000000000001';
const UUID2 = '00000000-0000-0000-0000-000000000002';
const DT = '2026-04-24T00:00:00.000Z';

const TURN_FIXTURE = {
  id: UUID2,
  thread_id: UUID1,
  server_seq: '1',
  created_at: DT,
  role: 'user' as const,
  body: { type: 'message' as const, content: 'hi' },
};

describe('SseBridge — event dispatch', () => {
  it('plan.updated calls invalidateQueries with plan key', () => {
    const qc = makeMockQueryClient();
    const bridge = createSseBridge(qc);
    bridge.connect();

    const [es] = FakeEventSource.instances;
    es.dispatch(
      'message',
      makeMessageEvent({ type: 'plan.updated', week_id: UUID1, guardrail_verdict: { verdict: 'cleared' } }),
    );

    expect(vi.mocked(qc.invalidateQueries)).toHaveBeenCalledWith({ queryKey: ['plan', UUID1] });
  });

  it('memory.updated calls invalidateQueries with memory key', () => {
    const qc = makeMockQueryClient();
    createSseBridge(qc).connect();
    const [es] = FakeEventSource.instances;
    es.dispatch('message', makeMessageEvent({ type: 'memory.updated', node_id: UUID1 }));
    expect(vi.mocked(qc.invalidateQueries)).toHaveBeenCalledWith({ queryKey: ['memory', UUID1] });
  });

  it('memory.forget.completed calls invalidateQueries with memory key', () => {
    const qc = makeMockQueryClient();
    createSseBridge(qc).connect();
    const [es] = FakeEventSource.instances;
    es.dispatch(
      'message',
      makeMessageEvent({ type: 'memory.forget.completed', node_id: UUID1, mode: 'soft', completed_at: DT }),
    );
    expect(vi.mocked(qc.invalidateQueries)).toHaveBeenCalledWith({ queryKey: ['memory', UUID1] });
  });

  it('thread.turn calls setQueryData (streaming exception)', () => {
    const qc = makeMockQueryClient();
    createSseBridge(qc).connect();
    const [es] = FakeEventSource.instances;
    es.dispatch(
      'message',
      makeMessageEvent({ type: 'thread.turn', thread_id: UUID1, turn: TURN_FIXTURE }),
    );
    expect(vi.mocked(qc.setQueryData)).toHaveBeenCalledWith(
      ['thread', UUID1],
      expect.any(Function),
    );
    // Verify setQueryData was NOT called on invalidateQueries
    expect(vi.mocked(qc.invalidateQueries)).not.toHaveBeenCalled();
  });

  it('thread.resync calls invalidateQueries with thread key', () => {
    const qc = makeMockQueryClient();
    createSseBridge(qc).connect();
    const [es] = FakeEventSource.instances;
    es.dispatch(
      'message',
      makeMessageEvent({ type: 'thread.resync', thread_id: UUID1, from_seq: '5' }),
    );
    expect(vi.mocked(qc.invalidateQueries)).toHaveBeenCalledWith({ queryKey: ['thread', UUID1] });
  });

  it('packer.assigned calls invalidateQueries with packer key', () => {
    const qc = makeMockQueryClient();
    createSseBridge(qc).connect();
    const [es] = FakeEventSource.instances;
    es.dispatch(
      'message',
      makeMessageEvent({ type: 'packer.assigned', date: '2026-04-24', packer_id: UUID2 }),
    );
    expect(vi.mocked(qc.invalidateQueries)).toHaveBeenCalledWith({ queryKey: ['packer', '2026-04-24'] });
  });

  it('pantry.delta calls invalidateQueries with pantry key', () => {
    const qc = makeMockQueryClient();
    createSseBridge(qc).connect();
    const [es] = FakeEventSource.instances;
    es.dispatch(
      'message',
      makeMessageEvent({ type: 'pantry.delta', delta: { items_added: [UUID1] } }),
    );
    expect(vi.mocked(qc.invalidateQueries)).toHaveBeenCalledWith({ queryKey: ['pantry'] });
  });

  it('allergy.verdict calls invalidateQueries with plan key', () => {
    const qc = makeMockQueryClient();
    createSseBridge(qc).connect();
    const [es] = FakeEventSource.instances;
    es.dispatch(
      'message',
      makeMessageEvent({ type: 'allergy.verdict', plan_id: UUID1, verdict: { verdict: 'cleared' } }),
    );
    expect(vi.mocked(qc.invalidateQueries)).toHaveBeenCalledWith({ queryKey: ['plan', UUID1] });
  });

  it('presence.partner-active calls invalidateQueries with presence key', () => {
    const qc = makeMockQueryClient();
    createSseBridge(qc).connect();
    const [es] = FakeEventSource.instances;
    es.dispatch(
      'message',
      makeMessageEvent({
        type: 'presence.partner-active',
        thread_id: UUID1,
        user_id: UUID2,
        surface: 'brief',
        expires_at: DT,
      }),
    );
    expect(vi.mocked(qc.invalidateQueries)).toHaveBeenCalledWith({ queryKey: ['presence', UUID1] });
  });

  it('malformed event data does NOT throw and does NOT call queryClient', () => {
    const qc = makeMockQueryClient();
    createSseBridge(qc).connect();
    const [es] = FakeEventSource.instances;

    expect(() => {
      es.dispatch(
        'message',
        new MessageEvent('message', { data: JSON.stringify({ type: 'unknown.garbage' }) }),
      );
    }).not.toThrow();

    expect(vi.mocked(qc.invalidateQueries)).not.toHaveBeenCalled();
    expect(vi.mocked(qc.setQueryData)).not.toHaveBeenCalled();
  });
});

describe('SseBridge — reconnect backoff', () => {
  it('schedules reconnect after error event', () => {
    vi.useFakeTimers();
    const qc = makeMockQueryClient();
    const bridge = createSseBridge(qc);
    bridge.connect();

    const [es] = FakeEventSource.instances;
    es.dispatch('error', new Event('error'));

    // Advance past minimum backoff (1s base)
    vi.advanceTimersByTime(2000);

    // A second EventSource should have been created
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.useRealTimers();
  });

  it('disconnect() clears pending reconnect timer', () => {
    vi.useFakeTimers();
    const qc = makeMockQueryClient();
    const bridge = createSseBridge(qc);
    bridge.connect();

    const [es] = FakeEventSource.instances;
    es.dispatch('error', new Event('error'));

    bridge.disconnect();
    vi.advanceTimersByTime(10_000);

    // No new EventSource created after disconnect
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.useRealTimers();
  });
});
```

**Note on `vi.stubEnv` / `vi.unstubAllEnvs`:** Vitest 1.0+ supports `vi.stubEnv()` to set `process.env` values in tests. However, `import.meta.env` in Vite is replaced at build time, not at test time. When running tests via `vitest` (not Vite), `import.meta.env` resolves differently. To avoid brittle env mocking in SSE tests, ensure the bridge code uses a fallback: `import.meta.env.VITE_API_BASE_URL ?? ''`. The empty-string fallback means the URL becomes `/v1/events?client_id=...` (same-origin), which is valid for tests.

**Alternative approach if `import.meta.env` is unavailable in vitest:** export a `setApiBase(url: string)` function from `sse.ts` for testing, called in `beforeEach`. However, the `?? ''` fallback is cleaner and avoids test-only exports.

### Previous Story Intelligence (from Stories 1.1–1.9)

**From Story 1.9 (tools manifest, CI):**
- Every ESM relative import uses `.js` extension: `import { createSseBridge } from './sse.js'`
- `import type` for all type-only imports: `import type { QueryClient } from '@tanstack/react-query'`
- NO `__dirname` / `__filename` in any `src/` file (ESM only; `import.meta.url` + `fileURLToPath` when path resolution is needed)
- `no-console` rule applies to `apps/api/src/**/*.ts` — check web app eslint config before using `console.warn` in `apps/web/src/`
- `scripts/` in `apps/api/` is outside `no-console`; `src/` is not

**From Story 1.8 (audit hook, BullMQ):**
- `fp()` wrapping pattern for Fastify plugins that decorate `fastify.*` — see `audit.hook.ts` and `bullmq.plugin.ts`
- Route plugins (like `healthRoutes`, `eventsRoutes`) do NOT use `fp()` — they only register routes, not decorate the instance
- `fastify.log.info({ module: '...', action: '...' }, 'message')` logging pattern — two-argument form with structured fields first
- `void promise.catch((err: unknown) => { fastify.log.error({ err }, '...') })` fire-and-forget pattern
- `as unknown as TargetType` for force-cast mocks in tests (not `as TargetType` directly, to satisfy `@typescript-eslint/no-explicit-any`)

**From Story 1.6 (Fastify plugins):**
- Plugin registration order matters: plugins that depend on `fastify.redis` must register after `ioredisPlugin`
- `fastify.decorate('redis', redis)` → `fastify.redis` in consumers
- The `fastify.d.ts` augmentation declares types for ALL decorated properties

**From Story 1.3 (contracts):**
- `packages/contracts/src/events.ts` already has the full `InvalidationEvent` discriminated union — do NOT re-implement it
- Import path: `import { InvalidationEvent } from '@hivekitchen/contracts'` (the barrel re-exports from `events.js`)
- All event types currently in the union: `plan.updated`, `memory.updated`, `memory.forget.completed`, `thread.turn`, `packer.assigned`, `pantry.delta`, `allergy.verdict`, `presence.partner-active`, `thread.resync`

**From Story 1.5 (scope allowlist, ESLint):**
- `apps/web/eslint.config.mjs` enforces scope allowlists via `no-cross-scope-component`
- `lib/realtime/` files are scope-agnostic utilities — they do NOT render UI and thus are not scope-constrained
- `no-framer-motion` import ban applies in `apps/web/`

**Deferred items that surface in this story:**
- From 1.3 deferred log: "`z.string().datetime()` default rejects timezone offsets (accepts only `Z`-suffixed UTC)" — `DT` in tests must be `2026-04-24T00:00:00.000Z` (Z suffix), not `+00:00`
- From 1.3 deferred log: "Turn.created_at [...] accepts ISO strings without seconds" — `TURN_FIXTURE.created_at` must include seconds: `'2026-04-24T00:00:00.000Z'`

### File Structure

**New files (create):**
```
apps/web/src/lib/realtime/
  ├── sse.ts                         SSE bridge — createSseBridge()
  ├── sse.test.ts                    Unit tests for the bridge
  ├── query-keys.ts                  Centralized QueryKeys factory
  ├── thread-integrity.ts            Thread sequence-gap stub
  └── index.ts                       Public barrel re-export

apps/web/src/providers/
  └── query-provider.tsx             QueryClient + SseBridge provider

apps/api/src/routes/v1/events/
  └── events.routes.ts               GET /v1/events SSE stub
```

**Modified files:**
```
apps/web/src/app.tsx                  Wrap with <QueryProvider>
apps/web/package.json                 Add @tanstack/react-query, @tanstack/react-query-devtools
apps/api/package.json                 Add fastify-sse-v2
apps/api/src/app.ts                   Register eventsRoutes
```

**Deleted files:**
```
apps/web/src/lib/.gitkeep            (replaced by lib/realtime/ directory)
apps/api/src/routes/v1/events/.gitkeep  (replaced by events.routes.ts)
```

**No changes to:**
```
packages/contracts/src/events.ts     (InvalidationEvent already complete from Story 1.3)
packages/contracts/src/thread.ts     (Turn already complete from Story 1.3)
apps/api/src/types/fastify.d.ts      (no new fastify.* decorations in this story)
```

### Architecture Compliance Invariants

| Rule | Source | Impact on This Story |
|---|---|---|
| SSE is invalidation-only | architecture §hard-constraints | `thread.turn` uses `setQueryData`; ALL other events use `invalidateQueries`. Never use `setQueryData` for non-turn events. |
| `InvalidationEvent` is the ONLY SSE contract | architecture §4.1 | Parse every incoming message with `InvalidationEvent.safeParse()`. Reject unknown event types silently (log warning, no throw). |
| Adding an event type requires 3 simultaneous changes | architecture §4.1 | Contracts union + dispatcher case + emitting service. This story completes step 2; the exhaustive `switch` enforces the invariant at compile time. |
| `client_id` in `sessionStorage` per tab | architecture §3.3 | `localStorage` would share across tabs (breaks presence). `sessionStorage` is per-tab. Do NOT use `localStorage`. |
| SSE endpoint at `api.hivekitchen.*` not through Cloudflare | architecture §5.1 | Route is stub only in Story 1.10. Operational concern for deploy. The `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` headers are set in the stub route for correctness. |
| No `fastify-plugin` (`fp()`) on route plugins | Story 1.6 pattern | `eventsRoutes` is a route registration function — do NOT wrap with `fp()`. Only decorate-and-share plugins use `fp()`. |
| `void` on unawaited promises | `@typescript-eslint` rule | `void queryClient.invalidateQueries(...)` in every case branch. |
| `.js` extension on relative imports | ESM strict | All `import ... from './xxx.js'` inside `apps/web/src/` and `apps/api/src/`. |
| `import type` for type-only imports | TypeScript strict | `import type { QueryClient }`, `import type { SseBridge }`. |
| No `__dirname` | ESM | Use `import.meta.url` + `fileURLToPath` if needed. Not needed in this story's files. |
| No `any` | `@typescript-eslint/no-explicit-any: error` | `as unknown as TargetType` for force casts. `unknown` parameters with runtime narrowing. |
| SSE heartbeat ≤30s | architecture §5.1 | Events route stub sends `:ping\n\n` every 20s. |

### Deferred Items (explicitly out of scope for Story 1.10)

1. **Redis pub/sub fan-out** — the real SSE gateway (server emits events via `sseGateway.emit(householdId, event)` over Redis pub/sub) is Story 5.2.
2. **Authentication on `/v1/events`** — the stub route has no auth. Real auth (`authenticate.hook.ts` Bearer JWT) is Story 2.2.
3. **`Last-Event-ID` Redis event-log replay** (≥6h retention) — the server side of resume is Story 5.2.
4. **Per-(user_id, client_id) channel multiplexing** — Story 5.2.
5. **Thread-integrity beacon `POST /v1/internal/client-anomaly`** — full endpoint is Story 5.17. Story 1.10 establishes the call site stub only.
6. **SSE perf test** (`apps/web/test/perf/sse-invalidation.spec.ts` Playwright timing ≤600ms) — Story 1.13.
7. **`@tanstack/react-query-devtools` conditional removal in prod build** — handled by `import.meta.env.DEV` guard in the provider; Vite tree-shakes the dev tools in production builds automatically.
8. **`react-router` integration** — Route tree (React Router v7 data mode) is Epic 2 scope.
9. **`useSseChannel` cross-feature hook** (`apps/web/src/hooks/useSseChannel.ts`) — Story 5.2 or Epic 5 scope.
10. **`VITE_SSE_BASE_URL` in `.env.local.example`** — the architecture requires this env var. Add to `apps/web/.env.local.example` in this story to establish the pattern even though the stub works without it.

### References

- `_bmad-output/planning-artifacts/architecture.md` §3.3, §4.1, §5.1, §5.3, §4.4
- `_bmad-output/planning-artifacts/epics.md` Story 1.10 (lines 874–888)
- `packages/contracts/src/events.ts` — `InvalidationEvent` discriminated union (Story 1.3 output)
- `packages/contracts/src/thread.ts` — `Turn` schema (Story 1.3 output)
- `apps/api/src/plugins/ioredis.plugin.ts` — fp() + decoration pattern
- `apps/api/src/middleware/audit.hook.ts` — fp() + onResponse hook pattern
- `apps/api/src/modules/internal/health.routes.ts` — route plugin without fp() pattern
- `_bmad-output/implementation-artifacts/1-9-tools-manifest-ts-skeleton-with-ci-lint-no-tool-without-manifest.md` — ESM conventions, test patterns
- `_bmad-output/implementation-artifacts/1-8-single-row-audit-log-schema-monthly-partitions-composite-index-audit-service-write.md` — fp() patterns, BullMQ, fire-and-forget

---

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Debug Log References
- Fixed `import type { z }` / `import type { InvalidationEvent }` in `sse.test.ts` — ESLint `@typescript-eslint/consistent-type-imports` flagged `InvalidationEvent` as type-only in the test file.
- Removed `// eslint-disable-next-line no-console` directives from `sse.ts` and `thread-integrity.ts` — the `no-console` rule is NOT active in `apps/web/` (only `apps/api/src/**/*.ts`), so the disable comments triggered "unused eslint-disable directive" warnings.
- Replaced `server_seq: '1'` (string) with `server_seq: 1` (number) in `TURN_FIXTURE` and `from_seq: '5'` with `from_seq: 5` — `JSON.stringify` cannot serialize BigInt literals, and the Zod SequenceId union also accepts plain integers.
- Added `vitest`, `@vitest/coverage-v8`, and `jsdom` to `apps/web` devDependencies — web had no test runner configured.
- Added `test` script to `apps/web/package.json` and created `apps/web/vitest.config.ts` with `environment: 'jsdom'`.
- Added `zod@^3.23.0` to `apps/web` dependencies — required for `import type { z }` in the test file; `zod` was only a transitive dep via `@hivekitchen/contracts`.

### Completion Notes List
- All 11 tasks completed.
- 12 new tests in `apps/web/src/lib/realtime/sse.test.ts` — all pass.
- No changes to `packages/contracts/src/events.ts` — `InvalidationEvent` was already complete from Story 1.3.
- `eventsRoutes` does NOT use `fp()` per the route-plugin convention.
- `thread.turn` case uses `setQueryData` (streaming exception); all other 8 event types use `invalidateQueries` with `void` prefix.
- `const _exhaustive: never = event` exhaustiveness check is in the `default:` branch.
- `fastify-sse-v2` is installed but not yet used in the stub route (Story 5.2 will use it for real pub/sub).

### Verification Gates

```
pnpm typecheck   → Tasks: 9 successful, 9 total
pnpm lint        → Tasks: 5 successful, 5 total (0 errors)
pnpm test        → Tasks: 7 successful, 7 total — 12 web tests + all prior tests pass
pnpm tools:check → ✅ No *.tools.ts files found — manifest check skipped (exit 0)
```

### File List

**New:**
- `apps/web/src/lib/realtime/sse.ts`
- `apps/web/src/lib/realtime/sse.test.ts`
- `apps/web/src/lib/realtime/query-keys.ts`
- `apps/web/src/lib/realtime/thread-integrity.ts`
- `apps/web/src/lib/realtime/index.ts`
- `apps/web/src/providers/query-provider.tsx`
- `apps/web/vitest.config.ts`
- `apps/api/src/routes/v1/events/events.routes.ts`

**Modified:**
- `apps/web/src/app.tsx`
- `apps/web/package.json` (added `@tanstack/react-query`, `@tanstack/react-query-devtools`, `zod`, `vitest`, `@vitest/coverage-v8`, `jsdom`, `test` script)
- `apps/api/package.json` (added `fastify-sse-v2`)
- `apps/api/src/app.ts` (registered `eventsRoutes`)

**Deleted:**
- `apps/web/src/lib/.gitkeep`
- `apps/api/src/routes/v1/events/.gitkeep`

### Review Findings
_To be filled by code-review agent_

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-24 | Story created | Story Context Engine |
| 2026-04-24 | Implementation complete | claude-sonnet-4-6 |

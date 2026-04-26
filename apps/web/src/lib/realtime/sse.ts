// apps/web/src/lib/realtime/sse.ts
import type { QueryClient } from '@tanstack/react-query';
import { InvalidationEvent } from '@hivekitchen/contracts';
import { QueryKeys } from './query-keys.js';
import { reportThreadIntegrityAnomaly } from './thread-integrity.js';

// Architecture §3.3: client_id in sessionStorage, one per tab.
const CLIENT_ID_KEY = 'hk:client_id';

function fallbackUuidV4(): string {
  // RFC 4122 v4 layout from Math.random — used only when crypto.randomUUID
  // is unavailable (insecure context, sandboxed iframe, ancient browser).
  const bytes = new Array<number>(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

function safeRandomUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // crypto.randomUUID throws in non-secure contexts (HTTP, sandboxed iframes).
  }
  return fallbackUuidV4();
}

function getOrCreateClientId(): string {
  // sessionStorage access can throw SecurityError in restricted contexts
  // (Safari Private mode, third-party iframes, storage-disabled sites).
  // Fall back to an in-memory id for the bridge's lifetime.
  try {
    const existing = sessionStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const fresh = safeRandomUuid();
    sessionStorage.setItem(CLIENT_ID_KEY, fresh);
    return fresh;
  } catch {
    return safeRandomUuid();
  }
}

// Architecture §5.3: reconnect backoff 1s × 2× ±20% jitter, hard cap 60s.
function computeBackoffMs(attemptIndex: number): number {
  const base = 1000; // 1s
  const cap = 60_000; // 60s
  const raw = base * Math.pow(2, attemptIndex);
  const capped = Math.min(raw, cap);
  // ±20% jitter
  const jitter = capped * 0.2 * (Math.random() * 2 - 1);
  // Floor at base, then ceiling at cap so jitter cannot push us past 60s.
  return Math.min(cap, Math.max(base, Math.round(capped + jitter)));
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
  let disposed = false;
  const threadSeqs: ThreadSeqMap = new Map();

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function closeEventSource(): void {
    if (es !== null) {
      es.close();
      es = null;
    }
  }

  function handleMessage(e: MessageEvent): void {
    // Guard against empty heartbeat data (:ping frames have no data).
    if (!e.data) return;

    let raw: unknown;
    try {
      raw = JSON.parse(e.data as string);
    } catch (err) {
      // Non-JSON frame (truncation, partial UTF-8, server bug). Swallow in
      // prod; surface in dev so the operator can find the cause.
      if (import.meta.env.DEV) {
        console.warn('[sse] failed to JSON.parse event data', err, e.data);
      }
      return;
    }

    const parsed = InvalidationEvent.safeParse(raw);

    if (!parsed.success) {
      // Malformed event — log in dev, swallow silently in prod.
      if (import.meta.env.DEV) {
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
          // Sequence anomaly (gap, duplicate, or out-of-order).
          // Story 5.17 will replace the stub with a real beacon.
          reportThreadIntegrityAnomaly({
            thread_id: threadId,
            expected_seq: prevSeq + 1n,
            received_seq: receivedSeq,
          });
        }
        // Only advance the cursor on forward progress; out-of-order/duplicate
        // events must not regress the gap-detection baseline.
        if (prevSeq === undefined || receivedSeq > prevSeq) {
          threadSeqs.set(threadId, receivedSeq);
        }

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
        // Resync invalidates the local sequence cursor; the next thread.turn
        // re-seeds it (Story 5.1 will plumb from_seq into the loader).
        threadSeqs.delete(event.thread_id);
        void queryClient.invalidateQueries({ queryKey: QueryKeys.thread(event.thread_id) });
        break;

      case 'voice.session.started':
      case 'voice.session.ended':
        // Story 5.2 will wire Redis pub/sub fan-out. For now these events are logged only.
        break;

      default: {
        // Exhaustiveness check — TypeScript compile error if a new InvalidationEvent
        // type is added to packages/contracts without a matching case here.
        const _exhaustive: never = event;
        if (import.meta.env.DEV) {
          console.warn('[sse] unhandled event type', _exhaustive);
        }
        break;
      }
    }
  }

  function openConnection(): void {
    if (disposed) return;

    if (typeof EventSource === 'undefined') {
      if (import.meta.env.DEV) {
        console.warn('[sse] EventSource is not available in this environment');
      }
      return;
    }

    const clientId = getOrCreateClientId();
    const apiBase = import.meta.env.VITE_SSE_BASE_URL ?? import.meta.env.VITE_API_BASE_URL ?? '';
    const url = `${apiBase}/v1/events?client_id=${encodeURIComponent(clientId)}`;

    // Native EventSource automatically sends Last-Event-ID on reconnect
    // when the server set an id: field (architecture §3.3 resume behaviour).
    es = new EventSource(url);

    es.addEventListener('message', handleMessage);

    es.addEventListener('open', () => {
      if (disposed) return;
      connected = true;
      attemptIndex = 0; // Reset backoff on successful connection.
    });

    es.addEventListener('error', () => {
      connected = false;
      closeEventSource();

      // disconnect() may have fired between the network error and this handler.
      if (disposed) return;

      // Schedule reconnect with backoff.
      const delay = computeBackoffMs(attemptIndex);
      attemptIndex++;
      clearReconnectTimer();
      reconnectTimer = setTimeout(() => {
        if (disposed) return;
        openConnection();
      }, delay);
    });
  }

  return {
    connect() {
      // Re-arm after a disconnect, and tolerate accidental double-connect.
      disposed = false;
      clearReconnectTimer();
      closeEventSource();
      openConnection();
    },
    disconnect() {
      disposed = true;
      clearReconnectTimer();
      closeEventSource();
      connected = false;
      attemptIndex = 0;
    },
    isConnected() {
      return connected;
    },
  };
}

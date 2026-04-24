// apps/web/src/lib/realtime/sse.ts
import type { QueryClient } from '@tanstack/react-query';
import { InvalidationEvent } from '@hivekitchen/contracts';
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

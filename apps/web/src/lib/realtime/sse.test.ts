// apps/web/src/lib/realtime/sse.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { createSseBridge } from './sse.js';
import type { z } from 'zod';
import type { InvalidationEvent } from '@hivekitchen/contracts';

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
  server_seq: 1,
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
      makeMessageEvent({ type: 'thread.resync', thread_id: UUID1, from_seq: 5 }),
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

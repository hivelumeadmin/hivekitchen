import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLumiStore } from '@/stores/lumi.store.js';
import { useLumiNudgeSSE } from './useLumiNudgeSSE.js';

type Listener = (e: Event | MessageEvent) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  url: string;
  closed = false;
  private listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((l) => l !== listener),
    );
  }

  emit(type: string, data: string): void {
    for (const l of this.listeners.get(type) ?? []) {
      l(new MessageEvent(type, { data }));
    }
  }

  hasListener(type: string): boolean {
    return (this.listeners.get(type) ?? []).length > 0;
  }

  close(): void {
    this.closed = true;
  }
}

const TURN = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  thread_id: '11111111-1111-4111-8111-111111111111',
  server_seq: 1,
  created_at: '2026-06-06T00:00:00.000Z',
  role: 'lumi' as const,
  body: { type: 'message' as const, content: 'Your plan is ready.' },
};

function nudgePayload(surface = 'brief'): string {
  return JSON.stringify({ type: 'lumi.nudge', turn: TURN, surface });
}

const originalEventSource = globalThis.EventSource;

beforeEach(() => {
  FakeEventSource.instances = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).EventSource = FakeEventSource;
  vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('test-uuid') });
  vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3001');
  useLumiStore.getState().reset();
});

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).EventSource = originalEventSource;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('useLumiNudgeSSE', () => {
  it('opens an EventSource and listens for lumi.nudge when a token is present', () => {
    renderHook(() => useLumiNudgeSSE('token-1'));

    expect(FakeEventSource.instances).toHaveLength(1);
    const es = FakeEventSource.instances[0]!;
    expect(es.url).toContain('/v1/events');
    expect(es.url).toContain('token=token-1');
    expect(es.hasListener('lumi.nudge')).toBe(true);
  });

  it('does not create an EventSource when the token is null', () => {
    renderHook(() => useLumiNudgeSSE(null));

    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('sets pendingNudge from a valid lumi.nudge event', () => {
    renderHook(() => useLumiNudgeSSE('token-1'));
    FakeEventSource.instances[0]!.emit('lumi.nudge', nudgePayload());

    expect(useLumiStore.getState().pendingNudge?.id).toBe(TURN.id);
  });

  it('appends the turn live when the panel is open on the matching surface', () => {
    useLumiStore.setState({ isPanelOpen: true, surface: 'brief' });
    renderHook(() => useLumiNudgeSSE('token-1'));

    FakeEventSource.instances[0]!.emit('lumi.nudge', nudgePayload('brief'));

    expect(useLumiStore.getState().turns).toHaveLength(1);
  });

  it('does not append when the panel is closed', () => {
    renderHook(() => useLumiNudgeSSE('token-1'));

    FakeEventSource.instances[0]!.emit('lumi.nudge', nudgePayload('brief'));

    expect(useLumiStore.getState().turns).toHaveLength(0);
    expect(useLumiStore.getState().pendingNudge?.id).toBe(TURN.id);
  });

  it('does not append when the panel is open on a different surface', () => {
    useLumiStore.setState({ isPanelOpen: true, surface: 'planning' });
    renderHook(() => useLumiNudgeSSE('token-1'));

    FakeEventSource.instances[0]!.emit('lumi.nudge', nudgePayload('brief'));

    expect(useLumiStore.getState().turns).toHaveLength(0);
  });

  it('ignores a malformed event without throwing or mutating state', () => {
    renderHook(() => useLumiNudgeSSE('token-1'));

    expect(() => FakeEventSource.instances[0]!.emit('lumi.nudge', 'not json{')).not.toThrow();
    expect(useLumiStore.getState().pendingNudge).toBeNull();
  });

  it('closes the old EventSource and opens a new one when the token changes', () => {
    const { rerender } = renderHook(({ token }) => useLumiNudgeSSE(token), {
      initialProps: { token: 'token-1' as string | null },
    });

    const first = FakeEventSource.instances[0]!;
    rerender({ token: 'token-2' });

    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]!.url).toContain('token=token-2');
  });

  it('closes the EventSource on unmount', () => {
    const { unmount } = renderHook(() => useLumiNudgeSSE('token-1'));
    const es = FakeEventSource.instances[0]!;

    unmount();

    expect(es.closed).toBe(true);
  });
});

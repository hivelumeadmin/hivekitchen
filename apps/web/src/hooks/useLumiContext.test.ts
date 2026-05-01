import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { LumiContextSignal, Turn } from '@hivekitchen/types';
import { useLumiStore } from '@/stores/lumi.store.js';
import { useLumiContext } from './useLumiContext.js';

vi.mock('@/lib/fetch.js', () => ({
  hkFetch: vi.fn(),
}));

const generalSignal: LumiContextSignal = { surface: 'general' };

const TURN_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const THREAD_ID = '11111111-1111-4111-8111-111111111111';

const turn = (id: string, content: string): Turn =>
  ({
    id,
    thread_id: THREAD_ID,
    server_seq: 1,
    role: 'user',
    body: { type: 'message', content },
    created_at: '2026-04-30T00:00:00.000Z',
  }) as unknown as Turn;

beforeEach(() => {
  useLumiStore.getState().reset();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useLumiContext', () => {
  it('calls setContext with the provided signal on mount (AC #1)', () => {
    const setContextSpy = vi.spyOn(useLumiStore.getState(), 'setContext');

    renderHook(() => useLumiContext(generalSignal));

    expect(setContextSpy).toHaveBeenCalledWith(generalSignal);
    expect(useLumiStore.getState().surface).toBe('general');
    expect(useLumiStore.getState().contextSignal).toEqual(generalSignal);
  });

  it('does NOT fetch when threadIds[surface] is undefined (AC #5)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');

    renderHook(() => useLumiContext(generalSignal));

    expect(useLumiStore.getState().threadIds.general).toBeUndefined();
    expect(hkFetch).not.toHaveBeenCalled();
    expect(useLumiStore.getState().isHydrating).toBe(false);
  });

  it('fetches GET /v1/lumi/threads/:id/turns when threadIds[surface] is known (AC #3)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      thread_id: THREAD_ID,
      turns: [],
    });
    useLumiStore.setState({ threadIds: { general: THREAD_ID } });

    renderHook(() => useLumiContext(generalSignal));

    await waitFor(() => {
      expect(hkFetch).toHaveBeenCalledWith(
        `/v1/lumi/threads/${THREAD_ID}/turns`,
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  it('calls hydrateThread(surface, threadId, turns) on successful fetch (AC #3)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    const turns = [turn(TURN_A_ID, 'a'), turn(TURN_B_ID, 'b')];
    vi.mocked(hkFetch).mockResolvedValue({
      thread_id: THREAD_ID,
      turns,
    });
    useLumiStore.setState({ threadIds: { general: THREAD_ID } });

    renderHook(() => useLumiContext(generalSignal));

    await waitFor(() => {
      expect(useLumiStore.getState().turns).toEqual(turns);
    });
    expect(useLumiStore.getState().threadIds.general).toBe(THREAD_ID);
    expect(useLumiStore.getState().isHydrating).toBe(false);
  });

  it('sets isHydrating: true while fetch is in flight, then false after success', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    let resolveFetch: ((value: unknown) => void) | undefined;
    vi.mocked(hkFetch).mockImplementation(
      () =>
        new Promise((res) => {
          resolveFetch = res;
        }),
    );
    useLumiStore.setState({ threadIds: { general: THREAD_ID } });

    renderHook(() => useLumiContext(generalSignal));

    await waitFor(() => {
      expect(useLumiStore.getState().isHydrating).toBe(true);
    });

    resolveFetch?.({ thread_id: THREAD_ID, turns: [] });
    await waitFor(() => {
      expect(useLumiStore.getState().isHydrating).toBe(false);
    });
  });

  it('resets isHydrating: false on fetch error (non-abort) and warns (AC #4)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(hkFetch).mockRejectedValue(new Error('network'));
    useLumiStore.setState({ threadIds: { general: THREAD_ID } });

    renderHook(() => useLumiContext(generalSignal));

    await waitFor(() => {
      expect(useLumiStore.getState().isHydrating).toBe(false);
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('aborts fetch and resets isHydrating on unmount mid-flight (AC #4)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(hkFetch).mockImplementation((_path, init) => {
      capturedSignal = init.signal;
      return new Promise((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    useLumiStore.setState({ threadIds: { general: THREAD_ID } });

    const { unmount } = renderHook(() => useLumiContext(generalSignal));

    await waitFor(() => {
      expect(useLumiStore.getState().isHydrating).toBe(true);
    });

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
    await waitFor(() => {
      expect(useLumiStore.getState().isHydrating).toBe(false);
    });
  });

  it('does not start a second fetch when isHydrating is already true (AC #6)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ thread_id: THREAD_ID, turns: [] });
    // isHydrating: true simulates a concurrent hydration already in flight
    useLumiStore.setState({ threadIds: { general: THREAD_ID }, isHydrating: true });

    renderHook(() => useLumiContext(generalSignal));

    // Guard reads isHydrating before setContext clears it — fetch must not fire.
    await Promise.resolve();
    await Promise.resolve();
    expect(hkFetch).not.toHaveBeenCalled();
  });

  it('does not re-run effect or fetch on re-render with same surface (AC #2)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ thread_id: THREAD_ID, turns: [] });
    useLumiStore.setState({ threadIds: { general: THREAD_ID } });

    const setContextSpy = vi.spyOn(useLumiStore.getState(), 'setContext');
    const { rerender } = renderHook(() => useLumiContext(generalSignal));

    await waitFor(() => expect(useLumiStore.getState().isHydrating).toBe(false));

    rerender();
    rerender();

    expect(setContextSpy).toHaveBeenCalledTimes(1);
    expect(hkFetch).toHaveBeenCalledTimes(1);
  });

  it('resets isHydrating: false and warns when Zod parse fails on malformed response', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(hkFetch).mockResolvedValue({ turns: 'not-an-array' });
    useLumiStore.setState({ threadIds: { general: THREAD_ID } });

    renderHook(() => useLumiContext(generalSignal));

    await waitFor(() => {
      expect(useLumiStore.getState().isHydrating).toBe(false);
    });
    expect(warnSpy).toHaveBeenCalled();
    expect(useLumiStore.getState().turns).toEqual([]);
  });
});

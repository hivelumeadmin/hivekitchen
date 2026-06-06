import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLumiStore } from '@/stores/lumi.store.js';
import { useLumiVoiceSession } from './useLumiVoiceSession.js';

// ── WebSocket mock ────────────────────────────────────────────────────────

interface MockWs {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  _listeners: Record<string, ((...args: unknown[]) => void)[]>;
  _emit: (type: string, ...args: unknown[]) => void;
}

function createMockWs(): MockWs {
  const ws: MockWs = {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 0, // CONNECTING
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    _listeners: {},
    _emit(type, ...args) {
      (this._listeners[type] ?? []).forEach((cb) => cb(...args));
    },
  };
  ws.addEventListener.mockImplementation((type: string, cb: (...args: unknown[]) => void) => {
    ws._listeners[type] = [...(ws._listeners[type] ?? []), cb];
  });
  return ws;
}

// Track created WebSocket instances in order (0 = TTS, 1 = STT)
let wsInstances: MockWs[] = [];

// ── VAD mock ──────────────────────────────────────────────────────────────

const mockVad = {
  start: vi.fn(),
  pause: vi.fn(),
  destroy: vi.fn(),
  userSpeaking: false,
  loading: false,
  errored: false,
};

vi.mock('@ricky0123/vad-react', () => ({
  useMicVAD: vi.fn(() => mockVad),
}));

// ── Helpers ───────────────────────────────────────────────────────────────

/** Flush N microtask ticks so that `await`-based async chains advance. */
async function flush(n = 3) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// ── Fixtures ──────────────────────────────────────────────────────────────

const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const THREAD_ID  = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_TURN_ID  = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LUMI_TURN_ID  = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function makeSessionResponse() {
  return {
    talk_session_id: SESSION_ID,
    stt_token: 'wss://stt.example.com/token',
    tts_token: 'tts-tok',
    voice_id: 'voice-abc',
  };
}

function makeTurnResponse(userText = 'hello', lumiText = 'Got it.') {
  return {
    thread_id: THREAD_ID,
    user_turn: {
      id: USER_TURN_ID,
      thread_id: THREAD_ID,
      server_seq: 1,
      created_at: '2026-06-05T00:00:00.000Z',
      role: 'user',
      body: { type: 'message', content: userText },
    },
    lumi_turn: {
      id: LUMI_TURN_ID,
      thread_id: THREAD_ID,
      server_seq: 2,
      created_at: '2026-06-05T00:00:01.000Z',
      role: 'lumi',
      body: { type: 'message', content: lumiText },
    },
  };
}

/**
 * Fake Response whose `.json()` returns an IMMEDIATELY resolved Promise.
 * Using the real `new Response(JSON.stringify(...))` causes jsdom's ReadableStream
 * consumption to take an indeterminate number of microtask ticks, which makes
 * microtask-counting flushes unreliable. This shim keeps test timing deterministic.
 */
function fakeJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function fake204Response(): Response {
  // hkFetch short-circuits on 204 before calling .json(), so no json method needed.
  return { ok: true, status: 204 } as unknown as Response;
}

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

// ── Tests ─────────────────────────────────────────────────────────────────

describe('useLumiVoiceSession', () => {
  beforeEach(() => {
    useLumiStore.getState().reset();
    mockVad.start.mockClear();
    mockVad.pause.mockClear();
    wsInstances = [];

    // Use `function` keyword so the mock works as a `new`-able constructor.
    // eslint-disable-next-line prefer-arrow-callback
    globalThis.WebSocket = vi.fn().mockImplementation(function mockWebSocket() {
      const ws = createMockWs();
      wsInstances.push(ws);
      return ws;
    }) as unknown as typeof WebSocket;
    // @ts-expect-error test-only constant
    globalThis.WebSocket.OPEN = 1;
    // @ts-expect-error test-only constant
    globalThis.WebSocket.CONNECTING = 0;

    // AudioContext is not available in jsdom — mock the minimal surface used
    // by openTtsWs's 'open' handler and endSession's cleanup.
    const audioCtxMock = {
      resume: vi.fn().mockResolvedValue(undefined),
      createBuffer: vi.fn().mockReturnValue({ copyToChannel: vi.fn(), duration: 0.1 }),
      createBufferSource: vi.fn().mockReturnValue({
        buffer: null, connect: vi.fn(), start: vi.fn(),
      }),
      currentTime: 0,
      destination: {},
      close: vi.fn().mockResolvedValue(undefined),
    };
    // eslint-disable-next-line prefer-arrow-callback
    globalThis.AudioContext = vi.fn().mockImplementation(function mockAudioContext() {
      return audioCtxMock;
    }) as unknown as typeof AudioContext;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // ── Shared setup helpers ────────────────────────────────────────────────

  /**
   * Kicks off startSession and flushes enough microtask ticks for hkFetch to
   * resolve and both WebSocket instances to be created. The hook suspends at
   * Promise.all waiting for the 'open' events.
   *
   * Microtask budget with fakeJsonResponse (immediately-resolved .json()):
   *   tick 1 → hkFetch's `await fetch(url)` resolves → hits `await res.json()`
   *   tick 2 → res.json() resolves → startSession resumes, creates both WS,
   *             hits `await Promise.all([...])`
   */
  async function startSessionAndFlushToWsCreation(
    result: { current: ReturnType<typeof useLumiVoiceSession> },
    signal: Parameters<typeof result.current.startSession>[0] = { surface: 'planning' },
  ) {
    await act(async () => {
      void result.current.startSession(signal);
      await flush(3); // 2 ticks needed + 1 spare
    });
  }

  /**
   * Fires the 'open' event on all created WebSockets and flushes the resulting
   * Promise.all resolution + post-connect code (setVoiceStatus, vad.start,
   * resetInactivityTimer).
   */
  async function openAllWs() {
    await act(async () => {
      for (const ws of wsInstances) {
        ws.readyState = 1; // OPEN
        ws._emit('open');
      }
      await flush(3); // flush Promise.all resolve + setVoiceStatus + vad.start
    });
  }

  // ── Tests ──────────────────────────────────────────────────────────────

  it('startSession calls POST /v1/lumi/voice/sessions with context_signal', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(fakeJsonResponse(makeSessionResponse()));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError: vi.fn() }),
    );

    await act(async () => {
      void result.current.startSession({ surface: 'planning' });
    });

    expect(fetchSpy).toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/v1/lumi/voice/sessions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      context_signal: { surface: 'planning' },
    });
  });

  it('startSession with 403 response calls onError with Premium copy; no WS opened, no talkSessionId', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeJsonResponse({ type: '/errors/forbidden' }, 403),
    ) as unknown as typeof fetch;

    const onError = vi.fn();
    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError }),
    );

    await act(async () => {
      await result.current.startSession({ surface: 'planning' });
    });

    expect(onError).toHaveBeenCalledWith(
      "Voice chat is part of Premium. We've got you in text — same Lumi.",
    );
    expect(wsInstances).toHaveLength(0);
    expect(useLumiStore.getState().talkSessionId).toBeNull();
  });

  it('startSession on success opens both WS connections and transitions store connecting → active', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeJsonResponse(makeSessionResponse()),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError: vi.fn() }),
    );

    await startSessionAndFlushToWsCreation(result);

    expect(wsInstances).toHaveLength(2);
    expect(useLumiStore.getState().talkSessionId).toBe(SESSION_ID);
    expect(useLumiStore.getState().voiceStatus).toBe('connecting');

    await openAllWs();

    expect(useLumiStore.getState().voiceStatus).toBe('active');
    expect(mockVad.start).toHaveBeenCalledTimes(1);
  });

  it('endSession closes both WS connections, calls DELETE, and resets store', async () => {
    useLumiStore.getState().setTalkSession(SESSION_ID);
    useLumiStore.getState().setVoiceStatus('active');

    globalThis.fetch = vi.fn().mockResolvedValue(fake204Response()) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError: vi.fn() }),
    );

    await act(async () => {
      await result.current.endSession();
    });

    expect(mockVad.pause).toHaveBeenCalledTimes(1);
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    const deleteCalls = fetchSpy.mock.calls.filter((args: unknown[]) =>
      String(args[0]).includes(`/v1/lumi/voice/sessions/${SESSION_ID}`),
    );
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][1].method).toBe('DELETE');
    expect(useLumiStore.getState().voiceStatus).toBe('idle');
    expect(useLumiStore.getState().talkSessionId).toBeNull();
  });

  it('receiving a transcript triggers onTranscript → POST /v1/lumi/turns → onLumiReply', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(fakeJsonResponse(makeSessionResponse()))
      .mockResolvedValueOnce(fakeJsonResponse(makeTurnResponse('hello', 'Got it.')));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const onTranscript = vi.fn();
    const onLumiReply = vi.fn();

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript, onLumiReply, onError: vi.fn() }),
    );

    await startSessionAndFlushToWsCreation(result);
    await openAllWs();
    expect(useLumiStore.getState().voiceStatus).toBe('active');

    const sttWs = wsInstances[1]!;
    await act(async () => {
      sttWs._emit('message', {
        data: JSON.stringify({ type: 'user_transcript', user_transcript: 'hello' }),
      } as MessageEvent);
      // onTranscript fires synchronously inside handleTranscript (before its first await)
      // onLumiReply fires after hkFetch resolves — 2 more ticks
      await flush(5);
    });

    expect(onTranscript).toHaveBeenCalledWith('hello');
    expect(onLumiReply).toHaveBeenCalledWith('Got it.');
  });

  it('20s inactivity timer fires endSession when no speech is detected', async () => {
    // Only fake timer APIs — Promises/microtasks are unaffected so flush() still works.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(fakeJsonResponse(makeSessionResponse()))  // POST /voice/sessions
      .mockResolvedValue(fake204Response());                            // DELETE /voice/sessions/:id
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError: vi.fn() }),
    );

    await startSessionAndFlushToWsCreation(result);
    await openAllWs();
    expect(useLumiStore.getState().voiceStatus).toBe('active');

    // Advance past 20s: fires the inactivity timeout callback synchronously.
    // endSession's async chain: AudioContext.close (1 tick) + DELETE fetch
    // (1 tick for the already-resolved fetch mock + 204 short-circuit) +
    // endTalkSession (sync). Under fake timers, Promise microtasks still flush.
    await act(async () => {
      vi.advanceTimersByTime(20_001);
      await flush(6);
    });

    expect(useLumiStore.getState().voiceStatus).toBe('idle');
    expect(useLumiStore.getState().talkSessionId).toBeNull();
  });

  it('WS connect error triggers cleanup AND preserves error state (voiceStatus error, voiceError set, DELETE called)', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(fakeJsonResponse(makeSessionResponse()))  // POST /voice/sessions
      .mockResolvedValue(fake204Response());                            // DELETE (best-effort)
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    // Wire onError the way the layout does (→ setVoiceError) so we can assert
    // the AC#8 store outcome the error path must leave behind.
    const onError = vi.fn((msg: string) => useLumiStore.getState().setVoiceError(msg));
    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError }),
    );

    await startSessionAndFlushToWsCreation(result);
    expect(wsInstances).toHaveLength(2);

    // Fire error on TTS WS (index 0) before it opens — this rejects the
    // openTtsWs promise, which causes endSession cleanup to run.
    await act(async () => {
      wsInstances[0]!._emit('error');
      await flush(6);
    });

    expect(onError).toHaveBeenCalledWith('Voice connection lost. Try again.');
    // AC#8: error state must SURVIVE the endSession teardown, not be clobbered
    // back to idle/null by endTalkSession.
    expect(useLumiStore.getState().voiceStatus).toBe('error');
    expect(useLumiStore.getState().voiceError).toBe('Voice connection lost. Try again.');
    // The created talk session must be torn down server-side.
    const deleteCalls = fetchSpy.mock.calls.filter((args: unknown[]) =>
      String(args[0]).includes(`/v1/lumi/voice/sessions/${SESSION_ID}`),
    );
    expect(deleteCalls.some((c) => (c[1] as RequestInit).method === 'DELETE')).toBe(true);
  });
});

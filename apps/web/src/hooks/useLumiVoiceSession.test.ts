import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLumiStore } from '@/stores/lumi.store.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { useLumiVoiceSession } from './useLumiVoiceSession.js';

// ── WebSocket mock ────────────────────────────────────────────────────────
// Story 5-S5b — ambient Lumi voice now runs over a SINGLE HiveKitchen WebSocket
// (GET /v1/lumi/voice/ws). No ElevenLabs browser-direct socket, no hosted agent.

interface MockWs {
  url: string;
  binaryType: string;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  _listeners: Record<string, ((...args: unknown[]) => void)[]>;
  _emit: (type: string, ...args: unknown[]) => void;
}

function createMockWs(url: string): MockWs {
  const ws: MockWs = {
    url,
    binaryType: 'blob',
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

let wsInstances: MockWs[] = [];

// ── VAD mock ──────────────────────────────────────────────────────────────
// Capture the config so tests can drive onSpeechEnd directly.

const vadState = vi.hoisted(() => ({
  config: null as null | { onSpeechEnd?: (audio: Float32Array) => void },
  vad: {
    start: vi.fn(),
    pause: vi.fn(),
    destroy: vi.fn(),
    userSpeaking: false,
    loading: false,
    errored: false,
  },
}));

vi.mock('@ricky0123/vad-react', () => ({
  useMicVAD: vi.fn((config: { onSpeechEnd?: (audio: Float32Array) => void }) => {
    vadState.config = config;
    return vadState.vad;
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────

/** Flush N microtask ticks so that `await`-based async chains advance. */
async function flush(n = 3) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// ── Fixtures ──────────────────────────────────────────────────────────────

const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeSessionResponse() {
  return { talk_session_id: SESSION_ID };
}

/**
 * Fake Response whose `.json()` returns an IMMEDIATELY resolved Promise so the
 * microtask-counting flushes stay deterministic (see original 5-S5 harness).
 */
function fakeJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function fake204Response(): Response {
  return { ok: true, status: 204 } as unknown as Response;
}

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

// ── Tests ─────────────────────────────────────────────────────────────────

describe('useLumiVoiceSession', () => {
  beforeEach(() => {
    useLumiStore.getState().reset();
    useAuthStore.setState({ accessToken: 'test-jwt' });
    vadState.vad.start.mockClear();
    vadState.vad.pause.mockClear();
    vadState.config = null;
    wsInstances = [];

    // `function` keyword so the mock works as a `new`-able constructor.
    // eslint-disable-next-line prefer-arrow-callback
    globalThis.WebSocket = vi.fn().mockImplementation(function mockWebSocket(url: string) {
      const ws = createMockWs(url);
      wsInstances.push(ws);
      return ws;
    }) as unknown as typeof WebSocket;
    // @ts-expect-error test-only constant
    globalThis.WebSocket.OPEN = 1;
    // @ts-expect-error test-only constant
    globalThis.WebSocket.CONNECTING = 0;

    // MP3-Blob playback uses URL.createObjectURL + HTMLMediaElement.play, neither
    // implemented in jsdom — stub the minimal surface.
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
    globalThis.URL.revokeObjectURL = vi.fn();
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // ── Shared setup helpers ────────────────────────────────────────────────

  async function startSessionAndFlushToWsCreation(
    result: { current: ReturnType<typeof useLumiVoiceSession> },
    signal: Parameters<typeof result.current.startSession>[0] = { surface: 'planning' },
  ) {
    await act(async () => {
      void result.current.startSession(signal);
      await flush(3);
    });
  }

  /** Fires 'open' on the single WS and flushes the resulting state transitions. */
  async function openWs() {
    await act(async () => {
      for (const ws of wsInstances) {
        ws.readyState = 1; // OPEN
        ws._emit('open');
      }
      await flush(3);
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

  it('startSession with 403 calls onError with Premium copy; no WS opened, no talkSessionId', async () => {
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

  it('startSession opens ONE HK WS at /v1/lumi/voice/ws and transitions connecting → active', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeJsonResponse(makeSessionResponse()),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError: vi.fn() }),
    );

    await startSessionAndFlushToWsCreation(result);

    expect(wsInstances).toHaveLength(1);
    expect(wsInstances[0]!.url).toContain('/v1/lumi/voice/ws');
    expect(wsInstances[0]!.url).toContain(`session_id=${SESSION_ID}`);
    expect(wsInstances[0]!.url).toContain('token=test-jwt');
    expect(useLumiStore.getState().talkSessionId).toBe(SESSION_ID);
    expect(useLumiStore.getState().voiceStatus).toBe('connecting');

    await openWs();

    expect(useLumiStore.getState().voiceStatus).toBe('active');
    expect(vadState.vad.start).toHaveBeenCalledTimes(1);
  });

  it('sends the context frame on open, then ships a WAV ArrayBuffer on speech end', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeJsonResponse(makeSessionResponse()),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError: vi.fn() }),
    );

    await startSessionAndFlushToWsCreation(result);
    await openWs();

    const ws = wsInstances[0]!;
    // First send is the JSON context frame.
    const firstSend = ws.send.mock.calls[0]![0] as string;
    expect(JSON.parse(firstSend)).toEqual({
      type: 'context',
      context_signal: { surface: 'planning' },
    });

    // Drive a VAD utterance — a WAV ArrayBuffer goes up the same socket.
    await act(async () => {
      vadState.config?.onSpeechEnd?.(new Float32Array(320));
    });
    const lastArg = ws.send.mock.calls.at(-1)![0];
    expect(lastArg).toBeInstanceOf(ArrayBuffer);
  });

  it('server transcript → onTranscript and response.end → onLumiReply (no client turn POST)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(fakeJsonResponse(makeSessionResponse()));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const onTranscript = vi.fn();
    const onLumiReply = vi.fn();
    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript, onLumiReply, onError: vi.fn() }),
    );

    await startSessionAndFlushToWsCreation(result);
    await openWs();
    expect(useLumiStore.getState().voiceStatus).toBe('active');

    const ws = wsInstances[0]!;
    await act(async () => {
      ws._emit('message', { data: JSON.stringify({ type: 'transcript', seq: 1, text: 'hello' }) });
      ws._emit('message', { data: JSON.stringify({ type: 'response.end', seq: 1, text: 'Got it.' }) });
      await flush(3);
    });

    expect(onTranscript).toHaveBeenCalledWith('hello');
    expect(onLumiReply).toHaveBeenCalledWith('Got it.');
    // The turn is server-orchestrated — the client never POSTs /v1/lumi/turns.
    const turnPosts = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('/v1/lumi/turns'),
    );
    expect(turnPosts).toHaveLength(0);
  });

  // Drives a full reply (response.start → MP3 chunk → response.end) on an open
  // session and returns the play spy so callers can assert playback behaviour.
  async function driveReply(
    result: { current: ReturnType<typeof useLumiVoiceSession> },
  ) {
    await startSessionAndFlushToWsCreation(result);
    await openWs();
    const ws = wsInstances[0]!;
    await act(async () => {
      ws._emit('message', { data: JSON.stringify({ type: 'response.start', seq: 7 }) });
      ws._emit('message', { data: new Uint8Array([1, 2, 3]).buffer });
      ws._emit('message', { data: JSON.stringify({ type: 'response.end', seq: 7, text: 'Got it.' }) });
      await flush(3);
    });
  }

  it('caption-only mode: response.end fires onLumiReply but does NOT play audio (5-S13)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeJsonResponse(makeSessionResponse()),
    ) as unknown as typeof fetch;
    useLumiStore.setState({ captionOnlyMode: true });

    const onLumiReply = vi.fn();
    const playSpy = window.HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>;
    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply, onError: vi.fn() }),
    );

    await driveReply(result);

    // Captions always fire; the MP3 buffer is discarded unplayed.
    expect(onLumiReply).toHaveBeenCalledWith('Got it.');
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('default mode: response.end plays the buffered audio (5-S13 no-regression)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeJsonResponse(makeSessionResponse()),
    ) as unknown as typeof fetch;
    // captionOnlyMode defaults to false after reset() in beforeEach.

    const onLumiReply = vi.fn();
    const playSpy = window.HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>;
    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply, onError: vi.fn() }),
    );

    await driveReply(result);

    expect(onLumiReply).toHaveBeenCalledWith('Got it.');
    expect(playSpy).toHaveBeenCalledTimes(1);
  });

  it('a non-fatal error frame surfaces a notice but keeps the session active', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      fakeJsonResponse(makeSessionResponse()),
    ) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError: vi.fn() }),
    );

    await startSessionAndFlushToWsCreation(result);
    await openWs();

    const ws = wsInstances[0]!;
    await act(async () => {
      ws._emit('message', {
        data: JSON.stringify({ type: 'error', code: 'stt_failed', message: 'Could not hear that' }),
      });
      await flush(2);
    });

    expect(useLumiStore.getState().voiceStatus).toBe('active');
    expect(useLumiStore.getState().voiceError).toBe('Could not hear that');
  });

  it('endSession closes the WS, calls DELETE, and resets the store', async () => {
    useLumiStore.getState().setTalkSession(SESSION_ID);
    useLumiStore.getState().setVoiceStatus('active');

    globalThis.fetch = vi.fn().mockResolvedValue(fake204Response()) as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError: vi.fn() }),
    );

    await act(async () => {
      await result.current.endSession();
    });

    expect(vadState.vad.pause).toHaveBeenCalledTimes(1);
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    const deleteCalls = fetchSpy.mock.calls.filter((args: unknown[]) =>
      String(args[0]).includes(`/v1/lumi/voice/sessions/${SESSION_ID}`),
    );
    expect(deleteCalls).toHaveLength(1);
    expect((deleteCalls[0]![1] as RequestInit).method).toBe('DELETE');
    expect(useLumiStore.getState().voiceStatus).toBe('idle');
    expect(useLumiStore.getState().talkSessionId).toBeNull();
  });

  it('20s inactivity fires endSession when no speech is detected', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(fakeJsonResponse(makeSessionResponse()))
      .mockResolvedValue(fake204Response());
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError: vi.fn() }),
    );

    await startSessionAndFlushToWsCreation(result);
    await openWs();
    expect(useLumiStore.getState().voiceStatus).toBe('active');

    await act(async () => {
      vi.advanceTimersByTime(20_001);
      await flush(6);
    });

    expect(useLumiStore.getState().voiceStatus).toBe('idle');
    expect(useLumiStore.getState().talkSessionId).toBeNull();
  });

  it('WS connect error triggers cleanup AND preserves error state + fires DELETE', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(fakeJsonResponse(makeSessionResponse()))
      .mockResolvedValue(fake204Response());
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    // Wire onError the way the layout does (→ setVoiceError) so we can assert
    // the store outcome the error path must leave behind.
    const onError = vi.fn((msg: string) => useLumiStore.getState().setVoiceError(msg));
    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError }),
    );

    await startSessionAndFlushToWsCreation(result);
    expect(wsInstances).toHaveLength(1);

    await act(async () => {
      wsInstances[0]!._emit('error');
      await flush(6);
    });

    expect(onError).toHaveBeenCalledWith('Voice connection lost. Try again.');
    expect(useLumiStore.getState().voiceStatus).toBe('error');
    expect(useLumiStore.getState().voiceError).toBe('Voice connection lost. Try again.');
    const deleteCalls = fetchSpy.mock.calls.filter((args: unknown[]) =>
      String(args[0]).includes(`/v1/lumi/voice/sessions/${SESSION_ID}`),
    );
    expect(deleteCalls.some((c) => (c[1] as RequestInit).method === 'DELETE')).toBe(true);
  });
});

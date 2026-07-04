import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLumiStore } from '@/stores/lumi.store.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { useLumiVoiceSession } from './useLumiVoiceSession.js';

// ── hkFetch mock ─────────────────────────────────────────────────────────────
// Must use vi.hoisted so the class is available inside vi.mock's factory.

const { hkFetchMock, HkApiErrorClass } = vi.hoisted(() => {
  class HkApiError extends Error {
    status: number;
    problem: unknown;
    constructor(status: number, problem: unknown) {
      super(`HK API error ${status}`);
      this.name = 'HkApiError';
      this.status = status;
      this.problem = problem;
    }
  }
  return { hkFetchMock: vi.fn(), HkApiErrorClass: HkApiError };
});

vi.mock('@/lib/fetch.js', () => ({
  hkFetch: (path: string, init?: unknown) => hkFetchMock(path, init),
  HkApiError: HkApiErrorClass,
}));

// ── WebSocket mock ────────────────────────────────────────────────────────────
// Two ElevenLabs WS connections open per turn: Scribe (STT) and TTS stream-input.
// Identified by URL substring. A plain constructor function avoids super() issues.

interface MockWs {
  url: string;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
  _listeners: Record<string, ((...args: unknown[]) => void)[]>;
  addEventListener(type: string, cb: (...args: unknown[]) => void): void;
  _emit(type: string, data?: unknown): void;
}

function createMockWs(url: string): MockWs {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    url,
    send: vi.fn(),
    close: vi.fn(),
    readyState: 0, // CONNECTING
    _listeners: listeners,
    addEventListener(type, cb) {
      listeners[type] = [...(listeners[type] ?? []), cb];
    },
    _emit(type, data?) {
      (listeners[type] ?? []).forEach((cb) => cb(data));
    },
  };
}

const wsInstances: MockWs[] = [];
const OriginalWebSocket = globalThis.WebSocket;

function installMediaMocks() {
  // JSDOM emits a window error for not-implemented HTMLMediaElement.prototype.play
  // even when the rejection is caught. Silence it by returning a resolved promise.
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  // JSDOM does not implement createObjectURL/revokeObjectURL.
  URL.createObjectURL = vi.fn().mockReturnValue('blob:mock');
  URL.revokeObjectURL = vi.fn();
}

function installWsMock() {
  const MockWebSocket = function MockWebSocket(url: string) {
    const ws = createMockWs(url);
    wsInstances.push(ws);
    return ws;
  } as unknown as typeof WebSocket;
  Object.assign(MockWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  globalThis.WebSocket = MockWebSocket;
}

// ── VAD mock ──────────────────────────────────────────────────────────────────
// The hook lazily imports MicVAD from @ricky0123/vad-web on first startSession()
// (was useMicVAD from vad-react before the epic-5 voice refactor).

const vadState = vi.hoisted(() => ({
  config: null as null | { onSpeechEnd?: (audio: Float32Array) => void },
  vad: {
    start: vi.fn(),
    pause: vi.fn(),
    destroy: vi.fn(),
  },
}));

vi.mock('@ricky0123/vad-web', () => ({
  MicVAD: {
    new: async (config: { onSpeechEnd?: (audio: Float32Array) => void }) => {
      vadState.config = config;
      return vadState.vad;
    },
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SESSION_UUID = '00000000-0000-4000-8000-000000000001';

function makeSessionResponse() {
  return { talk_session_id: SESSION_UUID };
}
function makeSttTokenResponse() {
  return { token: 'stt-token-123' };
}
function makeTtsTokenResponse() {
  return { token: 'tts-token-456', voice_id: 'voice-1', model_id: 'eleven_flash_v2_5' };
}
function makeTurnResponse() {
  return {
    thread_id: 'thread-1',
    user_turn: { id: 'u1', role: 'user' },
    lumi_turn: { id: 'l1', role: 'lumi', body: { type: 'message', content: 'How can I help?' } },
  };
}

// ── Store helpers ─────────────────────────────────────────────────────────────

function resetStores() {
  useLumiStore.setState({
    voiceStatus: 'idle',
    talkSessionId: null,
    voiceError: null,
    lumiThinking: false,
    captionOnlyMode: false,
  });
  useAuthStore.setState({ accessToken: 'test-jwt' });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Drive a full successful utterance turn once the session is started. */
async function driveFullTurn(
  fetchSpy: ReturnType<typeof vi.fn>,
): Promise<void> {
  // Queue the remaining fetch responses (session already created)
  fetchSpy
    .mockResolvedValueOnce(makeSttTokenResponse())   // /v1/voice/stt/token
    .mockResolvedValueOnce(makeTurnResponse())        // /v1/lumi/turns
    .mockResolvedValueOnce(makeTtsTokenResponse());   // /v1/voice/tts/token

  await act(async () => {
    // Fire onSpeechEnd
    vadState.config?.onSpeechEnd?.(new Float32Array(320));

    // Let the stt/token fetch resolve, then drive the Scribe WS
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        const scribeWs = wsInstances.find((w) => w.url.includes('speech-to-text'));
        if (scribeWs) {
          scribeWs._emit('open');
          scribeWs._emit('message', {
            data: JSON.stringify({ message_type: 'committed_transcript', text: 'pasta please' }),
          });
        }
        // Let the /turns fetch resolve, then drive the TTS WS
        setTimeout(() => {
          const ttsWs = wsInstances.find((w) => w.url.includes('text-to-speech'));
          if (ttsWs) {
            ttsWs._emit('open');
            ttsWs._emit('message', {
              data: JSON.stringify({ audio: btoa('mp3bytes'), isFinal: true }),
            });
          }
          resolve();
        }, 20);
      }, 20);
    });
  });
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('useLumiVoiceSession — browser-direct STT + REST turns + browser-direct TTS', () => {
  beforeEach(() => {
    resetStores();
    wsInstances.length = 0;
    hkFetchMock.mockReset();
    vadState.vad.start.mockReset();
    vadState.vad.pause.mockReset();
    vadState.config = null;
    installWsMock();
    installMediaMocks();
  });

  afterEach(() => {
    globalThis.WebSocket = OriginalWebSocket;
    vi.restoreAllMocks();
  });

  // ── startSession ─────────────────────────────────────────────────────────────

  it('creates a talk session and starts VAD', async () => {
    hkFetchMock.mockResolvedValue(makeSessionResponse());

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError: vi.fn() }),
    );

    await act(async () => {
      await result.current.startSession({ surface: 'planning' });
    });

    expect(hkFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/lumi/voice/sessions'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(vadState.vad.start).toHaveBeenCalledTimes(1);
    expect(useLumiStore.getState().talkSessionId).toBe(SESSION_UUID);
  });

  it('calls onError with premium copy on 403', async () => {
    hkFetchMock.mockRejectedValue(new HkApiErrorClass(403, {}));
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError }),
    );

    await act(async () => {
      await result.current.startSession({ surface: 'planning' });
    });

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Premium'));
    expect(vadState.vad.start).not.toHaveBeenCalled();
  });

  it('sets capReached and calls onError on 429', async () => {
    hkFetchMock.mockRejectedValue(new HkApiErrorClass(429, {}));
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError }),
    );

    await act(async () => {
      await result.current.startSession({ surface: 'planning' });
    });

    expect(result.current.capReached).toBe(true);
    expect(onError).toHaveBeenCalled();
    expect(vadState.vad.start).not.toHaveBeenCalled();
  });

  it('calls onError with generic copy on non-403/429 failure', async () => {
    hkFetchMock.mockRejectedValue(new HkApiErrorClass(500, {}));
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError }),
    );

    await act(async () => {
      await result.current.startSession({ surface: 'planning' });
    });

    expect(onError).toHaveBeenCalled();
    expect(result.current.capReached).toBe(false);
  });

  // ── endSession ────────────────────────────────────────────────────────────────

  it('DELETEs the session and resets the store on endSession', async () => {
    useLumiStore.setState({ talkSessionId: SESSION_UUID, voiceStatus: 'active' });
    hkFetchMock.mockResolvedValue({});

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError: vi.fn() }),
    );

    await act(async () => {
      await result.current.endSession();
    });

    expect(hkFetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/v1/lumi/voice/sessions/${SESSION_UUID}`),
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(useLumiStore.getState().talkSessionId).toBeNull();
    expect(useLumiStore.getState().voiceStatus).toBe('idle');
  });

  it('endSession is a no-op when no active session', async () => {
    hkFetchMock.mockResolvedValue({});

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError: vi.fn() }),
    );

    await act(async () => {
      await result.current.endSession();
    });

    expect(hkFetchMock).not.toHaveBeenCalled();
  });

  // ── per-turn flow ─────────────────────────────────────────────────────────────

  it('onSpeechEnd → STT token → Scribe WS → /v1/lumi/turns → TTS token → TTS WS → audio', async () => {
    hkFetchMock.mockResolvedValueOnce(makeSessionResponse());
    const onTranscript = vi.fn();
    const onLumiReply = vi.fn();

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript, onLumiReply, onError: vi.fn() }),
    );

    await act(async () => {
      await result.current.startSession({ surface: 'planning' });
    });

    await driveFullTurn(hkFetchMock);

    expect(hkFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/voice/stt/token'),
      expect.any(Object),
    );
    expect(hkFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/lumi/turns'),
      expect.objectContaining({ body: expect.objectContaining({ message: 'pasta please' }) }),
    );
    expect(hkFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/voice/tts/token'),
      expect.any(Object),
    );
    expect(onTranscript).toHaveBeenCalledWith('pasta please');
    expect(onLumiReply).toHaveBeenCalledWith('How can I help?');
  });

  it('single-flight guard: second utterance while first is in flight is dropped', async () => {
    let resolveFirst: () => void = () => {};
    hkFetchMock
      .mockResolvedValueOnce(makeSessionResponse())
      // First STT token call hangs
      .mockImplementationOnce(
        () => new Promise<unknown>((r) => { resolveFirst = () => r(makeSttTokenResponse()); }),
      )
      .mockResolvedValue(makeSttTokenResponse());

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError: vi.fn() }),
    );
    await act(async () => {
      await result.current.startSession({ surface: 'planning' });
    });

    // Fire two utterances — second must be dropped (processingRef guard)
    vadState.config?.onSpeechEnd?.(new Float32Array(320));
    vadState.config?.onSpeechEnd?.(new Float32Array(320));

    resolveFirst();
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    const sttCalls = hkFetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/v1/voice/stt/token'),
    );
    expect(sttCalls).toHaveLength(1);
  });

  it('STT failure: sets voiceError and does NOT call agent or TTS', async () => {
    hkFetchMock
      .mockResolvedValueOnce(makeSessionResponse())
      .mockResolvedValueOnce(makeSttTokenResponse());

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError: vi.fn() }),
    );
    await act(async () => {
      await result.current.startSession({ surface: 'planning' });
    });

    await act(async () => {
      vadState.config?.onSpeechEnd?.(new Float32Array(320));
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          const scribeWs = wsInstances.find((w) => w.url.includes('speech-to-text'));
          scribeWs?._emit('error');
          setTimeout(resolve, 20);
        }, 20);
      });
    });

    const agentCalls = hkFetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/v1/lumi/turns'),
    );
    expect(agentCalls).toHaveLength(0);
    expect(useLumiStore.getState().voiceError).toBeTruthy();
  });

  it('agent failure: sets voiceError and does NOT call TTS', async () => {
    hkFetchMock
      .mockResolvedValueOnce(makeSessionResponse())
      .mockResolvedValueOnce(makeSttTokenResponse())
      .mockRejectedValueOnce(new HkApiErrorClass(500, {}));

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError: vi.fn() }),
    );
    await act(async () => {
      await result.current.startSession({ surface: 'planning' });
    });

    await act(async () => {
      vadState.config?.onSpeechEnd?.(new Float32Array(320));
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          const scribeWs = wsInstances.find((w) => w.url.includes('speech-to-text'));
          if (scribeWs) {
            scribeWs._emit('open');
            scribeWs._emit('message', {
              data: JSON.stringify({ message_type: 'committed_transcript', text: 'hi there' }),
            });
          }
          setTimeout(resolve, 30);
        }, 20);
      });
    });

    const ttsCalls = hkFetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/v1/voice/tts/token'),
    );
    expect(ttsCalls).toHaveLength(0);
    expect(useLumiStore.getState().voiceError).toBeTruthy();
  });

  it('caption-only mode: skips TTS entirely even after successful agent reply', async () => {
    useLumiStore.setState({ captionOnlyMode: true });
    hkFetchMock
      .mockResolvedValueOnce(makeSessionResponse())
      .mockResolvedValueOnce(makeSttTokenResponse())
      .mockResolvedValueOnce(makeTurnResponse());

    const onLumiReply = vi.fn();

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply, onError: vi.fn() }),
    );
    await act(async () => {
      await result.current.startSession({ surface: 'planning' });
    });

    await act(async () => {
      vadState.config?.onSpeechEnd?.(new Float32Array(320));
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          const scribeWs = wsInstances.find((w) => w.url.includes('speech-to-text'));
          if (scribeWs) {
            scribeWs._emit('open');
            scribeWs._emit('message', {
              data: JSON.stringify({ message_type: 'committed_transcript', text: 'hi' }),
            });
          }
          setTimeout(resolve, 30);
        }, 20);
      });
    });

    const ttsCalls = hkFetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/v1/voice/tts/token'),
    );
    expect(ttsCalls).toHaveLength(0);
    // The reply still surfaces via the callback
    expect(onLumiReply).toHaveBeenCalledWith('How can I help?');
  });

  it('empty transcript after Scribe WS: agent is NOT called', async () => {
    hkFetchMock
      .mockResolvedValueOnce(makeSessionResponse())
      .mockResolvedValueOnce(makeSttTokenResponse());

    const { result } = renderHook(() =>
      useLumiVoiceSession({ onTranscript: vi.fn(), onLumiReply: vi.fn(), onError: vi.fn() }),
    );
    await act(async () => {
      await result.current.startSession({ surface: 'planning' });
    });

    await act(async () => {
      vadState.config?.onSpeechEnd?.(new Float32Array(320));
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          const scribeWs = wsInstances.find((w) => w.url.includes('speech-to-text'));
          if (scribeWs) {
            scribeWs._emit('open');
            scribeWs._emit('message', {
              data: JSON.stringify({ message_type: 'committed_transcript', text: '   ' }),
            });
          }
          setTimeout(resolve, 20);
        }, 20);
      });
    });

    const agentCalls = hkFetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/v1/lumi/turns'),
    );
    expect(agentCalls).toHaveLength(0);
  });
});

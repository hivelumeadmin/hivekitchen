import { describe, it, expect, vi, afterEach } from 'vitest';
import { Buffer } from 'node:buffer';
import type { WebSocket } from '@fastify/websocket';
import type { FastifyBaseLogger } from 'fastify';
import { VoiceService } from './voice.service.js';
import type { VoiceRepository, VoiceSessionRow } from './voice.repository.js';
import type { OnboardingAgent } from '../../agents/onboarding.agent.js';
import type { CulturalPriorService } from '../cultural-priors/cultural-prior.service.js';

// ─── constants ───────────────────────────────────────────────────────────────

const USER_ID = 'user-1111-1111-1111';
const HOUSEHOLD_ID = 'hh-2222-2222-2222';
const THREAD_ID = 'thread-3333-3333-3333';
const SESSION_ID = 'session-4444-4444-4444';

const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
const ELEVENLABS_TTS_URL_PATTERN = 'https://api.elevenlabs.io/v1/text-to-speech';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeSessionRow(overrides?: Partial<VoiceSessionRow>): VoiceSessionRow {
  return {
    id: SESSION_ID,
    user_id: USER_ID,
    household_id: HOUSEHOLD_ID,
    thread_id: THREAD_ID,
    elevenlabs_conversation_id: null,
    status: 'active',
    started_at: new Date().toISOString(),
    ended_at: null,
    ...overrides,
  };
}

function makeRepository(overrides?: Partial<VoiceRepository>): VoiceRepository {
  return {
    findActiveSessionForHousehold: vi.fn().mockResolvedValue(null),
    createThread: vi.fn().mockResolvedValue({ id: THREAD_ID }),
    createVoiceSession: vi.fn().mockResolvedValue(makeSessionRow()),
    findVoiceSession: vi.fn().mockResolvedValue(makeSessionRow()),
    appendTurn: vi.fn().mockResolvedValue(undefined),
    appendTurnNext: vi.fn().mockResolvedValue(undefined),
    getNextSeq: vi.fn().mockResolvedValue(1),
    closeThread: vi.fn().mockResolvedValue(undefined),
    updateVoiceSession: vi.fn().mockResolvedValue(makeSessionRow()),
    ...overrides,
  } as unknown as VoiceRepository;
}

function makeAgent(): OnboardingAgent {
  return {
    respond: vi.fn().mockResolvedValue({ text: 'Hello there!', complete: false }),
    extractSummary: vi.fn().mockResolvedValue({
      cultural_templates: [],
      palate_notes: [],
      allergens_mentioned: [],
    }),
    closingPhrase: vi.fn().mockReturnValue('[warmly] That is everything I needed.'),
  } as unknown as OnboardingAgent;
}

function makeCulturalPriorService(): CulturalPriorService {
  return {
    inferFromSummary: vi.fn().mockResolvedValue({ detectedCount: 0 }),
  } as unknown as CulturalPriorService;
}

function makeLogger(): FastifyBaseLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    level: 'info',
  } as unknown as FastifyBaseLogger;
}

function makeMockWs(): { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } & WebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  } as unknown as { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } & WebSocket;
}

function makeService(opts?: {
  repository?: VoiceRepository;
  agent?: OnboardingAgent;
}): VoiceService {
  return new VoiceService({
    repository: opts?.repository ?? makeRepository(),
    agent: opts?.agent ?? makeAgent(),
    culturalPriorService: makeCulturalPriorService(),
    elevenLabsApiKey: 'test-el-key',
    voiceId: 'test-voice-id',
    logger: makeLogger(),
  });
}

function mockFetch(opts: {
  sttTranscript?: string;
  ttsStatus?: number;
  failSttWith?: number;
}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (url.startsWith(ELEVENLABS_STT_URL)) {
        if (opts.failSttWith !== undefined) {
          return new Response('error', { status: opts.failSttWith });
        }
        return new Response(
          JSON.stringify({ text: opts.sttTranscript ?? 'hello world' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.startsWith(ELEVENLABS_TTS_URL_PATTERN)) {
        const status = opts.ttsStatus ?? 200;
        if (!String(status).startsWith('2')) {
          return new Response('tts error', { status });
        }
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([0x00, 0x01]));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  );
}

async function openSession(
  service: VoiceService,
  ws: WebSocket,
  startedMsAgo = 0,
): Promise<void> {
  // Replace repository's findVoiceSession to return the session with the desired age
  const sessionRow = makeSessionRow({
    started_at: new Date(Date.now() - startedMsAgo).toISOString(),
  });
  (service as unknown as { repository: VoiceRepository }).repository.findVoiceSession =
    vi.fn().mockResolvedValue(sessionRow);
  await service.openWsSession(SESSION_ID, USER_ID, ws);
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('VoiceService — patch coverage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // P5: Thread orphan cleanup
  it('createSession: cleans up thread when createVoiceSession fails', async () => {
    const closeThread = vi.fn().mockResolvedValue(undefined);
    const repository = makeRepository({
      createVoiceSession: vi.fn().mockRejectedValue(new Error('DB constraint violation')),
      closeThread,
    });
    const service = makeService({ repository });

    await expect(service.createSession(USER_ID, HOUSEHOLD_ID)).rejects.toThrow(
      'DB constraint violation',
    );

    expect(closeThread).toHaveBeenCalledWith(THREAD_ID);
  });

  // P5: No cleanup when createThread itself fails (nothing to roll back)
  it('createSession: does NOT call closeThread when createThread fails', async () => {
    const closeThread = vi.fn();
    const repository = makeRepository({
      createThread: vi.fn().mockRejectedValue(new Error('DB unreachable')),
      closeThread,
    });
    const service = makeService({ repository });

    await expect(service.createSession(USER_ID, HOUSEHOLD_ID)).rejects.toThrow('DB unreachable');
    expect(closeThread).not.toHaveBeenCalled();
  });

  // P4: Audio buffer size check
  it('processAudioChunk: rejects oversized buffer with stt_failed error, no fetch call', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const service = makeService();
    const ws = makeMockWs();

    await openSession(service, ws as unknown as WebSocket);

    // 3 MB — exceeds 2 MB limit
    const oversized = Buffer.alloc(3 * 1024 * 1024);
    await service.processAudioChunk(SESSION_ID, oversized, ws as unknown as WebSocket);

    expect(fetchSpy).not.toHaveBeenCalled();

    const sentFrames = ws.send.mock.calls.map((c: unknown[]) => {
      try { return JSON.parse(c[0] as string); } catch { return null; }
    }).filter(Boolean) as Array<{ type: string; code?: string }>;

    const errorFrame = sentFrames.find((f) => f.type === 'error');
    expect(errorFrame).toBeDefined();
    expect(errorFrame!.code).toBe('stt_failed');
  });

  // P2: TTS failure pops user message so next turn has balanced history
  it('processAudioChunk: TTS failure keeps session.messages balanced for next turn', async () => {
    vi.useFakeTimers();

    // Capture a SNAPSHOT of messages at each agent.respond call, because
    // session.messages is a mutable array passed by reference — checking
    // mock.calls after the fact reflects the post-mutation state.
    const agentSnapshots: Array<Array<{ role: string; content: string }>> = [];
    const agent = makeAgent();
    (agent.respond as ReturnType<typeof vi.fn>).mockImplementation(
      async (messages: Array<{ role: string; content: string }>) => {
        agentSnapshots.push([...messages]);
        return { text: 'Hello there!', complete: false };
      },
    );

    const service = makeService({ agent });
    const ws = makeMockWs();

    await openSession(service, ws as unknown as WebSocket);

    // Single stateful mock: STT always returns 'hello'; TTS fails on call 1, succeeds on call 2.
    let ttsCallCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;
        if (url.startsWith(ELEVENLABS_STT_URL)) {
          return new Response(JSON.stringify({ text: 'hello' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.startsWith(ELEVENLABS_TTS_URL_PATTERN)) {
          ttsCallCount++;
          if (ttsCallCount === 1) {
            return new Response('tts error', { status: 500 });
          }
          const stream = new ReadableStream<Uint8Array>({ start(c) { c.close(); } });
          return new Response(stream, { status: 200 });
        }
        throw new Error(`Unexpected fetch URL: ${url}`);
      },
    );

    // Turn 1: STT ok, agent ok, TTS fails → P2 fix must pop the user message
    await service.processAudioChunk(SESSION_ID, Buffer.alloc(100), ws as unknown as WebSocket);

    // Turn 2: all ok → agent receives only turn 2's user message (no orphan from turn 1)
    await service.processAudioChunk(SESSION_ID, Buffer.alloc(100), ws as unknown as WebSocket);

    expect(agentSnapshots).toHaveLength(2);

    // Without fix: agentSnapshots[1] = [{ user:'hello'(orphan) }, { user:'hello'(turn2) }] length 2
    // With fix:    agentSnapshots[1] = [{ user:'hello'(turn2) }]                           length 1
    expect(agentSnapshots[1]).toHaveLength(1);
    expect(agentSnapshots[1][0]).toMatchObject({ role: 'user', content: 'hello' });
  });

  // P3: Wall-clock path cancels scheduled timeout before calling handleTimeout
  it('processAudioChunk: wall-clock path clears timeoutHandle before calling handleTimeout', async () => {
    vi.useFakeTimers();

    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const updateVoiceSession = vi.fn().mockResolvedValue(makeSessionRow());
    const repository = makeRepository({ updateVoiceSession });

    const service = makeService({ repository });
    const ws = makeMockWs();

    // Session started 11 minutes ago — wall-clock check will trigger
    const ELEVEN_MINS_MS = 11 * 60 * 1000;
    await openSession(service, ws as unknown as WebSocket, ELEVEN_MINS_MS);

    // handleTimeout tries to stream TTS (closing phrase) — let it fail silently
    mockFetch({ ttsStatus: 500 });

    await service.processAudioChunk(SESSION_ID, Buffer.alloc(100), ws as unknown as WebSocket);

    // clearTimeout must have been called (P3 fix: cancel scheduled timer)
    expect(clearTimeoutSpy).toHaveBeenCalled();

    // Session should be closed with timed_out
    expect(updateVoiceSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ status: 'timed_out' }),
    );
  });

  // P6: Reconnect uses remaining time, not full SESSION_TIMEOUT_MS
  it('openWsSession: sets timeout to remaining time, not full SESSION_TIMEOUT_MS', async () => {
    vi.useFakeTimers();

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const service = makeService();
    const ws = makeMockWs();

    // Session started 9 minutes ago → remaining = ~1 minute
    const NINE_MINS_MS = 9 * 60 * 1000;
    const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
    await openSession(service, ws as unknown as WebSocket, NINE_MINS_MS);

    const setTimeoutCalls = setTimeoutSpy.mock.calls;
    const timeoutDurations = setTimeoutCalls.map((c) => c[1] as number);

    // All setTimeout calls should use remaining time (≈ 1 min), not full 10 min
    for (const duration of timeoutDurations) {
      expect(duration).toBeLessThan(SESSION_TIMEOUT_MS);
    }
  });

  // Existing behaviour: concurrent frame while isProcessing is dropped
  it('processAudioChunk: drops frame silently when isProcessing is true', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    // STT hangs until releaseStt() is called; TTS resolves immediately (needed after STT completes)
    let releaseStt: () => void = () => {};
    fetchSpy.mockImplementation(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;
        if (url.startsWith(ELEVENLABS_STT_URL)) {
          return new Promise<Response>((resolve) => {
            releaseStt = () =>
              resolve(
                new Response(JSON.stringify({ text: 'hi' }), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                }),
              );
          });
        }
        if (url.startsWith(ELEVENLABS_TTS_URL_PATTERN)) {
          // TTS returns an empty stream so the first chunk can finish normally
          const stream = new ReadableStream<Uint8Array>({ start(c) { c.close(); } });
          return new Response(stream, { status: 200 });
        }
        throw new Error(`Unexpected fetch URL in concurrent test: ${url}`);
      },
    );

    const service = makeService();
    const ws = makeMockWs();
    await openSession(service, ws as unknown as WebSocket);

    // First chunk — isProcessing becomes true and hangs at STT
    const firstChunk = service.processAudioChunk(SESSION_ID, Buffer.alloc(100), ws as unknown as WebSocket);
    // Second chunk — should be dropped while first is in flight
    await service.processAudioChunk(SESSION_ID, Buffer.alloc(100), ws as unknown as WebSocket);

    releaseStt(); // Release STT so first chunk can finish
    await firstChunk;

    // fetch was called exactly once for STT (second chunk was dropped before fetching)
    const sttCalls = fetchSpy.mock.calls.filter((c) => {
      const url = typeof c[0] === 'string' ? c[0] : (c[0] as Request).url;
      return url.startsWith(ELEVENLABS_STT_URL);
    });
    expect(sttCalls).toHaveLength(1);
  });
});

describe('VoiceService — createSession', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('returns session_id on success', async () => {
    const service = makeService();
    const result = await service.createSession(USER_ID, HOUSEHOLD_ID);
    expect(result.sessionId).toBe(SESSION_ID);
  });

  it('throws ConflictError when an active session already exists', async () => {
    const repository = makeRepository({
      findActiveSessionForHousehold: vi.fn().mockResolvedValue(makeSessionRow()),
    });
    const service = makeService({ repository });

    await expect(service.createSession(USER_ID, HOUSEHOLD_ID)).rejects.toMatchObject({
      status: 409,
    });
  });
});

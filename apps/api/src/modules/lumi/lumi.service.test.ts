import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Buffer } from 'node:buffer';
import type { WebSocket } from '@fastify/websocket';
import type { Turn } from '@hivekitchen/types';

// Mock the LumiAgent so submitTextTurn's call into it is observable without an
// OpenAI round-trip. `respondMock` is hoisted so the factory can close over it.
const { respondMock, generateNudgeMock, transcribeWavMock, streamTtsToWsMock } = vi.hoisted(() => ({
  respondMock: vi.fn(),
  generateNudgeMock: vi.fn(),
  transcribeWavMock: vi.fn(),
  streamTtsToWsMock: vi.fn(),
}));
vi.mock('../../agents/lumi.agent.js', () => ({
  LumiAgent: class FakeLumiAgent {
    respond = respondMock;
    generateNudge = generateNudgeMock;
  },
}));
// Story 5-S5b — the ambient voice path uses raw Scribe STT + TTS (no hosted
// ElevenLabs agent). Mock the shared helpers so processVoiceUtterance is
// observable without a network round-trip.
vi.mock('../voice/elevenlabs-audio.js', () => ({
  transcribeWav: transcribeWavMock,
  streamTtsToWs: streamTtsToWsMock,
}));

import { LumiService, type LumiServiceDeps, type LumiVoiceWsState } from './lumi.service.js';

function makeMockWs(): { send: ReturnType<typeof vi.fn> } & WebSocket {
  return { send: vi.fn(), close: vi.fn(), readyState: 1 } as unknown as {
    send: ReturnType<typeof vi.fn>;
  } & WebSocket;
}

function sentFrames(ws: { send: ReturnType<typeof vi.fn> }): Array<{ type: string; code?: string; text?: string }> {
  return ws.send.mock.calls
    .map((c: unknown[]) => {
      try { return JSON.parse(c[0] as string); } catch { return null; }
    })
    .filter(Boolean) as Array<{ type: string; code?: string; text?: string }>;
}

function buildDeps(overrides: {
  displayName?: string | null;
  children?: Array<{ id: string; name: string; age_band: string }>;
  allergens?: Array<{ child_id: string | null; allergen: string }>;
  activeThread?: { id: string } | null;
  priorTurns?: Turn[];
  // 5-S7 — pass a mock memoryService to exercise passive enrichment. Omit it to
  // mirror the nudge-job path (enrichment is skipped entirely).
  memoryService?: { noteFromAgent: ReturnType<typeof vi.fn> };
  // 5-S10 — pass a mock familyLanguageRepository to exercise inline detection +
  // the snapshot ratchet block. Omit it to mirror the no-detection path.
  familyLanguageRepository?: {
    recordUsage: ReturnType<typeof vi.fn>;
    getTerms: ReturnType<typeof vi.fn>;
  };
} = {}) {
  const repository = {
    getHouseholdDisplayName: vi.fn().mockResolvedValue(overrides.displayName ?? null),
    findActiveAmbientThread: vi.fn().mockResolvedValue(overrides.activeThread ?? null),
    createAmbientThread: vi.fn().mockResolvedValue({ id: 'new-thread' }),
    getThreadTurns: vi.fn().mockResolvedValue(overrides.priorTurns ?? []),
    insertTurn: vi.fn().mockImplementation((input: { role: string; body: unknown }) =>
      Promise.resolve({
        id: `turn-${input.role}`,
        thread_id: 'new-thread',
        server_seq: input.role === 'user' ? 1 : 2,
        role: input.role,
        body: input.body,
        modality: 'text',
        created_at: '2026-06-05T00:00:00.000Z',
      }),
    ),
  };
  const childrenRepository = {
    findByHouseholdId: vi.fn().mockResolvedValue(overrides.children ?? []),
  };
  const householdAllergensRepository = {
    findByHouseholdId: vi.fn().mockResolvedValue(overrides.allergens ?? []),
  };
  const openai = { chat: { completions: { create: vi.fn() } } };
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const redis = { set: vi.fn(), del: vi.fn() };
  const voiceTranscriptRepository = { insertTranscript: vi.fn().mockResolvedValue(undefined) };
  // 5-S16 — under cap by default (getWeeklyUsage → 0); cap tests override per-call.
  const voiceUsageRepository = {
    getWeeklyUsage: vi.fn().mockResolvedValue(0),
    incrementUsage: vi.fn().mockResolvedValue(undefined),
  };

  const deps = {
    repository,
    redis,
    logger,
    elevenLabsApiKey: 'k',
    voiceId: 'v',
    openai,
    childrenRepository,
    householdAllergensRepository,
    voiceTranscriptRepository,
    voiceUsageRepository,
    memoryService: overrides.memoryService,
    familyLanguageRepository: overrides.familyLanguageRepository,
  } as unknown as LumiServiceDeps;

  const service = new LumiService(deps);
  return {
    service,
    repository,
    childrenRepository,
    householdAllergensRepository,
    redis,
    logger,
    voiceTranscriptRepository,
    voiceUsageRepository,
    openai,
    memoryService: overrides.memoryService,
    familyLanguageRepository: overrides.familyLanguageRepository,
  };
}

// 5-S16 — build a minimal valid PCM WAV buffer (16kHz mono 16-bit) whose header
// estimateWavDurationMs can read. `dataBytes` of audio → dataBytes/32000 seconds.
function makeWavBuffer(dataBytes = 32_000): Buffer {
  const buf = Buffer.alloc(44 + dataBytes);
  buf.writeUInt16LE(1, 22); // numChannels
  buf.writeUInt32LE(16_000, 24); // sampleRate
  buf.writeUInt16LE(16, 34); // bitsPerSample
  return buf;
}

// fetchHouseholdSnapshot is private; reach it via a typed cast for unit scope.
function snapshotOf(service: LumiService): (id: string) => Promise<string> {
  return (service as unknown as { fetchHouseholdSnapshot: (id: string) => Promise<string> })
    .fetchHouseholdSnapshot.bind(service);
}

beforeEach(() => {
  respondMock.mockReset();
  respondMock.mockResolvedValue('Mocked Lumi reply.');
  generateNudgeMock.mockReset();
  generateNudgeMock.mockResolvedValue('Your week is ready — dal-rice on Monday.');
  transcribeWavMock.mockReset();
  transcribeWavMock.mockResolvedValue('pasta on Tuesday please');
  streamTtsToWsMock.mockReset();
  streamTtsToWsMock.mockResolvedValue(undefined);
});

function makeVoiceState(): LumiVoiceWsState {
  return {
    householdId: 'hh1',
    userId: 'user1',
    voiceRetentionMode: 'standard',
    contextSignal: { surface: 'planning' },
    isProcessing: false,
    seq: 0,
  };
}

describe('LumiService.fetchHouseholdSnapshot', () => {
  it('assembles family name, child name + age band, and allergens', async () => {
    const { service } = buildDeps({
      displayName: 'The Garcias',
      children: [
        { id: 'c1', name: 'Sofia', age_band: 'child' },
        { id: 'c2', name: 'Mateo', age_band: 'toddler' },
      ],
      allergens: [
        { child_id: 'c1', allergen: 'peanut' },
        { child_id: 'c1', allergen: 'tree nut' },
      ],
    });

    const snapshot = await snapshotOf(service)('hh1');

    expect(snapshot).toContain('Family: The Garcias');
    expect(snapshot).toContain('- Sofia (child) — allergens: peanut, tree nut');
    expect(snapshot).toContain('- Mateo (toddler) — no known allergens');
  });

  it('shows household-wide allergens (child_id=null) on a Kitchen allergens line', async () => {
    const { service } = buildDeps({
      displayName: 'The Garcias',
      children: [{ id: 'c1', name: 'Sofia', age_band: 'child' }],
      allergens: [
        { child_id: null, allergen: 'peanut' },
        { child_id: 'c1', allergen: 'sesame' },
      ],
    });

    const snapshot = await snapshotOf(service)('hh1');

    expect(snapshot).toContain('Kitchen allergens: peanut');
    expect(snapshot).toContain('- Sofia (child) — allergens: sesame');
  });

  it('handles an empty children list without crashing', async () => {
    const { service } = buildDeps({ displayName: 'The Lees', children: [], allergens: [] });

    const snapshot = await snapshotOf(service)('hh1');

    expect(snapshot).toBe('Family: The Lees');
  });

  it('returns an empty string when there is no display name and no children', async () => {
    const { service } = buildDeps({ displayName: null, children: [], allergens: [] });

    const snapshot = await snapshotOf(service)('hh1');

    expect(snapshot).toBe('');
  });
});

describe('LumiService.submitTextTurn — agent dispatch', () => {
  it('calls agent.respond with surface, contextSignal, history and snapshot', async () => {
    const priorTurns: Turn[] = [
      {
        id: 't1',
        thread_id: 'thread-1',
        server_seq: 1,
        role: 'user',
        body: { type: 'message', content: 'earlier' },
        modality: 'text',
        created_at: '2026-06-05T00:00:00.000Z',
      },
    ];
    const { service } = buildDeps({
      displayName: 'The Garcias',
      children: [{ id: 'c1', name: 'Sofia', age_band: 'child' }],
      allergens: [{ child_id: 'c1', allergen: 'peanut' }],
      activeThread: { id: 'thread-1' },
      priorTurns,
    });

    await service.submitTextTurn({
      householdId: 'hh1',
      message: 'what about Tuesday?',
      contextSignal: { surface: 'planning' },
    });

    expect(respondMock).toHaveBeenCalledTimes(1);
    expect(respondMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'what about Tuesday?',
        surface: 'planning',
        contextSignal: { surface: 'planning' },
        conversationHistory: priorTurns,
        modality: 'text',
      }),
    );
    const arg = respondMock.mock.calls[0][0] as { householdSnapshot: string };
    expect(arg.householdSnapshot).toContain('Family: The Garcias');
    expect(arg.householdSnapshot).toContain('Sofia');
  });

  it('passes empty history for a brand-new thread (no existing thread)', async () => {
    const { service, repository } = buildDeps({ activeThread: null });

    await service.submitTextTurn({
      householdId: 'hh1',
      message: 'hello',
      contextSignal: { surface: 'general' },
    });

    expect(repository.getThreadTurns).not.toHaveBeenCalled();
    expect(respondMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversationHistory: [] }),
    );
  });

  it('persists the Lumi reply returned by the agent', async () => {
    respondMock.mockResolvedValue('Here is Tuesday.');
    const { service, repository } = buildDeps({ activeThread: null });

    const result = await service.submitTextTurn({
      householdId: 'hh1',
      message: 'hi',
      contextSignal: { surface: 'general' },
    });

    expect(result.lumi_turn.body).toEqual({ type: 'message', content: 'Here is Tuesday.' });
    // user turn inserted before lumi turn
    expect(repository.insertTurn).toHaveBeenCalledTimes(2);
  });
});

describe('LumiService.submitTextTurn — voice modality (Story 5-S5)', () => {
  it('persists a voice transcript anchored to the Lumi turn when modality is voice', async () => {
    const { service, voiceTranscriptRepository } = buildDeps({ activeThread: null });

    const result = await service.submitTextTurn({
      householdId: 'hh1',
      message: 'pasta on Tuesday please',
      contextSignal: { surface: 'planning' },
      modality: 'voice',
    });

    expect(voiceTranscriptRepository.insertTranscript).toHaveBeenCalledTimes(1);
    expect(voiceTranscriptRepository.insertTranscript).toHaveBeenCalledWith(
      result.thread_id,
      result.lumi_turn.id,
      'pasta on Tuesday please',
      90,
      undefined,
    );
  });

  // 5-S15 — when the user has chosen immediate_delete, no transcript is persisted (AC6).
  it('skips the transcript insert when voiceRetentionMode is immediate_delete', async () => {
    const { service, voiceTranscriptRepository } = buildDeps({ activeThread: null });

    await service.submitTextTurn({
      householdId: 'hh1',
      userId: 'user1',
      voiceRetentionMode: 'immediate_delete',
      message: 'pasta on Tuesday please',
      contextSignal: { surface: 'planning' },
      modality: 'voice',
    });

    expect(voiceTranscriptRepository.insertTranscript).not.toHaveBeenCalled();
  });

  // 5-S15 — voice turns forward userId so the row is scoped to the user.
  it('forwards userId to insertTranscript in standard mode', async () => {
    const { service, voiceTranscriptRepository } = buildDeps({ activeThread: null });

    const result = await service.submitTextTurn({
      householdId: 'hh1',
      userId: 'user1',
      voiceRetentionMode: 'standard',
      message: 'pasta on Tuesday please',
      contextSignal: { surface: 'planning' },
      modality: 'voice',
    });

    expect(voiceTranscriptRepository.insertTranscript).toHaveBeenCalledWith(
      result.thread_id,
      result.lumi_turn.id,
      'pasta on Tuesday please',
      90,
      'user1',
    );
  });

  it('stamps thread_turns with modality "voice" on both turns', async () => {
    const { service, repository } = buildDeps({ activeThread: null });

    await service.submitTextTurn({
      householdId: 'hh1',
      message: 'hi',
      contextSignal: { surface: 'planning' },
      modality: 'voice',
    });

    expect(repository.insertTurn).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', modality: 'voice' }),
    );
    expect(repository.insertTurn).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'lumi', modality: 'voice' }),
    );
  });

  it('does NOT persist a voice transcript for a text turn', async () => {
    const { service, voiceTranscriptRepository, repository } = buildDeps({ activeThread: null });

    await service.submitTextTurn({
      householdId: 'hh1',
      message: 'hi',
      contextSignal: { surface: 'planning' },
    });

    expect(voiceTranscriptRepository.insertTranscript).not.toHaveBeenCalled();
    expect(repository.insertTurn).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', modality: 'text' }),
    );
  });

  it('still returns success when the transcript write fails (best-effort)', async () => {
    const { service, voiceTranscriptRepository, logger } = buildDeps({ activeThread: null });
    voiceTranscriptRepository.insertTranscript.mockRejectedValueOnce(new Error('db down'));

    const result = await service.submitTextTurn({
      householdId: 'hh1',
      message: 'hi',
      contextSignal: { surface: 'planning' },
      modality: 'voice',
    });

    expect(result.lumi_turn.role).toBe('lumi');
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('LumiService.persistNudge', () => {
  it('resolves the thread, generates the nudge, and persists it with nudgeTrigger', async () => {
    const { service, repository } = buildDeps({ activeThread: { id: 'thread-1' } });

    await service.persistNudge({
      householdId: 'hh1',
      trigger: 'plan_completed',
      surface: 'brief',
      planContext: 'Week of 2026-10-14. Mains: Dal-rice',
    });

    expect(repository.findActiveAmbientThread).toHaveBeenCalledWith('hh1', 'brief');
    expect(generateNudgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'plan_completed',
        surface: 'brief',
        planContext: 'Week of 2026-10-14. Mains: Dal-rice',
      }),
    );
    expect(repository.insertTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        role: 'lumi',
        body: { type: 'message', content: 'Your week is ready — dal-rice on Monday.' },
        modality: 'text',
        nudgeTrigger: 'plan_completed',
      }),
    );
  });

  it('sets the Redis rate-limit gate with SET NX EX 1800 after persisting', async () => {
    const { service, redis } = buildDeps({ activeThread: { id: 'thread-1' } });

    await service.persistNudge({ householdId: 'hh1', trigger: 'plan_completed', surface: 'brief' });

    expect(redis.set).toHaveBeenCalledWith('lumi:nudge:household:hh1', '1', 'EX', 1800, 'NX');
  });

  it('does not throw when the Redis gate SET fails (logs a warning, returns the turn)', async () => {
    const { service, redis, logger } = buildDeps({ activeThread: { id: 'thread-1' } });
    redis.set.mockRejectedValueOnce(new Error('redis down'));

    const turn = await service.persistNudge({
      householdId: 'hh1',
      trigger: 'plan_completed',
      surface: 'brief',
    });

    expect(turn.role).toBe('lumi');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('lazy-creates the ambient thread when none exists', async () => {
    const { service, repository } = buildDeps({ activeThread: null });

    await service.persistNudge({ householdId: 'hh1', trigger: 'plan_completed', surface: 'brief' });

    expect(repository.createAmbientThread).toHaveBeenCalledWith('hh1', 'brief', 'text');
    expect(repository.insertTurn).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'new-thread', nudgeTrigger: 'plan_completed' }),
    );
  });
});

describe('LumiService.processVoiceUtterance — ambient voice (Story 5-S5b)', () => {
  it('transcribes via Scribe, runs the LumiAgent turn, and streams TTS — raw, no hosted agent', async () => {
    const { service } = buildDeps({ activeThread: null });
    const ws = makeMockWs();

    await service.processVoiceUtterance(makeVoiceState(), Buffer.from('wav-bytes'), ws);

    // STT path is raw Scribe (transcribeWav), called with the API key + buffer.
    expect(transcribeWavMock).toHaveBeenCalledTimes(1);
    expect(transcribeWavMock.mock.calls[0][0]).toBe('k');
    // Reply synthesized via the shared TTS helper with the LumiAgent reply text.
    expect(streamTtsToWsMock).toHaveBeenCalledTimes(1);
    expect(streamTtsToWsMock.mock.calls[0][2]).toBe('Mocked Lumi reply.');

    const frames = sentFrames(ws);
    // Slice 5-S6 — lumi.thinking fires in the STT→reply gap, after transcript,
    // before response.start. No speech is emitted in that gap.
    expect(frames.map((f) => f.type)).toEqual([
      'transcript',
      'lumi.thinking',
      'response.start',
      'response.end',
    ]);
    expect(frames.find((f) => f.type === 'transcript')!.text).toBe('pasta on Tuesday please');
    expect(frames.find((f) => f.type === 'response.end')!.text).toBe('Mocked Lumi reply.');
  });

  it('emits lumi.thinking in the STT→reply gap with the turn seq, no speech (5-S6 AC#6)', async () => {
    const { service } = buildDeps({ activeThread: null });
    const ws = makeMockWs();

    await service.processVoiceUtterance(makeVoiceState(), Buffer.from('wav'), ws);

    const frames = sentFrames(ws);
    const thinkingIdx = frames.findIndex((f) => f.type === 'lumi.thinking');
    const startIdx = frames.findIndex((f) => f.type === 'response.start');
    // Fired after transcript, before response.start.
    expect(thinkingIdx).toBe(1);
    expect(thinkingIdx).toBeLessThan(startIdx);
    // Carries the per-turn seq, matching the rest of the turn's frames.
    const thinking = frames[thinkingIdx] as { type: string; seq: number };
    const start = frames[startIdx] as { type: string; seq: number };
    expect(thinking.seq).toBe(start.seq);
  });

  it('does NOT emit lumi.thinking when STT fails (no reply gap to bridge)', async () => {
    const { service } = buildDeps({ activeThread: null });
    const ws = makeMockWs();
    transcribeWavMock.mockRejectedValueOnce(new Error('scribe down'));

    await service.processVoiceUtterance(makeVoiceState(), Buffer.from('wav'), ws);

    const frames = sentFrames(ws);
    expect(frames.find((f) => f.type === 'lumi.thinking')).toBeUndefined();
  });

  it('persists the turn through submitTextTurn with modality "voice" (5-S5 path)', async () => {
    const { service, repository, voiceTranscriptRepository } = buildDeps({ activeThread: null });
    const ws = makeMockWs();

    await service.processVoiceUtterance(makeVoiceState(), Buffer.from('wav'), ws);

    expect(repository.insertTurn).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', modality: 'voice' }),
    );
    expect(repository.insertTurn).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'lumi', modality: 'voice' }),
    );
    expect(voiceTranscriptRepository.insertTranscript).toHaveBeenCalledTimes(1);
  });

  it('drops a concurrent frame while a turn is already in flight (single-flight guard)', async () => {
    const { service } = buildDeps({ activeThread: null });
    const ws = makeMockWs();
    const state = makeVoiceState();

    // First call hangs at STT so isProcessing stays true.
    let releaseStt: (text: string) => void = () => {};
    transcribeWavMock.mockImplementationOnce(
      () => new Promise<string>((resolve) => { releaseStt = resolve; }),
    );

    const first = service.processVoiceUtterance(state, Buffer.from('a'), ws);
    // Second arrives mid-flight → dropped before any STT call.
    await service.processVoiceUtterance(state, Buffer.from('b'), ws);

    releaseStt('hello');
    await first;

    expect(transcribeWavMock).toHaveBeenCalledTimes(1);
  });

  it('emits a non-fatal stt_failed error frame without closing the session on STT failure', async () => {
    const { service } = buildDeps({ activeThread: null });
    const ws = makeMockWs();
    transcribeWavMock.mockRejectedValueOnce(new Error('scribe down'));

    await service.processVoiceUtterance(makeVoiceState(), Buffer.from('wav'), ws);

    const frames = sentFrames(ws);
    const errorFrame = frames.find((f) => f.type === 'error');
    expect(errorFrame).toBeDefined();
    expect(errorFrame!.code).toBe('stt_failed');
    // Non-fatal: no turn ran, no TTS, session not torn down here.
    expect(streamTtsToWsMock).not.toHaveBeenCalled();
    expect((ws as unknown as { close: ReturnType<typeof vi.fn> }).close).not.toHaveBeenCalled();
  });

  it('resets isProcessing after a turn so the next utterance can run', async () => {
    const { service } = buildDeps({ activeThread: null });
    const ws = makeMockWs();
    const state = makeVoiceState();

    await service.processVoiceUtterance(state, Buffer.from('a'), ws);
    expect(state.isProcessing).toBe(false);
    await service.processVoiceUtterance(state, Buffer.from('b'), ws);

    expect(transcribeWavMock).toHaveBeenCalledTimes(2);
  });

  it('drops the frame when no context frame has been received yet', async () => {
    const { service } = buildDeps({ activeThread: null });
    const ws = makeMockWs();
    const state: LumiVoiceWsState = { ...makeVoiceState(), contextSignal: null };

    await service.processVoiceUtterance(state, Buffer.from('wav'), ws);

    expect(transcribeWavMock).not.toHaveBeenCalled();
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('emits audio_too_large (not stt_failed) when the WAV exceeds MAX_AUDIO_BYTES (P1)', async () => {
    const { service } = buildDeps({ activeThread: null });
    const ws = makeMockWs();
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1);

    await service.processVoiceUtterance(makeVoiceState(), oversized, ws);

    const frames = sentFrames(ws);
    const errorFrame = frames.find((f) => f.type === 'error');
    expect(errorFrame).toBeDefined();
    expect(errorFrame!.code).toBe('audio_too_large');
    expect(transcribeWavMock).not.toHaveBeenCalled();
  });

  it('sends response.end without calling TTS when the agent returns an empty reply (P3)', async () => {
    const { service } = buildDeps({ activeThread: null });
    const ws = makeMockWs();
    // Agent returns a non-message body type → reply extracts as ''.
    respondMock.mockResolvedValueOnce('');

    await service.processVoiceUtterance(makeVoiceState(), Buffer.from('wav'), ws);

    expect(streamTtsToWsMock).not.toHaveBeenCalled();
    const frames = sentFrames(ws);
    expect(frames.map((f) => f.type)).toContain('response.end');
    expect(frames.find((f) => f.type === 'error')).toBeUndefined();
  });

  // 5-S16 — standard-tier weekly voice cap.
  it('sends voice_cap_reached and skips STT when the user is at the cap', async () => {
    const { service, voiceUsageRepository } = buildDeps({ activeThread: null });
    voiceUsageRepository.getWeeklyUsage.mockResolvedValueOnce(600_000); // exactly at cap
    const ws = makeMockWs();

    await service.processVoiceUtterance(makeVoiceState(), Buffer.from('wav-bytes'), ws);

    expect(transcribeWavMock).not.toHaveBeenCalled();
    const frames = sentFrames(ws);
    const errorFrame = frames.find((f) => f.type === 'error');
    expect(errorFrame).toBeDefined();
    expect(errorFrame!.code).toBe('voice_cap_reached');
  });

  it('processes the utterance and increments usage when under the cap', async () => {
    const { service, voiceUsageRepository } = buildDeps({ activeThread: null });
    voiceUsageRepository.getWeeklyUsage.mockResolvedValueOnce(300_000); // under cap
    const ws = makeMockWs();

    await service.processVoiceUtterance(makeVoiceState(), makeWavBuffer(), ws);
    // The increment is fire-and-forget; drain the microtask queue at a macrotask
    // boundary before asserting (not a timing wait).
    await new Promise((r) => setTimeout(r, 0));

    expect(transcribeWavMock).toHaveBeenCalledOnce();
    expect(voiceUsageRepository.incrementUsage).toHaveBeenCalledOnce();
    // 32000 data bytes @ 16kHz mono 16-bit = 1000 ms.
    expect(voiceUsageRepository.incrementUsage.mock.calls[0][2]).toBe(1000);
  });

  it('does not increment usage when the WAV is too small to estimate a duration', async () => {
    const { service, voiceUsageRepository } = buildDeps({ activeThread: null });
    const ws = makeMockWs();

    await service.processVoiceUtterance(makeVoiceState(), Buffer.alloc(44), ws);
    await new Promise((r) => setTimeout(r, 0));

    expect(voiceUsageRepository.incrementUsage).not.toHaveBeenCalled();
  });
});

// 5-S7 — passive enrichment fires as `void this.runPassiveEnrichment(...)` after
// the Lumi turn is committed. submitTextTurn returns before the enrichment chain
// settles, so we flush the microtask queue (a macrotask boundary drains all
// pending microtasks deterministically — this is not a timing wait).
const flushFireAndForget = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

function enrichmentCompletion(content: string) {
  return { choices: [{ message: { content } }] };
}

describe('LumiService.submitTextTurn — passive enrichment (Story 5-S7)', () => {
  it('writes a memory node with source_type=turn anchored to the user turn when OpenAI returns signals', async () => {
    const memoryService = { noteFromAgent: vi.fn().mockResolvedValue({ node_id: 'n1', created_at: 'x' }) };
    const { service, openai } = buildDeps({ activeThread: null, memoryService });
    openai.chat.completions.create.mockResolvedValue(
      enrichmentCompletion(
        '{"signals":[{"node_type":"cultural_rhythm","facet":"diwali-2026","prose_text":"Diwali is in three weeks.","confidence":0.8}]}',
      ),
    );

    const result = await service.submitTextTurn({
      householdId: 'hh1',
      message: 'Diwali is in three weeks',
      contextSignal: { surface: 'planning' },
    });
    await flushFireAndForget();

    expect(memoryService.noteFromAgent).toHaveBeenCalledTimes(1);
    expect(memoryService.noteFromAgent).toHaveBeenCalledWith({
      householdId: 'hh1',
      nodeType: 'cultural_rhythm',
      facet: 'diwali-2026',
      proseText: 'Diwali is in three weeks.',
      subjectChildId: null,
      confidence: 0.8,
      sourceType: 'turn',
      sourceRef: { thread_id: result.thread_id, turn_id: result.user_turn.id },
    });
  });

  it('does not write a memory node when OpenAI returns an empty signals array', async () => {
    const memoryService = { noteFromAgent: vi.fn().mockResolvedValue({ node_id: 'n1', created_at: 'x' }) };
    const { service, openai, logger } = buildDeps({ activeThread: null, memoryService });
    openai.chat.completions.create.mockResolvedValue(enrichmentCompletion('{"signals":[]}'));

    await service.submitTextTurn({
      householdId: 'hh1',
      message: 'what is for lunch?',
      contextSignal: { surface: 'planning' },
    });
    await flushFireAndForget();

    expect(memoryService.noteFromAgent).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not propagate an enrichment OpenAI failure to submitTextTurn', async () => {
    const memoryService = { noteFromAgent: vi.fn() };
    const { service, openai, logger } = buildDeps({ activeThread: null, memoryService });
    openai.chat.completions.create.mockRejectedValue(new Error('rate limited'));

    const result = await service.submitTextTurn({
      householdId: 'hh1',
      message: 'Diwali is in three weeks',
      contextSignal: { surface: 'planning' },
    });
    await flushFireAndForget();

    expect(result.lumi_turn.role).toBe('lumi');
    expect(memoryService.noteFromAgent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lumi.passive_enrichment_failed' }),
      expect.any(String),
    );
  });

  it('warns and writes nothing when the enrichment result fails schema validation', async () => {
    const memoryService = { noteFromAgent: vi.fn() };
    const { service, openai, logger } = buildDeps({ activeThread: null, memoryService });
    openai.chat.completions.create.mockResolvedValue(
      enrichmentCompletion('{"signals":[{"node_type":"not_a_real_type","facet":"x","prose_text":"y","confidence":0.8}]}'),
    );

    await service.submitTextTurn({
      householdId: 'hh1',
      message: 'Diwali is in three weeks',
      contextSignal: { surface: 'planning' },
    });
    await flushFireAndForget();

    expect(memoryService.noteFromAgent).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lumi.passive_enrichment_parse_failed' }),
      expect.any(String),
    );
  });

  it('skips enrichment entirely (no OpenAI call) when memoryService is absent', async () => {
    const { service, openai } = buildDeps({ activeThread: null });

    const result = await service.submitTextTurn({
      householdId: 'hh1',
      message: 'Diwali is in three weeks',
      contextSignal: { surface: 'planning' },
    });
    await flushFireAndForget();

    expect(openai.chat.completions.create).not.toHaveBeenCalled();
    expect(result.lumi_turn.role).toBe('lumi');
  });
});

describe('LumiService.submitTextTurn — family-language ratchet (Slice 5-S10)', () => {
  function buildFamilyLanguageRepo(overrides: {
    newlyCandidate?: Array<{ term: string; maps_to: string }>;
    recordUsageThrows?: boolean;
  } = {}) {
    return {
      recordUsage: overrides.recordUsageThrows
        ? vi.fn().mockRejectedValue(new Error('households read failed'))
        : vi.fn().mockResolvedValue({ newlyCandidate: overrides.newlyCandidate ?? [] }),
      getTerms: vi.fn().mockResolvedValue([]),
    };
  }

  it('persists a family_language_prompt turn and returns it as ratification_turn when a term crosses', async () => {
    const familyLanguageRepository = buildFamilyLanguageRepo({
      newlyCandidate: [{ term: 'Nani', maps_to: 'grandmother' }],
    });
    const { service, repository } = buildDeps({ activeThread: null, familyLanguageRepository });

    const result = await service.submitTextTurn({
      householdId: 'hh1',
      message: 'I called Nani and then Nani called back',
      contextSignal: { surface: 'planning' },
    });

    expect(familyLanguageRepository.recordUsage).toHaveBeenCalledTimes(1);
    expect(result.ratification_turn).toBeDefined();
    expect(result.ratification_turn!.body).toEqual({
      type: 'family_language_prompt',
      term: 'Nani',
      maps_to: 'grandmother',
    });
    // 3 inserts: user turn, lumi reply, ratification turn.
    expect(repository.insertTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'lumi',
        body: { type: 'family_language_prompt', term: 'Nani', maps_to: 'grandmother' },
      }),
    );
  });

  it('does not return a ratification_turn when no term crosses the threshold', async () => {
    const familyLanguageRepository = buildFamilyLanguageRepo({ newlyCandidate: [] });
    const { service } = buildDeps({ activeThread: null, familyLanguageRepository });

    const result = await service.submitTextTurn({
      householdId: 'hh1',
      message: 'Nani says hi',
      contextSignal: { surface: 'planning' },
    });

    expect(familyLanguageRepository.recordUsage).toHaveBeenCalledTimes(1);
    expect(result.ratification_turn).toBeUndefined();
  });

  it('does not call recordUsage when the message has no kinship terms', async () => {
    const familyLanguageRepository = buildFamilyLanguageRepo();
    const { service } = buildDeps({ activeThread: null, familyLanguageRepository });

    await service.submitTextTurn({
      householdId: 'hh1',
      message: 'what is for lunch on Tuesday?',
      contextSignal: { surface: 'planning' },
    });

    expect(familyLanguageRepository.recordUsage).not.toHaveBeenCalled();
  });

  it('returns the turn normally when detection throws (best-effort, no throw)', async () => {
    const familyLanguageRepository = buildFamilyLanguageRepo({ recordUsageThrows: true });
    const { service, logger } = buildDeps({ activeThread: null, familyLanguageRepository });

    const result = await service.submitTextTurn({
      householdId: 'hh1',
      message: 'Nani Nani Nani',
      contextSignal: { surface: 'planning' },
    });

    expect(result.lumi_turn.role).toBe('lumi');
    expect(result.ratification_turn).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lumi.family_language_detect_failed' }),
      expect.any(String),
    );
  });

  it('does not detect or throw when familyLanguageRepository is absent (nudge-job ctor path)', async () => {
    const { service } = buildDeps({ activeThread: null });

    const result = await service.submitTextTurn({
      householdId: 'hh1',
      message: 'Nani Nani Nani',
      contextSignal: { surface: 'planning' },
    });

    expect(result.ratification_turn).toBeUndefined();
    expect(result.lumi_turn.role).toBe('lumi');
  });
});

describe('LumiService.fetchHouseholdSnapshot — family-language ratchet (Slice 5-S10)', () => {
  it('appends the Family language block for active terms', async () => {
    const familyLanguageRepository = {
      recordUsage: vi.fn(),
      getTerms: vi.fn().mockResolvedValue([
        {
          term: 'Nani',
          maps_to: 'grandmother',
          usage_count: 3,
          state: 'active',
          first_seen_at: '2026-06-08T10:00:00.000Z',
          ratified_at: '2026-06-08T10:05:00.000Z',
        },
        {
          term: 'Lola',
          maps_to: 'grandmother',
          usage_count: 1,
          state: 'candidate',
          first_seen_at: '2026-06-08T10:00:00.000Z',
          ratified_at: null,
        },
      ]),
    };
    const { service } = buildDeps({ displayName: 'The Patels', familyLanguageRepository });

    const snapshot = await snapshotOf(service)('hh1');

    expect(snapshot).toContain('Family language (use these exact words');
    expect(snapshot).toContain('call the grandmother "Nani"');
    // Only active terms are injected — a candidate term is NOT in the snapshot.
    expect(snapshot).not.toContain('"Lola"');
  });

  it('omits the Family language block when there are no active terms', async () => {
    const familyLanguageRepository = {
      recordUsage: vi.fn(),
      getTerms: vi.fn().mockResolvedValue([]),
    };
    const { service } = buildDeps({ displayName: 'The Patels', familyLanguageRepository });

    const snapshot = await snapshotOf(service)('hh1');

    expect(snapshot).not.toContain('Family language');
  });
});

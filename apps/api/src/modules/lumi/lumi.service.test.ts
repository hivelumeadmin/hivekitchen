import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Turn } from '@hivekitchen/types';

const { respondMock, generateNudgeMock } = vi.hoisted(() => ({
  respondMock: vi.fn(),
  generateNudgeMock: vi.fn(),
}));
vi.mock('../../agents/lumi.agent.js', () => ({
  LumiAgent: class FakeLumiAgent {
    respond = respondMock;
    generateNudge = generateNudgeMock;
  },
}));

import { LumiService, type LumiServiceDeps } from './lumi.service.js';
import { SignalsService } from '../signals/signals.service.js';

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
  // 7-S15 — pass a mock foodPreferencesRepository to exercise the kitchen-profile
  // shared-tastes tool wiring. Omit it to mirror the nudge-job path (no tools).
  foodPreferencesRepository?: { declare: ReturnType<typeof vi.fn> };
  // Story 15-s2 — signals dual-write beside the shared-tastes declare.
  signalsService?: { record: ReturnType<typeof vi.fn> };
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

  const deps = {
    repository,
    redis,
    logger,
    openai,
    childrenRepository,
    householdAllergensRepository,
    voiceTranscriptRepository,
    memoryService: overrides.memoryService,
    familyLanguageRepository: overrides.familyLanguageRepository,
    foodPreferencesRepository: overrides.foodPreferencesRepository,
    signalsService: overrides.signalsService,
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
    openai,
    memoryService: overrides.memoryService,
    familyLanguageRepository: overrides.familyLanguageRepository,
    foodPreferencesRepository: overrides.foodPreferencesRepository,
  };
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
});

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

describe('LumiService.submitTextTurn — kitchen-profile shared-tastes tool (7-S15)', () => {
  it('passes tools + a working executor on the kitchen-profile surface', async () => {
    const declare = vi.fn().mockResolvedValue({ food_preference_id: 'fp1', was_existing: false });
    const { service } = buildDeps({
      activeThread: null,
      foodPreferencesRepository: { declare },
    });

    await service.submitTextTurn({
      householdId: 'hh1',
      message: '[Message]\nwe keep heat mild',
      contextSignal: { surface: 'kitchen-profile' },
    });

    expect(respondMock).toHaveBeenCalledTimes(1);
    const arg = respondMock.mock.calls[0][0] as {
      tools?: unknown[];
      toolExecutor?: (name: string, args: Record<string, unknown>) => Promise<string>;
    };
    expect(Array.isArray(arg.tools)).toBe(true);
    expect(typeof arg.toolExecutor).toBe('function');

    // Driving the executor mirrors what LumiAgent does when the model emits a
    // food_preference__declare tool call.
    const result = await arg.toolExecutor!('food_preference__declare', {
      item: 'chili',
      valence: 'dislikes',
      enforcement: 'strong',
    });
    expect(JSON.parse(result)).toEqual({ declared: true });
    expect(declare).toHaveBeenCalledWith('hh1', null, 'chili', 'dislikes', 'strong', 'parent_edited');
  });

  it('dual-writes a household-scoped preference_edit signal after declare (Story 15-s2)', async () => {
    const declare = vi.fn().mockResolvedValue({ food_preference_id: 'fp1', was_existing: false });
    const record = vi.fn().mockResolvedValue(undefined);
    const { service } = buildDeps({
      activeThread: null,
      foodPreferencesRepository: { declare },
      signalsService: { record },
    });

    await service.submitTextTurn({
      householdId: 'hh1',
      message: '[Message]\nwe keep heat mild',
      contextSignal: { surface: 'kitchen-profile' },
    });
    const arg = respondMock.mock.calls[0][0] as {
      toolExecutor: (name: string, args: Record<string, unknown>) => Promise<string>;
    };
    await arg.toolExecutor('food_preference__declare', {
      item: 'chili',
      valence: 'dislikes',
      enforcement: 'strong',
    });

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      household_id: 'hh1',
      child_id: null,
      payload: {
        kind: 'preference_edit',
        item: 'chili',
        valence: 'dislikes',
        enforcement: 'strong',
        scope: 'household',
      },
      source: 'app',
    });
  });

  it('writes NO signal when declare itself fails (Story 15-s2)', async () => {
    const declare = vi.fn().mockRejectedValue(new Error('db down'));
    const record = vi.fn().mockResolvedValue(undefined);
    const { service } = buildDeps({
      activeThread: null,
      foodPreferencesRepository: { declare },
      signalsService: { record },
    });

    await service.submitTextTurn({
      householdId: 'hh1',
      message: 'hi',
      contextSignal: { surface: 'kitchen-profile' },
    });
    const arg = respondMock.mock.calls[0][0] as {
      toolExecutor: (name: string, args: Record<string, unknown>) => Promise<string>;
    };
    const result = await arg.toolExecutor('food_preference__declare', {
      item: 'chili',
      valence: 'dislikes',
      enforcement: 'strong',
    });

    expect(JSON.parse(result).error).toBeDefined();
    expect(record).not.toHaveBeenCalled();
  });

  it('still declares when the signals write FAILS through the real SignalsService (AC #9)', async () => {
    // A REAL SignalsService whose insert always fails — proves the seam
    // survives a failing signals WRITE, not just an unwired dep (15-s2 review).
    const warn = vi.fn();
    const failingClient = {
      from: (table: string) => {
        if (table !== 'signals') throw new Error(`unexpected table: ${table}`);
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { code: '57014', message: 'insert failed' } }),
            }),
          }),
        };
      },
    };
    const declare = vi.fn().mockResolvedValue({ food_preference_id: 'fp1', was_existing: false });
    const { service } = buildDeps({
      activeThread: null,
      foodPreferencesRepository: { declare },
      signalsService: new SignalsService(
        failingClient as never,
        null,
        { warn },
      ) as unknown as { record: ReturnType<typeof vi.fn> },
    });

    await service.submitTextTurn({
      householdId: 'hh1',
      message: 'hi',
      contextSignal: { surface: 'kitchen-profile' },
    });
    const arg = respondMock.mock.calls[0][0] as {
      toolExecutor: (name: string, args: Record<string, unknown>) => Promise<string>;
    };
    const result = await arg.toolExecutor('food_preference__declare', {
      item: 'chili',
      valence: 'dislikes',
      enforcement: 'strong',
    });

    expect(JSON.parse(result)).toEqual({ declared: true });
    expect(declare).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('the executor rejects invalid tool arguments without calling declare', async () => {
    const declare = vi.fn();
    const { service } = buildDeps({
      activeThread: null,
      foodPreferencesRepository: { declare },
    });
    await service.submitTextTurn({
      householdId: 'hh1',
      message: 'hello',
      contextSignal: { surface: 'kitchen-profile' },
    });
    const arg = respondMock.mock.calls[0][0] as {
      toolExecutor: (name: string, args: Record<string, unknown>) => Promise<string>;
    };
    const result = await arg.toolExecutor('food_preference__declare', { item: 'x', valence: 'nope' });
    expect(JSON.parse(result).error).toBeDefined();
    expect(declare).not.toHaveBeenCalled();
  });

  it('does NOT pass tools on a non-kitchen-profile surface', async () => {
    const { service } = buildDeps({
      activeThread: null,
      foodPreferencesRepository: { declare: vi.fn() },
    });
    await service.submitTextTurn({
      householdId: 'hh1',
      message: 'hi',
      contextSignal: { surface: 'general' },
    });
    const arg = respondMock.mock.calls[0][0] as { tools?: unknown; toolExecutor?: unknown };
    expect(arg.tools).toBeUndefined();
    expect(arg.toolExecutor).toBeUndefined();
  });

  it('does NOT pass tools when the food-preferences repo is absent (nudge-job path)', async () => {
    const { service } = buildDeps({ activeThread: null });
    await service.submitTextTurn({
      householdId: 'hh1',
      message: 'hi',
      contextSignal: { surface: 'kitchen-profile' },
    });
    const arg = respondMock.mock.calls[0][0] as { tools?: unknown; toolExecutor?: unknown };
    expect(arg.tools).toBeUndefined();
    expect(arg.toolExecutor).toBeUndefined();
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
        '{"signals":[{"node_type":"other","facet":"diwali-2026","prose_text":"Diwali is in three weeks.","confidence":0.8}]}',
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
      nodeType: 'other',
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

describe('LumiService.submitTextTurn — time-of-day context (5-S11)', () => {
  afterEach(() => vi.useRealTimers());

  it('passes timeOfDayBand=morning when the call lands at 06:00 UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-09T06:00:00Z') });
    const { service } = buildDeps();

    await service.submitTextTurn({
      householdId: 'hh1',
      message: 'What is for lunch?',
      contextSignal: { surface: 'planning' },
    });

    expect(respondMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversationalContext: { timeOfDayBand: 'morning' } }),
    );
  });

  it('passes timeOfDayBand=afternoon when the call lands at 14:00 UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-09T14:00:00Z') });
    const { service } = buildDeps();

    await service.submitTextTurn({
      householdId: 'hh1',
      message: 'What is for lunch?',
      contextSignal: { surface: 'planning' },
    });

    expect(respondMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversationalContext: { timeOfDayBand: 'afternoon' } }),
    );
  });

  it('passes timeOfDayBand=evening when the call lands at 19:00 UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-09T19:00:00Z') });
    const { service } = buildDeps();

    await service.submitTextTurn({
      householdId: 'hh1',
      message: 'What is for lunch?',
      contextSignal: { surface: 'planning' },
    });

    expect(respondMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversationalContext: { timeOfDayBand: 'evening' } }),
    );
  });

  it('passes timeOfDayBand=night when the call lands at 23:00 UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-09T23:00:00Z') });
    const { service } = buildDeps();

    await service.submitTextTurn({
      householdId: 'hh1',
      message: 'What is for lunch?',
      contextSignal: { surface: 'planning' },
    });

    expect(respondMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversationalContext: { timeOfDayBand: 'night' } }),
    );
  });
});

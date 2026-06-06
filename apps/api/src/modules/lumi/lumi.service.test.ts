import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Turn } from '@hivekitchen/types';

// Mock the LumiAgent so submitTextTurn's call into it is observable without an
// OpenAI round-trip. `respondMock` is hoisted so the factory can close over it.
const { respondMock } = vi.hoisted(() => ({ respondMock: vi.fn() }));
vi.mock('../../agents/lumi.agent.js', () => ({
  LumiAgent: class FakeLumiAgent {
    respond = respondMock;
  },
}));

import { LumiService, type LumiServiceDeps } from './lumi.service.js';

function buildDeps(overrides: {
  displayName?: string | null;
  children?: Array<{ id: string; name: string; age_band: string }>;
  allergens?: Array<{ child_id: string | null; allergen: string }>;
  activeThread?: { id: string } | null;
  priorTurns?: Turn[];
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

  const deps = {
    repository,
    redis: { set: vi.fn(), del: vi.fn() },
    logger,
    elevenLabsApiKey: 'k',
    voiceId: 'v',
    openai,
    childrenRepository,
    householdAllergensRepository,
  } as unknown as LumiServiceDeps;

  const service = new LumiService(deps);
  return { service, repository, childrenRepository, householdAllergensRepository };
}

// fetchHouseholdSnapshot is private; reach it via a typed cast for unit scope.
function snapshotOf(service: LumiService): (id: string) => Promise<string> {
  return (service as unknown as { fetchHouseholdSnapshot: (id: string) => Promise<string> })
    .fetchHouseholdSnapshot.bind(service);
}

beforeEach(() => {
  respondMock.mockReset();
  respondMock.mockResolvedValue('Mocked Lumi reply.');
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

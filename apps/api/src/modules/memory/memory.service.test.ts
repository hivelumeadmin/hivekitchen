import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { MemoryService } from './memory.service.js';
import type {
  MemoryRepository,
  MemoryNodeRow,
  MemoryProvenanceRow,
  InsertNodeInput,
  InsertProvenanceInput,
} from './memory.repository.js';
import type { AuditService } from '../../audit/audit.service.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const THREAD_ID = '33333333-3333-4333-8333-333333333333';
const TURN_ID = '44444444-4444-4444-8444-444444444444';

function makeNodeRow(overrides: Partial<MemoryNodeRow> = {}): MemoryNodeRow {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    household_id: HOUSEHOLD_ID,
    node_type: 'preference',
    facet: 'x',
    subject_child_id: null,
    prose_text: 'x',
    soft_forget_at: null,
    hard_forgotten: false,
    created_at: '2026-04-30T00:00:00.000Z',
    updated_at: '2026-04-30T00:00:00.000Z',
    ...overrides,
  };
}

function makeProvenanceRow(overrides: Partial<MemoryProvenanceRow> = {}): MemoryProvenanceRow {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    memory_node_id: '55555555-5555-4555-8555-555555555555',
    source_type: 'onboarding',
    source_ref: { thread_id: THREAD_ID, turn_id: TURN_ID },
    captured_at: '2026-04-30T00:00:00.000Z',
    captured_by: USER_ID,
    confidence: 0.8,
    superseded_by: null,
    ...overrides,
  };
}

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: vi.fn().mockReturnThis(),
    level: 'info',
    silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

interface FakeRepoState {
  insertNodeCalls: InsertNodeInput[];
  insertProvenanceCalls: InsertProvenanceInput[];
}

function buildRepository(opts: {
  state: FakeRepoState;
  insertNodeImpl?: (input: InsertNodeInput) => Promise<MemoryNodeRow>;
  insertProvenanceImpl?: (input: InsertProvenanceInput) => Promise<MemoryProvenanceRow>;
}): MemoryRepository {
  let nodeCounter = 0;
  return {
    insertNode: vi.fn(async (input: InsertNodeInput) => {
      opts.state.insertNodeCalls.push(input);
      if (opts.insertNodeImpl) return opts.insertNodeImpl(input);
      nodeCounter += 1;
      return makeNodeRow({
        id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(nodeCounter).padStart(12, '0')}`,
        household_id: input.household_id,
        node_type: input.node_type,
        facet: input.facet,
        prose_text: input.prose_text,
        subject_child_id: input.subject_child_id,
      });
    }),
    insertProvenance: vi.fn(async (input: InsertProvenanceInput) => {
      opts.state.insertProvenanceCalls.push(input);
      if (opts.insertProvenanceImpl) return opts.insertProvenanceImpl(input);
      return makeProvenanceRow({
        memory_node_id: input.memory_node_id,
        source_type: input.source_type,
        source_ref: input.source_ref,
        captured_by: input.captured_by,
        confidence: input.confidence,
      });
    }),
  } as unknown as MemoryRepository;
}

describe('MemoryService.seedFromOnboarding', () => {
  it('returns nodeCount=0 and never calls repo when summary is fully empty', async () => {
    const state: FakeRepoState = { insertNodeCalls: [], insertProvenanceCalls: [] };
    const repository = buildRepository({ state });
    const service = new MemoryService({ repository, logger: buildLogger() });

    const result = await service.seedFromOnboarding({
      householdId: HOUSEHOLD_ID,
      userId: USER_ID,
      threadId: THREAD_ID,
      summaryTurnId: TURN_ID,
      summary: {
        cultural_templates: [],
        palate_notes: [],
        allergens_mentioned: [],
        family_rhythms: [],
      },
    });

    expect(result.nodeCount).toBe(0);
    expect(state.insertNodeCalls).toHaveLength(0);
    expect(state.insertProvenanceCalls).toHaveLength(0);
  });

  it('skips arrays that are missing entirely (omitted keys)', async () => {
    const state: FakeRepoState = { insertNodeCalls: [], insertProvenanceCalls: [] };
    const repository = buildRepository({ state });
    const service = new MemoryService({ repository, logger: buildLogger() });

    const result = await service.seedFromOnboarding({
      householdId: HOUSEHOLD_ID,
      userId: USER_ID,
      threadId: THREAD_ID,
      summaryTurnId: TURN_ID,
      summary: {},
    });

    expect(result.nodeCount).toBe(0);
    expect(state.insertNodeCalls).toHaveLength(0);
  });

  it('writes one node + one provenance per disclosed signal across all four arrays', async () => {
    const state: FakeRepoState = { insertNodeCalls: [], insertProvenanceCalls: [] };
    const audit = { write: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const repository = buildRepository({ state });
    const service = new MemoryService({ repository, logger: buildLogger(), audit });

    const result = await service.seedFromOnboarding({
      householdId: HOUSEHOLD_ID,
      userId: USER_ID,
      threadId: THREAD_ID,
      summaryTurnId: TURN_ID,
      summary: {
        allergens_mentioned: ['peanut', 'tree nut'],
        cultural_templates: ['halal'],
        palate_notes: ['avoids spicy'],
        family_rhythms: ['friday is leftover night'],
      },
    });

    expect(result.nodeCount).toBe(5);
    expect(state.insertNodeCalls).toHaveLength(5);
    expect(state.insertProvenanceCalls).toHaveLength(5);

    const types = state.insertNodeCalls.map((c) => c.node_type);
    expect(types).toEqual(['allergy', 'allergy', 'cultural_rhythm', 'preference', 'rhythm']);

    const allergyCall = state.insertNodeCalls.find((c) => c.node_type === 'allergy' && c.facet === 'peanut');
    expect(allergyCall?.prose_text).toBe('Declared allergy: peanut');
    expect(allergyCall?.subject_child_id).toBeNull();

    const culturalCall = state.insertNodeCalls.find((c) => c.node_type === 'cultural_rhythm');
    expect(culturalCall?.prose_text).toBe('Cultural identity: halal');

    const palateCall = state.insertNodeCalls.find((c) => c.node_type === 'preference');
    expect(palateCall?.prose_text).toBe('avoids spicy');

    const rhythmCall = state.insertNodeCalls.find((c) => c.node_type === 'rhythm');
    expect(rhythmCall?.prose_text).toBe('friday is leftover night');

    for (const p of state.insertProvenanceCalls) {
      expect(p.source_type).toBe('onboarding');
      expect(p.source_ref).toEqual({ thread_id: THREAD_ID, turn_id: TURN_ID });
      expect(p.captured_by).toBe(USER_ID);
      expect(p.confidence).toBe(0.8);
    }

    expect(audit.write).toHaveBeenCalledTimes(1);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'memory.seeded',
        household_id: HOUSEHOLD_ID,
        user_id: USER_ID,
        metadata: expect.objectContaining({
          node_count: 5,
          source_type: 'onboarding',
          thread_id: THREAD_ID,
        }),
      }),
    );
  });

  it('truncates over-length facet to 200 chars', async () => {
    const state: FakeRepoState = { insertNodeCalls: [], insertProvenanceCalls: [] };
    const repository = buildRepository({ state });
    const service = new MemoryService({ repository, logger: buildLogger() });

    const longNote = 'x'.repeat(500);
    await service.seedFromOnboarding({
      householdId: HOUSEHOLD_ID,
      userId: USER_ID,
      threadId: THREAD_ID,
      summaryTurnId: TURN_ID,
      summary: { palate_notes: [longNote] },
    });

    expect(state.insertNodeCalls[0].facet.length).toBe(200);
  });

  it('silence-mode: returns nodeCount=0 when every insertNode rejects (does not throw)', async () => {
    const state: FakeRepoState = { insertNodeCalls: [], insertProvenanceCalls: [] };
    const repository = buildRepository({
      state,
      insertNodeImpl: async () => {
        throw new Error('db unavailable');
      },
    });
    const service = new MemoryService({ repository, logger: buildLogger() });

    const result = await service.seedFromOnboarding({
      householdId: HOUSEHOLD_ID,
      userId: USER_ID,
      threadId: THREAD_ID,
      summaryTurnId: TURN_ID,
      summary: { allergens_mentioned: ['peanut'], cultural_templates: ['halal'] },
    });

    expect(result.nodeCount).toBe(0);
    expect(state.insertProvenanceCalls).toHaveLength(0);
  });

  it('partial seeding: keeps node when provenance fails and counts the node', async () => {
    const state: FakeRepoState = { insertNodeCalls: [], insertProvenanceCalls: [] };
    const repository = buildRepository({
      state,
      insertProvenanceImpl: async () => {
        throw new Error('provenance write failed');
      },
    });
    const service = new MemoryService({ repository, logger: buildLogger() });

    const result = await service.seedFromOnboarding({
      householdId: HOUSEHOLD_ID,
      userId: USER_ID,
      threadId: THREAD_ID,
      summaryTurnId: TURN_ID,
      summary: { allergens_mentioned: ['peanut'] },
    });

    expect(result.nodeCount).toBe(1);
    expect(state.insertNodeCalls).toHaveLength(1);
    expect(state.insertProvenanceCalls).toHaveLength(1);
  });

  it('does not call audit when nodeCount is 0', async () => {
    const state: FakeRepoState = { insertNodeCalls: [], insertProvenanceCalls: [] };
    const audit = { write: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const repository = buildRepository({ state });
    const service = new MemoryService({ repository, logger: buildLogger(), audit });

    await service.seedFromOnboarding({
      householdId: HOUSEHOLD_ID,
      userId: USER_ID,
      threadId: THREAD_ID,
      summaryTurnId: TURN_ID,
      summary: {},
    });

    expect(audit.write).not.toHaveBeenCalled();
  });

  it('audit failure does not propagate to caller', async () => {
    const state: FakeRepoState = { insertNodeCalls: [], insertProvenanceCalls: [] };
    const audit = {
      write: vi.fn().mockRejectedValue(new Error('audit down')),
    } as unknown as AuditService;
    const repository = buildRepository({ state });
    const service = new MemoryService({ repository, logger: buildLogger(), audit });

    const result = await service.seedFromOnboarding({
      householdId: HOUSEHOLD_ID,
      userId: USER_ID,
      threadId: THREAD_ID,
      summaryTurnId: TURN_ID,
      summary: { allergens_mentioned: ['peanut'] },
    });

    expect(result.nodeCount).toBe(1);
    expect(audit.write).toHaveBeenCalledTimes(1);
  });
});

describe('MemoryService.noteFromAgent', () => {
  it('writes node + provenance with source_type=tool, captured_by=null', async () => {
    const state: FakeRepoState = { insertNodeCalls: [], insertProvenanceCalls: [] };
    const repository = buildRepository({ state });
    const service = new MemoryService({ repository, logger: buildLogger() });

    const out = await service.noteFromAgent({
      householdId: HOUSEHOLD_ID,
      nodeType: 'preference',
      facet: 'avoids spicy peppers',
      proseText: 'Child avoids spicy peppers and chili oil',
      subjectChildId: null,
      confidence: 0.7,
    });

    expect(out.node_id).toMatch(/^[0-9a-f-]+$/);
    expect(state.insertNodeCalls).toHaveLength(1);
    expect(state.insertProvenanceCalls).toHaveLength(1);
    expect(state.insertProvenanceCalls[0].source_type).toBe('tool');
    expect(state.insertProvenanceCalls[0].captured_by).toBeNull();
    expect(state.insertProvenanceCalls[0].confidence).toBe(0.7);
  });
});

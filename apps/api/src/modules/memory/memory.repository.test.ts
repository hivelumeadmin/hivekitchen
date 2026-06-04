import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MemoryRepository, type MemoryNodeRow } from './memory.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const NODE_ID = '33333333-3333-4333-8333-333333333333';
const PROVENANCE_ID = '44444444-4444-4444-8444-444444444444';
const THREAD_ID = '55555555-5555-4555-8555-555555555555';
const TURN_ID = '66666666-6666-4666-8666-666666666666';

interface InsertCapture {
  table: string;
  payload: Record<string, unknown>;
}

function buildMockClient(opts: {
  insertResult?: { data: Record<string, unknown> | null; error: unknown };
  capture?: InsertCapture[];
}): SupabaseClient {
  const captures = opts.capture ?? [];
  const result = opts.insertResult ?? { data: null, error: null };
  const fromMock = vi.fn().mockImplementation((table: string) => ({
    insert(payload: Record<string, unknown>) {
      captures.push({ table, payload });
      return {
        select() {
          return {
            single: vi.fn().mockResolvedValue(result),
          };
        },
      };
    },
  }));
  return { from: fromMock } as unknown as SupabaseClient;
}

describe('MemoryRepository.insertNode', () => {
  it('writes row to memory_nodes and returns inserted shape', async () => {
    const stored = {
      id: NODE_ID,
      household_id: HOUSEHOLD_ID,
      node_type: 'allergy',
      facet: 'peanut',
      subject_child_id: null,
      prose_text: 'Declared allergy: peanut',
      soft_forget_at: null,
      hard_forgotten: false,
      created_at: '2026-04-30T00:00:00.000Z',
      updated_at: '2026-04-30T00:00:00.000Z',
    };
    const captures: InsertCapture[] = [];
    const client = buildMockClient({
      insertResult: { data: stored, error: null },
      capture: captures,
    });
    const repo = new MemoryRepository(client);

    const out = await repo.insertNode({
      household_id: HOUSEHOLD_ID,
      node_type: 'allergy',
      facet: 'peanut',
      prose_text: 'Declared allergy: peanut',
      subject_child_id: null,
    });

    expect(out.id).toBe(NODE_ID);
    expect(out.node_type).toBe('allergy');
    expect(captures).toHaveLength(1);
    expect(captures[0].table).toBe('memory_nodes');
    expect(captures[0].payload).toMatchObject({
      household_id: HOUSEHOLD_ID,
      node_type: 'allergy',
      facet: 'peanut',
    });
  });

  it('throws when supabase returns an error', async () => {
    const client = buildMockClient({
      insertResult: { data: null, error: { message: 'unique_violation', code: '23505' } },
    });
    const repo = new MemoryRepository(client);

    await expect(
      repo.insertNode({
        household_id: HOUSEHOLD_ID,
        node_type: 'allergy',
        facet: 'peanut',
        prose_text: 'x',
        subject_child_id: null,
      }),
    ).rejects.toMatchObject({ code: '23505' });
  });
});

describe('MemoryRepository.insertProvenance', () => {
  it('writes row to memory_provenance with source_ref jsonb shape', async () => {
    const stored = {
      id: PROVENANCE_ID,
      memory_node_id: NODE_ID,
      source_type: 'onboarding',
      source_ref: { thread_id: THREAD_ID, turn_id: TURN_ID },
      captured_at: '2026-04-30T00:00:00.000Z',
      captured_by: USER_ID,
      confidence: 0.8,
      superseded_by: null,
    };
    const captures: InsertCapture[] = [];
    const client = buildMockClient({
      insertResult: { data: stored, error: null },
      capture: captures,
    });
    const repo = new MemoryRepository(client);

    const out = await repo.insertProvenance({
      memory_node_id: NODE_ID,
      source_type: 'onboarding',
      source_ref: { thread_id: THREAD_ID, turn_id: TURN_ID },
      captured_by: USER_ID,
      confidence: 0.8,
    });

    expect(out.id).toBe(PROVENANCE_ID);
    expect(out.confidence).toBe(0.8);
    expect(captures).toHaveLength(1);
    expect(captures[0].table).toBe('memory_provenance');
    expect(captures[0].payload).toMatchObject({
      memory_node_id: NODE_ID,
      source_type: 'onboarding',
      captured_by: USER_ID,
      confidence: 0.8,
    });
  });

  it('throws when supabase returns an error', async () => {
    const client = buildMockClient({
      insertResult: { data: null, error: { message: 'fk_violation', code: '23503' } },
    });
    const repo = new MemoryRepository(client);

    await expect(
      repo.insertProvenance({
        memory_node_id: NODE_ID,
        source_type: 'onboarding',
        source_ref: {},
        captured_by: null,
        confidence: 0.5,
      }),
    ).rejects.toMatchObject({ code: '23503' });
  });
});

// Story 7-S1 — findActiveNodes read path for the Visible Memory page.
function makeNode(overrides: Partial<MemoryNodeRow>): MemoryNodeRow {
  return {
    id: NODE_ID,
    household_id: HOUSEHOLD_ID,
    node_type: 'preference',
    facet: 'x',
    subject_child_id: null,
    prose_text: 'y',
    soft_forget_at: null,
    hard_forgotten: false,
    created_at: '2026-04-30T00:00:00.000Z',
    updated_at: '2026-04-30T00:00:00.000Z',
    ...overrides,
  };
}

interface QueryCapture {
  table: string;
  eq: Array<{ col: string; val: unknown }>;
  is: Array<{ col: string; val: unknown }>;
  order: { col: string; ascending: boolean } | null;
}

// Models the PostgREST builder chain used by findActiveNodes:
// .select().eq().eq().is().order() — the terminal .order() is awaited and
// resolves with the seeded rows after applying the captured filters/sort.
function buildSelectMockClient(seed: MemoryNodeRow[]): {
  client: SupabaseClient;
  capture: QueryCapture;
} {
  const capture: QueryCapture = { table: '', eq: [], is: [], order: null };

  const resolve = (): Promise<{ data: MemoryNodeRow[]; error: null }> => {
    let rows = [...seed];
    for (const f of capture.eq) {
      rows = rows.filter((r) => (r as unknown as Record<string, unknown>)[f.col] === f.val);
    }
    for (const f of capture.is) {
      rows = rows.filter((r) => (r as unknown as Record<string, unknown>)[f.col] === f.val);
    }
    if (capture.order?.col === 'created_at') {
      const asc = capture.order.ascending;
      rows.sort((a, b) =>
        asc ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at),
      );
    }
    return Promise.resolve({ data: rows, error: null });
  };

  const chain = {
    eq(col: string, val: unknown) {
      capture.eq.push({ col, val });
      return chain;
    },
    is(col: string, val: unknown) {
      capture.is.push({ col, val });
      return chain;
    },
    order(col: string, opts: { ascending: boolean }) {
      capture.order = { col, ascending: opts.ascending };
      return resolve();
    },
  };

  const client = {
    from(table: string) {
      capture.table = table;
      return { select: () => chain };
    },
  } as unknown as SupabaseClient;

  return { client, capture };
}

describe('MemoryRepository.findActiveNodes', () => {
  it('queries memory_nodes filtering hard_forgotten=false AND soft_forget_at IS NULL, ordered created_at ASC', async () => {
    const { client, capture } = buildSelectMockClient([]);
    const repo = new MemoryRepository(client);

    await repo.findActiveNodes(HOUSEHOLD_ID);

    expect(capture.table).toBe('memory_nodes');
    expect(capture.eq).toContainEqual({ col: 'household_id', val: HOUSEHOLD_ID });
    expect(capture.eq).toContainEqual({ col: 'hard_forgotten', val: false });
    expect(capture.is).toContainEqual({ col: 'soft_forget_at', val: null });
    expect(capture.order).toEqual({ col: 'created_at', ascending: true });
  });

  it('returns only nodes with hard_forgotten=false AND soft_forget_at IS NULL', async () => {
    const active1 = makeNode({ id: '00000000-0000-4000-8000-00000000000a', prose_text: 'active 1' });
    const active2 = makeNode({ id: '00000000-0000-4000-8000-00000000000b', prose_text: 'active 2' });
    const hardForgotten = makeNode({
      id: '00000000-0000-4000-8000-00000000000c',
      hard_forgotten: true,
      prose_text: 'hard',
    });
    const softForgotten = makeNode({
      id: '00000000-0000-4000-8000-00000000000d',
      soft_forget_at: '2026-05-01T00:00:00.000Z',
      prose_text: 'soft',
    });
    const { client } = buildSelectMockClient([active1, active2, hardForgotten, softForgotten]);
    const repo = new MemoryRepository(client);

    const out = await repo.findActiveNodes(HOUSEHOLD_ID);

    expect(out.map((n) => n.prose_text)).toEqual(['active 1', 'active 2']);
  });

  it('orders results by created_at ascending', async () => {
    const newer = makeNode({
      id: '00000000-0000-4000-8000-00000000000e',
      created_at: '2026-06-01T00:00:00.000Z',
      prose_text: 'newer',
    });
    const older = makeNode({
      id: '00000000-0000-4000-8000-00000000000f',
      created_at: '2026-01-01T00:00:00.000Z',
      prose_text: 'older',
    });
    const { client } = buildSelectMockClient([newer, older]);
    const repo = new MemoryRepository(client);

    const out = await repo.findActiveNodes(HOUSEHOLD_ID);

    expect(out.map((n) => n.prose_text)).toEqual(['older', 'newer']);
  });

  it('throws when supabase returns an error', async () => {
    const errClient = {
      from: vi.fn().mockReturnValue({
        select: () => ({
          eq: function () {
            return this;
          },
          is: function () {
            return this;
          },
          order: () => Promise.resolve({ data: null, error: { message: 'boom', code: 'XX000' } }),
        }),
      }),
    } as unknown as SupabaseClient;
    const repo = new MemoryRepository(errClient);

    await expect(repo.findActiveNodes(HOUSEHOLD_ID)).rejects.toMatchObject({ code: 'XX000' });
  });
});

// Story 7-S2 — findNodeByIdForHousehold + findProvenanceByNodeId

function buildMaybeSingleClient(result: { data: unknown; error: unknown }): SupabaseClient {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: function () {
          return this;
        },
        maybeSingle: vi.fn().mockResolvedValue(result),
      }),
    }),
  } as unknown as SupabaseClient;
}

function buildProvenanceMockClient(rows: unknown[]): SupabaseClient {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: function () {
          return this;
        },
        order: vi.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe('MemoryRepository.findNodeByIdForHousehold', () => {
  it('returns the node when id + household_id match', async () => {
    const node = makeNode({});
    const client = buildMaybeSingleClient({ data: node, error: null });
    const repo = new MemoryRepository(client);

    const result = await repo.findNodeByIdForHousehold(NODE_ID, HOUSEHOLD_ID);

    expect(result).toEqual(node);
  });

  it('returns null when the node does not exist or belongs to a different household', async () => {
    const client = buildMaybeSingleClient({ data: null, error: null });
    const repo = new MemoryRepository(client);

    const result = await repo.findNodeByIdForHousehold(NODE_ID, HOUSEHOLD_ID);

    expect(result).toBeNull();
  });

  it('throws when supabase returns an error', async () => {
    const client = buildMaybeSingleClient({ data: null, error: { message: 'db error', code: 'XX000' } });
    const repo = new MemoryRepository(client);

    await expect(repo.findNodeByIdForHousehold(NODE_ID, HOUSEHOLD_ID)).rejects.toMatchObject({ code: 'XX000' });
  });
});

describe('MemoryRepository.findProvenanceByNodeId', () => {
  const sampleProvenance = {
    id: PROVENANCE_ID,
    memory_node_id: NODE_ID,
    source_type: 'turn',
    source_ref: {},
    captured_at: '2026-04-30T00:00:00.000Z',
    captured_by: USER_ID,
    confidence: 0.87,
    superseded_by: null,
  };

  it('returns provenance rows ordered captured_at DESC', async () => {
    const rows = [sampleProvenance];
    const client = buildProvenanceMockClient(rows);
    const repo = new MemoryRepository(client);

    const result = await repo.findProvenanceByNodeId(NODE_ID);

    expect(result).toEqual(rows);
  });

  it('returns an empty array when there are no provenance records', async () => {
    const client = buildProvenanceMockClient([]);
    const repo = new MemoryRepository(client);

    const result = await repo.findProvenanceByNodeId(NODE_ID);

    expect(result).toEqual([]);
  });

  it('throws when supabase returns an error', async () => {
    const errClient = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: function () { return this; },
          order: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom', code: 'XX000' } }),
        }),
      }),
    } as unknown as SupabaseClient;
    const repo = new MemoryRepository(errClient);

    await expect(repo.findProvenanceByNodeId(NODE_ID)).rejects.toMatchObject({ code: 'XX000' });
  });
});

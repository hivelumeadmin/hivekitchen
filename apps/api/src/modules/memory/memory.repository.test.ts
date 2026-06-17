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
      node_type: 'other',
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
      node_type: 'other',
      facet: 'peanut',
      prose_text: 'Declared allergy: peanut',
      subject_child_id: null,
    });

    expect(out.id).toBe(NODE_ID);
    expect(out.node_type).toBe('other');
    expect(captures).toHaveLength(1);
    expect(captures[0].table).toBe('memory_nodes');
    expect(captures[0].payload).toMatchObject({
      household_id: HOUSEHOLD_ID,
      node_type: 'other',
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
        node_type: 'other',
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
    node_type: 'other',
    facet: 'x',
    subject_child_id: null,
    prose_text: 'y',
    soft_forget_at: null,
    forget_reason: null,
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
  it('queries memory_nodes filtering hard_forgotten=false only (no soft_forget_at filter), ordered created_at ASC', async () => {
    const { client, capture } = buildSelectMockClient([]);
    const repo = new MemoryRepository(client);

    await repo.findActiveNodes(HOUSEHOLD_ID);

    expect(capture.table).toBe('memory_nodes');
    expect(capture.eq).toContainEqual({ col: 'household_id', val: HOUSEHOLD_ID });
    expect(capture.eq).toContainEqual({ col: 'hard_forgotten', val: false });
    expect(capture.is).not.toContainEqual({ col: 'soft_forget_at', val: null });
    expect(capture.order).toEqual({ col: 'created_at', ascending: true });
  });

  it('returns active AND soft-forgotten nodes (only hard_forgotten is excluded)', async () => {
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
      created_at: '2026-05-01T00:00:00.000Z',
      prose_text: 'soft',
    });
    const { client } = buildSelectMockClient([active1, active2, hardForgotten, softForgotten]);
    const repo = new MemoryRepository(client);

    const out = await repo.findActiveNodes(HOUSEHOLD_ID);

    expect(out.map((n) => n.prose_text)).toEqual(['active 1', 'active 2', 'soft']);
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

// Story 7-S4 — findNodes (planner recall) now excludes soft-forgotten nodes.
describe('MemoryRepository.findNodes', () => {
  it('excludes hard- AND soft-forgotten nodes from planner recall (soft_forget_at IS NULL)', async () => {
    const eq: Array<{ col: string; val: unknown }> = [];
    const is: Array<{ col: string; val: unknown }> = [];
    const builder = {
      eq(col: string, val: unknown) {
        eq.push({ col, val });
        return builder;
      },
      is(col: string, val: unknown) {
        is.push({ col, val });
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return Promise.resolve({ data: [], error: null });
      },
    };
    const client = {
      from: () => ({ select: () => builder }),
    } as unknown as SupabaseClient;
    const repo = new MemoryRepository(client);

    await repo.findNodes({ household_id: HOUSEHOLD_ID, limit: 20 });

    expect(eq).toContainEqual({ col: 'hard_forgotten', val: false });
    expect(is).toContainEqual({ col: 'soft_forget_at', val: null });
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

// Story 7-S3 — updateNodeProse

interface UpdateCapture {
  table: string;
  update: Record<string, unknown> | null;
  eq: Array<{ col: string; val: unknown }>;
  is: Array<{ col: string; val: unknown }>;
}

// Models the PostgREST builder chain used by updateNodeProse:
// .update().eq().eq().select().maybeSingle()
// Also captures .is() so softForgetNode (.update().eq().eq().is().select())
// can reuse this builder.
function buildUpdateMockClient(result: { data: unknown; error: unknown }): {
  client: SupabaseClient;
  capture: UpdateCapture;
} {
  const capture: UpdateCapture = { table: '', update: null, eq: [], is: [] };
  const chain = {
    eq(col: string, val: unknown) {
      capture.eq.push({ col, val });
      return chain;
    },
    is(col: string, val: unknown) {
      capture.is.push({ col, val });
      return chain;
    },
    select() {
      return { maybeSingle: vi.fn().mockResolvedValue(result) };
    },
  };
  const client = {
    from(table: string) {
      capture.table = table;
      return {
        update(payload: Record<string, unknown>) {
          capture.update = payload;
          return chain;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, capture };
}

describe('MemoryRepository.updateNodeProse', () => {
  it('updates prose_text filtered by id AND household_id and returns the row', async () => {
    const stored = makeNode({ prose_text: 'corrected text' });
    const { client, capture } = buildUpdateMockClient({ data: stored, error: null });
    const repo = new MemoryRepository(client);

    const out = await repo.updateNodeProse(NODE_ID, HOUSEHOLD_ID, 'corrected text');

    expect(out?.prose_text).toBe('corrected text');
    expect(capture.table).toBe('memory_nodes');
    expect(capture.update).toEqual({ prose_text: 'corrected text' });
    expect(capture.eq).toContainEqual({ col: 'id', val: NODE_ID });
    expect(capture.eq).toContainEqual({ col: 'household_id', val: HOUSEHOLD_ID });
  });

  // Story 7-S5 review (P1) — D3 TOCTOU: the update must filter soft_forget_at IS
  // NULL so a node soft-forgotten after editProse's pre-check is not edited.
  it('filters soft_forget_at IS NULL so a concurrently-tombstoned node is not edited', async () => {
    const { client, capture } = buildUpdateMockClient({ data: makeNode({}), error: null });
    const repo = new MemoryRepository(client);

    await repo.updateNodeProse(NODE_ID, HOUSEHOLD_ID, 'x');

    expect(capture.is).toContainEqual({ col: 'soft_forget_at', val: null });
  });

  it('returns null when the node is not found (TOCTOU race between pre-check and update)', async () => {
    const { client } = buildUpdateMockClient({ data: null, error: null });
    const repo = new MemoryRepository(client);

    const out = await repo.updateNodeProse(NODE_ID, HOUSEHOLD_ID, 'x');

    expect(out).toBeNull();
  });

  it('throws when supabase returns an error', async () => {
    const { client } = buildUpdateMockClient({ data: null, error: { message: 'boom', code: 'XX000' } });
    const repo = new MemoryRepository(client);

    await expect(repo.updateNodeProse(NODE_ID, HOUSEHOLD_ID, 'x')).rejects.toMatchObject({
      code: 'XX000',
    });
  });
});

// Story 7-S4 — softForgetNode

describe('MemoryRepository.softForgetNode', () => {
  const SOFT_AT = '2026-06-05T00:00:00.000Z';

  it('updates soft_forget_at + forget_reason filtered by id AND household_id AND soft_forget_at IS NULL, returns the row', async () => {
    const stored = makeNode({ soft_forget_at: SOFT_AT, forget_reason: 'too spicy' });
    const { client, capture } = buildUpdateMockClient({ data: stored, error: null });
    const repo = new MemoryRepository(client);

    const out = await repo.softForgetNode(NODE_ID, HOUSEHOLD_ID, SOFT_AT, 'too spicy');

    expect(out?.soft_forget_at).toBe(SOFT_AT);
    expect(out?.forget_reason).toBe('too spicy');
    expect(capture.table).toBe('memory_nodes');
    expect(capture.update).toEqual({ soft_forget_at: SOFT_AT, forget_reason: 'too spicy' });
    expect(capture.eq).toContainEqual({ col: 'id', val: NODE_ID });
    expect(capture.eq).toContainEqual({ col: 'household_id', val: HOUSEHOLD_ID });
    expect(capture.is).toContainEqual({ col: 'soft_forget_at', val: null });
  });

  it('returns null when no row is updated (not found, cross-household, or already soft-forgotten)', async () => {
    const { client } = buildUpdateMockClient({ data: null, error: null });
    const repo = new MemoryRepository(client);

    const out = await repo.softForgetNode(NODE_ID, HOUSEHOLD_ID, SOFT_AT, null);

    expect(out).toBeNull();
  });

  it('throws when supabase returns an error', async () => {
    const { client } = buildUpdateMockClient({ data: null, error: { message: 'boom', code: 'XX000' } });
    const repo = new MemoryRepository(client);

    await expect(repo.softForgetNode(NODE_ID, HOUSEHOLD_ID, SOFT_AT, null)).rejects.toMatchObject({
      code: 'XX000',
    });
  });
});

// Story 7-S5 — hardDeleteSoftForgotten

interface DeleteFilterCapture {
  method: string;
  col: string;
  val: unknown;
}

interface DeleteCapture {
  table: string;
  selectCols: string | null;
  filters: DeleteFilterCapture[];
}

// Models the PostgREST delete chain used by hardDeleteSoftForgotten:
// .delete().not().lt().select() — captures the target table, the .not()/.lt()
// filters, and the .select() column string, then resolves with the seeded result.
function buildDeleteMockClient(result: {
  data: Array<{ id: string; household_id: string; node_type: string }> | null;
  error: unknown;
}): { client: SupabaseClient; capture: DeleteCapture } {
  const capture: DeleteCapture = { table: '', selectCols: null, filters: [] };
  const client = {
    from: vi.fn().mockImplementation((table: string) => {
      capture.table = table;
      return {
        delete: vi.fn().mockReturnValue({
          not: vi.fn().mockImplementation((col: string, op: string, val: unknown) => {
            capture.filters.push({ method: 'not', col, val: `${op}:${String(val)}` });
            return {
              lt: vi.fn().mockImplementation((col2: string, val2: unknown) => {
                capture.filters.push({ method: 'lt', col: col2, val: val2 });
                return {
                  select: vi.fn().mockImplementation((cols: string) => {
                    capture.selectCols = cols;
                    return Promise.resolve(result);
                  }),
                };
              }),
            };
          }),
        }),
      };
    }),
  } as unknown as SupabaseClient;
  return { client, capture };
}

describe('MemoryRepository.hardDeleteSoftForgotten', () => {
  const CUTOFF = '2026-05-06T00:00:00.000Z';

  it('deletes from memory_nodes, filters soft_forget_at IS NOT NULL AND < cutoffAt, and selects the audit columns', async () => {
    const { client, capture } = buildDeleteMockClient({ data: [], error: null });
    const repo = new MemoryRepository(client);

    await repo.hardDeleteSoftForgotten(CUTOFF);

    expect(capture.table).toBe('memory_nodes');
    expect(capture.filters).toContainEqual({ method: 'not', col: 'soft_forget_at', val: 'is:null' });
    expect(capture.filters).toContainEqual({ method: 'lt', col: 'soft_forget_at', val: CUTOFF });
    // These columns feed the memory.hard_forgotten audit metadata — a wrong-columns
    // regression must fail the test.
    expect(capture.selectCols).toBe('id, household_id, node_type');
  });

  it('returns the deleted rows (id, household_id, node_type) on success', async () => {
    const rows = [
      { id: NODE_ID, household_id: HOUSEHOLD_ID, node_type: 'other' },
      { id: '77777777-7777-4777-8777-777777777777', household_id: HOUSEHOLD_ID, node_type: 'other' },
    ];
    const { client } = buildDeleteMockClient({ data: rows, error: null });
    const repo = new MemoryRepository(client);

    const out = await repo.hardDeleteSoftForgotten(CUTOFF);

    expect(out).toEqual(rows);
  });

  it('returns [] when supabase returns null data', async () => {
    const { client } = buildDeleteMockClient({ data: null, error: null });
    const repo = new MemoryRepository(client);

    const out = await repo.hardDeleteSoftForgotten(CUTOFF);

    expect(out).toEqual([]);
  });

  it('throws when supabase returns an error', async () => {
    const { client } = buildDeleteMockClient({ data: null, error: { message: 'boom', code: 'XX000' } });
    const repo = new MemoryRepository(client);

    await expect(repo.hardDeleteSoftForgotten(CUTOFF)).rejects.toMatchObject({ code: 'XX000' });
  });
});

// Story 7-S7 — softForgetChildNodes (bulk soft-forget scoped to a child)

interface BulkUpdateCapture {
  table: string;
  update: Record<string, unknown> | null;
  filters: Array<{ method: string; col: string; val: unknown }>;
  selectCols: string | null;
}

// Models the PostgREST chain used by softForgetChildNodes:
// .update().eq().eq().is().select('id') — the terminal .select() resolves
// directly to { data, error } (no .maybeSingle()).
function buildBulkUpdateMockClient(result: { data: unknown; error: unknown }): {
  client: SupabaseClient;
  capture: BulkUpdateCapture;
} {
  const capture: BulkUpdateCapture = { table: '', update: null, filters: [], selectCols: null };
  const chain = {
    eq(col: string, val: unknown) {
      capture.filters.push({ method: 'eq', col, val });
      return chain;
    },
    is(col: string, val: unknown) {
      capture.filters.push({ method: 'is', col, val });
      return chain;
    },
    select(cols: string) {
      capture.selectCols = cols;
      return Promise.resolve(result);
    },
  };
  const client = {
    from(table: string) {
      capture.table = table;
      return {
        update(payload: Record<string, unknown>) {
          capture.update = payload;
          return chain;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, capture };
}

describe('MemoryRepository.softForgetChildNodes', () => {
  const SOFT_AT = '2026-06-07T00:00:00.000Z';
  const CHILD_ID = '99999999-9999-4999-8999-999999999999';

  it('bulk-updates memory_nodes filtered by subject_child_id, household_id, and soft_forget_at IS NULL', async () => {
    const { client, capture } = buildBulkUpdateMockClient({
      data: [{ id: NODE_ID }, { id: '88888888-8888-4888-8888-888888888888' }],
      error: null,
    });
    const repo = new MemoryRepository(client);

    await repo.softForgetChildNodes(CHILD_ID, HOUSEHOLD_ID, SOFT_AT);

    expect(capture.table).toBe('memory_nodes');
    // Stamps forget_reason='annual_reset' alongside soft_forget_at (mirrors the
    // per-node softForgetNode so bulk-reset nodes are distinguishable in audits).
    expect(capture.update).toEqual({ soft_forget_at: SOFT_AT, forget_reason: 'annual_reset' });
    expect(capture.filters).toContainEqual({ method: 'eq', col: 'subject_child_id', val: CHILD_ID });
    expect(capture.filters).toContainEqual({ method: 'eq', col: 'household_id', val: HOUSEHOLD_ID });
    // The IS NULL guard makes the bulk update idempotent (no double-stamping).
    expect(capture.filters).toContainEqual({ method: 'is', col: 'soft_forget_at', val: null });
  });

  it('returns the count of updated rows', async () => {
    const { client } = buildBulkUpdateMockClient({
      data: [{ id: NODE_ID }, { id: '88888888-8888-4888-8888-888888888888' }],
      error: null,
    });
    const repo = new MemoryRepository(client);

    const count = await repo.softForgetChildNodes(CHILD_ID, HOUSEHOLD_ID, SOFT_AT);

    expect(count).toBe(2);
  });

  it('returns 0 when no nodes match (already soft-forgotten or none exist)', async () => {
    const { client } = buildBulkUpdateMockClient({ data: [], error: null });
    const repo = new MemoryRepository(client);

    const count = await repo.softForgetChildNodes(CHILD_ID, HOUSEHOLD_ID, SOFT_AT);

    expect(count).toBe(0);
  });

  it('throws when supabase returns an error', async () => {
    const { client } = buildBulkUpdateMockClient({
      data: null,
      error: { message: 'boom', code: 'XX000' },
    });
    const repo = new MemoryRepository(client);

    await expect(repo.softForgetChildNodes(CHILD_ID, HOUSEHOLD_ID, SOFT_AT)).rejects.toMatchObject({
      code: 'XX000',
    });
  });
});

// Story 7-S8 — findActiveProvenanceSourcesByHousehold (counts-by-source feed)

interface EmbedQueryCapture {
  table: string;
  selectCols: string | null;
  eq: Array<{ col: string; val: unknown }>;
  is: Array<{ col: string; val: unknown }>;
}

// Models the PostgREST embedded-select chain used by
// findActiveProvenanceSourcesByHousehold:
// .select('subject_child_id, memory_provenance(source_type)').eq().eq().is()
// The terminal .is() is awaited directly and resolves with the seeded rows.
function buildEmbedMockClient(result: { data: unknown; error: unknown }): {
  client: SupabaseClient;
  capture: EmbedQueryCapture;
} {
  const capture: EmbedQueryCapture = { table: '', selectCols: null, eq: [], is: [] };
  const chain = {
    eq(col: string, val: unknown) {
      capture.eq.push({ col, val });
      return chain;
    },
    is(col: string, val: unknown) {
      capture.is.push({ col, val });
      return Promise.resolve(result);
    },
  };
  const client = {
    from(table: string) {
      capture.table = table;
      return {
        select(cols: string) {
          capture.selectCols = cols;
          return chain;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, capture };
}

describe('MemoryRepository.findActiveProvenanceSourcesByHousehold', () => {
  it('flattens nested provenance into one row per provenance record, filtering active nodes', async () => {
    const rows = [
      {
        subject_child_id: '99999999-9999-4999-8999-999999999999',
        memory_provenance: [{ source_type: 'onboarding' }, { source_type: 'user_edit' }],
      },
      {
        subject_child_id: null,
        memory_provenance: [{ source_type: 'turn' }],
      },
    ];
    const { client, capture } = buildEmbedMockClient({ data: rows, error: null });
    const repo = new MemoryRepository(client);

    const out = await repo.findActiveProvenanceSourcesByHousehold(HOUSEHOLD_ID);

    expect(capture.table).toBe('memory_nodes');
    expect(capture.selectCols).toBe('subject_child_id, memory_provenance(source_type)');
    // Only active nodes are counted — assert the filters are applied.
    expect(capture.eq).toContainEqual({ col: 'household_id', val: HOUSEHOLD_ID });
    expect(capture.eq).toContainEqual({ col: 'hard_forgotten', val: false });
    expect(capture.is).toContainEqual({ col: 'soft_forget_at', val: null });
    expect(out).toEqual([
      { subject_child_id: '99999999-9999-4999-8999-999999999999', source_type: 'onboarding' },
      { subject_child_id: '99999999-9999-4999-8999-999999999999', source_type: 'user_edit' },
      { subject_child_id: null, source_type: 'turn' },
    ]);
  });

  it('returns [] when no active nodes exist', async () => {
    const { client } = buildEmbedMockClient({ data: [], error: null });
    const repo = new MemoryRepository(client);

    const out = await repo.findActiveProvenanceSourcesByHousehold(HOUSEHOLD_ID);

    expect(out).toEqual([]);
  });

  it('tolerates a node with no provenance rows (null embed)', async () => {
    const rows = [{ subject_child_id: null, memory_provenance: null }];
    const { client } = buildEmbedMockClient({ data: rows, error: null });
    const repo = new MemoryRepository(client);

    const out = await repo.findActiveProvenanceSourcesByHousehold(HOUSEHOLD_ID);

    expect(out).toEqual([]);
  });

  it('throws when supabase returns an error', async () => {
    const { client } = buildEmbedMockClient({ data: null, error: { message: 'boom', code: 'XX000' } });
    const repo = new MemoryRepository(client);

    await expect(repo.findActiveProvenanceSourcesByHousehold(HOUSEHOLD_ID)).rejects.toMatchObject({
      code: 'XX000',
    });
  });
});

// Slice 5-S8 — findRecentTurnSourcedNodes (turn-sourced threshold for the
// "I noticed" learning moment).

interface TurnQueryCapture {
  table: string;
  selectCols: string | null;
  eq: Array<{ col: string; val: unknown }>;
  is: Array<{ col: string; val: unknown }>;
  gte: Array<{ col: string; val: unknown }>;
  order: { col: string; ascending: boolean } | null;
  limit: number | null;
}

// Models the PostgREST embedded-join chain used by findRecentTurnSourcedNodes:
// .select(...).eq().is().gte().eq().order().limit() — the terminal .limit() is
// awaited and resolves with the seeded result.
function buildTurnMockClient(result: { data: unknown; error: unknown }): {
  client: SupabaseClient;
  capture: TurnQueryCapture;
} {
  const capture: TurnQueryCapture = {
    table: '',
    selectCols: null,
    eq: [],
    is: [],
    gte: [],
    order: null,
    limit: null,
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
    gte(col: string, val: unknown) {
      capture.gte.push({ col, val });
      return chain;
    },
    order(col: string, opts: { ascending: boolean }) {
      capture.order = { col, ascending: opts.ascending };
      return chain;
    },
    limit(n: number) {
      capture.limit = n;
      return Promise.resolve(result);
    },
  };
  const client = {
    from(table: string) {
      capture.table = table;
      return {
        select(cols: string) {
          capture.selectCols = cols;
          return chain;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, capture };
}

describe('MemoryRepository.findRecentTurnSourcedNodes', () => {
  const SINCE = '2026-05-31T00:00:00.000Z';

  it('returns nodes joined with turn-sourced provenance, filtered to the window', async () => {
    const rows = [
      {
        id: NODE_ID,
        prose_text: 'loves spicy food',
        node_type: 'other',
        created_at: '2026-06-06T00:00:00.000Z',
        memory_provenance: [{ source_type: 'turn' }],
      },
      {
        id: '88888888-8888-4888-8888-888888888888',
        prose_text: 'packs lunch on Sundays',
        node_type: 'routine',
        created_at: '2026-06-05T00:00:00.000Z',
        memory_provenance: [{ source_type: 'turn' }],
      },
    ];
    const { client, capture } = buildTurnMockClient({ data: rows, error: null });
    const repo = new MemoryRepository(client);

    const out = await repo.findRecentTurnSourcedNodes(HOUSEHOLD_ID, SINCE);

    expect(capture.table).toBe('memory_nodes');
    expect(capture.selectCols).toBe(
      'id, prose_text, node_type, created_at, memory_provenance!inner(source_type)',
    );
    expect(capture.eq).toContainEqual({ col: 'household_id', val: HOUSEHOLD_ID });
    expect(capture.eq).toContainEqual({ col: 'memory_provenance.source_type', val: 'turn' });
    expect(capture.is).toContainEqual({ col: 'soft_forget_at', val: null });
    expect(capture.gte).toContainEqual({ col: 'created_at', val: SINCE });
    expect(capture.order).toEqual({ col: 'created_at', ascending: false });
    // The embedded provenance array is stripped from the mapped output.
    expect(out).toEqual([
      { id: NODE_ID, prose_text: 'loves spicy food', node_type: 'other', created_at: '2026-06-06T00:00:00.000Z' },
      {
        id: '88888888-8888-4888-8888-888888888888',
        prose_text: 'packs lunch on Sundays',
        node_type: 'routine',
        created_at: '2026-06-05T00:00:00.000Z',
      },
    ]);
  });

  it('returns an empty array on a Supabase error (no throw)', async () => {
    const { client } = buildTurnMockClient({ data: null, error: { message: 'db', code: 'XX000' } });
    const repo = new MemoryRepository(client);

    const out = await repo.findRecentTurnSourcedNodes(HOUSEHOLD_ID, SINCE);

    expect(out).toEqual([]);
  });
});

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptField } from '../../lib/envelope-encryption.js';
import { HeartNoteRepository, type HeartNoteRow } from './heart-note.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function noopCiphertext(plaintext: string): string {
  return encryptField(plaintext, null);
}

function makeRow(overrides: Partial<HeartNoteRow> = {}): HeartNoteRow {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    household_id: HOUSEHOLD_ID,
    child_id: CHILD_ID,
    author_user_id: USER_ID,
    content: noopCiphertext('hello'),
    status: 'draft',
    scheduled_for: null,
    delivered_at: null,
    cancelled_at: null,
    created_at: '2026-05-15T12:00:00.000Z',
    updated_at: '2026-05-15T12:00:00.000Z',
    ...overrides,
  };
}

interface MockState {
  inserts: Array<Record<string, unknown>>;
  updates: Array<Record<string, unknown>>;
  updateFilters: Array<Record<string, unknown>>;
}

interface SelectChainOpts {
  storeRows: HeartNoteRow[];
}

function buildMockClient(opts: {
  rows?: HeartNoteRow[];
  insertResult?: HeartNoteRow | null;
  patchResult?: HeartNoteRow | null;
}) {
  const state: MockState = { inserts: [], updates: [], updateFilters: [] };
  const storeRows = opts.rows ?? [];

  function selectChain(storeOpts: SelectChainOpts) {
    const filters: Record<string, unknown> = {};
    const neqFilters: Record<string, unknown> = {};
    const inFilters: Record<string, unknown[]> = {};
    const rangeFilters: Array<{ col: string; op: 'gte' | 'lt'; val: string }> = [];
    let orderCol: string | undefined;
    let orderAsc = true;
    let limitN: number | undefined;

    function matches(r: HeartNoteRow): boolean {
      for (const [col, val] of Object.entries(filters)) {
        if ((r as unknown as Record<string, unknown>)[col] !== val) return false;
      }
      for (const [col, val] of Object.entries(neqFilters)) {
        if ((r as unknown as Record<string, unknown>)[col] === val) return false;
      }
      for (const [col, vals] of Object.entries(inFilters)) {
        const v = (r as unknown as Record<string, unknown>)[col];
        if (!vals.includes(v)) return false;
      }
      for (const { col, op, val } of rangeFilters) {
        const rv = ((r as unknown as Record<string, string>)[col] ?? '') as string;
        if (op === 'gte' && !(rv >= val)) return false;
        if (op === 'lt' && !(rv < val)) return false;
      }
      return true;
    }

    function applyOrderLimit(rows: HeartNoteRow[]): HeartNoteRow[] {
      let result = rows;
      if (orderCol) {
        const col = orderCol;
        result = [...result].sort((a, b) => {
          const av = (a as unknown as Record<string, string>)[col] ?? '';
          const bv = (b as unknown as Record<string, string>)[col] ?? '';
          if (av === bv) return 0;
          return orderAsc ? (av < bv ? -1 : 1) : av < bv ? 1 : -1;
        });
      }
      if (limitN !== undefined) result = result.slice(0, limitN);
      return result;
    }

    const chain = {
      eq(col: string, val: unknown) {
        filters[col] = val;
        return chain;
      },
      neq(col: string, val: unknown) {
        neqFilters[col] = val;
        return chain;
      },
      gte(col: string, val: string) {
        rangeFilters.push({ col, op: 'gte', val });
        return chain;
      },
      lt(col: string, val: string) {
        rangeFilters.push({ col, op: 'lt', val });
        return chain;
      },
      in(col: string, vals: unknown[]) {
        inFilters[col] = vals;
        return chain;
      },
      order(col: string, options: { ascending: boolean }) {
        orderCol = col;
        orderAsc = options.ascending;
        return chain;
      },
      limit(n: number) {
        limitN = n;
        return chain;
      },
      maybeSingle: vi.fn().mockImplementation(async () => {
        const filtered = storeOpts.storeRows.filter(matches);
        const result = applyOrderLimit(filtered);
        return { data: result[0] ?? null, error: null };
      }),
      // listByHousehold awaits the chain directly (no maybeSingle / single).
      // Supabase's PostgrestFilterBuilder is thenable; vi.fn doesn't get
      // exercised here because the test simply awaits the chain.
      // countAuthoredThisMonth (head: true) reads `count` off the same await.
      then(resolve: (value: { data: HeartNoteRow[]; count: number; error: null }) => void) {
        const filtered = storeOpts.storeRows.filter(matches);
        const result = applyOrderLimit(filtered);
        resolve({ data: result, count: filtered.length, error: null });
      },
    };
    return chain;
  }

  const heartNotesTable = {
    insert(payload: Record<string, unknown>) {
      state.inserts.push(payload);
      return {
        select: () => ({
          single: vi.fn().mockResolvedValue({
            data:
              opts.insertResult ?? {
                ...payload,
                id: 'new-id',
                status: 'draft',
                delivered_at: null,
                cancelled_at: null,
                created_at: '2026-05-17T00:00:00.000Z',
                updated_at: '2026-05-17T00:00:00.000Z',
              },
            error: null,
          }),
        }),
      };
    },
    update(payload: Record<string, unknown>) {
      state.updates.push(payload);
      const filters: Record<string, unknown> = {};
      state.updateFilters.push(filters);
      const updateChain = {
        eq(col: string, val: unknown) {
          filters[col] = val;
          return updateChain;
        },
        select(_cols: string) {
          return {
            // The patch() path calls .select(...).maybeSingle()
            maybeSingle: vi.fn().mockResolvedValue({
              data:
                opts.patchResult === undefined
                  ? { ...(storeRows[0] ?? makeRow()), ...payload }
                  : opts.patchResult,
              error: null,
            }),
            // The deliverScheduled() path awaits .select(...) directly to get
            // back an array of {id} rows.
            then(resolve: (value: { data: Array<{ id: string }>; error: null }) => void) {
              const updated = storeRows
                .filter((r) => {
                  for (const [col, val] of Object.entries(filters)) {
                    if ((r as unknown as Record<string, unknown>)[col] !== val) return false;
                  }
                  return true;
                })
                .map((r) => ({ id: r.id }));
              resolve({ data: updated, error: null });
            },
          };
        },
      };
      return updateChain;
    },
    select(_cols: string) {
      return selectChain({ storeRows });
    },
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'heart_notes') return heartNotesTable;
      throw new Error(`unexpected table: ${table}`);
    }),
    state,
  };
}

describe('HeartNoteRepository.create (NOOP mode — kek = null)', () => {
  it('encrypts content (NOOP-prefixed) before inserting, returns plaintext to caller', async () => {
    const mock = buildMockClient({});
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.create({
      householdId: HOUSEHOLD_ID,
      childId: CHILD_ID,
      authorUserId: USER_ID,
      content: 'Have a great day!',
    });

    const insertedContent = mock.state.inserts[0]?.content as string;
    expect(insertedContent.startsWith('NOOP:')).toBe(true);
    expect(result.content).toBe('Have a great day!');
  });

  it('handles empty-string content (round-trip works)', async () => {
    const mock = buildMockClient({});
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.create({
      householdId: HOUSEHOLD_ID,
      childId: CHILD_ID,
      authorUserId: USER_ID,
      content: '',
    });

    const insertedContent = mock.state.inserts[0]?.content as string;
    expect(insertedContent.startsWith('NOOP:')).toBe(true);
    expect(result.content).toBe('');
  });
});

describe('HeartNoteRepository.findByChildAndDate (NOOP mode — kek = null)', () => {
  it('decrypts NOOP-prefixed content, returns plaintext', async () => {
    const row = makeRow({
      content: noopCiphertext('saved draft'),
      created_at: '2026-05-17T12:00:00.000Z',
    });
    const mock = buildMockClient({ rows: [row] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.findByChildAndDate(HOUSEHOLD_ID, CHILD_ID, '2026-05-17');

    expect(result?.content).toBe('saved draft');
  });

  it('returns null when no row matches', async () => {
    const mock = buildMockClient({ rows: [] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.findByChildAndDate(HOUSEHOLD_ID, CHILD_ID, '2026-05-17');

    expect(result).toBeNull();
  });

  it('returns null when created_at is a different date', async () => {
    const row = makeRow({ created_at: '2026-05-16T12:00:00.000Z' });
    const mock = buildMockClient({ rows: [row] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.findByChildAndDate(HOUSEHOLD_ID, CHILD_ID, '2026-05-17');

    expect(result).toBeNull();
  });

  it('returns the most recently updated note when multiple share the same created_at date', async () => {
    const older = makeRow({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      content: noopCiphertext('older'),
      created_at: '2026-05-17T08:00:00.000Z',
      updated_at: '2026-05-17T08:00:00.000Z',
    });
    const newer = makeRow({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      content: noopCiphertext('newer'),
      created_at: '2026-05-17T10:00:00.000Z',
      updated_at: '2026-05-17T14:00:00.000Z',
    });
    const mock = buildMockClient({ rows: [older, newer] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.findByChildAndDate(HOUSEHOLD_ID, CHILD_ID, '2026-05-17');

    expect(result?.id).toBe(newer.id);
    expect(result?.content).toBe('newer');
  });

  it('round-trips empty-string content', async () => {
    const row = makeRow({
      content: noopCiphertext(''),
      created_at: '2026-05-17T12:00:00.000Z',
    });
    const mock = buildMockClient({ rows: [row] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.findByChildAndDate(HOUSEHOLD_ID, CHILD_ID, '2026-05-17');

    expect(result?.content).toBe('');
  });
});

describe('HeartNoteRepository.findForDelivery (NOOP mode — kek = null)', () => {
  it('decrypts NOOP-prefixed content, returns plaintext', async () => {
    const row = makeRow({
      content: noopCiphertext('delivery payload'),
      scheduled_for: '2026-05-17',
    });
    const mock = buildMockClient({ rows: [row] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.findForDelivery(HOUSEHOLD_ID, CHILD_ID, '2026-05-17');

    expect(result?.content).toBe('delivery payload');
  });

  it('returns null when no row matches', async () => {
    const mock = buildMockClient({ rows: [] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.findForDelivery(HOUSEHOLD_ID, CHILD_ID, '2026-05-17');

    expect(result).toBeNull();
  });
});

describe('HeartNoteRepository.findById (NOOP mode — kek = null)', () => {
  it('returns null when note not found', async () => {
    const mock = buildMockClient({ rows: [] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.findById(
      '00000000-0000-4000-8000-000000000000',
      HOUSEHOLD_ID,
    );

    expect(result).toBeNull();
  });

  it('returns decrypted note row when found', async () => {
    const row = makeRow({ content: noopCiphertext('the saved text') });
    const mock = buildMockClient({ rows: [row] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.findById(row.id, HOUSEHOLD_ID);

    expect(result?.id).toBe(row.id);
    expect(result?.content).toBe('the saved text');
  });

  it('does not return rows belonging to a different household', async () => {
    const row = makeRow({ household_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const mock = buildMockClient({ rows: [row] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.findById(row.id, HOUSEHOLD_ID);

    expect(result).toBeNull();
  });
});

describe('HeartNoteRepository.listByHousehold (NOOP mode — kek = null)', () => {
  it('returns empty array when no notes', async () => {
    const mock = buildMockClient({ rows: [] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.listByHousehold(HOUSEHOLD_ID);

    expect(result).toEqual([]);
  });

  it('decrypts content for all rows', async () => {
    const r1 = makeRow({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      content: noopCiphertext('one'),
      scheduled_for: '2026-05-30',
      status: 'scheduled',
    });
    const r2 = makeRow({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      content: noopCiphertext('two'),
      scheduled_for: '2026-06-01',
      status: 'scheduled',
    });
    const mock = buildMockClient({ rows: [r1, r2] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.listByHousehold(HOUSEHOLD_ID);

    expect(result.map((r) => r.content).sort()).toEqual(['one', 'two']);
  });

  it('filters by status when provided', async () => {
    const r1 = makeRow({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'draft',
    });
    const r2 = makeRow({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      status: 'scheduled',
      scheduled_for: '2026-05-30',
    });
    const mock = buildMockClient({ rows: [r1, r2] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.listByHousehold(HOUSEHOLD_ID, { status: ['scheduled'] });

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('scheduled');
  });

  it('excludes rows from other households', async () => {
    const mine = makeRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const theirs = makeRow({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      household_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    const mock = buildMockClient({ rows: [mine, theirs] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.listByHousehold(HOUSEHOLD_ID);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(mine.id);
  });
});

describe('HeartNoteRepository.deliverScheduled (no content read)', () => {
  it('returns 0 when no matching rows', async () => {
    const mock = buildMockClient({ rows: [] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const count = await repo.deliverScheduled('2026-05-30');

    expect(count).toBe(0);
  });

  it('returns count of updated rows for matching status+date', async () => {
    const a = makeRow({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'scheduled',
      scheduled_for: '2026-05-30',
    });
    const b = makeRow({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      status: 'scheduled',
      scheduled_for: '2026-05-30',
    });
    // not a match — different date
    const c = makeRow({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      status: 'scheduled',
      scheduled_for: '2026-06-01',
    });
    const mock = buildMockClient({ rows: [a, b, c] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const count = await repo.deliverScheduled('2026-05-30');

    expect(count).toBe(2);
  });

  it('writes status=delivered and a delivered_at timestamp; does not touch content', async () => {
    const a = makeRow({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      status: 'scheduled',
      scheduled_for: '2026-05-30',
    });
    const mock = buildMockClient({ rows: [a] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    await repo.deliverScheduled('2026-05-30');

    const payload = mock.state.updates[0];
    expect(payload?.status).toBe('delivered');
    expect(typeof payload?.delivered_at).toBe('string');
    expect(payload?.content).toBeUndefined();
  });
});

describe('HeartNoteRepository.patch (NOOP mode — kek = null)', () => {
  it('encrypts updated content, returns plaintext', async () => {
    const existing = makeRow({ content: noopCiphertext('old') });
    const mock = buildMockClient({
      rows: [existing],
      patchResult: makeRow({ content: noopCiphertext('new copy') }),
    });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.patch(existing.id, HOUSEHOLD_ID, { content: 'new copy' });

    const updatePayload = mock.state.updates[0];
    expect((updatePayload?.content as string).startsWith('NOOP:')).toBe(true);
    expect(result?.content).toBe('new copy');
  });

  it('does not touch content when only scheduledFor is patched', async () => {
    const existing = makeRow({ content: noopCiphertext('keep me') });
    const mock = buildMockClient({
      rows: [existing],
      patchResult: { ...existing, scheduled_for: '2026-05-20' },
    });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.patch(existing.id, HOUSEHOLD_ID, { scheduledFor: '2026-05-20' });

    const updatePayload = mock.state.updates[0];
    expect(updatePayload?.content).toBeUndefined();
    expect(result?.content).toBe('keep me');
    expect(result?.scheduled_for).toBe('2026-05-20');
  });

  it('writes status and cancelled_at when params include them', async () => {
    const existing = makeRow({
      content: noopCiphertext('soon to cancel'),
      status: 'scheduled',
      scheduled_for: '2026-05-30',
    });
    const mock = buildMockClient({
      rows: [existing],
      patchResult: {
        ...existing,
        status: 'cancelled',
        cancelled_at: '2026-05-28T12:00:00.000Z',
      },
    });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.patch(existing.id, HOUSEHOLD_ID, {
      status: 'cancelled',
      cancelledAt: '2026-05-28T12:00:00.000Z',
    });

    const updatePayload = mock.state.updates[0];
    expect(updatePayload?.status).toBe('cancelled');
    expect(updatePayload?.cancelled_at).toBe('2026-05-28T12:00:00.000Z');
    expect(result?.status).toBe('cancelled');
  });

  it('returns null when no row matches the id+household_id', async () => {
    const mock = buildMockClient({ patchResult: null });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const result = await repo.patch('00000000-0000-4000-8000-000000000000', HOUSEHOLD_ID, {
      content: 'whatever',
    });

    expect(result).toBeNull();
  });
});

describe('HeartNoteRepository.countAuthoredThisMonth (Slice 4-S13)', () => {
  const now = new Date();
  // Day 1 at noon is always inside the current calendar month and >= monthStart.
  const thisMonth = (day: number): string =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 12, 0, 0)).toISOString();
  const lastMonth = (): string =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12, 0, 0)).toISOString();

  it('returns 0 when the author has no notes', async () => {
    const mock = buildMockClient({ rows: [] });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const count = await repo.countAuthoredThisMonth(USER_ID, HOUSEHOLD_ID);

    expect(count).toBe(0);
  });

  it('counts 2 active notes created this month', async () => {
    const rows = [
      makeRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', created_at: thisMonth(1) }),
      makeRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', created_at: thisMonth(2) }),
    ];
    const mock = buildMockClient({ rows });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const count = await repo.countAuthoredThisMonth(USER_ID, HOUSEHOLD_ID);

    expect(count).toBe(2);
  });

  it('excludes cancelled notes (a cancelled slot is free again)', async () => {
    const rows = [
      makeRow({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'cancelled',
        created_at: thisMonth(1),
      }),
    ];
    const mock = buildMockClient({ rows });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const count = await repo.countAuthoredThisMonth(USER_ID, HOUSEHOLD_ID);

    expect(count).toBe(0);
  });

  it('excludes notes created in a previous month', async () => {
    const rows = [
      makeRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', created_at: lastMonth() }),
    ];
    const mock = buildMockClient({ rows });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const count = await repo.countAuthoredThisMonth(USER_ID, HOUSEHOLD_ID);

    expect(count).toBe(0);
  });

  it('counts a single note created this month', async () => {
    const rows = [
      makeRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', created_at: thisMonth(1) }),
    ];
    const mock = buildMockClient({ rows });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const count = await repo.countAuthoredThisMonth(USER_ID, HOUSEHOLD_ID);

    expect(count).toBe(1);
  });

  it('counts by author_user_id, not household — another author does not consume this cap', async () => {
    const rows = [
      makeRow({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        author_user_id: '99999999-9999-4999-8999-999999999999',
        created_at: thisMonth(1),
      }),
    ];
    const mock = buildMockClient({ rows });
    const repo = new HeartNoteRepository(mock as unknown as SupabaseClient, null);

    const count = await repo.countAuthoredThisMonth(USER_ID, HOUSEHOLD_ID);

    expect(count).toBe(0);
  });
});

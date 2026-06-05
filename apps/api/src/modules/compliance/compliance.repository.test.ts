import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ComplianceRepository, type VpcConsentRow } from './compliance.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function makeRow(overrides: Partial<VpcConsentRow> = {}): VpcConsentRow {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    household_id: HOUSEHOLD_ID,
    mechanism: 'signed_declaration',
    signed_at: '2026-06-01T00:00:00.000Z',
    signed_by_user_id: USER_ID,
    document_version: 'v1',
    created_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

interface RecentQueryCapture {
  table: string;
  eq: Array<{ col: string; val: unknown }>;
  order: { col: string; ascending: boolean } | null;
  limit: number | null;
}

// Story 7-S8 — models the PostgREST chain used by
// findRecentConsentsByHousehold: .select().eq().order().limit() — the terminal
// .limit() is awaited and resolves with the seeded rows after applying filters.
function buildRecentMockClient(seed: VpcConsentRow[]): {
  client: SupabaseClient;
  capture: RecentQueryCapture;
} {
  const capture: RecentQueryCapture = { table: '', eq: [], order: null, limit: null };

  const resolve = (): Promise<{ data: VpcConsentRow[]; error: null }> => {
    let rows = seed.filter((r) => {
      for (const f of capture.eq) {
        if ((r as unknown as Record<string, unknown>)[f.col] !== f.val) return false;
      }
      return true;
    });
    if (capture.order?.col === 'signed_at') {
      const asc = capture.order.ascending;
      rows = [...rows].sort((a, b) =>
        asc ? a.signed_at.localeCompare(b.signed_at) : b.signed_at.localeCompare(a.signed_at),
      );
    }
    if (capture.limit !== null) rows = rows.slice(0, capture.limit);
    return Promise.resolve({ data: rows, error: null });
  };

  const chain = {
    eq(col: string, val: unknown) {
      capture.eq.push({ col, val });
      return chain;
    },
    order(col: string, opts: { ascending: boolean }) {
      capture.order = { col, ascending: opts.ascending };
      return chain;
    },
    limit(n: number) {
      capture.limit = n;
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

describe('ComplianceRepository.findRecentConsentsByHousehold', () => {
  it('orders by signed_at descending and applies the limit', async () => {
    const older = makeRow({ id: '00000000-0000-4000-8000-00000000000a', signed_at: '2026-01-01T00:00:00.000Z' });
    const newest = makeRow({ id: '00000000-0000-4000-8000-00000000000b', signed_at: '2026-06-01T00:00:00.000Z' });
    const middle = makeRow({ id: '00000000-0000-4000-8000-00000000000c', signed_at: '2026-03-01T00:00:00.000Z' });
    const { client, capture } = buildRecentMockClient([older, newest, middle]);
    const repo = new ComplianceRepository(client);

    const out = await repo.findRecentConsentsByHousehold(HOUSEHOLD_ID, 2);

    expect(capture.table).toBe('vpc_consents');
    expect(capture.order).toEqual({ col: 'signed_at', ascending: false });
    expect(capture.limit).toBe(2);
    expect(out.map((r) => r.id)).toEqual([newest.id, middle.id]);
  });

  it('scopes to household_id', async () => {
    const mine = makeRow({ id: '00000000-0000-4000-8000-00000000000d' });
    const other = makeRow({
      id: '00000000-0000-4000-8000-00000000000e',
      household_id: '99999999-9999-4999-8999-999999999999',
    });
    const { client, capture } = buildRecentMockClient([mine, other]);
    const repo = new ComplianceRepository(client);

    const out = await repo.findRecentConsentsByHousehold(HOUSEHOLD_ID, 5);

    expect(capture.eq).toContainEqual({ col: 'household_id', val: HOUSEHOLD_ID });
    expect(out.map((r) => r.id)).toEqual([mine.id]);
  });

  it('returns [] when none', async () => {
    const { client } = buildRecentMockClient([]);
    const repo = new ComplianceRepository(client);

    const out = await repo.findRecentConsentsByHousehold(HOUSEHOLD_ID, 5);

    expect(out).toEqual([]);
  });

  it('throws when supabase returns an error', async () => {
    const errClient = {
      from: () => ({
        select: () => ({
          eq() {
            return this;
          },
          order() {
            return this;
          },
          limit: () => Promise.resolve({ data: null, error: { message: 'boom', code: 'XX000' } }),
        }),
      }),
    } as unknown as SupabaseClient;
    const repo = new ComplianceRepository(errClient);

    await expect(repo.findRecentConsentsByHousehold(HOUSEHOLD_ID, 5)).rejects.toMatchObject({
      code: 'XX000',
    });
  });
});

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LunchLinkSessionRepository } from './lunch-link-session.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const DATE = '2026-06-09';

// ─── In-memory lunch_link_sessions store ─────────────────────────────────────

interface SessionRow {
  household_id: string;
  child_id: string;
  date: string;
  suppressed_at: string | null;
  suppressed_by_user_id: string | null;
}

function buildMockClient(rows: SessionRow[] = []) {
  const store = [...rows];

  const table = {
    upsert(row: SessionRow & { suppressed_at: string; suppressed_by_user_id: string }) {
      const idx = store.findIndex(
        (r) => r.child_id === row.child_id && r.date === row.date,
      );
      if (idx === -1) {
        store.push({ ...row });
      } else {
        store[idx] = { ...store[idx]!, ...row };
      }
      return Promise.resolve({ error: null });
    },
    update(patch: Partial<SessionRow>) {
      const filters: Record<string, unknown> = {};
      const chain = {
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        then: vi.fn().mockImplementation((resolve: (v: { error: null }) => void) => {
          const idx = store.findIndex(
            (r) =>
              r.household_id === filters.household_id &&
              r.child_id === filters.child_id &&
              r.date === filters.date,
          );
          if (idx !== -1) store[idx] = { ...store[idx]!, ...patch };
          resolve({ error: null });
        }),
      };
      return chain;
    },
    select(_cols: string) {
      const filters: Record<string, string | null> = {};
      let gteCond: { col: string; val: string } | undefined;
      let lteCond: { col: string; val: string } | undefined;
      let notNullCol: string | undefined;

      const chain = {
        eq(col: string, val: string) {
          filters[col] = val;
          return chain;
        },
        gte(col: string, val: string) {
          gteCond = { col, val };
          return chain;
        },
        lte(col: string, val: string) {
          lteCond = { col, val };
          return chain;
        },
        not(col: string, _op: string, _val: null) {
          notNullCol = col;
          return chain;
        },
        maybeSingle: vi.fn().mockImplementation(async () => {
          const row = store.find(
            (r) => r.child_id === filters.child_id && r.date === filters.date,
          );
          return { data: row ? { suppressed_at: row.suppressed_at } : null, error: null };
        }),
        then: vi.fn().mockImplementation((resolve: (v: { data: SessionRow[]; error: null }) => void) => {
          let result = store.filter((r) => {
            for (const [col, val] of Object.entries(filters)) {
              if ((r as unknown as Record<string, unknown>)[col] !== val) return false;
            }
            return true;
          });
          if (gteCond) {
            const { col, val } = gteCond;
            result = result.filter((r) => ((r as unknown as Record<string, unknown>)[col] as string) >= val);
          }
          if (lteCond) {
            const { col, val } = lteCond;
            result = result.filter((r) => ((r as unknown as Record<string, unknown>)[col] as string) <= val);
          }
          if (notNullCol) {
            result = result.filter((r) => (r as unknown as Record<string, unknown>)[notNullCol!] !== null);
          }
          resolve({ data: result, error: null });
        }),
      };
      return chain;
    },
  };

  return {
    from: vi.fn().mockReturnValue(table),
    store,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LunchLinkSessionRepository.suppress()', () => {
  it('creates a new suppressed row when none exists', async () => {
    const mock = buildMockClient();
    const repo = new LunchLinkSessionRepository(mock as unknown as SupabaseClient);

    await repo.suppress({ householdId: HOUSEHOLD_ID, childId: CHILD_ID, date: DATE, userId: USER_ID });

    expect(mock.store[0]).toMatchObject({
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_ID,
      date: DATE,
      suppressed_by_user_id: USER_ID,
    });
    expect(mock.store[0]?.suppressed_at).toBeTruthy();
  });

  it('upserts without error when called twice for the same (child, date)', async () => {
    const mock = buildMockClient();
    const repo = new LunchLinkSessionRepository(mock as unknown as SupabaseClient);

    await repo.suppress({ householdId: HOUSEHOLD_ID, childId: CHILD_ID, date: DATE, userId: USER_ID });
    await expect(
      repo.suppress({ householdId: HOUSEHOLD_ID, childId: CHILD_ID, date: DATE, userId: USER_ID }),
    ).resolves.not.toThrow();
  });
});

describe('LunchLinkSessionRepository.findByChildAndDate()', () => {
  it('returns suppressed_at when session is suppressed', async () => {
    const now = new Date().toISOString();
    const mock = buildMockClient([
      { household_id: HOUSEHOLD_ID, child_id: CHILD_ID, date: DATE, suppressed_at: now, suppressed_by_user_id: USER_ID },
    ]);
    const repo = new LunchLinkSessionRepository(mock as unknown as SupabaseClient);

    const result = await repo.findByChildAndDate(HOUSEHOLD_ID, CHILD_ID, DATE);
    expect(result?.suppressed_at).toBe(now);
  });

  it('returns null when no session exists', async () => {
    const mock = buildMockClient();
    const repo = new LunchLinkSessionRepository(mock as unknown as SupabaseClient);

    const result = await repo.findByChildAndDate(HOUSEHOLD_ID, CHILD_ID, DATE);
    expect(result).toBeNull();
  });
});

describe('LunchLinkSessionRepository.unsuppress()', () => {
  it('clears suppressed_at so findByChildAndDate shows null', async () => {
    const now = new Date().toISOString();
    const mock = buildMockClient([
      { household_id: HOUSEHOLD_ID, child_id: CHILD_ID, date: DATE, suppressed_at: now, suppressed_by_user_id: USER_ID },
    ]);
    const repo = new LunchLinkSessionRepository(mock as unknown as SupabaseClient);

    await repo.unsuppress({ householdId: HOUSEHOLD_ID, childId: CHILD_ID, date: DATE });

    expect(mock.store[0]?.suppressed_at).toBeNull();
  });
});

describe('LunchLinkSessionRepository.findSuppressedForDate()', () => {
  it('returns only suppressed sessions for the given date', async () => {
    const now = new Date().toISOString();
    const CHILD_B = '44444444-4444-4444-8444-444444444444';
    const mock = buildMockClient([
      { household_id: HOUSEHOLD_ID, child_id: CHILD_ID, date: DATE, suppressed_at: now, suppressed_by_user_id: USER_ID },
      { household_id: HOUSEHOLD_ID, child_id: CHILD_B, date: DATE, suppressed_at: null, suppressed_by_user_id: null },
      { household_id: HOUSEHOLD_ID, child_id: CHILD_ID, date: '2026-06-10', suppressed_at: now, suppressed_by_user_id: USER_ID },
    ]);
    const repo = new LunchLinkSessionRepository(mock as unknown as SupabaseClient);

    const result = await repo.findSuppressedForDate(DATE);
    expect(result).toHaveLength(1);
    expect(result[0]?.child_id).toBe(CHILD_ID);
  });
});

describe('LunchLinkSessionRepository.findSuppressedDatesInRange()', () => {
  it('returns a set of dates with at least one suppressed session in range', async () => {
    const now = new Date().toISOString();
    const CHILD_B = '44444444-4444-4444-8444-444444444444';
    const mock = buildMockClient([
      { household_id: HOUSEHOLD_ID, child_id: CHILD_ID, date: '2026-06-09', suppressed_at: now, suppressed_by_user_id: USER_ID },
      { household_id: HOUSEHOLD_ID, child_id: CHILD_B, date: '2026-06-10', suppressed_at: null, suppressed_by_user_id: null },
      { household_id: HOUSEHOLD_ID, child_id: CHILD_ID, date: '2026-06-11', suppressed_at: now, suppressed_by_user_id: USER_ID },
      { household_id: HOUSEHOLD_ID, child_id: CHILD_ID, date: '2026-06-15', suppressed_at: now, suppressed_by_user_id: USER_ID },
    ]);
    const repo = new LunchLinkSessionRepository(mock as unknown as SupabaseClient);

    const result = await repo.findSuppressedDatesInRange(HOUSEHOLD_ID, '2026-06-09', '2026-06-14');
    expect(result).toBeInstanceOf(Set);
    expect(result.has('2026-06-09')).toBe(true);
    expect(result.has('2026-06-10')).toBe(false); // not suppressed
    expect(result.has('2026-06-11')).toBe(true);
    expect(result.has('2026-06-15')).toBe(false); // outside range
  });

  it('returns an empty set when no sessions are suppressed', async () => {
    const mock = buildMockClient();
    const repo = new LunchLinkSessionRepository(mock as unknown as SupabaseClient);

    const result = await repo.findSuppressedDatesInRange(HOUSEHOLD_ID, '2026-06-09', '2026-06-14');
    expect(result.size).toBe(0);
  });
});

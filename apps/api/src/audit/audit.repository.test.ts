import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuditRepository } from './audit.repository.js';

const HOUSEHOLD_A = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_B = '22222222-2222-4222-8222-222222222222';

type Row = {
  id: string;
  household_id: string;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

// Mock that actually applies the .eq()/.in()/.order() filters so the test
// exercises the query shape, not just a canned return value. The chain
// terminates on .order(), which the repository awaits.
function buildMockClient(rows: Row[], error: unknown = null) {
  const eqs: Record<string, unknown> = {};
  const ins: Record<string, unknown[]> = {};
  let orderCol = 'created_at';
  let ascending = true;

  const builder = {
    select() {
      return builder;
    },
    eq(col: string, val: unknown) {
      eqs[col] = val;
      return builder;
    },
    in(col: string, vals: readonly unknown[]) {
      ins[col] = [...vals];
      return builder;
    },
    order(col: string, opts: { ascending: boolean }) {
      orderCol = col;
      ascending = opts.ascending;
      if (error !== null) return Promise.resolve({ data: null, error });
      const filtered = rows.filter((r) => {
        for (const [c, v] of Object.entries(eqs)) {
          if ((r as unknown as Record<string, unknown>)[c] !== v) return false;
        }
        for (const [c, vals] of Object.entries(ins)) {
          if (!vals.includes((r as unknown as Record<string, unknown>)[c])) return false;
        }
        return true;
      });
      const sorted = [...filtered].sort((a, b) => {
        const av = String((a as unknown as Record<string, unknown>)[orderCol] ?? '');
        const bv = String((b as unknown as Record<string, unknown>)[orderCol] ?? '');
        if (av === bv) return 0;
        return ascending ? (av < bv ? -1 : 1) : av < bv ? 1 : -1;
      });
      return Promise.resolve({ data: sorted, error: null });
    },
  };

  return {
    from(table: string) {
      if (table === 'audit_log') return builder;
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function row(overrides: Partial<Row>): Row {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    household_id: HOUSEHOLD_A,
    event_type: 'allergy.guardrail_rejection',
    metadata: {},
    created_at: '2026-06-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('AuditRepository.findAllergyEventsByHousehold', () => {
  it('returns only allergy.* rows for the household, ordered ascending by created_at', async () => {
    const rows = [
      row({ id: 'a2', event_type: 'allergy.uncertainty', created_at: '2026-06-02T00:00:00.000Z' }),
      row({ id: 'a1', event_type: 'allergy.guardrail_rejection', created_at: '2026-06-01T00:00:00.000Z' }),
      row({ id: 'a3', event_type: 'allergy.check_overridden', created_at: '2026-06-03T00:00:00.000Z' }),
    ];
    const repo = new AuditRepository(buildMockClient(rows) as unknown as SupabaseClient);

    const result = await repo.findAllergyEventsByHousehold(HOUSEHOLD_A);

    expect(result.map((r) => r.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('excludes non-allergy events from the same household', async () => {
    const rows = [
      row({ id: 'allergy', event_type: 'allergy.guardrail_rejection' }),
      row({ id: 'plan', event_type: 'plan.generated' }),
      row({ id: 'heart', event_type: 'heart_note.created' }),
    ];
    const repo = new AuditRepository(buildMockClient(rows) as unknown as SupabaseClient);

    const result = await repo.findAllergyEventsByHousehold(HOUSEHOLD_A);

    expect(result.map((r) => r.id)).toEqual(['allergy']);
  });

  it('excludes allergy events belonging to a different household', async () => {
    const rows = [
      row({ id: 'mine', household_id: HOUSEHOLD_A }),
      row({ id: 'theirs', household_id: HOUSEHOLD_B }),
    ];
    const repo = new AuditRepository(buildMockClient(rows) as unknown as SupabaseClient);

    const result = await repo.findAllergyEventsByHousehold(HOUSEHOLD_A);

    expect(result.map((r) => r.id)).toEqual(['mine']);
  });

  it('returns [] for a household with no allergy events', async () => {
    const repo = new AuditRepository(buildMockClient([]) as unknown as SupabaseClient);

    const result = await repo.findAllergyEventsByHousehold(HOUSEHOLD_A);

    expect(result).toEqual([]);
  });

  it('throws when the query returns an error', async () => {
    const repo = new AuditRepository(
      buildMockClient([], new Error('db down')) as unknown as SupabaseClient,
    );

    await expect(repo.findAllergyEventsByHousehold(HOUSEHOLD_A)).rejects.toThrow('db down');
  });
});

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ComplianceRepository, type StateComplianceOverrideRow } from './compliance.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

function makeOverrideRow(overrides: Partial<StateComplianceOverrideRow> = {}): StateComplianceOverrideRow {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    state: 'CT',
    override_type: 'disclosure',
    value: { text: 'CT disclosure' },
    effective_from: '2026-01-01',
    created_at: '2026-06-13T00:00:00.000Z',
    ...overrides,
  };
}

// Builds a two-step mock Supabase client for getOverridesForHousehold.
// Step 1: .from('households').select().eq().maybeSingle() → resolves with householdRow.
// Step 2 (only if step 1 returns non-null state): .from('state_compliance_overrides').select().eq().lte() → resolves with overrideRows.
function buildTwoStepMockClient(
  householdRow: { state_residency: string | null } | null,
  overrideRows: StateComplianceOverrideRow[],
): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'households') {
        return {
          select: () => ({
            eq: (_col: string, _val: unknown) => ({
              maybeSingle: () => Promise.resolve({ data: householdRow, error: null }),
            }),
          }),
        };
      }
      // state_compliance_overrides
      return {
        select: () => ({
          eq: (_col: string, _val: unknown) => ({
            lte: (_col2: string, _val2: unknown) =>
              Promise.resolve({ data: overrideRows, error: null }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

describe('ComplianceRepository.getOverridesForHousehold', () => {
  it('returns [] when state_residency is null (COPPA baseline)', async () => {
    const client = buildTwoStepMockClient({ state_residency: null }, []);
    const repo = new ComplianceRepository(client);

    const result = await repo.getOverridesForHousehold(HOUSEHOLD_ID);

    expect(result).toEqual([]);
  });

  it('returns [] when state is set but no override rows exist', async () => {
    const client = buildTwoStepMockClient({ state_residency: 'CT' }, []);
    const repo = new ComplianceRepository(client);

    const result = await repo.getOverridesForHousehold(HOUSEHOLD_ID);

    expect(result).toEqual([]);
  });

  it('returns the override row when state matches', async () => {
    const row = makeOverrideRow();
    const client = buildTwoStepMockClient({ state_residency: 'CT' }, [row]);
    const repo = new ComplianceRepository(client);

    const result = await repo.getOverridesForHousehold(HOUSEHOLD_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(row);
  });
});

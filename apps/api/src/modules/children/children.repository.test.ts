import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ChildrenRepository } from './children.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';

interface Step {
  op: string;
  args: unknown[];
}

// Self-returning chainable that mirrors the
// `client.from('children').update(...).eq(...).eq(...).select(...).maybeSingle()`
// shape used by ChildrenRepository.updateProfile. Records every call so the
// test can assert on the update payload and the ownership-guard filters.
function buildChainClient(terminalResult: unknown): {
  client: SupabaseClient;
  steps: Step[];
} {
  const steps: Step[] = [];
  const builder: Record<string, unknown> = {};
  const passthrough = (op: string) => (...args: unknown[]) => {
    steps.push({ op, args });
    return builder;
  };
  for (const op of ['select', 'update', 'eq', 'is', 'order']) {
    builder[op] = passthrough(op);
  }
  builder.maybeSingle = vi.fn().mockResolvedValue(terminalResult);
  builder.single = vi.fn().mockResolvedValue(terminalResult);
  const fromMock = vi.fn().mockImplementation((table: string) => {
    steps.push({ op: 'from', args: [table] });
    return builder;
  });
  return { client: { from: fromMock } as unknown as SupabaseClient, steps };
}

function rowFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CHILD_ID,
    household_id: HOUSEHOLD_ID,
    name: 'Layla',
    age_band: 'child',
    school_policy_notes: null,
    declared_allergens: 'NOOP:W10=', // NOOP-prefixed base64('[]')
    cultural_identifiers: 'NOOP:W10=',
    dietary_preferences: 'NOOP:W10=',
    allergen_rule_version: '1',
    bag_composition: { main: true, snack: true, extra: true },
    created_at: '2026-05-21T00:00:00.000Z',
    ...overrides,
  };
}

const silentLogger = { error: vi.fn() };

// Slice 2.5-s8 — Repository must write `bag_composition_pattern` to the
// `children.bag_composition_pattern` column on the UPDATE statement when the
// caller supplies a value, and must omit the column entirely when undefined
// is passed so existing values are preserved.

describe('ChildrenRepository.updateProfile — bag_composition_pattern (Slice 2.5-s8)', () => {
  it('includes bag_composition_pattern in the UPDATE payload when supplied', async () => {
    const { client, steps } = buildChainClient({
      data: rowFixture({ bag_composition_pattern: 'main_plus_snack' }),
      error: null,
    });
    const repo = new ChildrenRepository(client, null, silentLogger);

    await repo.updateProfile({
      id: CHILD_ID,
      household_id: HOUSEHOLD_ID,
      name: 'Layla',
      age_band: 'child',
      school_policy_notes: null,
      declared_allergens: [],
      cultural_identifiers: [],
      dietary_preferences: [],
      bag_composition_pattern: 'main_plus_snack',
    });

    const updateCall = steps.find((s) => s.op === 'update');
    expect(updateCall).toBeDefined();
    expect(updateCall?.args[0]).toMatchObject({ bag_composition_pattern: 'main_plus_snack' });

    // Cross-household safety guard: both id AND household_id are applied as
    // WHERE filters on the UPDATE.
    const eqCalls = steps.filter((s) => s.op === 'eq');
    expect(eqCalls.some((s) => s.args[0] === 'id' && s.args[1] === CHILD_ID)).toBe(true);
    expect(
      eqCalls.some((s) => s.args[0] === 'household_id' && s.args[1] === HOUSEHOLD_ID),
    ).toBe(true);
  });

  it('omits bag_composition_pattern from the UPDATE payload when undefined (PATCH preserves existing)', async () => {
    const { client, steps } = buildChainClient({
      data: rowFixture(),
      error: null,
    });
    const repo = new ChildrenRepository(client, null, silentLogger);

    await repo.updateProfile({
      id: CHILD_ID,
      household_id: HOUSEHOLD_ID,
      name: 'Layla',
      age_band: 'child',
      school_policy_notes: null,
      declared_allergens: [],
      cultural_identifiers: [],
      dietary_preferences: [],
      // bag_composition_pattern intentionally omitted
    });

    const updateCall = steps.find((s) => s.op === 'update');
    expect(updateCall).toBeDefined();
    expect(updateCall?.args[0]).not.toHaveProperty('bag_composition_pattern');
  });
});

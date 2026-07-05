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
  for (const op of ['select', 'update', 'eq', 'is', 'order', 'delete', 'upsert']) {
    builder[op] = passthrough(op);
  }
  builder.maybeSingle = vi.fn().mockResolvedValue(terminalResult);
  builder.single = vi.fn().mockResolvedValue(terminalResult);
  // Story 3-DM-B2 — writeHouseholdScopedTags / readHouseholdScopedTags await
  // chains directly (delete().eq(), upsert(...), select().eq().is()), so the
  // builder must be thenable. Resolve with empty data so household-scoped tag
  // reads map over an array.
  builder.then = (
    onFulfilled: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
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
    appetite_level: 'normal',
    texture_needs: 'normal',
    spice_tolerance: 'mild',
    bag_composition_pattern: 'main_plus_snack_plus_extra',
    created_at: '2026-05-21T00:00:00.000Z',
    ...overrides,
  };
}

// Slice 2.6-s8 — ChildrenRepository depends on ChildAllergensRepository.
// These tests target updateProfile's column-write behaviour only; the
// allergen write paths are exercised by children.routes.test and the
// dedicated child-allergens.repository.test.
function stubChildAllergensRepo() {
  return {
    declare: vi.fn().mockResolvedValue({ child_allergen_id: 'stub', was_existing: false }),
    declareIfNew: vi.fn().mockResolvedValue({ inserted: true }),
    deleteByChild: vi.fn().mockResolvedValue(undefined),
    findByHousehold: vi.fn().mockResolvedValue([]),
  } as unknown as ConstructorParameters<typeof ChildrenRepository>[2];
}

// Slice 2.6-s8 — updateProfile must wipe then re-declare allergens (replace
// semantics). Removing 'peanut' from the parent's list must actually remove it.
describe('ChildrenRepository.updateProfile — allergen replacement (Slice 2.6-s8)', () => {
  it('calls deleteByChild before declareIfNew, passing source=parent_edited', async () => {
    const { client } = buildChainClient({ data: rowFixture(), error: null });
    const stub = stubChildAllergensRepo();
    const repo = new ChildrenRepository(client, null, stub);

    await repo.updateProfile({
      id: CHILD_ID,
      household_id: HOUSEHOLD_ID,
      name: 'Layla',
      age_band: 'child',
      school_policy_notes: null,
      declared_allergens: ['peanut', 'tree_nut'],
      cultural_identifiers: [],
      dietary_preferences: [],
    });

    expect(stub.deleteByChild).toHaveBeenCalledOnce();
    expect(stub.deleteByChild).toHaveBeenCalledWith(HOUSEHOLD_ID, CHILD_ID);

    expect(stub.declareIfNew).toHaveBeenCalledTimes(2);
    expect(stub.declareIfNew).toHaveBeenCalledWith(HOUSEHOLD_ID, CHILD_ID, 'peanut', 'parent_edited');
    expect(stub.declareIfNew).toHaveBeenCalledWith(HOUSEHOLD_ID, CHILD_ID, 'tree_nut', 'parent_edited');
  });
});

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
    const repo = new ChildrenRepository(client, null, stubChildAllergensRepo());

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
    const repo = new ChildrenRepository(client, null, stubChildAllergensRepo());

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

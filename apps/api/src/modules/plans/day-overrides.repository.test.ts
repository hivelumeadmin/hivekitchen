import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DayOverridesRepository } from './day-overrides.repository.js';
import type { DayOverride } from '@hivekitchen/types';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ITEM_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const OVERRIDE_ID = '44444444-4444-4444-8444-444444444444';

interface Step {
  op: string;
  args: unknown[];
}

const SAMPLE_OVERRIDE: DayOverride = {
  id: OVERRIDE_ID,
  plan_item_id: PLAN_ITEM_ID,
  child_id: CHILD_ID,
  household_id: HOUSEHOLD_ID,
  override_date: '2026-05-06',
  override_type: 'sport_practice',
  is_lumi_proposed: false,
  confirmed_at: '2026-05-06T08:00:00.000Z',
  reverted_at: null,
  created_at: '2026-05-06T08:00:00.000Z',
  updated_at: '2026-05-06T08:00:00.000Z',
};

// A self-returning chainable that records every call. Methods that the repo
// awaits (single, maybeSingle) terminate the chain with the given result.
function buildChainClient(
  terminalResult: unknown,
  terminator: 'single' | 'maybeSingle' | 'select' = 'single',
): { client: SupabaseClient; steps: Step[] } {
  const steps: Step[] = [];
  const builder: Record<string, unknown> = {};
  const passthrough = (op: string) => (...args: unknown[]) => {
    steps.push({ op, args });
    return builder;
  };
  const ops = ['upsert', 'update', 'select', 'eq', 'is', 'gte', 'lt'];
  for (const op of ops) {
    builder[op] = passthrough(op);
  }
  builder.single = vi.fn().mockResolvedValue(terminalResult);
  builder.maybeSingle = vi.fn().mockResolvedValue(terminalResult);
  // Chained .select() in some calls is the awaited terminator (e.g. revertExpired).
  if (terminator === 'select') {
    builder.select = vi.fn().mockImplementation((...args: unknown[]) => {
      steps.push({ op: 'select', args });
      return Promise.resolve(terminalResult);
    });
  }
  const fromMock = vi.fn().mockImplementation((table: string) => {
    steps.push({ op: 'from', args: [table] });
    return builder;
  });
  return {
    client: { from: fromMock } as unknown as SupabaseClient,
    steps,
  };
}

describe('DayOverridesRepository.upsert', () => {
  it('returns the upserted row and confirms parent-initiated overrides immediately', async () => {
    const { client, steps } = buildChainClient({ data: SAMPLE_OVERRIDE, error: null });
    const repo = new DayOverridesRepository(client);

    const result = await repo.upsert({
      planItemId: PLAN_ITEM_ID,
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      overrideDate: '2026-05-06',
      overrideType: 'sport_practice',
      isLumiProposed: false,
    });

    expect(result).toEqual(SAMPLE_OVERRIDE);
    const upsertStep = steps.find((s) => s.op === 'upsert');
    expect(upsertStep).toBeDefined();
    const payload = upsertStep!.args[0] as { confirmed_at: string | null; is_lumi_proposed: boolean };
    expect(payload.is_lumi_proposed).toBe(false);
    expect(payload.confirmed_at).not.toBeNull();
  });

  it('leaves confirmed_at null when the override is Lumi-proposed', async () => {
    const { client, steps } = buildChainClient({
      data: { ...SAMPLE_OVERRIDE, is_lumi_proposed: true, confirmed_at: null },
      error: null,
    });
    const repo = new DayOverridesRepository(client);

    await repo.upsert({
      planItemId: PLAN_ITEM_ID,
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      overrideDate: '2026-05-06',
      overrideType: 'sport_practice',
      isLumiProposed: true,
    });

    const upsertStep = steps.find((s) => s.op === 'upsert');
    const payload = upsertStep!.args[0] as { confirmed_at: string | null };
    expect(payload.confirmed_at).toBeNull();
  });

  it('throws when the underlying client returns an error', async () => {
    const { client } = buildChainClient({ data: null, error: new Error('db-down') });
    const repo = new DayOverridesRepository(client);

    await expect(
      repo.upsert({
        planItemId: PLAN_ITEM_ID,
        childId: CHILD_ID,
        householdId: HOUSEHOLD_ID,
        overrideDate: '2026-05-06',
        overrideType: 'sport_practice',
        isLumiProposed: false,
      }),
    ).rejects.toThrow('db-down');
  });
});

describe('DayOverridesRepository.revert', () => {
  it('returns the reverted row when an active override exists', async () => {
    const { client } = buildChainClient(
      { data: { ...SAMPLE_OVERRIDE, reverted_at: '2026-05-07T00:00:00.000Z' }, error: null },
      'maybeSingle',
    );
    const repo = new DayOverridesRepository(client);

    const result = await repo.revert(OVERRIDE_ID, HOUSEHOLD_ID);

    expect(result?.reverted_at).toBe('2026-05-07T00:00:00.000Z');
  });

  it('returns null when the override is not found or already reverted', async () => {
    const { client } = buildChainClient({ data: null, error: null }, 'maybeSingle');
    const repo = new DayOverridesRepository(client);

    const result = await repo.revert(OVERRIDE_ID, HOUSEHOLD_ID);

    expect(result).toBeNull();
  });
});

describe('DayOverridesRepository.revertExpired', () => {
  it('returns the count of rows that were soft-reverted', async () => {
    const { client } = buildChainClient(
      { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null },
      'select',
    );
    const repo = new DayOverridesRepository(client);

    const reverted = await repo.revertExpired();

    expect(reverted).toBe(3);
  });

  it('returns 0 when nothing has expired', async () => {
    const { client } = buildChainClient({ data: [], error: null }, 'select');
    const repo = new DayOverridesRepository(client);

    const reverted = await repo.revertExpired();

    expect(reverted).toBe(0);
  });
});

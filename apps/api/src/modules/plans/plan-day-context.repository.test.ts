import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PlanDayContextRepository } from './plan-day-context.repository.js';
import type { PlanDayContext } from '@hivekitchen/types';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_SLOT_ID = '55555555-5555-4555-8555-555555555555';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const OVERRIDE_ID = '44444444-4444-4444-8444-444444444444';

interface Step {
  op: string;
  args: unknown[];
}

const SAMPLE_OVERRIDE: PlanDayContext = {
  id: OVERRIDE_ID,
  plan_slot_id: PLAN_SLOT_ID,
  child_id: CHILD_ID,
  household_id: HOUSEHOLD_ID,
  override_date: '2026-05-06',
  context_type: 'sport_practice',
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
  const ops = ['insert', 'upsert', 'update', 'select', 'eq', 'is', 'gte', 'lt'];
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

describe('PlanDayContextRepository.upsert — conflict path (23505)', () => {
  it('falls through to update on unique conflict and returns the updated row', async () => {
    const maybeSingleFn = vi.fn().mockResolvedValue({ data: SAMPLE_OVERRIDE, error: null });
    const singleFn = vi.fn().mockResolvedValue({ data: null, error: { code: '23505' } });
    const builder: Record<string, unknown> = {};
    for (const op of ['insert', 'update', 'select', 'eq', 'is', 'gte', 'lt']) {
      builder[op] = () => builder;
    }
    builder.single = singleFn;
    builder.maybeSingle = maybeSingleFn;
    const client = { from: () => builder } as unknown as SupabaseClient;

    const repo = new PlanDayContextRepository(client);
    const result = await repo.upsert({
      planSlotId: PLAN_SLOT_ID,
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      overrideDate: '2026-05-06',
      contextType: 'sport_practice',
      isLumiProposed: false,
    });

    expect(singleFn).toHaveBeenCalledTimes(1);
    expect(maybeSingleFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual(SAMPLE_OVERRIDE);
  });

  it('throws when conflict row vanishes between insert and update (concurrent delete)', async () => {
    const builder: Record<string, unknown> = {};
    for (const op of ['insert', 'update', 'select', 'eq', 'is', 'gte', 'lt']) {
      builder[op] = () => builder;
    }
    builder.single = vi.fn().mockResolvedValue({ data: null, error: { code: '23505' } });
    builder.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { from: () => builder } as unknown as SupabaseClient;

    const repo = new PlanDayContextRepository(client);
    await expect(
      repo.upsert({
        planSlotId: PLAN_SLOT_ID,
        childId: CHILD_ID,
        householdId: HOUSEHOLD_ID,
        overrideDate: '2026-05-06',
        contextType: 'sport_practice',
        isLumiProposed: false,
      }),
    ).rejects.toThrow();
  });
});

describe('PlanDayContextRepository.upsert', () => {
  it('inserts a parent-initiated context row with confirmed_at set', async () => {
    const { client, steps } = buildChainClient({ data: SAMPLE_OVERRIDE, error: null });
    const repo = new PlanDayContextRepository(client);

    const result = await repo.upsert({
      planSlotId: PLAN_SLOT_ID,
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      overrideDate: '2026-05-06',
      contextType: 'sport_practice',
      isLumiProposed: false,
    });

    expect(result).toEqual(SAMPLE_OVERRIDE);
    const insertStep = steps.find((s) => s.op === 'insert');
    expect(insertStep).toBeDefined();
    const payload = insertStep!.args[0] as { confirmed_at: string | null; plan_slot_id: string };
    expect(payload.plan_slot_id).toBe(PLAN_SLOT_ID);
    expect(payload.confirmed_at).not.toBeNull();
  });

  it('leaves confirmed_at null for Lumi-proposed rows', async () => {
    const { client, steps } = buildChainClient({
      data: { ...SAMPLE_OVERRIDE, is_lumi_proposed: true, confirmed_at: null },
      error: null,
    });
    const repo = new PlanDayContextRepository(client);

    await repo.upsert({
      planSlotId: PLAN_SLOT_ID,
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      overrideDate: '2026-05-06',
      contextType: 'sport_practice',
      isLumiProposed: true,
    });

    const insertStep = steps.find((s) => s.op === 'insert');
    const payload = insertStep!.args[0] as { confirmed_at: string | null };
    expect(payload.confirmed_at).toBeNull();
  });

  it('throws when the underlying client returns a non-conflict error', async () => {
    const { client } = buildChainClient({ data: null, error: new Error('db-down') });
    const repo = new PlanDayContextRepository(client);

    await expect(
      repo.upsert({
        planSlotId: PLAN_SLOT_ID,
        childId: CHILD_ID,
        householdId: HOUSEHOLD_ID,
        overrideDate: '2026-05-06',
        contextType: 'sport_practice',
        isLumiProposed: false,
      }),
    ).rejects.toThrow('db-down');
  });
});

describe('PlanDayContextRepository.revert', () => {
  it('returns the reverted row when an active context exists', async () => {
    const { client } = buildChainClient(
      { data: { ...SAMPLE_OVERRIDE, reverted_at: '2026-05-07T00:00:00.000Z' }, error: null },
      'maybeSingle',
    );
    const repo = new PlanDayContextRepository(client);

    const result = await repo.revert(OVERRIDE_ID, HOUSEHOLD_ID, PLAN_SLOT_ID);

    expect(result?.reverted_at).toBe('2026-05-07T00:00:00.000Z');
  });

  it('returns null when the context is not found or already reverted', async () => {
    const { client } = buildChainClient({ data: null, error: null }, 'maybeSingle');
    const repo = new PlanDayContextRepository(client);

    const result = await repo.revert(OVERRIDE_ID, HOUSEHOLD_ID, PLAN_SLOT_ID);

    expect(result).toBeNull();
  });
});

describe('PlanDayContextRepository.revertExpired', () => {
  it('returns the count of rows that were soft-reverted', async () => {
    const { client } = buildChainClient(
      { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null },
      'select',
    );
    const repo = new PlanDayContextRepository(client);

    const reverted = await repo.revertExpired();

    expect(reverted).toBe(3);
  });

  it('returns 0 when nothing has expired', async () => {
    const { client } = buildChainClient({ data: [], error: null }, 'select');
    const repo = new PlanDayContextRepository(client);

    const reverted = await repo.revertExpired();

    expect(reverted).toBe(0);
  });
});

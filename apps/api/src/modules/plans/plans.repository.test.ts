import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PlansRepository } from './plans.repository.js';
import type { CommitPlanInput } from '@hivekitchen/types';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const WEEK_ID = '33333333-3333-4333-8333-333333333333';
const CHILD_ID = '44444444-4444-4444-8444-444444444444';
const RECIPE_ID = '55555555-5555-4555-8555-555555555555';

interface QueryStep {
  op: string;
  args: unknown[];
}

interface ClientResult {
  data: unknown;
  error: unknown;
}

function buildSelectClient(result: ClientResult): {
  client: SupabaseClient;
  steps: QueryStep[];
} {
  const steps: QueryStep[] = [];
  const builder = {
    select(cols: string) {
      steps.push({ op: 'select', args: [cols] });
      return builder;
    },
    eq(col: string, val: unknown) {
      steps.push({ op: 'eq', args: [col, val] });
      return builder;
    },
    not(col: string, op: string, val: unknown) {
      steps.push({ op: 'not', args: [col, op, val] });
      return builder;
    },
    order(col: string, opts: unknown) {
      steps.push({ op: 'order', args: [col, opts] });
      return builder;
    },
    limit(n: number) {
      steps.push({ op: 'limit', args: [n] });
      return builder;
    },
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  const fromMock = vi.fn().mockImplementation((table: string) => {
    steps.push({ op: 'from', args: [table] });
    return builder;
  });
  return {
    client: { from: fromMock } as unknown as SupabaseClient,
    steps,
  };
}

function buildRpcClient(result: ClientResult): {
  client: SupabaseClient;
  rpcCalls: Array<{ name: string; params: Record<string, unknown> }>;
} {
  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const rpcMock = vi
    .fn()
    .mockImplementation(async (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return result;
    });
  return {
    client: { rpc: rpcMock } as unknown as SupabaseClient,
    rpcCalls,
  };
}

const SAMPLE_ROW = {
  id: PLAN_ID,
  household_id: HOUSEHOLD_ID,
  week_id: WEEK_ID,
  revision: 1,
  generated_at: '2026-05-02T11:00:00.000Z',
  guardrail_cleared_at: '2026-05-02T11:00:01.000Z',
  guardrail_version: '1.1.0',
  prompt_version: 'v1.0.0',
  created_at: '2026-05-02T11:00:00.000Z',
  updated_at: '2026-05-02T11:00:01.000Z',
};

describe('PlansRepository.findByIdForPresentation', () => {
  it('filters out pre-clearance rows by adding not.guardrail_cleared_at.is.null', async () => {
    const { client, steps } = buildSelectClient({ data: null, error: null });
    const repo = new PlansRepository(client);

    const out = await repo.findByIdForPresentation({ planId: PLAN_ID, householdId: HOUSEHOLD_ID });

    expect(out).toBeNull();
    expect(steps).toEqual(
      expect.arrayContaining([
        { op: 'from', args: ['plans'] },
        { op: 'eq', args: ['id', PLAN_ID] },
        { op: 'eq', args: ['household_id', HOUSEHOLD_ID] },
        { op: 'not', args: ['guardrail_cleared_at', 'is', null] },
      ]),
    );
  });

  it('returns the row when guardrail_cleared_at is non-null', async () => {
    const { client } = buildSelectClient({ data: SAMPLE_ROW, error: null });
    const repo = new PlansRepository(client);

    const out = await repo.findByIdForPresentation({ planId: PLAN_ID, householdId: HOUSEHOLD_ID });

    expect(out).toEqual(SAMPLE_ROW);
  });

  it('throws when supabase returns an error', async () => {
    const { client } = buildSelectClient({ data: null, error: { code: '42P01', message: 'oops' } });
    const repo = new PlansRepository(client);

    await expect(
      repo.findByIdForPresentation({ planId: PLAN_ID, householdId: HOUSEHOLD_ID }),
    ).rejects.toMatchObject({ code: '42P01' });
  });
});

describe('PlansRepository.findByIdForOps', () => {
  it('does NOT filter on guardrail_cleared_at — pre-clearance reads allowed', async () => {
    const { client, steps } = buildSelectClient({ data: SAMPLE_ROW, error: null });
    const repo = new PlansRepository(client);

    const out = await repo.findByIdForOps({ planId: PLAN_ID, householdId: HOUSEHOLD_ID });

    expect(out).toEqual(SAMPLE_ROW);
    expect(steps.some((s) => s.op === 'not')).toBe(false);
  });

  it('returns a pre-clearance row (guardrail_cleared_at IS NULL)', async () => {
    const preClearance = { ...SAMPLE_ROW, guardrail_cleared_at: null, guardrail_version: null };
    const { client } = buildSelectClient({ data: preClearance, error: null });
    const repo = new PlansRepository(client);

    const out = await repo.findByIdForOps({ planId: PLAN_ID, householdId: HOUSEHOLD_ID });

    expect(out?.guardrail_cleared_at).toBeNull();
  });
});

describe('PlansRepository.findCurrentByHousehold', () => {
  it('orders by revision desc and applies presentation-bind filter', async () => {
    const { client, steps } = buildSelectClient({ data: SAMPLE_ROW, error: null });
    const repo = new PlansRepository(client);

    await repo.findCurrentByHousehold({ householdId: HOUSEHOLD_ID, weekId: WEEK_ID });

    expect(steps).toEqual(
      expect.arrayContaining([
        { op: 'eq', args: ['household_id', HOUSEHOLD_ID] },
        { op: 'eq', args: ['week_id', WEEK_ID] },
        { op: 'not', args: ['guardrail_cleared_at', 'is', null] },
        { op: 'order', args: ['revision', { ascending: false }] },
        { op: 'limit', args: [1] },
      ]),
    );
  });
});

describe('PlansRepository.findActiveByHouseholdAndWeek', () => {
  it('returns the most recent plan row regardless of guardrail_cleared_at', async () => {
    const preClearance = { ...SAMPLE_ROW, guardrail_cleared_at: null, guardrail_version: null };
    const { client, steps } = buildSelectClient({ data: preClearance, error: null });
    const repo = new PlansRepository(client);

    const out = await repo.findActiveByHouseholdAndWeek({
      householdId: HOUSEHOLD_ID,
      weekId: WEEK_ID,
    });

    expect(out?.guardrail_cleared_at).toBeNull();
    expect(steps.some((s) => s.op === 'not')).toBe(false);
    expect(steps).toEqual(
      expect.arrayContaining([
        { op: 'eq', args: ['household_id', HOUSEHOLD_ID] },
        { op: 'eq', args: ['week_id', WEEK_ID] },
        { op: 'order', args: ['revision', { ascending: false }] },
        { op: 'limit', args: [1] },
      ]),
    );
  });

  it('returns null when no plan exists for the household+week', async () => {
    const { client } = buildSelectClient({ data: null, error: null });
    const repo = new PlansRepository(client);

    const out = await repo.findActiveByHouseholdAndWeek({
      householdId: HOUSEHOLD_ID,
      weekId: WEEK_ID,
    });

    expect(out).toBeNull();
  });
});

describe('PlansRepository.commit', () => {
  const validInput: CommitPlanInput = {
    plan_id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_id: WEEK_ID,
    revision: 1,
    generated_at: '2026-05-02T11:00:00.000Z',
    prompt_version: 'v1.0.0',
    items: [
      {
        child_id: CHILD_ID,
        day: 'monday',
        slot: 'main',
        recipe_id: RECIPE_ID,
        ingredients: ['rice', 'lentils'],
      },
    ],
  };

  it('calls supabase.rpc("commit_plan") with the mapped p_* params', async () => {
    const { client, rpcCalls } = buildRpcClient({ data: PLAN_ID, error: null });
    const repo = new PlansRepository(client);

    const out = await repo.commit(validInput, '2026-05-02T11:00:01.000Z', '1.1.0');

    expect(out).toBe(PLAN_ID);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('commit_plan');
    expect(rpcCalls[0].params).toEqual({
      p_plan_id: PLAN_ID,
      p_household_id: HOUSEHOLD_ID,
      p_week_id: WEEK_ID,
      p_revision: 1,
      p_generated_at: '2026-05-02T11:00:00.000Z',
      p_guardrail_cleared_at: '2026-05-02T11:00:01.000Z',
      p_guardrail_version: '1.1.0',
      p_prompt_version: 'v1.0.0',
      p_items: validInput.items,
    });
  });

  it('throws when the RPC returns an error (e.g. FK violation)', async () => {
    const { client } = buildRpcClient({
      data: null,
      error: { code: '23503', message: 'fk_violation' },
    });
    const repo = new PlansRepository(client);

    await expect(repo.commit(validInput, '2026-05-02T11:00:01.000Z', '1.1.0')).rejects.toMatchObject(
      { code: '23503' },
    );
  });
});

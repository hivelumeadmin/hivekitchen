import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PlansRepository, sortPlanDaysByWeekday } from './plans.repository.js';
import type { Weekday } from '@hivekitchen/types';

// Story 3-DM-C1 Phase 3 — call-shape smoke tests for the tree-shape methods
// added to PlansRepository. Verifies the supabase-js call chain each method
// produces (table, filter, order) so a regression at the wire boundary is
// caught before downstream phases consume the methods.

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const DAY_A_ID = '22222222-2222-4222-8222-222222222222';
const DAY_B_ID = '33333333-3333-4333-8333-333333333333';
const SLOT_ID = '44444444-4444-4444-8444-444444444444';
const SLOT_B_ID = '55555555-5555-4555-8555-555555555555';
const VARIATION_ID = '66666666-6666-4666-8666-666666666666';
const MAIN_ASSIGN_ID = '77777777-7777-4777-8777-777777777777';
const RECIPE_ID = '88888888-8888-4888-8888-888888888888';
const CHILD_ID = '99999999-9999-4999-8999-999999999999';
const NOW = '2026-06-01T12:00:00.000Z';

interface QueryStep {
  op: string;
  args: unknown[];
}
interface Result {
  data: unknown;
  error: unknown;
}

function buildTreeClient(result: Result): {
  client: SupabaseClient;
  steps: QueryStep[];
} {
  const steps: QueryStep[] = [];
  const builder: Record<string, unknown> = {};

  function chain(op: string) {
    return (...args: unknown[]) => {
      steps.push({ op, args });
      return builder;
    };
  }
  builder.select = chain('select');
  builder.update = chain('update');
  builder.eq = chain('eq');
  builder.in = chain('in');
  builder.is = chain('is');
  builder.not = chain('not');
  builder.order = chain('order');
  builder.single = vi.fn().mockResolvedValue(result);
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  // Allow naked `await client.from(...).select(...).eq(...)` to resolve to
  // the result (used by find* methods that don't terminate in .single()).
  builder.then = (resolve: (value: Result) => void) =>
    Promise.resolve(result).then(resolve);

  const fromMock = vi.fn().mockImplementation((table: string) => {
    steps.push({ op: 'from', args: [table] });
    return builder;
  });
  return {
    client: { from: fromMock } as unknown as SupabaseClient,
    steps,
  };
}

function buildRpcClient(result: Result): {
  client: SupabaseClient;
  rpcCalls: Array<{ name: string; params: Record<string, unknown> }>;
} {
  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const rpcMock = vi.fn().mockImplementation(
    async (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params });
      return result;
    },
  );
  return {
    client: { rpc: rpcMock } as unknown as SupabaseClient,
    rpcCalls,
  };
}

describe('sortPlanDaysByWeekday', () => {
  it('orders Mon-Sat regardless of input order', () => {
    const days: Array<{ id: string; day: Weekday }> = [
      { id: 'f', day: 'friday' },
      { id: 'm', day: 'monday' },
      { id: 's', day: 'saturday' },
      { id: 'w', day: 'wednesday' },
    ];
    const sorted = sortPlanDaysByWeekday(days);
    expect(sorted.map((d) => d.day)).toEqual([
      'monday',
      'wednesday',
      'friday',
      'saturday',
    ]);
  });

  it('returns a new array (does not mutate input)', () => {
    const days: Array<{ id: string; day: Weekday }> = [
      { id: 't', day: 'tuesday' },
      { id: 'm', day: 'monday' },
    ];
    const out = sortPlanDaysByWeekday(days);
    expect(days[0]?.day).toBe('tuesday');
    expect(out[0]?.day).toBe('monday');
  });
});

describe('PlansRepository.hasAnyPlan (3-S35)', () => {
  it('counts cleared plans for the household and returns true when > 0', async () => {
    const { client, steps } = buildTreeClient({ data: null, error: null, count: 2 } as Result);
    const repo = new PlansRepository(client);

    const result = await repo.hasAnyPlan(PLAN_ID);

    expect(result).toBe(true);
    expect(steps).toEqual(
      expect.arrayContaining([
        { op: 'from', args: ['plans'] },
        { op: 'eq', args: ['household_id', PLAN_ID] },
        { op: 'not', args: ['guardrail_cleared_at', 'is', null] },
      ]),
    );
  });

  it('returns false when no cleared plans exist', async () => {
    const { client } = buildTreeClient({ data: null, error: null, count: 0 } as Result);
    const repo = new PlansRepository(client);

    expect(await repo.hasAnyPlan(PLAN_ID)).toBe(false);
  });
});

describe('PlansRepository.findHouseholdIdsWithPlan (3-S35)', () => {
  it('returns the subset of households that have a cleared plan', async () => {
    const { client, steps } = buildTreeClient({
      data: [{ household_id: DAY_A_ID }],
      error: null,
    });
    const repo = new PlansRepository(client);

    const set = await repo.findHouseholdIdsWithPlan([DAY_A_ID, DAY_B_ID]);

    expect(set.has(DAY_A_ID)).toBe(true);
    expect(set.has(DAY_B_ID)).toBe(false);
    expect(steps).toEqual(
      expect.arrayContaining([
        { op: 'from', args: ['plans'] },
        { op: 'in', args: ['household_id', [DAY_A_ID, DAY_B_ID]] },
        { op: 'not', args: ['guardrail_cleared_at', 'is', null] },
      ]),
    );
  });

  it('adds a week_of filter when targeting a specific week', async () => {
    const { client, steps } = buildTreeClient({ data: [], error: null });
    const repo = new PlansRepository(client);

    await repo.findHouseholdIdsWithPlan([DAY_A_ID], '2026-06-22');

    expect(steps).toEqual(
      expect.arrayContaining([{ op: 'eq', args: ['week_of', '2026-06-22'] }]),
    );
  });

  it('returns an empty set for an empty input', async () => {
    const { client } = buildTreeClient({ data: [], error: null });
    const repo = new PlansRepository(client);

    const set = await repo.findHouseholdIdsWithPlan([]);
    expect(set.size).toBe(0);
  });
});

describe('PlansRepository.findMainAssignmentsByPlanId', () => {
  it('queries plan_main_assignments filtered by plan_id and ordered by sequence', async () => {
    const { client, steps } = buildTreeClient({ data: [], error: null });
    const repo = new PlansRepository(client);

    await repo.findMainAssignmentsByPlanId(PLAN_ID);

    expect(steps).toEqual(
      expect.arrayContaining([
        { op: 'from', args: ['plan_main_assignments'] },
        { op: 'eq', args: ['plan_id', PLAN_ID] },
        { op: 'order', args: ['sequence', { ascending: true }] },
      ]),
    );
  });
});

describe('PlansRepository.findDaysByPlanId', () => {
  it('queries plan_days filtered by plan_id and ordered by day', async () => {
    const { client, steps } = buildTreeClient({ data: [], error: null });
    const repo = new PlansRepository(client);

    await repo.findDaysByPlanId(PLAN_ID);

    expect(steps).toEqual(
      expect.arrayContaining([
        { op: 'from', args: ['plan_days'] },
        { op: 'eq', args: ['plan_id', PLAN_ID] },
        { op: 'order', args: ['day', { ascending: true }] },
      ]),
    );
  });
});

describe('PlansRepository.findSlotsByDayId', () => {
  it('queries plan_slots filtered by plan_day_id', async () => {
    const { client, steps } = buildTreeClient({ data: [], error: null });
    const repo = new PlansRepository(client);

    await repo.findSlotsByDayId(DAY_A_ID);

    expect(steps).toEqual(
      expect.arrayContaining([
        { op: 'from', args: ['plan_slots'] },
        { op: 'eq', args: ['plan_day_id', DAY_A_ID] },
      ]),
    );
  });
});

describe('PlansRepository.findSlotsByDayIds (batch)', () => {
  it('queries plan_slots with .in() over the day-id list', async () => {
    const { client, steps } = buildTreeClient({ data: [], error: null });
    const repo = new PlansRepository(client);

    await repo.findSlotsByDayIds([DAY_A_ID, DAY_B_ID]);

    expect(steps).toEqual(
      expect.arrayContaining([
        { op: 'from', args: ['plan_slots'] },
        { op: 'in', args: ['plan_day_id', [DAY_A_ID, DAY_B_ID]] },
      ]),
    );
  });

  it('short-circuits to [] when given an empty list (no DB call)', async () => {
    const { client, steps } = buildTreeClient({ data: null, error: null });
    const repo = new PlansRepository(client);

    const out = await repo.findSlotsByDayIds([]);

    expect(out).toEqual([]);
    expect(steps).toEqual([]);
  });
});

describe('PlansRepository.findVariationsBySlotIds', () => {
  it('queries plan_slot_variations with .in() over the slot-id list', async () => {
    const { client, steps } = buildTreeClient({ data: [], error: null });
    const repo = new PlansRepository(client);

    await repo.findVariationsBySlotIds([SLOT_ID, SLOT_B_ID]);

    expect(steps).toEqual(
      expect.arrayContaining([
        { op: 'from', args: ['plan_slot_variations'] },
        { op: 'in', args: ['plan_slot_id', [SLOT_ID, SLOT_B_ID]] },
      ]),
    );
  });

  it('short-circuits to [] on empty input', async () => {
    const { client, steps } = buildTreeClient({ data: null, error: null });
    const repo = new PlansRepository(client);

    const out = await repo.findVariationsBySlotIds([]);

    expect(out).toEqual([]);
    expect(steps).toEqual([]);
  });
});

describe('PlansRepository.swapDays', () => {
  it('calls swap_plan_days RPC with all three ids', async () => {
    const { client, rpcCalls } = buildRpcClient({ data: null, error: null });
    const repo = new PlansRepository(client);

    await repo.swapDays({ planId: PLAN_ID, dayAId: DAY_A_ID, dayBId: DAY_B_ID });

    expect(rpcCalls).toEqual([
      {
        name: 'swap_plan_days',
        params: { p_plan_id: PLAN_ID, p_day_a_id: DAY_A_ID, p_day_b_id: DAY_B_ID },
      },
    ]);
  });
});

describe('PlansRepository.updateVariation', () => {
  it('builds an UPDATE on plan_slot_variations with the patch + updated_at', async () => {
    const variationRow = {
      id: VARIATION_ID,
      plan_slot_id: SLOT_ID,
      child_id: CHILD_ID,
      portion_size: 'large',
      texture: 'normal',
      spice_level: 'mild',
      cutting_style: null,
      container: null,
      add_ons: [],
      removals: [],
      notes: null,
      paused_at: null,
      created_at: NOW,
      updated_at: NOW,
    };
    const { client, steps } = buildTreeClient({ data: variationRow, error: null });
    const repo = new PlansRepository(client);

    const out = await repo.updateVariation({
      variationId: VARIATION_ID,
      patch: { portion_size: 'large' },
    });

    expect(out).toEqual(variationRow);
    const updateStep = steps.find((s) => s.op === 'update');
    expect(updateStep).toBeDefined();
    const patch = updateStep?.args[0] as Record<string, unknown>;
    expect(patch.portion_size).toBe('large');
    expect(typeof patch.updated_at).toBe('string');
    expect(steps).toEqual(
      expect.arrayContaining([
        { op: 'from', args: ['plan_slot_variations'] },
        { op: 'eq', args: ['id', VARIATION_ID] },
      ]),
    );
  });
});

describe('PlansRepository.pauseDayById', () => {
  it('writes paused_at + paused_reason + paused_note', async () => {
    const dayRow = {
      id: DAY_A_ID,
      plan_id: PLAN_ID,
      day: 'wednesday' as const,
      paused_at: NOW,
      paused_reason: 'snow_day' as const,
      paused_note: 'school closed',
      created_at: NOW,
      updated_at: NOW,
    };
    const { client, steps } = buildTreeClient({ data: dayRow, error: null });
    const repo = new PlansRepository(client);

    const out = await repo.pauseDayById({
      dayId: DAY_A_ID,
      pausedAt: NOW,
      reason: 'snow_day',
      note: 'school closed',
    });

    expect(out).toEqual(dayRow);
    const updateStep = steps.find((s) => s.op === 'update');
    const patch = updateStep?.args[0] as Record<string, unknown>;
    expect(patch).toMatchObject({
      paused_at: NOW,
      paused_reason: 'snow_day',
      paused_note: 'school closed',
    });
    expect(steps).toEqual(
      expect.arrayContaining([
        { op: 'from', args: ['plan_days'] },
        { op: 'eq', args: ['id', DAY_A_ID] },
      ]),
    );
  });

  it('defaults note to null when omitted', async () => {
    const { client, steps } = buildTreeClient({
      data: { id: DAY_A_ID, plan_id: PLAN_ID, day: 'monday', paused_at: NOW, paused_reason: 'sick_day', paused_note: null, created_at: NOW, updated_at: NOW },
      error: null,
    });
    const repo = new PlansRepository(client);

    await repo.pauseDayById({ dayId: DAY_A_ID, pausedAt: NOW, reason: 'sick_day' });

    const updateStep = steps.find((s) => s.op === 'update');
    const patch = updateStep?.args[0] as Record<string, unknown>;
    expect(patch.paused_note).toBeNull();
  });
});

describe('PlansRepository.unpauseDayById', () => {
  it('clears all three pause columns and filters .not paused_at is null', async () => {
    const { client, steps } = buildTreeClient({ data: null, error: null });
    const repo = new PlansRepository(client);

    await repo.unpauseDayById({ dayId: DAY_A_ID });

    const updateStep = steps.find((s) => s.op === 'update');
    const patch = updateStep?.args[0] as Record<string, unknown>;
    expect(patch).toMatchObject({
      paused_at: null,
      paused_reason: null,
      paused_note: null,
    });
    expect(steps).toEqual(
      expect.arrayContaining([
        { op: 'not', args: ['paused_at', 'is', null] },
      ]),
    );
  });
});

describe('PlansRepository.pauseChildOnDay', () => {
  it('calls pause_child_on_day RPC and returns the row count', async () => {
    const { client, rpcCalls } = buildRpcClient({ data: 3, error: null });
    const repo = new PlansRepository(client);

    const out = await repo.pauseChildOnDay({
      childId: CHILD_ID,
      planDayId: DAY_A_ID,
      pausedAt: NOW,
    });

    expect(out).toBe(3);
    expect(rpcCalls).toEqual([
      {
        name: 'pause_child_on_day',
        params: {
          p_child_id: CHILD_ID,
          p_plan_day_id: DAY_A_ID,
          p_paused_at: NOW,
        },
      },
    ]);
  });
});

describe('PlansRepository.swapMain', () => {
  it('updates plan_main_assignments.recipe_id', async () => {
    const row = {
      id: MAIN_ASSIGN_ID,
      plan_id: PLAN_ID,
      sequence: 2,
      recipe_id: RECIPE_ID,
      created_at: NOW,
    };
    const { client, steps } = buildTreeClient({ data: row, error: null });
    const repo = new PlansRepository(client);

    const out = await repo.swapMain({
      mainAssignmentId: MAIN_ASSIGN_ID,
      newRecipeId: RECIPE_ID,
    });

    expect(out).toEqual(row);
    const updateStep = steps.find((s) => s.op === 'update');
    const patch = updateStep?.args[0] as Record<string, unknown>;
    expect(patch).toEqual({ recipe_id: RECIPE_ID });
    expect(steps).toEqual(
      expect.arrayContaining([
        { op: 'from', args: ['plan_main_assignments'] },
        { op: 'eq', args: ['id', MAIN_ASSIGN_ID] },
      ]),
    );
  });
});

describe('PlansRepository.commitTree', () => {
  it('calls commit_plan RPC with tree-shape params (no p_week_id, no p_items)', async () => {
    const { client, rpcCalls } = buildRpcClient({ data: PLAN_ID, error: null });
    const repo = new PlansRepository(client);

    const input = {
      plan_id: PLAN_ID,
      household_id: '22222222-2222-4222-8222-222222222222',
      week_of: '2026-06-01',
      revision: 1,
      generated_at: NOW,
      prompt_version: 'v1.0.0',
      main_assignments: [{ sequence: 1, recipe_id: RECIPE_ID }],
      days: [
        {
          day: 'monday' as const,
          slots: [
            {
              slot_kind: 'main' as const,
              main_assignment_sequence: 1,
              variations: [{ child_id: CHILD_ID }],
            },
          ],
        },
      ],
    };

    const out = await repo.commitTree(input, NOW, '1.1.0');

    expect(out).toBe(PLAN_ID);
    expect(rpcCalls).toHaveLength(1);
    const call = rpcCalls[0]!;
    expect(call.name).toBe('commit_plan');
    expect(call.params).toMatchObject({
      p_plan_id: PLAN_ID,
      p_week_of: '2026-06-01',
      p_guardrail_cleared_at: NOW,
      p_guardrail_version: '1.1.0',
      p_main_assignments: input.main_assignments,
      p_days: input.days,
    });
    // The legacy flat-shape params must NOT appear on the new RPC call.
    expect(call.params).not.toHaveProperty('p_week_id');
    expect(call.params).not.toHaveProperty('p_items');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { ZodError } from 'zod';
import type { Redis } from 'ioredis';
import { createChildSignalSpec } from './child-signal.tools.js';
import type { ChildPreferencesRepository, ChildPreferenceAggregate } from '../../modules/child-preferences/child-preferences.repository.js';
import type { ChildrenRepository } from '../../modules/children/children.repository.js';
import type { ChildSignalOutput } from '@hivekitchen/types';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_A = '22222222-2222-4222-8222-222222222222';
const CHILD_B = '33333333-3333-4333-8333-333333333333';
const RECIPE_X = '44444444-4444-4444-8444-444444444444';
const RECIPE_Y = '55555555-5555-4555-8555-555555555555';

function buildRedis() {
  const pipeline = {
    zadd: vi.fn().mockReturnThis(),
    zremrangebyscore: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue([]),
  };
  return {
    redis: { pipeline: vi.fn().mockReturnValue(pipeline) } as unknown as Redis,
    pipeline,
  };
}

function buildChildPrefsRepo(aggregates: ChildPreferenceAggregate[]): ChildPreferencesRepository {
  return {
    getAggregatedSignals: vi.fn().mockResolvedValue(aggregates),
  } as unknown as ChildPreferencesRepository;
}

function buildChildrenRepo(children: Array<{ id: string; name: string }>): ChildrenRepository {
  return {
    findByHouseholdId: vi.fn().mockResolvedValue(children),
  } as unknown as ChildrenRepository;
}

function agg(partial: Partial<ChildPreferenceAggregate> & Pick<ChildPreferenceAggregate, 'child_id' | 'recipe_id' | 'slot_kind'>): ChildPreferenceAggregate {
  return {
    recipe_name: 'Recipe',
    loved_count: 0,
    ok_count: 0,
    not_really_count: 0,
    last_signal_at: '2026-06-01',
    ...partial,
  };
}

async function runTool(
  aggregates: ChildPreferenceAggregate[],
  children: Array<{ id: string; name: string }>,
): Promise<ChildSignalOutput> {
  const { redis } = buildRedis();
  const spec = createChildSignalSpec(buildChildPrefsRepo(aggregates), buildChildrenRepo(children), redis);
  return (await spec.fn({ household_id: HOUSEHOLD_ID, lookback_days: 30 })) as ChildSignalOutput;
}

describe('createChildSignalSpec', () => {
  it('declares name and maxLatencyMs', () => {
    const { redis } = buildRedis();
    const spec = createChildSignalSpec(buildChildPrefsRepo([]), buildChildrenRepo([]), redis);
    expect(spec.name).toBe('child_signal');
    expect(spec.maxLatencyMs).toBe(200);
  });

  it('inputSchema rejects a non-uuid household_id', () => {
    const { redis } = buildRedis();
    const spec = createChildSignalSpec(buildChildPrefsRepo([]), buildChildrenRepo([]), redis);
    expect(spec.inputSchema.safeParse({ household_id: 'nope' }).success).toBe(false);
  });

  it('rejects malformed input before touching the repos', async () => {
    const { redis } = buildRedis();
    const prefs = buildChildPrefsRepo([]);
    const spec = createChildSignalSpec(prefs, buildChildrenRepo([]), redis);
    await expect(spec.fn({})).rejects.toBeInstanceOf(ZodError);
    expect(prefs.getAggregatedSignals).not.toHaveBeenCalled();
  });

  it('records latency even when the repo throws', async () => {
    const { redis, pipeline } = buildRedis();
    const prefs = {
      getAggregatedSignals: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as ChildPreferencesRepository;
    const spec = createChildSignalSpec(prefs, buildChildrenRepo([]), redis);
    await expect(spec.fn({ household_id: HOUSEHOLD_ID })).rejects.toThrow('boom');
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });

  it('returns empty arrays for a household with no signals', async () => {
    const result = await runTool([], [{ id: CHILD_A, name: 'Layla' }]);
    expect(result).toEqual({ per_child: [], family_liked: [] });
  });

  it('puts loved/ok recipes in liked and joins the child name', async () => {
    const result = await runTool(
      [agg({ child_id: CHILD_A, recipe_id: RECIPE_X, slot_kind: 'main', recipe_name: 'Tikka wrap', loved_count: 2, last_signal_at: '2026-06-05' })],
      [{ id: CHILD_A, name: 'Layla' }],
    );
    expect(result.per_child).toHaveLength(1);
    expect(result.per_child[0]).toMatchObject({ child_id: CHILD_A, child_name: 'Layla', disliked: [] });
    expect(result.per_child[0]?.liked[0]).toEqual({
      recipe_id: RECIPE_X,
      recipe_name: 'Tikka wrap',
      slot_kind: 'main',
      count: 2,
      last_at: '2026-06-05',
    });
  });

  it('excludes a recipe with ONLY not-really signals from liked, and lists it in disliked', async () => {
    const result = await runTool(
      [agg({ child_id: CHILD_A, recipe_id: RECIPE_X, slot_kind: 'snack', not_really_count: 3 })],
      [{ id: CHILD_A, name: 'Layla' }],
    );
    expect(result.per_child[0]?.liked).toEqual([]);
    expect(result.per_child[0]?.disliked[0]).toMatchObject({ recipe_id: RECIPE_X, slot_kind: 'snack', count: 3 });
  });

  it('excludes a recipe with any loved/ok from disliked even if it also has not-really', async () => {
    const result = await runTool(
      [agg({ child_id: CHILD_A, recipe_id: RECIPE_X, slot_kind: 'main', loved_count: 1, not_really_count: 2 })],
      [{ id: CHILD_A, name: 'Layla' }],
    );
    expect(result.per_child[0]?.disliked).toEqual([]);
    expect(result.per_child[0]?.liked).toHaveLength(1);
  });

  // AC10 / FR126 — family_liked needs >= 2 distinct children.
  it('leaves family_liked empty when only one child liked the recipe', async () => {
    const result = await runTool(
      [agg({ child_id: CHILD_A, recipe_id: RECIPE_X, slot_kind: 'main', loved_count: 1 })],
      [{ id: CHILD_A, name: 'Layla' }, { id: CHILD_B, name: 'Sami' }],
    );
    expect(result.family_liked).toEqual([]);
  });

  it('populates family_liked when two children like the same (recipe, slot)', async () => {
    const result = await runTool(
      [
        agg({ child_id: CHILD_A, recipe_id: RECIPE_X, slot_kind: 'main', recipe_name: 'Tikka wrap', loved_count: 1 }),
        agg({ child_id: CHILD_B, recipe_id: RECIPE_X, slot_kind: 'main', recipe_name: 'Tikka wrap', ok_count: 1 }),
      ],
      [{ id: CHILD_A, name: 'Layla' }, { id: CHILD_B, name: 'Sami' }],
    );
    expect(result.family_liked).toEqual([
      { recipe_id: RECIPE_X, recipe_name: 'Tikka wrap', slot_kind: 'main', child_count: 2 },
    ]);
  });

  it('does not merge across slot_kind for family_liked (FR124)', async () => {
    const result = await runTool(
      [
        agg({ child_id: CHILD_A, recipe_id: RECIPE_Y, slot_kind: 'main', loved_count: 1 }),
        agg({ child_id: CHILD_B, recipe_id: RECIPE_Y, slot_kind: 'snack', loved_count: 1 }),
      ],
      [{ id: CHILD_A, name: 'Layla' }, { id: CHILD_B, name: 'Sami' }],
    );
    // Same recipe, different slots → no single (recipe, slot) pair shared by 2 kids.
    expect(result.family_liked).toEqual([]);
  });
});

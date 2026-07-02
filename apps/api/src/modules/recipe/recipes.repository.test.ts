import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RecipesRepository } from './recipes.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const RECIPE_ID = '22222222-2222-4222-8222-222222222222';

// Each .from() returns a builder whose terminal step pulls the next queued
// result. The test scripts a sequence of expected (table, op, result)
// triples. This mirrors the way declareForHousehold / seedFromCatalogBaseline
// chain: recipes INSERT → optional recipes SELECT (conflict-recovery) →
// household_recipe_usage INSERT. Per-item iteration replays the script for
// every input item.
interface Op {
  table: string;
  op: string;
  result: { data: unknown; error: unknown };
}

function buildClient(plan: Op[]): {
  client: SupabaseClient;
  recorded: Array<{ table: string; op: string }>;
} {
  const recorded: Array<{ table: string; op: string }> = [];
  let idx = 0;

  function takeNext(table: string): { data: unknown; error: unknown } {
    const next = plan[idx];
    if (!next) {
      throw new Error(
        `unexpected DB call: from('${table}') — script exhausted at index ${idx}`,
      );
    }
    if (next.table !== table) {
      throw new Error(
        `expected from('${next.table}') at step ${idx}; got from('${table}')`,
      );
    }
    recorded.push({ table: next.table, op: next.op });
    idx += 1;
    return next.result;
  }

  const fromMock = vi.fn((table: string) => {
    let pendingResult: { data: unknown; error: unknown } | null = null;
    const builder: Record<string, unknown> = {};

    builder.insert = (_payload: unknown) => {
      pendingResult = takeNext(table);
      return builder;
    };
    builder.delete = () => {
      pendingResult = takeNext(table);
      return builder;
    };
    builder.select = (_cols?: unknown) => builder;
    builder.eq = (..._args: unknown[]) => builder;
    builder.in = (..._args: unknown[]) => builder;
    builder.ilike = (..._args: unknown[]) => builder;
    builder.limit = (..._args: unknown[]) => builder;
    builder.order = (..._args: unknown[]) => builder;
    // single() / maybeSingle() return the pending result of the most-recent
    // insert OR — for the conflict-recovery SELECT branch — pull the next
    // scripted result from the plan.
    builder.single = () => {
      if (pendingResult !== null) {
        const out = pendingResult;
        pendingResult = null;
        return Promise.resolve(out);
      }
      return Promise.resolve(takeNext(table));
    };
    builder.maybeSingle = () => {
      if (pendingResult !== null) {
        const out = pendingResult;
        pendingResult = null;
        return Promise.resolve(out);
      }
      return Promise.resolve(takeNext(table));
    };
    // bare insert (no .select()) — the usage INSERT awaits the insert call
    // directly. PostgrestBuilder is thenable; this fake is too.
    builder.then = (resolve: (v: unknown) => void) => {
      if (pendingResult !== null) {
        const out = pendingResult;
        pendingResult = null;
        resolve(out);
      } else {
        resolve(takeNext(table));
      }
    };
    return builder;
  });

  const client = { from: fromMock } as unknown as SupabaseClient;
  return { client, recorded };
}

const SAMPLE_ITEM = {
  canonical_name: 'Rice with black beans',
  allergen_flags: [],
  dietary_flags: ['vegetarian', 'vegan'],
  cultural_tags: [],
  cuisine_tags: ['north_american'],
  applicable_slots: ['main'] as Array<'main' | 'snack' | 'extra'>,
};

describe('RecipesRepository.seedFromCatalogBaseline', () => {
  it('inserts recipe + usage on the happy path; returns persisted=1', async () => {
    const plan: Op[] = [
      // recipes INSERT — fresh row
      { table: 'recipes', op: 'insert', result: { data: { id: RECIPE_ID }, error: null } },
      // household_recipe_usage INSERT — success
      { table: 'household_recipe_usage', op: 'insert', result: { data: null, error: null } },
    ];
    const { client } = buildClient(plan);
    const repo = new RecipesRepository(client);

    const persisted = await repo.seedFromCatalogBaseline(HOUSEHOLD_ID, [SAMPLE_ITEM]);
    expect(persisted).toBe(1);
  });

  it('UNIQUE conflict on recipe name reuses existing recipe_id; usage still inserted', async () => {
    const plan: Op[] = [
      // recipes INSERT — 23505 conflict
      {
        table: 'recipes',
        op: 'insert',
        result: { data: null, error: { code: '23505', message: 'unique violation' } },
      },
      // recipes SELECT (conflict-recovery via ilike) — find existing row
      {
        table: 'recipes',
        op: 'select',
        result: { data: { id: RECIPE_ID }, error: null },
      },
      // household_recipe_usage INSERT — success
      { table: 'household_recipe_usage', op: 'insert', result: { data: null, error: null } },
    ];
    const { client, recorded } = buildClient(plan);
    const repo = new RecipesRepository(client);

    const persisted = await repo.seedFromCatalogBaseline(HOUSEHOLD_ID, [SAMPLE_ITEM]);
    expect(persisted).toBe(1);
    expect(recorded.map((r) => `${r.table}:${r.op}`)).toEqual([
      'recipes:insert',
      'recipes:select',
      'household_recipe_usage:insert',
    ]);
  });

  it('usage ON CONFLICT DO NOTHING (23505) is non-fatal; counts toward persisted', async () => {
    const plan: Op[] = [
      // recipes INSERT — fresh row (Stage 0 re-fire: recipes row was created
      // on a previous run but the matching usage row already exists too)
      { table: 'recipes', op: 'insert', result: { data: { id: RECIPE_ID }, error: null } },
      // household_recipe_usage INSERT — 23505 because a prior 'declared' row
      // (M5 path) was already there. Stage 0 does NOT downgrade — it just
      // logs nothing and continues. Item counts as persisted (catalog
      // already has it).
      {
        table: 'household_recipe_usage',
        op: 'insert',
        result: { data: null, error: { code: '23505', message: 'pk violation' } },
      },
    ];
    const { client } = buildClient(plan);
    const repo = new RecipesRepository(client);

    const persisted = await repo.seedFromCatalogBaseline(HOUSEHOLD_ID, [SAMPLE_ITEM]);
    expect(persisted).toBe(1);
  });

  it('non-23505 recipes INSERT error fires onItemError and continues batch', async () => {
    const plan: Op[] = [
      // item 1 — recipes INSERT fails with an unrelated error
      {
        table: 'recipes',
        op: 'insert',
        result: { data: null, error: { code: '42P01', message: 'table missing' } },
      },
      // item 2 — recipes INSERT succeeds
      { table: 'recipes', op: 'insert', result: { data: { id: RECIPE_ID }, error: null } },
      { table: 'household_recipe_usage', op: 'insert', result: { data: null, error: null } },
    ];
    const { client } = buildClient(plan);
    const repo = new RecipesRepository(client);
    const onErr = vi.fn();

    const persisted = await repo.seedFromCatalogBaseline(
      HOUSEHOLD_ID,
      [SAMPLE_ITEM, { ...SAMPLE_ITEM, canonical_name: 'Plain congee with chicken' }],
      onErr,
    );

    expect(persisted).toBe(1);
    expect(onErr).toHaveBeenCalledTimes(1);
    expect(onErr.mock.calls[0]![1]).toBe(0); // first item failed
  });

  it('skips items with empty canonical_name without contacting DB', async () => {
    const plan: Op[] = [];
    const { client } = buildClient(plan);
    const repo = new RecipesRepository(client);

    const persisted = await repo.seedFromCatalogBaseline(HOUSEHOLD_ID, [
      { ...SAMPLE_ITEM, canonical_name: '   ' },
    ]);
    expect(persisted).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Story 3-DM-A1 — insertRecipe with steps, findStepsByRecipeId, rollback
// ---------------------------------------------------------------------------

const BASE_INSERT_INPUT = {
  canonical_name: 'Chicken with rice',
  ingredients: [
    {
      key: 'chicken',
      modifier: 'thigh',
      display: '1 lb chicken thighs',
      quantity: 1,
      unit: 'lb',
      optional: false,
      substitutes: [],
    },
  ],
  ingredient_keys: ['chicken'],
  primary_ingredient_key: 'chicken',
  allergen_flags: [],
  dietary_flags: [],
  cultural_tags: [],
  cuisine_tags: [],
  applicable_slots: ['main'] as Array<'main' | 'snack' | 'extra'>,
  prep_time_minutes: 20,
  source: 'agent_generated' as const,
  created_by_household_id: HOUSEHOLD_ID,
  visibility: 'private' as const,
};

describe('RecipesRepository.insertRecipe — Story 3-DM-A1 steps persistence', () => {
  it('persists recipe + recipe_steps when steps array is provided', async () => {
    const plan: Op[] = [
      // recipes INSERT — returns the new id
      { table: 'recipes', op: 'insert', result: { data: { id: RECIPE_ID, canonical_name: 'Chicken with rice' }, error: null } },
      // recipe_steps INSERT — success
      { table: 'recipe_steps', op: 'insert', result: { data: null, error: null } },
    ];
    const { client, recorded } = buildClient(plan);
    const repo = new RecipesRepository(client);

    const row = await repo.insertRecipe({
      ...BASE_INSERT_INPUT,
      finish_time_minutes: 10,
      steps: [
        { mode: 'prep', text: 'Chop the chicken.' },
        { mode: 'finish', text: 'Sear over high heat.' },
      ],
    });

    expect(row.id).toBe(RECIPE_ID);
    expect(recorded.map((r) => `${r.table}:${r.op}`)).toEqual([
      'recipes:insert',
      'recipe_steps:insert',
    ]);
  });

  it('skips recipe_steps insert when no steps are provided (back-compat path)', async () => {
    const plan: Op[] = [
      { table: 'recipes', op: 'insert', result: { data: { id: RECIPE_ID, canonical_name: 'Chicken with rice' }, error: null } },
    ];
    const { client, recorded } = buildClient(plan);
    const repo = new RecipesRepository(client);

    await repo.insertRecipe(BASE_INSERT_INPUT);

    expect(recorded.map((r) => r.table)).toEqual(['recipes']);
  });

  it('skips recipe_steps insert when steps is an empty array', async () => {
    const plan: Op[] = [
      { table: 'recipes', op: 'insert', result: { data: { id: RECIPE_ID, canonical_name: 'Chicken with rice' }, error: null } },
    ];
    const { client, recorded } = buildClient(plan);
    const repo = new RecipesRepository(client);

    await repo.insertRecipe({ ...BASE_INSERT_INPUT, steps: [] });

    expect(recorded.map((r) => r.table)).toEqual(['recipes']);
  });

  it('rolls back the recipe row when recipe_steps INSERT fails', async () => {
    const plan: Op[] = [
      { table: 'recipes', op: 'insert', result: { data: { id: RECIPE_ID, canonical_name: 'Chicken with rice' }, error: null } },
      // recipe_steps INSERT — fails (e.g. CHECK constraint violation, FK fail)
      { table: 'recipe_steps', op: 'insert', result: { data: null, error: { code: '23514', message: 'check constraint failed' } } },
      // recipes DELETE — best-effort rollback
      { table: 'recipes', op: 'delete', result: { data: null, error: null } },
    ];
    const { client, recorded } = buildClient(plan);
    const repo = new RecipesRepository(client);

    await expect(
      repo.insertRecipe({
        ...BASE_INSERT_INPUT,
        steps: [{ mode: 'prep', text: 'Cook.' }],
      }),
    ).rejects.toMatchObject({ code: '23514' });

    expect(recorded.map((r) => `${r.table}:${r.op}`)).toEqual([
      'recipes:insert',
      'recipe_steps:insert',
      'recipes:delete',
    ]);
  });
});

describe('RecipesRepository.findStepsByRecipeId — Story 3-DM-A1', () => {
  it('returns rows in sequence order from the recipe_steps table', async () => {
    const rows = [
      { id: 'step-1', recipe_id: RECIPE_ID, sequence: 1, mode: 'prep', text: 'Chop.', created_at: '2026-05-31T00:00:00Z' },
      { id: 'step-2', recipe_id: RECIPE_ID, sequence: 2, mode: 'finish', text: 'Sear.', created_at: '2026-05-31T00:00:00Z' },
    ];
    const plan: Op[] = [
      { table: 'recipe_steps', op: 'select', result: { data: rows, error: null } },
    ];
    const { client, recorded } = buildClient(plan);
    const repo = new RecipesRepository(client);

    const result = await repo.findStepsByRecipeId(RECIPE_ID);

    expect(result).toEqual(rows);
    expect(recorded.map((r) => `${r.table}:${r.op}`)).toEqual(['recipe_steps:select']);
  });

  it('returns an empty array when no steps exist for the recipe', async () => {
    const plan: Op[] = [
      { table: 'recipe_steps', op: 'select', result: { data: [], error: null } },
    ];
    const { client } = buildClient(plan);
    const repo = new RecipesRepository(client);

    const result = await repo.findStepsByRecipeId(RECIPE_ID);
    expect(result).toEqual([]);
  });

  it('returns an empty array when Supabase returns null data', async () => {
    const plan: Op[] = [
      { table: 'recipe_steps', op: 'select', result: { data: null, error: null } },
    ];
    const { client } = buildClient(plan);
    const repo = new RecipesRepository(client);

    const result = await repo.findStepsByRecipeId(RECIPE_ID);
    expect(result).toEqual([]);
  });
});

describe('RecipesRepository.findIngredientsByIds — Story 3.S39 batch fetch', () => {
  const RECIPE_A = '33333333-3333-4333-8333-333333333333';
  const RECIPE_B = '44444444-4444-4444-8444-444444444444';

  it('returns an empty map without querying when ids is empty', async () => {
    const { client, recorded } = buildClient([]);
    const repo = new RecipesRepository(client);

    const result = await repo.findIngredientsByIds([]);

    expect(result.size).toBe(0);
    expect(recorded).toEqual([]);
  });

  it('projects object-form and string-form ingredients to display names in one query', async () => {
    const rows = [
      {
        id: RECIPE_A,
        ingredients: [
          { key: 'chicken', display: 'chicken thigh' },
          { key: 'peanut', display: 'peanuts' },
        ],
      },
      { id: RECIPE_B, ingredients: ['rice', 'broccoli'] },
    ];
    const plan: Op[] = [
      { table: 'recipes', op: 'select', result: { data: rows, error: null } },
    ];
    const { client, recorded } = buildClient(plan);
    const repo = new RecipesRepository(client);

    const result = await repo.findIngredientsByIds([RECIPE_A, RECIPE_B]);

    expect(result.get(RECIPE_A)).toEqual(['chicken thigh', 'peanuts']);
    expect(result.get(RECIPE_B)).toEqual(['rice', 'broccoli']);
    expect(recorded.map((r) => `${r.table}:${r.op}`)).toEqual(['recipes:select']);
  });

  it('maps a recipe with no usable ingredients to an empty array (unverifiable)', async () => {
    const rows = [
      { id: RECIPE_A, ingredients: [] },
      { id: RECIPE_B, ingredients: [{ key: 'x', modifier: null }] }, // no display
    ];
    const plan: Op[] = [
      { table: 'recipes', op: 'select', result: { data: rows, error: null } },
    ];
    const { client } = buildClient(plan);
    const repo = new RecipesRepository(client);

    const result = await repo.findIngredientsByIds([RECIPE_A, RECIPE_B]);

    expect(result.get(RECIPE_A)).toEqual([]);
    expect(result.get(RECIPE_B)).toEqual([]);
  });
});

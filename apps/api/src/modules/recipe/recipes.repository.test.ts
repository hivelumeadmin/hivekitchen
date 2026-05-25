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
    builder.select = (_cols?: unknown) => builder;
    builder.eq = (..._args: unknown[]) => builder;
    builder.ilike = (..._args: unknown[]) => builder;
    builder.limit = (..._args: unknown[]) => builder;
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

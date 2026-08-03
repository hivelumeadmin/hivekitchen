import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyBaseLogger } from 'fastify';
import { KitchenMapRepository } from './kitchen-map.repository.js';

const HOUSEHOLD_ID = '10000000-0000-4000-8000-000000000001';
const CHILD_A = '20000000-0000-4000-8000-00000000000a';
const CHILD_B = '20000000-0000-4000-8000-00000000000b';

type Row = Record<string, unknown>;

// Generic in-memory PostgREST double: every loadRaw() query is some
// combination of .select().eq().in().is().not() terminated either by an await
// or by .maybeSingle(). One filter engine covers all of them, so this test can
// focus on the child_extra_rules join Story 15-s5 introduced without hand-
// stubbing fourteen tables.
function buildClient(
  tables: Record<string, Row[]>,
  inCalls: Array<{ table: string; column: string; values: unknown[] }> = [],
): SupabaseClient {
  const from = (table: string) => {
    const rows = tables[table] ?? [];
    const predicates: Array<(r: Row) => boolean> = [];
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, value: unknown) => {
        predicates.push((r) => r[col] === value);
        return chain;
      },
      in: (col: string, values: unknown[]) => {
        inCalls.push({ table, column: col, values });
        predicates.push((r) => values.includes(r[col]));
        return chain;
      },
      is: (col: string, value: unknown) => {
        predicates.push((r) => r[col] === value);
        return chain;
      },
      not: (col: string, op: string, value: unknown) => {
        if (op !== 'is' || value !== null) throw new Error(`unexpected not(${col}, ${op})`);
        predicates.push((r) => r[col] !== null && r[col] !== undefined);
        return chain;
      },
      order: () => chain,
      maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: matched(), error: null }),
    };
    const matched = (): Row[] => rows.filter((r) => predicates.every((p) => p(r)));
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

const silentLogger = {
  warn: () => undefined,
  error: () => undefined,
} as unknown as FastifyBaseLogger;

function baseTables(overrides: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    households: [
      {
        id: HOUSEHOLD_ID,
        tier: 'free',
        tier_variant: 'standard',
        timezone: 'Europe/London',
        kitchen_map_version: 3,
        display_name: 'The Kapoors',
      },
    ],
    users: [],
    children: [
      { id: CHILD_A, household_id: HOUSEHOLD_ID, name: 'Maya', age_band: 'child', bag_composition_pattern: 'main_plus_snack_plus_extra' },
      { id: CHILD_B, household_id: HOUSEHOLD_ID, name: 'Rohan', age_band: 'teen', bag_composition_pattern: 'main_plus_snack' },
    ],
    cultural_priors: [],
    memory_nodes: [],
    school_policies: [],
    child_extra_rules: [],
    extra_library: [],
    household_recipe_usage: [],
    household_allergens: [],
    food_preferences: [],
    dietary_preferences: [],
    household_rules: [],
    household_cultural_identifiers: [],
    ...overrides,
  };
}

function buildRepo(tables: Record<string, Row[]>): KitchenMapRepository {
  return new KitchenMapRepository(buildClient(tables), null, silentLogger);
}

describe('KitchenMapRepository.loadRaw — extra rules', () => {
  it('groups child_extra_rules rows into per-child pins and bans', async () => {
    const repo = buildRepo(
      baseTables({
        child_extra_rules: [
          { child_id: CHILD_A, rule: 'pin', component_type: 'fruit' },
          { child_id: CHILD_A, rule: 'ban', component_type: 'sweet treat' },
          { child_id: CHILD_B, rule: 'ban', component_type: 'gummy' },
        ],
      }),
    );

    const raw = await repo.loadRaw(HOUSEHOLD_ID);

    expect(raw?.children.find((c) => c.id === CHILD_A)?.extra_rules).toEqual({
      pins: ['fruit'],
      bans: ['sweet treat'],
    });
    expect(raw?.children.find((c) => c.id === CHILD_B)?.extra_rules).toEqual({
      pins: [],
      bans: ['gummy'],
    });
  });

  it('yields empty arrays for a child with no rule rows', async () => {
    const repo = buildRepo(baseTables());

    const raw = await repo.loadRaw(HOUSEHOLD_ID);

    expect(raw?.children.map((c) => c.extra_rules)).toEqual([
      { pins: [], bans: [] },
      { pins: [], bans: [] },
    ]);
  });

  it('scopes the rule fetch to this household\'s children — child_extra_rules has no household_id', async () => {
    const outsiderChild = '30000000-0000-4000-8000-000000000003';
    const inCalls: Array<{ table: string; column: string; values: unknown[] }> = [];
    const tables = baseTables({
      children: [
        ...baseTables().children,
        { id: outsiderChild, household_id: 'other', name: 'Ada', age_band: 'child', bag_composition_pattern: 'main_only' },
      ],
      child_extra_rules: [{ child_id: outsiderChild, rule: 'ban', component_type: 'nuts' }],
    });
    const repo = new KitchenMapRepository(buildClient(tables, inCalls), null, silentLogger);

    const raw = await repo.loadRaw(HOUSEHOLD_ID);

    const ruleFetch = inCalls.find((c) => c.table === 'child_extra_rules');
    expect(ruleFetch?.values).toEqual([CHILD_A, CHILD_B]);
    expect(raw?.children.every((c) => c.extra_rules.bans.length === 0)).toBe(true);
  });

  it('skips the rule fetch entirely for a household with no children', async () => {
    const inCalls: Array<{ table: string; column: string; values: unknown[] }> = [];
    const repo = new KitchenMapRepository(
      buildClient(baseTables({ children: [] }), inCalls),
      null,
      silentLogger,
    );

    const raw = await repo.loadRaw(HOUSEHOLD_ID);

    expect(raw?.children).toEqual([]);
    expect(inCalls.find((c) => c.table === 'child_extra_rules')).toBeUndefined();
  });
});

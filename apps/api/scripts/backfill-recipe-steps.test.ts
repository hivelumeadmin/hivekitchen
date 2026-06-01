import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractStepTexts, runBackfill } from './backfill-recipe-steps.js';

// ---------------------------------------------------------------------------
// extractStepTexts — pure function unit tests
// ---------------------------------------------------------------------------

describe('extractStepTexts', () => {
  it('returns [] for null', () => {
    expect(extractStepTexts(null)).toEqual([]);
  });

  it('returns [] for undefined', () => {
    expect(extractStepTexts(undefined)).toEqual([]);
  });

  it('wraps a non-empty string into a single-element array', () => {
    expect(extractStepTexts('Cook the rice.')).toEqual(['Cook the rice.']);
  });

  it('trims and drops empty strings', () => {
    expect(extractStepTexts('   ')).toEqual([]);
    expect(extractStepTexts('  Cook.  ')).toEqual(['Cook.']);
  });

  it('extracts an array of strings, trimming each entry', () => {
    expect(extractStepTexts(['Chop.', '  Sear.  ', 'Plate.'])).toEqual([
      'Chop.',
      'Sear.',
      'Plate.',
    ]);
  });

  it('drops empty / whitespace-only entries from the array', () => {
    expect(extractStepTexts(['Chop.', '', '   ', 'Plate.'])).toEqual(['Chop.', 'Plate.']);
  });

  it('extracts .text from array-of-objects shape', () => {
    expect(
      extractStepTexts([
        { text: 'Marinate.' },
        { text: '  Sear.  ' },
        { text: 'Slice.' },
      ]),
    ).toEqual(['Marinate.', 'Sear.', 'Slice.']);
  });

  it('mixes string + object entries safely', () => {
    expect(
      extractStepTexts(['Chop.', { text: 'Sear.' }, 'Plate.']),
    ).toEqual(['Chop.', 'Sear.', 'Plate.']);
  });

  it('skips object entries whose .text is missing or non-string', () => {
    expect(
      extractStepTexts([
        { text: 'Keep.' },
        { text: 123 },
        { notText: 'drop' },
        null,
        { text: '' },
      ]),
    ).toEqual(['Keep.']);
  });

  it('returns [] for shapes that do not match (numbers, plain objects)', () => {
    expect(extractStepTexts(42)).toEqual([]);
    expect(extractStepTexts({ steps: ['Cook.'] })).toEqual([]);
    expect(extractStepTexts(true)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runBackfill — mocked Supabase client tests
// ---------------------------------------------------------------------------
//
// The script's interaction with Supabase:
//   1. recipes.select('id, instructions').range(offset, offset + pageSize - 1)
//   2. for each row:
//      a. recipe_steps.select('id', { count: 'exact', head: true })
//                     .eq('recipe_id', id).limit(1)   → existence check
//      b. recipe_steps.insert(rows)                   → multi-row insert
//
// The fake below scripts the recipes pages plus per-row (existence, insert)
// outcomes deterministically.

interface RecipeRowFake {
  id: string;
  instructions: unknown;
}

interface PerRowOutcome {
  existingStepCount: number; // returned to the existence check
  insertError?: { code?: string; message: string } | null;
}

function buildClient(opts: {
  pages: RecipeRowFake[][];
  outcomes: Map<string, PerRowOutcome>;
}): { client: SupabaseClient; insertCalls: Array<{ recipeId: string; rowCount: number }> } {
  const insertCalls: Array<{ recipeId: string; rowCount: number }> = [];
  let pageCursor = 0;

  // recipes table — paginated select via .range()
  function recipesTable(): unknown {
    return {
      select(_cols: string) {
        return {
          range(_from: number, _to: number) {
            const page = opts.pages[pageCursor] ?? [];
            pageCursor += 1;
            return Promise.resolve({ data: page, error: null });
          },
        };
      },
    };
  }

  // recipe_steps table — existence check (head:true) + insert
  function recipeStepsTable(): unknown {
    return {
      select(_cols: string, options?: { count?: string; head?: boolean }) {
        // existence check: .select('id', {count:'exact', head:true}).eq.limit
        const chain = {
          _recipeId: '',
          eq(_col: string, val: string) {
            chain._recipeId = val;
            return chain;
          },
          limit(_n: number) {
            const outcome = opts.outcomes.get(chain._recipeId);
            const count = outcome?.existingStepCount ?? 0;
            return Promise.resolve({
              data: null,
              error: null,
              count: options?.head === true ? count : undefined,
            });
          },
        };
        return chain;
      },
      insert(rows: Array<{ recipe_id: string }>) {
        const recipeId = rows[0]?.recipe_id ?? '';
        insertCalls.push({ recipeId, rowCount: rows.length });
        const outcome = opts.outcomes.get(recipeId);
        if (outcome?.insertError != null) {
          return Promise.resolve({ data: null, error: outcome.insertError });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'recipes') return recipesTable();
      if (table === 'recipe_steps') return recipeStepsTable();
      throw new Error(`unexpected table ${table}`);
    }),
  } as unknown as SupabaseClient;

  return { client, insertCalls };
}

const RECIPE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECIPE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RECIPE_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('runBackfill', () => {
  it('happy path: inserts one row per step for each migrated recipe', async () => {
    const { client, insertCalls } = buildClient({
      pages: [
        [
          { id: RECIPE_A, instructions: ['Chop.', 'Sear.'] },
          { id: RECIPE_B, instructions: ['Boil water.', 'Add pasta.', 'Drain.'] },
        ],
      ],
      outcomes: new Map([
        [RECIPE_A, { existingStepCount: 0 }],
        [RECIPE_B, { existingStepCount: 0 }],
      ]),
    });

    const summary = await runBackfill({ client, pageSize: 10 });

    expect(summary.recipes_scanned).toBe(2);
    expect(summary.recipes_migrated).toBe(2);
    expect(summary.steps_inserted).toBe(5);
    expect(summary.parse_failures).toBe(0);
    expect(summary.insert_failures).toBe(0);
    expect(insertCalls).toEqual([
      { recipeId: RECIPE_A, rowCount: 2 },
      { recipeId: RECIPE_B, rowCount: 3 },
    ]);
  });

  it('idempotent: skips recipes that already have steps without inserting', async () => {
    const { client, insertCalls } = buildClient({
      pages: [
        [
          { id: RECIPE_A, instructions: ['Already migrated.'] },
          { id: RECIPE_B, instructions: ['Fresh.'] },
        ],
      ],
      outcomes: new Map([
        [RECIPE_A, { existingStepCount: 4 }], // already migrated
        [RECIPE_B, { existingStepCount: 0 }],
      ]),
    });

    const summary = await runBackfill({ client, pageSize: 10 });

    expect(summary.recipes_skipped_existing_steps).toBe(1);
    expect(summary.recipes_migrated).toBe(1);
    expect(insertCalls).toEqual([{ recipeId: RECIPE_B, rowCount: 1 }]);
  });

  it('counts NULL-instructions rows toward recipes_skipped_null_instructions', async () => {
    const { client } = buildClient({
      pages: [[{ id: RECIPE_A, instructions: null }]],
      outcomes: new Map(),
    });

    const summary = await runBackfill({ client, pageSize: 10 });

    expect(summary.recipes_scanned).toBe(1);
    expect(summary.recipes_skipped_null_instructions).toBe(1);
    expect(summary.recipes_migrated).toBe(0);
    expect(summary.steps_inserted).toBe(0);
  });

  it('counts unrecognized instructions shapes as parse_failures and logs them', async () => {
    const logger = { error: vi.fn() };
    const { client } = buildClient({
      pages: [[{ id: RECIPE_A, instructions: { not: 'an array' } }]],
      outcomes: new Map([[RECIPE_A, { existingStepCount: 0 }]]),
    });

    const summary = await runBackfill({ client, pageSize: 10, logger });

    expect(summary.parse_failures).toBe(1);
    expect(summary.recipes_migrated).toBe(0);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('counts insert errors as insert_failures and continues to next row', async () => {
    const logger = { error: vi.fn() };
    const { client, insertCalls } = buildClient({
      pages: [
        [
          { id: RECIPE_A, instructions: ['Will fail.'] },
          { id: RECIPE_B, instructions: ['Will succeed.'] },
        ],
      ],
      outcomes: new Map([
        [RECIPE_A, { existingStepCount: 0, insertError: { code: '23514', message: 'check constraint' } }],
        [RECIPE_B, { existingStepCount: 0 }],
      ]),
    });

    const summary = await runBackfill({ client, pageSize: 10, logger });

    expect(summary.insert_failures).toBe(1);
    expect(summary.recipes_migrated).toBe(1);
    expect(insertCalls.map((c) => c.recipeId)).toEqual([RECIPE_A, RECIPE_B]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('paginates through multiple pages until a short page terminates the loop', async () => {
    const { client, insertCalls } = buildClient({
      pages: [
        // First page is full (pageSize = 2)
        [
          { id: RECIPE_A, instructions: ['A1.'] },
          { id: RECIPE_B, instructions: ['B1.'] },
        ],
        // Second page is short — terminates pagination
        [{ id: RECIPE_C, instructions: ['C1.'] }],
      ],
      outcomes: new Map([
        [RECIPE_A, { existingStepCount: 0 }],
        [RECIPE_B, { existingStepCount: 0 }],
        [RECIPE_C, { existingStepCount: 0 }],
      ]),
    });

    const summary = await runBackfill({ client, pageSize: 2 });

    expect(summary.recipes_scanned).toBe(3);
    expect(summary.recipes_migrated).toBe(3);
    expect(insertCalls).toHaveLength(3);
  });

  it('truncates step text longer than 600 chars before insert', async () => {
    const longText = 'x'.repeat(750);
    let inserted: Array<{ text: string }> = [];

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'recipes') {
          return {
            select: () => ({
              range: () =>
                Promise.resolve({
                  data: [{ id: RECIPE_A, instructions: [longText] }],
                  error: null,
                }),
            }),
          };
        }
        if (table === 'recipe_steps') {
          return {
            select: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: null, error: null, count: 0 }),
              }),
            }),
            insert: (rows: Array<{ text: string }>) => {
              inserted = rows;
              return Promise.resolve({ data: null, error: null });
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    } as unknown as SupabaseClient;

    await runBackfill({ client, pageSize: 10 });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.text.length).toBe(600);
  });
});

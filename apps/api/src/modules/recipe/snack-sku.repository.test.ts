import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SnackSkuRepository, type SnackSkuRow } from './snack-sku.repository.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const SKU_ID = '33333333-3333-4333-8333-333333333333';

const SAMPLE_ROW: SnackSkuRow = {
  id: SKU_ID,
  name: 'Pretzel Twists',
  brand: 'Snyder',
  category: 'grain',
  allergen_tags: ['wheat'],
  dietary_tags: ['vegetarian', 'halal', 'kosher'],
  is_active: true,
  in_stock: true,
  created_by_household_id: HOUSEHOLD_ID,
  archived_at: null,
  created_at: '2026-06-20T12:00:00.000Z',
  upc_code: null,
  package_type: null,
};

interface Step {
  op: string;
  args: unknown[];
}

// Chain mock: every builder method records its call and returns the builder;
// the terminal (`single` or `maybeSingle`) resolves the supplied result.
function buildChainClient(
  terminalResult: unknown,
  terminal: 'single' | 'maybeSingle',
): { client: SupabaseClient; steps: Step[] } {
  const steps: Step[] = [];
  const builder: Record<string, unknown> = {};
  const passthrough = (op: string) => (...args: unknown[]) => {
    steps.push({ op, args });
    return builder;
  };
  for (const op of ['select', 'update', 'eq', 'insert', 'or']) {
    builder[op] = passthrough(op);
  }
  builder[terminal] = vi.fn().mockResolvedValue(terminalResult);
  const fromMock = vi.fn().mockImplementation((table: string) => {
    steps.push({ op: 'from', args: [table] });
    return builder;
  });
  return { client: { from: fromMock } as unknown as SupabaseClient, steps };
}

describe('SnackSkuRepository.create', () => {
  it('inserts a household-scoped row with the expected columns and returns it', async () => {
    const { client, steps } = buildChainClient({ data: SAMPLE_ROW, error: null }, 'single');
    const repo = new SnackSkuRepository(client);

    const result = await repo.create({
      householdId: HOUSEHOLD_ID,
      name: 'Pretzel Twists',
      brand: 'Snyder',
      category: 'grain',
    });

    expect(result).toEqual(SAMPLE_ROW);
    expect(steps.find((s) => s.op === 'from')?.args).toEqual(['snack_skus']);
    const insertCall = steps.find((s) => s.op === 'insert');
    expect(insertCall?.args[0]).toEqual({
      name: 'Pretzel Twists',
      brand: 'Snyder',
      category: 'grain',
      created_by_household_id: HOUSEHOLD_ID,
    });
  });

  it('passes upc_code and package_type through to the INSERT when supplied', async () => {
    const { client, steps } = buildChainClient({ data: SAMPLE_ROW, error: null }, 'single');
    const repo = new SnackSkuRepository(client);

    await repo.create({
      householdId: HOUSEHOLD_ID,
      name: 'Pretzel Twists',
      brand: 'Snyder',
      category: 'grain',
      upc_code: '012345678905',
      package_type: 'bag',
    });

    const insertCall = steps.find((s) => s.op === 'insert');
    expect(insertCall?.args[0]).toEqual({
      name: 'Pretzel Twists',
      brand: 'Snyder',
      category: 'grain',
      created_by_household_id: HOUSEHOLD_ID,
      upc_code: '012345678905',
      package_type: 'bag',
    });
  });

  it('omits upc_code and package_type from the INSERT when not supplied', async () => {
    const { client, steps } = buildChainClient({ data: SAMPLE_ROW, error: null }, 'single');
    const repo = new SnackSkuRepository(client);

    await repo.create({
      householdId: HOUSEHOLD_ID,
      name: 'Pretzel Twists',
      brand: 'Snyder',
      category: 'grain',
    });

    const insertCall = steps.find((s) => s.op === 'insert');
    const payload = insertCall?.args[0] as Record<string, unknown>;
    expect('upc_code' in payload).toBe(false);
    expect('package_type' in payload).toBe(false);
  });

  it('passes allergen_tags through to the INSERT when supplied', async () => {
    const { client, steps } = buildChainClient({ data: SAMPLE_ROW, error: null }, 'single');
    const repo = new SnackSkuRepository(client);

    await repo.create({
      householdId: HOUSEHOLD_ID,
      name: 'Cheese Stick',
      brand: null,
      category: 'dairy',
      allergen_tags: ['dairy', 'soy'],
    });

    const insertCall = steps.find((s) => s.op === 'insert');
    const payload = insertCall?.args[0] as Record<string, unknown>;
    expect(payload.allergen_tags).toEqual(['dairy', 'soy']);
  });

  it('omits allergen_tags from the INSERT when not supplied (DB default)', async () => {
    const { client, steps } = buildChainClient({ data: SAMPLE_ROW, error: null }, 'single');
    const repo = new SnackSkuRepository(client);

    await repo.create({
      householdId: HOUSEHOLD_ID,
      name: 'Plain Cracker',
      brand: null,
      category: 'grain',
    });

    const insertCall = steps.find((s) => s.op === 'insert');
    const payload = insertCall?.args[0] as Record<string, unknown>;
    expect('allergen_tags' in payload).toBe(false);
  });

  it('throws when the insert errors', async () => {
    const { client } = buildChainClient({ data: null, error: new Error('insert failed') }, 'single');
    const repo = new SnackSkuRepository(client);

    await expect(
      repo.create({ householdId: HOUSEHOLD_ID, name: 'x', brand: null, category: 'other' }),
    ).rejects.toThrow(/insert failed/);
  });
});

describe('SnackSkuRepository.findAllergenTagsByIds', () => {
  // The query is a non-terminal awaited chain (.select().in()), so this mock
  // makes the builder itself thenable rather than using buildChainClient.
  function buildInClient(rows: Array<{ id: string; allergen_tags: string[] }>): {
    client: SupabaseClient;
    inArgs: { col?: string; ids?: unknown };
  } {
    const inArgs: { col?: string; ids?: unknown } = {};
    const builder: Record<string, unknown> = {
      select: () => builder,
      in: (col: string, ids: unknown) => {
        inArgs.col = col;
        inArgs.ids = ids;
        return builder;
      },
      then: <T,>(onFulfilled: (v: { data: typeof rows; error: null }) => T): Promise<T> =>
        Promise.resolve(onFulfilled({ data: rows, error: null })),
    };
    return {
      client: { from: () => builder } as unknown as SupabaseClient,
      inArgs,
    };
  }

  it('returns a map keyed by id for the matching rows', async () => {
    const { client, inArgs } = buildInClient([
      { id: 'id1', allergen_tags: ['dairy'] },
      { id: 'id2', allergen_tags: [] },
    ]);
    const repo = new SnackSkuRepository(client);

    const map = await repo.findAllergenTagsByIds(['id1', 'id2']);

    expect(map.get('id1')).toEqual(['dairy']);
    expect(map.get('id2')).toEqual([]);
    expect(inArgs.col).toBe('id');
    expect(inArgs.ids).toEqual(['id1', 'id2']);
  });

  it('returns an empty map without querying when ids is empty', async () => {
    const fromSpy = vi.fn();
    const repo = new SnackSkuRepository({ from: fromSpy } as unknown as SupabaseClient);

    const map = await repo.findAllergenTagsByIds([]);

    expect(map.size).toBe(0);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('returns an empty map when no rows match', async () => {
    const { client } = buildInClient([]);
    const repo = new SnackSkuRepository(client);

    const map = await repo.findAllergenTagsByIds(['unknown']);

    expect(map.size).toBe(0);
  });
});

describe('SnackSkuRepository.archive', () => {
  it('returns true and scopes the update to the household when a row matches', async () => {
    const { client, steps } = buildChainClient({ data: { id: SKU_ID }, error: null }, 'maybeSingle');
    const repo = new SnackSkuRepository(client);

    const result = await repo.archive(SKU_ID, HOUSEHOLD_ID);

    expect(result).toBe(true);
    const updateCall = steps.find((s) => s.op === 'update');
    const payload = updateCall?.args[0] as { is_active?: unknown; archived_at?: unknown };
    expect(payload.is_active).toBe(false);
    expect(typeof payload.archived_at).toBe('string');
    const eqCalls = steps.filter((s) => s.op === 'eq');
    expect(eqCalls.some((s) => s.args[0] === 'id' && s.args[1] === SKU_ID)).toBe(true);
    expect(
      eqCalls.some((s) => s.args[0] === 'created_by_household_id' && s.args[1] === HOUSEHOLD_ID),
    ).toBe(true);
  });

  it('returns false for a global seed (NULL created_by_household_id → no match)', async () => {
    const { client } = buildChainClient({ data: null, error: null }, 'maybeSingle');
    const repo = new SnackSkuRepository(client);

    expect(await repo.archive(SKU_ID, HOUSEHOLD_ID)).toBe(false);
  });

  it('returns false for an unknown sku id', async () => {
    const { client } = buildChainClient({ data: null, error: null }, 'maybeSingle');
    const repo = new SnackSkuRepository(client);

    expect(await repo.archive('00000000-0000-4000-8000-000000000000', HOUSEHOLD_ID)).toBe(false);
  });
});

describe('SnackSkuRepository.setInStock', () => {
  it('updates in_stock scoped to the household and returns the updated row', async () => {
    const updatedRow = { ...SAMPLE_ROW, in_stock: false };
    const { client, steps } = buildChainClient({ data: updatedRow, error: null }, 'maybeSingle');
    const repo = new SnackSkuRepository(client);

    const result = await repo.setInStock(SKU_ID, HOUSEHOLD_ID, false);

    expect(result).toEqual(updatedRow);
    const updateCall = steps.find((s) => s.op === 'update');
    expect(updateCall?.args[0]).toEqual({ in_stock: false });
    const eqCalls = steps.filter((s) => s.op === 'eq');
    expect(eqCalls.some((s) => s.args[0] === 'id' && s.args[1] === SKU_ID)).toBe(true);
    expect(
      eqCalls.some((s) => s.args[0] === 'created_by_household_id' && s.args[1] === HOUSEHOLD_ID),
    ).toBe(true);
  });

  it('returns null for a global seed or another household (no match)', async () => {
    const { client } = buildChainClient({ data: null, error: null }, 'maybeSingle');
    const repo = new SnackSkuRepository(client);

    expect(await repo.setInStock(SKU_ID, HOUSEHOLD_ID, true)).toBeNull();
  });
});

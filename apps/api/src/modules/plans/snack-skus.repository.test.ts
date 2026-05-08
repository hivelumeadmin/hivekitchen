import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SnackSkusRepository } from './snack-skus.repository.js';
import type { SnackSku } from '@hivekitchen/types';

const SKU_ID = '88888888-8888-4888-8888-888888888888';

const SAMPLE_SKU: SnackSku = {
  id: SKU_ID,
  name: 'String Cheese',
  brand: null,
  category: 'dairy',
  contains_peanut: false,
  contains_tree_nut: false,
  contains_dairy: true,
  contains_egg: false,
  contains_wheat: false,
  contains_soy: false,
  contains_fish: false,
  contains_shellfish: false,
  contains_sesame: false,
  is_halal: true,
  is_kosher: true,
  is_vegetarian: true,
  is_vegan: false,
  is_active: true,
};

interface Step {
  op: string;
  args: unknown[];
}

// Self-returning chainable that records every call. The terminator (`then`,
// 'maybeSingle') resolves with terminalResult to feed the awaited query.
function buildChainClient(
  terminalResult: unknown,
  mode: 'list' | 'single',
): { client: SupabaseClient; steps: Step[] } {
  const steps: Step[] = [];
  const builder: Record<string, unknown> = {};
  const passthrough = (op: string) => (...args: unknown[]) => {
    steps.push({ op, args });
    return builder;
  };
  for (const op of ['select', 'eq']) {
    builder[op] = passthrough(op);
  }
  if (mode === 'list') {
    // findActive() awaits the builder directly. PromiseLike .then forwards the
    // resolved query result.
    builder.then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve(terminalResult).then(onFulfilled, onRejected);
  } else {
    builder.maybeSingle = vi.fn().mockResolvedValue(terminalResult);
  }
  const fromMock = vi.fn().mockImplementation((table: string) => {
    steps.push({ op: 'from', args: [table] });
    return builder;
  });
  return { client: { from: fromMock } as unknown as SupabaseClient, steps };
}

describe('SnackSkusRepository.findActive', () => {
  it('queries snack_skus filtered by is_active=true and returns the rows', async () => {
    const { client, steps } = buildChainClient(
      { data: [SAMPLE_SKU], error: null },
      'list',
    );
    const repo = new SnackSkusRepository(client);

    const result = await repo.findActive();

    expect(result).toEqual([SAMPLE_SKU]);
    expect(steps.find((s) => s.op === 'from')?.args).toEqual(['snack_skus']);
    const eqCalls = steps.filter((s) => s.op === 'eq');
    expect(eqCalls.some((s) => s.args[0] === 'is_active' && s.args[1] === true)).toBe(true);
  });

  it('adds a category filter when supplied', async () => {
    const { client, steps } = buildChainClient(
      { data: [SAMPLE_SKU], error: null },
      'list',
    );
    const repo = new SnackSkusRepository(client);

    await repo.findActive({ category: 'dairy' });

    const eqCalls = steps.filter((s) => s.op === 'eq');
    expect(eqCalls.some((s) => s.args[0] === 'category' && s.args[1] === 'dairy')).toBe(true);
  });

  it('returns an empty array when the query yields null data', async () => {
    const { client } = buildChainClient({ data: null, error: null }, 'list');
    const repo = new SnackSkusRepository(client);

    expect(await repo.findActive()).toEqual([]);
  });

  it('throws when the query returns an error', async () => {
    const { client } = buildChainClient(
      { data: null, error: new Error('db error') },
      'list',
    );
    const repo = new SnackSkusRepository(client);

    await expect(repo.findActive()).rejects.toThrow(/db error/);
  });
});

describe('SnackSkusRepository.findById', () => {
  it('returns the SKU row keyed by id', async () => {
    const { client, steps } = buildChainClient(
      { data: SAMPLE_SKU, error: null },
      'single',
    );
    const repo = new SnackSkusRepository(client);

    const result = await repo.findById(SKU_ID);

    expect(result).toEqual(SAMPLE_SKU);
    const eqCalls = steps.filter((s) => s.op === 'eq');
    expect(eqCalls.some((s) => s.args[0] === 'id' && s.args[1] === SKU_ID)).toBe(true);
  });

  it('returns null when no row matches', async () => {
    const { client } = buildChainClient({ data: null, error: null }, 'single');
    const repo = new SnackSkusRepository(client);

    expect(await repo.findById(SKU_ID)).toBeNull();
  });

  it('throws when the query returns an error', async () => {
    const { client } = buildChainClient(
      { data: null, error: new Error('boom') },
      'single',
    );
    const repo = new SnackSkusRepository(client);

    await expect(repo.findById(SKU_ID)).rejects.toThrow(/boom/);
  });
});

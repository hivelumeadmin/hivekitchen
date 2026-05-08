import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtraLibraryItem } from '@hivekitchen/types';
import { ExtraLibraryRepository } from './extra-library.repository.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

const SAMPLE_ITEM: ExtraLibraryItem = {
  id: ITEM_ID,
  household_id: HOUSEHOLD_ID,
  name: 'Homemade oat bar',
  description: null,
  component_type: 'grain',
  is_allergen_free: false,
  archived_at: null,
  created_by: USER_ID,
  created_at: '2026-05-07T12:00:00.000Z',
  updated_at: '2026-05-07T12:00:00.000Z',
};

interface Step {
  op: string;
  args: unknown[];
}

function buildChainClient(
  terminalResult: unknown,
  mode: 'list' | 'single' | 'void',
): { client: SupabaseClient; steps: Step[] } {
  const steps: Step[] = [];
  const builder: Record<string, unknown> = {};
  const passthrough = (op: string) => (...args: unknown[]) => {
    steps.push({ op, args });
    return builder;
  };
  for (const op of ['select', 'update', 'eq', 'insert', 'is', 'order']) {
    builder[op] = passthrough(op);
  }
  if (mode === 'list') {
    // findByHousehold awaits the builder directly via .then.
    builder.then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve(terminalResult).then(onFulfilled, onRejected);
  } else if (mode === 'single') {
    builder.single = vi.fn().mockResolvedValue(terminalResult);
  } else {
    // archive() awaits the builder for a void result.
    builder.then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve(terminalResult).then(onFulfilled, onRejected);
  }
  const fromMock = vi.fn().mockImplementation((table: string) => {
    steps.push({ op: 'from', args: [table] });
    return builder;
  });
  return { client: { from: fromMock } as unknown as SupabaseClient, steps };
}

describe('ExtraLibraryRepository.create', () => {
  it('inserts the row and returns the persisted item', async () => {
    const { client, steps } = buildChainClient({ data: SAMPLE_ITEM, error: null }, 'single');
    const repo = new ExtraLibraryRepository(client);

    const result = await repo.create({
      householdId: HOUSEHOLD_ID,
      name: 'Homemade oat bar',
      description: null,
      componentType: 'grain',
      isAllergenFree: false,
      createdBy: USER_ID,
    });

    expect(result).toEqual(SAMPLE_ITEM);
    expect(steps.find((s) => s.op === 'from')?.args).toEqual(['extra_library']);
    const insertCall = steps.find((s) => s.op === 'insert');
    expect(insertCall?.args[0]).toMatchObject({
      household_id: HOUSEHOLD_ID,
      name: 'Homemade oat bar',
      component_type: 'grain',
      is_allergen_free: false,
      created_by: USER_ID,
    });
  });

  it('throws when the insert errors', async () => {
    const { client } = buildChainClient(
      { data: null, error: new Error('insert failed') },
      'single',
    );
    const repo = new ExtraLibraryRepository(client);

    await expect(
      repo.create({
        householdId: HOUSEHOLD_ID,
        name: 'x',
        description: null,
        componentType: 'fruit',
        isAllergenFree: false,
        createdBy: USER_ID,
      }),
    ).rejects.toThrow(/insert failed/);
  });
});

describe('ExtraLibraryRepository.findByHousehold', () => {
  it('returns active rows scoped to the household, ordered by created_at desc', async () => {
    const { client, steps } = buildChainClient(
      { data: [SAMPLE_ITEM], error: null },
      'list',
    );
    const repo = new ExtraLibraryRepository(client);

    const result = await repo.findByHousehold(HOUSEHOLD_ID);

    expect(result).toEqual([SAMPLE_ITEM]);
    const eqCalls = steps.filter((s) => s.op === 'eq');
    expect(
      eqCalls.some((s) => s.args[0] === 'household_id' && s.args[1] === HOUSEHOLD_ID),
    ).toBe(true);
    const isCall = steps.find((s) => s.op === 'is');
    expect(isCall?.args).toEqual(['archived_at', null]);
    const orderCall = steps.find((s) => s.op === 'order');
    expect(orderCall?.args[0]).toBe('created_at');
  });

  it('returns an empty array when the query yields null data', async () => {
    const { client } = buildChainClient({ data: null, error: null }, 'list');
    const repo = new ExtraLibraryRepository(client);

    expect(await repo.findByHousehold(HOUSEHOLD_ID)).toEqual([]);
  });
});

describe('ExtraLibraryRepository.archive', () => {
  it('soft-deletes by setting archived_at scoped to the household', async () => {
    const { client, steps } = buildChainClient({ error: null }, 'void');
    const repo = new ExtraLibraryRepository(client);

    await repo.archive(ITEM_ID, HOUSEHOLD_ID);

    const updateCall = steps.find((s) => s.op === 'update');
    expect(updateCall?.args[0]).toMatchObject({});
    const updatePayload = updateCall?.args[0] as { archived_at?: unknown };
    expect(typeof updatePayload.archived_at).toBe('string');
    const eqCalls = steps.filter((s) => s.op === 'eq');
    expect(eqCalls.some((s) => s.args[0] === 'id' && s.args[1] === ITEM_ID)).toBe(true);
    expect(
      eqCalls.some((s) => s.args[0] === 'household_id' && s.args[1] === HOUSEHOLD_ID),
    ).toBe(true);
  });
});

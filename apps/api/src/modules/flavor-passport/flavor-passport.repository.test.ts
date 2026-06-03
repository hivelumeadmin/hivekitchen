import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FlavorPassportRepository } from './flavor-passport.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const RECIPE_X = '44444444-4444-4444-8444-444444444444';
const RECIPE_Y = '55555555-5555-4555-8555-555555555555';

interface Step {
  op: string;
  args: unknown[];
}

// Thenable chainable mirroring child-preferences.repository.test: every builder
// method records its call and returns the builder; `await builder` resolves to
// terminalResult. The repo query ends in `.in(...)` (no .single()).
function buildChainClient(terminalResult: unknown): {
  client: SupabaseClient;
  steps: Step[];
} {
  const steps: Step[] = [];
  const builder: Record<string, unknown> = {};
  const passthrough =
    (op: string) =>
    (...args: unknown[]) => {
      steps.push({ op, args });
      return builder;
    };
  for (const op of ['select', 'eq', 'in']) {
    builder[op] = passthrough(op);
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(terminalResult);
  const fromMock = vi.fn().mockImplementation((table: string) => {
    steps.push({ op: 'from', args: [table] });
    return builder;
  });
  return { client: { from: fromMock } as unknown as SupabaseClient, steps };
}

function recipe(overrides: Record<string, unknown> = {}) {
  return {
    canonical_name: 'Tikka wrap',
    cuisine_tags: ['indian'],
    recipe_steps: [],
    ...overrides,
  };
}

describe('FlavorPassportRepository.getStampsForChild', () => {
  it('returns [] for a child with no positive signals', async () => {
    const { client } = buildChainClient({ data: [], error: null });
    const repo = new FlavorPassportRepository(client);

    expect(await repo.getStampsForChild(CHILD_ID, HOUSEHOLD_ID)).toEqual([]);
  });

  it('filters the query to loved + ok signals only (not-really excluded)', async () => {
    const { client, steps } = buildChainClient({ data: [], error: null });
    const repo = new FlavorPassportRepository(client);

    await repo.getStampsForChild(CHILD_ID, HOUSEHOLD_ID);

    expect(steps.find((s) => s.op === 'from')?.args).toEqual(['child_preferences']);
    const inStep = steps.find((s) => s.op === 'in');
    expect(inStep?.args).toEqual(['signal_type', ['loved', 'ok']]);
    expect(
      steps.some((s) => s.op === 'eq' && s.args[0] === 'child_id' && s.args[1] === CHILD_ID),
    ).toBe(true);
    expect(
      steps.some(
        (s) => s.op === 'eq' && s.args[0] === 'household_id' && s.args[1] === HOUSEHOLD_ID,
      ),
    ).toBe(true);
  });

  it('dedups two rows for the same recipe to one stamp (most recent date wins)', async () => {
    const { client } = buildChainClient({
      data: [
        { recipe_id: RECIPE_X, slot_kind: 'main', signal_type: 'ok', signal_date: '2026-06-01', recipes: recipe() },
        { recipe_id: RECIPE_X, slot_kind: 'snack', signal_type: 'ok', signal_date: '2026-06-05', recipes: recipe() },
      ],
      error: null,
    });
    const repo = new FlavorPassportRepository(client);

    const stamps = await repo.getStampsForChild(CHILD_ID, HOUSEHOLD_ID);

    expect(stamps).toHaveLength(1);
    expect(stamps[0]).toMatchObject({
      recipe_id: RECIPE_X,
      signal_type: 'ok',
      signal_date: '2026-06-05',
      slot_kind: 'snack',
    });
  });

  it('prefers a loved signal over an ok signal for the same recipe', async () => {
    const { client } = buildChainClient({
      data: [
        // ok is more recent, but loved must still win on signal_type priority.
        { recipe_id: RECIPE_X, slot_kind: 'main', signal_type: 'ok', signal_date: '2026-06-10', recipes: recipe() },
        { recipe_id: RECIPE_X, slot_kind: 'main', signal_type: 'loved', signal_date: '2026-06-01', recipes: recipe() },
      ],
      error: null,
    });
    const repo = new FlavorPassportRepository(client);

    const stamps = await repo.getStampsForChild(CHILD_ID, HOUSEHOLD_ID);

    expect(stamps).toHaveLength(1);
    expect(stamps[0]?.signal_type).toBe('loved');
    expect(stamps[0]?.signal_date).toBe('2026-06-01');
  });

  it('normalizes an array-embedded recipe the same as an object-embedded one', async () => {
    const { client } = buildChainClient({
      data: [
        { recipe_id: RECIPE_X, slot_kind: 'main', signal_type: 'loved', signal_date: '2026-06-01', recipes: [recipe()] },
      ],
      error: null,
    });
    const repo = new FlavorPassportRepository(client);

    const stamps = await repo.getStampsForChild(CHILD_ID, HOUSEHOLD_ID);

    expect(stamps[0]?.recipe_name).toBe('Tikka wrap');
    expect(stamps[0]?.cuisine_tags).toEqual(['indian']);
  });

  describe('method_caption', () => {
    it('picks the lowest-sequence finish-mode step', async () => {
      const { client } = buildChainClient({
        data: [
          {
            recipe_id: RECIPE_X,
            slot_kind: 'main',
            signal_type: 'loved',
            signal_date: '2026-06-01',
            recipes: recipe({
              recipe_steps: [
                { text: 'Chop veg', sequence: 1, mode: 'prep' },
                { text: 'Grill the wrap', sequence: 3, mode: 'finish' },
                { text: 'Plate and serve', sequence: 5, mode: 'finish' },
              ],
            }),
          },
        ],
        error: null,
      });
      const repo = new FlavorPassportRepository(client);

      const stamps = await repo.getStampsForChild(CHILD_ID, HOUSEHOLD_ID);

      expect(stamps[0]?.method_caption).toBe('Grill the wrap');
    });

    it('falls back to the lowest-sequence step of any mode when no finish step exists', async () => {
      const { client } = buildChainClient({
        data: [
          {
            recipe_id: RECIPE_X,
            slot_kind: 'main',
            signal_type: 'loved',
            signal_date: '2026-06-01',
            recipes: recipe({
              recipe_steps: [
                { text: 'Second prep', sequence: 2, mode: 'prep' },
                { text: 'First prep', sequence: 1, mode: 'prep' },
              ],
            }),
          },
        ],
        error: null,
      });
      const repo = new FlavorPassportRepository(client);

      const stamps = await repo.getStampsForChild(CHILD_ID, HOUSEHOLD_ID);

      expect(stamps[0]?.method_caption).toBe('First prep');
    });

    it('is null when the recipe has no steps', async () => {
      const { client } = buildChainClient({
        data: [
          { recipe_id: RECIPE_X, slot_kind: 'main', signal_type: 'loved', signal_date: '2026-06-01', recipes: recipe({ recipe_steps: [] }) },
          { recipe_id: RECIPE_Y, slot_kind: 'main', signal_type: 'loved', signal_date: '2026-06-01', recipes: recipe({ recipe_steps: null }) },
        ],
        error: null,
      });
      const repo = new FlavorPassportRepository(client);

      const stamps = await repo.getStampsForChild(CHILD_ID, HOUSEHOLD_ID);

      expect(stamps.every((s) => s.method_caption === null)).toBe(true);
    });
  });

  it('skips a signal whose recipe is null (deleted-recipe race) and logs a warning', async () => {
    const warn = vi.fn();
    const { client } = buildChainClient({
      data: [
        { recipe_id: RECIPE_X, slot_kind: 'main', signal_type: 'loved', signal_date: '2026-06-01', recipes: null },
        { recipe_id: RECIPE_Y, slot_kind: 'main', signal_type: 'loved', signal_date: '2026-06-01', recipes: recipe() },
      ],
      error: null,
    });
    const repo = new FlavorPassportRepository(client, { warn } as never);

    const stamps = await repo.getStampsForChild(CHILD_ID, HOUSEHOLD_ID);

    expect(stamps).toHaveLength(1);
    expect(stamps[0]?.recipe_id).toBe(RECIPE_Y);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('throws when the query errors', async () => {
    const { client } = buildChainClient({ data: null, error: new Error('boom') });
    const repo = new FlavorPassportRepository(client);

    await expect(repo.getStampsForChild(CHILD_ID, HOUSEHOLD_ID)).rejects.toThrow(/boom/);
  });
});

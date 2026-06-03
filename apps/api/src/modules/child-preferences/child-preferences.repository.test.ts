import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ChildPreferencesRepository } from './child-preferences.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_A = '22222222-2222-4222-8222-222222222222';
const CHILD_B = '33333333-3333-4333-8333-333333333333';
const RECIPE_X = '44444444-4444-4444-8444-444444444444';
const RECIPE_Y = '55555555-5555-4555-8555-555555555555';

interface Step {
  op: string;
  args: unknown[];
}

// Thenable chainable: every builder method records its call and returns the
// builder; `await builder` (after any chain) resolves to terminalResult. This
// covers both the `await ...upsert()` and `await ...gte()` terminals the repo
// uses (neither ends in .single()/.maybeSingle()).
function buildChainClient(terminalResult: unknown): {
  client: SupabaseClient;
  steps: Step[];
} {
  const steps: Step[] = [];
  const builder: Record<string, unknown> = {};
  const passthrough = (op: string) => (...args: unknown[]) => {
    steps.push({ op, args });
    return builder;
  };
  for (const op of ['select', 'upsert', 'eq', 'gte', 'insert', 'update', 'order', 'in', 'is']) {
    builder[op] = passthrough(op);
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(terminalResult);
  const fromMock = vi.fn().mockImplementation((table: string) => {
    steps.push({ op: 'from', args: [table] });
    return builder;
  });
  return { client: { from: fromMock } as unknown as SupabaseClient, steps };
}

describe('ChildPreferencesRepository.upsertSignal', () => {
  it('upserts on the dedup key so a re-rated day overwrites signal_type', async () => {
    const { client, steps } = buildChainClient({ error: null });
    const repo = new ChildPreferencesRepository(client);

    await repo.upsertSignal({
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_A,
      recipe_id: RECIPE_X,
      slot_kind: 'main',
      signal_type: 'loved',
      signal_date: '2026-06-01',
    });

    expect(steps.find((s) => s.op === 'from')?.args).toEqual(['child_preferences']);
    const upsert = steps.find((s) => s.op === 'upsert');
    expect(upsert?.args[0]).toMatchObject({
      child_id: CHILD_A,
      recipe_id: RECIPE_X,
      slot_kind: 'main',
      signal_type: 'loved',
      signal_date: '2026-06-01',
      source: 'layer1_emoji',
    });
    // ON CONFLICT target is the dedup index → DO UPDATE overwrites signal_type.
    expect(upsert?.args[1]).toEqual({
      onConflict: 'child_id,recipe_id,slot_kind,signal_date',
    });
  });

  it('honours an explicit source override', async () => {
    const { client, steps } = buildChainClient({ error: null });
    const repo = new ChildPreferencesRepository(client);
    await repo.upsertSignal({
      household_id: HOUSEHOLD_ID,
      child_id: CHILD_A,
      recipe_id: RECIPE_X,
      slot_kind: 'snack',
      signal_type: 'ok',
      signal_date: '2026-06-01',
      source: 'offline_replay',
    });
    expect(steps.find((s) => s.op === 'upsert')?.args[0]).toMatchObject({
      source: 'offline_replay',
    });
  });

  it('throws when the upsert errors', async () => {
    const { client } = buildChainClient({ error: new Error('db down') });
    const repo = new ChildPreferencesRepository(client);
    await expect(
      repo.upsertSignal({
        household_id: HOUSEHOLD_ID,
        child_id: CHILD_A,
        recipe_id: RECIPE_X,
        slot_kind: 'main',
        signal_type: 'loved',
        signal_date: '2026-06-01',
      }),
    ).rejects.toThrow(/db down/);
  });
});

describe('ChildPreferencesRepository.getAggregatedSignals', () => {
  it('groups by (child, recipe, slot_kind), counts each type, and joins recipe_name', async () => {
    const { client, steps } = buildChainClient({
      data: [
        { child_id: CHILD_A, recipe_id: RECIPE_X, slot_kind: 'main', signal_type: 'loved', signal_date: '2026-06-01', recipes: { canonical_name: 'Tikka wrap' } },
        { child_id: CHILD_A, recipe_id: RECIPE_X, slot_kind: 'main', signal_type: 'ok', signal_date: '2026-06-03', recipes: { canonical_name: 'Tikka wrap' } },
        // Array-embedded form is normalised the same way.
        { child_id: CHILD_A, recipe_id: RECIPE_X, slot_kind: 'main', signal_type: 'loved', signal_date: '2026-06-02', recipes: [{ canonical_name: 'Tikka wrap' }] },
      ],
      error: null,
    });
    const repo = new ChildPreferencesRepository(client);

    const result = await repo.getAggregatedSignals(HOUSEHOLD_ID, '2026-05-04');

    expect(result).toEqual([
      {
        child_id: CHILD_A,
        recipe_id: RECIPE_X,
        recipe_name: 'Tikka wrap',
        slot_kind: 'main',
        loved_count: 2,
        ok_count: 1,
        not_really_count: 0,
        last_signal_at: '2026-06-03', // MAX(signal_date)
      },
    ]);
    // 30-day window cutoff is applied at the query boundary.
    expect(steps.some((s) => s.op === 'gte' && s.args[0] === 'signal_date' && s.args[1] === '2026-05-04')).toBe(true);
    expect(steps.some((s) => s.op === 'eq' && s.args[0] === 'household_id' && s.args[1] === HOUSEHOLD_ID)).toBe(true);
  });

  // AC8 / FR125 — absence is invisible: zero signals → zero rows (not a zero-score row).
  it('returns no rows for a child with no signals in the window (FR125)', async () => {
    const { client } = buildChainClient({ data: [], error: null });
    const repo = new ChildPreferencesRepository(client);
    expect(await repo.getAggregatedSignals(HOUSEHOLD_ID, '2026-05-04')).toEqual([]);
  });

  // AC9 / FR124 — slot_kind isolation: the same recipe in main + snack yields two
  // independent groups; a main signal never shows up under snack.
  it('keeps slot_kind groups independent (FR124)', async () => {
    const { client } = buildChainClient({
      data: [
        { child_id: CHILD_A, recipe_id: RECIPE_X, slot_kind: 'main', signal_type: 'loved', signal_date: '2026-06-01', recipes: { canonical_name: 'Hummus plate' } },
        { child_id: CHILD_A, recipe_id: RECIPE_X, slot_kind: 'snack', signal_type: 'not-really', signal_date: '2026-06-01', recipes: { canonical_name: 'Hummus plate' } },
      ],
      error: null,
    });
    const repo = new ChildPreferencesRepository(client);

    const result = await repo.getAggregatedSignals(HOUSEHOLD_ID, '2026-05-04');

    const main = result.find((r) => r.slot_kind === 'main');
    const snack = result.find((r) => r.slot_kind === 'snack');
    expect(result).toHaveLength(2);
    expect(main).toMatchObject({ loved_count: 1, not_really_count: 0 });
    expect(snack).toMatchObject({ loved_count: 0, not_really_count: 1 });
  });

  it('throws when the query errors', async () => {
    const { client } = buildChainClient({ data: null, error: new Error('boom') });
    const repo = new ChildPreferencesRepository(client);
    await expect(repo.getAggregatedSignals(HOUSEHOLD_ID, '2026-05-04')).rejects.toThrow(/boom/);
  });
});

describe('ChildPreferencesRepository.getVariantEligibleChildIds', () => {
  it('returns only children with >= minSignalDates distinct signal dates', async () => {
    const { client } = buildChainClient({
      data: [
        // Child A: 3 distinct dates (one date repeated) → eligible at threshold 3.
        { child_id: CHILD_A, signal_date: '2026-06-01', children: { name: 'Layla' } },
        { child_id: CHILD_A, signal_date: '2026-06-01', children: { name: 'Layla' } },
        { child_id: CHILD_A, signal_date: '2026-06-02', children: { name: 'Layla' } },
        { child_id: CHILD_A, signal_date: '2026-06-03', children: { name: 'Layla' } },
        // Child B: 2 distinct dates → below threshold.
        { child_id: CHILD_B, signal_date: '2026-06-01', children: { name: 'Sami' } },
        { child_id: CHILD_B, signal_date: '2026-06-02', children: { name: 'Sami' } },
      ],
      error: null,
    });
    const repo = new ChildPreferencesRepository(client);

    const result = await repo.getVariantEligibleChildIds(HOUSEHOLD_ID, '2026-05-04', 3);

    expect(result).toEqual([{ child_id: CHILD_A, child_name: 'Layla' }]);
  });

  it('returns empty when no child clears the threshold', async () => {
    const { client } = buildChainClient({ data: [], error: null });
    const repo = new ChildPreferencesRepository(client);
    expect(await repo.getVariantEligibleChildIds(HOUSEHOLD_ID, '2026-05-04', 3)).toEqual([]);
  });
});

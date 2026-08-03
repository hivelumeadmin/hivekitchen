import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runBackfill, verifyParity } from './backfill-lunch-rating-signals.js';

const HOUSEHOLD_A = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_B = '22222222-2222-4222-8222-222222222222';
const CHILD_A = '33333333-3333-4333-8333-333333333333';
const RECIPE_X = '44444444-4444-4444-8444-444444444444';
const RECIPE_Y = '55555555-5555-4555-8555-555555555555';

const DAY = '2026-06-03';

interface PreferenceRow {
  household_id: string;
  child_id: string;
  recipe_id: string;
  slot_kind: string;
  signal_type: string;
  signal_date: string;
  created_at: string;
}

interface SignalRowLike {
  id: string;
  household_id: string;
  child_id: string | null;
  kind: string;
  subject_ref: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  occurred_at: string;
  source: string;
  created_at: string;
}

interface FakeState {
  child_preferences: PreferenceRow[];
  signals: SignalRowLike[];
}

function pref(overrides: Partial<PreferenceRow> = {}): PreferenceRow {
  return {
    household_id: HOUSEHOLD_A,
    child_id: CHILD_A,
    recipe_id: RECIPE_X,
    slot_kind: 'main',
    signal_type: 'loved',
    signal_date: DAY,
    created_at: '2026-06-03T18:30:00.000Z',
    ...overrides,
  };
}

let sigSeq = 0;
function sig(overrides: Partial<SignalRowLike> = {}): SignalRowLike {
  sigSeq += 1;
  return {
    id: `66666666-6666-4666-8666-${String(sigSeq).padStart(12, '0')}`,
    household_id: HOUSEHOLD_A,
    child_id: CHILD_A,
    kind: 'lunch_rating',
    subject_ref: { recipe_id: RECIPE_X, slot_kind: 'main' },
    payload: { kind: 'lunch_rating', rating: 'loved', date: DAY },
    occurred_at: '2026-06-03T18:30:00.000Z',
    source: 'lunch_link',
    created_at: '2026-06-03T18:30:00.000Z',
    ...overrides,
  };
}

// Minimal in-memory Supabase double: eq filters + range slicing + insert.
// order/limit/or are accepted and ignored — the keyset loop terminates on a
// short page, and every fake page is short.
function buildFakeClient(state: FakeState): SupabaseClient {
  const from = (table: keyof FakeState) => {
    const filters: [string, unknown][] = [];
    let range: [number, number] | null = null;
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      or: () => builder,
      eq: (col: string, value: unknown) => {
        filters.push([col, value]);
        return builder;
      },
      range: (a: number, b: number) => {
        range = [a, b];
        return builder;
      },
      insert: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
        const rows = Array.isArray(payload) ? payload : [payload];
        for (const row of rows) {
          sigSeq += 1;
          state.signals.push({
            id: `77777777-7777-4777-8777-${String(sigSeq).padStart(12, '0')}`,
            created_at: row.occurred_at as string,
            ...row,
          } as SignalRowLike);
        }
        return { then: (resolve: (v: unknown) => unknown) => resolve({ error: null }) };
      },
      then: (resolve: (v: unknown) => unknown) => {
        let out: Record<string, unknown>[] = (state[table] as Record<string, unknown>[]).filter(
          (row) => filters.every(([col, value]) => row[col] === value),
        );
        if (range !== null) out = out.slice(range[0], range[1] + 1);
        return resolve({ data: out, error: null });
      },
    });
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

function state(overrides: Partial<FakeState> = {}): FakeState {
  return { child_preferences: [], signals: [], ...overrides };
}

describe('runBackfill', () => {
  it('imports a legacy preference as a signal stamped with its original created_at', async () => {
    const s = state({ child_preferences: [pref()] });
    const client = buildFakeClient(s);

    const summary = await runBackfill({ client });

    expect(summary).toMatchObject({
      households_scanned: 1,
      preferences_scanned: 1,
      signals_inserted: 1,
      skipped_existing: 0,
    });
    expect(s.signals).toHaveLength(1);
    expect(s.signals[0]).toMatchObject({
      household_id: HOUSEHOLD_A,
      child_id: CHILD_A,
      kind: 'lunch_rating',
      subject_ref: { recipe_id: RECIPE_X, slot_kind: 'main' },
      payload: { kind: 'lunch_rating', rating: 'loved', date: DAY },
      // The rating's own timestamp, not the import's — a rebuilt projection
      // must order identically to the original.
      occurred_at: '2026-06-03T18:30:00.000Z',
      source: 'import',
    });
  });

  it('skips a preference that already has a matching signal, whatever its source', async () => {
    const s = state({ child_preferences: [pref()], signals: [sig({ source: 'lunch_link' })] });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary).toMatchObject({ signals_inserted: 0, skipped_existing: 1 });
    expect(s.signals).toHaveLength(1);
  });

  it('is idempotent — a second run inserts nothing', async () => {
    const s = state({ child_preferences: [pref(), pref({ recipe_id: RECIPE_Y, slot_kind: 'snack' })] });
    const client = buildFakeClient(s);

    const first = await runBackfill({ client });
    const second = await runBackfill({ client });

    expect(first.signals_inserted).toBe(2);
    expect(second.signals_inserted).toBe(0);
    expect(second.skipped_existing).toBe(2);
    expect(s.signals).toHaveLength(2);
  });

  it('walks every household that has preferences', async () => {
    const s = state({
      child_preferences: [pref(), pref({ household_id: HOUSEHOLD_B, signal_type: 'ok' })],
    });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary.households_scanned).toBe(2);
    expect(s.signals).toHaveLength(2);
  });

  it('threads a provided logger into the projection so a live backfill surfaces skipped signals', async () => {
    // A second, unprojectable signal (null child_id) sits alongside the
    // matching one for household A's preference — projectLunchRatings skips
    // it and warns, but only if runBackfill actually passes its logger
    // through to every projectLunchRatings call.
    const s = state({
      child_preferences: [pref()],
      signals: [sig({ child_id: null })],
    });
    const warn = vi.fn();

    await runBackfill({ client: buildFakeClient(s), logger: { warn } });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ skipped: 1, reasons: { child_id: 1 } });
  });
});

describe('verifyParity', () => {
  it('passes when the projection reproduces child_preferences exactly', async () => {
    const s = state({ child_preferences: [pref()] });
    const client = buildFakeClient(s);
    await runBackfill({ client });

    const result = await verifyParity({ client });

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(1);
    expect(result.mismatches).toEqual([]);
  });

  it('fails when a preference has no signal behind it (backfill not run)', async () => {
    const result = await verifyParity({ client: buildFakeClient(state({ child_preferences: [pref()] })) });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      {
        household_id: HOUSEHOLD_A,
        child_id: CHILD_A,
        recipe_id: RECIPE_X,
        slot_kind: 'main',
        signal_date: DAY,
        reason: 'missing_in_projection',
      },
    ]);
  });

  it('fails when the projection has a row the table does not (the post-reset hazard)', async () => {
    const result = await verifyParity({ client: buildFakeClient(state({ signals: [sig()] })) });

    expect(result.ok).toBe(false);
    expect(result.mismatches[0]).toMatchObject({ reason: 'extra_in_projection' });
  });

  it('fails when the projected rating disagrees with the stored one', async () => {
    const s = state({
      child_preferences: [pref({ signal_type: 'loved' })],
      signals: [sig({ payload: { kind: 'lunch_rating', rating: 'not-really', date: DAY } })],
    });

    const result = await verifyParity({ client: buildFakeClient(s) });

    expect(result.ok).toBe(false);
    expect(result.mismatches[0]).toMatchObject({ reason: 'signal_type_mismatch' });
  });

  it('never prints a rating value in the diff', async () => {
    const s = state({
      child_preferences: [pref({ signal_type: 'loved' })],
      signals: [sig({ payload: { kind: 'lunch_rating', rating: 'not-really', date: DAY } })],
    });

    const result = await verifyParity({ client: buildFakeClient(s) });

    const printed = JSON.stringify(result.mismatches);
    expect(printed).not.toContain('not-really');
    expect(printed).not.toContain('loved');
  });

  it('threads a provided logger into the projection so a parity run surfaces skipped signals', async () => {
    const s = state({ signals: [sig(), sig({ child_id: null })] });
    const warn = vi.fn();

    await verifyParity({ client: buildFakeClient(s), logger: { warn } });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ skipped: 1, reasons: { child_id: 1 } });
  });
});

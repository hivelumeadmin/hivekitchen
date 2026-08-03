import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runBackfill, verifyParity } from './backfill-family-language-terms.js';

const HOUSEHOLD_A = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_B = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD_C = '33333333-3333-4333-8333-333333333333';

const FIRST_SEEN = '2026-06-08T10:00:00.000Z';
const RATIFIED = '2026-06-08T10:05:00.000Z';

interface HouseholdRow {
  id: string;
  preferred_family_language_terms: unknown;
}

interface TermRow {
  household_id: string;
  term: string;
  maps_to: string;
  usage_count: number;
  state: string;
  first_seen_at: string;
  ratified_at: string | null;
}

interface FakeState {
  households: HouseholdRow[];
  family_language_terms: TermRow[];
}

function state(overrides: Partial<FakeState> = {}): FakeState {
  return { households: [], family_language_terms: [], ...overrides };
}

function element(overrides: Partial<TermRow> = {}): Record<string, unknown> {
  const { household_id: _ignored, ...rest } = {
    household_id: '',
    term: 'Nani',
    maps_to: 'grandmother',
    usage_count: 2,
    state: 'candidate',
    first_seen_at: FIRST_SEEN,
    ratified_at: null,
    ...overrides,
  } as TermRow;
  return rest;
}

function household(id: string, elements: Record<string, unknown>[]): HouseholdRow {
  return { id, preferred_family_language_terms: elements };
}

function termRow(householdId: string, overrides: Partial<TermRow> = {}): TermRow {
  return {
    household_id: householdId,
    term: 'Nani',
    maps_to: 'grandmother',
    usage_count: 2,
    state: 'candidate',
    first_seen_at: FIRST_SEEN,
    ratified_at: null,
    ...overrides,
  };
}

// In-memory Supabase double. Models exactly the operations the script issues:
//   households:            .select('id, preferred_family_language_terms').order().range()
//   family_language_terms: .select(...).order().order().range()
//   family_language_terms: .upsert(rows, {onConflict, ignoreDuplicates}).select()
// `range` slices so a small pageSize genuinely exercises the continuation loop.
function buildFakeClient(s: FakeState): SupabaseClient {
  const from = (table: keyof FakeState) => {
    let range: [number, number] | null = null;
    const builder: Record<string, unknown> = {};

    const rowsForRead = (): Record<string, unknown>[] => {
      const out = s[table] as unknown as Record<string, unknown>[];
      return range === null ? out : out.slice(range[0], range[1] + 1);
    };

    Object.assign(builder, {
      select: () => builder,
      order: () => builder,
      range: (a: number, b: number) => {
        range = [a, b];
        return builder;
      },
      upsert: (rows: Record<string, unknown>[], opts: Record<string, unknown>) => {
        // The DB unique index is (household_id, term) — plain, not functional —
        // precisely so PostgREST can name it here.
        if (opts.onConflict !== 'household_id,term') {
          throw new Error(`unexpected conflict target: ${String(opts.onConflict)}`);
        }
        if (opts.ignoreDuplicates !== true) {
          throw new Error('backfill must not clobber existing term rows');
        }
        const inserted: Record<string, unknown>[] = [];
        for (const row of rows) {
          const exists = s.family_language_terms.some(
            (r) => r.household_id === row.household_id && r.term === row.term,
          );
          if (exists) continue; // ON CONFLICT DO NOTHING
          s.family_language_terms.push(row as unknown as TermRow);
          inserted.push(row);
        }
        return {
          select: () => ({
            then: (resolve: (v: unknown) => unknown) => resolve({ data: inserted, error: null }),
          }),
        };
      },
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rowsForRead(), error: null }),
    });
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

describe('runBackfill', () => {
  it('copies every array element into its own row, verbatim', async () => {
    const s = state({
      households: [
        household(HOUSEHOLD_A, [
          element({ state: 'active', ratified_at: RATIFIED, usage_count: 5 }),
          element({ term: 'Thatha', maps_to: 'grandfather', usage_count: 1 }),
        ]),
      ],
    });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary).toMatchObject({
      households_scanned: 1,
      terms_inserted: 2,
      skipped_existing: 0,
      skipped_empty: 0,
      skipped_invalid: 0,
      skipped_duplicate: 0,
    });
    expect(s.family_language_terms).toEqual([
      termRow(HOUSEHOLD_A, { state: 'active', ratified_at: RATIFIED, usage_count: 5 }),
      termRow(HOUSEHOLD_A, { term: 'Thatha', maps_to: 'grandfather', usage_count: 1 }),
    ]);
  });

  it('preserves the forgotten state — a structural copy, not a re-derivation', async () => {
    const s = state({ households: [household(HOUSEHOLD_A, [element({ state: 'forgotten' })])] });

    await runBackfill({ client: buildFakeClient(s) });

    expect(s.family_language_terms[0]!.state).toBe('forgotten');
  });

  it('skips a household with an empty array without inserting anything', async () => {
    const s = state({
      households: [household(HOUSEHOLD_A, []), household(HOUSEHOLD_B, [element()])],
    });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary).toMatchObject({ households_scanned: 2, terms_inserted: 1 });
    expect(s.family_language_terms).toEqual([termRow(HOUSEHOLD_B)]);
  });

  it('skips an element with no term and warns — nothing to migrate is not a row', async () => {
    const s = state({
      households: [household(HOUSEHOLD_A, [element({ term: '' }), element({ term: 'Thatha' })])],
    });
    const warn = vi.fn();

    const summary = await runBackfill({ client: buildFakeClient(s), logger: { warn } });

    expect(summary).toMatchObject({ skipped_empty: 1, terms_inserted: 1 });
    expect(s.family_language_terms).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ skipped_empty: 1 }),
      expect.stringContaining('no term'),
    );
  });

  it.each([
    ['a term over the 40-char cap', element({ term: 'x'.repeat(41) })],
    ['a maps_to over the 40-char cap', element({ maps_to: 'x'.repeat(41) })],
    ['an empty maps_to', element({ maps_to: '' })],
    ['a negative usage_count', element({ usage_count: -1 })],
    ['a fractional usage_count', element({ usage_count: 1.5 })],
    ['a non-numeric usage_count', { ...element(), usage_count: 'two' }],
    ['an unknown state', element({ state: 'archived' })],
    ['a missing first_seen_at', element({ first_seen_at: '' })],
  ])('skips %s before the batch is built, and warns', async (_label, bad) => {
    const s = state({ households: [household(HOUSEHOLD_A, [bad, element({ term: 'Thatha' })])] });
    const warn = vi.fn();

    const summary = await runBackfill({ client: buildFakeClient(s), logger: { warn } });

    expect(summary).toMatchObject({ skipped_invalid: 1, terms_inserted: 1 });
    expect(s.family_language_terms.map((r) => r.term)).toEqual(['Thatha']);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ skipped_invalid: 1 }),
      expect.stringContaining('constraint'),
    );
  });

  it('accepts text at exactly the 40-char limit and a zero usage_count', async () => {
    const exactly40 = 'x'.repeat(40);
    const s = state({
      households: [
        household(HOUSEHOLD_A, [element({ term: exactly40, maps_to: exactly40, usage_count: 0 })]),
      ],
    });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary).toMatchObject({ skipped_invalid: 0, terms_inserted: 1 });
  });

  it('tolerates a malformed or missing JSONB value instead of throwing', async () => {
    const s = state({
      households: [
        { id: HOUSEHOLD_A, preferred_family_language_terms: null },
        { id: HOUSEHOLD_B, preferred_family_language_terms: 42 },
        { id: HOUSEHOLD_C, preferred_family_language_terms: [element(), 'nope', null, ['x']] },
      ],
    });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary).toMatchObject({ households_scanned: 3, terms_inserted: 1 });
    expect(s.family_language_terms).toEqual([termRow(HOUSEHOLD_C)]);
  });

  it('parses a raw JSON string defensively', async () => {
    const s = state({
      households: [
        {
          id: HOUSEHOLD_A,
          preferred_family_language_terms: JSON.stringify([element()]),
        },
      ],
    });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary.terms_inserted).toBe(1);
    expect(s.family_language_terms[0]!.term).toBe('Nani');
  });

  it('collapses a duplicate term inside one household to a single row', async () => {
    const s = state({
      households: [household(HOUSEHOLD_A, [element(), element({ usage_count: 9 })])],
    });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary).toMatchObject({ skipped_duplicate: 1, terms_inserted: 1 });
    expect(s.family_language_terms).toHaveLength(1);
    expect(s.family_language_terms[0]!.usage_count).toBe(2);
  });

  it('keeps the same term in two households as two rows', async () => {
    const s = state({
      households: [household(HOUSEHOLD_A, [element()]), household(HOUSEHOLD_B, [element()])],
    });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary.terms_inserted).toBe(2);
    expect(s.family_language_terms.map((r) => r.household_id)).toEqual([
      HOUSEHOLD_A,
      HOUSEHOLD_B,
    ]);
  });

  it('is idempotent — a second run inserts nothing', async () => {
    const s = state({
      households: [household(HOUSEHOLD_A, [element(), element({ term: 'Thatha' })])],
    });
    const client = buildFakeClient(s);

    const first = await runBackfill({ client });
    const second = await runBackfill({ client });

    expect(first.terms_inserted).toBe(2);
    expect(second.terms_inserted).toBe(0);
    expect(second.skipped_existing).toBe(2);
    expect(s.family_language_terms).toHaveLength(2);
  });

  it('never clobbers a term a parent ratified through the RPC after an earlier run', async () => {
    // Writes already flipped to rows, so the JSONB source is stale: it still
    // says `candidate` while the live row is `active`. ON CONFLICT DO NOTHING
    // only ever adds — it must not demote the term back, which would break the
    // forward-only ratchet during the cutover itself.
    const ratifiedLive = termRow(HOUSEHOLD_A, { state: 'active', ratified_at: RATIFIED });
    const s = state({
      households: [household(HOUSEHOLD_A, [element()])],
      family_language_terms: [ratifiedLive],
    });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary.terms_inserted).toBe(0);
    expect(summary.skipped_existing).toBe(1);
    expect(s.family_language_terms).toEqual([ratifiedLive]);
  });

  it('walks every page — a small pageSize exercises the continuation loop', async () => {
    const s = state({
      households: [
        household(HOUSEHOLD_A, [element()]),
        household(HOUSEHOLD_B, [element()]),
        household(HOUSEHOLD_C, [element()]),
      ],
    });

    const summary = await runBackfill({ client: buildFakeClient(s), pageSize: 1 });

    expect(summary.households_scanned).toBe(3);
    expect(summary.terms_inserted).toBe(3);
    expect(s.family_language_terms.map((r) => r.household_id).sort()).toEqual([
      HOUSEHOLD_A,
      HOUSEHOLD_B,
      HOUSEHOLD_C,
    ]);
  });
});

describe('verifyParity', () => {
  it('passes once every element has its row', async () => {
    const s = state({
      households: [
        household(HOUSEHOLD_A, [element(), element({ term: 'Thatha' })]),
        household(HOUSEHOLD_B, []),
      ],
    });
    const client = buildFakeClient(s);
    await runBackfill({ client });

    const result = await verifyParity({ client });

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(2);
    expect(result.mismatches).toEqual([]);
  });

  it('passes when there is nothing to migrate at all', async () => {
    const result = await verifyParity({ client: buildFakeClient(state()) });

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(0);
  });

  it('fails with missing_term_row when the backfill has not run', async () => {
    const s = state({ households: [household(HOUSEHOLD_A, [element()])] });

    const result = await verifyParity({ client: buildFakeClient(s) });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      { household_id: HOUSEHOLD_A, maps_to: 'grandmother', reason: 'missing_term_row' },
    ]);
  });

  it('fails with orphan_term_row when a row has no surviving array element', async () => {
    const s = state({
      households: [household(HOUSEHOLD_A, [])],
      family_language_terms: [termRow(HOUSEHOLD_A)],
    });

    const result = await verifyParity({ client: buildFakeClient(s) });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      { household_id: HOUSEHOLD_A, maps_to: 'grandmother', reason: 'orphan_term_row' },
    ]);
  });

  it('fails with state_mismatch when the ratchet state did not survive the copy', async () => {
    // Existence-only parity would call this a clean cutover; it is an `active`
    // term landing as `candidate`, i.e. a forward-only invariant violation.
    const s = state({
      households: [household(HOUSEHOLD_A, [element({ state: 'active', ratified_at: RATIFIED })])],
      family_language_terms: [termRow(HOUSEHOLD_A, { state: 'candidate', ratified_at: RATIFIED })],
    });

    const result = await verifyParity({ client: buildFakeClient(s) });

    expect(result.ok).toBe(false);
    expect(result.matched).toBe(1);
    expect(result.mismatches).toEqual([
      { household_id: HOUSEHOLD_A, maps_to: 'grandmother', reason: 'state_mismatch' },
    ]);
  });

  it('fails with usage_count_mismatch when the counter diverged', async () => {
    const s = state({
      households: [household(HOUSEHOLD_A, [element({ usage_count: 7 })])],
      family_language_terms: [termRow(HOUSEHOLD_A, { usage_count: 2 })],
    });

    const result = await verifyParity({ client: buildFakeClient(s) });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      { household_id: HOUSEHOLD_A, maps_to: 'grandmother', reason: 'usage_count_mismatch' },
    ]);
  });

  it('fails with ratified_at_mismatch when the ratification timestamp did not survive the copy', async () => {
    const s = state({
      households: [
        household(HOUSEHOLD_A, [element({ state: 'active', ratified_at: RATIFIED })]),
      ],
      family_language_terms: [termRow(HOUSEHOLD_A, { state: 'active', ratified_at: null })],
    });

    const result = await verifyParity({ client: buildFakeClient(s) });

    expect(result.ok).toBe(false);
    expect(result.matched).toBe(1);
    expect(result.mismatches).toEqual([
      { household_id: HOUSEHOLD_A, maps_to: 'grandmother', reason: 'ratified_at_mismatch' },
    ]);
  });

  it('reports both value mismatches on one row', async () => {
    const s = state({
      households: [household(HOUSEHOLD_A, [element({ state: 'active', usage_count: 7 })])],
      family_language_terms: [termRow(HOUSEHOLD_A, { state: 'candidate', usage_count: 2 })],
    });

    const result = await verifyParity({ client: buildFakeClient(s) });

    expect(result.mismatches.map((m) => m.reason)).toEqual([
      'state_mismatch',
      'usage_count_mismatch',
    ]);
  });

  it('flags a constraint-violating element as missing_term_row so a human looks before the drop', async () => {
    const s = state({ households: [household(HOUSEHOLD_A, [element({ state: 'archived' })])] });
    const client = buildFakeClient(s);
    await runBackfill({ client });

    const result = await verifyParity({ client });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      { household_id: HOUSEHOLD_A, maps_to: 'grandmother', reason: 'missing_term_row' },
    ]);
  });

  it('treats an element with no term as nothing to migrate, not a mismatch', async () => {
    const s = state({ households: [household(HOUSEHOLD_A, [element({ term: '' })])] });
    const client = buildFakeClient(s);
    await runBackfill({ client });

    const result = await verifyParity({ client });

    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it('never prints the family-language term in the diff', async () => {
    const s = state({
      households: [household(HOUSEHOLD_A, [element({ term: 'Ammamma' })])],
      family_language_terms: [termRow(HOUSEHOLD_A, { term: 'Thatha', maps_to: 'grandfather' })],
    });

    const result = await verifyParity({ client: buildFakeClient(s) });

    expect(result.mismatches).toHaveLength(2);
    const printed = JSON.stringify(result.mismatches);
    expect(printed).not.toContain('Ammamma');
    expect(printed).not.toContain('Thatha');
  });

  it('walks every page of both sides', async () => {
    const s = state({
      households: [
        household(HOUSEHOLD_A, [element()]),
        household(HOUSEHOLD_B, [element()]),
        household(HOUSEHOLD_C, [element()]),
      ],
    });
    const client = buildFakeClient(s);
    await runBackfill({ client, pageSize: 1 });

    const result = await verifyParity({ client, pageSize: 1 });

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(3);
  });
});

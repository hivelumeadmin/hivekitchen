import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runBackfill, verifyParity } from './backfill-child-extra-rules.js';

const CHILD_A = '11111111-1111-4111-8111-111111111111';
const CHILD_B = '22222222-2222-4222-8222-222222222222';
const CHILD_C = '33333333-3333-4333-8333-333333333333';

interface ChildRow {
  id: string;
  extra_rules: unknown;
}

interface RuleRow {
  child_id: string;
  rule: 'pin' | 'ban';
  component_type: string;
}

interface FakeState {
  children: ChildRow[];
  child_extra_rules: RuleRow[];
}

function state(overrides: Partial<FakeState> = {}): FakeState {
  return { children: [], child_extra_rules: [], ...overrides };
}

function child(id: string, pins: string[], bans: string[]): ChildRow {
  return { id, extra_rules: { pins, bans } };
}

// In-memory Supabase double. Models exactly the operations the script issues:
//   children:          .select('id, extra_rules').order().range()
//   child_extra_rules: .select(...).order().range()
//   child_extra_rules: .upsert(rows, {onConflict, ignoreDuplicates}).select()
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
        // The DB unique index is (child_id, rule, component_type) — plain, not
        // functional — precisely so PostgREST can name it here.
        if (opts.onConflict !== 'child_id,rule,component_type') {
          throw new Error(`unexpected conflict target: ${String(opts.onConflict)}`);
        }
        if (opts.ignoreDuplicates !== true) {
          throw new Error('backfill must not clobber existing rule rows');
        }
        const inserted: Record<string, unknown>[] = [];
        for (const row of rows) {
          const exists = s.child_extra_rules.some(
            (r) =>
              r.child_id === row.child_id &&
              r.rule === row.rule &&
              r.component_type === row.component_type,
          );
          if (exists) continue; // ON CONFLICT DO NOTHING
          s.child_extra_rules.push(row as unknown as RuleRow);
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
  it('copies every pin and ban into its own row', async () => {
    const s = state({ children: [child(CHILD_A, ['fruit', 'grain'], ['sweet treat'])] });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary).toMatchObject({
      children_scanned: 1,
      rules_inserted: 3,
      skipped_existing: 0,
      skipped_empty: 0,
      skipped_too_long: 0,
    });
    expect(s.child_extra_rules).toEqual([
      { child_id: CHILD_A, rule: 'pin', component_type: 'fruit' },
      { child_id: CHILD_A, rule: 'pin', component_type: 'grain' },
      { child_id: CHILD_A, rule: 'ban', component_type: 'sweet treat' },
    ]);
  });

  it('preserves label casing verbatim — the unique key is case-sensitive by design', async () => {
    const s = state({ children: [child(CHILD_A, ['Fruit', 'fruit'], [])] });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary.rules_inserted).toBe(2);
    expect(s.child_extra_rules.map((r) => r.component_type)).toEqual(['Fruit', 'fruit']);
  });

  it('skips a child with empty pins and bans without inserting anything', async () => {
    const s = state({ children: [child(CHILD_A, [], []), child(CHILD_B, ['fruit'], [])] });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary).toMatchObject({ children_scanned: 2, rules_inserted: 1 });
    expect(s.child_extra_rules).toEqual([
      { child_id: CHILD_B, rule: 'pin', component_type: 'fruit' },
    ]);
  });

  it('skips a zero-length label and warns — nothing to migrate is not a row', async () => {
    const s = state({ children: [child(CHILD_A, ['', 'fruit'], [])] });
    const warn = vi.fn();

    const summary = await runBackfill({ client: buildFakeClient(s), logger: { warn } });

    expect(summary).toMatchObject({ skipped_empty: 1, rules_inserted: 1 });
    expect(s.child_extra_rules).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ skipped_empty: 1 }),
      expect.stringContaining('empty'),
    );
  });

  it('skips a label exceeding the 50-char CHECK and warns, without failing the batch', async () => {
    const tooLong = 'x'.repeat(51);
    const s = state({ children: [child(CHILD_A, [tooLong], ['sweet treat'])] });
    const warn = vi.fn();

    const summary = await runBackfill({ client: buildFakeClient(s), logger: { warn } });

    expect(summary).toMatchObject({ skipped_too_long: 1, rules_inserted: 1 });
    expect(s.child_extra_rules).toEqual([
      { child_id: CHILD_A, rule: 'ban', component_type: 'sweet treat' },
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ skipped_too_long: 1, max_length: 50 }),
      expect.stringContaining('exceeding'),
    );
  });

  it('accepts a label at exactly the 50-char limit', async () => {
    const exactly50 = 'x'.repeat(50);
    const s = state({ children: [child(CHILD_A, [exactly50], [])] });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary).toMatchObject({ skipped_too_long: 0, rules_inserted: 1 });
  });

  it('tolerates a malformed extra_rules value instead of throwing', async () => {
    const s = state({
      children: [
        { id: CHILD_A, extra_rules: null },
        { id: CHILD_B, extra_rules: 42 },
        { id: CHILD_C, extra_rules: { pins: ['fruit', 7, null], bans: 'nope' } },
      ],
    });
    const warn = vi.fn();

    const summary = await runBackfill({ client: buildFakeClient(s), logger: { warn } });

    expect(summary).toMatchObject({ children_scanned: 3, rules_inserted: 1 });
    expect(s.child_extra_rules).toEqual([
      { child_id: CHILD_C, rule: 'pin', component_type: 'fruit' },
    ]);
  });

  it('parses a raw JSON string defensively', async () => {
    const s = state({
      children: [{ id: CHILD_A, extra_rules: '{"pins":["fruit"],"bans":[]}' }],
    });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary.rules_inserted).toBe(1);
    expect(s.child_extra_rules[0]?.component_type).toBe('fruit');
  });

  it('collapses an exact duplicate inside one array to a single row', async () => {
    const s = state({ children: [child(CHILD_A, ['fruit', 'fruit'], [])] });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary).toMatchObject({ skipped_duplicate: 1, rules_inserted: 1 });
    expect(s.child_extra_rules).toHaveLength(1);
  });

  it('is idempotent — a second run inserts nothing', async () => {
    const s = state({ children: [child(CHILD_A, ['fruit'], ['candy'])] });
    const client = buildFakeClient(s);

    const first = await runBackfill({ client });
    const second = await runBackfill({ client });

    expect(first.rules_inserted).toBe(2);
    expect(second.rules_inserted).toBe(0);
    expect(second.skipped_existing).toBe(2);
    expect(s.child_extra_rules).toHaveLength(2);
  });

  it('never clobbers a row a human edited through PATCH after an earlier run', async () => {
    // The parent removed the 'fruit' pin and added 'grain' via PATCH; the JSONB
    // column is stale because writes already flipped to rows. A re-run must not
    // resurrect 'fruit' by overwriting — ON CONFLICT DO NOTHING only ever adds.
    const humanEdited: RuleRow = { child_id: CHILD_A, rule: 'pin', component_type: 'grain' };
    const s = state({
      children: [child(CHILD_A, ['grain'], [])],
      child_extra_rules: [humanEdited],
    });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary.rules_inserted).toBe(0);
    expect(s.child_extra_rules).toEqual([humanEdited]);
  });

  it('walks every page — a small pageSize exercises the continuation loop', async () => {
    const s = state({
      children: [child(CHILD_A, ['a'], []), child(CHILD_B, ['b'], []), child(CHILD_C, ['c'], [])],
    });

    const summary = await runBackfill({ client: buildFakeClient(s), pageSize: 1 });

    expect(summary.children_scanned).toBe(3);
    expect(summary.rules_inserted).toBe(3);
    expect(s.child_extra_rules.map((r) => r.child_id).sort()).toEqual([
      CHILD_A,
      CHILD_B,
      CHILD_C,
    ]);
  });
});

describe('verifyParity', () => {
  it('passes once every pin and ban has its row', async () => {
    const s = state({ children: [child(CHILD_A, ['fruit'], ['candy']), child(CHILD_B, [], [])] });
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

  it('fails with missing_rule_row when the backfill has not run', async () => {
    const s = state({ children: [child(CHILD_A, ['fruit'], [])] });

    const result = await verifyParity({ client: buildFakeClient(s) });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([{ child_id: CHILD_A, rule: 'pin', reason: 'missing_rule_row' }]);
  });

  it('fails with orphan_rule_row when a row has no surviving JSONB entry', async () => {
    const s = state({
      children: [child(CHILD_A, [], [])],
      child_extra_rules: [{ child_id: CHILD_A, rule: 'ban', component_type: 'candy' }],
    });

    const result = await verifyParity({ client: buildFakeClient(s) });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([{ child_id: CHILD_A, rule: 'ban', reason: 'orphan_rule_row' }]);
  });

  it('flags a too-long label as missing_rule_row so a human looks before the column drops', async () => {
    const s = state({ children: [child(CHILD_A, ['x'.repeat(51)], [])] });
    const client = buildFakeClient(s);
    await runBackfill({ client });

    const result = await verifyParity({ client });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([{ child_id: CHILD_A, rule: 'pin', reason: 'missing_rule_row' }]);
  });

  it('treats a zero-length label as nothing to migrate, not a mismatch', async () => {
    const s = state({ children: [child(CHILD_A, [''], [])] });
    const client = buildFakeClient(s);
    await runBackfill({ client });

    const result = await verifyParity({ client });

    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it('never prints the component_type in the diff', async () => {
    const s = state({ children: [child(CHILD_A, ['pomegranate seeds'], [])] });

    const result = await verifyParity({ client: buildFakeClient(s) });

    expect(JSON.stringify(result.mismatches)).not.toContain('pomegranate');
  });

  it('walks every page of both sides', async () => {
    const s = state({
      children: [child(CHILD_A, ['a'], []), child(CHILD_B, ['b'], []), child(CHILD_C, ['c'], [])],
    });
    const client = buildFakeClient(s);
    await runBackfill({ client, pageSize: 1 });

    const result = await verifyParity({ client, pageSize: 1 });

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(3);
  });
});

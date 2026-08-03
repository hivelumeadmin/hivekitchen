import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runBackfill, verifyParity } from './backfill-school-policy-notes.js';

const CHILD_A = '11111111-1111-4111-8111-111111111111';
const CHILD_B = '22222222-2222-4222-8222-222222222222';
const CHILD_C = '33333333-3333-4333-8333-333333333333';

const NOTE_TEXT = 'No microwave available — send cold lunches only.';

interface ChildRow {
  id: string;
  school_policy_notes: string | null;
}

interface PolicyRow {
  child_id: string;
  policy_type: string;
  policy_description: string | null;
  slot_scope: string;
  is_active: boolean;
}

interface FakeState {
  children: ChildRow[];
  school_policies: PolicyRow[];
}

function state(overrides: Partial<FakeState> = {}): FakeState {
  return { children: [], school_policies: [], ...overrides };
}

function child(id: string, notes: string | null): ChildRow {
  return { id, school_policy_notes: notes };
}

function notePolicy(childId: string, description: string | null = NOTE_TEXT): PolicyRow {
  return {
    child_id: childId,
    policy_type: 'note',
    policy_description: description,
    slot_scope: 'bag_wide',
    is_active: false,
  };
}

// In-memory Supabase double. Models the operations the script actually issues:
//   children:        .select().not('school_policy_notes','is',null).order().range()
//   school_policies: .select().eq('policy_type','note').order().range()
//   school_policies: .upsert(rows, {onConflict, ignoreDuplicates}).select()
// `range` slices so a small pageSize genuinely exercises the continuation loop.
function buildFakeClient(s: FakeState): SupabaseClient {
  const from = (table: keyof FakeState) => {
    const eqFilters: [string, unknown][] = [];
    let notNullCol: string | null = null;
    let range: [number, number] | null = null;
    const builder: Record<string, unknown> = {};

    const rowsForRead = (): Record<string, unknown>[] => {
      let out = (s[table] as Record<string, unknown>[]).filter((row) =>
        eqFilters.every(([col, value]) => row[col] === value),
      );
      if (notNullCol !== null) out = out.filter((row) => row[notNullCol as string] !== null);
      if (range !== null) out = out.slice(range[0], range[1] + 1);
      return out;
    };

    Object.assign(builder, {
      select: () => builder,
      order: () => builder,
      eq: (col: string, value: unknown) => {
        eqFilters.push([col, value]);
        return builder;
      },
      not: (col: string, op: string, value: unknown) => {
        if (op !== 'is' || value !== null) throw new Error(`unexpected not(${col}, ${op})`);
        notNullCol = col;
        return builder;
      },
      range: (a: number, b: number) => {
        range = [a, b];
        return builder;
      },
      upsert: (rows: Record<string, unknown>[], opts: Record<string, unknown>) => {
        if (opts.onConflict !== 'child_id,policy_type') {
          throw new Error(`unexpected conflict target: ${String(opts.onConflict)}`);
        }
        if (opts.ignoreDuplicates !== true) {
          throw new Error('backfill must not clobber an existing note row');
        }
        const inserted: Record<string, unknown>[] = [];
        for (const row of rows) {
          const exists = s.school_policies.some(
            (p) => p.child_id === row.child_id && p.policy_type === row.policy_type,
          );
          if (exists) continue; // ON CONFLICT DO NOTHING
          s.school_policies.push(row as unknown as PolicyRow);
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
  it('copies a note into an INACTIVE school_policies row (planner stays byte-identical)', async () => {
    const s = state({ children: [child(CHILD_A, NOTE_TEXT)] });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary).toMatchObject({
      children_scanned: 1,
      skipped_empty: 0,
      policies_inserted: 1,
      skipped_existing: 0,
    });
    expect(s.school_policies).toEqual([
      {
        child_id: CHILD_A,
        policy_type: 'note',
        policy_description: NOTE_TEXT,
        slot_scope: 'bag_wide',
        // The load-bearing bit: findActiveByChildId filters is_active=true, so
        // an inactive row never reaches the Kitchen Map or planner prompt.
        is_active: false,
      },
    ]);
  });

  it('trims the note text before storing it', async () => {
    const s = state({ children: [child(CHILD_A, `  ${NOTE_TEXT}\n`)] });

    await runBackfill({ client: buildFakeClient(s) });

    expect(s.school_policies[0]?.policy_description).toBe(NOTE_TEXT);
  });

  it('skips a whitespace-only note and warns — nothing to migrate is not a row', async () => {
    const s = state({ children: [child(CHILD_A, '   '), child(CHILD_B, NOTE_TEXT)] });
    const warn = vi.fn();

    const summary = await runBackfill({ client: buildFakeClient(s), logger: { warn } });

    expect(summary).toMatchObject({ children_scanned: 2, skipped_empty: 1, policies_inserted: 1 });
    expect(s.school_policies).toHaveLength(1);
    expect(s.school_policies[0]?.child_id).toBe(CHILD_B);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ skipped_empty: 1 });
  });

  it('is idempotent — a second run inserts nothing and preserves the existing row', async () => {
    const s = state({ children: [child(CHILD_A, NOTE_TEXT), child(CHILD_B, 'Nut-free table.')] });
    const client = buildFakeClient(s);

    const first = await runBackfill({ client });
    const second = await runBackfill({ client });

    expect(first.policies_inserted).toBe(2);
    expect(second.policies_inserted).toBe(0);
    expect(second.skipped_existing).toBe(2);
    expect(s.school_policies).toHaveLength(2);
  });

  it('never clobbers a note row a human already edited', async () => {
    // Post-backfill, a parent activated the row and rewrote the description.
    const edited: PolicyRow = {
      child_id: CHILD_A,
      policy_type: 'note',
      policy_description: 'Parent-edited wording',
      slot_scope: 'main',
      is_active: true,
    };
    const s = state({ children: [child(CHILD_A, NOTE_TEXT)], school_policies: [edited] });

    await runBackfill({ client: buildFakeClient(s) });

    expect(s.school_policies).toEqual([edited]);
  });

  it('walks every page — a small pageSize exercises the continuation loop', async () => {
    const s = state({
      children: [child(CHILD_A, 'a'), child(CHILD_B, 'b'), child(CHILD_C, 'c')],
    });

    const summary = await runBackfill({ client: buildFakeClient(s), pageSize: 1 });

    expect(summary.children_scanned).toBe(3);
    expect(summary.policies_inserted).toBe(3);
    expect(s.school_policies.map((p) => p.child_id).sort()).toEqual([CHILD_A, CHILD_B, CHILD_C]);
  });

  it('ignores children whose note is NULL (server-side filter)', async () => {
    const s = state({ children: [child(CHILD_A, null), child(CHILD_B, NOTE_TEXT)] });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary.children_scanned).toBe(1);
    expect(s.school_policies).toHaveLength(1);
  });

  it('skips a note exceeding the 500-char policy_description limit and warns, without failing the batch', async () => {
    const tooLong = 'x'.repeat(501);
    const s = state({ children: [child(CHILD_A, tooLong), child(CHILD_B, NOTE_TEXT)] });
    const warn = vi.fn();

    const summary = await runBackfill({ client: buildFakeClient(s), logger: { warn } });

    expect(summary).toMatchObject({
      children_scanned: 2,
      skipped_too_long: 1,
      policies_inserted: 1,
    });
    expect(s.school_policies).toHaveLength(1);
    expect(s.school_policies[0]?.child_id).toBe(CHILD_B);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ skipped_too_long: 1, max_length: 500 }),
      expect.stringContaining('exceeding'),
    );
  });

  it('accepts a note at exactly the 500-char limit', async () => {
    const exactly500 = 'x'.repeat(500);
    const s = state({ children: [child(CHILD_A, exactly500)] });

    const summary = await runBackfill({ client: buildFakeClient(s) });

    expect(summary).toMatchObject({ skipped_too_long: 0, policies_inserted: 1 });
    expect(s.school_policies[0]?.policy_description).toBe(exactly500);
  });
});

describe('verifyParity', () => {
  it('passes once every non-empty note has its row', async () => {
    const s = state({ children: [child(CHILD_A, NOTE_TEXT), child(CHILD_B, null)] });
    const client = buildFakeClient(s);
    await runBackfill({ client });

    const result = await verifyParity({ client });

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(1);
    expect(result.mismatches).toEqual([]);
  });

  it('passes when there is nothing to migrate at all', async () => {
    const result = await verifyParity({ client: buildFakeClient(state()) });

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(0);
  });

  it('fails with missing_note_row when the backfill has not run', async () => {
    const s = state({ children: [child(CHILD_A, NOTE_TEXT)] });

    const result = await verifyParity({ client: buildFakeClient(s) });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([{ child_id: CHILD_A, reason: 'missing_note_row' }]);
  });

  it('fails with orphan_note_row when a note row has no surviving source text', async () => {
    // The note was cleared through the API after the backfill ran.
    const s = state({ children: [child(CHILD_A, null)], school_policies: [notePolicy(CHILD_A)] });

    const result = await verifyParity({ client: buildFakeClient(s) });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([{ child_id: CHILD_A, reason: 'orphan_note_row' }]);
  });

  it('treats a whitespace-only note as nothing to migrate, not a mismatch', async () => {
    const result = await verifyParity({ client: buildFakeClient(state({ children: [child(CHILD_A, '  ')] })) });

    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it('flags a too-long note as missing_note_row so a human looks before the column drops', async () => {
    const tooLong = 'x'.repeat(501);
    const s = state({ children: [child(CHILD_A, tooLong)] });
    await runBackfill({ client: buildFakeClient(s) });

    const result = await verifyParity({ client: buildFakeClient(s) });

    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([{ child_id: CHILD_A, reason: 'missing_note_row' }]);
  });

  it('never prints the note text in the diff', async () => {
    const s = state({ children: [child(CHILD_A, NOTE_TEXT)] });

    const result = await verifyParity({ client: buildFakeClient(s) });

    expect(JSON.stringify(result.mismatches)).not.toContain('microwave');
  });
});

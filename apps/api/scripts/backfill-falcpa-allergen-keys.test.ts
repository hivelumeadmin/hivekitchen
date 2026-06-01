import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runBackfill, type BackfillSummary } from './backfill-falcpa-allergen-keys.js';
import { encryptField, normalizedHash } from '../src/lib/envelope-encryption.js';

const HOUSEHOLD_A = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_B = '22222222-2222-4222-8222-222222222222';
const CHILD_A1 = '33333333-3333-4333-8333-333333333333';
const CHILD_A2 = '44444444-4444-4444-8444-444444444444';
const CHILD_B1 = '55555555-5555-4555-8555-555555555555';

interface FakeChildAllergenRow {
  id: string;
  household_id: string;
  child_id: string;
  allergen: string;
  allergen_hash: string;
  source: string;
  updated_at: string;
}

interface FakeHouseholdRow {
  id: string;
  declared_allergens: string | null;
}

interface FakeState {
  child_allergens: FakeChildAllergenRow[];
  households: FakeHouseholdRow[];
}

function makeState(opts: Partial<FakeState> = {}): FakeState {
  return {
    child_allergens: [],
    households: [],
    ...opts,
  };
}

function caRow(
  id: string,
  household_id: string,
  child_id: string,
  plaintextAllergen: string,
  source = 'onboarding_declared',
): FakeChildAllergenRow {
  return {
    id,
    household_id,
    child_id,
    allergen: encryptField(plaintextAllergen, null),
    allergen_hash: normalizedHash(plaintextAllergen),
    source,
    updated_at: '2026-05-01T00:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------
// Fake Supabase client
//
// Supports the exact query shapes the backfill script issues:
//
// child_allergens paginated scan (keyset):
//   .select('id, household_id, child_id, allergen, allergen_hash')
//   [.gt('id', lastId)]
//   .order('id', { ascending: true })
//   .limit(pageSize)
//
// child_allergens canonical-row lookup:
//   .select('id')
//   .eq('child_id', X).eq('household_id', Y).eq('allergen_hash', Z)
//   .maybeSingle()
//
// child_allergens update / delete (single-row by id)
//
// households paginated scan (keyset):
//   .select('id, declared_allergens')
//   .not('declared_allergens', 'is', null)
//   [.gt('id', lastId)]
//   .order('id', { ascending: true })
//   .limit(pageSize)
//
// households update (single-row by id)
// client.rpc('bump_kitchen_map_version_for_household', { p_household_id })
// ---------------------------------------------------------------------------

function buildFakeClient(state: FakeState): {
  client: SupabaseClient;
  rpcCalls: Array<{ name: string; params: Record<string, unknown> }>;
} {
  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];

  function childAllergensTable() {
    return {
      select(_cols: string) {
        const chain = {
          _eqFilters: {} as Record<string, string>,
          _gtId: undefined as string | undefined,
          eq(col: string, val: string) {
            chain._eqFilters[col] = val;
            return chain;
          },
          gt(col: string, val: string) {
            if (col === 'id') chain._gtId = val;
            return chain;
          },
          order(_col: string, _opts?: unknown) {
            return chain;
          },
          limit(n: number) {
            let rows = state.child_allergens;
            if (chain._gtId !== undefined) {
              const gt = chain._gtId;
              rows = rows.filter((r) => r.id > gt);
            }
            for (const [col, val] of Object.entries(chain._eqFilters)) {
              rows = rows.filter(
                (r) => (r as unknown as Record<string, unknown>)[col] === val,
              );
            }
            const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
            return Promise.resolve({ data: sorted.slice(0, n), error: null });
          },
          maybeSingle() {
            const match = state.child_allergens.find((r) =>
              Object.entries(chain._eqFilters).every(
                ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
              ),
            );
            return Promise.resolve({
              data: match ? { id: match.id } : null,
              error: null,
            });
          },
        };
        return chain;
      },
      update(payload: Record<string, unknown>) {
        return {
          eq(_col: string, id: string) {
            const row = state.child_allergens.find((r) => r.id === id);
            if (row) {
              if (typeof payload['allergen'] === 'string') row.allergen = payload['allergen'];
              if (typeof payload['allergen_hash'] === 'string')
                row.allergen_hash = payload['allergen_hash'];
              if (typeof payload['updated_at'] === 'string')
                row.updated_at = payload['updated_at'];
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
      delete() {
        return {
          eq(_col: string, id: string) {
            const idx = state.child_allergens.findIndex((r) => r.id === id);
            if (idx >= 0) state.child_allergens.splice(idx, 1);
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };
  }

  function householdsTable() {
    return {
      select(_cols: string) {
        const chain = {
          _nonNullDeclared: false,
          _gtId: undefined as string | undefined,
          not(col: string, op: string, val: unknown) {
            if (col === 'declared_allergens' && op === 'is' && val === null) {
              chain._nonNullDeclared = true;
            }
            return chain;
          },
          gt(col: string, val: string) {
            if (col === 'id') chain._gtId = val;
            return chain;
          },
          order(_c: string, _o?: unknown) {
            return chain;
          },
          limit(n: number) {
            let rows = chain._nonNullDeclared
              ? state.households.filter((h) => h.declared_allergens !== null)
              : state.households;
            if (chain._gtId !== undefined) {
              const gt = chain._gtId;
              rows = rows.filter((h) => h.id > gt);
            }
            const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
            return Promise.resolve({ data: sorted.slice(0, n), error: null });
          },
        };
        return chain;
      },
      update(payload: Record<string, unknown>) {
        return {
          eq(_col: string, id: string) {
            const row = state.households.find((r) => r.id === id);
            if (row && typeof payload['declared_allergens'] === 'string') {
              row.declared_allergens = payload['declared_allergens'];
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };
  }

  const client = {
    from(table: string) {
      if (table === 'child_allergens') return childAllergensTable();
      if (table === 'households') return householdsTable();
      throw new Error(`unexpected table: ${table}`);
    },
    rpc(name: string, params: Record<string, unknown>) {
      rpcCalls.push({ name, params });
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;

  return { client, rpcCalls };
}

function silentLogger() {
  return { info: vi.fn(), error: vi.fn() };
}

describe('runBackfill (pre-4-s0 FALCPA synonym alignment)', () => {
  it('normalizes stale "eggs" → "egg" and "tree-nuts" → "tree_nut" in child_allergens', async () => {
    const state = makeState({
      child_allergens: [
        caRow('row-1', HOUSEHOLD_A, CHILD_A1, 'eggs'),
        caRow('row-2', HOUSEHOLD_A, CHILD_A1, 'tree-nuts'),
        caRow('row-3', HOUSEHOLD_A, CHILD_A2, 'peanut'), // already canonical
      ],
    });
    const { client } = buildFakeClient(state);

    const summary = await runBackfill({
      client,
      kek: null,
      dryRun: false,
      logger: silentLogger(),
    });

    expect(summary.rows_scanned).toBe(3);
    expect(summary.rows_updated).toBe(2);
    expect(summary.rows_skipped).toBe(1);
    expect(summary.rows_deleted_dup).toBe(0);
    expect(summary.decrypt_failures).toBe(0);

    // Verify on-disk state.
    const row1 = state.child_allergens.find((r) => r.id === 'row-1');
    const row2 = state.child_allergens.find((r) => r.id === 'row-2');
    const row3 = state.child_allergens.find((r) => r.id === 'row-3');
    expect(row1?.allergen_hash).toBe(normalizedHash('egg'));
    expect(row2?.allergen_hash).toBe(normalizedHash('tree_nut'));
    // Unchanged row keeps its original hash.
    expect(row3?.allergen_hash).toBe(normalizedHash('peanut'));
  });

  it('is idempotent — second run after first writes no further updates', async () => {
    const state = makeState({
      child_allergens: [caRow('row-1', HOUSEHOLD_A, CHILD_A1, 'eggs')],
    });
    const { client } = buildFakeClient(state);

    await runBackfill({ client, kek: null, dryRun: false, logger: silentLogger() });
    const summary2 = await runBackfill({
      client,
      kek: null,
      dryRun: false,
      logger: silentLogger(),
    });

    expect(summary2.rows_scanned).toBe(1);
    expect(summary2.rows_updated).toBe(0);
    expect(summary2.rows_skipped).toBe(1);
  });

  it('--dry-run logs would_update but does not write', async () => {
    const state = makeState({
      child_allergens: [caRow('row-1', HOUSEHOLD_A, CHILD_A1, 'eggs')],
    });
    const { client } = buildFakeClient(state);
    const logger = silentLogger();

    const summary = await runBackfill({ client, kek: null, dryRun: true, logger });

    expect(summary.rows_updated).toBe(1);
    // Plaintext row unchanged on the in-memory state.
    expect(state.child_allergens[0]?.allergen_hash).toBe(normalizedHash('eggs'));
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'eggs', to: 'egg' }),
      'would_update child_allergens row',
    );
  });

  it('--dry-run correctly reports would_delete_stale_dup when canonical row exists', async () => {
    // P4: dry-run must perform the existence check so the operator sees
    // accurate delete vs update counts before authorising the live run.
    const state = makeState({
      child_allergens: [
        caRow('row-canonical', HOUSEHOLD_A, CHILD_A1, 'egg'),
        caRow('row-stale', HOUSEHOLD_A, CHILD_A1, 'eggs'),
      ],
    });
    const { client } = buildFakeClient(state);
    const logger = silentLogger();

    const summary = await runBackfill({ client, kek: null, dryRun: true, logger });

    expect(summary.rows_deleted_dup).toBe(1);
    expect(summary.rows_updated).toBe(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ row_id: 'row-stale' }),
      'would_delete_stale_dup',
    );
    // State is untouched in dry-run.
    expect(state.child_allergens.map((r) => r.id)).toContain('row-stale');
  });

  it('deletes the stale row when canonical row already exists for same child', async () => {
    // Parent declared 'egg' separately; the legacy 'eggs' row now collides.
    const state = makeState({
      child_allergens: [
        caRow('row-canonical', HOUSEHOLD_A, CHILD_A1, 'egg'),
        caRow('row-stale', HOUSEHOLD_A, CHILD_A1, 'eggs'),
      ],
    });
    const { client } = buildFakeClient(state);

    const summary = await runBackfill({
      client,
      kek: null,
      dryRun: false,
      logger: silentLogger(),
    });

    expect(summary.rows_deleted_dup).toBe(1);
    expect(summary.rows_updated).toBe(0);
    expect(state.child_allergens.map((r) => r.id)).toEqual(['row-canonical']);
  });

  it('normalizes households.declared_allergens arrays in-place and bumps kitchen_map_version', async () => {
    const state = makeState({
      households: [
        {
          id: HOUSEHOLD_A,
          declared_allergens: encryptField(['eggs', 'peanut', 'tree-nuts'], null),
        },
        {
          id: HOUSEHOLD_B,
          declared_allergens: encryptField(['dairy', 'sesame'], null), // already canonical
        },
      ],
    });
    const { client, rpcCalls } = buildFakeClient(state);

    const summary = await runBackfill({
      client,
      kek: null,
      dryRun: false,
      logger: silentLogger(),
    });

    expect(summary.households_scanned).toBe(2);
    expect(summary.households_updated).toBe(1);

    const a = state.households.find((h) => h.id === HOUSEHOLD_A);
    expect(a?.declared_allergens).toBe(encryptField(['egg', 'peanut', 'tree_nut'], null));
    // Household B untouched.
    const b = state.households.find((h) => h.id === HOUSEHOLD_B);
    expect(b?.declared_allergens).toBe(encryptField(['dairy', 'sesame'], null));

    // P5: kitchen_map_version must be bumped for the updated household only.
    expect(
      rpcCalls.filter(
        (c) =>
          c.name === 'bump_kitchen_map_version_for_household' &&
          c.params['p_household_id'] === HOUSEHOLD_A,
      ),
    ).toHaveLength(1);
    expect(
      rpcCalls.filter((c) => c.params['p_household_id'] === HOUSEHOLD_B),
    ).toHaveLength(0);
  });

  it('de-duplicates declared_allergens arrays when normalization collapses entries', async () => {
    const state = makeState({
      households: [
        {
          id: HOUSEHOLD_A,
          declared_allergens: encryptField(['eggs', 'egg', 'peanut'], null),
        },
      ],
    });
    const { client } = buildFakeClient(state);

    const summary = await runBackfill({
      client,
      kek: null,
      dryRun: false,
      logger: silentLogger(),
    });

    expect(summary.households_updated).toBe(1);
    expect(state.households[0]?.declared_allergens).toBe(
      encryptField(['egg', 'peanut'], null),
    );
  });

  it('deduplicates pre-existing duplicate canonical entries in declared_allergens', async () => {
    // P7: ['egg','egg','peanut'] has no stale keys but contains a duplicate.
    // The backfill must still collapse it to ['egg','peanut'].
    const state = makeState({
      households: [
        {
          id: HOUSEHOLD_A,
          declared_allergens: encryptField(['egg', 'egg', 'peanut'], null),
        },
      ],
    });
    const { client, rpcCalls } = buildFakeClient(state);

    const summary = await runBackfill({
      client,
      kek: null,
      dryRun: false,
      logger: silentLogger(),
    });

    expect(summary.households_updated).toBe(1);
    expect(state.households[0]?.declared_allergens).toBe(
      encryptField(['egg', 'peanut'], null),
    );
    expect(
      rpcCalls.filter((c) => c.name === 'bump_kitchen_map_version_for_household'),
    ).toHaveLength(1);
  });

  it('paginates child_allergens beyond a single page', async () => {
    const state = makeState({
      child_allergens: [
        caRow('row-1', HOUSEHOLD_A, CHILD_A1, 'eggs'),
        caRow('row-2', HOUSEHOLD_A, CHILD_A2, 'tree-nuts'),
        caRow('row-3', HOUSEHOLD_B, CHILD_B1, 'eggs'),
      ],
    });
    const { client } = buildFakeClient(state);

    const summary = await runBackfill({
      client,
      kek: null,
      dryRun: false,
      pageSize: 2,
      logger: silentLogger(),
    });

    expect(summary.rows_scanned).toBe(3);
    expect(summary.rows_updated).toBe(3);
  });

  it('skips households whose declared_allergens decrypt to a non-array (defensive)', async () => {
    // Construct ciphertext for a non-array JSON value (boolean) — exercises
    // the runtime Array.isArray guard on decrypted output.
    const state = makeState({
      households: [
        {
          id: HOUSEHOLD_A,
          declared_allergens: encryptField(true as unknown as string[], null),
        },
      ],
    });
    const { client } = buildFakeClient(state);
    const logger = silentLogger();

    const summary: BackfillSummary = await runBackfill({
      client,
      kek: null,
      dryRun: false,
      logger,
    });

    expect(summary.households_updated).toBe(0);
    expect(summary.decrypt_failures).toBe(1);
    expect(logger.error).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runBackfill } from './backfill-child-allergens.js';
import { ChildAllergensRepository } from '../src/modules/children/child-allergens.repository.js';
import { encryptField } from '../src/lib/envelope-encryption.js';

const HOUSEHOLD_A = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_B = '22222222-2222-4222-8222-222222222222';
const CHILD_A1 = '33333333-3333-4333-8333-333333333333';
const CHILD_A2 = '44444444-4444-4444-8444-444444444444';
const CHILD_B1 = '55555555-5555-4555-8555-555555555555';
const ALLERGEN_ROW_ID_PREFIX = 'aaaaaaaa-aaaa-4aaa-8aaa-';

// In-memory store of legacy children rows + the resulting child_allergens
// state. NOOP encryption is used end-to-end (kek=null) so the script reads
// `NOOP:<base64-json>` strings and the repository's upsert path also uses the
// NOOP envelope.
interface FakeChildRow {
  id: string;
  household_id: string;
  // String (NOOP-prefixed JSON) or null (no legacy entry).
  declared_allergens: string | null;
}

interface FakeAllergenRow {
  id: string;
  household_id: string;
  child_id: string;
  allergen_hash: string;
  source: string;
  created_at: string;
  updated_at: string;
}

interface FakeState {
  households: string[];
  children: FakeChildRow[];
  allergens: FakeAllergenRow[];
  // Force the next decryptField call for this child_id to look corrupt by
  // replacing its ciphertext with junk.
  corruptedChildIds: Set<string>;
  // Counter that becomes the (id, created_at, updated_at) of the next inserted
  // allergen row.
  nextAllergenSerial: number;
}

function buildFakeClient(state: FakeState): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'households') return householdsTable(state);
      if (table === 'children') return childrenTable(state);
      if (table === 'child_allergens') return childAllergensTable(state);
      throw new Error(`unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;
}

function householdsTable(state: FakeState) {
  return {
    select() {
      // Pagination: .select('id').range(from, to). Return only the slice.
      return {
        range(from: number, to: number) {
          const slice = state.households.slice(from, to + 1).map((id) => ({ id }));
          return Promise.resolve({ data: slice, error: null });
        },
      };
    },
  };
}

function childrenTable(state: FakeState) {
  return {
    select() {
      return {
        eq(_col: string, householdId: string) {
          const rows = state.children
            .filter((c) => c.household_id === householdId)
            .map((c) => {
              if (state.corruptedChildIds.has(c.id) && c.declared_allergens !== null) {
                // Replace ciphertext with a value that will fail decryptField.
                // A non-NOOP-prefixed garbage string with dek=null throws.
                return { id: c.id, declared_allergens: 'NOT_DECRYPTABLE_NOR_NOOP' };
              }
              return { id: c.id, declared_allergens: c.declared_allergens };
            });
          return Promise.resolve({ data: rows, error: null });
        },
      };
    },
  };
}

function childAllergensTable(state: FakeState) {
  return {
    upsert(payload: Record<string, unknown>, opts: { onConflict?: string; ignoreDuplicates?: boolean }) {
      // Mirrors ChildAllergensRepository.declare's chain: upsert(...).select(...).maybeSingle()
      const child_id = payload.child_id as string;
      const allergen_hash = payload.allergen_hash as string;
      const household_id = payload.household_id as string;
      const source = payload.source as string;
      // Advance by 2s per call so the (updated_at - created_at) delta on the
      // conflict-update path crosses the > 1000ms threshold that
      // ChildAllergensRepository.declare uses to infer was_existing=true.
      const now = new Date(
        Date.parse('2026-05-24T10:00:00.000Z') + state.nextAllergenSerial * 2000,
      ).toISOString();

      // onConflict='child_id,allergen_hash' is the contract — verify the
      // mock is being driven correctly.
      expect(opts.onConflict).toBe('child_id,allergen_hash');

      const existing = state.allergens.find(
        (a) => a.child_id === child_id && a.allergen_hash === allergen_hash,
      );

      let returnData: { id: string; created_at: string; updated_at: string } | null;
      if (existing) {
        if (opts.ignoreDuplicates) {
          // ON CONFLICT DO NOTHING — row unchanged; PostgREST returns null.
          returnData = null;
        } else {
          // ON CONFLICT DO UPDATE — bump updated_at and source.
          existing.updated_at = now;
          existing.source = source;
          returnData = { id: existing.id, created_at: existing.created_at, updated_at: existing.updated_at };
        }
      } else {
        const row: FakeAllergenRow = {
          id: ALLERGEN_ROW_ID_PREFIX + String(state.nextAllergenSerial).padStart(12, '0'),
          household_id,
          child_id,
          allergen_hash,
          source,
          created_at: now,
          updated_at: now,
        };
        state.allergens.push(row);
        returnData = { id: row.id, created_at: row.created_at, updated_at: row.updated_at };
      }
      state.nextAllergenSerial += 1;

      return {
        select() {
          return {
            maybeSingle: () => Promise.resolve({ data: returnData, error: null }),
          };
        },
      };
    },
  };
}

function makeState(opts: Partial<FakeState> = {}): FakeState {
  return {
    households: [],
    children: [],
    allergens: [],
    corruptedChildIds: new Set(),
    nextAllergenSerial: 0,
    ...opts,
  };
}

describe('runBackfill (2.6-s8)', () => {
  it('migrates legacy declared_allergens into child_allergens with source=backfill_migration', async () => {
    const state = makeState({
      households: [HOUSEHOLD_A],
      children: [
        {
          id: CHILD_A1,
          household_id: HOUSEHOLD_A,
          declared_allergens: encryptField(['kiwi', 'mustard'], null),
        },
      ],
    });
    const client = buildFakeClient(state);
    const repo = new ChildAllergensRepository(client, null);

    const summary = await runBackfill({ client, kek: null, repo, logger: silentLogger() });

    expect(summary.households_scanned).toBe(1);
    expect(summary.children_scanned).toBe(1);
    expect(summary.allergens_migrated).toBe(2);
    expect(summary.skipped_existing).toBe(0);
    expect(summary.decrypt_failures).toBe(0);

    // Two rows in child_allergens for this child, both with backfill_migration.
    const rowsForChild = state.allergens.filter((a) => a.child_id === CHILD_A1);
    expect(rowsForChild).toHaveLength(2);
    expect(rowsForChild.every((r) => r.source === 'backfill_migration')).toBe(true);
    expect(rowsForChild.every((r) => r.household_id === HOUSEHOLD_A)).toBe(true);
  });

  it('is idempotent — second run produces no new rows, only skipped_existing increments', async () => {
    const state = makeState({
      households: [HOUSEHOLD_A],
      children: [
        {
          id: CHILD_A1,
          household_id: HOUSEHOLD_A,
          declared_allergens: encryptField(['kiwi'], null),
        },
      ],
    });
    const client = buildFakeClient(state);
    const repo = new ChildAllergensRepository(client, null);

    await runBackfill({ client, kek: null, repo, logger: silentLogger() });
    const before = state.allergens.length;
    expect(before).toBe(1);

    const summary2 = await runBackfill({ client, kek: null, repo, logger: silentLogger() });

    expect(state.allergens.length).toBe(before); // no new rows
    expect(summary2.allergens_migrated).toBe(0);
    expect(summary2.skipped_existing).toBe(1);
  });

  it('child with empty legacy array writes no rows', async () => {
    const state = makeState({
      households: [HOUSEHOLD_A],
      children: [
        {
          id: CHILD_A1,
          household_id: HOUSEHOLD_A,
          declared_allergens: encryptField([], null),
        },
      ],
    });
    const client = buildFakeClient(state);
    const repo = new ChildAllergensRepository(client, null);

    const summary = await runBackfill({ client, kek: null, repo, logger: silentLogger() });

    expect(summary.allergens_migrated).toBe(0);
    expect(summary.skipped_existing).toBe(0);
    expect(summary.decrypt_failures).toBe(0);
    expect(state.allergens).toHaveLength(0);
  });

  it('skips children with NULL declared_allergens entirely', async () => {
    const state = makeState({
      households: [HOUSEHOLD_A],
      children: [
        { id: CHILD_A1, household_id: HOUSEHOLD_A, declared_allergens: null },
      ],
    });
    const client = buildFakeClient(state);
    const repo = new ChildAllergensRepository(client, null);

    const summary = await runBackfill({ client, kek: null, repo, logger: silentLogger() });

    expect(summary.children_scanned).toBe(1);
    expect(summary.allergens_migrated).toBe(0);
    expect(summary.decrypt_failures).toBe(0);
  });

  it('per-child decrypt failure increments decrypt_failures, logs, and continues with remaining children', async () => {
    const state = makeState({
      households: [HOUSEHOLD_A],
      children: [
        {
          id: CHILD_A1,
          household_id: HOUSEHOLD_A,
          declared_allergens: encryptField(['peanut'], null),
        },
        {
          id: CHILD_A2,
          household_id: HOUSEHOLD_A,
          declared_allergens: encryptField(['shellfish'], null),
        },
      ],
      corruptedChildIds: new Set([CHILD_A1]),
    });
    const client = buildFakeClient(state);
    const repo = new ChildAllergensRepository(client, null);
    const logger = recordingLogger();

    const summary = await runBackfill({ client, kek: null, repo, logger });

    expect(summary.children_scanned).toBe(2);
    expect(summary.decrypt_failures).toBe(1);
    expect(summary.allergens_migrated).toBe(1);
    // The corrupt child contributes zero rows; the healthy one is migrated.
    expect(state.allergens.filter((a) => a.child_id === CHILD_A1)).toHaveLength(0);
    expect(state.allergens.filter((a) => a.child_id === CHILD_A2)).toHaveLength(1);

    expect(logger.calls.length).toBeGreaterThan(0);
    expect(logger.calls[0]?.obj).toMatchObject({
      household_id: HOUSEHOLD_A,
      child_id: CHILD_A1,
    });
  });

  it('paginates households across pages with the configured pageSize', async () => {
    // 3 households + pageSize=2 → first page returns 2, second page returns 1.
    // Validates that the script keeps reading until the page returns < pageSize.
    const state = makeState({
      households: [HOUSEHOLD_A, HOUSEHOLD_B, '66666666-6666-4666-8666-666666666666'],
      children: [
        {
          id: CHILD_A1,
          household_id: HOUSEHOLD_A,
          declared_allergens: encryptField(['kiwi'], null),
        },
        {
          id: CHILD_B1,
          household_id: HOUSEHOLD_B,
          declared_allergens: encryptField(['mustard'], null),
        },
      ],
    });
    const client = buildFakeClient(state);
    const repo = new ChildAllergensRepository(client, null);

    const summary = await runBackfill({
      client,
      kek: null,
      repo,
      pageSize: 2,
      logger: silentLogger(),
    });

    expect(summary.households_scanned).toBe(3);
    expect(summary.allergens_migrated).toBe(2);
  });
});

function silentLogger() {
  return { error: vi.fn() };
}

function recordingLogger() {
  const calls: Array<{ obj: Record<string, unknown>; msg: string }> = [];
  return {
    calls,
    error: (obj: Record<string, unknown>, msg: string) => {
      calls.push({ obj, msg });
    },
  };
}

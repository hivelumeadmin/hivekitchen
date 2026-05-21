import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FoodPreferencesRepository } from './food-preferences.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const FOOD_PREF_ROW_ID = '88888888-8888-4888-8888-888888888888';

interface Step {
  op: string;
  table?: string;
  args: unknown[];
}

function buildClient(opts: {
  upsertResult: { data: unknown; error: unknown };
}): { client: SupabaseClient; steps: Step[] } {
  const steps: Step[] = [];
  let currentTable: string | null = null;

  const builder: Record<string, unknown> = {};
  builder.upsert = (...args: unknown[]) => {
    steps.push({ op: 'upsert', table: currentTable ?? undefined, args });
    return builder;
  };
  builder.select = (...args: unknown[]) => {
    steps.push({ op: 'select', table: currentTable ?? undefined, args });
    return builder;
  };
  builder.maybeSingle = () => Promise.resolve(opts.upsertResult);

  const fromMock = vi.fn((table: string) => {
    currentTable = table;
    steps.push({ op: 'from', table, args: [] });
    return builder;
  });

  const client = { from: fromMock } as unknown as SupabaseClient;
  return { client, steps };
}

/**
 * Builds a mock client for the 42P10 fallback path:
 *   upsert (call 1) → 42P10 error
 *   insert (call 2) → success OR 23505 error
 *   select (call 3) → existing row
 *   update (call 4) → success (no-op)
 */
function buildFallbackClient(opts: {
  insertResult: { data: unknown; error: unknown };
  selectResult: { data: unknown; error: unknown };
}): { client: SupabaseClient; ops: string[] } {
  const ops: string[] = [];
  let callCount = 0;

  const upsertBuilder: Record<string, unknown> = {};
  upsertBuilder.upsert = (..._args: unknown[]) => {
    ops.push('upsert');
    return upsertBuilder;
  };
  upsertBuilder.select = (..._args: unknown[]) => {
    ops.push('upsert.select');
    return upsertBuilder;
  };
  upsertBuilder.maybeSingle = () =>
    Promise.resolve({ data: null, error: { code: '42P10', message: 'no unique constraint' } });

  const insertBuilder: Record<string, unknown> = {};
  insertBuilder.insert = (..._args: unknown[]) => {
    ops.push('insert');
    return insertBuilder;
  };
  insertBuilder.select = (..._args: unknown[]) => {
    ops.push('insert.select');
    return insertBuilder;
  };
  insertBuilder.maybeSingle = () => Promise.resolve(opts.insertResult);

  const selectBuilder: Record<string, unknown> = {};
  selectBuilder.select = (..._args: unknown[]) => {
    ops.push('select');
    return selectBuilder;
  };
  selectBuilder.eq = (..._args: unknown[]) => selectBuilder;
  selectBuilder.is = (..._args: unknown[]) => selectBuilder;
  selectBuilder.maybeSingle = () => Promise.resolve(opts.selectResult);

  const updateBuilder: Record<string, unknown> = {};
  updateBuilder.update = (..._args: unknown[]) => {
    ops.push('update');
    return updateBuilder;
  };
  updateBuilder.eq = (..._args: unknown[]) => updateBuilder;
  updateBuilder.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });

  const fromMock = vi.fn((_table: string) => {
    callCount += 1;
    if (callCount === 1) return upsertBuilder;
    if (callCount === 2) return insertBuilder;
    if (callCount === 3) return selectBuilder;
    return updateBuilder;
  });

  const client = { from: fromMock } as unknown as SupabaseClient;
  return { client, ops };
}

describe('FoodPreferencesRepository.declare', () => {
  it('encrypts item and inserts household-scoped row (child_id=null)', async () => {
    const now = new Date().toISOString();
    const { client, steps } = buildClient({
      upsertResult: {
        data: { id: FOOD_PREF_ROW_ID, created_at: now, updated_at: now },
        error: null,
      },
    });
    const repo = new FoodPreferencesRepository(client, null);

    const result = await repo.declare(
      HOUSEHOLD_ID,
      null,
      'ras malai',
      'loves',
      'soft',
      'onboarding_declared',
    );

    expect(result.food_preference_id).toBe(FOOD_PREF_ROW_ID);
    expect(result.was_existing).toBe(false);

    const fromStep = steps.find((s) => s.op === 'from');
    expect(fromStep?.table).toBe('food_preferences');

    const upsertStep = steps.find((s) => s.op === 'upsert');
    const payload = upsertStep?.args[0] as Record<string, unknown>;
    const opts = upsertStep?.args[1] as Record<string, unknown>;
    expect(payload.household_id).toBe(HOUSEHOLD_ID);
    expect(payload.child_id).toBeNull();
    expect(payload.valence).toBe('loves');
    expect(payload.enforcement).toBe('soft');
    expect(payload.source).toBe('onboarding_declared');
    // Plaintext must NOT be stored — even under kek=null the NOOP-prefixed
    // base64 envelope is used.
    expect(typeof payload.item).toBe('string');
    expect(payload.item).not.toBe('ras malai');
    // item_hash is SHA-256 hex (64 chars) of lower(trim('ras malai')).
    expect(typeof payload.item_hash).toBe('string');
    expect((payload.item_hash as string).length).toBe(64);
    expect(opts.onConflict).toBe('household_id,child_id,item_hash');
  });

  it('inserts child-scoped row (child_id set); returns the food_preference id', async () => {
    const now = new Date().toISOString();
    const { client, steps } = buildClient({
      upsertResult: {
        data: { id: FOOD_PREF_ROW_ID, created_at: now, updated_at: now },
        error: null,
      },
    });
    const repo = new FoodPreferencesRepository(client, null);

    const result = await repo.declare(
      HOUSEHOLD_ID,
      CHILD_ID,
      'mushrooms',
      'dislikes',
      'soft',
      'onboarding_declared',
    );

    expect(result.food_preference_id).toBe(FOOD_PREF_ROW_ID);
    const upsertStep = steps.find((s) => s.op === 'upsert');
    const payload = upsertStep?.args[0] as Record<string, unknown>;
    expect(payload.child_id).toBe(CHILD_ID);
    expect(payload.valence).toBe('dislikes');
  });

  it('returns was_existing=true when created_at and updated_at diverge (idempotent re-declare)', async () => {
    const created = '2026-05-20T10:00:00.000Z';
    const updated = '2026-05-20T10:00:05.000Z';
    const { client } = buildClient({
      upsertResult: {
        data: { id: FOOD_PREF_ROW_ID, created_at: created, updated_at: updated },
        error: null,
      },
    });
    const repo = new FoodPreferencesRepository(client, null);

    const result = await repo.declare(
      HOUSEHOLD_ID,
      null,
      'pasta',
      'loves',
      'soft',
      'onboarding_declared',
    );

    expect(result.was_existing).toBe(true);
    expect(result.food_preference_id).toBe(FOOD_PREF_ROW_ID);
  });

  it('throws on non-23505/42P10 Supabase errors', async () => {
    const { client } = buildClient({
      upsertResult: { data: null, error: { code: 'XX000', message: 'db down' } },
    });
    const repo = new FoodPreferencesRepository(client, null);

    await expect(
      repo.declare(HOUSEHOLD_ID, null, 'pasta', 'loves', 'soft', 'onboarding_declared'),
    ).rejects.toThrow(/food_preferences\.declare: db down/);
  });
});

describe('FoodPreferencesRepository.declare — 42P10 fallback path', () => {
  it('falls back to insert when upsert returns 42P10 (functional index incompatibility)', async () => {
    const { client, ops } = buildFallbackClient({
      insertResult: { data: { id: FOOD_PREF_ROW_ID }, error: null },
      selectResult: { data: null, error: null }, // not reached
    });
    const repo = new FoodPreferencesRepository(client, null);

    const result = await repo.declare(
      HOUSEHOLD_ID,
      null,
      'ras malai',
      'loves',
      'soft',
      'onboarding_declared',
    );

    expect(result.food_preference_id).toBe(FOOD_PREF_ROW_ID);
    expect(result.was_existing).toBe(false);
    expect(ops).toContain('upsert');
    expect(ops).toContain('insert');
  });

  it('falls back to select + update when 42P10 upsert AND 23505 insert race (idempotent)', async () => {
    const { client, ops } = buildFallbackClient({
      insertResult: { data: null, error: { code: '23505', message: 'unique violation' } },
      selectResult: { data: { id: FOOD_PREF_ROW_ID }, error: null },
    });
    const repo = new FoodPreferencesRepository(client, null);

    const result = await repo.declare(
      HOUSEHOLD_ID,
      null,
      'ras malai',
      'refuses',
      'strong',
      'onboarding_declared',
    );

    expect(result.food_preference_id).toBe(FOOD_PREF_ROW_ID);
    expect(result.was_existing).toBe(true);
    expect(ops).toContain('select');
    // valence/enforcement/source refreshed on the existing row so a re-declare
    // with stronger valence wins.
    expect(ops).toContain('update');
  });
});

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DietaryPreferencesRepository } from './dietary-preferences.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const DIETARY_ROW_ID = '33333333-3333-4333-8333-333333333333';

interface Step {
  op: string;
  args: unknown[];
}

function buildClient(opts: {
  upsertResult?: { data: unknown; error: unknown };
}): { client: SupabaseClient; steps: Step[] } {
  const steps: Step[] = [];
  const builder: Record<string, unknown> = {};
  builder.upsert = (...args: unknown[]) => {
    steps.push({ op: 'upsert', args });
    return builder;
  };
  builder.select = (...args: unknown[]) => {
    steps.push({ op: 'select', args });
    return builder;
  };
  builder.maybeSingle = () => Promise.resolve(opts.upsertResult ?? { data: null, error: null });

  const fromMock = vi.fn(() => builder);
  const client = { from: fromMock } as unknown as SupabaseClient;
  return { client, steps };
}

/**
 * Builds a mock client for the 42P10 fallback path:
 *   upsert → 42P10 error
 *   insert → success or 23505 error
 *   select → existing row
 *   update → success (no-op)
 */
function buildFallbackClient(opts: {
  insertResult: { data: unknown; error: unknown };
  selectResult: { data: unknown; error: unknown };
}): { client: SupabaseClient; ops: string[] } {
  const ops: string[] = [];
  let callCount = 0;

  const upsertBuilder: Record<string, unknown> = {};
  upsertBuilder.upsert = (..._args: unknown[]) => { ops.push('upsert'); return upsertBuilder; };
  upsertBuilder.select = (..._args: unknown[]) => { ops.push('upsert.select'); return upsertBuilder; };
  upsertBuilder.maybeSingle = () => Promise.resolve({ data: null, error: { code: '42P10', message: 'no unique constraint' } });

  const insertBuilder: Record<string, unknown> = {};
  insertBuilder.insert = (..._args: unknown[]) => { ops.push('insert'); return insertBuilder; };
  insertBuilder.select = (..._args: unknown[]) => { ops.push('insert.select'); return insertBuilder; };
  insertBuilder.maybeSingle = () => Promise.resolve(opts.insertResult);

  const selectBuilder: Record<string, unknown> = {};
  selectBuilder.select = (..._args: unknown[]) => { ops.push('select'); return selectBuilder; };
  selectBuilder.eq = (..._args: unknown[]) => selectBuilder;
  selectBuilder.is = (..._args: unknown[]) => selectBuilder;
  selectBuilder.maybeSingle = () => Promise.resolve(opts.selectResult);

  const updateBuilder: Record<string, unknown> = {};
  updateBuilder.update = (..._args: unknown[]) => { ops.push('update'); return updateBuilder; };
  updateBuilder.eq = (..._args: unknown[]) => updateBuilder;
  updateBuilder.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });

  const fromMock = vi.fn((_table: string) => {
    callCount += 1;
    if (callCount === 1) return upsertBuilder;  // first call: upsert → 42P10
    if (callCount === 2) return insertBuilder;  // second call: insert
    if (callCount === 3) return selectBuilder;  // third call: select existing
    return updateBuilder;                        // fourth call: update enforcement
  });

  const client = { from: fromMock } as unknown as SupabaseClient;
  return { client, ops };
}

describe('DietaryPreferencesRepository.declare', () => {
  it('inserts household-scoped row (child_id=null); returns was_existing=false', async () => {
    const now = new Date().toISOString();
    const { client, steps } = buildClient({
      upsertResult: {
        data: { id: DIETARY_ROW_ID, created_at: now, updated_at: now },
        error: null,
      },
    });
    const repo = new DietaryPreferencesRepository(client);

    const result = await repo.declare(
      HOUSEHOLD_ID,
      null,
      'halal',
      'non_negotiable',
      'onboarding_declared',
    );

    expect(result.dietary_id).toBe(DIETARY_ROW_ID);
    expect(result.was_existing).toBe(false);

    const upsertStep = steps.find((s) => s.op === 'upsert');
    const payload = upsertStep?.args[0] as Record<string, unknown>;
    expect(payload.household_id).toBe(HOUSEHOLD_ID);
    expect(payload.child_id).toBeNull();
    expect(payload.tag).toBe('halal');
    expect(payload.enforcement).toBe('non_negotiable');
    expect(payload.source).toBe('onboarding_declared');
  });

  it('inserts child-scoped row (child_id set); returns the dietary id', async () => {
    const now = new Date().toISOString();
    const { client, steps } = buildClient({
      upsertResult: {
        data: { id: DIETARY_ROW_ID, created_at: now, updated_at: now },
        error: null,
      },
    });
    const repo = new DietaryPreferencesRepository(client);

    const result = await repo.declare(
      HOUSEHOLD_ID,
      CHILD_ID,
      'vegetarian',
      'default',
      'onboarding_declared',
    );

    expect(result.dietary_id).toBe(DIETARY_ROW_ID);
    const upsertStep = steps.find((s) => s.op === 'upsert');
    const payload = upsertStep?.args[0] as Record<string, unknown>;
    expect(payload.child_id).toBe(CHILD_ID);
    expect(payload.tag).toBe('vegetarian');
  });

  it('returns was_existing=true when created_at and updated_at diverge (idempotent re-declare)', async () => {
    const created = '2026-05-20T10:00:00.000Z';
    const updated = '2026-05-20T10:00:05.000Z';
    const { client } = buildClient({
      upsertResult: {
        data: { id: DIETARY_ROW_ID, created_at: created, updated_at: updated },
        error: null,
      },
    });
    const repo = new DietaryPreferencesRepository(client);

    const result = await repo.declare(
      HOUSEHOLD_ID,
      null,
      'halal',
      'non_negotiable',
      'onboarding_declared',
    );

    expect(result.was_existing).toBe(true);
    expect(result.dietary_id).toBe(DIETARY_ROW_ID);
  });
});

describe('DietaryPreferencesRepository.declare — 42P10 fallback path', () => {
  it('falls back to insert when upsert returns 42P10 (functional index incompatibility)', async () => {
    const { client, ops } = buildFallbackClient({
      insertResult: { data: { id: DIETARY_ROW_ID }, error: null },
      selectResult: { data: null, error: null }, // not reached
    });
    const repo = new DietaryPreferencesRepository(client);

    const result = await repo.declare(
      HOUSEHOLD_ID,
      null,
      'halal',
      'non_negotiable',
      'onboarding_declared',
    );

    expect(result.dietary_id).toBe(DIETARY_ROW_ID);
    expect(result.was_existing).toBe(false);
    expect(ops).toContain('upsert');
    expect(ops).toContain('insert');
  });

  it('falls back to select + update when 42P10 upsert AND 23505 insert race (idempotent)', async () => {
    const { client, ops } = buildFallbackClient({
      insertResult: { data: null, error: { code: '23505', message: 'unique violation' } },
      selectResult: { data: { id: DIETARY_ROW_ID }, error: null },
    });
    const repo = new DietaryPreferencesRepository(client);

    const result = await repo.declare(
      HOUSEHOLD_ID,
      null,
      'halal',
      'non_negotiable',
      'onboarding_declared',
    );

    expect(result.dietary_id).toBe(DIETARY_ROW_ID);
    expect(result.was_existing).toBe(true);
    expect(ops).toContain('select');
    expect(ops).toContain('update'); // enforcement/source refreshed
  });
});

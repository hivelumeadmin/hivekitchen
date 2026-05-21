import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ChildAllergensRepository } from './child-allergens.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const ALLERGEN_ROW_ID = '33333333-3333-4333-8333-333333333333';

interface Step {
  op: string;
  table?: string;
  args: unknown[];
}

function buildClient(opts: {
  // The single .maybeSingle() result returned by the upsert chain.
  upsertResult: { data: unknown; error: unknown };
  // Whether the households table has an encrypted_dek already (skips the
  // insert branch in getOrCreateHouseholdDek). For these tests we run with
  // kek=null so the DEK fetch is short-circuited entirely.
} = { upsertResult: { data: null, error: null } }): {
  client: SupabaseClient;
  steps: Step[];
} {
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

describe('ChildAllergensRepository.declare', () => {
  it('encrypts allergen + inserts row; returns was_existing=false on first call', async () => {
    const now = new Date().toISOString();
    const { client, steps } = buildClient({
      upsertResult: {
        data: { id: ALLERGEN_ROW_ID, created_at: now, updated_at: now },
        error: null,
      },
    });
    const repo = new ChildAllergensRepository(client, null);

    const result = await repo.declare(
      HOUSEHOLD_ID,
      CHILD_ID,
      'peanut',
      'onboarding_declared',
    );

    expect(result.child_allergen_id).toBe(ALLERGEN_ROW_ID);
    expect(result.was_existing).toBe(false);

    const fromStep = steps.find((s) => s.op === 'from');
    expect(fromStep?.table).toBe('child_allergens');

    const upsertStep = steps.find((s) => s.op === 'upsert');
    const payload = upsertStep?.args[0] as Record<string, unknown>;
    const opts = upsertStep?.args[1] as Record<string, unknown>;
    expect(payload.household_id).toBe(HOUSEHOLD_ID);
    expect(payload.child_id).toBe(CHILD_ID);
    expect(payload.source).toBe('onboarding_declared');
    expect(typeof payload.allergen).toBe('string');
    // Plaintext must NOT be stored — even under kek=null the NOOP-prefixed
    // base64 envelope is used.
    expect(payload.allergen).not.toBe('peanut');
    // allergen_hash is SHA-256 hex (64 chars) of lower(trim('peanut')).
    expect(typeof payload.allergen_hash).toBe('string');
    expect((payload.allergen_hash as string).length).toBe(64);
    expect(opts.onConflict).toBe('child_id,allergen_hash');
  });

  it('returns was_existing=true when created_at and updated_at diverge by >1s (conflict update)', async () => {
    const created = '2026-05-20T10:00:00.000Z';
    const updated = '2026-05-20T10:00:05.000Z';
    const { client } = buildClient({
      upsertResult: {
        data: { id: ALLERGEN_ROW_ID, created_at: created, updated_at: updated },
        error: null,
      },
    });
    const repo = new ChildAllergensRepository(client, null);

    const result = await repo.declare(
      HOUSEHOLD_ID,
      CHILD_ID,
      'peanut',
      'onboarding_declared',
    );

    expect(result.was_existing).toBe(true);
    expect(result.child_allergen_id).toBe(ALLERGEN_ROW_ID);
  });

  it('throws when Supabase returns an error', async () => {
    const { client } = buildClient({
      upsertResult: { data: null, error: { message: 'db down' } },
    });
    const repo = new ChildAllergensRepository(client, null);

    await expect(
      repo.declare(HOUSEHOLD_ID, CHILD_ID, 'peanut', 'onboarding_declared'),
    ).rejects.toThrow(/child_allergens\.declare: db down/);
  });
});

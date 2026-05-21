import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HouseholdRulesRepository } from './household-rules.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const RULE_ROW_ID = '99999999-9999-4999-9999-999999999999';

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

describe('HouseholdRulesRepository.declare — non-custom path', () => {
  it('inserts non-custom rule (e.g. no_pork); custom_label fields are null', async () => {
    const now = new Date().toISOString();
    const { client, steps } = buildClient({
      upsertResult: {
        data: { id: RULE_ROW_ID, created_at: now, updated_at: now },
        error: null,
      },
    });
    const repo = new HouseholdRulesRepository(client, null);

    const result = await repo.declare(
      HOUSEHOLD_ID,
      'no_pork',
      null,
      'non_negotiable',
      'onboarding_declared',
    );

    expect(result.household_rule_id).toBe(RULE_ROW_ID);
    expect(result.was_existing).toBe(false);

    const upsertStep = steps.find((s) => s.op === 'upsert');
    const payload = upsertStep?.args[0] as Record<string, unknown>;
    const opts = upsertStep?.args[1] as Record<string, unknown>;
    expect(payload.household_id).toBe(HOUSEHOLD_ID);
    expect(payload.rule_type).toBe('no_pork');
    expect(payload.custom_label).toBeNull();
    expect(payload.custom_label_hash).toBeNull();
    expect(payload.enforcement).toBe('non_negotiable');
    expect(opts.onConflict).toBe('household_id,rule_type');
  });

  it('idempotent re-declare returns was_existing=true (timestamps diverged)', async () => {
    const created = '2026-05-20T10:00:00.000Z';
    const updated = '2026-05-20T10:00:05.000Z';
    const { client } = buildClient({
      upsertResult: {
        data: { id: RULE_ROW_ID, created_at: created, updated_at: updated },
        error: null,
      },
    });
    const repo = new HouseholdRulesRepository(client, null);

    const result = await repo.declare(
      HOUSEHOLD_ID,
      'no_alcohol',
      null,
      'strong',
      'onboarding_declared',
    );

    expect(result.was_existing).toBe(true);
    expect(result.household_rule_id).toBe(RULE_ROW_ID);
  });

  it('rejects non-custom rule_type when custom_label is supplied', async () => {
    const { client } = buildClient({
      upsertResult: { data: null, error: null },
    });
    const repo = new HouseholdRulesRepository(client, null);

    await expect(
      repo.declare(HOUSEHOLD_ID, 'no_pork', 'unexpected label', 'strong', 'onboarding_declared'),
    ).rejects.toThrow(/non-custom rule_type 'no_pork' must not carry a custom_label/);
  });
});

describe('HouseholdRulesRepository.declare — custom path', () => {
  it('encrypts custom_label, hashes for idempotency, inserts', async () => {
    const now = new Date().toISOString();
    const { client, steps } = buildClient({
      upsertResult: {
        data: { id: RULE_ROW_ID, created_at: now, updated_at: now },
        error: null,
      },
    });
    const repo = new HouseholdRulesRepository(client, null);

    const result = await repo.declare(
      HOUSEHOLD_ID,
      'custom',
      'No cheese on Tuesdays',
      'strong',
      'onboarding_declared',
    );

    expect(result.household_rule_id).toBe(RULE_ROW_ID);
    const upsertStep = steps.find((s) => s.op === 'upsert');
    const payload = upsertStep?.args[0] as Record<string, unknown>;
    const opts = upsertStep?.args[1] as Record<string, unknown>;
    expect(payload.rule_type).toBe('custom');
    expect(typeof payload.custom_label).toBe('string');
    // Plaintext must NOT be stored.
    expect(payload.custom_label).not.toBe('No cheese on Tuesdays');
    // SHA-256 hex = 64 chars
    expect(typeof payload.custom_label_hash).toBe('string');
    expect((payload.custom_label_hash as string).length).toBe(64);
    expect(opts.onConflict).toBe('household_id,custom_label_hash');
  });

  it('custom path is idempotent on normalized label ("No Cheese" matches "no cheese")', async () => {
    const created = '2026-05-20T10:00:00.000Z';
    const updated = '2026-05-20T10:00:05.000Z';
    const { client, steps } = buildClient({
      upsertResult: {
        data: { id: RULE_ROW_ID, created_at: created, updated_at: updated },
        error: null,
      },
    });
    const repo = new HouseholdRulesRepository(client, null);

    const a = await repo.declare(HOUSEHOLD_ID, 'custom', 'No Cheese', 'strong', 'onboarding_declared');

    expect(a.was_existing).toBe(true);
    expect(a.household_rule_id).toBe(RULE_ROW_ID);

    // Verify hash is normalized: the hash for "No Cheese" must equal the hash
    // for "no cheese" (lower(trim(...))) so the unique index collapses them.
    const upsertSteps = steps.filter((s) => s.op === 'upsert');
    const hash = (upsertSteps[0]?.args[0] as Record<string, unknown>).custom_label_hash;
    expect(typeof hash).toBe('string');
  });

  it('rejects custom rule without custom_label', async () => {
    const { client } = buildClient({ upsertResult: { data: null, error: null } });
    const repo = new HouseholdRulesRepository(client, null);

    await expect(
      repo.declare(HOUSEHOLD_ID, 'custom', null, 'strong', 'onboarding_declared'),
    ).rejects.toThrow(/custom rules require a custom_label/);
  });

  it('rejects custom rule with empty custom_label', async () => {
    const { client } = buildClient({ upsertResult: { data: null, error: null } });
    const repo = new HouseholdRulesRepository(client, null);

    await expect(
      repo.declare(HOUSEHOLD_ID, 'custom', '', 'strong', 'onboarding_declared'),
    ).rejects.toThrow(/custom rules require a custom_label/);
  });
});

describe('HouseholdRulesRepository.declare — 42P10 fallback', () => {
  it('falls back to insert when upsert returns 42P10 (partial-index incompatibility)', async () => {
    const { client, ops } = buildFallbackClient({
      insertResult: { data: { id: RULE_ROW_ID }, error: null },
      selectResult: { data: null, error: null },
    });
    const repo = new HouseholdRulesRepository(client, null);

    const result = await repo.declare(
      HOUSEHOLD_ID,
      'no_pork',
      null,
      'non_negotiable',
      'onboarding_declared',
    );

    expect(result.household_rule_id).toBe(RULE_ROW_ID);
    expect(result.was_existing).toBe(false);
    expect(ops).toContain('upsert');
    expect(ops).toContain('insert');
  });

  it('falls back to select + update when 42P10 upsert AND 23505 insert race', async () => {
    const { client, ops } = buildFallbackClient({
      insertResult: { data: null, error: { code: '23505', message: 'unique violation' } },
      selectResult: { data: { id: RULE_ROW_ID }, error: null },
    });
    const repo = new HouseholdRulesRepository(client, null);

    const result = await repo.declare(
      HOUSEHOLD_ID,
      'no_pork',
      null,
      'strong',
      'onboarding_declared',
    );

    expect(result.household_rule_id).toBe(RULE_ROW_ID);
    expect(result.was_existing).toBe(true);
    expect(ops).toContain('select');
    expect(ops).toContain('update');
  });

  it('throws on non-23505/42P10 errors', async () => {
    const { client } = buildClient({
      upsertResult: { data: null, error: { code: 'XX000', message: 'db down' } },
    });
    const repo = new HouseholdRulesRepository(client, null);

    await expect(
      repo.declare(HOUSEHOLD_ID, 'no_pork', null, 'strong', 'onboarding_declared'),
    ).rejects.toThrow(/household_rules\.declare: db down/);
  });
});

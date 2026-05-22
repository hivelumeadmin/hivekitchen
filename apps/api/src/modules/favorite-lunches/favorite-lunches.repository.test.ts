import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FavoriteLunchesRepository } from './favorite-lunches.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const FAV_ROW_ID = '88888888-8888-4888-8888-888888888888';

interface Step {
  op: string;
  table?: string;
  args: unknown[];
}

/**
 * Mock builder that drives the repository's two operation chains:
 *   call 1 — SELECT position … (only fired when position is undefined)
 *   call 2 — UPSERT … (always fires)
 *   call 3 — SELECT id, position … (only fires when call 2 returns data=null)
 */
function buildClient(opts: {
  skipMaxLookup?: boolean;
  maxPosition?: number | null;
  upsertResult: { data: unknown; error: unknown };
  selectExistingResult?: { data: unknown; error: unknown };
}): { client: SupabaseClient; steps: Step[] } {
  const steps: Step[] = [];
  let fromCallIndex = 0;

  // Builder for the MAX(position) SELECT chain.
  const maxBuilder: Record<string, unknown> = {};
  maxBuilder.select = (...args: unknown[]) => {
    steps.push({ op: 'max.select', args });
    return maxBuilder;
  };
  maxBuilder.eq = (...args: unknown[]) => {
    steps.push({ op: 'max.eq', args });
    return maxBuilder;
  };
  maxBuilder.order = (...args: unknown[]) => {
    steps.push({ op: 'max.order', args });
    return maxBuilder;
  };
  maxBuilder.limit = (...args: unknown[]) => {
    steps.push({ op: 'max.limit', args });
    return maxBuilder;
  };
  maxBuilder.maybeSingle = () =>
    Promise.resolve({
      data: opts.maxPosition === null || opts.maxPosition === undefined
        ? null
        : { position: opts.maxPosition },
      error: null,
    });

  // Builder for the UPSERT chain.
  const upsertBuilder: Record<string, unknown> = {};
  upsertBuilder.upsert = (...args: unknown[]) => {
    steps.push({ op: 'upsert', args });
    return upsertBuilder;
  };
  upsertBuilder.select = (...args: unknown[]) => {
    steps.push({ op: 'upsert.select', args });
    return upsertBuilder;
  };
  upsertBuilder.maybeSingle = () => Promise.resolve(opts.upsertResult);

  // Builder for the existing-row SELECT chain (used on idempotent re-add).
  const existingBuilder: Record<string, unknown> = {};
  existingBuilder.select = (...args: unknown[]) => {
    steps.push({ op: 'existing.select', args });
    return existingBuilder;
  };
  existingBuilder.eq = (...args: unknown[]) => {
    steps.push({ op: 'existing.eq', args });
    return existingBuilder;
  };
  existingBuilder.single = () =>
    Promise.resolve(opts.selectExistingResult ?? { data: null, error: null });

  const fromMock = vi.fn((table: string) => {
    steps.push({ op: 'from', table, args: [] });
    fromCallIndex += 1;
    if (opts.skipMaxLookup === true) {
      // First call is the upsert, second (if any) is the existing-row fetch.
      if (fromCallIndex === 1) return upsertBuilder;
      return existingBuilder;
    }
    if (fromCallIndex === 1) return maxBuilder;
    if (fromCallIndex === 2) return upsertBuilder;
    return existingBuilder;
  });

  const client = { from: fromMock } as unknown as SupabaseClient;
  return { client, steps };
}

describe('FavoriteLunchesRepository.add', () => {
  it('happy path: encrypts item, assigns position 0 on empty table, returns UUID + position', async () => {
    const { client, steps } = buildClient({
      maxPosition: null,
      upsertResult: { data: { id: FAV_ROW_ID, position: 0 }, error: null },
    });
    const repo = new FavoriteLunchesRepository(client, null);

    const result = await repo.add(HOUSEHOLD_ID, 'Paratha roll');

    expect(result.id).toBe(FAV_ROW_ID);
    expect(result.position).toBe(0);

    const fromSteps = steps.filter((s) => s.op === 'from');
    expect(fromSteps[0]?.table).toBe('favorite_lunches');

    const upsertStep = steps.find((s) => s.op === 'upsert');
    const payload = upsertStep?.args[0] as Record<string, unknown>;
    const optsArg = upsertStep?.args[1] as Record<string, unknown>;
    expect(payload.household_id).toBe(HOUSEHOLD_ID);
    expect(payload.provenance).toBe('onboarding_seed');
    expect(payload.position).toBe(0);
    // Plaintext must NOT be stored — even under kek=null the NOOP-prefixed
    // base64 envelope is used.
    expect(typeof payload.item).toBe('string');
    expect(payload.item).not.toBe('Paratha roll');
    // item_hash is SHA-256 hex (64 chars) of lower(trim('Paratha roll')).
    expect(typeof payload.item_hash).toBe('string');
    expect((payload.item_hash as string).length).toBe(64);
    expect(optsArg.onConflict).toBe('household_id,item_hash');
    expect(optsArg.ignoreDuplicates).toBe(true);
  });

  it('assigns next position when prior rows exist (MAX + 1)', async () => {
    const { client, steps } = buildClient({
      maxPosition: 4,
      upsertResult: { data: { id: FAV_ROW_ID, position: 5 }, error: null },
    });
    const repo = new FavoriteLunchesRepository(client, null);

    const result = await repo.add(HOUSEHOLD_ID, 'Dal + rice (thermos)');

    expect(result.position).toBe(5);
    const upsertStep = steps.find((s) => s.op === 'upsert');
    const payload = upsertStep?.args[0] as Record<string, unknown>;
    expect(payload.position).toBe(5);
  });

  it('honors explicit position (skips MAX lookup)', async () => {
    const { client, steps } = buildClient({
      skipMaxLookup: true,
      upsertResult: { data: { id: FAV_ROW_ID, position: 7 }, error: null },
    });
    const repo = new FavoriteLunchesRepository(client, null);

    const result = await repo.add(HOUSEHOLD_ID, 'Wrap', 7);

    expect(result.position).toBe(7);
    // Verify only one from() call (upsert) — no MAX lookup.
    expect(steps.filter((s) => s.op === 'from').length).toBe(1);
    const upsertStep = steps.find((s) => s.op === 'upsert');
    const payload = upsertStep?.args[0] as Record<string, unknown>;
    expect(payload.position).toBe(7);
  });

  it('is idempotent: second call with same item returns the existing row', async () => {
    const { client, steps } = buildClient({
      maxPosition: 0,
      upsertResult: { data: null, error: null }, // ignoreDuplicates conflict
      selectExistingResult: { data: { id: FAV_ROW_ID, position: 0 }, error: null },
    });
    const repo = new FavoriteLunchesRepository(client, null);

    const result = await repo.add(HOUSEHOLD_ID, 'Paratha roll');

    expect(result.id).toBe(FAV_ROW_ID);
    expect(result.position).toBe(0);
    expect(steps.some((s) => s.op === 'existing.select')).toBe(true);
  });

  it('throws on Supabase errors during upsert', async () => {
    const { client } = buildClient({
      maxPosition: null,
      upsertResult: { data: null, error: { code: 'XX000', message: 'db down' } },
    });
    const repo = new FavoriteLunchesRepository(client, null);

    await expect(repo.add(HOUSEHOLD_ID, 'Sandwich')).rejects.toThrow(
      /favorite_lunches\.add: db down/,
    );
  });
});

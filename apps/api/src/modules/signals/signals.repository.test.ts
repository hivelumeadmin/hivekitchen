import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SignalsRepository } from './signals.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const SIGNAL_ID = '22222222-2222-4222-8222-222222222222';

interface Step {
  op: string;
  args: unknown[];
}

// Thenable chainable — the read terminates on `await query` after .limit(),
// not on .single() (child-preferences.repository.test.ts precedent).
function buildChainClient(terminalResult: unknown): {
  client: SupabaseClient;
  steps: Step[];
} {
  const steps: Step[] = [];
  const builder: Record<string, unknown> = {};
  const passthrough =
    (op: string) =>
    (...args: unknown[]) => {
      steps.push({ op, args });
      return builder;
    };
  for (const op of ['select', 'eq', 'order', 'limit', 'or']) {
    builder[op] = passthrough(op);
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(terminalResult);
  const fromMock = vi.fn().mockImplementation((table: string) => {
    steps.push({ op: 'from', args: [table] });
    return builder;
  });
  return { client: { from: fromMock } as unknown as SupabaseClient, steps };
}

describe('SignalsRepository.findLunchRatingsByHousehold', () => {
  it('scans one household kind-filtered, oldest-first, in index order', async () => {
    const { client, steps } = buildChainClient({ data: [], error: null });
    const repo = new SignalsRepository(client);

    await repo.findLunchRatingsByHousehold(HOUSEHOLD_ID);

    expect(steps.find((s) => s.op === 'from')?.args).toEqual(['signals']);
    const eqs = steps.filter((s) => s.op === 'eq').map((s) => s.args);
    expect(eqs).toEqual([
      ['household_id', HOUSEHOLD_ID],
      ['kind', 'lunch_rating'],
    ]);
    // occurred_at ASC then id ASC — the deterministic order the projection's
    // last-write-wins collapse depends on.
    expect(steps.filter((s) => s.op === 'order').map((s) => s.args)).toEqual([
      ['occurred_at', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(steps.find((s) => s.op === 'or')).toBeUndefined();
  });

  it('applies a composite keyset cursor so equal occurred_at values are not skipped', async () => {
    const { client, steps } = buildChainClient({ data: [], error: null });
    const repo = new SignalsRepository(client);

    await repo.findLunchRatingsByHousehold(HOUSEHOLD_ID, {
      limit: 2,
      after: { occurredAt: '2026-08-02T12:00:00.000Z', id: SIGNAL_ID },
    });

    expect(steps.find((s) => s.op === 'limit')?.args).toEqual([2]);
    expect(steps.find((s) => s.op === 'or')?.args).toEqual([
      `occurred_at.gt."2026-08-02T12:00:00.000Z",and(occurred_at.eq."2026-08-02T12:00:00.000Z",id.gt."${SIGNAL_ID}")`,
    ]);
  });

  it('returns the rows and throws on a query error', async () => {
    const row = { id: SIGNAL_ID, kind: 'lunch_rating' };
    const ok = buildChainClient({ data: [row], error: null });
    expect(await new SignalsRepository(ok.client).findLunchRatingsByHousehold(HOUSEHOLD_ID)).toEqual(
      [row],
    );

    const bad = buildChainClient({ data: null, error: { message: 'boom' } });
    await expect(
      new SignalsRepository(bad.client).findLunchRatingsByHousehold(HOUSEHOLD_ID),
    ).rejects.toMatchObject({ message: 'boom' });
  });
});

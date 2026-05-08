import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ExtraRulesRepository, parseExtraRules } from './extra-rules.repository.js';

const CHILD_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

interface Step {
  op: string;
  args: unknown[];
}

// Self-returning chainable that records every call. update().eq().eq()
// .select().maybeSingle() and select().eq().maybeSingle() are the two
// shapes ExtraRulesRepository exercises.
function buildChainClient(terminalResult: unknown): {
  client: SupabaseClient;
  steps: Step[];
} {
  const steps: Step[] = [];
  const builder: Record<string, unknown> = {};
  const passthrough = (op: string) => (...args: unknown[]) => {
    steps.push({ op, args });
    return builder;
  };
  for (const op of ['select', 'update', 'eq', 'insert', 'is', 'order']) {
    builder[op] = passthrough(op);
  }
  builder.maybeSingle = vi.fn().mockResolvedValue(terminalResult);
  builder.single = vi.fn().mockResolvedValue(terminalResult);
  const fromMock = vi.fn().mockImplementation((table: string) => {
    steps.push({ op: 'from', args: [table] });
    return builder;
  });
  return { client: { from: fromMock } as unknown as SupabaseClient, steps };
}

describe('ExtraRulesRepository.updateExtraRules', () => {
  it('writes the {pins,bans} payload and returns the persisted row', async () => {
    const { client, steps } = buildChainClient({
      data: {
        id: CHILD_ID,
        extra_rules: { pins: ['fruit'], bans: ['sweet treat'] },
        updated_at: '2026-05-07T12:00:00.000Z',
      },
      error: null,
    });
    const repo = new ExtraRulesRepository(client);

    const result = await repo.updateExtraRules({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      pins: ['fruit'],
      bans: ['sweet treat'],
    });

    expect(result).toEqual({
      child_id: CHILD_ID,
      extra_rules: { pins: ['fruit'], bans: ['sweet treat'] },
      updated_at: '2026-05-07T12:00:00.000Z',
    });
    expect(steps.find((s) => s.op === 'from')?.args).toEqual(['children']);
    // Both ownership filters are applied: id + household_id.
    const eqCalls = steps.filter((s) => s.op === 'eq');
    expect(eqCalls.some((s) => s.args[0] === 'id' && s.args[1] === CHILD_ID)).toBe(true);
    expect(
      eqCalls.some((s) => s.args[0] === 'household_id' && s.args[1] === HOUSEHOLD_ID),
    ).toBe(true);
    // The update payload carries the structured rules and an updated_at stamp.
    const updateCall = steps.find((s) => s.op === 'update');
    expect(updateCall?.args[0]).toMatchObject({
      extra_rules: { pins: ['fruit'], bans: ['sweet treat'] },
    });
  });

  it('returns null when no row matches (cross-household guard)', async () => {
    const { client } = buildChainClient({ data: null, error: null });
    const repo = new ExtraRulesRepository(client);

    const result = await repo.updateExtraRules({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      pins: [],
      bans: [],
    });

    expect(result).toBeNull();
  });

  it('throws when the database returns an error', async () => {
    const { client } = buildChainClient({ data: null, error: new Error('db down') });
    const repo = new ExtraRulesRepository(client);

    await expect(
      repo.updateExtraRules({
        childId: CHILD_ID,
        householdId: HOUSEHOLD_ID,
        pins: [],
        bans: [],
      }),
    ).rejects.toThrow(/db down/);
  });
});

describe('ExtraRulesRepository.findExtraRules', () => {
  it('returns the parsed pins/bans for a known child', async () => {
    const { client } = buildChainClient({
      data: { extra_rules: { pins: ['fruit'], bans: [] } },
      error: null,
    });
    const repo = new ExtraRulesRepository(client);

    expect(await repo.findExtraRules(CHILD_ID)).toEqual({
      pins: ['fruit'],
      bans: [],
    });
  });

  it('returns the default empty rules when the row is missing the column', async () => {
    const { client } = buildChainClient({ data: { extra_rules: null }, error: null });
    const repo = new ExtraRulesRepository(client);

    expect(await repo.findExtraRules(CHILD_ID)).toEqual({ pins: [], bans: [] });
  });

  it('returns the default empty rules when no row matches', async () => {
    const { client } = buildChainClient({ data: null, error: null });
    const repo = new ExtraRulesRepository(client);

    expect(await repo.findExtraRules(CHILD_ID)).toEqual({ pins: [], bans: [] });
  });
});

describe('ExtraRulesRepository.appendBanAtomic', () => {
  function buildRpcClient(rpcResult: { data: unknown; error: unknown }): {
    client: SupabaseClient;
    rpcCalls: Array<{ fn: string; args: unknown }>;
  } {
    const rpcCalls: Array<{ fn: string; args: unknown }> = [];
    const rpc = vi.fn().mockImplementation((fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResult);
    });
    return {
      client: { rpc } as unknown as SupabaseClient,
      rpcCalls,
    };
  }

  it('returns parsed rules + appended status when the RPC reports an append', async () => {
    const { client, rpcCalls } = buildRpcClient({
      data: [
        { extra_rules: { pins: ['fruit'], bans: ['sweet treat'] }, status: 'appended' },
      ],
      error: null,
    });
    const repo = new ExtraRulesRepository(client);

    const result = await repo.appendBanAtomic({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      componentType: 'sweet treat',
    });

    expect(result).toEqual({
      extra_rules: { pins: ['fruit'], bans: ['sweet treat'] },
      status: 'appended',
    });
    expect(rpcCalls[0]?.fn).toBe('append_extra_ban');
    expect(rpcCalls[0]?.args).toEqual({
      p_child_id: CHILD_ID,
      p_household_id: HOUSEHOLD_ID,
      p_component_type: 'sweet treat',
    });
  });

  it('returns already_banned status without appending when the type is present', async () => {
    const { client } = buildRpcClient({
      data: [
        { extra_rules: { pins: [], bans: ['sweet treat'] }, status: 'already_banned' },
      ],
      error: null,
    });
    const repo = new ExtraRulesRepository(client);

    const result = await repo.appendBanAtomic({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      componentType: 'sweet treat',
    });

    expect(result).toEqual({
      extra_rules: { pins: [], bans: ['sweet treat'] },
      status: 'already_banned',
    });
  });

  it('returns null when the RPC reports not_found (cross-household / missing row)', async () => {
    const { client } = buildRpcClient({
      data: [{ extra_rules: null, status: 'not_found' }],
      error: null,
    });
    const repo = new ExtraRulesRepository(client);

    const result = await repo.appendBanAtomic({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      componentType: 'sweet treat',
    });

    expect(result).toBeNull();
  });

  it('returns null on an empty RPC response', async () => {
    const { client } = buildRpcClient({ data: [], error: null });
    const repo = new ExtraRulesRepository(client);

    expect(
      await repo.appendBanAtomic({
        childId: CHILD_ID,
        householdId: HOUSEHOLD_ID,
        componentType: 'sweet treat',
      }),
    ).toBeNull();
  });

  it('throws when the RPC returns an error', async () => {
    const { client } = buildRpcClient({ data: null, error: new Error('rpc down') });
    const repo = new ExtraRulesRepository(client);

    await expect(
      repo.appendBanAtomic({
        childId: CHILD_ID,
        householdId: HOUSEHOLD_ID,
        componentType: 'sweet treat',
      }),
    ).rejects.toThrow(/rpc down/);
  });
});

describe('parseExtraRules', () => {
  it('passes through a valid object', () => {
    expect(parseExtraRules({ pins: ['fruit'], bans: ['candy'] })).toEqual({
      pins: ['fruit'],
      bans: ['candy'],
    });
  });

  it('parses a JSON string defensively', () => {
    expect(parseExtraRules('{"pins":["fruit"],"bans":[]}')).toEqual({
      pins: ['fruit'],
      bans: [],
    });
  });

  it('drops non-string entries without throwing', () => {
    expect(parseExtraRules({ pins: ['fruit', 7, null], bans: ['candy', {}] })).toEqual({
      pins: ['fruit'],
      bans: ['candy'],
    });
  });

  it('returns defaults for malformed inputs', () => {
    expect(parseExtraRules(null)).toEqual({ pins: [], bans: [] });
    expect(parseExtraRules(42)).toEqual({ pins: [], bans: [] });
    expect(parseExtraRules([])).toEqual({ pins: [], bans: [] });
  });
});

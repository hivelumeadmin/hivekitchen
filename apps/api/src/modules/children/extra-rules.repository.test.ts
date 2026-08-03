import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ExtraRulesRepository } from './extra-rules.repository.js';

const CHILD_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

interface RuleRow {
  child_id: string;
  rule: 'pin' | 'ban';
  component_type: string;
}

interface FakeOpts {
  // A child row exists under (CHILD_ID, HOUSEHOLD_ID) unless this is false.
  childExists?: boolean;
  rules?: RuleRow[];
  rpcResult?: { data: unknown; error: unknown };
  insertError?: { code?: string; message: string } | null;
  readError?: Error;
}

interface Fake {
  client: SupabaseClient;
  rules: RuleRow[];
  rpcCalls: Array<{ fn: string; args: unknown }>;
  inserted: Array<Record<string, unknown>>;
}

// In-memory Supabase double covering the four shapes the repository issues:
//   children:          .select('id').eq('id').eq('household_id').maybeSingle()
//   child_extra_rules: .select(...).eq('child_id').order()
//   child_extra_rules: .insert({...})
//   rpc('replace_child_extra_rules', {...})
function buildFake(opts: FakeOpts = {}): Fake {
  const rules: RuleRow[] = [...(opts.rules ?? [])];
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const inserted: Array<Record<string, unknown>> = [];
  const childExists = opts.childExists ?? true;

  const childrenTable = () => {
    const filters: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, value: unknown) => {
        filters[col] = value;
        return chain;
      },
      maybeSingle: async () => {
        if (opts.readError !== undefined) return { data: null, error: opts.readError };
        const match =
          childExists && filters.id === CHILD_ID && filters.household_id === HOUSEHOLD_ID;
        return { data: match ? { id: CHILD_ID } : null, error: null };
      },
    };
    return chain;
  };

  const rulesTable = () => {
    const filters: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, value: unknown) => {
        filters[col] = value;
        return chain;
      },
      order: (col: string) => {
        if (col !== 'component_type') throw new Error(`unexpected order column: ${col}`);
        return chain;
      },
      insert: async (row: Record<string, unknown>) => {
        if (opts.insertError !== null && opts.insertError !== undefined) {
          return { data: null, error: opts.insertError };
        }
        inserted.push(row);
        rules.push(row as unknown as RuleRow);
        return { data: null, error: null };
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (opts.readError !== undefined) return resolve({ data: null, error: opts.readError });
        const rows = rules
          .filter((r) => r.child_id === filters.child_id)
          .map((r) => ({ rule: r.rule, component_type: r.component_type }))
          .sort((a, b) => a.component_type.localeCompare(b.component_type));
        return resolve({ data: rows, error: null });
      },
    };
    return chain;
  };

  const client = {
    from: (table: string) => {
      if (table === 'children') return childrenTable();
      if (table === 'child_extra_rules') return rulesTable();
      throw new Error(`unexpected table: ${table}`);
    },
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(opts.rpcResult ?? { data: true, error: null });
    },
  } as unknown as SupabaseClient;

  return { client, rules, rpcCalls, inserted };
}

describe('ExtraRulesRepository.updateExtraRules', () => {
  it('replaces the full rule set through the atomic RPC and echoes the persisted shape', async () => {
    const fake = buildFake();
    const repo = new ExtraRulesRepository(fake.client);

    const result = await repo.updateExtraRules({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      pins: ['fruit'],
      bans: ['sweet treat'],
    });

    expect(result?.child_id).toBe(CHILD_ID);
    expect(result?.extra_rules).toEqual({ pins: ['fruit'], bans: ['sweet treat'] });
    expect(typeof result?.updated_at).toBe('string');
    expect(fake.rpcCalls[0]?.fn).toBe('replace_child_extra_rules');
    expect(fake.rpcCalls[0]?.args).toEqual({
      p_child_id: CHILD_ID,
      p_household_id: HOUSEHOLD_ID,
      p_pins: ['fruit'],
      p_bans: ['sweet treat'],
    });
  });

  it('returns null when the RPC reports no matching child (cross-household guard)', async () => {
    const fake = buildFake({ rpcResult: { data: false, error: null } });
    const repo = new ExtraRulesRepository(fake.client);

    const result = await repo.updateExtraRules({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      pins: [],
      bans: [],
    });

    expect(result).toBeNull();
  });

  it('tolerates the RETURNS-scalar arriving as a single-element array over PostgREST', async () => {
    const fake = buildFake({ rpcResult: { data: [true], error: null } });
    const repo = new ExtraRulesRepository(fake.client);

    const result = await repo.updateExtraRules({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      pins: ['grain'],
      bans: [],
    });

    expect(result?.extra_rules).toEqual({ pins: ['grain'], bans: [] });
  });

  it('throws when the RPC returns an error', async () => {
    const fake = buildFake({ rpcResult: { data: null, error: new Error('rpc down') } });
    const repo = new ExtraRulesRepository(fake.client);

    await expect(
      repo.updateExtraRules({ childId: CHILD_ID, householdId: HOUSEHOLD_ID, pins: [], bans: [] }),
    ).rejects.toThrow(/rpc down/);
  });
});

describe('ExtraRulesRepository.findExtraRulesForChild', () => {
  it('groups rows into pins and bans for a child in the household', async () => {
    const fake = buildFake({
      rules: [
        { child_id: CHILD_ID, rule: 'pin', component_type: 'fruit' },
        { child_id: CHILD_ID, rule: 'ban', component_type: 'candy' },
      ],
    });
    const repo = new ExtraRulesRepository(fake.client);

    expect(await repo.findExtraRulesForChild(CHILD_ID, HOUSEHOLD_ID)).toEqual({
      pins: ['fruit'],
      bans: ['candy'],
    });
  });

  it('returns empty arrays for a child with no rule rows', async () => {
    const fake = buildFake();
    const repo = new ExtraRulesRepository(fake.client);

    expect(await repo.findExtraRulesForChild(CHILD_ID, HOUSEHOLD_ID)).toEqual({
      pins: [],
      bans: [],
    });
  });

  it('returns null when the child is not in the household (no existence leak)', async () => {
    const fake = buildFake({ childExists: false });
    const repo = new ExtraRulesRepository(fake.client);

    expect(await repo.findExtraRulesForChild(CHILD_ID, HOUSEHOLD_ID)).toBeNull();
  });

  it('throws when the database returns an error', async () => {
    const fake = buildFake({ readError: new Error('db down') });
    const repo = new ExtraRulesRepository(fake.client);

    await expect(repo.findExtraRulesForChild(CHILD_ID, HOUSEHOLD_ID)).rejects.toThrow(/db down/);
  });
});

describe('ExtraRulesRepository.findExtraRules', () => {
  it('groups rows into pins and bans without an ownership check', async () => {
    const fake = buildFake({
      rules: [
        { child_id: CHILD_ID, rule: 'pin', component_type: 'grain' },
        { child_id: CHILD_ID, rule: 'pin', component_type: 'fruit' },
      ],
    });
    const repo = new ExtraRulesRepository(fake.client);

    expect(await repo.findExtraRules(CHILD_ID)).toEqual({ pins: ['fruit', 'grain'], bans: [] });
  });

  it('returns empty arrays when the child has no rows', async () => {
    const fake = buildFake();
    const repo = new ExtraRulesRepository(fake.client);

    expect(await repo.findExtraRules(CHILD_ID)).toEqual({ pins: [], bans: [] });
  });
});

describe('ExtraRulesRepository.appendBanAtomic', () => {
  it('inserts a lowercased ban row and reports appended', async () => {
    const fake = buildFake({ rules: [{ child_id: CHILD_ID, rule: 'pin', component_type: 'fruit' }] });
    const repo = new ExtraRulesRepository(fake.client);

    const result = await repo.appendBanAtomic({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      componentType: '  Sweet Treat ',
    });

    expect(result).toEqual({
      extra_rules: { pins: ['fruit'], bans: ['sweet treat'] },
      status: 'appended',
    });
    expect(fake.inserted).toEqual([
      { child_id: CHILD_ID, rule: 'ban', component_type: 'sweet treat' },
    ]);
  });

  it('throws a clear error instead of inserting when componentType exceeds 50 chars', async () => {
    const fake = buildFake();
    const repo = new ExtraRulesRepository(fake.client);

    await expect(
      repo.appendBanAtomic({
        childId: CHILD_ID,
        householdId: HOUSEHOLD_ID,
        componentType: 'x'.repeat(51),
      }),
    ).rejects.toThrow(/exceeds 50 chars/);
    expect(fake.inserted).toEqual([]);
  });

  it('reports already_banned without inserting when the type is present in another casing', async () => {
    const fake = buildFake({
      rules: [{ child_id: CHILD_ID, rule: 'ban', component_type: 'Sweet Treat' }],
    });
    const repo = new ExtraRulesRepository(fake.client);

    const result = await repo.appendBanAtomic({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      componentType: 'sweet treat',
    });

    expect(result).toEqual({
      extra_rules: { pins: [], bans: ['Sweet Treat'] },
      status: 'already_banned',
    });
    expect(fake.inserted).toEqual([]);
  });

  it('treats a unique-violation from a concurrent writer as already_banned, not an error', async () => {
    const fake = buildFake({
      rules: [{ child_id: CHILD_ID, rule: 'ban', component_type: 'sweet treat' }],
      insertError: { code: '23505', message: 'duplicate key value' },
    });
    const repo = new ExtraRulesRepository(fake.client);
    // Force the pre-check to miss so the insert is actually attempted.
    const result = await repo.appendBanAtomic({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      componentType: 'gummy',
    });

    expect(result?.status).toBe('already_banned');
  });

  it('returns null when the child is not in the household (cross-household guard)', async () => {
    const fake = buildFake({ childExists: false });
    const repo = new ExtraRulesRepository(fake.client);

    const result = await repo.appendBanAtomic({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      componentType: 'sweet treat',
    });

    expect(result).toBeNull();
    expect(fake.inserted).toEqual([]);
  });

  it('throws on a non-unique-violation insert error', async () => {
    const fake = buildFake({ insertError: { code: '08006', message: 'connection failure' } });
    const repo = new ExtraRulesRepository(fake.client);

    await expect(
      repo.appendBanAtomic({
        childId: CHILD_ID,
        householdId: HOUSEHOLD_ID,
        componentType: 'sweet treat',
      }),
    ).rejects.toThrow(/connection failure/);
  });

  it('never issues an append_extra_ban RPC — the function is retired', async () => {
    const fake = buildFake();
    const repo = new ExtraRulesRepository(fake.client);

    await repo.appendBanAtomic({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      componentType: 'sweet treat',
    });

    expect(fake.rpcCalls).toEqual([]);
  });
});

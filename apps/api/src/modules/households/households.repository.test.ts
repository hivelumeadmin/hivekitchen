import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateDek, encryptField } from '../../lib/envelope-encryption.js';
import { decryptCaregiverRelationships, HouseholdsRepository } from './households.repository.js';

describe('decryptCaregiverRelationships', () => {
  it('decrypts NOOP-prefixed value (dev/test path)', () => {
    const value = { primary: 'alice', secondary: 'bob' };
    const stored = encryptField(value, null);
    expect(decryptCaregiverRelationships(stored, null)).toEqual(value);
  });

  it('decrypts AES-GCM ciphertext with a real DEK', () => {
    const dek = generateDek();
    const value = { roles: ['caregiver-1', 'caregiver-2'] };
    const stored = encryptField(value, dek);
    expect(decryptCaregiverRelationships(stored, dek)).toEqual(value);
  });

  it('handles legacy jsonb-cast-to-text rows (no NOOP prefix, no encryption)', () => {
    // Story 2.10 migration cast existing jsonb to text via `USING ::text`,
    // producing raw JSON literals. Read path tolerates this until the next
    // application write re-encrypts.
    const legacy = '{"primary":"alice","secondary":"bob"}';
    expect(decryptCaregiverRelationships(legacy, null)).toEqual({
      primary: 'alice',
      secondary: 'bob',
    });
  });

  it('handles legacy array-shaped jsonb rows', () => {
    const legacy = '[{"role":"primary","name":"alice"}]';
    expect(decryptCaregiverRelationships(legacy, null)).toEqual([
      { role: 'primary', name: 'alice' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Slice 2.5-s5 — setDisplayName
// ---------------------------------------------------------------------------

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

interface Step {
  op: string;
  args: unknown[];
}

function buildSetDisplayNameClient(opts: {
  updateError?: unknown;
  rpcError?: unknown;
  notFound?: boolean;
} = {}): { client: SupabaseClient; steps: Step[]; rpcMock: ReturnType<typeof vi.fn> } {
  const steps: Step[] = [];
  const maybeSingleResult = Promise.resolve({
    data: opts.notFound ? null : { id: HOUSEHOLD_ID },
    error: opts.updateError ?? null,
  });
  const builder: Record<string, unknown> = {};
  builder.update = (...args: unknown[]) => {
    steps.push({ op: 'update', args });
    return builder;
  };
  builder.eq = (...args: unknown[]) => {
    steps.push({ op: 'eq', args });
    return builder;
  };
  builder.select = (...args: unknown[]) => {
    steps.push({ op: 'select', args });
    return builder;
  };
  builder.maybeSingle = () => maybeSingleResult;
  const fromMock = vi.fn((table: string) => {
    steps.push({ op: 'from', args: [table] });
    return builder;
  });
  const rpcMock = vi
    .fn()
    .mockResolvedValue({ error: opts.rpcError ?? null });
  const client = {
    from: fromMock,
    rpc: rpcMock,
  } as unknown as SupabaseClient;
  return { client, steps, rpcMock };
}

describe('HouseholdsRepository.setDisplayName', () => {
  it('updates display_name + updated_at on the households row and bumps the kitchen map version', async () => {
    const { client, steps, rpcMock } = buildSetDisplayNameClient();
    const repo = new HouseholdsRepository(client, null);

    await repo.setDisplayName(HOUSEHOLD_ID, 'The Menons');

    expect(steps.find((s) => s.op === 'from')?.args).toEqual(['households']);
    const updateArgs = steps.find((s) => s.op === 'update')?.args[0] as Record<string, unknown>;
    expect(updateArgs.display_name).toBe('The Menons');
    expect(typeof updateArgs.updated_at).toBe('string');
    expect(steps.find((s) => s.op === 'eq')?.args).toEqual(['id', HOUSEHOLD_ID]);
    expect(rpcMock).toHaveBeenCalledWith(
      'bump_kitchen_map_version_for_household',
      { p_household_id: HOUSEHOLD_ID },
    );
  });

  it('throws when the household row is not found and does not bump the version', async () => {
    const { client, rpcMock } = buildSetDisplayNameClient({ notFound: true });
    const repo = new HouseholdsRepository(client, null);

    await expect(repo.setDisplayName(HOUSEHOLD_ID, 'X')).rejects.toThrow(/household not found/);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('throws when the update returns an error and does not bump the version', async () => {
    const { client, rpcMock } = buildSetDisplayNameClient({
      updateError: new Error('db down'),
    });
    const repo = new HouseholdsRepository(client, null);

    await expect(repo.setDisplayName(HOUSEHOLD_ID, 'X')).rejects.toThrow(/db down/);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('throws when the version bump RPC returns an error', async () => {
    const { client, rpcMock } = buildSetDisplayNameClient({
      rpcError: new Error('rpc failed'),
    });
    const repo = new HouseholdsRepository(client, null);

    await expect(repo.setDisplayName(HOUSEHOLD_ID, 'X')).rejects.toThrow(/rpc failed/);
    expect(rpcMock).toHaveBeenCalledOnce();
  });
});

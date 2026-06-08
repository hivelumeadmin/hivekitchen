import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { UserRepository, type UserProfileRow } from './user.repository.js';

// findPrimaryParentForHousehold chain:
//   from('users').select(cols).eq('current_household_id', id).eq('role', 'primary_parent').maybeSingle()
// The same builder backs the whole chain; we capture .eq() calls to assert the
// household + role filters, and stub maybeSingle's result per test.
function buildClient(maybeSingleResult: { data: unknown; error: unknown }) {
  const eqCalls: Array<[string, unknown]> = [];

  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn((column: string, value: unknown) => {
    eqCalls.push([column, value]);
    return builder;
  });
  builder.maybeSingle = vi.fn(() => Promise.resolve(maybeSingleResult));

  const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient;
  return { client, eqCalls };
}

const PARENT_ROW: UserProfileRow = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'parent@example.com',
  display_name: 'Parent',
  preferred_language: 'en',
  role: 'primary_parent',
  notification_prefs: {
    weekly_plan_ready: true,
    grocery_list_ready: true,
    proactive_lumi_nudges: false,
  },
  cultural_language: 'default',
  parental_notice_acknowledged_at: null,
  parental_notice_acknowledged_version: null,
  caption_only_mode: false,
};

describe('UserRepository.findPrimaryParentForHousehold', () => {
  it('plucks the primary_parent row scoped to current_household_id', async () => {
    const { client, eqCalls } = buildClient({ data: PARENT_ROW, error: null });
    const repo = new UserRepository(client);

    const result = await repo.findPrimaryParentForHousehold(
      '22222222-2222-4222-8222-222222222222',
    );

    expect(result).toEqual(PARENT_ROW);
    expect(result?.notification_prefs?.proactive_lumi_nudges).toBe(false);
    expect(eqCalls).toContainEqual([
      'current_household_id',
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(eqCalls).toContainEqual(['role', 'primary_parent']);
  });

  it('returns null when no primary_parent row exists', async () => {
    const { client } = buildClient({ data: null, error: null });
    const repo = new UserRepository(client);

    const result = await repo.findPrimaryParentForHousehold(
      '22222222-2222-4222-8222-222222222222',
    );

    expect(result).toBeNull();
  });

  it('throws when the query errors', async () => {
    const { client } = buildClient({ data: null, error: new Error('db down') });
    const repo = new UserRepository(client);

    await expect(
      repo.findPrimaryParentForHousehold('22222222-2222-4222-8222-222222222222'),
    ).rejects.toThrow('db down');
  });
});

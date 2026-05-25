import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  OnboardingMomentRepository,
  type MomentState,
} from './onboarding-moment.repository.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

function makeSelectQuery(payload: { data: unknown; error: unknown }): unknown {
  // Mimics PostgREST builder: from().select().eq().maybeSingle() resolves to {data, error}.
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(payload),
  };
}

function makeUpsertQuery(payload: { error: unknown }): unknown {
  return {
    upsert: vi.fn().mockResolvedValue(payload),
  };
}

describe('OnboardingMomentRepository.getState', () => {
  it('returns null when no row exists', async () => {
    const fromMock = vi.fn().mockReturnValue(makeSelectQuery({ data: null, error: null }));
    const client = { from: fromMock } as unknown as SupabaseClient;
    const repo = new OnboardingMomentRepository(client);

    const result = await repo.getState(HOUSEHOLD_ID);

    expect(result).toBeNull();
    expect(fromMock).toHaveBeenCalledWith('onboarding_moment_state');
  });

  it('returns parsed MomentState when row present', async () => {
    const row = {
      household_id: HOUSEHOLD_ID,
      current_moment: 'm2_safe',
      required_set_status: {
        m1_household_name: true,
        m1_child_declared: true,
        m2_allergen_response: false,
        m5_favorite_count: 3,
        m5_complete: false,
      },
    };
    const fromMock = vi.fn().mockReturnValue(makeSelectQuery({ data: row, error: null }));
    const client = { from: fromMock } as unknown as SupabaseClient;
    const repo = new OnboardingMomentRepository(client);

    const result = await repo.getState(HOUSEHOLD_ID);

    expect(result).toEqual({
      current_moment: 'm2_safe',
      required_set_status: {
        m1_household_name: true,
        m1_child_declared: true,
        m2_allergen_response: false,
        m5_favorite_count: 3,
        m5_complete: false,
      },
    });
  });

  it('normalises an empty required_set_status JSONB to all-false defaults', async () => {
    const row = {
      household_id: HOUSEHOLD_ID,
      current_moment: 'pre_start',
      required_set_status: {},
    };
    const fromMock = vi.fn().mockReturnValue(makeSelectQuery({ data: row, error: null }));
    const client = { from: fromMock } as unknown as SupabaseClient;
    const repo = new OnboardingMomentRepository(client);

    const result = await repo.getState(HOUSEHOLD_ID);

    expect(result).toEqual({
      current_moment: 'pre_start',
      required_set_status: {
        m1_household_name: false,
        m1_child_declared: false,
        m2_allergen_response: false,
        m5_favorite_count: 0,
        m5_complete: false,
      },
    });
  });

  it('defaults current_moment to pre_start when the column is null', async () => {
    const row = {
      household_id: HOUSEHOLD_ID,
      current_moment: null,
      required_set_status: null,
    };
    const fromMock = vi.fn().mockReturnValue(makeSelectQuery({ data: row, error: null }));
    const client = { from: fromMock } as unknown as SupabaseClient;
    const repo = new OnboardingMomentRepository(client);

    const result = await repo.getState(HOUSEHOLD_ID);

    expect(result?.current_moment).toBe('pre_start');
  });

  it('throws a wrapped error when Supabase reports a query failure', async () => {
    const fromMock = vi
      .fn()
      .mockReturnValue(makeSelectQuery({ data: null, error: { message: 'boom' } }));
    const client = { from: fromMock } as unknown as SupabaseClient;
    const repo = new OnboardingMomentRepository(client);

    await expect(repo.getState(HOUSEHOLD_ID)).rejects.toThrow(/boom/);
  });
});

describe('OnboardingMomentRepository.countRequiredSetSources', () => {
  // Slice 2.6-s1 — the household_recipe_usage count query chains TWO .eq()
  // calls (household_id + catalog_provenance='declared'); other count queries
  // chain ONE. The builder must therefore be `then-able` AFTER any number of
  // chained .eq() calls, so we make .eq() return a builder that is BOTH
  // chain-able and resolves to the payload when awaited.
  function makeCountQuery(payload: { count: number | null; error: unknown }): unknown {
    const builder: { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; then: (resolve: (v: unknown) => unknown) => unknown } = {
      select: vi.fn(),
      eq: vi.fn(),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(payload).then(resolve),
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    return builder;
  }

  function makeHouseholdQuery(payload: { data: unknown; error: unknown }): unknown {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(payload),
    };
  }

  it('aggregates the four counts and household_name_set boolean', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'households') {
        return makeHouseholdQuery({ data: { display_name: 'The Menons' }, error: null });
      }
      if (table === 'children') return makeCountQuery({ count: 2, error: null });
      if (table === 'child_allergens') return makeCountQuery({ count: 3, error: null });
      // Slice 2.6-s1 — favorite_lunch count derives from household_recipe_usage
      // rows the parent declared (catalog_provenance='declared').
      if (table === 'household_recipe_usage') return makeCountQuery({ count: 10, error: null });
      throw new Error(`unexpected table: ${table}`);
    });
    const client = { from: fromMock } as unknown as SupabaseClient;
    const repo = new OnboardingMomentRepository(client);

    const result = await repo.countRequiredSetSources(HOUSEHOLD_ID);

    expect(result).toEqual({
      household_name_set: true,
      child_count: 2,
      child_allergen_count: 3,
      favorite_lunch_count: 10,
    });
  });

  it('treats an empty / whitespace display_name as not set', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'households') {
        return makeHouseholdQuery({ data: { display_name: '   ' }, error: null });
      }
      return makeCountQuery({ count: 0, error: null });
    });
    const client = { from: fromMock } as unknown as SupabaseClient;
    const repo = new OnboardingMomentRepository(client);

    const result = await repo.countRequiredSetSources(HOUSEHOLD_ID);

    expect(result.household_name_set).toBe(false);
  });

  it('returns zeros when no row exists and counts are null', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'households') return makeHouseholdQuery({ data: null, error: null });
      return makeCountQuery({ count: null, error: null });
    });
    const client = { from: fromMock } as unknown as SupabaseClient;
    const repo = new OnboardingMomentRepository(client);

    const result = await repo.countRequiredSetSources(HOUSEHOLD_ID);

    expect(result).toEqual({
      household_name_set: false,
      child_count: 0,
      child_allergen_count: 0,
      favorite_lunch_count: 0,
    });
  });

  it('calls select with count:exact head:true for count tables', async () => {
    const selectMock = vi.fn().mockReturnThis();
    const fromMock = vi.fn((table: string) => {
      if (table === 'households') {
        return makeHouseholdQuery({ data: { display_name: 'X' }, error: null });
      }
      const builder: { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; then: (resolve: (v: unknown) => unknown) => unknown } = {
        select: selectMock,
        eq: vi.fn(),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ count: 0, error: null }).then(resolve),
      };
      builder.eq.mockReturnValue(builder);
      return builder;
    });
    const client = { from: fromMock } as unknown as SupabaseClient;
    const repo = new OnboardingMomentRepository(client);

    await repo.countRequiredSetSources(HOUSEHOLD_ID);

    // children + child_allergens use 'id', head count.
    // Slice 2.6-s1 — household_recipe_usage uses 'recipe_id'.
    expect(selectMock).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(selectMock).toHaveBeenCalledWith('recipe_id', { count: 'exact', head: true });
  });

  it('throws a wrapped error when the children count query fails', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'households') {
        return makeHouseholdQuery({ data: { display_name: 'X' }, error: null });
      }
      if (table === 'children') return makeCountQuery({ count: null, error: { message: 'denied' } });
      return makeCountQuery({ count: 0, error: null });
    });
    const client = { from: fromMock } as unknown as SupabaseClient;
    const repo = new OnboardingMomentRepository(client);

    await expect(repo.countRequiredSetSources(HOUSEHOLD_ID)).rejects.toThrow(/children.*denied/);
  });
});

describe('OnboardingMomentRepository.upsertState', () => {
  const state: MomentState = {
    current_moment: 'm3_taste',
    required_set_status: {
      m1_household_name: true,
      m1_child_declared: true,
      m2_allergen_response: true,
      m5_favorite_count: 6,
      m5_complete: false,
    },
  };

  it('upserts the state via supabase with onConflict=household_id', async () => {
    const upsertQuery = makeUpsertQuery({ error: null }) as {
      upsert: ReturnType<typeof vi.fn>;
    };
    const fromMock = vi.fn().mockReturnValue(upsertQuery);
    const client = { from: fromMock } as unknown as SupabaseClient;
    const repo = new OnboardingMomentRepository(client);

    await repo.upsertState(HOUSEHOLD_ID, state);

    expect(fromMock).toHaveBeenCalledWith('onboarding_moment_state');
    const args = upsertQuery.upsert.mock.calls[0];
    expect(args?.[0]).toEqual(
      expect.objectContaining({
        household_id: HOUSEHOLD_ID,
        current_moment: 'm3_taste',
        required_set_status: state.required_set_status,
      }),
    );
    expect(args?.[1]).toEqual({ onConflict: 'household_id' });
  });

  it('throws a wrapped error when Supabase reports an upsert failure', async () => {
    const upsertQuery = makeUpsertQuery({ error: { message: 'rls violation' } });
    const fromMock = vi.fn().mockReturnValue(upsertQuery);
    const client = { from: fromMock } as unknown as SupabaseClient;
    const repo = new OnboardingMomentRepository(client);

    await expect(repo.upsertState(HOUSEHOLD_ID, state)).rejects.toThrow(/rls violation/);
  });
});

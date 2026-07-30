import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useBriefView } from './useBriefView.js';

vi.mock('@/lib/fetch.js', () => ({ hkFetch: vi.fn() }));

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_A = '33333333-3333-4333-8333-333333333333';
const CHILD_B = '44444444-4444-4444-8444-444444444444';
const PLAN_ID = '99999999-9999-4999-8999-999999999999';

// A brief with two children (one duplicated) and a paused Tuesday, so the
// derivations under test — childColorMap order, childRoster dedup, editableDays
// paused-filter — all exercise a real branch.
function makeBriefResponse(payloadOverride?: Record<string, unknown>) {
  return {
    brief: {
      household_id: HOUSEHOLD_ID,
      plan_id: PLAN_ID,
      moment_headline: 'A quiet week.',
      lumi_note: '',
      memory_prose: '',
      payload: {
        tile_summaries: [
          { day: 'monday', items: [], paused: false, lunch_link_suppressed_children: [], child_ratings: {} },
          { day: 'tuesday', items: [], paused: true, lunch_link_suppressed_children: [], child_ratings: {} },
          { day: 'wednesday', items: [], paused: false, lunch_link_suppressed_children: [], child_ratings: {} },
        ],
        cleared_allergies: [
          { child_id: CHILD_A, child_name: 'Amara', allergen: 'peanut' },
          { child_id: CHILD_B, child_name: 'Deji', allergen: 'egg' },
          { child_id: CHILD_A, child_name: 'Amara', allergen: 'tree nut' },
        ],
        scaffolding_diff: null,
        plan_state: null,
        plan_state_message: null,
        learning_moment_callout: null,
        plan_reasoning: null,
        ...payloadOverride,
      },
      generated_at: '2026-08-01T00:00:00.000Z',
      plan_revision: 1,
      updated_at: '2026-08-01T00:00:00.000Z',
    },
  };
}

const PLAN_RESPONSE = {
  plan: { confirmed_at: '2026-08-01T12:00:00.000Z' },
  main_assignments: [],
  days: [],
  slots: [],
  variations: [],
  flagged_items: [
    { child_id: CHILD_A, ingredient: 'masala', slot: 'main', day: 'monday' },
  ],
  week_of: '2026-08-04',
};

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { wrapper };
}

function mockRouted(briefResponse: unknown) {
  return async (url: string) => {
    if (url.includes('/brief')) return briefResponse;
    if (url.includes('/plans')) return PLAN_RESPONSE;
    return {};
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useBriefView', () => {
  it('assembles the view-model from the brief + plan queries', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockImplementation(mockRouted(makeBriefResponse()) as never);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useBriefView(HOUSEHOLD_ID), { wrapper });

    await waitFor(() => expect(result.current.brief).not.toBeNull());

    expect(result.current.planId).toBe(PLAN_ID);
    expect(result.current.canSwap).toBe(true);
    expect(result.current.clearedAllergies).toHaveLength(3);
    expect(result.current.tileSummaries).toHaveLength(3);
  });

  it('assigns child colors in first-seen order and dedups the roster', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockImplementation(mockRouted(makeBriefResponse()) as never);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useBriefView(HOUSEHOLD_ID), { wrapper });
    await waitFor(() => expect(result.current.brief).not.toBeNull());

    expect(result.current.childColorMap.size).toBe(2);
    expect(result.current.childColorMap.get(CHILD_A)?.color).toBe('foliage');
    expect(result.current.childColorMap.get(CHILD_B)?.color).toBe('lumi-terracotta');
    expect(result.current.childRoster).toEqual([
      { id: CHILD_A, name: 'Amara' },
      { id: CHILD_B, name: 'Deji' },
    ]);
  });

  // 14-s3 (review D1) — weekDates must follow the plan being displayed, not the
  // wall clock: on Sundays the freshly composed Brief is NEXT week's plan.
  it('anchors weekDates on planData.week_of, not the wall clock', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockImplementation(mockRouted(makeBriefResponse()) as never);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useBriefView(HOUSEHOLD_ID), { wrapper });
    await waitFor(() => expect(result.current.planData).not.toBeUndefined());

    // PLAN_RESPONSE.week_of is 2026-08-04 (a Monday) — far from today's date,
    // so a wall-clock anchor could not produce these values.
    expect(result.current.weekDates['monday']).toBe('2026-08-04');
    expect(result.current.weekDates['friday']).toBe('2026-08-08');
    expect(result.current.weekDates['saturday']).toBe('2026-08-09');
  });

  it('derives editableDays from unpaused tiles only', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockImplementation(mockRouted(makeBriefResponse()) as never);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useBriefView(HOUSEHOLD_ID), { wrapper });
    await waitFor(() => expect(result.current.brief).not.toBeNull());

    // tuesday is paused → excluded.
    expect(result.current.editableDays).toEqual(['mon', 'wed']);
  });

  it('maps flagged_items to banner shape, resolving child names from clearances', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockImplementation(mockRouted(makeBriefResponse()) as never);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useBriefView(HOUSEHOLD_ID), { wrapper });
    await waitFor(() => expect(result.current.flaggedItems).toHaveLength(1));

    expect(result.current.flaggedItems[0]).toEqual({
      childId: CHILD_A,
      childName: 'Amara',
      ingredient: 'masala',
      slot: 'main',
      day: 'monday',
    });
    expect(result.current.weekConfirmed).toBe(true);
  });

  it('defaults payload sub-fields when a pre-migration brief has no payload', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    const preMigration = { brief: { household_id: HOUSEHOLD_ID, plan_id: null, moment_headline: '', lumi_note: '', memory_prose: '', generated_at: '', plan_revision: 1, updated_at: '' } };
    vi.mocked(hkFetch).mockImplementation(mockRouted(preMigration) as never);
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useBriefView(HOUSEHOLD_ID), { wrapper });
    await waitFor(() => expect(result.current.brief).not.toBeNull());

    expect(result.current.clearedAllergies).toEqual([]);
    expect(result.current.tileSummaries).toEqual([]);
    expect(result.current.planId).toBeNull();
    expect(result.current.canSwap).toBe(false);
  });
});

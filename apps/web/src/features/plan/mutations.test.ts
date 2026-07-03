import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useGenerateOnDemandMutation,
  useRequestRegenerationMutation,
  usePlanEditMutation,
  useSwapMainMutation,
} from './mutations.js';
import { QueryKeys } from '@/lib/realtime/query-keys.js';
import type { GetPlansResponse } from '@hivekitchen/types';
import { HkApiError } from '@/lib/fetch.js';

vi.mock('@/lib/fetch.js', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fetch.js')>(
    '@/lib/fetch.js',
  );
  return {
    ...actual,
    hkFetch: vi.fn(),
  };
});

const PLAN_ID = '99999999-9999-4999-8999-999999999999';

function makeWrapper() {
  const client = new QueryClient({
    // gcTime: Infinity — the optimistic-pilot tests seed the plan cache with
    // setQueryData and no useQuery observer; gcTime:0 would GC the entry between
    // the awaited resolve and the read. The app always has a live observer.
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useRequestRegenerationMutation (Story 3.13)', () => {
  it('scope=week: POSTs to /v1/plans/:planId/regenerate?scope=week with Idempotency-Key', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ job_id: 'regen-1', rate_limit_remaining: 4 });
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useRequestRegenerationMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ planId: PLAN_ID, scope: 'week' });
    });

    expect(hkFetch).toHaveBeenCalledWith(
      `/v1/plans/${PLAN_ID}/regenerate?scope=week`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      }),
    );
  });

  it('scope=day: POSTs with ?scope=day&day=tuesday', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ job_id: 'regen-1', rate_limit_remaining: 4 });
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useRequestRegenerationMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        planId: PLAN_ID,
        scope: 'day',
        day: 'tuesday',
      });
    });

    expect(hkFetch).toHaveBeenCalledWith(
      `/v1/plans/${PLAN_ID}/regenerate?scope=day&day=tuesday`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('429 response surfaces as a mutation error (not silent)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockRejectedValue(
      new HkApiError(429, { type: '/errors/too-many-requests' }),
    );
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useRequestRegenerationMutation(), { wrapper });

    await act(async () => {
      await result.current
        .mutateAsync({ planId: PLAN_ID, scope: 'week' })
        .catch(() => undefined);
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBeInstanceOf(HkApiError);
    expect((result.current.error as HkApiError).status).toBe(429);
  });
});

describe('useGenerateOnDemandMutation (Story 3-S34)', () => {
  it('POSTs to /v1/plans/generate with an Idempotency-Key and no body', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      job_id: 'gen-1',
      week_of: '2026-06-15',
      planned_days: ['thursday', 'friday'],
      basis: 'current_week_remaining',
    });
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useGenerateOnDemandMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('test-idempotency-key');
    });

    expect(hkFetch).toHaveBeenCalledWith(
      '/v1/plans/generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': 'test-idempotency-key' }),
      }),
    );
    // No request body — the window is server-derived.
    expect(vi.mocked(hkFetch).mock.calls[0]?.[1]).not.toHaveProperty('body');
  });

  it('409 (plan already exists) surfaces as a mutation error', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockRejectedValue(
      new HkApiError(409, { type: '/errors/plan-already-exists' }),
    );
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useGenerateOnDemandMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('test-idempotency-key').catch(() => undefined);
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect((result.current.error as HkApiError).status).toBe(409);
  });
});

// Epic 13-s10 — the conversational plan-edit mutation + the swap-main optimistic pilot.
describe('usePlanEditMutation (Epic 13-s10)', () => {
  it('POSTs an utterance to /v1/plans/:planId/edit with a UUID Idempotency-Key', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      intent: { intent: 'swap_slot', confidence: 0.9 },
      tier: 'T1',
      result: { status: 'clarify', reason: 'day_required' },
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => usePlanEditMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ planId: PLAN_ID, body: { utterance: 'swap monday' } });
    });

    expect(hkFetch).toHaveBeenCalledWith(
      `/v1/plans/${PLAN_ID}/edit`,
      expect.objectContaining({
        method: 'POST',
        body: { utterance: 'swap monday' },
        headers: expect.objectContaining({
          'Idempotency-Key': expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          ),
        }),
      }),
    );
  });

  it('a chip/confirm bypass sends { intent } and NEVER an utterance (zero classifier)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      intent: { intent: 'commit', confidence: 1 },
      tier: 'T0',
      result: { status: 'acknowledged', action: 'commit', confirmed_at: '2026-06-29T10:00:00Z' },
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => usePlanEditMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        planId: PLAN_ID,
        body: { intent: { intent: 'commit', confidence: 1 } },
      });
    });

    const body = vi.mocked(hkFetch).mock.calls[0]?.[1]?.body as Record<string, unknown>;
    expect(body).toHaveProperty('intent');
    expect(body).not.toHaveProperty('utterance');
  });
});

function seedPlanCache(client: QueryClient, recipeId: string) {
  const response = {
    plan: { id: 'plan-1' },
    main_assignments: [
      { id: 'main-1', plan_id: 'plan-1', sequence: 1, recipe_id: recipeId, created_at: 'x' },
    ],
    days: [],
    slots: [],
    variations: [],
    is_draft: false,
    week_of: '2026-06-29',
  } as unknown as GetPlansResponse;
  client.setQueryData(QueryKeys.planByWeek('current'), response);
}

describe('useSwapMainMutation optimistic pilot (Epic 13-s10 AC10)', () => {
  it('writes the new recipe optimistically before the response, then rolls back on error', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    let rejectFetch!: (e: Error) => void;
    vi.mocked(hkFetch).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectFetch = reject;
      }),
    );
    const { client, wrapper } = makeWrapper();
    seedPlanCache(client, 'old-recipe');

    const { result } = renderHook(() => useSwapMainMutation(), { wrapper });

    act(() => {
      result.current.mutate({
        planId: 'plan-1',
        mainAssignmentId: 'main-1',
        input: { new_recipe_id: 'new-recipe' },
      });
    });

    // Optimistic: the cache shows the new recipe while the request is in flight.
    await waitFor(() => {
      const cached = client.getQueryData<GetPlansResponse>(QueryKeys.planByWeek('current'));
      expect(cached?.main_assignments[0]?.recipe_id).toBe('new-recipe');
    });

    act(() => rejectFetch(new Error('network')));

    // Rollback restores the snapshot.
    await waitFor(() => {
      const cached = client.getQueryData<GetPlansResponse>(QueryKeys.planByWeek('current'));
      expect(cached?.main_assignments[0]?.recipe_id).toBe('old-recipe');
    });
  });

  it('keeps the optimistic write on success (no onSuccess refetch — SSE reconciles)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ main_assignment: { id: 'main-1' } });
    const { client, wrapper } = makeWrapper();
    seedPlanCache(client, 'old-recipe');

    const { result } = renderHook(() => useSwapMainMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        planId: 'plan-1',
        mainAssignmentId: 'main-1',
        input: { new_recipe_id: 'new-recipe' },
      });
    });

    const cached = client.getQueryData<GetPlansResponse>(QueryKeys.planByWeek('current'));
    expect(cached?.main_assignments[0]?.recipe_id).toBe('new-recipe');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useComposeLifecycle } from './useComposeLifecycle.js';
import { usePlanProgressStore } from '@/stores/plan-progress.store.js';

vi.mock('@/lib/fetch.js', () => ({ hkFetch: vi.fn() }));

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '99999999-9999-4999-8999-999999999999';

function briefWithRevision(rev: number) {
  return { household_id: HOUSEHOLD_ID, plan_id: PLAN_ID, plan_revision: rev, updated_at: '' } as never;
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { wrapper, client };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  usePlanProgressStore.getState().reset();
  vi.restoreAllMocks();
});

describe('useComposeLifecycle', () => {
  it('starts not-regenerating', () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useComposeLifecycle({ householdId: HOUSEHOLD_ID, planId: PLAN_ID, brief: briefWithRevision(1) }),
      { wrapper },
    );
    expect(result.current.isRegenerating).toBe(false);
  });

  it('handleRegenerate posts to /regenerate and enters the regenerating state', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ job_id: 'j1' } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useComposeLifecycle({ householdId: HOUSEHOLD_ID, planId: PLAN_ID, brief: briefWithRevision(1) }),
      { wrapper },
    );

    act(() => result.current.handleRegenerate('week'));

    await waitFor(() => expect(result.current.isRegenerating).toBe(true));
    expect(hkFetch).toHaveBeenCalledWith(
      expect.stringContaining(`/v1/plans/${PLAN_ID}/regenerate`),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('clears the regenerating state when plan_revision bumps', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ job_id: 'j1' } as never);
    const { wrapper } = makeWrapper();
    const { result, rerender } = renderHook(
      (props: { rev: number }) =>
        useComposeLifecycle({ householdId: HOUSEHOLD_ID, planId: PLAN_ID, brief: briefWithRevision(props.rev) }),
      { wrapper, initialProps: { rev: 1 } },
    );

    act(() => result.current.handleRegenerate('week'));
    await waitFor(() => expect(result.current.isRegenerating).toBe(true));

    // A committed plan bumps plan_revision → the effect stops the spinner.
    rerender({ rev: 2 });
    await waitFor(() => expect(result.current.isRegenerating).toBe(false));
  });

  it('handleRegenerate is a no-op without a plan', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useComposeLifecycle({ householdId: HOUSEHOLD_ID, planId: null, brief: null }),
      { wrapper },
    );

    act(() => result.current.handleRegenerate('week'));
    expect(hkFetch).not.toHaveBeenCalled();
    expect(result.current.isRegenerating).toBe(false);
  });

  it('handleConfirmWeek posts a commit intent to /edit', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({} as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useComposeLifecycle({ householdId: HOUSEHOLD_ID, planId: PLAN_ID, brief: briefWithRevision(1) }),
      { wrapper },
    );

    act(() => result.current.handleConfirmWeek());

    await waitFor(() =>
      expect(hkFetch).toHaveBeenCalledWith(
        `/v1/plans/${PLAN_ID}/edit`,
        expect.objectContaining({ method: 'POST', body: { intent: { intent: 'commit', confidence: 1 } } }),
      ),
    );
  });

  it('clears the regenerating state when a plan.progress "failed" is pushed', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ job_id: 'j1' } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useComposeLifecycle({ householdId: HOUSEHOLD_ID, planId: PLAN_ID, brief: briefWithRevision(1) }),
      { wrapper },
    );

    act(() => result.current.handleRegenerate('week'));
    await waitFor(() => expect(result.current.isRegenerating).toBe(true));

    // A permanent failure pushes plan.progress: failed → spinner stops without a
    // plan_revision bump.
    act(() => usePlanProgressStore.getState().setProgress('2026-08-04', 'failed'));
    await waitFor(() => expect(result.current.isRegenerating).toBe(false));
  });

  it('handleBannerRetry delegates to a week regenerate when a plan exists', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ job_id: 'j1' } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useComposeLifecycle({ householdId: HOUSEHOLD_ID, planId: PLAN_ID, brief: briefWithRevision(1) }),
      { wrapper },
    );

    act(() => result.current.handleBannerRetry());

    await waitFor(() => expect(result.current.isRegenerating).toBe(true));
    expect(hkFetch).toHaveBeenCalledWith(
      expect.stringContaining(`/v1/plans/${PLAN_ID}/regenerate`),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('handleBannerRetry invalidates queries (no regenerate) when there is no plan', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    const { wrapper, client } = makeWrapper();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(
      () => useComposeLifecycle({ householdId: HOUSEHOLD_ID, planId: null, brief: null }),
      { wrapper },
    );

    act(() => result.current.handleBannerRetry());

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['brief'] });
    expect(hkFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/regenerate'),
      expect.anything(),
    );
  });
});

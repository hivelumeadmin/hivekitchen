import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useGenerateOnDemandMutation,
  useRequestRegenerationMutation,
} from './mutations.js';
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
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
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

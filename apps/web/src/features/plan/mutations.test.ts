import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRequestRegenerationMutation } from './mutations.js';
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

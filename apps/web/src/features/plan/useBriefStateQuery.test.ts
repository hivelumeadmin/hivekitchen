import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useBriefStateQuery } from './useBriefStateQuery.js';

vi.mock('@/lib/fetch.js', () => ({
  hkFetch: vi.fn(),
}));

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
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

describe('useBriefStateQuery', () => {
  it('is disabled (fetchStatus idle) when householdId is null', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    const { wrapper } = makeWrapper();

    const { result } = renderHook(() => useBriefStateQuery(null), { wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(hkFetch).not.toHaveBeenCalled();
  });

  it('uses query key shape ["brief", householdId]', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ brief: null });
    const { client, wrapper } = makeWrapper();

    renderHook(() => useBriefStateQuery(HOUSEHOLD_ID), { wrapper });

    await waitFor(() => {
      expect(client.getQueryData(['brief', HOUSEHOLD_ID])).toEqual({ brief: null });
    });
  });

  it('calls hkFetch with the brief path and method GET', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ brief: null });
    const { wrapper } = makeWrapper();

    renderHook(() => useBriefStateQuery(HOUSEHOLD_ID), { wrapper });

    await waitFor(() => {
      expect(hkFetch).toHaveBeenCalledWith(
        `/v1/households/${HOUSEHOLD_ID}/brief`,
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });
});

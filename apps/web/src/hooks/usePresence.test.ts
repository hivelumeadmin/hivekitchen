import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthUser } from '@hivekitchen/types';
import { useAuthStore } from '@/stores/auth.store.js';
import { usePresence } from './usePresence.js';

vi.mock('@/lib/fetch.js', () => ({
  hkFetch: vi.fn(),
}));

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PARTNER_ID = '22222222-2222-4222-8222-222222222222';

function authUser(householdId: string | null): AuthUser {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    email: 'parent@example.com',
    display_name: 'Parent',
    current_household_id: householdId,
    role: 'primary_parent',
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('test-uuid') });
  useAuthStore.setState({ accessToken: 'token', user: authUser(HOUSEHOLD_ID) });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  useAuthStore.setState({ accessToken: null, user: null });
});

describe('usePresence', () => {
  it('sends a heartbeat POST immediately on mount', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ partners: [] });

    renderHook(() => usePresence('brief'), { wrapper });

    await waitFor(() => {
      expect(vi.mocked(hkFetch)).toHaveBeenCalledWith(
        '/v1/presence/heartbeat',
        expect.objectContaining({ method: 'POST', body: { surface: 'brief' } }),
      );
    });
  });

  it('sends a DELETE on unmount', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ partners: [] });

    const { unmount } = renderHook(() => usePresence('brief'), { wrapper });
    unmount();

    expect(vi.mocked(hkFetch)).toHaveBeenCalledWith(
      '/v1/presence',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('returns the partners array populated from query data', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockImplementation((path: string, init?: { method?: string }) => {
      if (path === '/v1/presence' && init?.method === 'GET') {
        return Promise.resolve({
          partners: [
            {
              user_id: PARTNER_ID,
              display_name: 'Priya',
              surface: 'brief',
              expires_at: '2026-06-06T12:00:00.000Z',
            },
          ],
        });
      }
      return Promise.resolve({ partners: [] });
    });

    const { result } = renderHook(() => usePresence('brief'), { wrapper });

    await waitFor(() => {
      expect(result.current.partners).toHaveLength(1);
    });
    expect(result.current.partners[0]?.user_id).toBe(PARTNER_ID);
  });

  it('returns an empty array when there is no household (query disabled)', () => {
    useAuthStore.setState({ accessToken: 'token', user: authUser(null) });

    const { result } = renderHook(() => usePresence('brief'), { wrapper });

    expect(result.current.partners).toEqual([]);
  });
});

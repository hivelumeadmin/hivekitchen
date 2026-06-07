import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const hkFetchMock = vi.fn();
vi.mock('@/lib/fetch.js', () => ({
  hkFetch: (path: string, init: unknown) => hkFetchMock(path, init),
  HkApiError: class HkApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly problem: unknown,
    ) {
      super(`HK API error ${status}`);
    }
  },
}));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<object>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

import { HkApiError } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';
import InviteRedeemPage from './$token.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

// Build a token in the same shape InviteService.createInvite emits:
// base64url(rawJwt) where rawJwt = header.payload.sig.
function base64UrlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeInviteToken(role: string): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(JSON.stringify({ role, household_id: HOUSEHOLD_ID }));
  return base64UrlEncode(`${header}.${payload}.sig`);
}

function renderAt(token: string) {
  render(
    <MemoryRouter initialEntries={[`/invite/${token}`]}>
      <Routes>
        <Route path="/invite/:token" element={<InviteRedeemPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function setAuthenticated() {
  useAuthStore.setState({
    accessToken: 'stale-token',
    user: {
      id: '55555555-5555-4555-8555-555555555555',
      email: 'partner@example.com',
      display_name: 'Partner',
      current_household_id: null,
      role: 'primary_parent',
    },
  });
}

describe('InviteRedeemPage (5-S2)', () => {
  beforeEach(() => {
    hkFetchMock.mockReset();
    navigateSpy.mockClear();
  });

  afterEach(() => {
    cleanup();
    useAuthStore.getState().clearSession();
  });

  it('shows the accept interstitial then calls accept on click when role=secondary_caregiver', async () => {
    setAuthenticated();
    const freshUser = {
      id: '55555555-5555-4555-8555-555555555555',
      email: 'partner@example.com',
      display_name: 'Partner',
      current_household_id: HOUSEHOLD_ID,
      role: 'secondary_caregiver' as const,
    };
    hkFetchMock.mockResolvedValue({
      access_token: 'fresh-token',
      user: freshUser,
      household_id: HOUSEHOLD_ID,
      scope_target: '/app',
    });

    renderAt(makeInviteToken('secondary_caregiver'));

    // Interstitial must appear before any API call.
    const acceptBtn = await screen.findByRole('button', { name: /accept invitation/i });
    expect(hkFetchMock).not.toHaveBeenCalled();

    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(hkFetchMock).toHaveBeenCalled();
    });
    expect(hkFetchMock.mock.calls[0]![0]).toBe('/v1/auth/invites/accept');
    await waitFor(() => {
      expect(useAuthStore.getState().accessToken).toBe('fresh-token');
    });
    expect(navigateSpy).toHaveBeenCalledWith('/app', { replace: true });
  });

  it('shows the expired message when accept returns 410', async () => {
    setAuthenticated();
    hkFetchMock.mockRejectedValue(new HkApiError(410, null));

    renderAt(makeInviteToken('secondary_caregiver'));

    const acceptBtn = await screen.findByRole('button', { name: /accept invitation/i });
    fireEvent.click(acceptBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/expired or already been used/i);
  });

  it('still calls redeem (not accept) when role=guest_author', async () => {
    setAuthenticated();
    hkFetchMock.mockResolvedValue({
      role: 'guest_author',
      scope_target: '/guest-author/compose',
      household_id: HOUSEHOLD_ID,
    });

    renderAt(makeInviteToken('guest_author'));

    await waitFor(() => {
      expect(hkFetchMock).toHaveBeenCalled();
    });
    expect(hkFetchMock.mock.calls[0]![0]).toBe('/v1/auth/invites/redeem');
    expect(navigateSpy).toHaveBeenCalledWith('/guest-author/compose', { replace: true });
  });

  it('redirects to login when unauthenticated', async () => {
    useAuthStore.getState().clearSession();
    const token = makeInviteToken('secondary_caregiver');

    renderAt(token);

    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalled();
    });
    expect(navigateSpy.mock.calls[0]![0]).toContain('/auth/login?next=');
    expect(hkFetchMock).not.toHaveBeenCalled();
  });
});

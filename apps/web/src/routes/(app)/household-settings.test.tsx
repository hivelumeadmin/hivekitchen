import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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

vi.mock('@/hooks/useLumiContext.js', () => ({
  useLumiContext: vi.fn(),
}));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<object>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

import { useAuthStore } from '@/stores/auth.store.js';
import HouseholdSettingsRoute from './household-settings.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const PRIMARY_ID = '11111111-1111-4111-8111-111111111111';
const SECONDARY_ID = '55555555-5555-4555-8555-555555555555';

const members = [
  { user_id: PRIMARY_ID, display_name: 'Alex', role: 'primary_parent' },
  { user_id: SECONDARY_ID, display_name: 'Sam', role: 'secondary_caregiver' },
];

function setAuth(role: 'primary_parent' | 'secondary_caregiver') {
  useAuthStore.setState({
    accessToken: 'token',
    user: {
      id: role === 'primary_parent' ? PRIMARY_ID : SECONDARY_ID,
      email: 'user@example.com',
      display_name: role === 'primary_parent' ? 'Alex' : 'Sam',
      current_household_id: HOUSEHOLD_ID,
      role,
    },
  });
}

function renderRoute() {
  render(
    <MemoryRouter initialEntries={['/app/household/settings']}>
      <HouseholdSettingsRoute />
    </MemoryRouter>,
  );
}

describe('HouseholdSettingsRoute (5-S2)', () => {
  beforeEach(() => {
    hkFetchMock.mockReset();
    navigateSpy.mockClear();
  });

  afterEach(() => {
    cleanup();
    useAuthStore.getState().clearSession();
  });

  it('renders the member list from GET /members', async () => {
    setAuth('primary_parent');
    hkFetchMock.mockResolvedValue({ household_display_name: null, members });
    renderRoute();

    expect(await screen.findByText('Alex')).toBeDefined();
    expect(screen.getByText('Sam')).toBeDefined();
    expect(screen.getByText('Primary Parent')).toBeDefined();
    expect(screen.getByText('Caregiver')).toBeDefined();
  });

  it('shows the invite section for a primary_parent', async () => {
    setAuth('primary_parent');
    hkFetchMock.mockResolvedValue({ household_display_name: null, members });
    renderRoute();

    await screen.findByText('Alex');
    expect(screen.getByRole('button', { name: /invite partner/i })).toBeDefined();
  });

  it('hides the invite section for a secondary_caregiver', async () => {
    setAuth('secondary_caregiver');
    hkFetchMock.mockResolvedValue({ household_display_name: null, members });
    renderRoute();

    await screen.findByText('Alex');
    expect(screen.queryByRole('button', { name: /invite partner/i })).toBeNull();
  });

  it('calls POST /invites on submit and shows the invite URL', async () => {
    setAuth('primary_parent');
    hkFetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/members')) return Promise.resolve({ household_display_name: null, members });
      if (path.endsWith('/invites')) return Promise.resolve({ invite_url: '/invite/abc123' });
      throw new Error(`unexpected path ${path}`);
    });
    renderRoute();

    await screen.findByText('Alex');
    fireEvent.click(screen.getByRole('button', { name: /invite partner/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate invite link/i }));

    await waitFor(() => {
      expect(screen.getByText(/\/invite\/abc123$/)).toBeDefined();
    });
    const inviteCall = hkFetchMock.mock.calls.find((c) => String(c[0]).endsWith('/invites'));
    expect(inviteCall).toBeDefined();
    expect((inviteCall![1] as { body: unknown }).body).toMatchObject({
      role: 'secondary_caregiver',
    });
  });

  it('renders the geolocation section for a primary_parent', async () => {
    setAuth('primary_parent');
    hkFetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/members')) return Promise.resolve({ household_display_name: null, members });
      if (path.endsWith('/geolocation-consent'))
        return Promise.resolve({
          geolocation_enabled: false,
          geolocation_consented_at: null,
          geolocation_purpose: null,
        });
      throw new Error(`unexpected path ${path}`);
    });
    renderRoute();

    expect(await screen.findByText('Find cultural suppliers near me')).toBeDefined();
    expect(screen.getByRole('switch')).toBeDefined();
  });

  it('does not render the geolocation section for a guest_author', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      user: {
        id: SECONDARY_ID,
        email: 'kid@example.com',
        display_name: 'Kid',
        current_household_id: HOUSEHOLD_ID,
        role: 'guest_author',
      },
    });
    hkFetchMock.mockResolvedValue({ household_display_name: null, members });
    renderRoute();

    await screen.findByText('Alex');
    expect(screen.queryByText('Find cultural suppliers near me')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('calls PATCH with enabled+purpose when browser permission is granted', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) =>
      success({ coords: {} as GeolocationCoordinates, timestamp: 0 } as GeolocationPosition),
    );
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });
    setAuth('primary_parent');
    hkFetchMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path.endsWith('/members')) return Promise.resolve({ household_display_name: null, members });
      if (path.endsWith('/geolocation-consent') && (!init || init.method === 'GET'))
        return Promise.resolve({
          geolocation_enabled: false,
          geolocation_consented_at: null,
          geolocation_purpose: null,
        });
      if (path.endsWith('/geolocation-consent') && init?.method === 'PATCH')
        return Promise.resolve({
          geolocation_enabled: true,
          geolocation_consented_at: '2026-10-22T10:00:00.000Z',
          geolocation_purpose: 'cultural_supplier_routing',
        });
      throw new Error(`unexpected path ${path}`);
    });
    renderRoute();

    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);

    await waitFor(() => {
      const patchCall = hkFetchMock.mock.calls.find(
        (c) => String(c[0]).endsWith('/geolocation-consent') && (c[1] as { method?: string })?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      expect((patchCall![1] as { body: unknown }).body).toMatchObject({
        geolocation_enabled: true,
        geolocation_purpose: 'cultural_supplier_routing',
      });
    });
  });

  it('shows an error and reverts when browser permission is denied', async () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, error?: PositionErrorCallback) =>
      error?.({ code: 1, message: 'User denied Geolocation' } as unknown as GeolocationPositionError),
    );
    Object.defineProperty(navigator, 'geolocation', {
      value: { getCurrentPosition },
      configurable: true,
    });
    setAuth('primary_parent');
    hkFetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/members')) return Promise.resolve({ household_display_name: null, members });
      if (path.endsWith('/geolocation-consent'))
        return Promise.resolve({
          geolocation_enabled: false,
          geolocation_consented_at: null,
          geolocation_purpose: null,
        });
      throw new Error(`unexpected path ${path}`);
    });
    renderRoute();

    const toggle = await screen.findByRole('switch');
    fireEvent.click(toggle);

    expect(
      await screen.findByText('Location access was denied. Enable it in your browser settings.'),
    ).toBeDefined();
    // Toggle must be unchecked after denial (reverted to off state).
    expect((toggle as HTMLInputElement).checked).toBe(false);
    // No PATCH was attempted — the API is never called when permission is denied.
    const patchCall = hkFetchMock.mock.calls.find(
      (c) => String(c[0]).endsWith('/geolocation-consent') && (c[1] as { method?: string })?.method === 'PATCH',
    );
    expect(patchCall).toBeUndefined();
  });

  it('copies the invite URL to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    setAuth('primary_parent');
    hkFetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/members')) return Promise.resolve({ household_display_name: null, members });
      if (path.endsWith('/invites')) return Promise.resolve({ invite_url: '/invite/abc123' });
      throw new Error(`unexpected path ${path}`);
    });
    renderRoute();

    await screen.findByText('Alex');
    fireEvent.click(screen.getByRole('button', { name: /invite partner/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate invite link/i }));
    const copyButton = await screen.findByRole('button', { name: /copy/i });
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/invite/abc123'));
    });
  });
});

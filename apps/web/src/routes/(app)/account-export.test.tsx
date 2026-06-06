import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type * as ReactRouterDom from 'react-router-dom';
import type { UserProfile } from '@hivekitchen/types';

const hkFetchMock = vi.fn();
const hkFetchBlobMock = vi.fn();
vi.mock('@/lib/fetch.js', () => ({
  hkFetch: (path: string, init: unknown) => hkFetchMock(path, init),
  hkFetchBlob: (path: string, init: unknown) => hkFetchBlobMock(path, init),
  HkApiError: class HkApiError extends Error {},
}));

vi.mock('@hivekitchen/ui', () => ({
  useScope: vi.fn(),
}));

vi.mock('@/hooks/useLumiContext.js', () => ({
  useLumiContext: vi.fn(),
}));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

import { useAuthStore } from '@/stores/auth.store.js';
import AccountPage from './account.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const EXPORT_PATH = `/v1/households/${HOUSEHOLD_ID}/export`;

function sampleProfile(): UserProfile {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'parent@example.com',
    display_name: 'Parent',
    preferred_language: 'en',
    role: 'primary_parent',
    auth_providers: ['email'],
    notification_prefs: {
      weekly_plan_ready: true,
      grocery_list_ready: true,
      proactive_lumi_nudges: true,
    },
    cultural_language: 'default',
    parental_notice_acknowledged_at: null,
    parental_notice_acknowledged_version: null,
    is_onboarded: true,
    is_onboarding_in_progress: false,
  } as UserProfile;
}

function setAuthenticated() {
  useAuthStore.setState({
    accessToken: 'token',
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'parent@example.com',
      display_name: 'Parent',
      current_household_id: HOUSEHOLD_ID,
      role: 'primary_parent',
    },
  });
}

function renderRoute() {
  render(
    <MemoryRouter initialEntries={['/app/account']}>
      <AccountPage />
    </MemoryRouter>,
  );
}

describe('AccountPage — Data portability section (7-S10)', () => {
  beforeEach(() => {
    hkFetchMock.mockReset();
    hkFetchBlobMock.mockReset();
    navigateSpy.mockClear();
    // Default: profile loads; export POST resolves with a 202 body.
    hkFetchMock.mockImplementation((path: string) => {
      if (path === '/v1/users/me') return Promise.resolve(sampleProfile());
      return Promise.resolve({ status: 'queued', message: 'ok' });
    });
    setAuthenticated();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAuthStore.getState().clearSession();
    useAuthStore.setState({ user: null });
  });

  it('renders an enabled "Export my data" button when idle', async () => {
    renderRoute();
    const button = await screen.findByRole('button', { name: 'Export my data' });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables the button and shows "Exporting…" while the request is pending', async () => {
    hkFetchMock.mockImplementation((path: string) => {
      if (path === '/v1/users/me') return Promise.resolve(sampleProfile());
      return new Promise(() => {}); // never resolves — keeps the export pending
    });
    renderRoute();

    const button = await screen.findByRole('button', { name: 'Export my data' });
    fireEvent.click(button);

    const pending = await screen.findByRole('button', { name: 'Exporting…' });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
  });

  it('replaces the button with confirmation copy on success', async () => {
    renderRoute();
    const button = await screen.findByRole('button', { name: 'Export my data' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/preparing your export/i)).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Export my data' })).toBeNull();
    expect(hkFetchMock).toHaveBeenCalledWith(EXPORT_PATH, { method: 'POST' });
  });

  it('shows a role="alert" error line when the export request fails', async () => {
    hkFetchMock.mockImplementation((path: string) => {
      if (path === '/v1/users/me') return Promise.resolve(sampleProfile());
      return Promise.reject(new Error('boom'));
    });
    renderRoute();

    const button = await screen.findByRole('button', { name: 'Export my data' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/something went wrong/i);
    });
    // Button returns to active state.
    expect(screen.getByRole('button', { name: 'Export my data' })).toBeTruthy();
  });
});

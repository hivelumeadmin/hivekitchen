import type * as UiModule from '@hivekitchen/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ReactRouterDom from 'react-router-dom';
import type { UserProfile } from '@hivekitchen/types';

const hkFetchMock = vi.fn();
const hkFetchBlobMock = vi.fn();
vi.mock('@/lib/fetch.js', () => ({
  hkFetch: (path: string, init: unknown) => hkFetchMock(path, init),
  hkFetchBlob: (path: string, init: unknown) => hkFetchBlobMock(path, init),
  HkApiError: class HkApiError extends Error {
    constructor(public readonly status: number) {
      super(`HK API error ${status}`);
    }
  },
}));

vi.mock('@hivekitchen/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof UiModule>()),
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
const DELETE_PATH = `/v1/households/${HOUSEHOLD_ID}/delete`;
const KITCHEN_MAP_PATH = `/v1/households/${HOUSEHOLD_ID}/kitchen-map`;
const HOUSEHOLD_NAME = 'The Menon Kitchen';

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

const logoutSpy = vi.fn().mockResolvedValue(undefined);

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
    logout: logoutSpy,
  });
}

function renderRoute() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/account']}>
        <AccountPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Default hkFetch: profile loads, kitchen-map returns the household name, the
// delete POST resolves. Individual tests override the delete leg as needed.
function defaultHkFetch(path: string): Promise<unknown> {
  if (path === '/v1/users/me') return Promise.resolve(sampleProfile());
  if (path === KITCHEN_MAP_PATH) {
    return Promise.resolve({ household: { display_name: HOUSEHOLD_NAME } });
  }
  if (path === DELETE_PATH) return Promise.resolve({ status: 'scheduled' });
  return Promise.resolve({});
}

async function openDialog(): Promise<void> {
  const open = await screen.findByRole('button', { name: 'Delete my account' });
  fireEvent.click(open);
  await screen.findByRole('dialog');
}

describe('AccountPage — Delete account section (7-S11)', () => {
  beforeEach(() => {
    hkFetchMock.mockReset();
    hkFetchBlobMock.mockReset();
    navigateSpy.mockClear();
    logoutSpy.mockClear();
    hkFetchMock.mockImplementation(defaultHkFetch);
    setAuthenticated();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAuthStore.getState().clearSession();
    useAuthStore.setState({ user: null });
  });

  it('renders the "Delete my account" button', async () => {
    renderRoute();
    expect(await screen.findByRole('button', { name: 'Delete my account' })).toBeTruthy();
  });

  it('opens the confirmation dialog when the button is clicked', async () => {
    renderRoute();
    await openDialog();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('keeps "Delete forever" disabled while the input is empty', async () => {
    renderRoute();
    await openDialog();
    await screen.findByLabelText(`Type "${HOUSEHOLD_NAME}" to confirm`);
    const confirm = screen.getByRole('button', { name: 'Delete forever' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps "Delete forever" disabled when the input does not match the household name', async () => {
    renderRoute();
    await openDialog();
    const input = await screen.findByLabelText(`Type "${HOUSEHOLD_NAME}" to confirm`);
    fireEvent.change(input, { target: { value: 'Wrong Name' } });
    const confirm = screen.getByRole('button', { name: 'Delete forever' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables "Delete forever" when the input matches (case-insensitive, trimmed)', async () => {
    renderRoute();
    await openDialog();
    const input = await screen.findByLabelText(`Type "${HOUSEHOLD_NAME}" to confirm`);
    fireEvent.change(input, { target: { value: '  the menon kitchen  ' } });
    const confirm = screen.getByRole('button', { name: 'Delete forever' });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  it('logs out and redirects to /auth/login on a successful deletion', async () => {
    renderRoute();
    await openDialog();
    const input = await screen.findByLabelText(`Type "${HOUSEHOLD_NAME}" to confirm`);
    fireEvent.change(input, { target: { value: HOUSEHOLD_NAME } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete forever' }));

    await waitFor(() => {
      expect(hkFetchMock).toHaveBeenCalledWith(DELETE_PATH, {
        method: 'POST',
        body: { confirmation_name: HOUSEHOLD_NAME },
      });
    });

    await waitFor(
      () => {
        expect(logoutSpy).toHaveBeenCalled();
        expect(navigateSpy).toHaveBeenCalledWith('/auth/login', { replace: true });
      },
      { timeout: 3000 },
    );
  });

  it('shows a role="alert" error and does not log out when the deletion fails', async () => {
    hkFetchMock.mockImplementation((path: string) => {
      if (path === DELETE_PATH) return Promise.reject(new Error('boom'));
      return defaultHkFetch(path);
    });
    renderRoute();
    await openDialog();
    const input = await screen.findByLabelText(`Type "${HOUSEHOLD_NAME}" to confirm`);
    fireEvent.change(input, { target: { value: HOUSEHOLD_NAME } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete forever' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/something went wrong/i);
    });
    expect(logoutSpy).not.toHaveBeenCalled();
    // Dialog stays open and the button re-enables so the user can retry.
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Delete forever' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

import type * as UiModule from '@hivekitchen/ui';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { FlavorPassportResponse, FlavorPassportStamp } from '@hivekitchen/types';

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

vi.mock('@hivekitchen/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof UiModule>()),
  useScope: vi.fn(),
}));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<object>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
    useParams: () => ({ childId: CHILD_ID }),
  };
});

import { HkApiError } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';
import ChildFlavorPassportPage from './child-flavor-passport.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';

function makeStamp(overrides: Partial<FlavorPassportStamp> = {}): FlavorPassportStamp {
  return {
    recipe_id: '44444444-4444-4444-8444-444444444444',
    recipe_name: 'Tikka wrap',
    slot_kind: 'main',
    signal_type: 'loved',
    signal_date: '2026-06-01',
    cuisine_tags: ['south_asian'],
    method_caption: null,
    child_voice_quote: null,
    ...overrides,
  };
}

function makePassport(overrides: Partial<FlavorPassportResponse> = {}): FlavorPassportResponse {
  return {
    child_id: CHILD_ID,
    state: 'developing',
    stamps: [makeStamp()],
    ...overrides,
  };
}

interface MockOpts {
  passport?: FlavorPassportResponse;
  resetResolve?: unknown;
  resetReject?: unknown;
}

function mockApi(opts: MockOpts = {}) {
  const passport = opts.passport ?? makePassport();
  hkFetchMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path.endsWith('/reset-flavor-journey')) {
      if (opts.resetReject !== undefined) return Promise.reject(opts.resetReject);
      return Promise.resolve(
        opts.resetResolve ?? { child_id: CHILD_ID, reset_at: '2026-06-04T12:00:00.000Z' },
      );
    }
    if (path.endsWith('/flavor-passport')) return Promise.resolve(passport);
    // GET child name.
    void init;
    return Promise.resolve({ child: { name: 'Layla' } });
  });
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
    <MemoryRouter initialEntries={[`/app/children/${CHILD_ID}/flavor-passport`]}>
      <ChildFlavorPassportPage />
    </MemoryRouter>,
  );
}

describe('ChildFlavorPassportPage — annual reset (7-S7)', () => {
  beforeEach(() => {
    hkFetchMock.mockReset();
    navigateSpy.mockClear();
    setAuthenticated();
  });

  afterEach(() => {
    cleanup();
    useAuthStore.getState().clearSession();
  });

  it('renders the reset button once the passport loads (AC1)', async () => {
    mockApi();
    renderRoute();

    expect(
      await screen.findByRole('button', { name: /Reset Layla's flavor journey/i }),
    ).toBeDefined();
  });

  it('opens the confirmation dialog when the reset button is clicked (AC2)', async () => {
    mockApi();
    renderRoute();

    const trigger = await screen.findByRole('button', { name: /Reset Layla's flavor journey/i });
    fireEvent.click(trigger);

    expect(await screen.findByRole('dialog')).toBeDefined();
    expect(screen.getByText(/will be\s+soft-forgotten/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /^Reset journey$/i })).toBeDefined();
  });

  it('closes the dialog on Cancel without calling the reset API (AC2)', async () => {
    mockApi();
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: /Reset Layla's flavor journey/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Cancel/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      hkFetchMock.mock.calls.some(([path]) => String(path).endsWith('/reset-flavor-journey')),
    ).toBe(false);
  });

  it('on confirm, calls the reset endpoint, clears stamps, and shows the confirmation (AC3)', async () => {
    mockApi();
    renderRoute();

    // The passport stamp is visible before reset.
    expect(await screen.findByText('Tikka wrap')).toBeDefined();

    fireEvent.click(await screen.findByRole('button', { name: /Reset Layla's flavor journey/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Reset journey$/i }));

    await waitFor(() => {
      expect(
        hkFetchMock.mock.calls.some(
          ([path, init]) =>
            String(path).endsWith('/reset-flavor-journey') &&
            (init as { method?: string }).method === 'POST',
        ),
      ).toBe(true);
    });

    expect(await screen.findByText(/Flavor journey reset on/i)).toBeDefined();
    // Stamps cleared → the empty state replaces the stamp card.
    expect(screen.queryByText('Tikka wrap')).toBeNull();
  });

  it('on 409 cooldown, closes the dialog and shows the cooldown error (AC6)', async () => {
    mockApi({
      resetReject: new HkApiError(409, {
        detail: 'flavor journey was already reset on 2026-01-15T00:00:00.000Z',
      }),
    });
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: /Reset Layla's flavor journey/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Reset journey$/i }));

    expect(await screen.findByText(/Already reset on/i)).toBeDefined();
    expect(screen.getByText(/You can reset again after/i)).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('on a generic API error, shows the fallback error message (AC6 fallback)', async () => {
    mockApi({ resetReject: new HkApiError(500, { detail: 'boom' }) });
    renderRoute();

    fireEvent.click(await screen.findByRole('button', { name: /Reset Layla's flavor journey/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^Reset journey$/i }));

    expect(await screen.findByText(/Could not reset flavor journey/i)).toBeDefined();
  });
});

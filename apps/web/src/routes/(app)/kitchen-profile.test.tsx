import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { KitchenMap } from '@hivekitchen/types';

const hkFetchMock = vi.fn();
vi.mock('@/lib/fetch.js', () => ({
  hkFetch: (path: string, init: unknown) => hkFetchMock(path, init),
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
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

import { useAuthStore } from '@/stores/auth.store.js';
import KitchenProfileRoute from './kitchen-profile.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';

function sampleKitchenMap(overrides: Partial<KitchenMap> = {}): KitchenMap {
  return {
    household: {
      id: HOUSEHOLD_ID,
      tier: 'standard',
      tier_variant: 'control',
      timezone: 'Europe/London',
      display_name: 'Test Family',
      cultural_identifiers: [],
      dietary_preferences: [],
      declared_allergens: [],
    },
    caregivers: [],
    children: [],
    cultural: { active: [], suggested: [] },
    memory: { nodes: [] },
    household_extras: { library: [] },
    recipes: { favourites: [], banned: [] },
    allergens: [],
    dietary: [],
    food_preferences: [],
    favorite_lunches: [],
    rules: [],
    meta: {
      composed_at: '2026-05-22T00:00:00.000Z',
      map_version: 1,
      schema_version: '1.1.0',
      is_complete: false,
      required_set_complete: false,
    },
    ...overrides,
  };
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
    <MemoryRouter initialEntries={['/app/kitchen-profile']}>
      <KitchenProfileRoute />
    </MemoryRouter>,
  );
}

describe('KitchenProfileRoute', () => {
  beforeEach(() => {
    hkFetchMock.mockReset();
    navigateSpy.mockClear();
    setAuthenticated();
  });

  afterEach(() => {
    cleanup();
    useAuthStore.getState().clearSession();
  });

  it('renders loading state before hkFetch resolves', () => {
    hkFetchMock.mockReturnValue(new Promise(() => undefined));
    renderRoute();
    expect(screen.getByText(/loading your kitchen/i)).toBeDefined();
  });

  it('renders error state with role=alert when hkFetch rejects', async () => {
    hkFetchMock.mockRejectedValue(new Error('boom'));
    renderRoute();
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/couldn.?t load your kitchen profile/i);
    });
  });

  it('renders cultural prior label when active prior exists', async () => {
    hkFetchMock.mockResolvedValue(
      sampleKitchenMap({
        cultural: {
          active: [
            {
              key: 'halal',
              label: 'Halal',
              state: 'active',
              tier: 'L1',
              confidence: 100,
              presence: 100,
              enforcement: 'non_negotiable',
            },
          ],
          suggested: [],
        },
      }),
    );
    renderRoute();
    await waitFor(() => {
      expect(screen.getByText('Halal')).toBeDefined();
    });
  });

  it('renders empty starting line placeholder when favorite_lunches is empty', async () => {
    hkFetchMock.mockResolvedValue(
      sampleKitchenMap({
        favorite_lunches: [],
        children: [
          {
            id: CHILD_ID,
            name: 'Layla',
            age_band: 'preteen',
            declared_allergens: [],
            cultural_identifiers: [],
            dietary_preferences: [],
            bag_composition: { main: true, snack: false, extra: false },
            bag_composition_pattern: null,
            school_policies: [],
            extra_rules: { pinned: [], banned: [] },
          },
        ],
      }),
    );
    renderRoute();
    await waitFor(() => {
      expect(screen.getByText(/no starting line yet/i)).toBeDefined();
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { KitchenMap, KitchenMapAllergen, KitchenMapChild } from '@hivekitchen/types';

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

function makeChild(overrides: Partial<KitchenMapChild> = {}): KitchenMapChild {
  return {
    id: CHILD_ID,
    name: 'Layla',
    age_band: 'preteen',
    declared_allergens: [],
    cultural_identifiers: [],
    dietary_preferences: [],
    bag_composition: { main: true, snack: false, extra: false },
    bag_composition_pattern: 'main_only',
    school_policies: [],
    extra_rules: { pinned: [], banned: [] },
    ...overrides,
  };
}

function allergenRow(allergen: string): KitchenMapAllergen {
  return { child_id: CHILD_ID, allergen, source: 'parent_edited' };
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
      sampleKitchenMap({ favorite_lunches: [], children: [makeChild({ bag_composition_pattern: null })] }),
    );
    renderRoute();
    await waitFor(() => {
      expect(screen.getByText(/no starting line yet/i)).toBeDefined();
    });
  });

  it('adds an allergen via the curated chip → POST then renders it', async () => {
    hkFetchMock.mockImplementation((_path: string, init: { method: string }) => {
      if (init.method === 'POST') {
        return Promise.resolve({ child_id: CHILD_ID, allergens: ['peanut'] });
      }
      return Promise.resolve(sampleKitchenMap({ children: [makeChild()] }));
    });
    renderRoute();
    const addBtn = await screen.findByRole('button', { name: '+ Peanut' });
    fireEvent.click(addBtn);
    await waitFor(() => {
      expect(hkFetchMock).toHaveBeenCalledWith(
        `/v1/children/${CHILD_ID}/allergens`,
        expect.objectContaining({ method: 'POST', body: { allergen: 'peanut' } }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText('peanut')).toBeDefined();
    });
  });

  it('removes only the targeted allergen via DELETE', async () => {
    hkFetchMock.mockImplementation((_path: string, init: { method: string }) => {
      if (init.method === 'DELETE') {
        return Promise.resolve({ child_id: CHILD_ID, allergens: ['milk'] });
      }
      return Promise.resolve(
        sampleKitchenMap({
          children: [makeChild()],
          allergens: [allergenRow('peanut'), allergenRow('milk')],
        }),
      );
    });
    renderRoute();
    const removeBtn = await screen.findByRole('button', { name: 'Remove peanut' });
    fireEvent.click(removeBtn);
    await waitFor(() => {
      expect(hkFetchMock).toHaveBeenCalledWith(
        `/v1/children/${CHILD_ID}/allergens/peanut`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText('peanut')).toBeNull();
      expect(screen.getByText('milk')).toBeDefined();
    });
  });

  it('shows an inline error and reverts when an allergen add fails', async () => {
    hkFetchMock.mockImplementation((_path: string, init: { method: string }) => {
      if (init.method === 'POST') return Promise.reject(new Error('boom'));
      return Promise.resolve(sampleKitchenMap({ children: [makeChild()] }));
    });
    renderRoute();
    const addBtn = await screen.findByRole('button', { name: '+ Peanut' });
    fireEvent.click(addBtn);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/could not add/i);
    });
    // reverted — the optimistic chip is gone, the add chip is back.
    expect(screen.getByRole('button', { name: '+ Peanut' })).toBeDefined();
  });

  it('sets cultural enforcement via the tier selector → PATCH with mapped enum', async () => {
    hkFetchMock.mockImplementation((_path: string, init: { method: string }) => {
      if (init.method === 'PATCH') return Promise.resolve({ key: 'halal', enforcement: 'default' });
      return Promise.resolve(
        sampleKitchenMap({
          children: [makeChild()],
          cultural: {
            active: [
              {
                key: 'halal',
                label: 'Halal',
                state: 'active',
                tier: 'L1',
                confidence: 100,
                presence: 100,
                enforcement: 'strong', // strong (not non_negotiable) so the selector is shown
              },
            ],
            suggested: [],
          },
        }),
      );
    });
    renderRoute();
    const preferBtn = await screen.findByRole('button', { name: 'Prefer' });
    fireEvent.click(preferBtn);
    await waitFor(() => {
      expect(hkFetchMock).toHaveBeenCalledWith(
        `/v1/households/${HOUSEHOLD_ID}/cultural-priors/enforcement`,
        expect.objectContaining({ method: 'PATCH', body: { key: 'halal', enforcement: 'default' } }),
      );
    });
  });

  it('shows an inline error and reverts enforcement when PATCH fails', async () => {
    hkFetchMock.mockImplementation((_path: string, init: { method: string }) => {
      if (init.method === 'PATCH') return Promise.reject(new Error('boom'));
      return Promise.resolve(
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
                enforcement: 'strong',
              },
            ],
            suggested: [],
          },
        }),
      );
    });
    renderRoute();
    const preferBtn = await screen.findByRole('button', { name: 'Prefer' });
    fireEvent.click(preferBtn);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/could not update/i);
    });
  });
});

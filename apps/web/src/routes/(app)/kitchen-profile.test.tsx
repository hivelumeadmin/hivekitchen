import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type * as reactRouterDom from 'react-router-dom';
import type { KitchenMap, KitchenMapAllergen, KitchenMapChild } from '@hivekitchen/types';

const hkFetchMock = vi.fn();
vi.mock('@/lib/fetch.js', () => ({
  hkFetch: (path: string, init: unknown) => hkFetchMock(path, init),
  HkApiError: class HkApiError extends Error {},
}));

vi.mock('@hivekitchen/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useScope: vi.fn(),
}));

vi.mock('@/hooks/useLumiContext.js', () => ({
  useLumiContext: vi.fn(),
}));

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof reactRouterDom>('react-router-dom');
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

  // Story 7-S15 (Arc A) — starting-line favorites soft edit
  it('drops a favorite via the starting-line editor → PUT with the new list', async () => {
    hkFetchMock.mockImplementation((_path: string, init: { method: string }) => {
      if (init.method === 'PUT') return Promise.resolve({ items: [] });
      return Promise.resolve(
        sampleKitchenMap({
          favorite_lunches: [{ item: 'Pasta', provenance: 'declared', position: 0 }],
        }),
      );
    });
    renderRoute();
    const section = (await screen.findByText("Lumi's starting line")).closest('section');
    fireEvent.click(within(section as HTMLElement).getByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Drop Pasta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message to Lumi' }));
    await waitFor(() => {
      expect(hkFetchMock).toHaveBeenCalledWith(
        `/v1/households/${HOUSEHOLD_ID}/favorite-lunches`,
        expect.objectContaining({ method: 'PUT', body: { items: [] } }),
      );
    });
  });

  it('reverts the starting line when the favorites PUT fails', async () => {
    hkFetchMock.mockImplementation((_path: string, init: { method: string }) => {
      if (init.method === 'PUT') return Promise.reject(new Error('boom'));
      return Promise.resolve(
        sampleKitchenMap({
          favorite_lunches: [{ item: 'Pasta', provenance: 'declared', position: 0 }],
        }),
      );
    });
    renderRoute();
    const section = (await screen.findByText("Lumi's starting line")).closest('section');
    fireEvent.click(within(section as HTMLElement).getByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Drop Pasta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message to Lumi' }));
    await waitFor(() => {
      expect(hkFetchMock).toHaveBeenCalledWith(
        `/v1/households/${HOUSEHOLD_ID}/favorite-lunches`,
        expect.objectContaining({ method: 'PUT' }),
      );
    });
    // Close the editor and confirm the dropped item is restored (revert).
    fireEvent.click(screen.getByRole('button', { name: /done with my edit/i }));
    await waitFor(() => {
      expect(screen.getByText('Pasta')).toBeDefined();
    });
  });

  // Story 7-S15 (Arc B) — cultural chip state deltas
  it('sends opt_in for a kept suggested chip and forget for a dropped active chip', async () => {
    hkFetchMock.mockImplementation((_path: string, init: { method: string }) => {
      if (init.method === 'PATCH') return Promise.resolve({ key: 'x', state: 'x' });
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
            suggested: [
              {
                key: 'kosher',
                label: 'Kosher',
                state: 'suggested',
                tier: 'L1',
                confidence: 80,
                presence: 80,
                enforcement: 'default',
              },
            ],
          },
        }),
      );
    });
    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Refine collective identity' }));
    // Drop the active 'Halal' chip; keep the suggested 'Kosher' chip.
    fireEvent.click(await screen.findByRole('button', { name: 'Drop Halal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message to Lumi' }));
    await waitFor(() => {
      expect(hkFetchMock).toHaveBeenCalledWith(
        `/v1/households/${HOUSEHOLD_ID}/cultural-priors/state`,
        expect.objectContaining({ method: 'PATCH', body: { key: 'kosher', action: 'opt_in' } }),
      );
    });
    expect(hkFetchMock).toHaveBeenCalledWith(
      `/v1/households/${HOUSEHOLD_ID}/cultural-priors/state`,
      expect.objectContaining({ method: 'PATCH', body: { key: 'halal', action: 'forget' } }),
    );
    // chip-only edit (no [Message]) must NOT post a Lumi turn
    expect(hkFetchMock).not.toHaveBeenCalledWith('/v1/lumi/turns', expect.anything());
  });

  // Story 7-S15 (Arc C) — shared-tastes prose → Lumi turn → response displayed
  it('posts a Lumi turn for a typed shared-tastes note and shows the reply', async () => {
    hkFetchMock.mockImplementation((path: string, init: { method: string }) => {
      if (init.method === 'POST' && path === '/v1/lumi/turns') {
        return Promise.resolve({
          lumi_turn: { body: { type: 'message', content: 'Noted — milder it is.' } },
        });
      }
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
    fireEvent.click(await screen.findByRole('button', { name: 'Refine collective identity' }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'we keep heat mild for the kids' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message to Lumi' }));
    await waitFor(() => {
      expect(hkFetchMock).toHaveBeenCalledWith(
        '/v1/lumi/turns',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({ context_signal: { surface: 'kitchen-profile' } }),
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Noted — milder it is.')).toBeDefined();
    });
  });

  // Story 3-S42 — per-child Snack & Extra preferences (pins/bans)
  it('renders current pins/bans from kitchenMap with the correct toggle state', async () => {
    hkFetchMock.mockResolvedValue(
      sampleKitchenMap({
        children: [makeChild({ extra_rules: { pinned: ['fruit'], banned: ['dairy'] } })],
      }),
    );
    renderRoute();
    const pinFruit = await screen.findByRole('button', { name: 'Pin fruit' });
    expect(pinFruit.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Ban dairy' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    // an untouched token is neutral on both controls
    expect(screen.getByRole('button', { name: 'Pin grain' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: 'Ban grain' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('pinning a token issues PATCH /extra-rules with the full replacement body', async () => {
    hkFetchMock.mockImplementation((path: string, init: { method: string }) => {
      if (init.method === 'PATCH' && path.includes('/extra-rules')) {
        return Promise.resolve({
          child_id: CHILD_ID,
          extra_rules: { pins: ['grain'], bans: [] },
          updated_at: '2026-06-20T00:00:00.000Z',
        });
      }
      return Promise.resolve(sampleKitchenMap({ children: [makeChild()] }));
    });
    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Pin grain' }));
    await waitFor(() => {
      expect(hkFetchMock).toHaveBeenCalledWith(
        `/v1/children/${CHILD_ID}/extra-rules`,
        expect.objectContaining({ method: 'PATCH', body: { pins: ['grain'], bans: [] } }),
      );
    });
  });

  it('selecting pin clears an existing ban on the same token (mutual exclusion)', async () => {
    hkFetchMock.mockImplementation((path: string, init: { method: string }) => {
      if (init.method === 'PATCH' && path.includes('/extra-rules')) {
        return Promise.resolve({
          child_id: CHILD_ID,
          extra_rules: { pins: ['fruit'], bans: [] },
          updated_at: '2026-06-20T00:00:00.000Z',
        });
      }
      return Promise.resolve(
        sampleKitchenMap({
          children: [makeChild({ extra_rules: { pinned: [], banned: ['fruit'] } })],
        }),
      );
    });
    renderRoute();
    // fruit starts banned; pinning it must drop the ban from the PATCH body.
    fireEvent.click(await screen.findByRole('button', { name: 'Pin fruit' }));
    await waitFor(() => {
      expect(hkFetchMock).toHaveBeenCalledWith(
        `/v1/children/${CHILD_ID}/extra-rules`,
        expect.objectContaining({ method: 'PATCH', body: { pins: ['fruit'], bans: [] } }),
      );
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Ban fruit' }).getAttribute('aria-pressed')).toBe(
        'false',
      );
    });
  });

  it('renders read-only (no toggle controls, no PATCH) for a non-primary role', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'caregiver@example.com',
        display_name: 'Caregiver',
        current_household_id: HOUSEHOLD_ID,
        role: 'secondary_caregiver',
      },
    });
    hkFetchMock.mockResolvedValue(
      sampleKitchenMap({
        children: [makeChild({ extra_rules: { pinned: ['fruit'], banned: [] } })],
      }),
    );
    renderRoute();
    // read-only chip shows the pinned state…
    await waitFor(() => {
      expect(screen.getByText('Pinned')).toBeDefined();
    });
    // …but there are no Pin/Ban toggle buttons.
    expect(screen.queryByRole('button', { name: 'Pin fruit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ban fruit' })).toBeNull();
  });

  it('reverts the optimistic pin and shows an error when the PATCH fails', async () => {
    hkFetchMock.mockImplementation((path: string, init: { method: string }) => {
      if (init.method === 'PATCH' && path.includes('/extra-rules')) {
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve(sampleKitchenMap({ children: [makeChild()] }));
    });
    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: 'Pin grain' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/could not save those preferences/i);
    });
    // reverted — grain is neutral again.
    expect(screen.getByRole('button', { name: 'Pin grain' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('surfaces an inline error when a cultural chip-state PATCH fails', async () => {
    hkFetchMock.mockImplementation((path: string, init: { method: string }) => {
      if (init.method === 'PATCH' && path.includes('/cultural-priors/state')) {
        return Promise.reject(new Error('boom'));
      }
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
    fireEvent.click(await screen.findByRole('button', { name: 'Refine collective identity' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Drop Halal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send message to Lumi' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/could not be saved/i);
    });
  });
});

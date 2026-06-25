import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
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
import SnackShelfRoute from './snack-shelf.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const PRIMARY_ID = '11111111-1111-4111-8111-111111111111';
const SECONDARY_ID = '55555555-5555-4555-8555-555555555555';
const GLOBAL_SKU_ID = '33333333-3333-4333-8333-333333333333';
const HOUSEHOLD_SKU_ID = '44444444-4444-4444-8444-444444444444';

const items = [
  {
    id: GLOBAL_SKU_ID,
    name: 'Apple',
    brand: null,
    category: 'fruit',
    allergen_tags: [],
    created_by_household_id: null,
    created_at: '2026-06-01T00:00:00.000Z',
    upc_code: null,
    package_type: null,
    in_stock: true,
  },
  {
    id: HOUSEHOLD_SKU_ID,
    name: 'Pretzel Twists',
    brand: 'Snyder',
    category: 'grain',
    allergen_tags: ['wheat'],
    created_by_household_id: HOUSEHOLD_ID,
    created_at: '2026-06-10T00:00:00.000Z',
    upc_code: null,
    package_type: null,
    in_stock: true,
  },
];

function setAuth(role: 'primary_parent' | 'secondary_caregiver') {
  useAuthStore.setState({
    accessToken: 'token',
    user: {
      id: role === 'primary_parent' ? PRIMARY_ID : SECONDARY_ID,
      email: 'user@example.com',
      display_name: 'Alex',
      current_household_id: HOUSEHOLD_ID,
      role,
    },
  });
}

function renderRoute() {
  render(
    <MemoryRouter initialEntries={['/app/kitchen/snacks']}>
      <SnackShelfRoute />
    </MemoryRouter>,
  );
}

describe('SnackShelfRoute (3-s41)', () => {
  beforeEach(() => {
    hkFetchMock.mockReset();
    navigateSpy.mockClear();
  });

  afterEach(() => {
    cleanup();
    useAuthStore.getState().clearSession();
  });

  it('renders global items without a remove button and household items with one', async () => {
    setAuth('primary_parent');
    hkFetchMock.mockResolvedValue({ items });
    renderRoute();

    expect(await screen.findByText('Apple')).toBeDefined();
    expect(screen.getByText('Pretzel Twists')).toBeDefined();
    expect(screen.getByText('(built-in)')).toBeDefined();
    // Exactly one remove button — the household-owned row.
    expect(screen.getAllByRole('button', { name: /remove/i })).toHaveLength(1);
  });

  it('hides the add form and all remove buttons for a secondary_caregiver', async () => {
    setAuth('secondary_caregiver');
    hkFetchMock.mockResolvedValue({ items });
    renderRoute();

    await screen.findByText('Apple');
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add snack/i })).toBeNull();
  });

  it('submits the add form via POST and appends the new snack', async () => {
    setAuth('primary_parent');
    const created = {
      id: '66666666-6666-4666-8666-666666666666',
      name: 'Hummus Cup',
      brand: null,
      category: 'protein',
      allergen_tags: ['sesame'],
      created_by_household_id: HOUSEHOLD_ID,
      created_at: '2026-06-20T12:00:00.000Z',
      upc_code: '012345678905',
      package_type: 'cup',
      in_stock: true,
    };
    hkFetchMock.mockImplementation((path: string, init: { method: string }) => {
      if (init.method === 'GET') return Promise.resolve({ items });
      if (init.method === 'POST') return Promise.resolve(created);
      throw new Error(`unexpected call ${init.method} ${path}`);
    });
    renderRoute();

    await screen.findByText('Apple');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Hummus Cup' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'protein' } });
    fireEvent.change(screen.getByLabelText('UPC (optional)'), { target: { value: '012345678905' } });
    fireEvent.change(screen.getByLabelText('Package type (optional)'), { target: { value: 'cup' } });
    fireEvent.click(screen.getByRole('button', { name: /add snack/i }));

    expect(await screen.findByText('Hummus Cup')).toBeDefined();
    const postCall = hkFetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(postCall?.[0]).toBe(`/v1/households/${HOUSEHOLD_ID}/snacks`);
    expect(postCall?.[1].body).toMatchObject({
      name: 'Hummus Cup',
      category: 'protein',
      upc_code: '012345678905',
      package_type: 'cup',
    });
  });

  it('renders the allergen fieldset with subtitle note in the add form', async () => {
    setAuth('primary_parent');
    hkFetchMock.mockResolvedValue({ items });
    renderRoute();

    await screen.findByText('Apple');
    expect(screen.getByText(/tell lumi which allergens/i)).toBeDefined();
  });

  it('renders all 9 FALCPA allergen checkboxes in the add form', async () => {
    setAuth('primary_parent');
    hkFetchMock.mockResolvedValue({ items });
    renderRoute();

    await screen.findByText('Apple');
    const ALLERGEN_LABELS = [
      'Peanut', 'Tree nut', 'Dairy', 'Egg', 'Wheat', 'Soy', 'Fish', 'Shellfish', 'Sesame',
    ];
    for (const label of ALLERGEN_LABELS) {
      expect(screen.getByLabelText(label)).toBeDefined();
    }
  });

  it('includes selected FALCPA-9 allergen_tags in the POST body and clears them after success', async () => {
    setAuth('primary_parent');
    const created = {
      id: '66666666-6666-4666-8666-666666666666',
      name: 'Trail Mix',
      brand: null,
      category: 'other',
      allergen_tags: ['peanut', 'tree_nut'],
      created_by_household_id: HOUSEHOLD_ID,
      created_at: '2026-06-20T12:00:00.000Z',
      upc_code: null,
      package_type: null,
      in_stock: true,
    };
    hkFetchMock.mockImplementation((path: string, init: { method: string }) => {
      if (init.method === 'GET') return Promise.resolve({ items });
      if (init.method === 'POST') return Promise.resolve(created);
      throw new Error(`unexpected call ${init.method} ${path}`);
    });
    renderRoute();

    await screen.findByText('Apple');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Trail Mix' } });
    fireEvent.click(screen.getByLabelText('Peanut'));
    fireEvent.click(screen.getByLabelText('Tree nut'));
    fireEvent.click(screen.getByRole('button', { name: /add snack/i }));

    await screen.findByText('Trail Mix');
    const postCall = hkFetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(postCall?.[1].body.allergen_tags).toEqual(['peanut', 'tree_nut']);
    // Checkboxes reset after a successful add.
    expect((screen.getByLabelText('Peanut') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Tree nut') as HTMLInputElement).checked).toBe(false);
  });

  it('posts an empty allergen_tags array when none are selected', async () => {
    setAuth('primary_parent');
    const created = {
      id: '66666666-6666-4666-8666-666666666666',
      name: 'Plain Apple',
      brand: null,
      category: 'fruit',
      allergen_tags: [],
      created_by_household_id: HOUSEHOLD_ID,
      created_at: '2026-06-20T12:00:00.000Z',
      upc_code: null,
      package_type: null,
      in_stock: true,
    };
    hkFetchMock.mockImplementation((path: string, init: { method: string }) => {
      if (init.method === 'GET') return Promise.resolve({ items });
      if (init.method === 'POST') return Promise.resolve(created);
      throw new Error(`unexpected call ${init.method} ${path}`);
    });
    renderRoute();

    await screen.findByText('Apple');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Plain Apple' } });
    fireEvent.click(screen.getByRole('button', { name: /add snack/i }));

    await screen.findByText('Plain Apple');
    const postCall = hkFetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(postCall?.[1].body.allergen_tags).toEqual([]);
  });

  it('toggling an allergen checkbox off removes it from the selection', async () => {
    setAuth('primary_parent');
    hkFetchMock.mockResolvedValue({ items });
    renderRoute();

    await screen.findByText('Apple');
    const dairy = screen.getByLabelText('Dairy') as HTMLInputElement;
    fireEvent.click(dairy);
    expect(dairy.checked).toBe(true);
    fireEvent.click(dairy);
    expect(dairy.checked).toBe(false);
  });

  it('renders upc_code and package_type for items that have them', async () => {
    setAuth('primary_parent');
    const withMetadata = [
      {
        id: HOUSEHOLD_SKU_ID,
        name: 'Pretzel Twists',
        brand: 'Snyder',
        category: 'grain',
        allergen_tags: ['wheat'],
        created_by_household_id: HOUSEHOLD_ID,
        created_at: '2026-06-10T00:00:00.000Z',
        upc_code: '012345678905',
        package_type: 'bag',
        in_stock: true,
      },
    ];
    hkFetchMock.mockResolvedValue({ items: withMetadata });
    renderRoute();

    const upc = await screen.findByText('012345678905');
    const row = upc.closest('li');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Bag')).toBeDefined();
  });

  it('toggles in-stock via PATCH and reflects the new state', async () => {
    setAuth('primary_parent');
    const paused = { ...items[1], in_stock: false };
    hkFetchMock.mockImplementation((path: string, init: { method: string }) => {
      if (init.method === 'GET') return Promise.resolve({ items });
      if (init.method === 'PATCH') return Promise.resolve(paused);
      throw new Error(`unexpected call ${init.method} ${path}`);
    });
    renderRoute();

    await screen.findByText('Pretzel Twists');
    fireEvent.click(screen.getByRole('button', { name: /mark out of stock/i }));

    expect(await screen.findByText('(out of stock)')).toBeDefined();
    const patchCall = hkFetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH');
    expect(patchCall?.[0]).toBe(`/v1/households/${HOUSEHOLD_ID}/snacks/${HOUSEHOLD_SKU_ID}`);
    expect(patchCall?.[1].body).toEqual({ in_stock: false });
    // Button now offers the reverse action.
    expect(screen.getByRole('button', { name: /mark in stock/i })).toBeDefined();
  });

  it('removes a household snack via DELETE and drops it from the list', async () => {
    setAuth('primary_parent');
    hkFetchMock.mockImplementation((path: string, init: { method: string }) => {
      if (init.method === 'GET') return Promise.resolve({ items });
      if (init.method === 'DELETE') return Promise.resolve(undefined);
      throw new Error(`unexpected call ${init.method} ${path}`);
    });
    renderRoute();

    await screen.findByText('Pretzel Twists');
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() => expect(screen.queryByText('Pretzel Twists')).toBeNull());
    const deleteCall = hkFetchMock.mock.calls.find((c) => c[1]?.method === 'DELETE');
    expect(deleteCall?.[0]).toBe(`/v1/households/${HOUSEHOLD_ID}/snacks/${HOUSEHOLD_SKU_ID}`);
  });

  it('shows an error message when DELETE fails and keeps the item in the list', async () => {
    setAuth('primary_parent');
    hkFetchMock.mockImplementation((path: string, init: { method: string }) => {
      if (init.method === 'GET') return Promise.resolve({ items });
      if (init.method === 'DELETE') return Promise.reject(new Error('network error'));
      throw new Error(`unexpected call ${init.method} ${path}`);
    });
    renderRoute();

    await screen.findByText('Pretzel Twists');
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    expect(await screen.findByRole('alert', { name: undefined })).toBeDefined();
    expect(screen.getByText(/could not remove/i)).toBeDefined();
    expect(screen.getByText('Pretzel Twists')).toBeDefined();
  });
});

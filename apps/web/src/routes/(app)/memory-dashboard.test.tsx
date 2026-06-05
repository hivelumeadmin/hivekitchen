import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ParentalDashboardResponse } from '@hivekitchen/types';

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
import MemoryDashboardRoute from './memory-dashboard.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';

function emptyCounts() {
  return { onboarding: 0, turn: 0, tool: 0, user_edit: 0, plan_outcome: 0, import: 0 };
}

function makeDashboard(overrides: Partial<ParentalDashboardResponse> = {}): ParentalDashboardResponse {
  return {
    household: {
      cultural_priors: [{ key: 'bengali', label: 'Bengali', tier: 'L2', state: 'active' }],
      voice_retention_days: 90,
      recent_vpc_events: [
        { mechanism: 'signed_declaration', document_version: 'v1', signed_at: '2026-06-01T00:00:00.000Z' },
      ],
      general_memory_node_counts: { ...emptyCounts(), turn: 2 },
    },
    children: [
      {
        child_id: CHILD_ID,
        name: 'Layla',
        age_band: 'child',
        declared_allergens: ['peanut'],
        dietary_preferences: ['halal'],
        memory_node_counts: { ...emptyCounts(), onboarding: 1 },
      },
    ],
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
    <MemoryRouter initialEntries={['/app/memory/dashboard']}>
      <MemoryDashboardRoute />
    </MemoryRouter>,
  );
}

describe('MemoryDashboardRoute (7-S8)', () => {
  beforeEach(() => {
    hkFetchMock.mockReset();
    navigateSpy.mockClear();
    setAuthenticated();
  });

  afterEach(() => {
    cleanup();
    useAuthStore.getState().clearSession();
  });

  it('renders the loading skeleton before the fetch resolves', () => {
    hkFetchMock.mockReturnValue(new Promise(() => {}));
    renderRoute();

    expect(screen.getByRole('status', { name: /loading your data review/i })).toBeDefined();
  });

  it('renders the household card and a child card on success', async () => {
    hkFetchMock.mockResolvedValue(makeDashboard());
    renderRoute();

    // Household summary.
    expect(await screen.findByText('Bengali')).toBeDefined();
    expect(screen.getByText('90 days')).toBeDefined();
    expect(screen.getByText(/signed_declaration · v1/)).toBeDefined();
    expect(screen.getByText('2 from conversations')).toBeDefined();

    // Child card.
    expect(screen.getByText('Layla')).toBeDefined();
    expect(screen.getByText('peanut')).toBeDefined();
    expect(screen.getByText('halal')).toBeDefined();
    expect(screen.getByText('1 from onboarding')).toBeDefined();
  });

  it('renders the empty-state line and no child cards when children is empty', async () => {
    hkFetchMock.mockResolvedValue(makeDashboard({ children: [] }));
    renderRoute();

    expect(await screen.findByText(/No children are set up yet/i)).toBeDefined();
    expect(screen.queryByText('Layla')).toBeNull();
  });

  it('renders an error line when the fetch fails', async () => {
    hkFetchMock.mockRejectedValue(new Error('network down'));
    renderRoute();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/couldn't load your data review/i);
  });

  it('links each child card to /app/memory', async () => {
    hkFetchMock.mockResolvedValue(makeDashboard());
    renderRoute();

    const link = await screen.findByRole('link', { name: /See everything Lumi remembers/i });
    expect(link.getAttribute('href')).toBe('/app/memory');
  });
});

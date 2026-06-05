import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
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
import ConsentHistoryRoute from './consent-history.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

const sampleEvent = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  event_type: 'vpc.consented',
  metadata: { mechanism: 'signed_declaration' },
  created_at: '2026-06-01T00:00:00.000Z',
};

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
    <MemoryRouter initialEntries={['/app/memory/consent-history']}>
      <ConsentHistoryRoute />
    </MemoryRouter>,
  );
}

describe('ConsentHistoryRoute (7-S9)', () => {
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

    expect(screen.getByRole('status', { name: /loading your consent history/i })).toBeDefined();
  });

  it('renders the event list on success, with label and date for each event', async () => {
    hkFetchMock.mockResolvedValue({ events: [sampleEvent] });
    renderRoute();

    expect(await screen.findByText(/consent recorded/i)).toBeDefined();
    // The mechanism appears in the label.
    expect(screen.getByText(/\(signed_declaration\)/)).toBeDefined();
    // A formatted date renders for the event.
    expect(screen.getByText(/2026/)).toBeDefined();
  });

  it('renders the empty-state line and no list items when events is empty', async () => {
    hkFetchMock.mockResolvedValue({ events: [] });
    renderRoute();

    expect(await screen.findByText(/No consent events have been recorded/i)).toBeDefined();
    expect(screen.queryByText(/consent recorded/i)).toBeNull();
  });

  it('renders an error line when the fetch fails', async () => {
    hkFetchMock.mockRejectedValue(new Error('network down'));
    renderRoute();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/couldn't load your consent history/i);
  });

  it('falls back to the raw event_type for an unknown event type', async () => {
    hkFetchMock.mockResolvedValue({
      events: [{ ...sampleEvent, event_type: 'vpc.revoked', metadata: {} }],
    });
    renderRoute();

    expect(await screen.findByText('vpc.revoked')).toBeDefined();
  });
});

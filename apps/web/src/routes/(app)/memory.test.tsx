import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MemoryNode } from '@hivekitchen/types';

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

import { useLumiContext } from '@/hooks/useLumiContext.js';
import { useAuthStore } from '@/stores/auth.store.js';
import MemoryRoute from './memory.js';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

function makeNode(overrides: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    household_id: HOUSEHOLD_ID,
    node_type: 'preference',
    facet: 'avoids spicy',
    subject_child_id: null,
    prose_text: 'Layla avoids spicy peppers.',
    soft_forget_at: null,
    hard_forgotten: false,
    created_at: '2026-04-30T00:00:00.000Z',
    updated_at: '2026-04-30T00:00:00.000Z',
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
    <MemoryRouter initialEntries={['/app/memory']}>
      <MemoryRoute />
    </MemoryRouter>,
  );
}

describe('MemoryRoute', () => {
  beforeEach(() => {
    hkFetchMock.mockReset();
    navigateSpy.mockClear();
    setAuthenticated();
  });

  afterEach(() => {
    cleanup();
    useAuthStore.getState().clearSession();
  });

  it('registers the general Lumi surface context on mount (AC8)', () => {
    hkFetchMock.mockReturnValue(new Promise(() => undefined));
    renderRoute();
    expect(useLumiContext).toHaveBeenCalledWith({ surface: 'general' });
  });

  it('shows a loading status before the fetch resolves (AC4)', () => {
    hkFetchMock.mockReturnValue(new Promise(() => undefined));
    renderRoute();
    expect(screen.getByRole('status')).toBeDefined();
    // Never flashes the empty-state copy before the fetch completes.
    expect(screen.queryByText(/still learning about your family/i)).toBeNull();
  });

  it('requests the household memory endpoint (AC1)', async () => {
    hkFetchMock.mockResolvedValue({ nodes: [] });
    renderRoute();
    await waitFor(() => {
      expect(hkFetchMock).toHaveBeenCalledWith(
        `/v1/households/${HOUSEHOLD_ID}/memory`,
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  it('renders a VisibleMemorySentence row per node, each with a "More options" button (AC1, AC2)', async () => {
    hkFetchMock.mockResolvedValue({
      nodes: [
        makeNode({ id: '00000000-0000-4000-8000-00000000000a', prose_text: 'Layla avoids spicy peppers.' }),
        makeNode({ id: '00000000-0000-4000-8000-00000000000b', prose_text: 'Thursday is leftover night.' }),
      ],
    });
    renderRoute();

    await waitFor(() => {
      expect(screen.getByText('Layla avoids spicy peppers.')).toBeDefined();
    });
    expect(screen.getByText('Thursday is leftover night.')).toBeDefined();
    const buttons = screen.getAllByRole('button', { name: 'More options' });
    expect(buttons).toHaveLength(2);
  });

  it('shows the exact UX-DR39 empty copy when no active nodes are returned (AC3)', async () => {
    hkFetchMock.mockResolvedValue({ nodes: [] });
    renderRoute();

    await waitFor(() => {
      expect(
        screen.getByText(
          'Lumi is still learning about your family. Memory will show up here as patterns appear.',
        ),
      ).toBeDefined();
    });
  });

  it('shows an honest error line on a fetch failure (AC5)', async () => {
    hkFetchMock.mockRejectedValue(new Error('network down'));
    renderRoute();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        "Lumi couldn't load your memory right now. Try refreshing.",
      );
    });
  });
});

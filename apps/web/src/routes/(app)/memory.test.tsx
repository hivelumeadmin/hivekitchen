import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
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
const NODE_ID = '00000000-0000-4000-8000-00000000000a';

function makeNode(overrides: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    household_id: HOUSEHOLD_ID,
    node_type: 'other',
    facet: 'avoids spicy',
    subject_child_id: null,
    prose_text: 'Layla avoids spicy peppers.',
    soft_forget_at: null,
    forget_reason: null,
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
    localStorage.removeItem('memory_helper_seen_at');
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

  // Story 7-S3 — after editing a sentence the row renders the updated text
  // inline, because memory.tsx lifts the saved node into its `nodes` state.
  it('reflects the updated text inline after a successful edit (7-S3 AC2)', async () => {
    const node = makeNode({ id: NODE_ID, prose_text: 'Layla avoids spicy peppers.' });
    const updated = { ...node, prose_text: 'Layla now likes mild spice.' };
    hkFetchMock.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === `/v1/households/${HOUSEHOLD_ID}/memory`) {
        return Promise.resolve({ nodes: [node] });
      }
      if (path === `/v1/memory/${NODE_ID}/provenance`) {
        return Promise.resolve({ provenance: [] });
      }
      if (path === `/v1/memory/${NODE_ID}` && init?.method === 'PATCH') {
        return Promise.resolve({ node: updated });
      }
      return Promise.reject(new Error(`unexpected ${init?.method ?? 'GET'} ${path}`));
    });
    renderRoute();

    await waitFor(() => expect(screen.getByText('Layla avoids spicy peppers.')).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit this memory' })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit this memory' }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Layla now likes mild spice.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('Layla now likes mild spice.')).toBeDefined());
  });

  // Story 7-S4 — a soft-forgotten node in the response renders the tombstone
  // copy rather than prose text (the GET endpoint now returns both states).
  it('renders the tombstone copy for a soft-forgotten node (7-S4 AC10)', async () => {
    hkFetchMock.mockResolvedValue({
      nodes: [
        makeNode({
          id: NODE_ID,
          prose_text: 'Layla avoids spicy peppers.',
          soft_forget_at: '2026-06-05T00:00:00.000Z',
          forget_reason: 'too spicy',
        }),
      ],
    });
    renderRoute();

    await waitFor(() =>
      expect(screen.getByText("Lumi won't use this anymore — too spicy")).toBeDefined(),
    );
    expect(screen.queryByText('Layla avoids spicy peppers.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
  });

  // 7-S6 — first-time helper.
  const HELPER_TEXT = 'Tap ⋯ to see where this came from or ask Lumi to forget it';

  it('shows the helper tooltip on the first node when localStorage has no seen-at (7-S6 AC1)', async () => {
    localStorage.removeItem('memory_helper_seen_at');
    hkFetchMock.mockResolvedValue({ nodes: [makeNode({ id: NODE_ID })] });
    renderRoute();

    await waitFor(() => {
      expect(screen.getByText(HELPER_TEXT)).toBeDefined();
    });
  });

  it('does NOT show the helper tooltip when localStorage already has memory_helper_seen_at (7-S6 AC4)', async () => {
    localStorage.setItem('memory_helper_seen_at', '2026-01-01T00:00:00.000Z');
    hkFetchMock.mockResolvedValue({ nodes: [makeNode({ id: NODE_ID })] });
    renderRoute();

    await waitFor(() => {
      expect(screen.getByText('Layla avoids spicy peppers.')).toBeDefined();
    });
    expect(screen.queryByText(HELPER_TEXT)).toBeNull();
  });
});

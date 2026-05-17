import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BriefResponse, BriefStateRow } from '@hivekitchen/types';
import { useAuthStore } from '@/stores/auth.store.js';
import { BriefCanvas } from './BriefCanvas.js';

vi.mock('@/lib/fetch.js', () => ({
  hkFetch: vi.fn(),
}));

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';

function setUser() {
  useAuthStore.getState().setSession('token-123', {
    id: USER_ID,
    email: 'parent@example.com',
    display_name: null,
    role: 'primary_parent',
    current_household_id: HOUSEHOLD_ID,
  });
}

function clearUser() {
  useAuthStore.getState().clearSession();
}

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const PLAN_ID = '99999999-9999-4999-8999-999999999999';

function makeBrief(overrides: Partial<BriefStateRow> = {}): BriefStateRow {
  return {
    household_id: HOUSEHOLD_ID,
    plan_id: PLAN_ID,
    moment_headline: 'A quiet week, with one small surprise.',
    lumi_note: 'Tuesday flexes around your late meeting.',
    memory_prose: '',
    plan_tile_summaries: [
      { day: 'monday', items: [{ plan_item_id: '00000000-0000-4000-8000-000000000010', child_id: CHILD_ID, slot: 'main', ingredients: ['rice', 'beans', 'cheese'] }], paused: false },
      { day: 'tuesday', items: [{ plan_item_id: '00000000-0000-4000-8000-000000000011', child_id: CHILD_ID, slot: 'main', ingredients: ['noodles'] }], paused: false },
      { day: 'wednesday', items: [{ plan_item_id: '00000000-0000-4000-8000-000000000012', child_id: CHILD_ID, slot: 'main', ingredients: ['pasta'] }], paused: false },
      { day: 'thursday', items: [{ plan_item_id: '00000000-0000-4000-8000-000000000013', child_id: CHILD_ID, slot: 'main', ingredients: ['soup'] }], paused: false },
      { day: 'friday', items: [{ plan_item_id: '00000000-0000-4000-8000-000000000014', child_id: CHILD_ID, slot: 'main', ingredients: ['wrap'] }], paused: false },
    ],
    cleared_allergies: [],
    scaffolding_diff: null,
    generated_at: '2026-05-02T00:00:00.000Z',
    plan_revision: 1,
    updated_at: '2026-05-02T00:00:00.000Z',
    ...overrides,
  };
}

// Anchor every test to Monday morning so PlanTile variant derivation is
// deterministic (Monday is "today" → interactive). Without this, tests run
// against the real wall clock and Monday becomes "past" any day Tue–Sat,
// making click-driven assertions (DisambiguationPicker open) flake.
const MONDAY_MORNING = new Date(2026, 4, 4, 8, 0, 0); // Mon May 4 2026 08:00

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(MONDAY_MORNING);
  document.documentElement.classList.add('app-scope');
  setUser();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  clearUser();
  document.documentElement.classList.remove('app-scope');
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('BriefCanvas', () => {
  it('renders the loading skeleton (aria-busy=true) on first load', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockImplementation(
      () => new Promise<BriefResponse>(() => {}),
    );

    renderWithClient(<BriefCanvas />);

    expect(screen.getByLabelText('Loading plan').getAttribute('aria-busy')).toBe('true');
  });

  it('renders "preparing plan" copy when query returns brief: null', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ brief: null } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(
        screen.getByText('Lumi is preparing your first plan. Check back Sunday evening.'),
      ).toBeDefined();
    });
  });

  it('renders PageHeader (headline + lumi_note), tile grid, and FreshnessState when brief is populated', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ brief: makeBrief() } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: /A quiet week/ }),
      ).toBeDefined();
    });
    expect(screen.getByText('Tuesday flexes around your late meeting.')).toBeDefined();
    expect(screen.getByLabelText('Weekly plan')).toBeDefined();
    expect(screen.getByLabelText('Monday')).toBeDefined();
    expect(screen.getByLabelText('Tuesday')).toBeDefined();
  });

  it('renders gracefully when moment_headline and lumi_note are empty strings', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      brief: makeBrief({ moment_headline: '', lumi_note: '' }),
    } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(screen.getByLabelText('Weekly plan')).toBeDefined();
    });
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.className).toContain('sr-only');
    expect(h1.textContent).toBe('Weekly plan');
  });

  it('each plan_tile_summaries item renders as <article> with day aria-label', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ brief: makeBrief() } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(screen.getByLabelText('Monday').tagName).toBe('ARTICLE');
    });
    expect(screen.getByLabelText('Tuesday').tagName).toBe('ARTICLE');
  });

  it('logs a console.error when rendered outside .app-scope (DEV-only)', async () => {
    vi.stubEnv('DEV', true);
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ brief: null } satisfies BriefResponse);
    document.documentElement.classList.remove('app-scope');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Scope violation'),
      );
    });
  });

  it('renders FreshnessState status="failed" when query errors with no cached brief', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockRejectedValue(new Error('Network error'));

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeDefined();
      expect(
        screen.getByText("Lumi couldn't reach the plan right now."),
      ).toBeDefined();
    });
  });

  it('renders no AllergyClearedBadge row when cleared_allergies is empty (Story 3.10)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      brief: makeBrief({ cleared_allergies: [] }),
    } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(screen.getByLabelText('Weekly plan')).toBeDefined();
    });
    expect(screen.queryByLabelText('Allergy clearances')).toBeNull();
  });

  it('renders one AllergyClearedBadge per cleared_allergies entry, ABOVE the PageHeader (Story 3.10)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      brief: makeBrief({
        cleared_allergies: [
          { child_id: CHILD_ID, child_name: 'Asha', allergen: 'peanut' },
          { child_id: CHILD_ID, child_name: 'Asha', allergen: 'tree nut' },
        ],
      }),
    } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /A quiet week/ })).toBeDefined();
    });
    const peanutBtn = screen.getByRole('button', { name: "Cleared for Asha's peanut" });
    const treeNutBtn = screen.getByRole('button', { name: "Cleared for Asha's tree nut" });
    const headline = screen.getByRole('heading', { level: 1, name: /A quiet week/ });
    // Badge row precedes the headline in document order.
    const cmpPeanut = peanutBtn.compareDocumentPosition(headline);
    const cmpTreeNut = treeNutBtn.compareDocumentPosition(headline);
    // Node.DOCUMENT_POSITION_FOLLOWING === 4
    expect(cmpPeanut & 4).toBe(4);
    expect(cmpTreeNut & 4).toBe(4);
  });

  it('clicking an AllergyClearedBadge opens the popover with UX-DR24 copy (Story 3.10)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      brief: makeBrief({
        cleared_allergies: [
          { child_id: CHILD_ID, child_name: 'Asha', allergen: 'peanut' },
        ],
      }),
    } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    const trigger = await screen.findByRole('button', { name: "Cleared for Asha's peanut" });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeDefined();
    expect(dialog.textContent).toContain(
      "We checked every ingredient against Asha's peanut allergy.",
    );
    expect(dialog.textContent).toContain('Nothing in today');
  });

  it('renders no QuietDiff banner when scaffolding_diff is null (Story 3.11)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      brief: makeBrief({ scaffolding_diff: null }),
    } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(screen.getByLabelText('Weekly plan')).toBeDefined();
    });
    expect(screen.queryByRole('button', { name: /why this change/i })).toBeNull();
  });

  it('renders QuietDiff summary without ⋯ button when scaffolding_diff has no explanation (Story 3.11)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      brief: makeBrief({
        scaffolding_diff: { summary: "Swapped Tuesday's protein to match pantry" },
      }),
    } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(screen.getByText("Swapped Tuesday's protein to match pantry")).toBeDefined();
    });
    expect(screen.queryByRole('button', { name: /why this change/i })).toBeNull();
  });

  it('renders QuietDiff banner ABOVE PageHeader when scaffolding_diff is set (Story 3.11)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      brief: makeBrief({
        scaffolding_diff: {
          summary: "Swapped Tuesday's protein to match pantry",
          explanation: 'Pantry had no chicken this week.',
        },
      }),
    } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(
        screen.getByText("Swapped Tuesday's protein to match pantry"),
      ).toBeDefined();
    });

    const diffText = screen.getByText("Swapped Tuesday's protein to match pantry");
    const headline = screen.getByRole('heading', { level: 1 });
    // QuietDiff banner must appear before PageHeader in DOM (Node.DOCUMENT_POSITION_FOLLOWING === 4).
    expect(diffText.compareDocumentPosition(headline) & 4).toBe(4);
  });

  it('renders cached brief with FreshnessState status="failed" when background refetch errors', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockRejectedValue(new Error('Network error'));

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 60_000, staleTime: 0 } },
    });
    // Backdate updatedAt so data is immediately stale vs the hook's 5min staleTime,
    // triggering an automatic background refetch on mount (which will fail).
    client.setQueryData(
      ['brief', HOUSEHOLD_ID],
      { brief: makeBrief() } satisfies BriefResponse,
      { updatedAt: Date.now() - 10 * 60_000 },
    );

    render(
      <QueryClientProvider client={client}>
        <BriefCanvas />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /A quiet week/ })).toBeDefined();
      expect(screen.getByRole('status')).toBeDefined();
    });
  });
});

describe('BriefCanvas — Story 3.12 (paused, swap picker)', () => {
  it('renders Paused copy on a tile when summary.paused is true', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    const brief = makeBrief();
    brief.plan_tile_summaries[1] = {
      ...brief.plan_tile_summaries[1]!,
      paused: true,
    };
    vi.mocked(hkFetch).mockResolvedValue({ brief } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(screen.getByLabelText('Weekly plan')).toBeDefined();
    });
    expect(screen.getByLabelText('Day paused — sick day')).toBeDefined();
  });

  it('does NOT render the picker when activeSwapDay is null', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ brief: makeBrief() } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(screen.getByLabelText('Weekly plan')).toBeDefined();
    });
    expect(screen.queryByRole('group', { name: /Edit / })).toBeNull();
  });

  it('tapping a tile when canSwap=true renders the DisambiguationPicker', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ brief: makeBrief() } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    const monday = await screen.findByLabelText('Monday');
    fireEvent.click(monday);

    expect(screen.getByRole('group', { name: 'Edit Monday' })).toBeDefined();
  });

  it('tile does NOT trigger picker when brief.plan_id is null (canSwap=false)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    const briefWithoutPlanId = makeBrief();
    // Cast through unknown to assign null without TS friction in the test fixture.
    (briefWithoutPlanId as unknown as { plan_id: string | null }).plan_id = null;
    vi.mocked(hkFetch).mockResolvedValue({
      brief: briefWithoutPlanId,
    } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    const monday = await screen.findByLabelText('Monday');
    fireEvent.click(monday);

    expect(screen.queryByRole('group', { name: /Edit / })).toBeNull();
  });

  it('paused tile click does not open picker (onSwapIntent gated by !summary.paused)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    const brief = makeBrief();
    brief.plan_tile_summaries[0] = {
      ...brief.plan_tile_summaries[0]!,
      paused: true,
    };
    vi.mocked(hkFetch).mockResolvedValue({ brief } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    const monday = await screen.findByLabelText('Monday');
    fireEvent.click(monday);

    expect(screen.queryByRole('group', { name: /Edit / })).toBeNull();
  });
});

describe('BriefCanvas — Story 3.13 (regeneration affordance)', () => {
  it('renders the "Ask Lumi to try again" button when canSwap=true and not regenerating', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ brief: makeBrief() } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    const button = await screen.findByRole('button', { name: /Ask Lumi to try again/i });
    expect(button).toBeDefined();
  });

  it('hides the button when canSwap=false (plan_id is null)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    const brief = makeBrief();
    (brief as unknown as { plan_id: string | null }).plan_id = null;
    vi.mocked(hkFetch).mockResolvedValue({ brief } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(screen.getByLabelText('Weekly plan')).toBeDefined();
    });
    expect(screen.queryByRole('button', { name: /Ask Lumi to try again/i })).toBeNull();
  });

  it('after clicking the button: button is hidden and "Lumi is rethinking" copy appears', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockImplementation(async (path: string) => {
      if (path.includes('/regenerate')) {
        return { job_id: 'regen-1', rate_limit_remaining: 4 };
      }
      return { brief: makeBrief() } satisfies BriefResponse;
    });

    renderWithClient(<BriefCanvas />);

    const button = await screen.findByRole('button', { name: /Ask Lumi to try again/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Ask Lumi to try again/i })).toBeNull();
    });
    expect(screen.getByText(/Lumi is rethinking/i)).toBeDefined();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render as rtlRender, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BriefResponse, BriefStatePayload, BriefStateRow } from '@hivekitchen/types';
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

// 14-s4 review D2: WeekGrid's day rows now carry an "Open day" <Link>, so the
// canvas needs a Router in the tree. Harness-only change — every assertion in
// this file is untouched.
function render(ui: ReactNode) {
  return rtlRender(<MemoryRouter>{ui}</MemoryRouter>);
}

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const PLAN_ID = '99999999-9999-4999-8999-999999999999';

// Story 3-DM-D1 — the brief's tile_summaries / cleared_allergies /
// scaffolding_diff / plan_state* now live under a single `payload` object.
// Tests pass payload sub-field overrides via `{ payload: { ... } }`.
function makeBrief(
  overrides: Partial<Omit<BriefStateRow, 'payload'>> & { payload?: Partial<BriefStatePayload> } = {},
): BriefStateRow {
  const { payload: payloadOverrides, ...rest } = overrides;
  return {
    household_id: HOUSEHOLD_ID,
    plan_id: PLAN_ID,
    moment_headline: 'A quiet week, with one small surprise.',
    lumi_note: 'Tuesday flexes around your late meeting.',
    memory_prose: '',
    payload: {
      tile_summaries: [
        { day: 'monday', items: [{ plan_item_id: '00000000-0000-4000-8000-000000000010', child_id: CHILD_ID, slot: 'main', ingredients: ['rice', 'beans', 'cheese'] }], paused: false, lunch_link_suppressed_children: [], child_ratings: {} },
        { day: 'tuesday', items: [{ plan_item_id: '00000000-0000-4000-8000-000000000011', child_id: CHILD_ID, slot: 'main', ingredients: ['noodles'] }], paused: false, lunch_link_suppressed_children: [], child_ratings: {} },
        { day: 'wednesday', items: [{ plan_item_id: '00000000-0000-4000-8000-000000000012', child_id: CHILD_ID, slot: 'main', ingredients: ['pasta'] }], paused: false, lunch_link_suppressed_children: [], child_ratings: {} },
        { day: 'thursday', items: [{ plan_item_id: '00000000-0000-4000-8000-000000000013', child_id: CHILD_ID, slot: 'main', ingredients: ['soup'] }], paused: false, lunch_link_suppressed_children: [], child_ratings: {} },
        { day: 'friday', items: [{ plan_item_id: '00000000-0000-4000-8000-000000000014', child_id: CHILD_ID, slot: 'main', ingredients: ['wrap'] }], paused: false, lunch_link_suppressed_children: [], child_ratings: {} },
      ],
      cleared_allergies: [],
      scaffolding_diff: null,
      plan_state: null,
      plan_state_set_at: null,
      plan_state_message: null,
      learning_moment_callout: null,
      learning_moment_suppressed_until: null,
      plan_reasoning: null,
      ...payloadOverrides,
    },
    generated_at: '2026-05-02T00:00:00.000Z',
    plan_revision: 1,
    updated_at: '2026-05-02T00:00:00.000Z',
    ...rest,
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

  // The gate used to be `flaggedItems.length > 0`, so every hard-fail that
  // carried no compound-uncertain flags — infrastructure-uncertain verdicts,
  // `blocked` verdicts, planner retry exhaustion — fell through to the empty
  // state and sat on "preparing your first plan" forever.
  it('renders the hard-fail state (NOT "preparing plan") when hard_fail is set with no flagged_items', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/plans')) {
        return {
          plan: null,
          main_assignments: [],
          days: [],
          slots: [],
          variations: [],
          is_draft: false,
          week_of: '2026-04-20',
          hard_fail: { week_of: '2026-04-20', failed_at: '2026-04-19T18:00:00.000Z' },
        };
      }
      return { brief: null } satisfies BriefResponse;
    });

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(screen.getByText(/Lumi couldn’t build this week’s plan\./)).toBeDefined();
    });
    // The regression this test exists for.
    expect(
      screen.queryByText('Lumi is preparing your first plan. Check back Sunday evening.'),
    ).toBeNull();
    // A dead end with no action is what we are removing — the retry must exist.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('still renders the allergy banner (not the plain state) when hard_fail carries flagged_items', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/plans')) {
        return {
          plan: null,
          main_assignments: [],
          days: [],
          slots: [],
          variations: [],
          is_draft: false,
          week_of: '2026-04-20',
          hard_fail: { week_of: '2026-04-20', failed_at: '2026-04-19T18:00:00.000Z' },
          flagged_items: [
            { child_id: 'c1', ingredient: 'pesto', slot: 'main', day: 'mon' },
          ],
        };
      }
      return { brief: null } satisfies BriefResponse;
    });

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(screen.getByText(/Lumi needs your help with one ingredient/)).toBeDefined();
    });
    expect(screen.queryByText(/Lumi couldn’t build this week’s plan\./)).toBeNull();
  });

  // Negative control: without hard_fail the empty state must still win, or the
  // new gate would swallow the ordinary pre-compose week.
  it('renders "preparing plan" (NOT the hard-fail state) when no hard_fail is present', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/plans')) {
        return {
          plan: null,
          main_assignments: [],
          days: [],
          slots: [],
          variations: [],
          is_draft: false,
          week_of: '2026-04-20',
        };
      }
      return { brief: null } satisfies BriefResponse;
    });

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(
        screen.getByText('Lumi is preparing your first plan. Check back Sunday evening.'),
      ).toBeDefined();
    });
    expect(screen.queryByText(/Lumi couldn’t build this week’s plan\./)).toBeNull();
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
    expect(h1.textContent).toBe('Your week, ready');
    expect(h1.className).not.toContain('sr-only');
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
      brief: makeBrief({ payload: { cleared_allergies: [] } }),
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
        payload: {
          cleared_allergies: [
            { child_id: CHILD_ID, child_name: 'Asha', allergen: 'peanut' },
            { child_id: CHILD_ID, child_name: 'Asha', allergen: 'tree nut' },
          ],
        },
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
        payload: {
          cleared_allergies: [
            { child_id: CHILD_ID, child_name: 'Asha', allergen: 'peanut' },
          ],
        },
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
      brief: makeBrief({ payload: { scaffolding_diff: null } }),
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
        payload: {
          scaffolding_diff: { summary: "Swapped Tuesday's protein to match pantry" },
        },
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
        payload: {
          scaffolding_diff: {
            summary: "Swapped Tuesday's protein to match pantry",
            explanation: 'Pantry had no chicken this week.',
          },
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
    brief.payload.tile_summaries[1] = {
      ...brief.payload.tile_summaries[1]!,
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

  // Story 13-s10 (D1) — a tile tap no longer opens the DisambiguationPicker
  // directly; it summons the Lumi sheet armed with that day's edit scope.
  it('tapping a tile when canSwap=true summons Lumi with the day edit scope (13-s10)', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    const { useLumiStore } = await import('@/stores/lumi.store.js');
    useLumiStore.getState().reset();
    vi.mocked(hkFetch).mockImplementation(async (path: string) => {
      if (path.startsWith('/v1/plans')) {
        return {
          plan: null,
          main_assignments: [],
          days: [],
          slots: [],
          variations: [],
          is_draft: false,
          week_of: '2026-04-20',
        };
      }
      return { brief: makeBrief() } satisfies BriefResponse;
    });

    renderWithClient(<BriefCanvas />);

    const monday = await screen.findByLabelText('Monday');
    await waitFor(() => {
      fireEvent.click(monday);
      expect(useLumiStore.getState().presenceState).toBe('summoned');
    });
    expect(useLumiStore.getState().planEditScope?.day).toBe('mon');
    expect(useLumiStore.getState().planEditScope?.planId).toBe(PLAN_ID);
    useLumiStore.getState().reset();
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
    brief.payload.tile_summaries[0] = {
      ...brief.payload.tile_summaries[0]!,
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

describe('BriefCanvas — Story 3.29 (degraded cultural-intersection note)', () => {
  it('renders the inline note with "Try alternating" button when plan_state="degraded"', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      brief: makeBrief({
        payload: {
          plan_state: 'degraded',
          plan_state_set_at: '2026-05-25T12:00:00.000Z',
          plan_state_message:
            "This week's plan couldn't honor every rule strictly. Try alternating whose rules lead each day?",
        },
      }),
    } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    const message = await screen.findByText(
      "This week's plan couldn't honor every rule strictly. Try alternating whose rules lead each day?",
    );
    expect(message).toBeDefined();
    const toggle = screen.getByRole('button', {
      name: 'Switch to alternating sovereignty mode',
    });
    expect(toggle).toBeDefined();
    expect(toggle.textContent).toMatch(/Try alternating/);
  });

  it('does NOT render the degraded note when plan_state is null', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ brief: makeBrief() } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(screen.getByLabelText('Weekly plan')).toBeDefined();
    });
    expect(
      screen.queryByRole('button', { name: 'Switch to alternating sovereignty mode' }),
    ).toBeNull();
  });

  it('does NOT render the degraded note when plan_state="hard_failed" — that surface lives in FreshnessState', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      brief: makeBrief({
        payload: {
          plan_state: 'hard_failed',
          plan_state_set_at: '2026-05-25T12:00:00.000Z',
          plan_state_message: 'A hard-fail message that must NOT be rendered as the soft inline note.',
        },
      }),
    } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(screen.getByLabelText('Weekly plan')).toBeDefined();
    });
    expect(
      screen.queryByRole('button', { name: 'Switch to alternating sovereignty mode' }),
    ).toBeNull();
    expect(
      screen.queryByText(/A hard-fail message that must NOT be rendered/),
    ).toBeNull();
  });

  it('clicking the toggle fires PATCH /v1/households/:id/sovereignty-mode with {sovereignty_mode: "alternating"}', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
    vi.mocked(hkFetch).mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      calls.push({ path, method: opts?.method, body: opts?.body });
      if (path.includes('/sovereignty-mode')) {
        return { sovereignty_mode: 'alternating' };
      }
      return {
        brief: makeBrief({
          payload: {
            plan_state: 'degraded',
            plan_state_set_at: '2026-05-25T12:00:00.000Z',
            plan_state_message: 'msg',
          },
        }),
      } satisfies BriefResponse;
    });

    renderWithClient(<BriefCanvas />);

    const toggle = await screen.findByRole('button', {
      name: 'Switch to alternating sovereignty mode',
    });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(
        calls.some(
          (c) =>
            c.path === `/v1/households/${HOUSEHOLD_ID}/sovereignty-mode` &&
            c.method === 'PATCH',
        ),
      ).toBe(true);
    });
    const sovereigntyCall = calls.find((c) => c.path.includes('/sovereignty-mode'));
    expect(sovereigntyCall?.body).toEqual({ sovereignty_mode: 'alternating' });
  });
});

// Slice 5-S9 — "Why this?" plan reasoning panel.
describe('BriefCanvas — Why this? reasoning panel (5-S9)', () => {
  it('does not render "Why this?" when plan_reasoning is null', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ brief: makeBrief() } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => expect(screen.getByLabelText('Monday')).toBeDefined());
    expect(screen.queryByRole('button', { name: /why this/i })).toBeNull();
  });

  it('passes onWhyThis to tiles when plan_reasoning is non-null', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      brief: makeBrief({ payload: { plan_reasoning: 'Pasta Mon+Tue for batch-prep.' } }),
    } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /why this/i }).length).toBeGreaterThan(0),
    );
  });

  it('shows the reasoning panel on "Why this?" click and dismisses it on ✕', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      brief: makeBrief({ payload: { plan_reasoning: 'Pasta Mon+Tue for batch-prep.' } }),
    } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /why this/i }).length).toBeGreaterThan(0),
    );

    // Panel hidden until the parent opts to see it.
    expect(screen.queryByText(/Lumi.s thinking/)).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: /why this/i })[0]!);
    expect(screen.getByText(/Lumi.s thinking/)).toBeDefined();
    expect(screen.getByText('Pasta Mon+Tue for batch-prep.')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /close reasoning/i }));
    expect(screen.queryByText(/Lumi.s thinking/)).toBeNull();
  });
});

// Story 13-s4 — Brief as a finished surface (the pilot): Lumi-voice note,
// thread-less draft state, and the no-chat-layout invariant.
describe('BriefCanvas — 13-s4 finished surface', () => {
  it('renders the lumi_note as a Lumi-voice line with a terracotta "Lumi —" tag', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ brief: makeBrief() } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => {
      expect(screen.getByText('Tuesday flexes around your late meeting.')).toBeDefined();
    });
    expect(screen.getByText(/Lumi\s*—/)).toBeDefined();
  });

  it('omits the Lumi-voice line when lumi_note is empty', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      brief: makeBrief({ lumi_note: '' }),
    } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => expect(screen.getByLabelText('Weekly plan')).toBeDefined());
    expect(screen.queryByText(/Lumi\s*—/)).toBeNull();
  });

  it('shows a thread-less "Lumi is drafting…" state while the brief loads', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockImplementation(() => new Promise<BriefResponse>(() => {}));

    renderWithClient(<BriefCanvas />);

    expect(screen.getByText(/Lumi is drafting/i)).toBeDefined();
    // Thread-less: the draft state mounts no Lumi sheet/dialog and no composer.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('renders the freshness line in the hero, between the Lumi note and the week', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockRejectedValue(new Error('Network error'));

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 60_000, staleTime: 0 } },
    });
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

    await waitFor(() => expect(screen.getByRole('status')).toBeDefined());
    const lumiNote = screen.getByText('Tuesday flexes around your late meeting.');
    const freshness = screen.getByRole('status');
    const week = screen.getByLabelText('Weekly plan');
    // Node.DOCUMENT_POSITION_FOLLOWING === 4 — note → freshness → week.
    expect(lumiNote.compareDocumentPosition(freshness) & 4).toBe(4);
    expect(freshness.compareDocumentPosition(week) & 4).toBe(4);
  });

  it('renders no chat composer or message log on the finished surface', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ brief: makeBrief() } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => expect(screen.getByLabelText('Weekly plan')).toBeDefined());
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('log')).toBeNull();
  });
});

// Story 14-s3 — the week is an editorial day-row itinerary. The container label
// and per-day <article> contract are unchanged (13-s1); these pin the new
// itinerary affordances that are derived in WeekGrid.
describe('BriefCanvas — 14-s3 editorial itinerary', () => {
  const RECIPE_A = '77777777-7777-4777-8777-777777777771';
  const RECIPE_B = '77777777-7777-4777-8777-777777777772';

  function briefWithMains(recipeByDay: Record<string, string>) {
    const brief = makeBrief();
    brief.payload.tile_summaries = brief.payload.tile_summaries.map((t) => ({
      ...t,
      items: t.items.map((i) => ({ ...i, recipe_id: recipeByDay[t.day] })),
    }));
    return brief;
  }

  it('marks the later of two consecutive days sharing a main as a repeat', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      brief: briefWithMains({
        monday: RECIPE_A,
        tuesday: RECIPE_A,
        wednesday: RECIPE_B,
        thursday: RECIPE_B,
        friday: RECIPE_A,
      }),
    } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => expect(screen.getByLabelText('Weekly plan')).toBeDefined());
    // Tuesday repeats Monday; Thursday repeats Wednesday. Friday is A again but
    // NOT consecutive with Thursday's B, so it carries full prominence.
    expect(screen.getAllByText('again')).toHaveLength(2);
    expect(screen.getByLabelText('Tuesday').textContent).toContain('again');
    expect(screen.getByLabelText('Thursday').textContent).toContain('again');
    expect(screen.getByLabelText('Friday').textContent).not.toContain('again');
  });

  it('marks no repeats when every day has a distinct main', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    // Review P5 — distinct recipe_ids on every day, so this exercises the real
    // distinct-mains path (the default fixture has no recipe_id at all, which
    // made this assertion vacuous).
    vi.mocked(hkFetch).mockResolvedValue({
      brief: briefWithMains({
        monday: '77777777-7777-4777-8777-777777777701',
        tuesday: '77777777-7777-4777-8777-777777777702',
        wednesday: '77777777-7777-4777-8777-777777777703',
        thursday: '77777777-7777-4777-8777-777777777704',
        friday: '77777777-7777-4777-8777-777777777705',
      }),
    } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => expect(screen.getByLabelText('Weekly plan')).toBeDefined());
    expect(screen.queryByText('again')).toBeNull();
  });

  // Review P3 — "again" means CALENDAR-consecutive: a shared main across a
  // missing day (the composer omits days with no tile items) is not a repeat.
  it('does not mark a repeat across a missing day', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    const brief = briefWithMains({
      monday: RECIPE_A,
      tuesday: RECIPE_A,
      wednesday: RECIPE_B,
      thursday: RECIPE_B,
      friday: RECIPE_A,
    });
    // Drop Wednesday entirely: Tuesday(A) → [gap] → Thursday(B) → Friday... make
    // Thursday share Tuesday's main so array-adjacency would flag it.
    brief.payload.tile_summaries = brief.payload.tile_summaries
      .filter((t) => t.day !== 'wednesday')
      .map((t) =>
        t.day === 'thursday'
          ? { ...t, items: t.items.map((i) => ({ ...i, recipe_id: RECIPE_A })) }
          : t,
      );
    vi.mocked(hkFetch).mockResolvedValue({ brief } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => expect(screen.getByLabelText('Weekly plan')).toBeDefined());
    // Tuesday still repeats Monday (adjacent); Thursday must NOT repeat Tuesday
    // across the missing Wednesday.
    expect(screen.getByLabelText('Tuesday').textContent).toContain('again');
    expect(screen.getByLabelText('Thursday').textContent).not.toContain('again');
  });

  // Review P2 — legacy pre-3.12 rows carry plan_item_id: null; with no swap in
  // flight (swappingItemId null) they must render decided, not a stuck spinner.
  it('does not render a phantom swap-in-progress overlay for null plan_item_id rows', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    const brief = makeBrief();
    brief.payload.tile_summaries = brief.payload.tile_summaries.map((t) => ({
      ...t,
      items: t.items.map((i) => ({ ...i, plan_item_id: null })),
    }));
    vi.mocked(hkFetch).mockResolvedValue({ brief } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => expect(screen.getByLabelText('Weekly plan')).toBeDefined());
    expect(screen.queryByLabelText('Swap in progress')).toBeNull();
  });

  it('renders each day row with its calendar date', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({ brief: makeBrief() } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    // MONDAY_MORNING is Mon 4 May 2026, so the week runs May 4 → May 8.
    await waitFor(() => expect(screen.getByLabelText('Monday').textContent).toContain('May 4'));
    expect(screen.getByLabelText('Friday').textContent).toContain('May 8');
  });

  it('prefers the resolved dish name over the ingredient fallback', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    const brief = makeBrief();
    brief.payload.tile_summaries[0] = {
      ...brief.payload.tile_summaries[0]!,
      items: [
        {
          ...brief.payload.tile_summaries[0]!.items[0]!,
          name: 'Chicken Biriyani',
        },
      ],
    };
    vi.mocked(hkFetch).mockResolvedValue({ brief } satisfies BriefResponse);

    renderWithClient(<BriefCanvas />);

    await waitFor(() => expect(screen.getByLabelText('Weekly plan')).toBeDefined());
    // The resolved name stands alone — ingredients are not appended to it.
    expect(screen.getByText('Chicken Biriyani')).toBeDefined();
    expect(screen.getByLabelText('Monday').textContent).not.toContain('rice');
    // The older ingredient-only rows still render their derived line.
    expect(screen.getByLabelText('Tuesday').textContent).toContain('noodles');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
  act,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GetPlansResponse } from '@hivekitchen/types';
import { useAuthStore } from '@/stores/auth.store.js';
import { PlanPage, isNextWeekDraftAvailable } from './PlanPage.js';

vi.mock('@/lib/fetch.js', () => ({
  hkFetch: vi.fn(),
}));

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const PLAN_ID = '99999999-9999-4999-8999-999999999999';
const PLAN_DAY_ID = '00000000-0000-4000-8000-000000000080';
const SLOT_ID = '00000000-0000-4000-8000-000000000010';
const MAIN_ASSIGNMENT_ID = '00000000-0000-4000-8000-000000000020';
const VARIATION_ID = '00000000-0000-4000-8000-000000000030';

const TS = '2026-05-02T11:00:00.000Z';

// Story 3-DM-C1 Phase 9b part 4 step 4 — fixture helpers for the tree-shape
// PlanPage. The page now consumes GetPlansResponse (plan + four arrays)
// instead of the flat plan_items[] shape.
function emptyTreeResponse(weekOf: string, opts: { is_draft?: boolean; plan?: GetPlansResponse['plan'] } = {}): GetPlansResponse {
  return {
    plan: opts.plan ?? null,
    main_assignments: [],
    days: [],
    slots: [],
    variations: [],
    is_draft: opts.is_draft ?? false,
    week_of: weekOf,
  };
}

function planRow(weekOf: string): NonNullable<GetPlansResponse['plan']> {
  return {
    id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_of: weekOf,
    revision: 1,
    generated_at: TS,
    guardrail_cleared_at: TS,
    guardrail_version: 'v1.0.0',
    prompt_version: 'v1.0.0',
    state: null,
    state_set_at: null,
    state_message: null,
    created_at: TS,
    updated_at: TS,
  };
}

function singleMainTreeResponse(weekOf: string, opts: { is_draft?: boolean } = {}): GetPlansResponse {
  return {
    plan: planRow(weekOf),
    main_assignments: [
      {
        id: MAIN_ASSIGNMENT_ID,
        plan_id: PLAN_ID,
        sequence: 1,
        recipe_id: '00000000-0000-4000-8000-0000000000aa',
        created_at: TS,
      },
    ],
    days: [
      {
        id: PLAN_DAY_ID,
        plan_id: PLAN_ID,
        day: 'monday',
        paused_at: null,
        paused_reason: null,
        paused_note: null,
        created_at: TS,
        updated_at: TS,
      },
    ],
    slots: [
      {
        id: SLOT_ID,
        plan_day_id: PLAN_DAY_ID,
        slot_kind: 'main',
        main_assignment_id: MAIN_ASSIGNMENT_ID,
        recipe_id: null,
        extra_kind: null,
        snack_sku_id: null,
        paused_at: null,
        created_at: TS,
        updated_at: TS,
      },
    ],
    variations: [
      {
        id: VARIATION_ID,
        plan_slot_id: SLOT_ID,
        child_id: CHILD_ID,
        portion_size: 'regular',
        texture: 'normal',
        spice_level: 'mild',
        cutting_style: null,
        container: null,
        add_ons: ['rice', 'beans'],
        removals: [],
        notes: null,
        paused_at: null,
        created_at: TS,
        updated_at: TS,
      },
    ],
    is_draft: opts.is_draft ?? false,
    week_of: weekOf,
  };
}

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
  // Story 3.15 — PlanPage renders a <Link> to last week's history view,
  // which requires a Router context. MemoryRouter keeps existing tests stable.
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  document.documentElement.classList.add('app-scope');
  setUser();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  clearUser();
  document.documentElement.classList.remove('app-scope');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('isNextWeekDraftAvailable (Story 3.14)', () => {
  it('returns true on Saturday', () => {
    expect(isNextWeekDraftAvailable(new Date('2026-05-02T00:00:00Z'))).toBe(true);
  });

  it('returns true on Sunday', () => {
    expect(isNextWeekDraftAvailable(new Date('2026-05-03T00:00:00Z'))).toBe(true);
  });

  it('returns true on Friday after 16:00 UTC', () => {
    expect(isNextWeekDraftAvailable(new Date('2026-05-01T16:00:00Z'))).toBe(true);
  });

  it('returns false on Friday before 16:00 UTC', () => {
    expect(isNextWeekDraftAvailable(new Date('2026-05-01T15:59:00Z'))).toBe(false);
  });

  it('returns false on Wednesday', () => {
    expect(isNextWeekDraftAvailable(new Date('2026-05-06T20:00:00Z'))).toBe(false);
  });
});

describe('PlanPage — week tabs (Story 3.14, tree shape)', () => {
  it('renders both week tabs with the current-week selected by default', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue(emptyTreeResponse('2026-05-04'));

    renderWithClient(<PlanPage />);

    const thisWeek = screen.getByRole('tab', { name: 'This week' });
    const nextWeek = screen.getByRole('tab', { name: 'Next week' });
    expect(thisWeek.getAttribute('aria-selected')).toBe('true');
    expect(nextWeek.getAttribute('aria-selected')).toBe('false');
  });

  it('disables the Next-week tab on a Wednesday', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-06T12:00:00Z')); // Wednesday

    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue(emptyTreeResponse('2026-05-04'));

    renderWithClient(<PlanPage />);

    const nextWeek = screen.getByRole('tab', { name: 'Next week' }) as HTMLButtonElement;
    expect(nextWeek.disabled).toBe(true);
  });

  it('enables the Next-week tab on Saturday and switches the active tab on click', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-02T12:00:00Z')); // Saturday

    const { hkFetch } = await import('@/lib/fetch.js');
    const fetchMock = vi.mocked(hkFetch).mockResolvedValue(emptyTreeResponse('2026-05-04'));

    renderWithClient(<PlanPage />);

    const nextWeek = screen.getByRole('tab', { name: 'Next week' }) as HTMLButtonElement;
    expect(nextWeek.disabled).toBe(false);

    fireEvent.click(nextWeek);

    await waitFor(() => {
      expect(nextWeek.getAttribute('aria-selected')).toBe('true');
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/v1/plans?week=next',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  it('resets to the current-week tab when the next-week window closes (Monday transition)', async () => {
    let intervalTick: (() => void) | null = null;
    const realSetInterval = window.setInterval.bind(window);
    const setIntervalSpy = vi
      .spyOn(window, 'setInterval')
      .mockImplementation((fn: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delay === 60_000) intervalTick = fn as () => void;
        return realSetInterval(fn, delay, ...args);
      });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-02T12:00:00Z')); // Saturday

    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue(emptyTreeResponse('2026-05-11', { is_draft: true }));

    renderWithClient(<PlanPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Next week' }));
    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: 'Next week' }).getAttribute('aria-selected'),
      ).toBe('true');
    });

    vi.setSystemTime(new Date('2026-05-04T00:01:00Z'));
    await act(async () => { intervalTick!(); });

    await waitFor(() => {
      expect(
        screen.getByRole('tab', { name: 'This week' }).getAttribute('aria-selected'),
      ).toBe('true');
    });
    expect((screen.getByRole('tab', { name: 'Next week' }) as HTMLButtonElement).disabled).toBe(true);

    setIntervalSpy.mockRestore();
  });
});

describe('PlanPage — content states (Story 3.14, tree shape)', () => {
  it('renders the "Lumi is drafting next week" copy when next-week plan is null', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-02T12:00:00Z'));

    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue(emptyTreeResponse('2026-05-04', { is_draft: true }));

    renderWithClient(<PlanPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Next week' }));

    await waitFor(() => {
      expect(
        screen.getByText('Lumi is drafting next week — about 30 seconds'),
      ).toBeDefined();
    });
  });

  it('renders the weekday tiles when a tree-shape plan is returned', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue(singleMainTreeResponse('2026-05-04'));

    renderWithClient(<PlanPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Weekly plan')).toBeDefined();
    });
    expect(screen.getByLabelText('Monday')).toBeDefined();
    expect(screen.getByLabelText('Friday')).toBeDefined();
  });

  it('shows the draft-disclaimer copy when is_draft is true and the plan has data', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-02T12:00:00Z'));

    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue(singleMainTreeResponse('2026-05-11', { is_draft: true }));

    renderWithClient(<PlanPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Next week' }));

    await waitFor(() => {
      expect(
        screen.getByText('This is a draft — Lumi may refine it before Monday.'),
      ).toBeDefined();
    });
  });
});

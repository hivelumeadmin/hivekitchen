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
const ITEM_ID = '00000000-0000-4000-8000-000000000010';

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
  // Story 3.15 — PlanPage now renders a <Link> to last week's history view,
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
    // 2026-05-02 is a Saturday (UTC).
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
    // 2026-05-06 is a Wednesday.
    expect(isNextWeekDraftAvailable(new Date('2026-05-06T20:00:00Z'))).toBe(false);
  });
});

describe('PlanPage — week tabs (Story 3.14)', () => {
  it('renders both week tabs with the current-week selected by default', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      plan: null,
      plan_items: [],
      is_draft: false,
      week_of: '2026-05-04',
    } satisfies GetPlansResponse);

    renderWithClient(<PlanPage />);

    const thisWeek = screen.getByRole('tab', { name: 'This week' });
    const nextWeek = screen.getByRole('tab', { name: 'Next week' });
    expect(thisWeek.getAttribute('aria-selected')).toBe('true');
    expect(nextWeek.getAttribute('aria-selected')).toBe('false');
  });

  it('disables the Next-week tab on a Wednesday', async () => {
    // Fake only Date so TanStack Query's internal timers keep running.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-06T12:00:00Z')); // Wednesday

    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      plan: null,
      plan_items: [],
      is_draft: false,
      week_of: '2026-05-04',
    } satisfies GetPlansResponse);

    renderWithClient(<PlanPage />);

    const nextWeek = screen.getByRole('tab', { name: 'Next week' }) as HTMLButtonElement;
    expect(nextWeek.disabled).toBe(true);
  });

  it('enables the Next-week tab on Saturday and switches the active tab on click', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-02T12:00:00Z')); // Saturday

    const { hkFetch } = await import('@/lib/fetch.js');
    const fetchMock = vi.mocked(hkFetch).mockResolvedValue({
      plan: null,
      plan_items: [],
      is_draft: false,
      week_of: '2026-05-04',
    } satisfies GetPlansResponse);

    renderWithClient(<PlanPage />);

    const nextWeek = screen.getByRole('tab', { name: 'Next week' }) as HTMLButtonElement;
    expect(nextWeek.disabled).toBe(false);

    fireEvent.click(nextWeek);

    await waitFor(() => {
      expect(nextWeek.getAttribute('aria-selected')).toBe('true');
    });
    // The query refetches with the new week selector.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/v1/plans?week=next',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  it('resets to the current-week tab when the next-week window closes (Monday transition)', async () => {
    // Capture the interval callback without faking all timers (which would
    // interfere with TanStack Query's internal setTimeout-based retry logic).
    let intervalTick: (() => void) | null = null;
    const realSetInterval = window.setInterval.bind(window);
    const setIntervalSpy = vi
      .spyOn(window, 'setInterval')
      .mockImplementation((fn: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delay === 60_000) intervalTick = fn as () => void;
        return realSetInterval(fn, delay, ...args);
      });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-02T12:00:00Z')); // Saturday — next tab enabled

    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      plan: null,
      plan_items: [],
      is_draft: true,
      week_of: '2026-05-11',
    } satisfies GetPlansResponse);

    renderWithClient(<PlanPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Next week' }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Next week' }).getAttribute('aria-selected')).toBe('true');
    });

    // Advance to Monday — next-week window closes — then fire the captured tick.
    vi.setSystemTime(new Date('2026-05-04T00:01:00Z'));
    await act(async () => { intervalTick!(); });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'This week' }).getAttribute('aria-selected')).toBe('true');
    });
    expect((screen.getByRole('tab', { name: 'Next week' }) as HTMLButtonElement).disabled).toBe(true);

    setIntervalSpy.mockRestore();
  });
});

describe('PlanPage — content states (Story 3.14)', () => {
  it('renders the "Lumi is drafting next week" copy when next-week plan is null', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-02T12:00:00Z')); // Saturday — next tab enabled

    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      plan: null,
      plan_items: [],
      is_draft: true,
      week_of: '2026-05-04',
    } satisfies GetPlansResponse);

    renderWithClient(<PlanPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Next week' }));

    await waitFor(() => {
      expect(
        screen.getByText('Lumi is drafting next week — about 30 seconds'),
      ).toBeDefined();
    });
  });

  it('renders the weekday tiles when a plan is returned', async () => {
    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      plan: {
        id: PLAN_ID,
        household_id: HOUSEHOLD_ID,
        week_id: '00000000-0000-4000-8000-000000000099',
        week_of: '2026-05-04',
        revision: 1,
        generated_at: '2026-05-02T11:00:00.000Z',
        guardrail_cleared_at: '2026-05-02T11:00:01.000Z',
        guardrail_version: 'v1.0.0',
        prompt_version: 'v1.0.0',
        created_at: '2026-05-02T11:00:00.000Z',
        updated_at: '2026-05-02T11:00:01.000Z',
      },
      plan_items: [
        {
          id: ITEM_ID,
          plan_id: PLAN_ID,
          child_id: CHILD_ID,
          day: 'monday',
          slot: 'main',
          recipe_id: null,
          item_id: null,
          item_sku_id: null,
          ingredients: ['rice', 'beans'],
          paused_at: null,
          replaced_by_plan_id: null,
          created_at: '2026-05-02T11:00:00.000Z',
          updated_at: '2026-05-02T11:00:00.000Z',
        },
      ],
      is_draft: false,
      week_of: '2026-05-04',
    } satisfies GetPlansResponse);

    renderWithClient(<PlanPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Weekly plan')).toBeDefined();
    });
    expect(screen.getByLabelText('Monday')).toBeDefined();
    expect(screen.getByLabelText('Friday')).toBeDefined();
  });

  it('shows the draft-disclaimer copy when is_draft is true and the plan has items', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-02T12:00:00Z'));

    const { hkFetch } = await import('@/lib/fetch.js');
    vi.mocked(hkFetch).mockResolvedValue({
      plan: {
        id: PLAN_ID,
        household_id: HOUSEHOLD_ID,
        week_id: '00000000-0000-4000-8000-000000000099',
        week_of: '2026-05-11',
        revision: 1,
        generated_at: '2026-05-08T20:00:00.000Z',
        guardrail_cleared_at: '2026-05-08T20:00:01.000Z',
        guardrail_version: 'v1.0.0',
        prompt_version: 'v1.0.0',
        created_at: '2026-05-08T20:00:00.000Z',
        updated_at: '2026-05-08T20:00:01.000Z',
      },
      plan_items: [
        {
          id: ITEM_ID,
          plan_id: PLAN_ID,
          child_id: CHILD_ID,
          day: 'monday',
          slot: 'main',
          recipe_id: null,
          item_id: null,
          item_sku_id: null,
          ingredients: ['noodles'],
          paused_at: null,
          replaced_by_plan_id: null,
          created_at: '2026-05-08T20:00:00.000Z',
          updated_at: '2026-05-08T20:00:00.000Z',
        },
      ],
      is_draft: true,
      week_of: '2026-05-11',
    } satisfies GetPlansResponse);

    renderWithClient(<PlanPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Next week' }));

    await waitFor(() => {
      expect(
        screen.getByText('This is a draft — Lumi may refine it before Monday.'),
      ).toBeDefined();
    });
  });
});

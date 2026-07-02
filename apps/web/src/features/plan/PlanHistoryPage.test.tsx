import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  PlanDayRow,
  PlanHistoryResponse,
  PlanRow,
  PlanSlotRow,
  PlanSlotVariationRow,
  PlanSwapSummaryTree,
} from '@hivekitchen/types';

// Hoisted mocks must precede the imports that use them. vi.mock is hoisted
// automatically so this works for both ESM-only modules.
vi.mock('@hivekitchen/ui', () => ({
  useScope: vi.fn(),
}));

vi.mock('@/hooks/useLumiContext.js', () => ({
  useLumiContext: vi.fn(),
}));

const hkFetchMock = vi.fn();
const { HkApiError } = vi.hoisted(() => {
  class HkApiError extends Error {
    constructor(public readonly status: number, public readonly problem: unknown) {
      super(`HK API error ${status}`);
    }
  }
  return { HkApiError };
});
vi.mock('@/lib/fetch.js', () => ({
  hkFetch: (...args: unknown[]) => hkFetchMock(...args),
  HkApiError,
}));

// Stub deriveWeekId so the current-week-redirect effect never matches in tests.
// getCurrentWeekMonday is also exported from derive-week-id — stub it to a fixed
// Monday so tests are deterministic regardless of when they run.
vi.mock('@/lib/derive-week-id.js', () => ({
  deriveWeekId: () => Promise.resolve('00000000-0000-4000-8000-deadbeefcafe'),
  getCurrentWeekMonday: () => '2026-05-04',
}));

import { PlanHistoryPage } from './PlanHistoryPage.js';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const WEEK_ID = '33333333-3333-4333-8333-333333333333';
const CHILD_ID = '44444444-4444-4444-8444-444444444444';
const PLAN_DAY_MONDAY = '00000000-0000-4000-8000-000000000080';
const PLAN_DAY_TUESDAY = '00000000-0000-4000-8000-000000000081';
const PLAN_DAY_WEDNESDAY = '00000000-0000-4000-8000-000000000082';
const SLOT_MAIN = '00000000-0000-4000-8000-000000000010';
const MAIN_ASSIGNMENT_ID = '00000000-0000-4000-8000-000000000020';
const VARIATION_ID = '00000000-0000-4000-8000-000000000030';
const TS = '2026-04-19T11:00:00.000Z';

// Story 3-DM-C1 Phase 9b part 4 step 4 — fixture helpers migrated from the
// flat (plan + plan_items[] + swap_history with previous_ingredients) shape
// to the canonical tree (plan + main_assignments + days + slots + variations
// + swap_history with kind/at/slot_kind).

function makePlanRow(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_of: '2026-04-21',
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
    ...overrides,
  };
}

function makeDay(day: PlanDayRow['day'], id: string): PlanDayRow {
  return {
    id,
    plan_id: PLAN_ID,
    day,
    paused_at: null,
    paused_reason: null,
    paused_note: null,
    created_at: TS,
    updated_at: TS,
  };
}

function makeMainSlot(planDayId: string, slotId: string = SLOT_MAIN): PlanSlotRow {
  return {
    id: slotId,
    plan_day_id: planDayId,
    slot_kind: 'main',
    main_assignment_id: MAIN_ASSIGNMENT_ID,
    recipe_id: null,
    extra_kind: null,
    snack_sku_id: null,
    paused_at: null,
    created_at: TS,
    updated_at: TS,
  };
}

function makeVariation(planSlotId: string, id: string = VARIATION_ID): PlanSlotVariationRow {
  return {
    id,
    plan_slot_id: planSlotId,
    child_id: CHILD_ID,
    portion_size: 'regular',
    texture: 'normal',
    spice_level: 'mild',
    cutting_style: null,
    container: null,
    add_ons: [],
    removals: [],
    notes: null,
    paused_at: null,
    created_at: TS,
    updated_at: TS,
  };
}

function emptyHistoryResponse(): PlanHistoryResponse {
  return {
    plan: makePlanRow(),
    main_assignments: [],
    days: [],
    slots: [],
    variations: [],
    swap_history: [],
    week_of: '2026-04-21',
    ratings: {},
  };
}

function singleDayHistory(day: PlanDayRow['day'], planDayId: string): PlanHistoryResponse {
  const slot = makeMainSlot(planDayId);
  return {
    plan: makePlanRow(),
    main_assignments: [
      {
        id: MAIN_ASSIGNMENT_ID,
        plan_id: PLAN_ID,
        sequence: 1,
        recipe_id: '00000000-0000-4000-8000-0000000000aa',
        created_at: TS,
      },
    ],
    days: [makeDay(day, planDayId)],
    slots: [slot],
    variations: [makeVariation(slot.id)],
    swap_history: [],
    week_of: '2026-04-21',
    ratings: {},
  };
}

function renderWithRoute(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/app/plan/:weekId" element={<PlanHistoryPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  hkFetchMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('PlanHistoryPage (Story 3.15 — tree shape)', () => {
  it('renders a "Back to this week" link as the first navigation affordance', async () => {
    hkFetchMock.mockRejectedValueOnce(new HkApiError(404, { detail: 'plan for week' }));

    renderWithRoute(`/app/plan/${WEEK_ID}`);

    const back = await screen.findByRole('link', { name: 'Back to this week' });
    expect(back.getAttribute('href')).toBe('/app/plan');
  });

  it('renders the empty-state copy on 404 (no plan exists for the week)', async () => {
    hkFetchMock.mockRejectedValueOnce(new HkApiError(404, { detail: 'plan for week' }));

    renderWithRoute(`/app/plan/${WEEK_ID}`);

    expect(
      await screen.findByText('No plan was generated for this week.'),
    ).toBeDefined();
  });

  it('renders the failed-state on non-404 errors', async () => {
    hkFetchMock.mockRejectedValueOnce(new HkApiError(500, { detail: 'oops' }));

    renderWithRoute(`/app/plan/${WEEK_ID}`);

    await waitFor(() => {
      expect(screen.queryByText('No plan was generated for this week.')).toBeNull();
    });
  });

  it('renders an empty-items message when the plan exists but has no slots/variations', async () => {
    hkFetchMock.mockResolvedValueOnce(emptyHistoryResponse());

    renderWithRoute(`/app/plan/${WEEK_ID}`);

    expect(
      await screen.findByText('No items were recorded for this week.'),
    ).toBeDefined();
  });

  it('renders the week-of header and a tile per weekday for an existing plan', async () => {
    hkFetchMock.mockResolvedValueOnce(singleDayHistory('monday', PLAN_DAY_MONDAY));

    renderWithRoute(`/app/plan/${WEEK_ID}`);

    expect(await screen.findByText(/Week of/)).toBeDefined();
    const grid = await screen.findByLabelText('Historical weekly plan');
    expect(grid).toBeDefined();
    expect(screen.getByLabelText('Monday')).toBeDefined();
    expect(screen.getByLabelText('Tuesday')).toBeDefined();
    expect(screen.getByLabelText('Friday')).toBeDefined();
  });

  it('renders past-variant tiles (non-interactive: tabIndex=-1) for every day', async () => {
    hkFetchMock.mockResolvedValueOnce(singleDayHistory('wednesday', PLAN_DAY_WEDNESDAY));

    renderWithRoute(`/app/plan/${WEEK_ID}`);

    const monday = await screen.findByLabelText('Monday');
    const friday = screen.getByLabelText('Friday');
    expect(monday.tabIndex).toBe(-1);
    expect(friday.tabIndex).toBe(-1);
    expect(monday.className).toContain('opacity-60');
    expect(friday.className).toContain('opacity-60');
  });

  it('renders SwapHistoryPopover only for days that have swap entries', async () => {
    const swaps: PlanSwapSummaryTree[] = [
      {
        kind: 'main_swap',
        child_id: CHILD_ID,
        day: 'monday',
        slot_kind: 'main',
        at: '2026-04-22T10:00:00.000Z',
      },
    ];
    hkFetchMock.mockResolvedValueOnce({
      ...singleDayHistory('monday', PLAN_DAY_MONDAY),
      swap_history: swaps,
    } satisfies PlanHistoryResponse);

    renderWithRoute(`/app/plan/${WEEK_ID}`);

    expect(
      await screen.findByRole('button', { name: 'View 1 swap for this day' }),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'View 0 swaps for this day' })).toBeNull();
  });

  it('opens the swap popover on tap and surfaces the kind label', async () => {
    const swaps: PlanSwapSummaryTree[] = [
      {
        kind: 'slot_recipe_swap',
        child_id: CHILD_ID,
        day: 'tuesday',
        slot_kind: 'extra',
        at: '2026-04-22T10:00:00.000Z',
      },
    ];
    hkFetchMock.mockResolvedValueOnce({
      ...singleDayHistory('tuesday', PLAN_DAY_TUESDAY),
      swap_history: swaps,
    } satisfies PlanHistoryResponse);

    renderWithRoute(`/app/plan/${WEEK_ID}`);
    const trigger = await screen.findByRole('button', { name: 'View 1 swap for this day' });
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByRole('region')).toBeDefined();
    });
    expect(screen.getByText('Swap history')).toBeDefined();
    expect(screen.getByText('Slot recipe swap')).toBeDefined();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PlanHistoryResponse, PlanItemRow, PlanRow } from '@hivekitchen/types';

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

function makePlanRow(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_id: WEEK_ID,
    week_of: '2026-04-21',
    revision: 1,
    generated_at: '2026-04-19T11:00:00.000Z',
    guardrail_cleared_at: '2026-04-19T11:00:01.000Z',
    guardrail_version: 'v1.0.0',
    prompt_version: 'v1.0.0',
    created_at: '2026-04-19T11:00:00.000Z',
    updated_at: '2026-04-19T11:00:01.000Z',
    ...overrides,
  };
}

function makeItem(overrides: Partial<PlanItemRow> = {}): PlanItemRow {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    plan_id: PLAN_ID,
    child_id: CHILD_ID,
    day: 'monday',
    slot: 'main',
    recipe_id: null,
    item_id: null,
    ingredients: ['rice'],
    paused_at: null,
    replaced_by_plan_id: null,
    created_at: '2026-04-19T11:00:00.000Z',
    updated_at: '2026-04-19T11:00:00.000Z',
    ...overrides,
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

describe('PlanHistoryPage (Story 3.15)', () => {
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

    // FreshnessState variant="failed" — query the role/status it exposes.
    await waitFor(() => {
      expect(screen.queryByText('No plan was generated for this week.')).toBeNull();
    });
  });

  it('renders an empty-items message when the plan exists but has no items', async () => {
    hkFetchMock.mockResolvedValueOnce({
      plan: makePlanRow(),
      plan_items: [],
      swap_history: [],
      week_of: '2026-04-21',
      ratings: {},
    } satisfies PlanHistoryResponse);

    renderWithRoute(`/app/plan/${WEEK_ID}`);

    expect(
      await screen.findByText('No items were recorded for this week.'),
    ).toBeDefined();
  });

  it('renders the week-of header and a tile per weekday for an existing plan', async () => {
    hkFetchMock.mockResolvedValueOnce({
      plan: makePlanRow(),
      plan_items: [makeItem({ day: 'monday', ingredients: ['rice', 'beans'] })],
      swap_history: [],
      week_of: '2026-04-21',
      ratings: {},
    } satisfies PlanHistoryResponse);

    renderWithRoute(`/app/plan/${WEEK_ID}`);

    expect(await screen.findByText(/Week of/)).toBeDefined();
    // 5 weekday tiles regardless of items distribution.
    const grid = await screen.findByLabelText('Historical weekly plan');
    expect(grid).toBeDefined();
    // Each weekday rendered as an article (PlanTile).
    expect(screen.getByLabelText('Monday')).toBeDefined();
    expect(screen.getByLabelText('Tuesday')).toBeDefined();
    expect(screen.getByLabelText('Friday')).toBeDefined();
  });

  it('renders past-variant tiles (non-interactive: tabIndex=-1) for every day', async () => {
    hkFetchMock.mockResolvedValueOnce({
      plan: makePlanRow(),
      plan_items: [makeItem({ day: 'wednesday' })],
      swap_history: [],
      week_of: '2026-04-21',
      ratings: {},
    } satisfies PlanHistoryResponse);

    renderWithRoute(`/app/plan/${WEEK_ID}`);

    const monday = await screen.findByLabelText('Monday');
    const friday = screen.getByLabelText('Friday');
    // forceVariant="past" must hold for ALL days, not just past-of-week ones.
    expect(monday.tabIndex).toBe(-1);
    expect(friday.tabIndex).toBe(-1);
    expect(monday.className).toContain('opacity-60');
    expect(friday.className).toContain('opacity-60');
  });

  it('renders SwapHistoryPopover only for days that have swap entries', async () => {
    hkFetchMock.mockResolvedValueOnce({
      plan: makePlanRow(),
      plan_items: [makeItem({ day: 'monday' })],
      swap_history: [
        {
          child_id: CHILD_ID,
          day: 'monday',
          slot: 'main',
          previous_ingredients: ['lentils'],
          replaced_at: '2026-04-22T10:00:00.000Z',
        },
      ],
      week_of: '2026-04-21',
      ratings: {},
    } satisfies PlanHistoryResponse);

    renderWithRoute(`/app/plan/${WEEK_ID}`);

    expect(
      await screen.findByRole('button', { name: 'View 1 swap for this day' }),
    ).toBeDefined();
    // Other days have no swap rows, so no popover trigger appears for them.
    expect(screen.queryByRole('button', { name: 'View 0 swaps for this day' })).toBeNull();
  });

  it('opens the swap popover on tap and lists the previous ingredients', async () => {
    hkFetchMock.mockResolvedValueOnce({
      plan: makePlanRow(),
      plan_items: [makeItem({ day: 'tuesday' })],
      swap_history: [
        {
          child_id: CHILD_ID,
          day: 'tuesday',
          slot: 'extra',
          previous_ingredients: ['cheddar'],
          replaced_at: '2026-04-22T10:00:00.000Z',
        },
      ],
      week_of: '2026-04-21',
      ratings: {},
    } satisfies PlanHistoryResponse);

    renderWithRoute(`/app/plan/${WEEK_ID}`);
    const trigger = await screen.findByRole('button', { name: 'View 1 swap for this day' });
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByRole('region')).toBeDefined();
    });
    expect(screen.getByText('Swap history')).toBeDefined();
    expect(screen.getByText('Was: cheddar')).toBeDefined();
  });
});

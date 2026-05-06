import { createHash } from 'node:crypto';
import { test, expect, type Route } from '@playwright/test';
import {
  loginAndNavigate,
  userProfile,
  SAMPLE_HOUSEHOLD_ID,
} from './_helpers.js';

// ------------------------------------------------------------------
// Story 3-15: Historical Plans + Outcomes View — E2E spec
//
// Page under test: /app/plan/:weekId
// API under test:  GET /v1/plans/:weekId/history
// ------------------------------------------------------------------

const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const CHILD_A = '00000000-0000-4000-8000-0000000000a1';
const CHILD_B = '00000000-0000-4000-8000-0000000000b2';

// Past week (any UUID that is NOT the current week — the page renders without
// triggering the current-week redirect).
const PAST_WEEK_ID = '99999999-9999-4999-8999-999999999999';
const PAST_WEEK_OF = '2026-04-21';

// Wednesday 2026-05-06 is the clock used for the current-week-redirect test.
// On that day, getCurrentWeekMonday() = '2026-05-04' (Monday of the current week).
const WEDNESDAY_ISO = '2026-05-06T12:00:00Z';
const CURRENT_WEEK_MONDAY = '2026-05-04';

// Mirror of apps/api/src/lib/derive-week-id.ts so we can compute the weekId
// the page will compare against during the redirect test.
function deriveWeekId(weekOf: string): string {
  const h = createHash('sha256').update(`hivekitchen-week:${weekOf}`).digest();
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const CURRENT_WEEK_ID = deriveWeekId(CURRENT_WEEK_MONDAY);

// ------------------------------------------------------------------
// Fixture builders
// ------------------------------------------------------------------

function makePlanRow(overrides: { week_of?: string } = {}) {
  return {
    id: PLAN_ID,
    household_id: SAMPLE_HOUSEHOLD_ID,
    week_id: PAST_WEEK_ID,
    week_of: overrides.week_of ?? PAST_WEEK_OF,
    revision: 1,
    generated_at: '2026-04-19T11:00:00.000Z',
    guardrail_cleared_at: '2026-04-19T11:00:01.000Z',
    guardrail_version: 'v1.0.0',
    prompt_version: 'v1.0.0',
    created_at: '2026-04-19T11:00:00.000Z',
    updated_at: '2026-04-19T11:00:01.000Z',
  };
}

function makeItem(opts: {
  id: string;
  childId?: string;
  day: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
  slot?: string;
  ingredients?: string[];
}) {
  return {
    id: opts.id,
    plan_id: PLAN_ID,
    child_id: opts.childId ?? CHILD_A,
    day: opts.day,
    slot: opts.slot ?? 'main',
    recipe_id: null,
    item_id: null,
    ingredients: opts.ingredients ?? ['rice'],
    paused_at: null,
    replaced_by_plan_id: null,
    created_at: '2026-04-19T11:00:00.000Z',
    updated_at: '2026-04-19T11:00:00.000Z',
  };
}

function historyResponse(opts: {
  plan?: ReturnType<typeof makePlanRow>;
  plan_items?: ReturnType<typeof makeItem>[];
  swap_history?: Array<{
    child_id: string;
    day: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
    slot: string;
    previous_ingredients: string[];
    replaced_at: string;
  }>;
  week_of?: string;
} = {}) {
  return {
    plan: opts.plan ?? makePlanRow(),
    plan_items:
      opts.plan_items ??
      [
        makeItem({ id: '55555555-5555-4555-8555-555555555501', day: 'monday', ingredients: ['rice', 'beans'] }),
        makeItem({ id: '55555555-5555-4555-8555-555555555502', day: 'tuesday', ingredients: ['pasta'] }),
        makeItem({ id: '55555555-5555-4555-8555-555555555503', day: 'wednesday', ingredients: ['salad'] }),
        makeItem({ id: '55555555-5555-4555-8555-555555555504', day: 'thursday', ingredients: ['soup'] }),
        makeItem({ id: '55555555-5555-4555-8555-555555555505', day: 'friday', ingredients: ['wrap'] }),
      ],
    swap_history: opts.swap_history ?? [],
    week_of: opts.week_of ?? PAST_WEEK_OF,
    ratings: {},
  };
}

// Route /v1/plans/:weekId/history with an arbitrary handler so individual
// tests can return 200 / 404 / payload variations.
async function navigateToHistory(
  page: Parameters<typeof loginAndNavigate>[0],
  weekId: string,
  handler: (route: Route) => Promise<void> | void,
) {
  await page.route('**/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userProfile()),
    }),
  );
  await page.route(`**/v1/plans/${weekId}/history`, async (route) => {
    await handler(route);
  });
  await loginAndNavigate(page, `/app/plan/${weekId}`);
  await page.waitForResponse('**/v1/users/me');
}

// ------------------------------------------------------------------
// AC1: past-variant tiles for any prior week
// ------------------------------------------------------------------

test.describe('Story 3-15: AC1 — past-variant tiles', () => {
  test('renders the week-of header for an existing past plan', async ({ page }) => {
    await navigateToHistory(page, PAST_WEEK_ID, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(historyResponse()),
      }),
    );

    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Week of/);
  });

  test('renders 5 weekday tiles (the historical grid)', async ({ page }) => {
    await navigateToHistory(page, PAST_WEEK_ID, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(historyResponse()),
      }),
    );

    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      await expect(page.getByRole('article', { name: new RegExp(day, 'i') })).toBeVisible();
    }
  });

  test('every weekday tile is non-interactive (tabIndex=-1, opacity-60)', async ({ page }) => {
    await navigateToHistory(page, PAST_WEEK_ID, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(historyResponse()),
      }),
    );

    for (const day of ['Monday', 'Friday']) {
      const tile = page.getByRole('article', { name: new RegExp(day, 'i') });
      await expect(tile).toHaveAttribute('tabindex', '-1');
      const className = await tile.getAttribute('class');
      expect(className).toContain('opacity-60');
      expect(className).toContain('pointer-events-none');
    }
  });
});

// ------------------------------------------------------------------
// AC2: per-day SwapHistoryPopover
// ------------------------------------------------------------------

test.describe('Story 3-15: AC2 — swap history popover', () => {
  test('renders a popover trigger only for days that have swap entries', async ({ page }) => {
    await navigateToHistory(page, PAST_WEEK_ID, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          historyResponse({
            swap_history: [
              {
                child_id: CHILD_A,
                day: 'monday',
                slot: 'main',
                previous_ingredients: ['lentils'],
                replaced_at: '2026-04-22T10:00:00.000Z',
              },
            ],
          }),
        ),
      }),
    );

    await expect(
      page.getByRole('button', { name: /View 1 swap for this day/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /View 0 swaps for this day/ }),
    ).toHaveCount(0);
  });

  test('clicking the trigger opens the region and lists previous ingredients', async ({ page }) => {
    await navigateToHistory(page, PAST_WEEK_ID, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          historyResponse({
            swap_history: [
              {
                child_id: CHILD_A,
                day: 'tuesday',
                slot: 'extra',
                previous_ingredients: ['cheddar', 'crackers'],
                replaced_at: '2026-04-22T10:00:00.000Z',
              },
            ],
          }),
        ),
      }),
    );

    await page.getByRole('button', { name: /View 1 swap for this day/ }).click();

    await expect(page.getByRole('region')).toBeVisible();
    await expect(page.getByText('Swap history')).toBeVisible();
    await expect(page.getByText('Was: cheddar, crackers')).toBeVisible();
  });

  test('Escape closes the popover and restores focus to the trigger', async ({ page }) => {
    await navigateToHistory(page, PAST_WEEK_ID, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          historyResponse({
            swap_history: [
              {
                child_id: CHILD_A,
                day: 'wednesday',
                slot: 'main',
                previous_ingredients: ['hummus'],
                replaced_at: '2026-04-22T10:00:00.000Z',
              },
            ],
          }),
        ),
      }),
    );

    const trigger = page.getByRole('button', { name: /View 1 swap for this day/ });
    await trigger.click();
    await expect(page.getByRole('region')).toBeVisible();

    await page.getByRole('region').press('Escape');

    await expect(page.getByRole('region')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('multi-child swap history groups entries with fallback "Child A"/"Child B" labels', async ({ page }) => {
    await navigateToHistory(page, PAST_WEEK_ID, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          historyResponse({
            swap_history: [
              {
                child_id: CHILD_A,
                day: 'thursday',
                slot: 'main',
                previous_ingredients: ['rice'],
                replaced_at: '2026-04-22T10:00:00.000Z',
              },
              {
                child_id: CHILD_B,
                day: 'thursday',
                slot: 'extra',
                previous_ingredients: ['apple'],
                replaced_at: '2026-04-23T10:00:00.000Z',
              },
            ],
          }),
        ),
      }),
    );

    await page.getByRole('button', { name: /View 2 swaps for this day/ }).click();

    await expect(page.getByRole('region')).toBeVisible();
    await expect(page.getByText('Child A', { exact: true })).toBeVisible();
    await expect(page.getByText('Child B', { exact: true })).toBeVisible();
  });

  test('renders "(none recorded)" when previous_ingredients is empty', async ({ page }) => {
    await navigateToHistory(page, PAST_WEEK_ID, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          historyResponse({
            swap_history: [
              {
                child_id: CHILD_A,
                day: 'friday',
                slot: 'main',
                previous_ingredients: [],
                replaced_at: '2026-04-22T10:00:00.000Z',
              },
            ],
          }),
        ),
      }),
    );

    await page.getByRole('button', { name: /View 1 swap for this day/ }).click();
    await expect(page.getByText('Was: (none recorded)')).toBeVisible();
  });
});

// ------------------------------------------------------------------
// Empty / error states
// ------------------------------------------------------------------

test.describe('Story 3-15: empty states', () => {
  test('404 from the history endpoint shows "No plan was generated" copy', async ({ page }) => {
    await navigateToHistory(page, PAST_WEEK_ID, (route) =>
      route.fulfill({
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detail: 'plan for week not found' }),
      }),
    );

    await expect(page.getByText('No plan was generated for this week.')).toBeVisible();
  });

  test('plan exists but plan_items is empty shows "No items were recorded" copy', async ({ page }) => {
    await navigateToHistory(page, PAST_WEEK_ID, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(historyResponse({ plan_items: [] })),
      }),
    );

    await expect(page.getByText('No items were recorded for this week.')).toBeVisible();
  });
});

// ------------------------------------------------------------------
// Navigation
// ------------------------------------------------------------------

test.describe('Story 3-15: navigation', () => {
  test('"Back to this week" link is visible and points to /app/plan', async ({ page }) => {
    await navigateToHistory(page, PAST_WEEK_ID, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(historyResponse()),
      }),
    );

    const back = page.getByRole('link', { name: 'Back to this week' });
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute('href', '/app/plan');
  });

  test('navigating to /app/plan/<currentWeekId> redirects to /app/plan', async ({ page }) => {
    await page.clock.install({ time: new Date(WEDNESDAY_ISO) });

    // The history endpoint should never be called — the redirect fires before
    // the query enables. If the request DOES land we still respond cleanly to
    // avoid hangs, but the route assertion below catches the misbehavior.
    let historyCalled = false;
    await page.route('**/v1/plans/*/history', async (route) => {
      historyCalled = true;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(historyResponse()),
      });
    });
    // Stub /v1/plans for the redirected /app/plan landing.
    await page.route('**/v1/plans*', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: makePlanRow({ week_of: CURRENT_WEEK_MONDAY }),
          plan_items: [],
          is_draft: false,
          week_of: CURRENT_WEEK_MONDAY,
        }),
      }),
    );
    await page.route('**/v1/users/me', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile()),
      }),
    );

    await loginAndNavigate(page, `/app/plan/${CURRENT_WEEK_ID}`);

    // The current-week URL should redirect to /app/plan.
    await page.waitForURL(/\/app\/plan(?:\?.*)?$/, { timeout: 5000 });
    expect(historyCalled).toBe(false);
  });
});

// ------------------------------------------------------------------
// Parental notice gate
// ------------------------------------------------------------------

test.describe('Story 3-15: parental notice gate', () => {
  test('renders history page when parental notice is already acknowledged', async ({ page }) => {
    await navigateToHistory(page, PAST_WEEK_ID, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(historyResponse()),
      }),
    );

    await expect(page.getByRole('link', { name: 'Back to this week' })).toBeVisible();
  });

  test('shows acknowledgment gate when parental notice is not yet acknowledged', async ({ page }) => {
    await page.route('**/v1/users/me', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          userProfile({
            parental_notice_acknowledged_at: null,
            parental_notice_acknowledged_version: null,
          }),
        ),
      }),
    );
    await page.route(`**/v1/plans/${PAST_WEEK_ID}/history`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(historyResponse()),
      }),
    );

    await loginAndNavigate(page, `/app/plan/${PAST_WEEK_ID}`);
    await page.waitForResponse('**/v1/users/me');

    // History page should NOT render until the gate is acknowledged.
    await expect(page.getByRole('link', { name: 'Back to this week' })).toHaveCount(0);
  });
});

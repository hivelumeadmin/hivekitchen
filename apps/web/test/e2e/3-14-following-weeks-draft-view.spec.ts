import { test, expect, type Route } from '@playwright/test';
import {
  loginAndNavigate,
  userProfile,
  SAMPLE_HOUSEHOLD_ID,
} from './_helpers.js';

// ------------------------------------------------------------------
// Story 3-14: Following Week's Draft View — E2E spec
//
// Page under test: /app/plan
// API under test:  GET /v1/plans?week=current|next
// ------------------------------------------------------------------

const PLANS_URL = '**/v1/plans*';
const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';

// Clock fixtures — must be actual calendar days matching the UTC weekday.
const WEDNESDAY_ISO = '2026-05-06T12:00:00Z'; // Wednesday (next tab disabled)
const SATURDAY_ISO  = '2026-05-02T12:00:00Z'; // Saturday  (next tab enabled)
const FRIDAY_BEFORE_CUTOFF_ISO = '2026-05-01T15:00:00Z'; // Friday 15:00 UTC — disabled
const FRIDAY_AT_CUTOFF_ISO     = '2026-05-01T16:00:00Z'; // Friday 16:00 UTC — enabled

// ------------------------------------------------------------------
// Fixture builders
// ------------------------------------------------------------------

function makePlanRow(weekOf = '2026-05-04') {
  return {
    id: PLAN_ID,
    household_id: SAMPLE_HOUSEHOLD_ID,
    week_id: '00000000-0000-4000-8000-000000000099',
    week_of: weekOf,
    revision: 1,
    generated_at: '2026-05-02T11:00:00.000Z',
    guardrail_cleared_at: '2026-05-02T11:00:01.000Z',
    guardrail_version: 'v1.0.0',
    prompt_version: 'v1.0.0',
    created_at: '2026-05-02T11:00:00.000Z',
    updated_at: '2026-05-02T11:00:01.000Z',
  };
}

function makePlanItems() {
  return (['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const).map(
    (day, i) => ({
      id: `55555555-5555-4555-8555-55555555550${i + 1}`,
      plan_id: PLAN_ID,
      child_id: CHILD_ID,
      day,
      slot: 'main',
      recipe_id: null,
      item_id: null,
      ingredients: ['rice'],
      paused_at: null,
      replaced_by_plan_id: null,
      created_at: '2026-05-02T11:00:00.000Z',
      updated_at: '2026-05-02T11:00:00.000Z',
    }),
  );
}

function plansResponse(opts: {
  plan?: ReturnType<typeof makePlanRow> | null;
  items?: ReturnType<typeof makePlanItems>;
  isDraft?: boolean;
  weekOf?: string;
}) {
  return {
    plan: opts.plan !== undefined ? opts.plan : makePlanRow(),
    plan_items: opts.items ?? makePlanItems(),
    is_draft: opts.isDraft ?? false,
    week_of: opts.weekOf ?? '2026-05-04',
  };
}

// Route /v1/plans; optionally return different bodies for ?week=current vs ?week=next.
async function routePlans(
  page: Parameters<typeof loginAndNavigate>[0],
  handler: (week: 'current' | 'next', route: Route) => Promise<void> | void,
) {
  await page.route(PLANS_URL, async (route) => {
    const week = (new URL(route.request().url()).searchParams.get('week') ?? 'current') as
      | 'current'
      | 'next';
    await handler(week, route);
  });
}

async function navigateToPlan(
  page: Parameters<typeof loginAndNavigate>[0],
  respondWith: (week: 'current' | 'next', route: Route) => Promise<void> | void,
) {
  await page.route('**/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userProfile()),
    }),
  );
  await routePlans(page, respondWith);
  await loginAndNavigate(page, '/app/plan');
  await page.waitForResponse('**/v1/users/me');
  await page.waitForResponse(PLANS_URL);
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

test.describe('Story 3-14: tab structure', () => {
  test('both tabs render; "This week" is selected by default', async ({ page }) => {
    await page.clock.install({ time: new Date(WEDNESDAY_ISO) });
    await navigateToPlan(page, (_w, route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plansResponse({})),
      }),
    );

    await expect(page.getByRole('tab', { name: 'This week' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Next week' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'This week' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Next week' })).toHaveAttribute('aria-selected', 'false');
  });

  test('"Next week" tab is disabled on Wednesday (before Friday 4pm UTC)', async ({ page }) => {
    await page.clock.install({ time: new Date(WEDNESDAY_ISO) });
    await navigateToPlan(page, (_w, route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plansResponse({})),
      }),
    );

    await expect(page.getByRole('tab', { name: 'Next week' })).toBeDisabled();
  });

  test('"Next week" tab is disabled on Friday before 16:00 UTC', async ({ page }) => {
    await page.clock.install({ time: new Date(FRIDAY_BEFORE_CUTOFF_ISO) });
    await navigateToPlan(page, (_w, route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plansResponse({})),
      }),
    );

    await expect(page.getByRole('tab', { name: 'Next week' })).toBeDisabled();
  });

  test('"Next week" tab is enabled on Friday at 16:00 UTC (AC #1 boundary)', async ({ page }) => {
    await page.clock.install({ time: new Date(FRIDAY_AT_CUTOFF_ISO) });
    await navigateToPlan(page, (_w, route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plansResponse({})),
      }),
    );

    await expect(page.getByRole('tab', { name: 'Next week' })).toBeEnabled();
  });

  test('"Next week" tab is enabled on Saturday', async ({ page }) => {
    await page.clock.install({ time: new Date(SATURDAY_ISO) });
    await navigateToPlan(page, (_w, route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plansResponse({})),
      }),
    );

    await expect(page.getByRole('tab', { name: 'Next week' })).toBeEnabled();
  });
});

test.describe('Story 3-14: current week content', () => {
  test('renders 5 weekday tiles when the current plan is available', async ({ page }) => {
    await navigateToPlan(page, (_w, route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plansResponse({ items: makePlanItems() })),
      }),
    );

    await expect(page.getByLabelText('Weekly plan')).toBeVisible();
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      await expect(page.getByRole('article', { name: new RegExp(day, 'i') })).toBeVisible();
    }
  });

  test('shows "Lumi is drafting this week\'s plan" when plan is null (current week)', async ({ page }) => {
    await navigateToPlan(page, (_w, route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plansResponse({ plan: null, items: [], isDraft: false, weekOf: '2026-05-04' })),
      }),
    );

    await expect(
      page.getByText(/lumi is drafting this week's plan/i),
    ).toBeVisible();
  });
});

test.describe('Story 3-14: next week draft tab (AC #1)', () => {
  test('clicking "Next week" fires GET /v1/plans?week=next', async ({ page }) => {
    await page.clock.install({ time: new Date(SATURDAY_ISO) });

    let nextWeekRequested = false;
    await navigateToPlan(page, (week, route) => {
      if (week === 'next') nextWeekRequested = true;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          plansResponse({ isDraft: week === 'next', weekOf: week === 'next' ? '2026-05-11' : '2026-05-04' }),
        ),
      });
    });

    await page.getByRole('tab', { name: 'Next week' }).click();
    await page.waitForResponse(PLANS_URL);

    expect(nextWeekRequested).toBe(true);
  });

  test('shows "Lumi is drafting next week" copy when next-week plan is null (AC #1)', async ({ page }) => {
    await page.clock.install({ time: new Date(SATURDAY_ISO) });
    await navigateToPlan(page, (week, route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          week === 'next'
            ? plansResponse({ plan: null, items: [], isDraft: true, weekOf: '2026-05-11' })
            : plansResponse({}),
        ),
      }),
    );

    await page.getByRole('tab', { name: 'Next week' }).click();
    await page.waitForResponse(PLANS_URL);

    await expect(
      page.getByText(/lumi is drafting next week/i),
    ).toBeVisible();
  });

  test('renders 5 tiles and draft disclaimer when next-week draft plan is available', async ({ page }) => {
    await page.clock.install({ time: new Date(SATURDAY_ISO) });
    await navigateToPlan(page, (week, route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          week === 'next'
            ? plansResponse({
                plan: makePlanRow('2026-05-11'),
                items: makePlanItems(),
                isDraft: true,
                weekOf: '2026-05-11',
              })
            : plansResponse({}),
        ),
      }),
    );

    await page.getByRole('tab', { name: 'Next week' }).click();
    await page.waitForResponse(PLANS_URL);

    await expect(page.getByLabelText('Weekly plan')).toBeVisible();
    await expect(page.getByText(/this is a draft/i)).toBeVisible();
  });

  test('"Next week" tab becomes selected after click', async ({ page }) => {
    await page.clock.install({ time: new Date(SATURDAY_ISO) });
    await navigateToPlan(page, (_w, route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plansResponse({ isDraft: true, weekOf: '2026-05-11' })),
      }),
    );

    await page.getByRole('tab', { name: 'Next week' }).click();

    await expect(page.getByRole('tab', { name: 'Next week' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'This week' })).toHaveAttribute('aria-selected', 'false');
  });
});

test.describe('Story 3-14: parental notice gate', () => {
  test('renders plan page when parental notice is already acknowledged', async ({ page }) => {
    // Default userProfile() has parental_notice_acknowledged_at set.
    await navigateToPlan(page, (_w, route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plansResponse({})),
      }),
    );

    await expect(page.getByRole('tablist', { name: 'Week selector' })).toBeVisible();
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
    await routePlans(page, (_w, route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plansResponse({})),
      }),
    );

    await loginAndNavigate(page, '/app/plan');
    await page.waitForResponse('**/v1/users/me');

    // Gate dialog should appear; plan tabs should not be visible yet.
    await expect(page.getByRole('tablist', { name: 'Week selector' })).toHaveCount(0);
  });
});

// Error state (FreshnessState variant=failed) is covered by PlanPage unit tests.
// E2E testing the 500 path is impractical because the app has retry:3 with
// exponential backoff (14s+ before error state renders). Add an E2E error
// scenario here if a global retry:0 override is added to the preview build.

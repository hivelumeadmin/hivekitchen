import { test, expect } from '@playwright/test';
import {
  loginAndNavigate,
  userProfile,
  SAMPLE_HOUSEHOLD_ID,
} from './_helpers.js';

// ------------------------------------------------------------------
// Story 3-25 / 3-26: Hard-fail Escalation — graceful-degradation UX
//
// Page under test: /app/plan
// API under test:  GET /v1/plans
//
// Story 3-26 supersedes the provisional <AccountableError /> from 3-25 with
// <FreshnessState variant="reworking" />. Hard-fail payload now carries
// `failed_at` so the client renders a real estimated recovery time.
//
// Key behaviours:
//   - hard_fail present + plan null + !isDraft  → reworking copy + role="status"
//   - hard_fail absent  + plan null + !isDraft  → "Lumi is drafting" copy
//   - hard_fail present + isDraft               → drafting copy (not reworking)
//   - hard_fail present + plan present          → plan tiles (not reworking)
// ------------------------------------------------------------------

const PLANS_URL = '**/v1/plans*';
const PLAN_ID   = '44444444-4444-4444-8444-444444444444';
const CHILD_ID  = '33333333-3333-4333-8333-333333333333';
const WEEK_OF   = '2026-05-04';
const FAILED_AT = '2026-05-02T10:30:00.000Z';

function makePlanRow(weekOf = WEEK_OF) {
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
  hardFail?: { week_of: string; failed_at: string };
}) {
  const body: Record<string, unknown> = {
    plan: opts.plan !== undefined ? opts.plan : makePlanRow(),
    plan_items: opts.items ?? [],
    is_draft: opts.isDraft ?? false,
    week_of: opts.weekOf ?? WEEK_OF,
  };
  if (opts.hardFail !== undefined) {
    body.hard_fail = opts.hardFail;
  }
  return body;
}

async function navigateToPlan(
  page: Parameters<typeof loginAndNavigate>[0],
  apiBody: Record<string, unknown>,
) {
  await page.route('**/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userProfile()),
    }),
  );
  await page.route(PLANS_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiBody),
    }),
  );
  await loginAndNavigate(page, '/app/plan');
  await page.waitForResponse('**/v1/users/me');
  await page.waitForResponse(PLANS_URL);
}

// ------------------------------------------------------------------
// hard_fail present → reworking copy renders
// ------------------------------------------------------------------

test.describe('Story 3-26: reworking state renders on hard-fail', () => {
  test('shows reworking copy when plan is null and hard_fail is present', async ({ page }) => {
    await navigateToPlan(
      page,
      plansResponse({
        plan: null,
        items: [],
        isDraft: false,
        weekOf: WEEK_OF,
        hardFail: { week_of: WEEK_OF, failed_at: FAILED_AT },
      }),
    );

    await expect(page.getByText(/Lumi is reworking this week's plan/)).toBeVisible();
  });

  test('reworking element carries role="status"', async ({ page }) => {
    await navigateToPlan(
      page,
      plansResponse({
        plan: null,
        items: [],
        isDraft: false,
        weekOf: WEEK_OF,
        hardFail: { week_of: WEEK_OF, failed_at: FAILED_AT },
      }),
    );

    await expect(page.getByRole('status')).toBeVisible();
  });

  test('does NOT show "Lumi is drafting" copy when hard_fail is present', async ({ page }) => {
    await navigateToPlan(
      page,
      plansResponse({
        plan: null,
        items: [],
        isDraft: false,
        weekOf: WEEK_OF,
        hardFail: { week_of: WEEK_OF, failed_at: FAILED_AT },
      }),
    );

    await expect(page.getByText(/lumi is drafting/i)).toHaveCount(0);
  });
});

// ------------------------------------------------------------------
// hard_fail absent → normal drafting copy
// ------------------------------------------------------------------

test.describe('Story 3-26: normal drafting copy when no hard_fail', () => {
  test('shows "Lumi is drafting this week\'s plan" when plan is null and no hard_fail', async ({ page }) => {
    await navigateToPlan(
      page,
      plansResponse({
        plan: null,
        items: [],
        isDraft: false,
        weekOf: WEEK_OF,
        // hard_fail intentionally absent
      }),
    );

    await expect(page.getByText(/lumi is drafting this week's plan/i)).toBeVisible();
  });

  test('does NOT show reworking copy when hard_fail is absent', async ({ page }) => {
    await navigateToPlan(
      page,
      plansResponse({
        plan: null,
        items: [],
        isDraft: false,
        weekOf: WEEK_OF,
      }),
    );

    await expect(page.getByText(/Lumi is reworking/i)).toHaveCount(0);
  });
});

// ------------------------------------------------------------------
// draft path: hard_fail present but isDraft=true → drafting copy
// ------------------------------------------------------------------

test.describe('Story 3-26: draft path suppresses reworking state', () => {
  test('shows "Lumi is drafting next week" copy even when hard_fail is present on a draft', async ({ page }) => {
    await navigateToPlan(
      page,
      plansResponse({
        plan: null,
        items: [],
        isDraft: true,
        weekOf: '2026-05-11',
        hardFail: { week_of: '2026-05-11', failed_at: FAILED_AT },
      }),
    );

    await expect(page.getByText(/lumi is drafting next week/i)).toBeVisible();
    await expect(page.getByText(/Lumi is reworking/i)).toHaveCount(0);
  });
});

// ------------------------------------------------------------------
// plan present: hard_fail field in response → plan tiles render
// ------------------------------------------------------------------

test.describe('Story 3-26: plan tiles render when plan is present regardless of hard_fail', () => {
  test('renders plan content when plan is non-null even if hard_fail is in the response', async ({ page }) => {
    await navigateToPlan(
      page,
      plansResponse({
        plan: makePlanRow(),
        items: makePlanItems(),
        isDraft: false,
        weekOf: WEEK_OF,
        hardFail: { week_of: WEEK_OF, failed_at: FAILED_AT },
      }),
    );

    await expect(page.getByRole('article', { name: /monday/i })).toBeVisible();
    await expect(page.getByText(/Lumi is reworking/i)).toHaveCount(0);
  });
});

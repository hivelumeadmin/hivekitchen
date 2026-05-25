import { test, expect } from '@playwright/test';
import {
  loginAndNavigate,
  userProfile,
  SAMPLE_HOUSEHOLD_ID,
} from './_helpers.js';

const PLANS_URL = '**/v1/plans*';
const PLAN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLAN_ITEM_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CHILD_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROPOSAL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

// Monday 2026-05-04 08:00 UTC — ensures "monday" tile is today+morning,
// not "past", so pointer-events are active and choice pills are reachable.
const MONDAY_MORNING = new Date('2026-05-04T08:00:00Z');

function plansResponse() {
  return {
    plan: {
      id: PLAN_ID,
      household_id: SAMPLE_HOUSEHOLD_ID,
      week_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      week_of: '2026-05-04',
      revision: 1,
      generated_at: '2026-05-04T00:00:00.000Z',
      guardrail_cleared_at: '2026-05-04T00:01:00.000Z',
      guardrail_version: 'v1',
      prompt_version: 'v1',
      created_at: '2026-05-04T00:00:00.000Z',
      updated_at: '2026-05-04T00:00:00.000Z',
    },
    plan_items: [
      {
        id: PLAN_ITEM_ID,
        plan_id: PLAN_ID,
        child_id: CHILD_ID,
        day: 'monday',
        slot: 'main',
        ingredients: ['chicken', 'rice', 'peas'],
        paused_at: null,
        recipe_id: null,
        item_id: null,
        replaced_by_plan_id: null,
        created_at: '2026-05-04T00:00:00.000Z',
        updated_at: '2026-05-04T00:00:00.000Z',
      },
    ],
    is_draft: false,
    week_of: '2026-05-04',
    variant_proposals: [
      {
        id: PROPOSAL_ID,
        household_id: SAMPLE_HOUSEHOLD_ID,
        child_id: CHILD_ID,
        plan_item_id: PLAN_ITEM_ID,
        plan_id: PLAN_ID,
        base_recipe_name: 'chicken, rice, peas',
        base_method: 'pan-fried',
        variant_description: 'oven-baked instead of pan-fried',
        variant_method: 'oven-baked',
        proposed_at: '2026-05-04T10:00:00.000Z',
        confirmed_at: null,
        rejected_at: null,
      },
    ],
  };
}

async function navigateToPlan(page: import('@playwright/test').Page) {
  await page.clock.install({ time: MONDAY_MORNING });
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
      body: JSON.stringify(plansResponse()),
    }),
  );
  await loginAndNavigate(page, '/app/plan');
  await page.waitForResponse('**/v1/users/me');
  await page.waitForResponse(PLANS_URL);
}

test.describe('Story 3-27: variant proposal pills', () => {
  test('renders the variant description on the Monday tile when a proposal is active (AC #1)', async ({
    page,
  }) => {
    await navigateToPlan(page);
    const tile = page.getByRole('article', { name: 'Monday' });
    await expect(tile.getByText('oven-baked instead of pan-fried')).toBeVisible();
  });

  test('renders both choice pills on the tile with the active proposal (AC #1)', async ({
    page,
  }) => {
    await navigateToPlan(page);
    const tile = page.getByRole('article', { name: 'Monday' });
    await expect(tile.getByRole('button', { name: 'Try the variant' })).toBeVisible();
    await expect(tile.getByRole('button', { name: 'Keep the original' })).toBeVisible();
  });

  test('tiles without a proposal do not show choice pills (AC #1)', async ({
    page,
  }) => {
    await navigateToPlan(page);
    const tuesdayTile = page.getByRole('article', { name: 'Tuesday' });
    await expect(tuesdayTile.getByRole('button', { name: 'Try the variant' })).not.toBeVisible();
  });

  test('"Try the variant" pill posts try_variant to the confirm endpoint (AC #2)', async ({
    page,
  }) => {
    await navigateToPlan(page);

    const confirmUrl = `**/v1/plans/${PLAN_ID}/variant-proposals/${PROPOSAL_ID}/confirm`;
    await page.route(confirmUrl, (route) => route.fulfill({ status: 200, body: '' }));

    // Register waitForRequest BEFORE the click so the fast-firing async
    // request is not missed.
    const [req] = await Promise.all([
      page.waitForRequest(confirmUrl),
      page
        .getByRole('article', { name: 'Monday' })
        .getByRole('button', { name: 'Try the variant' })
        .click(),
    ]);

    expect(JSON.parse(req.postData() ?? '{}')).toMatchObject({ choice: 'try_variant' });
  });

  test('"Keep the original" pill posts keep_original to the confirm endpoint (AC #2)', async ({
    page,
  }) => {
    await navigateToPlan(page);

    const confirmUrl = `**/v1/plans/${PLAN_ID}/variant-proposals/${PROPOSAL_ID}/confirm`;
    await page.route(confirmUrl, (route) => route.fulfill({ status: 200, body: '' }));

    const [req] = await Promise.all([
      page.waitForRequest(confirmUrl),
      page
        .getByRole('article', { name: 'Monday' })
        .getByRole('button', { name: 'Keep the original' })
        .click(),
    ]);

    expect(JSON.parse(req.postData() ?? '{}')).toMatchObject({ choice: 'keep_original' });
  });

  test('Monday tile has the pending-input dashed border treatment (AC #1)', async ({
    page,
  }) => {
    await navigateToPlan(page);
    const tile = page.getByRole('article', { name: 'Monday' });
    const cls = await tile.getAttribute('class') ?? '';
    expect(cls).toContain('border-dashed');
  });
});

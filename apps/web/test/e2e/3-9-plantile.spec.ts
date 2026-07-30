import { test, expect } from '@playwright/test';
import {
  loginAndNavigate,
  userProfile,
  SAMPLE_HOUSEHOLD_ID,
} from './_helpers.js';

const BRIEF_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`;
const CHILD_ID = '33333333-3333-4333-8333-333333333333';

function briefResponse() {
  return {
    brief: {
      household_id: SAMPLE_HOUSEHOLD_ID,
      moment_headline: 'A quiet week, with one small surprise.',
      lumi_note: 'Tuesday flexes around your late meeting.',
      memory_prose: '',
      payload: {
        cleared_allergies: [],
        scaffolding_diff: null,
        plan_state: null,
        plan_state_set_at: null,
        plan_state_message: null,
        tile_summaries: [
          { day: 'monday',    items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['rice', 'beans'] }] },
          { day: 'tuesday',   items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['noodles', 'tofu', 'broccoli', 'sesame'] }] },
          { day: 'wednesday', items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['pasta'] }] },
          { day: 'thursday',  items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['soup'] }] },
          { day: 'friday',    items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['wrap'] }] },
        ],
      },
      generated_at: '2026-05-02T00:00:00.000Z',
      plan_revision: 1,
      updated_at: '2026-05-02T00:00:00.000Z',
    },
  };
}

async function navigateToApp(page: import('@playwright/test').Page) {
  // Pin the clock to a Monday so every weekday tile renders as today/upcoming.
  // PlanTile.deriveVariant() compares tile.day to new Date().getDay(); without
  // pinning, days earlier in the week than the real-world clock render as
  // 'past' (tabindex=-1 + pointer-events-none) and break the focus tests.
  await page.clock.install({ time: new Date('2026-05-04T08:00:00Z') });

  await page.route('**/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userProfile()),
    }),
  );
  await page.route(BRIEF_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(briefResponse()),
    }),
  );
  await page.route('**/v1/plans*', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: null, plan_items: [], is_draft: false, week_of: '2026-05-04' }),
    }),
  );
  await loginAndNavigate(page, '/app');
  await page.waitForResponse('**/v1/users/me');
  await page.waitForResponse(BRIEF_URL);
}

test.describe('Story 3-9: PlanTile', () => {
  test('renders five day articles with weekday labels (AC #1)', async ({
    page,
  }) => {
    await navigateToApp(page);

    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      await expect(page.getByRole('article', { name: day })).toBeVisible();
    }
  });

  test('each day tile has an h2 weekday heading (AC #1)', async ({ page }) => {
    await navigateToApp(page);

    await expect(
      page.getByRole('heading', { level: 2, name: 'Monday' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Friday' }),
    ).toBeVisible();
  });

  test('renders a dish line per tile (AC #1)', async ({ page }) => {
    await navigateToApp(page);

    await expect(page.getByText('rice, beans')).toBeVisible();
    // Tuesday has 4 ingredients, so the +N more overflow is shown.
    await expect(
      page.getByText('noodles, tofu, broccoli +1 more'),
    ).toBeVisible();
  });

  test('Tab moves focus through the plan tiles (AC #3)', async ({ page }) => {
    await navigateToApp(page);

    // Reach the first plan tile by repeatedly tabbing from the page top.
    const firstTile = page.getByRole('article', { name: 'Monday' });
    await firstTile.focus();
    await expect(firstTile).toBeFocused();

    // Slice 5-S3 — each tile is followed by its PackerChip button, and 14-s4
    // added the "Open day" link after it, so reaching the next day's tile
    // takes three Tab presses.
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: /claimed monday|packs monday/i }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Open Monday' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('article', { name: 'Tuesday' }),
    ).toBeFocused();
  });

  test('Escape blurs the focused tile (AC #3)', async ({ page }) => {
    await navigateToApp(page);

    const tile = page.getByRole('article', { name: 'Monday' });
    await tile.focus();
    await expect(tile).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(tile).not.toBeFocused();
  });
});

import { test, expect, type Page, type Route } from '@playwright/test';
import { loginAndNavigate, userProfile, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

// ------------------------------------------------------------------
// Story 3-22: Passive Bias from Extra Removals + High-Activity Extra Proposal
//
// E2E coverage is limited to the observable UI surface:
//
//   AC1 path — swapping an Extra-slot item fires the correct PATCH request
//   (the bias signal recording is fire-and-forget server-side and has no
//    UI surface; it cannot be directly verified in a browser test).
//
//   AC2 MVP — a plan brief that includes an Extra item on a high-activity
//   day (sport_practice/field_trip, child Extra normally OFF) renders the
//   Extra ingredient in the PlanTile. No confirmation UX yet (deferred).
//
// The passive-bias accumulation and silent ban write are intentionally
// invisible per the product spec and have no UI surface to assert.
// ------------------------------------------------------------------

const BRIEF_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`;
const PLAN_ID   = '44444444-4444-4444-8444-444444444444';
const CHILD_ID  = '33333333-3333-4333-8333-333333333333';

const ITEM_MON_MAIN  = '55555555-5555-4555-8555-555555555501';
const ITEM_WED_MAIN  = '55555555-5555-4555-8555-555555555503';
const ITEM_WED_EXTRA = '55555555-5555-4555-8555-555555555510';

const SWAP_URL   = `**/v1/plans/${PLAN_ID}/items/*`;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ------------------------------------------------------------------
// Fixture builders
// ------------------------------------------------------------------

function briefWithHighActivityExtra(opts: {
  extraIngredients?: string[];
} = {}) {
  const extraIngredients = opts.extraIngredients ?? ['granola bar'];
  return {
    brief: {
      household_id: SAMPLE_HOUSEHOLD_ID,
      plan_id: PLAN_ID,
      moment_headline: 'A busy week.',
      lumi_note: '',
      memory_prose: '',
      plan_tile_summaries: [
        {
          day: 'monday',
          paused: false,
          items: [{ plan_item_id: ITEM_MON_MAIN, child_id: CHILD_ID, slot: 'main', ingredients: ['rice', 'beans'] }],
        },
        {
          day: 'tuesday',
          paused: false,
          items: [{ plan_item_id: '55555555-5555-4555-8555-555555555502', child_id: CHILD_ID, slot: 'main', ingredients: ['noodles'] }],
        },
        {
          // Wednesday = sport_practice day; planner proposed an Extra for this child
          // (Extra slot normally OFF, but high-activity override detected — AC2 MVP).
          day: 'wednesday',
          paused: false,
          items: [
            { plan_item_id: ITEM_WED_MAIN,  child_id: CHILD_ID, slot: 'main',  ingredients: ['pasta'] },
            { plan_item_id: ITEM_WED_EXTRA, child_id: CHILD_ID, slot: 'extra', ingredients: extraIngredients },
          ],
        },
        {
          day: 'thursday',
          paused: false,
          items: [{ plan_item_id: '55555555-5555-4555-8555-555555555504', child_id: CHILD_ID, slot: 'main', ingredients: ['soup'] }],
        },
        {
          day: 'friday',
          paused: false,
          items: [{ plan_item_id: '55555555-5555-4555-8555-555555555505', child_id: CHILD_ID, slot: 'main', ingredients: ['wrap'] }],
        },
      ],
      cleared_allergies: [],
      scaffolding_diff: null,
      generated_at: '2026-05-02T00:00:00.000Z',
      plan_revision: 1,
      updated_at: '2026-05-02T00:00:00.000Z',
    },
  };
}

async function navigateToApp(page: Page, opts: { extraIngredients?: string[] } = {}) {
  // Pin the clock to Monday so all weekday tiles are upcoming, not past.
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
      body: JSON.stringify(briefWithHighActivityExtra(opts)),
    }),
  );
  await loginAndNavigate(page, '/app');
  await page.waitForResponse('**/v1/users/me');
  await page.waitForResponse(BRIEF_URL);
}

// ------------------------------------------------------------------
// Tests — AC2 MVP: high-activity Extra renders in PlanTile
// ------------------------------------------------------------------

test.describe('Story 3-22: AC2 MVP — high-activity Extra in PlanTile', () => {
  test('Extra ingredient proposed by planner for sport_practice day is visible in the plan tile', async ({
    page,
  }) => {
    await navigateToApp(page, { extraIngredients: ['granola bar'] });

    const wednesdayTile = page.getByRole('article', { name: /wednesday/i });
    await expect(wednesdayTile).toBeVisible();
    // The Extra item's ingredient must appear somewhere inside the tile.
    await expect(wednesdayTile.getByText(/granola bar/i)).toBeVisible();
  });

  test('Extra ingredient is scoped to the high-activity day — other days are unaffected', async ({
    page,
  }) => {
    await navigateToApp(page, { extraIngredients: ['granola bar'] });

    // Monday has only a main-slot item — no Extra.
    const mondayTile = page.getByRole('article', { name: /monday/i });
    await expect(mondayTile.getByText(/granola bar/i)).toHaveCount(0);

    // Wednesday has the planner-proposed Extra.
    const wednesdayTile = page.getByRole('article', { name: /wednesday/i });
    await expect(wednesdayTile.getByText(/granola bar/i)).toBeVisible();
  });
});

// ------------------------------------------------------------------
// Tests — AC1 path: Extra-slot swap fires PATCH (signal path regression)
// ------------------------------------------------------------------

test.describe('Story 3-22: AC1 path — swapping an Extra-slot item', () => {
  test('swap of an Extra-slot item sends PATCH to the correct item ID with an Idempotency-Key', async ({
    page,
  }) => {
    let captured: {
      itemId: string;
      idempotencyKey: string | null;
      body: unknown;
    } | null = null;

    await page.route(SWAP_URL, async (route: Route) => {
      const req = route.request();
      const url = new URL(req.url());
      const itemId = url.pathname.split('/').pop()!;
      captured = {
        itemId,
        idempotencyKey: req.headers()['idempotency-key'] ?? null,
        body: req.postDataJSON(),
      };
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item: {
            id: itemId,
            plan_id: PLAN_ID,
            child_id: CHILD_ID,
            day: 'wednesday',
            slot: 'extra',
            recipe_id: null,
            item_id: null,
            item_sku_id: null,
            ingredients: ['fruit cup'],
            paused_at: null,
            created_at: '2026-05-02T11:00:00.000Z',
            updated_at: '2026-05-04T12:00:00.000Z',
          },
        }),
      });
    });

    await navigateToApp(page);

    // Open the Wednesday picker (main + extra — multi-item day, routes through L2).
    await page.getByRole('article', { name: /wednesday/i }).click();
    await expect(page.getByRole('group', { name: /edit wednesday/i })).toBeVisible();
    await page.getByRole('button', { name: /change an item/i }).click();

    // L2 slot picker — Wednesday has two items so this always renders.
    // Use expect().toBeVisible() (not isVisible()) so Playwright waits for the
    // element rather than sampling the DOM at the instant of the call.
    await expect(page.getByText(/which slot/i)).toBeVisible();
    await page.getByRole('button', { name: /^extra/i }).click();

    // L3 — fill in the replacement and submit.
    await page.getByLabel(/what should it be instead/i).fill('fruit cup');
    await page.getByRole('button', { name: /^swap$/i }).click();

    // The PATCH must target the Extra item, not the main-slot item.
    await expect.poll(() => captured?.itemId ?? '').toBe(ITEM_WED_EXTRA);
    expect(captured!.idempotencyKey).toMatch(UUID_V4_RE);
    expect(captured!.body).toEqual({ ingredients: ['fruit cup'] });

    // Picker dismisses on the optimistic path.
    await expect(page.getByRole('group', { name: /edit wednesday/i })).toHaveCount(0);
  });

  test('5xx on the swap endpoint dismisses the picker optimistically — Extra-slot path is not special-cased', async ({
    page,
  }) => {
    // Swap is optimistic: the picker dismisses on click before the response
    // arrives. A 500 from the server does not prevent the dismiss (same as any
    // other slot). This test verifies the Extra slot is not special-cased in
    // the optimistic-dismiss logic.
    let capturedItemId: string | null = null;

    await page.route(SWAP_URL, async (route) => {
      const url = new URL(route.request().url());
      capturedItemId = url.pathname.split('/').pop()!;
      await route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server error' }),
      });
    });

    await navigateToApp(page);
    await page.getByRole('article', { name: /wednesday/i }).click();
    await expect(page.getByRole('group', { name: /edit wednesday/i })).toBeVisible();
    await page.getByRole('button', { name: /change an item/i }).click();

    await expect(page.getByText(/which slot/i)).toBeVisible();
    await page.getByRole('button', { name: /^extra/i }).click();

    await page.getByLabel(/what should it be instead/i).fill('fruit cup');
    await page.getByRole('button', { name: /^swap$/i }).click();

    // Optimistic dismiss: picker closes on click, same as a successful swap.
    await expect(page.getByRole('group', { name: /edit wednesday/i })).toHaveCount(0);
    // PATCH was sent to the Extra item, not the main-slot item.
    await expect.poll(() => capturedItemId ?? '').toBe(ITEM_WED_EXTRA);
  });
});

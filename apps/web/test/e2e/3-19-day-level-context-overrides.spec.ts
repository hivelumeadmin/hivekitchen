import { test, expect, type Page, type Route } from '@playwright/test';
import {
  loginAndNavigate,
  userProfile,
  SAMPLE_HOUSEHOLD_ID,
} from './_helpers.js';

const BRIEF_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`;
const PLAN_ID = '66666666-6666-4666-8666-666666666666';
const CHILD_ID = '77777777-7777-4777-8777-777777777777';
const ITEM_ID_MON = '88888888-8888-4888-8888-888888888801';
const ITEM_ID_TUE_MAIN = '88888888-8888-4888-8888-888888888802';
const ITEM_ID_TUE_SNACK = '88888888-8888-4888-8888-888888888803';
const OVERRIDE_URL = `**/v1/plans/${PLAN_ID}/items/*/override`;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface BriefOpts {
  multiItemTuesday?: boolean;
}

function briefResponse(opts: BriefOpts = {}) {
  const tuesdayItems = opts.multiItemTuesday === true
    ? [
        { plan_item_id: ITEM_ID_TUE_MAIN,  child_id: CHILD_ID, slot: 'main',  ingredients: ['noodles'] },
        { plan_item_id: ITEM_ID_TUE_SNACK, child_id: CHILD_ID, slot: 'snack', ingredients: ['apple'] },
      ]
    : [{ plan_item_id: ITEM_ID_TUE_MAIN, child_id: CHILD_ID, slot: 'main', ingredients: ['noodles'] }];

  return {
    brief: {
      household_id: SAMPLE_HOUSEHOLD_ID,
      plan_id: PLAN_ID,
      moment_headline: 'A quiet week.',
      lumi_note: '',
      memory_prose: '',
      plan_tile_summaries: [
        { day: 'monday',    paused: false, items: [{ plan_item_id: ITEM_ID_MON, child_id: CHILD_ID, slot: 'main', ingredients: ['rice', 'beans'] }] },
        { day: 'tuesday',   paused: false, items: tuesdayItems },
        { day: 'wednesday', paused: false, items: [{ plan_item_id: '88888888-8888-4888-8888-888888888804', child_id: CHILD_ID, slot: 'main', ingredients: ['pasta'] }] },
        { day: 'thursday',  paused: false, items: [{ plan_item_id: '88888888-8888-4888-8888-888888888805', child_id: CHILD_ID, slot: 'main', ingredients: ['soup'] }] },
        { day: 'friday',    paused: false, items: [{ plan_item_id: '88888888-8888-4888-8888-888888888806', child_id: CHILD_ID, slot: 'main', ingredients: ['wrap'] }] },
      ],
      cleared_allergies: [],
      scaffolding_diff: null,
      generated_at: '2026-05-02T00:00:00.000Z',
      plan_revision: 1,
      updated_at: '2026-05-02T00:00:00.000Z',
    },
  };
}

function overrideSuccessBody(opts: { itemId: string; overrideType: string; regen: boolean }) {
  return {
    override: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      plan_item_id: opts.itemId,
      child_id: CHILD_ID,
      household_id: SAMPLE_HOUSEHOLD_ID,
      override_date: '2026-05-06',
      override_type: opts.overrideType,
      is_lumi_proposed: false,
      confirmed_at: '2026-05-06T08:00:00.000Z',
      reverted_at: null,
      created_at: '2026-05-06T08:00:00.000Z',
      updated_at: '2026-05-06T08:00:00.000Z',
    },
    regen_triggered: opts.regen,
  };
}

async function navigateToApp(page: Page, opts: BriefOpts = {}) {
  // Pin the clock to a Monday so every weekday tile renders as today/upcoming.
  // PlanTile.deriveVariant() compares tile.day to new Date().getDay(); without
  // pinning, days earlier in the week than the real-world clock render as
  // 'past' (pointer-events-none) and the tile is unclickable.
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
      body: JSON.stringify(briefResponse(opts)),
    }),
  );
  await loginAndNavigate(page, '/app');
  await page.waitForResponse('**/v1/users/me');
  await page.waitForResponse(BRIEF_URL);
}

async function openOverridePickerForDay(
  page: Page,
  day: 'Monday' | 'Tuesday',
  opts: { multiItem?: boolean } = {},
) {
  await page.getByRole('article', { name: day }).click();
  await expect(page.getByRole('group', { name: new RegExp(`Edit ${day}`, 'i') })).toBeVisible();
  await page.getByRole('button', { name: /this day is different/i }).click();

  if (opts.multiItem === true) {
    // L2 — pick a slot first.
    await expect(page.getByText(/which slot is different today/i)).toBeVisible();
    await page.getByRole('button', { name: /^main/i }).click();
  }

  await expect(page.getByRole('group', { name: /day-level context override/i })).toBeVisible();
}

test.describe('Story 3-19: OverridePicker entry', () => {
  test('L1 "This day is different…" opens OverridePicker directly on single-item days', async ({
    page,
  }) => {
    await navigateToApp(page);
    await openOverridePickerForDay(page, 'Monday');

    // All eight override options visible (AC #1).
    await expect(page.getByRole('button', { name: /no lunch needed/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /half-day/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /field trip/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^sick day/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /post-dentist/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /early release/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sport practice/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /test day/i })).toBeVisible();
  });

  test('multi-item day routes through "Which slot is different today?" before the picker', async ({
    page,
  }) => {
    await navigateToApp(page, { multiItemTuesday: true });
    await page.getByRole('article', { name: 'Tuesday' }).click();
    await page.getByRole('button', { name: /this day is different/i }).click();

    // L2 — slot selector visible.
    await expect(page.getByText(/which slot is different today/i)).toBeVisible();
    await page.getByRole('button', { name: /^snack/i }).click();

    await expect(page.getByRole('group', { name: /day-level context override/i })).toBeVisible();
  });
});

test.describe('Story 3-19: POST /v1/plans/:planId/items/:itemId/override (AC #1)', () => {
  test('selecting a composition-changing override (sport_practice) POSTs with the expected body + Idempotency-Key', async ({
    page,
  }) => {
    let captured: {
      url: string;
      method: string;
      idempotencyKey: string | null;
      body: Record<string, unknown> | null;
    } | null = null;

    await page.route(OVERRIDE_URL, async (route: Route) => {
      const req = route.request();
      captured = {
        url: req.url(),
        method: req.method(),
        idempotencyKey: req.headers()['idempotency-key'] ?? null,
        body: (req.postDataJSON() as Record<string, unknown> | null) ?? null,
      };
      await route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(overrideSuccessBody({ itemId: ITEM_ID_MON, overrideType: 'sport_practice', regen: true })),
      });
    });

    await navigateToApp(page);
    await openOverridePickerForDay(page, 'Monday');
    await page.getByRole('button', { name: /sport practice/i }).click();

    await expect.poll(() => captured?.url ?? '').toMatch(
      new RegExp(`/v1/plans/${PLAN_ID}/items/${ITEM_ID_MON}/override$`),
    );
    expect(captured!.method).toBe('POST');
    expect(captured!.idempotencyKey).toMatch(UUID_V4_RE);
    expect(captured!.body).toMatchObject({
      override_type: 'sport_practice',
      child_id: CHILD_ID,
      is_lumi_proposed: false,
    });
    // override_date is derived client-side from current week's Monday — assert ISO format only.
    expect(captured!.body!['override_date']).toMatch(ISO_DATE_RE);

    // Picker dismisses on success.
    await expect(page.getByRole('group', { name: /day-level context override/i })).toHaveCount(0);
    await expect(page.getByRole('group', { name: /edit monday/i })).toHaveCount(0);
  });

  test('selecting bag_suspended (non-composition) still posts and dismisses', async ({ page }) => {
    let captured: { body: Record<string, unknown> | null } | null = null;

    await page.route(OVERRIDE_URL, async (route: Route) => {
      const req = route.request();
      captured = { body: (req.postDataJSON() as Record<string, unknown> | null) ?? null };
      await route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(overrideSuccessBody({ itemId: ITEM_ID_MON, overrideType: 'bag_suspended', regen: false })),
      });
    });

    await navigateToApp(page);
    await openOverridePickerForDay(page, 'Monday');
    await page.getByRole('button', { name: /no lunch needed/i }).click();

    await expect.poll(() => captured?.body?.['override_type'] ?? null).toBe('bag_suspended');
    await expect(page.getByRole('group', { name: /day-level context override/i })).toHaveCount(0);
  });

  test('multi-item day posts the override against the slot picked in L2', async ({ page }) => {
    let captured: { url: string } | null = null;

    await page.route(OVERRIDE_URL, async (route: Route) => {
      captured = { url: route.request().url() };
      await route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(overrideSuccessBody({ itemId: ITEM_ID_TUE_SNACK, overrideType: 'field_trip', regen: true })),
      });
    });

    await navigateToApp(page, { multiItemTuesday: true });
    await page.getByRole('article', { name: 'Tuesday' }).click();
    await page.getByRole('button', { name: /this day is different/i }).click();
    await page.getByRole('button', { name: /^snack/i }).click();
    await page.getByRole('button', { name: /field trip/i }).click();

    await expect.poll(() => captured?.url ?? '').toMatch(
      new RegExp(`/v1/plans/${PLAN_ID}/items/${ITEM_ID_TUE_SNACK}/override$`),
    );
  });
});

test.describe('Story 3-19: error handling', () => {
  test('a 500 from the override endpoint shows an inline alert and keeps the picker open', async ({
    page,
  }) => {
    await page.route(OVERRIDE_URL, (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'oops' }),
      }),
    );

    await navigateToApp(page);
    await openOverridePickerForDay(page, 'Monday');
    await page.getByRole('button', { name: /half-day/i }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(/could not save that override/i);
    await expect(page.getByRole('group', { name: /day-level context override/i })).toBeVisible();
  });
});

test.describe('Story 3-19: dismiss flows', () => {
  test('Cancel inside the OverridePicker returns to the L1 picker on a single-item day', async ({
    page,
  }) => {
    await navigateToApp(page);
    await openOverridePickerForDay(page, 'Monday');
    await page.getByRole('button', { name: /^cancel$/i }).click();

    // Back at L1 — "Change an item" / "This day is different…" / "Cancel" visible.
    await expect(page.getByRole('button', { name: /change an item/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /this day is different/i })).toBeVisible();
    await expect(page.getByRole('group', { name: /day-level context override/i })).toHaveCount(0);
  });

  test('Cancel inside the OverridePicker returns to L2 on a multi-item day', async ({ page }) => {
    await navigateToApp(page, { multiItemTuesday: true });
    await openOverridePickerForDay(page, 'Tuesday', { multiItem: true });
    await page.getByRole('button', { name: /^cancel$/i }).click();

    // Back at L2 slot selector.
    await expect(page.getByText(/which slot is different today/i)).toBeVisible();
    await expect(page.getByRole('group', { name: /day-level context override/i })).toHaveCount(0);
  });
});

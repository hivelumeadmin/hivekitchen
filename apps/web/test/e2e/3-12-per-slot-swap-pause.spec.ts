import { test, expect, type Page, type Route } from '@playwright/test';
import {
  loginAndNavigate,
  userProfile,
  SAMPLE_HOUSEHOLD_ID,
} from './_helpers.js';

const BRIEF_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`;
const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ID_MON = '55555555-5555-4555-8555-555555555501';
const ITEM_ID_TUE = '55555555-5555-4555-8555-555555555502';
const SWAP_URL = `**/v1/plans/${PLAN_ID}/items/*`;

interface BriefOpts {
  paused?: ReadonlyArray<'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'>;
  multiItemTuesday?: boolean;
  clearedAllergyPeanut?: boolean;
  planId?: string | null;
}

function briefResponse(opts: BriefOpts = {}) {
  const paused = new Set(opts.paused ?? []);
  const tuesdayItems = opts.multiItemTuesday
    ? [
        { plan_item_id: ITEM_ID_TUE, child_id: CHILD_ID, slot: 'main', ingredients: ['noodles'] },
        { plan_item_id: '55555555-5555-4555-8555-555555555503', child_id: CHILD_ID, slot: 'snack', ingredients: ['apple'] },
      ]
    : [{ plan_item_id: ITEM_ID_TUE, child_id: CHILD_ID, slot: 'main', ingredients: ['noodles'] }];

  return {
    brief: {
      household_id: SAMPLE_HOUSEHOLD_ID,
      plan_id: opts.planId === undefined ? PLAN_ID : opts.planId,
      moment_headline: 'A quiet week.',
      lumi_note: '',
      memory_prose: '',
      payload: {
        plan_state: null,
        plan_state_set_at: null,
        plan_state_message: null,
        scaffolding_diff: null,
        tile_summaries: [
          {
            day: 'monday',
            paused: paused.has('monday'),
            items: [{ plan_item_id: ITEM_ID_MON, child_id: CHILD_ID, slot: 'main', ingredients: ['rice', 'beans'] }],
          },
          { day: 'tuesday',   paused: paused.has('tuesday'),   items: tuesdayItems },
          { day: 'wednesday', paused: paused.has('wednesday'), items: [{ plan_item_id: '55555555-5555-4555-8555-555555555504', child_id: CHILD_ID, slot: 'main', ingredients: ['pasta'] }] },
          { day: 'thursday',  paused: paused.has('thursday'),  items: [{ plan_item_id: '55555555-5555-4555-8555-555555555505', child_id: CHILD_ID, slot: 'main', ingredients: ['soup'] }] },
          { day: 'friday',    paused: paused.has('friday'),    items: [{ plan_item_id: '55555555-5555-4555-8555-555555555506', child_id: CHILD_ID, slot: 'main', ingredients: ['wrap'] }] },
        ],
        cleared_allergies: opts.clearedAllergyPeanut
          ? [{ child_id: CHILD_ID, child_name: 'Asha', allergen: 'peanut', re_checking: false }]
          : [],
      },
      generated_at: '2026-05-02T00:00:00.000Z',
      plan_revision: 1,
      updated_at: '2026-05-02T00:00:00.000Z',
    },
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

async function openPickerForDay(page: Page, day: string) {
  await page.getByRole('article', { name: day }).click();
  await expect(page.getByRole('group', { name: new RegExp(`Edit ${day}`, 'i') })).toBeVisible();
}

test.describe('Story 3-12: Picker opens / dismisses', () => {
  test('clicking a tile opens the picker with L1 options (AC #1)', async ({ page }) => {
    await navigateToApp(page);
    await openPickerForDay(page, 'Monday');

    // L1 buttons after Story 3-19 unified the sick-day path under "This day
    // is different…": Change an item, This day is different…, (optionally
    // Ask Lumi to redo this day when onRegenDay is wired by BriefCanvas), Cancel.
    await expect(page.getByRole('button', { name: /change an item/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /this day is different/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^cancel$/i })).toBeVisible();
  });

  test('Escape dismisses the picker when focus is inside the picker', async ({ page }) => {
    await navigateToApp(page);
    await openPickerForDay(page, 'Monday');

    // The picker's onKeyDown lives on its <div role="group">; the handler only
    // fires for keydowns originating from the picker's subtree. Focus a button
    // inside the picker before pressing Escape (matches real keyboard usage:
    // user has tabbed past the tile into the picker).
    await page.getByRole('button', { name: /change an item/i }).focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('group', { name: /edit monday/i })).toHaveCount(0);
  });

  test('Cancel button dismisses the picker', async ({ page }) => {
    await navigateToApp(page);
    await openPickerForDay(page, 'Monday');

    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByRole('group', { name: /edit monday/i })).toHaveCount(0);
  });

  test('paused tiles are non-interactive — clicking does not open the picker (AC #2)', async ({
    page,
  }) => {
    await navigateToApp(page, { paused: ['monday'] });

    // Paused tile has tabIndex=-1 + pointer-events-none. Force the click past
    // pointer-events-none to confirm the handler still does not fire.
    await page.getByRole('article', { name: /monday/i }).click({ force: true });
    await expect(page.getByRole('group', { name: /edit monday/i })).toHaveCount(0);

    // The paused tile renders the visible "Paused" affordance so the parent
    // sees the day is parked.
    await expect(page.getByText(/^paused$/i).first()).toBeVisible();
  });
});

// Story 3-DM-E1 — the "Sick-day pause via unified override flow" tests were
// removed: sick_day / bag_suspended were dropped from plan_day_context_type, so
// the OverridePicker no longer offers those options. The canonical pause grain
// lives on plan_days.paused_at / plan_slot_variations.paused_at; wiring a pause
// UI to those routes is a separate slice.

test.describe('Story 3-12: Change item — L1 → L2 → L3 navigation', () => {
  test('single-item day skips L2 and goes straight to L3', async ({ page }) => {
    await navigateToApp(page);
    await openPickerForDay(page, 'Monday');
    await page.getByRole('button', { name: /change an item/i }).click();

    // L3 input is labelled — L2 "Which slot?" is skipped.
    await expect(page.getByLabel(/what should it be instead/i)).toBeVisible();
    await expect(page.getByText(/which slot/i)).toHaveCount(0);
  });

  test('multi-item day routes through L2 select then L3', async ({ page }) => {
    await navigateToApp(page, { multiItemTuesday: true });
    await openPickerForDay(page, 'Tuesday');
    await page.getByRole('button', { name: /change an item/i }).click();

    // L2 — pick a slot.
    await expect(page.getByText(/which slot/i)).toBeVisible();
    await page.getByRole('button', { name: /^snack/i }).click();

    // L3 input visible.
    await expect(page.getByLabel(/what should it be instead/i)).toBeVisible();
  });

  test('L3 Back returns to L1 for single-item days', async ({ page }) => {
    await navigateToApp(page);
    await openPickerForDay(page, 'Monday');
    await page.getByRole('button', { name: /change an item/i }).click();
    await page.getByRole('button', { name: /^back$/i }).click();

    // Back at L1 — assert against a definitive L1 button. After Story 3-19,
    // L1 no longer has a "Sick day" button; "This day is different…" replaces it.
    await expect(page.getByRole('button', { name: /this day is different/i })).toBeVisible();
  });
});

test.describe('Story 3-12: Non-allergen swap (optimistic, AC #1)', () => {
  test('successful swap dismisses the picker immediately and calls PATCH with Idempotency-Key', async ({
    page,
  }) => {
    let captured: { idempotencyKey: string | null; body: unknown; itemId: string } | null = null;
    await page.route(SWAP_URL, async (route: Route) => {
      const req = route.request();
      const url = new URL(req.url());
      const itemId = url.pathname.split('/').pop()!;
      captured = {
        idempotencyKey: req.headers()['idempotency-key'] ?? null,
        body: req.postDataJSON(),
        itemId,
      };
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item: {
            id: itemId,
            plan_id: PLAN_ID,
            child_id: CHILD_ID,
            day: 'monday',
            slot: 'main',
            recipe_id: null,
            item_id: null,
            ingredients: ['hummus', 'rice crackers'],
            paused_at: null,
            created_at: '2026-05-02T11:00:00.000Z',
            updated_at: '2026-05-04T12:00:00.000Z',
          },
        }),
      });
    });

    await navigateToApp(page);
    await openPickerForDay(page, 'Monday');
    await page.getByRole('button', { name: /change an item/i }).click();
    await page.getByLabel(/what should it be instead/i).fill('hummus, rice crackers');
    await page.getByRole('button', { name: /^swap$/i }).click();

    await expect.poll(() => captured?.itemId ?? '').toBe(ITEM_ID_MON);
    expect(captured!.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(captured!.body).toEqual({ ingredients: ['hummus', 'rice crackers'] });

    // Picker dismisses on the optimistic path.
    await expect(page.getByRole('group', { name: /edit monday/i })).toHaveCount(0);
  });
});

test.describe('Story 3-12: Allergen-affecting swap (pending, AC #1)', () => {
  test('422 from guardrail keeps the picker open with allergy-conflict copy', async ({
    page,
  }) => {
    await page.route(SWAP_URL, (route) =>
      route.fulfill({
        status: 422,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({
          type: '/errors/swap-guardrail-blocked',
          status: 422,
          title: 'Swap blocked',
          detail: 'would introduce peanut',
        }),
      }),
    );
    await navigateToApp(page, { clearedAllergyPeanut: true });
    await openPickerForDay(page, 'Monday');
    await page.getByRole('button', { name: /change an item/i }).click();
    await page.getByLabel(/what should it be instead/i).fill('peanut butter');
    await page.getByRole('button', { name: /^swap$/i }).click();

    // Picker stays visible — allergen-affecting path does not optimistically dismiss.
    await expect(page.getByRole('group', { name: /edit monday/i })).toBeVisible();
    await expect(page.getByText(/conflicts with a declared allergy/i)).toBeVisible();
  });

  test('Swap button is disabled while the input is empty', async ({ page }) => {
    await navigateToApp(page);
    await openPickerForDay(page, 'Monday');
    await page.getByRole('button', { name: /change an item/i }).click();

    await expect(page.getByRole('button', { name: /^swap$/i })).toBeDisabled();
  });
});

test.describe('Story 3-12: canSwap guard', () => {
  test('tiles are non-interactive when brief.plan_id is null (pre-migration row)', async ({
    page,
  }) => {
    await navigateToApp(page, { planId: null });

    // Click attempt should not open a picker; tile remains a static article.
    await page.getByRole('article', { name: /monday/i }).click({ force: true });
    await expect(page.getByRole('group', { name: /edit monday/i })).toHaveCount(0);
  });
});

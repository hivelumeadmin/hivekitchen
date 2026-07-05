import { test, expect, type Page, type Route } from '@playwright/test';
import {
  loginAndNavigate,
  userProfile,
  SAMPLE_HOUSEHOLD_ID,
} from './_helpers.js';

// ---------------------------------------------------------------------------
// Story 3-12 — per-slot swap / pause picker.
//
// Post-Epic-13 (13-s10) a day-tile tap summons the Lumi sheet (PlanEditPanel);
// the DisambiguationPicker is now entered via the PlanActionBar's "Swap a day"
// secondary action, which opens the picker for the FIRST unpaused day. Tests
// that need a non-Monday day pause the earlier days in the brief fixture.
//
// Post-3-DM-C1 the picker dispatches against the canonical tree (GET /v1/plans
// days/slots/variations) and "Change an item" edits a per-child variation via
// PATCH /v1/plans/:planId/variations/:variationId with { add_ons }.
// ---------------------------------------------------------------------------

const BRIEF_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`;
const PLANS_URL = '**/v1/plans*';
const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ID_MON = '55555555-5555-4555-8555-555555555501';
const ITEM_ID_TUE = '55555555-5555-4555-8555-555555555502';
const VAR_ID_MON = '99999999-9999-4999-8999-999999999901';
const VAR_ID_TUE_MAIN = '99999999-9999-4999-8999-999999999902';
const VAR_ID_TUE_SNACK = '99999999-9999-4999-8999-999999999903';
const SWAP_URL = `**/v1/plans/${PLAN_ID}/variations/*`;

const ISO = '2026-05-02T00:00:00.000Z';
type Day = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
const WEEKDAYS: readonly Day[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

interface BriefOpts {
  paused?: ReadonlyArray<Day | 'saturday'>;
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
      generated_at: ISO,
      plan_revision: 1,
      updated_at: ISO,
    },
  };
}

function variationRow(id: string, planSlotId: string) {
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
    created_at: ISO,
    updated_at: ISO,
  };
}

// Canonical tree response (GET /v1/plans?week=current) matching the brief
// fixture: one main slot + variation per day; Tuesday optionally gains a
// snack slot + variation so "Change an item" routes through L2.
function plansResponse(opts: BriefOpts = {}) {
  const paused = new Set(opts.paused ?? []);
  const days = WEEKDAYS.map((day, i) => ({
    id: `dddddddd-dddd-4ddd-8ddd-ddddddddd${(i + 1).toString().padStart(3, '0')}`,
    plan_id: PLAN_ID,
    day,
    paused_at: paused.has(day) ? ISO : null,
    paused_reason: paused.has(day) ? 'sick_day' : null,
    paused_note: null,
    created_at: ISO,
    updated_at: ISO,
  }));
  const slots = days.map((d, i) => ({
    id: `eeeeeeee-eeee-4eee-8eee-eeeeeeeee${(i + 1).toString().padStart(3, '0')}`,
    plan_day_id: d.id,
    slot_kind: 'main',
    main_assignment_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    recipe_id: null,
    extra_kind: null,
    snack_sku_id: null,
    paused_at: null,
    created_at: ISO,
    updated_at: ISO,
  }));
  const variations = [
    variationRow(VAR_ID_MON, slots[0]!.id),
    variationRow(VAR_ID_TUE_MAIN, slots[1]!.id),
    variationRow('99999999-9999-4999-8999-999999999904', slots[2]!.id),
    variationRow('99999999-9999-4999-8999-999999999905', slots[3]!.id),
    variationRow('99999999-9999-4999-8999-999999999906', slots[4]!.id),
  ];
  if (opts.multiItemTuesday) {
    slots.push({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee101',
      plan_day_id: days[1]!.id,
      slot_kind: 'snack',
      main_assignment_id: null,
      recipe_id: null,
      extra_kind: null,
      snack_sku_id: null,
      paused_at: null,
      created_at: ISO,
      updated_at: ISO,
    });
    variations.push(variationRow(VAR_ID_TUE_SNACK, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee101'));
  }
  return {
    plan: {
      id: PLAN_ID,
      household_id: SAMPLE_HOUSEHOLD_ID,
      week_of: '2026-05-04',
      revision: 1,
      generated_at: ISO,
      guardrail_cleared_at: ISO,
      guardrail_version: 'v1',
      prompt_version: 'v1',
      state: null,
      state_set_at: null,
      state_message: null,
      confirmed_at: null,
      created_at: ISO,
      updated_at: ISO,
    },
    main_assignments: [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', plan_id: PLAN_ID, sequence: 1, recipe_id: null, created_at: ISO },
    ],
    days,
    slots,
    variations,
    is_draft: false,
    week_of: '2026-05-04',
    variant_proposals: [],
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
  // The picker dispatches against the canonical tree; only the GET list is
  // fulfilled here (mutation routes are registered per-test).
  await page.route(PLANS_URL, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plansResponse(opts)),
    });
  });
  await loginAndNavigate(page, '/app');
  await page.waitForResponse('**/v1/users/me');
  await page.waitForResponse(BRIEF_URL);
}

// Epic 13-s10 — the picker is entered via the PlanActionBar's "Swap a day"
// action, which targets the first unpaused day. Callers that need a later day
// pause the preceding days in the fixture.
async function openPickerForDay(page: Page, day: string) {
  await page.getByRole('button', { name: /swap a day/i }).click();
  await expect(page.getByRole('group', { name: new RegExp(`Edit ${day}`, 'i') })).toBeVisible();
}

test.describe('Story 3-12: Picker opens / dismisses', () => {
  test('"Swap a day" opens the picker with L1 options (AC #1)', async ({ page }) => {
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
    // inside the picker before pressing Escape (matches real keyboard usage).
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

  test('paused tiles are non-interactive — clicking neither opens the picker nor summons Lumi (AC #2)', async ({
    page,
  }) => {
    await navigateToApp(page, { paused: ['monday'] });

    // Paused tile has tabIndex=-1 + pointer-events-none. Force the click past
    // pointer-events-none to confirm the handler still does not fire. Post-
    // 13-s10 a live tile tap summons the Lumi sheet — a paused one must not.
    await page.getByRole('article', { name: /monday/i }).click({ force: true });
    await expect(page.getByRole('group', { name: /edit monday/i })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: /lumi/i })).toHaveCount(0);

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
  test('single-variation day skips L2 and goes straight to L3', async ({ page }) => {
    await navigateToApp(page);
    await openPickerForDay(page, 'Monday');
    await page.getByRole('button', { name: /change an item/i }).click();

    // L3 input is labelled — L2 "Which child / slot?" is skipped.
    await expect(page.getByLabel(/what should it be instead/i)).toBeVisible();
    await expect(page.getByText(/which child \/ slot/i)).toHaveCount(0);
  });

  test('multi-variation day routes through L2 select then L3', async ({ page }) => {
    // Pause Monday so "Swap a day" opens the picker for Tuesday.
    await navigateToApp(page, { paused: ['monday'], multiItemTuesday: true });
    await openPickerForDay(page, 'Tuesday');
    await page.getByRole('button', { name: /change an item/i }).click();

    // L2 — pick a child/slot variation.
    await expect(page.getByText(/which child \/ slot/i)).toBeVisible();
    await page.getByRole('button', { name: /^snack/i }).click();

    // L3 input visible.
    await expect(page.getByLabel(/what should it be instead/i)).toBeVisible();
  });

  test('L3 Back returns to L1 for single-variation days', async ({ page }) => {
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
  test('successful swap dismisses the picker immediately and PATCHes the variation with Idempotency-Key', async ({
    page,
  }) => {
    let captured: { idempotencyKey: string | null; body: unknown; variationId: string } | null = null;
    await page.route(SWAP_URL, async (route: Route) => {
      const req = route.request();
      const url = new URL(req.url());
      const variationId = url.pathname.split('/').pop()!;
      captured = {
        idempotencyKey: req.headers()['idempotency-key'] ?? null,
        body: req.postDataJSON(),
        variationId,
      };
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variation: {
            ...variationRow(variationId, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee001'),
            add_ons: ['hummus', 'rice crackers'],
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

    await expect.poll(() => captured?.variationId ?? '').toBe(VAR_ID_MON);
    expect(captured!.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(captured!.body).toEqual({ add_ons: ['hummus', 'rice crackers'] });

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
  test('swap entry is absent when brief.plan_id is null (pre-migration row)', async ({
    page,
  }) => {
    await navigateToApp(page, { planId: null });

    // No "Swap a day" action without a plan id.
    await expect(page.getByRole('button', { name: /swap a day/i })).toHaveCount(0);
    // Tiles are non-interactive: a forced click neither opens the picker nor
    // summons the Lumi sheet.
    await page.getByRole('article', { name: /monday/i }).click({ force: true });
    await expect(page.getByRole('group', { name: /edit monday/i })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: /lumi/i })).toHaveCount(0);
  });
});

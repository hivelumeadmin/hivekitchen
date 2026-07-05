import { test, expect, type Page, type Route } from '@playwright/test';
import {
  loginAndNavigate,
  userProfile,
  SAMPLE_HOUSEHOLD_ID,
} from './_helpers.js';

// ---------------------------------------------------------------------------
// Story 3-19 — day-level context overrides.
//
// Post-Epic-13 (13-s10) a day-tile tap summons the Lumi sheet; the
// DisambiguationPicker (and the OverridePicker behind "This day is
// different…") is entered via the PlanActionBar's "Swap a day" action, which
// opens the picker for the FIRST unpaused day. Tests that target Tuesday
// pause Monday in the fixture.
//
// Post-3-DM-C1 overrides are slot-scoped: POST
// /v1/plans/:planId/slots/:planSlotId/override (was items/:itemId/override).
// ---------------------------------------------------------------------------

const BRIEF_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`;
const PLANS_URL = '**/v1/plans*';
const PLAN_ID = '66666666-6666-4666-8666-666666666666';
const CHILD_ID = '77777777-7777-4777-8777-777777777777';
const SLOT_MON_MAIN = '88888888-8888-4888-8888-888888888801';
const SLOT_TUE_MAIN = '88888888-8888-4888-8888-888888888802';
const SLOT_TUE_SNACK = '88888888-8888-4888-8888-888888888803';
const OVERRIDE_URL = `**/v1/plans/${PLAN_ID}/slots/*/override`;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ISO = '2026-05-02T00:00:00.000Z';
type Day = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
const WEEKDAYS: readonly Day[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

interface FixtureOpts {
  multiItemTuesday?: boolean;
  paused?: ReadonlyArray<Day>;
}

function briefResponse(opts: FixtureOpts = {}) {
  const paused = new Set(opts.paused ?? []);
  const tuesdayItems = opts.multiItemTuesday === true
    ? [
        { plan_item_id: SLOT_TUE_MAIN,  child_id: CHILD_ID, slot: 'main',  ingredients: ['noodles'] },
        { plan_item_id: SLOT_TUE_SNACK, child_id: CHILD_ID, slot: 'snack', ingredients: ['apple'] },
      ]
    : [{ plan_item_id: SLOT_TUE_MAIN, child_id: CHILD_ID, slot: 'main', ingredients: ['noodles'] }];

  return {
    brief: {
      household_id: SAMPLE_HOUSEHOLD_ID,
      plan_id: PLAN_ID,
      moment_headline: 'A quiet week.',
      lumi_note: '',
      memory_prose: '',
      payload: {
        cleared_allergies: [],
        scaffolding_diff: null,
        plan_state: null,
        plan_state_set_at: null,
        plan_state_message: null,
        tile_summaries: [
          { day: 'monday',    paused: paused.has('monday'),    items: [{ plan_item_id: SLOT_MON_MAIN, child_id: CHILD_ID, slot: 'main', ingredients: ['rice', 'beans'] }] },
          { day: 'tuesday',   paused: paused.has('tuesday'),   items: tuesdayItems },
          { day: 'wednesday', paused: paused.has('wednesday'), items: [{ plan_item_id: '88888888-8888-4888-8888-888888888804', child_id: CHILD_ID, slot: 'main', ingredients: ['pasta'] }] },
          { day: 'thursday',  paused: paused.has('thursday'),  items: [{ plan_item_id: '88888888-8888-4888-8888-888888888805', child_id: CHILD_ID, slot: 'main', ingredients: ['soup'] }] },
          { day: 'friday',    paused: paused.has('friday'),    items: [{ plan_item_id: '88888888-8888-4888-8888-888888888806', child_id: CHILD_ID, slot: 'main', ingredients: ['wrap'] }] },
        ],
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

// Canonical tree response matching the brief fixture. Monday: one main slot
// (single-slot day → OverridePicker opens directly). Tuesday: main + snack
// when multiItemTuesday (multi-slot day → L2 slot selector first).
function plansResponse(opts: FixtureOpts = {}) {
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
  const slotIds = [SLOT_MON_MAIN, SLOT_TUE_MAIN, '88888888-8888-4888-8888-888888888804', '88888888-8888-4888-8888-888888888805', '88888888-8888-4888-8888-888888888806'];
  const slots = days.map((d, i) => ({
    id: slotIds[i]!,
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
  const variations = slots.map((s, i) =>
    variationRow(`99999999-9999-4999-8999-99999999990${i + 1}`, s.id),
  );
  if (opts.multiItemTuesday === true) {
    slots.push({
      id: SLOT_TUE_SNACK,
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
    variations.push(variationRow('99999999-9999-4999-8999-999999999910', SLOT_TUE_SNACK));
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

function overrideSuccessBody(opts: { planSlotId: string; overrideType: string; regen: boolean }) {
  return {
    override: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      plan_slot_id: opts.planSlotId,
      child_id: CHILD_ID,
      household_id: SAMPLE_HOUSEHOLD_ID,
      override_date: '2026-05-06',
      context_type: opts.overrideType,
      is_lumi_proposed: false,
      confirmed_at: '2026-05-06T08:00:00.000Z',
      reverted_at: null,
      created_at: '2026-05-06T08:00:00.000Z',
      updated_at: '2026-05-06T08:00:00.000Z',
    },
    regen_triggered: opts.regen,
  };
}

async function navigateToApp(page: Page, opts: FixtureOpts = {}) {
  // Pin the clock to a Monday so every weekday tile renders as today/upcoming
  // and the client-derived override_date is deterministic.
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
// action, which targets the first unpaused day.
async function openDayPicker(page: Page, day: 'Monday' | 'Tuesday') {
  await page.getByRole('button', { name: /swap a day/i }).click();
  await expect(page.getByRole('group', { name: new RegExp(`Edit ${day}`, 'i') })).toBeVisible();
}

async function openOverridePickerForDay(
  page: Page,
  day: 'Monday' | 'Tuesday',
  opts: { multiItem?: boolean } = {},
) {
  await openDayPicker(page, day);
  await page.getByRole('button', { name: /this day is different/i }).click();

  if (opts.multiItem === true) {
    // L2 — pick a slot first.
    await expect(page.getByText(/which slot is different today/i)).toBeVisible();
    await page.getByRole('button', { name: /^main/i }).click();
  }

  await expect(page.getByRole('group', { name: /day-level context override/i })).toBeVisible();
}

test.describe('Story 3-19: OverridePicker entry', () => {
  test('L1 "This day is different…" opens OverridePicker directly on single-slot days', async ({
    page,
  }) => {
    await navigateToApp(page);
    await openOverridePickerForDay(page, 'Monday');

    // All six context options visible (AC #1).
    await expect(page.getByRole('button', { name: /half-day/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /field trip/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /post-dentist/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /early release/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sport practice/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /test day/i })).toBeVisible();
  });

  test('multi-slot day routes through "Which slot is different today?" before the picker', async ({
    page,
  }) => {
    await navigateToApp(page, { multiItemTuesday: true, paused: ['monday'] });
    await openDayPicker(page, 'Tuesday');
    await page.getByRole('button', { name: /this day is different/i }).click();

    // L2 — slot selector visible.
    await expect(page.getByText(/which slot is different today/i)).toBeVisible();
    await page.getByRole('button', { name: /^snack/i }).click();

    await expect(page.getByRole('group', { name: /day-level context override/i })).toBeVisible();
  });
});

test.describe('Story 3-19: POST /v1/plans/:planId/slots/:planSlotId/override (AC #1)', () => {
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
        body: JSON.stringify(overrideSuccessBody({ planSlotId: SLOT_MON_MAIN, overrideType: 'sport_practice', regen: true })),
      });
    });

    await navigateToApp(page);
    await openOverridePickerForDay(page, 'Monday');
    await page.getByRole('button', { name: /sport practice/i }).click();

    await expect.poll(() => captured?.url ?? '').toMatch(
      new RegExp(`/v1/plans/${PLAN_ID}/slots/${SLOT_MON_MAIN}/override$`),
    );
    expect(captured!.method).toBe('POST');
    expect(captured!.idempotencyKey).toMatch(UUID_V4_RE);
    expect(captured!.body).toMatchObject({
      context_type: 'sport_practice',
      child_id: CHILD_ID,
      is_lumi_proposed: false,
    });
    // override_date is derived client-side from current week's Monday — assert ISO format only.
    expect(captured!.body!['override_date']).toMatch(ISO_DATE_RE);

    // Picker dismisses on success.
    await expect(page.getByRole('group', { name: /day-level context override/i })).toHaveCount(0);
    await expect(page.getByRole('group', { name: /edit monday/i })).toHaveCount(0);
  });

  test('multi-slot day posts the override against the slot picked in L2', async ({ page }) => {
    let captured: { url: string } | null = null;

    await page.route(OVERRIDE_URL, async (route: Route) => {
      captured = { url: route.request().url() };
      await route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(overrideSuccessBody({ planSlotId: SLOT_TUE_SNACK, overrideType: 'field_trip', regen: true })),
      });
    });

    await navigateToApp(page, { multiItemTuesday: true, paused: ['monday'] });
    await openDayPicker(page, 'Tuesday');
    await page.getByRole('button', { name: /this day is different/i }).click();
    await page.getByRole('button', { name: /^snack/i }).click();
    await page.getByRole('button', { name: /field trip/i }).click();

    await expect.poll(() => captured?.url ?? '').toMatch(
      new RegExp(`/v1/plans/${PLAN_ID}/slots/${SLOT_TUE_SNACK}/override$`),
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
  test('Cancel inside the OverridePicker returns to the L1 picker on a single-slot day', async ({
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

  test('Cancel inside the OverridePicker returns to L2 on a multi-slot day', async ({ page }) => {
    await navigateToApp(page, { multiItemTuesday: true, paused: ['monday'] });
    await openOverridePickerForDay(page, 'Tuesday', { multiItem: true });
    await page.getByRole('button', { name: /^cancel$/i }).click();

    // Back at L2 slot selector.
    await expect(page.getByText(/which slot is different today/i)).toBeVisible();
    await expect(page.getByRole('group', { name: /day-level context override/i })).toHaveCount(0);
  });
});

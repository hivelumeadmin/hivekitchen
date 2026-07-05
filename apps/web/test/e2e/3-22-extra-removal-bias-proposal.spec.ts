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
//
// Post-Epic-13 (13-s10) the DisambiguationPicker is entered via the
// PlanActionBar's "Swap a day" action (first unpaused day); the AC1 tests
// pause Mon+Tue so the picker opens for Wednesday. Post-3-DM-C1 the swap
// PATCHes the Extra slot's variation:
// PATCH /v1/plans/:planId/variations/:variationId { add_ons }.
// ------------------------------------------------------------------

const BRIEF_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`;
const PLANS_URL = '**/v1/plans*';
const PLAN_ID   = '44444444-4444-4444-8444-444444444444';
const CHILD_ID  = '33333333-3333-4333-8333-333333333333';

const ITEM_MON_MAIN  = '55555555-5555-4555-8555-555555555501';
const ITEM_WED_MAIN  = '55555555-5555-4555-8555-555555555503';
const ITEM_WED_EXTRA = '55555555-5555-4555-8555-555555555510';
const VAR_WED_MAIN   = '99999999-9999-4999-8999-999999999903';
const VAR_WED_EXTRA  = '99999999-9999-4999-8999-999999999910';

const SWAP_URL   = `**/v1/plans/${PLAN_ID}/variations/*`;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = '2026-05-02T00:00:00.000Z';

type Day = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
const WEEKDAYS: readonly Day[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

// ------------------------------------------------------------------
// Fixture builders
// ------------------------------------------------------------------

interface FixtureOpts {
  extraIngredients?: string[];
  paused?: ReadonlyArray<Day>;
}

function briefWithHighActivityExtra(opts: FixtureOpts = {}) {
  const extraIngredients = opts.extraIngredients ?? ['granola bar'];
  const paused = new Set(opts.paused ?? []);
  return {
    brief: {
      household_id: SAMPLE_HOUSEHOLD_ID,
      plan_id: PLAN_ID,
      moment_headline: 'A busy week.',
      lumi_note: '',
      memory_prose: '',
      payload: {
        cleared_allergies: [],
        scaffolding_diff: null,
        plan_state: null,
        plan_state_set_at: null,
        plan_state_message: null,
        tile_summaries: [
          {
            day: 'monday',
            paused: paused.has('monday'),
            items: [{ plan_item_id: ITEM_MON_MAIN, child_id: CHILD_ID, slot: 'main', ingredients: ['rice', 'beans'] }],
          },
          {
            day: 'tuesday',
            paused: paused.has('tuesday'),
            items: [{ plan_item_id: '55555555-5555-4555-8555-555555555502', child_id: CHILD_ID, slot: 'main', ingredients: ['noodles'] }],
          },
          {
            // Wednesday = sport_practice day; planner proposed an Extra for this child
            // (Extra slot normally OFF, but high-activity override detected — AC2 MVP).
            day: 'wednesday',
            paused: paused.has('wednesday'),
            items: [
              { plan_item_id: ITEM_WED_MAIN,  child_id: CHILD_ID, slot: 'main',  ingredients: ['pasta'] },
              { plan_item_id: ITEM_WED_EXTRA, child_id: CHILD_ID, slot: 'extra', ingredients: extraIngredients },
            ],
          },
          {
            day: 'thursday',
            paused: paused.has('thursday'),
            items: [{ plan_item_id: '55555555-5555-4555-8555-555555555504', child_id: CHILD_ID, slot: 'main', ingredients: ['soup'] }],
          },
          {
            day: 'friday',
            paused: paused.has('friday'),
            items: [{ plan_item_id: '55555555-5555-4555-8555-555555555505', child_id: CHILD_ID, slot: 'main', ingredients: ['wrap'] }],
          },
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

// Canonical tree response matching the brief: main slot + variation per day,
// plus the Wednesday Extra slot + variation the AC1 swap targets.
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
  const variations = slots.map((s, i) => {
    const id = i === 2 ? VAR_WED_MAIN : `99999999-9999-4999-8999-99999999990${i + 1}`;
    return variationRow(id, s.id);
  });
  // The Wednesday Extra slot (AC1 swap target).
  slots.push({
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee110',
    plan_day_id: days[2]!.id,
    slot_kind: 'extra',
    main_assignment_id: null,
    recipe_id: null,
    extra_kind: 'energy_boost',
    snack_sku_id: null,
    paused_at: null,
    created_at: ISO,
    updated_at: ISO,
  });
  variations.push(variationRow(VAR_WED_EXTRA, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee110'));
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

async function navigateToApp(page: Page, opts: FixtureOpts = {}) {
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

// Open the Wednesday picker via "Swap a day" (Mon+Tue paused in the fixture)
// and drill into the Extra-slot variation's L3 input.
async function openExtraSwapInput(page: Page) {
  await page.getByRole('button', { name: /swap a day/i }).click();
  await expect(page.getByRole('group', { name: /edit wednesday/i })).toBeVisible();
  await page.getByRole('button', { name: /change an item/i }).click();

  // L2 child/slot picker — Wednesday has two variations so this always renders.
  await expect(page.getByText(/which child \/ slot/i)).toBeVisible();
  await page.getByRole('button', { name: /^extra/i }).click();

  await expect(page.getByLabel(/what should it be instead/i)).toBeVisible();
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
  test('swap of an Extra-slot item PATCHes the correct variation ID with an Idempotency-Key', async ({
    page,
  }) => {
    let captured: {
      variationId: string;
      idempotencyKey: string | null;
      body: unknown;
    } | null = null;

    await page.route(SWAP_URL, async (route: Route) => {
      const req = route.request();
      const url = new URL(req.url());
      const variationId = url.pathname.split('/').pop()!;
      captured = {
        variationId,
        idempotencyKey: req.headers()['idempotency-key'] ?? null,
        body: req.postDataJSON(),
      };
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variation: {
            ...variationRow(variationId, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeee110'),
            add_ons: ['fruit cup'],
            updated_at: '2026-05-04T12:00:00.000Z',
          },
        }),
      });
    });

    await navigateToApp(page, { paused: ['monday', 'tuesday'] });
    await openExtraSwapInput(page);

    // L3 — fill in the replacement and submit.
    await page.getByLabel(/what should it be instead/i).fill('fruit cup');
    await page.getByRole('button', { name: /^swap$/i }).click();

    // The PATCH must target the Extra slot's variation, not the main-slot one.
    await expect.poll(() => captured?.variationId ?? '').toBe(VAR_WED_EXTRA);
    expect(captured!.idempotencyKey).toMatch(UUID_V4_RE);
    expect(captured!.body).toEqual({ add_ons: ['fruit cup'] });

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
    let capturedVariationId: string | null = null;

    await page.route(SWAP_URL, async (route) => {
      const url = new URL(route.request().url());
      capturedVariationId = url.pathname.split('/').pop()!;
      await route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server error' }),
      });
    });

    await navigateToApp(page, { paused: ['monday', 'tuesday'] });
    await openExtraSwapInput(page);

    await page.getByLabel(/what should it be instead/i).fill('fruit cup');
    await page.getByRole('button', { name: /^swap$/i }).click();

    // Optimistic dismiss: picker closes on click, same as a successful swap.
    await expect(page.getByRole('group', { name: /edit wednesday/i })).toHaveCount(0);
    // PATCH was sent to the Extra slot's variation, not the main-slot one.
    await expect.poll(() => capturedVariationId ?? '').toBe(VAR_WED_EXTRA);
  });
});

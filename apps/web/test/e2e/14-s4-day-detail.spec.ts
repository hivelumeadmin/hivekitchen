import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { loginAndNavigate, userProfile, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

// ---------------------------------------------------------------------------
// Story 14-s4 — the family-first day view, live.
//
// /app/day/:day is an ArtifactSheet over the Brief (13-s11) that now renders
// WallCardSwipeStack from real plan data: one shared Main per day, per-child
// variation chips, a Prep/Finish activity toggle, and the day-detail action
// vocabulary. Verifies the wiring, the mode toggle actually filtering method
// steps, the paused guard, the recipe-error path, and that the retired
// explanation cards are gone.
//
// Run from apps/web against a VITE_E2E=true build.
// ---------------------------------------------------------------------------

const BRIEF_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`;
const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const CHILD_A = '33333333-3333-4333-8333-333333333331';
const CHILD_B = '33333333-3333-4333-8333-333333333332';
const RECIPE_MAIN = '55555555-5555-4555-8555-555555555551';
const RECIPE_OTHER = '55555555-5555-4555-8555-555555555552';
const ASSIGN_1 = '66666666-6666-4666-8666-666666666661';
const ASSIGN_2 = '66666666-6666-4666-8666-666666666662';
const WEEK_OF = '2026-05-04';

type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
const WEEKDAYS: readonly Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

// Mon+Tue share M1; Wed–Fri share M2 — the 3-Main rhythm the Wall Card badges.
function assignmentFor(day: Weekday): { id: string } {
  return day === 'monday' || day === 'tuesday' ? { id: ASSIGN_1 } : { id: ASSIGN_2 };
}

interface PlanOverrides {
  readonly pausedDays?: readonly Weekday[];
}

function planResponse(o: PlanOverrides = {}) {
  const paused = new Set(o.pausedDays ?? []);
  const days = WEEKDAYS.map((day, i) => ({
    id: `day-${day}`,
    plan_id: PLAN_ID,
    day,
    paused_at: paused.has(day) ? '2026-05-04T00:00:00.000Z' : null,
    paused_reason: paused.has(day) ? 'sick_day' : null,
    paused_note: null,
    created_at: '2026-05-04T00:00:00.000Z',
    updated_at: '2026-05-04T00:00:00.000Z',
    _i: i,
  }));

  const slots = WEEKDAYS.flatMap((day) => [
    {
      id: `slot-${day}-main`,
      plan_day_id: `day-${day}`,
      slot_kind: 'main',
      main_assignment_id: assignmentFor(day).id,
      // NULL like the real DB: plan_slots_main_uses_assignment forbids
      // recipe_id on main slots — the assignment row carries the recipe. An
      // earlier fixture set it here, masking the bug where the projection
      // read only the slot.
      recipe_id: null,
      extra_kind: null,
      snack_sku_id: null,
      paused_at: null,
      created_at: '2026-05-04T00:00:00.000Z',
      updated_at: '2026-05-04T00:00:00.000Z',
    },
    {
      id: `slot-${day}-snack`,
      plan_day_id: `day-${day}`,
      slot_kind: 'snack',
      main_assignment_id: null,
      recipe_id: null,
      extra_kind: null,
      snack_sku_id: 'sku-apple',
      paused_at: null,
      created_at: '2026-05-04T00:00:00.000Z',
      updated_at: '2026-05-04T00:00:00.000Z',
    },
  ]);

  const variations = WEEKDAYS.flatMap((day) =>
    [CHILD_A, CHILD_B].map((childId, ci) => ({
      id: `var-${day}-${String(ci)}`,
      plan_slot_id: `slot-${day}-main`,
      child_id: childId,
      portion_size: ci === 0 ? 'small' : 'large',
      texture: ci === 0 ? 'soft' : 'normal',
      spice_level: ci === 0 ? 'mild' : 'regular',
      cutting_style: null,
      container: null,
      add_ons: ci === 1 ? ['hard-boiled egg'] : [],
      removals: [],
      notes: null,
      paused_at: null,
      created_at: '2026-05-04T00:00:00.000Z',
      updated_at: '2026-05-04T00:00:00.000Z',
    })),
  );

  return {
    plan: { id: PLAN_ID, confirmed_at: null },
    main_assignments: [
      { id: ASSIGN_1, plan_id: PLAN_ID, sequence: 1, recipe_id: RECIPE_MAIN, created_at: '2026-05-04T00:00:00.000Z' },
      { id: ASSIGN_2, plan_id: PLAN_ID, sequence: 2, recipe_id: RECIPE_OTHER, created_at: '2026-05-04T00:00:00.000Z' },
    ],
    days: days.map(({ _i, ...d }) => d),
    slots,
    variations,
    flagged_items: [],
    is_draft: false,
    week_of: WEEK_OF,
  };
}

function briefResponse() {
  return {
    brief: {
      household_id: SAMPLE_HOUSEHOLD_ID,
      plan_id: PLAN_ID,
      moment_headline: 'An easy week.',
      lumi_note: 'Two mains carry the week.',
      memory_prose: '',
      payload: {
        cleared_allergies: [],
        scaffolding_diff: null,
        plan_state: null,
        plan_state_set_at: null,
        plan_state_message: null,
        tile_summaries: WEEKDAYS.map((day) => ({
          day,
          paused: false,
          items: [
            { plan_item_id: null, child_id: CHILD_A, slot: 'main', ingredients: [], name: 'Dal + rice thermos' },
            { plan_item_id: null, child_id: CHILD_A, slot: 'snack', ingredients: [], name: 'Apple slices' },
          ],
        })),
      },
      generated_at: '2026-05-02T00:00:00.000Z',
      plan_revision: 1,
      updated_at: '2026-05-02T00:00:00.000Z',
    },
  };
}

function recipeResponse(id: string) {
  const isMain = id === RECIPE_MAIN;
  return {
    recipe: {
      id,
      canonical_name: isMain ? 'Dal + rice thermos' : 'Mini frittata muffins',
      ingredients: isMain
        ? ['1 cup yellow dal', '1.5 cups basmati rice']
        : ['6 eggs', 'Spinach, diced'],
      prep_time_minutes: 20,
      finish_time_minutes: 6,
      source: 'agent_generated',
    },
    steps: [
      { sequence: 1, mode: 'prep', text: 'PREP STEP — cook the base the night before.' },
      { sequence: 2, mode: 'finish', text: 'FINISH STEP — layer and seal warm.' },
    ],
  };
}

interface SetupOptions {
  readonly pausedDays?: readonly Weekday[];
  readonly failRecipes?: boolean;
}

async function openDay(page: Page, day: Weekday, o: SetupOptions = {}) {
  await page.clock.install({ time: new Date('2026-05-04T08:00:00Z') });
  await page.route('**/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userProfile()),
    }),
  );
  await page.route('**/v1/plans*', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(planResponse({ pausedDays: o.pausedDays ?? [] })),
    }),
  );
  await page.route(BRIEF_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(briefResponse()),
    }),
  );
  await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        children: [
          { id: CHILD_A, household_id: SAMPLE_HOUSEHOLD_ID, name: 'Aarav', age_band: 'toddler', declared_allergens: [], cultural_identifiers: [], dietary_preferences: [], appetite_level: 'normal', texture_needs: 'normal', spice_tolerance: 'mild', bag_composition_pattern: 'main_plus_snack', created_at: '2026-01-01T00:00:00.000Z' },
          { id: CHILD_B, household_id: SAMPLE_HOUSEHOLD_ID, name: 'Mira', age_band: 'child', declared_allergens: [], cultural_identifiers: [], dietary_preferences: [], appetite_level: 'normal', texture_needs: 'normal', spice_tolerance: 'mild', bag_composition_pattern: 'main_plus_snack', created_at: '2026-01-01T00:00:00.000Z' },
        ],
      }),
    }),
  );
  await page.route('**/v1/recipes/*', (route) => {
    if (o.failRecipes === true) {
      route.fulfill({ status: 500, headers: { 'Content-Type': 'application/json' }, body: '{}' });
      return;
    }
    const id = route.request().url().split('/').pop() ?? RECIPE_MAIN;
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(recipeResponse(id)),
    });
  });

  await loginAndNavigate(page, `/app/day/${day}`);
  await page.waitForResponse(BRIEF_URL);
}

test.describe('14-s4 — family-first day view', () => {
  test('renders the shared Main, per-child variation chips, and the M-group badge', async ({
    page,
  }) => {
    await openDay(page, 'monday');

    const sheet = page.getByRole('dialog', { name: /day detail/i });
    await expect(sheet).toBeVisible();
    // Every day's card is in the DOM (it is a swipe stack), so scope per card.
    const monday = sheet.getByRole('article', { name: 'Monday' });
    await expect(monday.getByRole('heading', { name: 'Dal + rice thermos' })).toBeVisible();
    // One Main shared across both kids — the family-first shape.
    await expect(monday.getByText('For Aarav & Mira')).toBeVisible();
    await expect(monday.getByRole('button', { name: /Aarav/ })).toBeVisible();
    await expect(monday.getByRole('button', { name: /Mira/ })).toBeVisible();
    await expect(monday.getByText('M1', { exact: true })).toBeVisible();
    // Live ingredients came from the recipe endpoint, not a mock fixture.
    await expect(monday.getByText('1 cup yellow dal')).toBeVisible();
  });

  test('Prep/Finish is an activity toggle that filters the method steps', async ({ page }) => {
    await openDay(page, 'monday');
    const sheet = page.getByRole('dialog', { name: /day detail/i });

    const monday = sheet.getByRole('article', { name: 'Monday' });

    // Default mode is Finish: only the finish-tagged step shows.
    await expect(monday.getByText(/FINISH STEP/)).toBeVisible();
    await expect(monday.getByText(/PREP STEP/)).toHaveCount(0);

    await sheet.getByRole('tab', { name: 'Prep' }).click();

    await expect(monday.getByText(/PREP STEP/)).toBeVisible();
    await expect(monday.getByText(/FINISH STEP/)).toHaveCount(0);
  });

  test('opens scrolled to the day named in the URL', async ({ page }) => {
    await openDay(page, 'wednesday');
    const sheet = page.getByRole('dialog', { name: /day detail/i });

    // Every card is in the DOM (swipe stack) and toBeVisible passes for cards
    // scrolled out of the inner container — toBeInViewport actually proves the
    // mount-scroll landed on Wednesday and left Monday off-screen.
    const wednesday = sheet.getByRole('article', { name: 'Wednesday' });
    await expect(
      wednesday.getByRole('heading', { name: 'Mini frittata muffins' }),
    ).toBeInViewport();
    await expect(
      sheet.getByRole('article', { name: 'Monday' }).getByRole('heading', {
        name: 'Dal + rice thermos',
      }),
    ).not.toBeInViewport();
    // The breadcrumb names the day the sheet was opened for.
    await expect(page.getByText('Wednesday', { exact: true }).first()).toBeVisible();
  });

  test('opens from the Brief day row (Open day link)', async ({ page }) => {
    await openDay(page, 'monday');
    // Close the sheet (Dialog contract: Escape → navigate /app) so the Brief
    // is interactive, then enter through the day row's link. A full page.goto
    // reload would restart the app shell instead.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /day detail/i })).toHaveCount(0);
    const openWednesday = page.getByRole('link', { name: 'Open Wednesday' });
    await expect(openWednesday).toBeVisible();
    await openWednesday.click();

    const sheet = page.getByRole('dialog', { name: /day detail/i });
    await expect(
      sheet
        .getByRole('article', { name: 'Wednesday' })
        .getByRole('heading', { name: 'Mini frittata muffins' }),
    ).toBeInViewport();
  });

  test('surfaces the day-detail action vocabulary', async ({ page }) => {
    await openDay(page, 'monday');
    const sheet = page.getByRole('dialog', { name: /day detail/i });

    await sheet.getByRole('button', { name: /more actions/i }).click();

    await expect(sheet.getByRole('button', { name: /Swap this Main/ })).toBeEnabled();
    await expect(sheet.getByRole('button', { name: /^Pause this day/ })).toBeEnabled();
    await expect(sheet.getByRole('button', { name: /Pause for Aarav/ })).toBeEnabled();
    await expect(sheet.getByRole('button', { name: /Change my mind/ })).toBeEnabled();
    // Cooked/prep signals have no backend yet — present in the vocabulary but
    // plainly inert rather than pretending to persist.
    await expect(sheet.getByRole('button', { name: /Mark cooked/ })).toBeDisabled();
  });

  test('a paused day shows its Paused marker and disables pausing again', async ({ page }) => {
    await openDay(page, 'monday', { pausedDays: ['monday'] });
    const sheet = page.getByRole('dialog', { name: /day detail/i });

    // Visible text, not an aria-label: a label on a <p> is prohibited ARIA.
    await expect(
      sheet.getByRole('article', { name: 'Monday' }).getByText('Paused', { exact: true }),
    ).toBeVisible();

    await sheet.getByRole('button', { name: /more actions/i }).click();
    await expect(sheet.getByRole('button', { name: /^Pause this day/ })).toBeDisabled();
  });

  test('recipe failure shows an honest retry without losing the rest of the card', async ({
    page,
  }) => {
    await openDay(page, 'monday', { failRecipes: true });
    const sheet = page.getByRole('dialog', { name: /day detail/i });

    // The app's QueryClient retries 3x with exponential backoff (~14s) before a
    // query settles as errored, so this assertion outwaits that policy.
    await expect(sheet.getByRole('alert')).toContainText(/couldn.t load the recipe/i, {
      timeout: 25_000,
    });
    await expect(sheet.getByRole('button', { name: /try again/i })).toBeVisible();
    // The brief's projected dish name still stands in, so the card is not blank.
    await expect(
      sheet.getByRole('article', { name: 'Monday' }).getByRole('heading', {
        name: 'Dal + rice thermos',
      }),
    ).toBeVisible();
  });

  test('leads with cooking — the retired explanation cards are gone', async ({ page }) => {
    await openDay(page, 'monday');
    const sheet = page.getByRole('dialog', { name: /day detail/i });

    await expect(sheet.getByText(/why lumi chose/i)).toHaveCount(0);
    await expect(sheet.getByText(/source/i)).toHaveCount(0);
    await expect(sheet.getByText(/nutrition/i)).toHaveCount(0);
    // What it DOES lead with: the dish and how to make it.
    const monday = sheet.getByRole('article', { name: 'Monday' });
    await expect(monday.getByText(/You.ll need/)).toBeVisible();
    await expect(monday.getByText(/How to make it/)).toBeVisible();
  });

  test('the day sheet has no new WCAG 2.0 A/AA violations', async ({ page }) => {
    await openDay(page, 'monday');
    await expect(page.getByRole('dialog', { name: /day detail/i })).toBeVisible();

    // Scoped to the sheet. NO amber-warm carve-out (review D1): the sheet's
    // own UI must clear contrast outright — the ModeToggle active state moved
    // off `bg-amber-warm text-bg` (2.37:1) for exactly this reason.
    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(results.violations).toHaveLength(0);
  });
});

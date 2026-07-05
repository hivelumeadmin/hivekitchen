import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { loginAndNavigate, userProfile, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

// ---------------------------------------------------------------------------
// Epic 13-s10 — "Talk to your plan" e2e (the MVP-wall flow).
//
// Happy swap path:  tap a day → the Lumi sheet summons with day context →
//   type an utterance → mocked `applied` response → the reply lands in the sheet.
// Escalate-confirm:  an `escalate` result renders a confirm gate; the expensive
//   T2 endpoint fires ONLY after the explicit confirm tap (the cost wall).
//
// Run in ISOLATION (single spec / --workers=1) per the SW-bypass constraint
// (memory e2e-full-suite-sw-bypass): the PWA service worker bypasses page.route
// mocks in the full suite. Locators mirror 13-s1 / 3-27.
// ---------------------------------------------------------------------------

const PLANS_URL = '**/v1/plans*';
const EDIT_URL = '**/v1/plans/*/edit';
const REGEN_URL = '**/v1/plans/*/regenerate*';
const BRIEF_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`;

const PLAN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DAY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MAIN_SLOT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MAIN_ASSIGNMENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const VARIATION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CHILD_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const RECIPE_OLD = '11111111-1111-4111-8111-111111111111';
const RECIPE_NEW = '22222222-2222-4222-8222-222222222222';

const MONDAY_MORNING = new Date('2026-05-04T08:00:00Z');
const ISO = '2026-05-04T00:00:00.000Z';

function plansResponse() {
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
      { id: MAIN_ASSIGNMENT_ID, plan_id: PLAN_ID, sequence: 1, recipe_id: RECIPE_OLD, created_at: ISO },
    ],
    days: [
      {
        id: DAY_ID,
        plan_id: PLAN_ID,
        day: 'monday',
        paused_at: null,
        paused_reason: null,
        paused_note: null,
        created_at: ISO,
        updated_at: ISO,
      },
    ],
    slots: [
      {
        id: MAIN_SLOT_ID,
        plan_day_id: DAY_ID,
        slot_kind: 'main',
        main_assignment_id: MAIN_ASSIGNMENT_ID,
        recipe_id: null,
        extra_kind: null,
        snack_sku_id: null,
        paused_at: null,
        created_at: ISO,
        updated_at: ISO,
      },
    ],
    variations: [
      {
        id: VARIATION_ID,
        plan_slot_id: MAIN_SLOT_ID,
        child_id: CHILD_ID,
        portion_size: 'regular',
        texture: 'normal',
        spice_level: 'mild',
        cutting_style: null,
        container: null,
        add_ons: ['veggie wraps'],
        removals: [],
        notes: null,
        paused_at: null,
        created_at: ISO,
        updated_at: ISO,
      },
    ],
    is_draft: false,
    week_of: '2026-05-04',
    variant_proposals: [],
  };
}

// Epic 13-s11 — talk-to-your-plan is summoned from the BRIEF now (the /app/plan
// duplicate collapsed into a redirect), so the brief must carry the day tiles
// the summon path taps. Mirrors the 13-s1 tile_summaries shape.
type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
const WEEKDAYS: readonly Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

function briefResponse() {
  return {
    brief: {
      household_id: SAMPLE_HOUSEHOLD_ID,
      plan_id: PLAN_ID,
      moment_headline: 'Your week, ready',
      lumi_note: '',
      memory_prose: '',
      payload: {
        cleared_allergies: [{ child_id: CHILD_ID, child_name: 'Maya', allergen: 'peanut' }],
        scaffolding_diff: null,
        plan_state: null,
        plan_state_set_at: null,
        plan_state_message: null,
        tile_summaries: WEEKDAYS.map((day, i) => ({
          day,
          paused: false,
          items: [
            {
              plan_item_id: `99999999-9999-4999-8999-99999999990${i + 1}`,
              child_id: CHILD_ID,
              slot: 'main',
              ingredients: ['rice', 'beans'],
            },
          ],
        })),
      },
      generated_at: ISO,
      plan_revision: 1,
      updated_at: ISO,
    },
  };
}

async function navigateToPlan(page: Page) {
  await page.clock.install({ time: MONDAY_MORNING });
  await page.route('**/v1/users/me', (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(userProfile()) }),
  );
  await page.route(BRIEF_URL, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(briefResponse()) }),
  );
  await page.route(PLANS_URL, (route) => {
    // Only fulfill the GET list here; /edit and /regenerate are routed separately.
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plansResponse()),
    });
  });
  // Epic 13-s11 — /app/plan collapsed into a redirect; the talk-to-your-plan
  // summon now lives on the Brief (BriefCanvas tiles, 13-s10 D1 fix). Land on
  // /app and wait on the brief that renders the tappable day tiles.
  await loginAndNavigate(page, '/app');
  await page.waitForResponse(BRIEF_URL);
}

async function tapDayAndSummon(page: Page) {
  await page.getByRole('article', { name: 'Monday' }).click();
  const sheet = page.getByRole('dialog', { name: /lumi/i });
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe('13-s10 — talk to your plan', () => {
  test('tap a day, type an utterance, and the applied reply lands in the sheet', async ({ page }) => {
    await navigateToPlan(page);
    await page.route(EDIT_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: { intent: 'swap_slot', confidence: 0.9, day: 'mon' },
          tier: 'T1',
          result: {
            status: 'applied',
            action: 'swap_main',
            main_assignment: {
              id: MAIN_ASSIGNMENT_ID,
              plan_id: PLAN_ID,
              sequence: 1,
              recipe_id: RECIPE_NEW,
              created_at: ISO,
            },
          },
        }),
      }),
    );

    const sheet = await tapDayAndSummon(page);
    // The sheet reflects the tapped day (AC1) — the day-context line.
    await expect(sheet.getByText('Monday', { exact: true })).toBeVisible();

    const input = sheet.getByLabel('Tell Lumi what to change');
    await input.fill('swap the main');
    await sheet.getByRole('button', { name: 'Send' }).click();

    await expect(sheet.getByText(/Done — swapped the main/)).toBeVisible();
  });

  test('escalation is confirm-then-fire: the T2 endpoint fires only after the confirm tap (AC5)', async ({
    page,
  }) => {
    await navigateToPlan(page);
    await page.route(EDIT_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: { intent: 'recompose', confidence: 0.95 },
          tier: 'T2',
          result: { status: 'escalate', reason: 'recompose' },
        }),
      }),
    );
    let regenCalls = 0;
    await page.route(REGEN_URL, (route) => {
      regenCalls += 1;
      return route.fulfill({
        status: 202,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: 'r1', rate_limit_remaining: 4 }),
      });
    });

    const sheet = await tapDayAndSummon(page);
    await sheet.getByLabel('Tell Lumi what to change').fill('redo the whole week');
    await sheet.getByRole('button', { name: 'Send' }).click();

    const confirm = sheet.getByRole('button', { name: /redraft the week/i });
    await expect(confirm).toBeVisible();
    // The cost wall: nothing fired yet.
    expect(regenCalls).toBe(0);

    // Subscribe before clicking — on slow CI runners the mocked response can
    // complete before a post-click waitForResponse registers, and the wait
    // then times out on a response that already happened.
    const regenResponse = page.waitForResponse((r) => r.url().includes('/regenerate'));
    await confirm.click();
    await regenResponse;
    expect(regenCalls).toBe(1);
  });

  test('the summoned sheet-in-plan-context has no new WCAG A/AA violations (AC1 a11y)', async ({
    page,
  }) => {
    await navigateToPlan(page);
    await tapDayAndSummon(page);
    const results = await new AxeBuilder({ page })
      .include('.app-scope')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const newViolations = results.violations
      .map((v) => ({
        ...v,
        nodes: v.id === 'color-contrast' ? v.nodes.filter((n) => !`${n.html} ${JSON.stringify(n.target)}`.includes('amber-warm')) : v.nodes,
      }))
      .filter((v) => v.nodes.length > 0);
    expect(newViolations).toHaveLength(0);
  });
});

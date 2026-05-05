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
// Wildcard after path matches query string (?scope=week, ?scope=day&day=monday, etc.)
const REGEN_URL = `**/v1/plans/${PLAN_ID}/regenerate*`;

function regenResponse(overrides: { rate_limit_remaining?: number } = {}) {
  return {
    job_id: 'test-regen-job-1',
    rate_limit_remaining: overrides.rate_limit_remaining ?? 4,
  };
}

interface BriefOpts {
  planId?: string | null;
  planRevision?: number;
}

function briefResponse(opts: BriefOpts = {}) {
  return {
    brief: {
      household_id: SAMPLE_HOUSEHOLD_ID,
      plan_id: opts.planId === undefined ? PLAN_ID : opts.planId,
      moment_headline: 'A quiet week.',
      lumi_note: '',
      memory_prose: '',
      plan_tile_summaries: [
        { day: 'monday',    paused: false, items: [{ plan_item_id: ITEM_ID_MON, child_id: CHILD_ID, slot: 'main', ingredients: ['rice'] }] },
        { day: 'tuesday',   paused: false, items: [{ plan_item_id: '55555555-5555-4555-8555-555555555502', child_id: CHILD_ID, slot: 'main', ingredients: ['noodles'] }] },
        { day: 'wednesday', paused: false, items: [{ plan_item_id: '55555555-5555-4555-8555-555555555503', child_id: CHILD_ID, slot: 'main', ingredients: ['pasta'] }] },
        { day: 'thursday',  paused: false, items: [{ plan_item_id: '55555555-5555-4555-8555-555555555504', child_id: CHILD_ID, slot: 'main', ingredients: ['soup'] }] },
        { day: 'friday',    paused: false, items: [{ plan_item_id: '55555555-5555-4555-8555-555555555505', child_id: CHILD_ID, slot: 'main', ingredients: ['wrap'] }] },
      ],
      cleared_allergies: [],
      scaffolding_diff: null,
      generated_at: '2026-05-02T00:00:00.000Z',
      plan_revision: opts.planRevision ?? 1,
      updated_at: '2026-05-02T00:00:00.000Z',
    },
  };
}

async function navigateToApp(page: Page, opts: BriefOpts = {}) {
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

test.describe('Story 3-13: Week regen button visibility', () => {
  test('"Ask Lumi to try again" is visible when plan_id is set (AC #1)', async ({ page }) => {
    await navigateToApp(page);
    await expect(page.getByRole('button', { name: /ask lumi to try again/i })).toBeVisible();
  });

  test('"Ask Lumi to try again" is absent when plan_id is null (canSwap guard)', async ({ page }) => {
    await navigateToApp(page, { planId: null });
    await expect(page.getByRole('button', { name: /ask lumi to try again/i })).toHaveCount(0);
  });
});

test.describe('Story 3-13: Week regeneration POST (AC #1)', () => {
  test('fires POST /regenerate?scope=week with Idempotency-Key UUID header', async ({ page }) => {
    let captured: { method: string; query: string; idempotencyKey: string | null } | null = null;
    await page.route(REGEN_URL, async (route: Route) => {
      const req = route.request();
      captured = {
        method: req.method(),
        query: new URL(req.url()).search,
        idempotencyKey: req.headers()['idempotency-key'] ?? null,
      };
      await route.fulfill({
        status: 202,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(regenResponse()),
      });
    });

    await navigateToApp(page);
    await page.getByRole('button', { name: /ask lumi to try again/i }).click();

    await expect.poll(() => captured?.method).toBe('POST');
    expect(captured!.query).toContain('scope=week');
    expect(captured!.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  test('POST 202: button hidden; regen copy and FreshnessState loading copy appear', async ({ page }) => {
    await page.route(REGEN_URL, (route) =>
      route.fulfill({
        status: 202,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(regenResponse()),
      }),
    );

    await navigateToApp(page);
    await page.getByRole('button', { name: /ask lumi to try again/i }).click();

    // isRegenerating=true — button suppressed.
    await expect(page.getByRole('button', { name: /ask lumi to try again/i })).toHaveCount(0);
    // Inline regen progress copy.
    await expect(page.getByText(/lumi is rethinking this week/i)).toBeVisible();
    // FreshnessState variant=loading (hasFetchError=false takes precedence per P1 fix).
    await expect(page.getByRole('status')).toContainText("Lumi is drafting this week's plan");
  });
});

test.describe('Story 3-13: Regen completion via revision bump (AC #2)', () => {
  test('plan_revision bump in polling brief clears regen state and restores button', async ({ page }) => {
    // Fake clock: prevents real network stale-time refetches from interfering;
    // page.clock.tick() fires the 5s polling setInterval on demand.
    await page.clock.install();

    let planRevision = 1;

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
        body: JSON.stringify(briefResponse({ planRevision })),
      }),
    );
    await page.route(REGEN_URL, (route) =>
      route.fulfill({
        status: 202,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(regenResponse()),
      }),
    );

    await loginAndNavigate(page, '/app');
    await page.waitForResponse('**/v1/users/me');
    await page.waitForResponse(BRIEF_URL);

    await page.getByRole('button', { name: /ask lumi to try again/i }).click();
    // Confirm regen state entered.
    await expect(page.getByText(/lumi is rethinking this week/i)).toBeVisible();

    // Switch brief to return revision 2 (BullMQ job committed new plan).
    planRevision = 2;

    // Advance fake clock past the 5s polling interval to fire the setInterval.
    await page.clock.runFor(5100);
    await page.waitForResponse(BRIEF_URL);

    // Detection effect: plan_revision(2) > baseline(1) → setIsRegenerating(false).
    await expect(page.getByText(/lumi is rethinking this week/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /ask lumi to try again/i })).toBeVisible();
  });
});

// SUNDAY_ISO: freeze time to a Sunday so all plan tiles are 'upcoming' and
// therefore interactive. PlanTile.deriveVariant() uses Date.getDay(); without
// a frozen clock, tiles for past days have pointer-events-none and can't be clicked.
const SUNDAY_ISO = '2026-05-03T12:00:00Z';

test.describe('Story 3-13: Day regeneration via picker (AC #1)', () => {
  test('"Ask Lumi to redo this day" button appears in picker L1', async ({ page }) => {
    await page.clock.install({ time: new Date(SUNDAY_ISO) });
    await navigateToApp(page);
    await page.getByRole('article', { name: /monday/i }).click();

    await expect(page.getByRole('button', { name: /ask lumi to redo this day/i })).toBeVisible();
  });

  test('clicking day regen dismisses picker and fires POST with scope=day&day=monday', async ({ page }) => {
    await page.clock.install({ time: new Date(SUNDAY_ISO) });

    let captured: { query: string; idempotencyKey: string | null } | null = null;
    await page.route(REGEN_URL, async (route: Route) => {
      const req = route.request();
      captured = {
        query: new URL(req.url()).search,
        idempotencyKey: req.headers()['idempotency-key'] ?? null,
      };
      await route.fulfill({
        status: 202,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(regenResponse()),
      });
    });

    await navigateToApp(page);
    await page.getByRole('article', { name: /monday/i }).click();
    await expect(page.getByRole('group', { name: /edit monday/i })).toBeVisible();

    await page.getByRole('button', { name: /ask lumi to redo this day/i }).click();

    // Picker dismissed by handleRegenerate → dismissPicker() before mutation fires.
    await expect(page.getByRole('group', { name: /edit monday/i })).toHaveCount(0);
    await expect.poll(() => captured?.query).toContain('scope=day');
    expect(captured!.query).toContain('day=monday');
    expect(captured!.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

test.describe('Story 3-13: Rate limit 429 (AC #1)', () => {
  test('POST 429: isRegenerating stays false; regen copy absent; button remains visible', async ({ page }) => {
    await page.route(REGEN_URL, (route) =>
      route.fulfill({
        status: 429,
        headers: {
          'Content-Type': 'application/problem+json',
          'Retry-After': '604800',
        },
        body: JSON.stringify({
          type: '/errors/rate-limit',
          status: 429,
          title: 'Too many regeneration requests',
          detail: 'Retry after 604800 seconds.',
        }),
      }),
    );

    await navigateToApp(page);
    await page.getByRole('button', { name: /ask lumi to try again/i }).click();

    // onError fires — onSuccess never ran — isRegenerating was never set.
    await expect(page.getByText(/lumi is rethinking this week/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /ask lumi to try again/i })).toBeVisible();
  });
});

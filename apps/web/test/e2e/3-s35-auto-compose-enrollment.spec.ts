import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, authUser, mockLogin } from './_helpers.js';

// Story 3-S35: Per-household auto-compose enrollment + weekly cron gating.
//
// Coverage:
//   AC5  — GET /auto-compose loads state on mount (enabled + disabled)
//   AC6  — toggle visible for primary_parent once has_plan=true; hidden before
//           first plan; hidden for secondary_caregiver
//   AC4  — PATCH sends correct body; optimistic update; failed PATCH reverts
//
// AC1 (migration) is verified by the USER-SIDE supabase db push gate.
// AC2/AC3 (cron gating + idempotent skip) are covered by
//   plan-generation.job.test.ts (selectAutoComposeEligible unit tests).
// AC7 (toggle route 200 + audit, 403 guards) is covered by
//   households.routes.test.ts.

const MEMBERS_URL = '**/v1/households/*/members';
const GEOLOCATION_URL = '**/v1/households/*/geolocation-consent';
const AUTO_COMPOSE_URL = '**/v1/households/*/auto-compose';

const MEMBERS_BODY = {
  household_display_name: null,
  members: [
    {
      user_id: '11111111-1111-4111-8111-111111111111',
      display_name: 'Alex',
      role: 'primary_parent',
    },
  ],
};

const GEOLOCATION_BODY = {
  geolocation_enabled: false,
  geolocation_consented_at: null,
  geolocation_purpose: null,
};

function autoComposeBody(enabled: boolean, hasPlan: boolean) {
  return { auto_compose_enabled: enabled, has_plan: hasPlan };
}

/**
 * Mock the three GET endpoints that household-settings.tsx loads on mount.
 * The auto-compose GET defaults to enabled=true, hasPlan=true.
 */
async function mockBaseRoutes(
  page: Page,
  opts: { autoComposeEnabled?: boolean; hasPlan?: boolean } = {},
) {
  const { autoComposeEnabled = true, hasPlan = true } = opts;

  await page.route(MEMBERS_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(MEMBERS_BODY),
    }),
  );
  await page.route(GEOLOCATION_URL, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(GEOLOCATION_BODY),
    });
  });
  await page.route(AUTO_COMPOSE_URL, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(autoComposeBody(autoComposeEnabled, hasPlan)),
    });
  });
}

// ---------------------------------------------------------------------------
// AC5 / AC6 — section visibility and initial state
// ---------------------------------------------------------------------------

test.describe('Story 3-S35 — Planning section visibility (AC5, AC6)', () => {
  test('toggle is visible and checked when auto-compose is enabled and plan exists', async ({
    page,
  }) => {
    await mockBaseRoutes(page, { autoComposeEnabled: true, hasPlan: true });
    await loginAndNavigate(page, '/app/household/settings');

    const toggle = page.getByRole('switch', { name: /auto-compose next week's plan/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked();
    await expect(
      page.getByText("Auto-compose next week's plan — Friday evening"),
    ).toBeVisible();
  });

  test('toggle is visible and unchecked when auto-compose is disabled and plan exists', async ({
    page,
  }) => {
    await mockBaseRoutes(page, { autoComposeEnabled: false, hasPlan: true });
    await loginAndNavigate(page, '/app/household/settings');

    const toggle = page.getByRole('switch', { name: /auto-compose next week's plan/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
  });

  test('Planning section is hidden before the first plan exists (has_plan=false)', async ({
    page,
  }) => {
    await mockBaseRoutes(page, { autoComposeEnabled: true, hasPlan: false });
    await loginAndNavigate(page, '/app/household/settings');

    // Wait for the page to be fully loaded (members section renders).
    await expect(page.getByText('Alex')).toBeVisible();
    await expect(
      page.getByRole('switch', { name: /auto-compose next week's plan/i }),
    ).not.toBeVisible();
    await expect(
      page.getByText("Auto-compose next week's plan — Friday evening"),
    ).not.toBeVisible();
  });

  test('Planning section is not shown for secondary_caregiver (AC6)', async ({ page }) => {
    await page.route(MEMBERS_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(MEMBERS_BODY),
      }),
    );
    await page.route(GEOLOCATION_URL, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(GEOLOCATION_BODY),
      });
    });
    // secondary_caregiver — the component skips the auto-compose GET for this role.
    await mockLogin(page, { user: authUser({ role: 'secondary_caregiver' }) });
    await page.goto(
      `/auth/login?next=${encodeURIComponent('/app/household/settings')}`,
    );
    await page.getByLabel('Email Address', { exact: true }).fill('parent@example.com');
    await page.getByLabel('Password', { exact: true }).fill('verylongpassword');
    await page.getByRole('button', { name: /enter kitchen/i }).click();
    await page.waitForURL(/\/app\/household\/settings/);

    await expect(page.getByText('Alex')).toBeVisible();
    await expect(
      page.getByRole('switch', { name: /auto-compose next week's plan/i }),
    ).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// AC4 — disable flow
// ---------------------------------------------------------------------------

test.describe('Story 3-S35 — disable auto-compose (AC4)', () => {
  test('clicking an enabled toggle sends PATCH with false and toggle stays off', async ({
    page,
  }) => {
    await mockBaseRoutes(page, { autoComposeEnabled: true, hasPlan: true });

    let capturedBody: Record<string, unknown> | null = null;
    await page.route(AUTO_COMPOSE_URL, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      capturedBody = (await route.request().postDataJSON()) as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(autoComposeBody(false, true)),
      });
    });

    await loginAndNavigate(page, '/app/household/settings');
    const toggle = page.getByRole('switch', { name: /auto-compose next week's plan/i });
    await expect(toggle).toBeChecked();
    await toggle.click();

    await expect.poll(() => capturedBody).toMatchObject({ auto_compose_enabled: false });
    await expect(toggle).not.toBeChecked();
  });

  test('failed PATCH reverts toggle to checked and shows an error alert', async ({ page }) => {
    await mockBaseRoutes(page, { autoComposeEnabled: true, hasPlan: true });
    await page.route(AUTO_COMPOSE_URL, (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      return route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server error' }),
      });
    });

    await loginAndNavigate(page, '/app/household/settings');
    const toggle = page.getByRole('switch', { name: /auto-compose next week's plan/i });
    await expect(toggle).toBeChecked();
    await toggle.click();

    // Optimistic flip to off → PATCH fails → revert to on + error alert.
    await expect(page.getByRole('alert')).toContainText(
      /could not update this setting/i,
    );
    await expect(toggle).toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// AC4 — enable flow
// ---------------------------------------------------------------------------

test.describe('Story 3-S35 — re-enable auto-compose (AC4)', () => {
  test('clicking a disabled toggle sends PATCH with true and toggle stays on', async ({ page }) => {
    await mockBaseRoutes(page, { autoComposeEnabled: false, hasPlan: true });

    let capturedBody: Record<string, unknown> | null = null;
    await page.route(AUTO_COMPOSE_URL, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      capturedBody = (await route.request().postDataJSON()) as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(autoComposeBody(true, true)),
      });
    });

    await loginAndNavigate(page, '/app/household/settings');
    const toggle = page.getByRole('switch', { name: /auto-compose next week's plan/i });
    await expect(toggle).not.toBeChecked();
    await toggle.click();

    await expect.poll(() => capturedBody).toMatchObject({ auto_compose_enabled: true });
    await expect(toggle).toBeChecked();
  });
});

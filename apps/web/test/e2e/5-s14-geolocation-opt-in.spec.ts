import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, authUser, mockLogin } from './_helpers.js';

// Story 5-S14: Household-level geolocation opt-in (household settings page).
//
// Coverage:
//   AC6  — toggle loads current consent state on mount (enabled + disabled)
//   AC7  — enable: browser permission granted → PATCH { enabled: true, purpose }
//   AC8  — enable: browser permission denied → error message, toggle stays off, no PATCH
//   AC9  — disable: optimistic toggle-off → PATCH { enabled: false }; failed PATCH reverts
//   AC11 — guest_author does not see the Location section
//
// AC1/AC2/AC3/AC4/AC5 (API contract + 403 guards) are covered by
// households.routes.test.ts. AC10 (audit logging) is covered there too.
// AC12 (schema unit tests) is in household-geolocation.test.ts.

const MEMBERS_URL = '**/v1/households/*/members';
const CONSENT_URL = '**/v1/households/*/geolocation-consent';

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

function consentBody(enabled: boolean) {
  return {
    geolocation_enabled: enabled,
    geolocation_consented_at: enabled ? '2026-10-22T10:00:00.000Z' : null,
    geolocation_purpose: enabled ? 'cultural_supplier_routing' : null,
  };
}

/** Mock GET /members and GET /geolocation-consent before navigation. */
async function mockBaseRoutes(page: Page, geolocationEnabled = false) {
  await page.route(MEMBERS_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(MEMBERS_BODY),
    }),
  );
  await page.route(CONSENT_URL, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(consentBody(geolocationEnabled)),
    });
  });
}

/**
 * Inject a browser-side geolocation stub that immediately calls the success
 * callback. Must be called before page navigation (addInitScript runs on
 * document create). The GeolocationPosition is discarded by the app — only
 * the consent flag is persisted (NFR-PRIV-3).
 */
async function stubGeolocationGranted(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (success: (pos: object) => void) => {
          success({
            coords: {
              latitude: 51.5074,
              longitude: -0.1278,
              accuracy: 50,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          });
        },
      },
      configurable: true,
    });
  });
}

/**
 * Inject a browser-side geolocation stub that immediately calls the error
 * callback with PERMISSION_DENIED (code 1).
 */
async function stubGeolocationDenied(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (
          _success: unknown,
          error?: (e: { code: number; message: string }) => void,
        ) => {
          error?.({ code: 1, message: 'User denied Geolocation' });
        },
      },
      configurable: true,
    });
  });
}

// ---------------------------------------------------------------------------
// AC6 / AC11 — section visibility and initial state
// ---------------------------------------------------------------------------

test.describe('Story 5-S14 — Location section visibility', () => {
  test('toggle is visible and unchecked when geolocation_enabled is false (AC6)', async ({
    page,
  }) => {
    await mockBaseRoutes(page, false);
    await loginAndNavigate(page, '/app/household/settings');

    const toggle = page.getByRole('switch', { name: /find cultural suppliers near me/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
  });

  test('toggle is checked when geolocation_enabled is true (AC6)', async ({ page }) => {
    await mockBaseRoutes(page, true);
    await loginAndNavigate(page, '/app/household/settings');

    await expect(
      page.getByRole('switch', { name: /find cultural suppliers near me/i }),
    ).toBeChecked();
  });

  test('Location section is not rendered for guest_author (AC11)', async ({ page }) => {
    await page.route(MEMBERS_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(MEMBERS_BODY),
      }),
    );
    // Log in as guest_author — component skips the consent GET for this role.
    await mockLogin(page, { user: authUser({ role: 'guest_author' }) });
    await page.goto(`/auth/login?next=${encodeURIComponent('/app/household/settings')}`);
    await page.getByLabel('Email Address', { exact: true }).fill('parent@example.com');
    await page.getByLabel('Password', { exact: true }).fill('verylongpassword');
    await page.getByRole('button', { name: /enter kitchen/i }).click();
    await page.waitForURL(/\/app\/household\/settings/);

    // Confirm the page has loaded before asserting absence.
    await expect(page.getByText('Alex')).toBeVisible();
    await expect(
      page.getByRole('switch', { name: /find cultural suppliers near me/i }),
    ).not.toBeVisible();
    await expect(page.getByText('Find cultural suppliers near me')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// AC7 — enable flow: browser permission granted
// ---------------------------------------------------------------------------

test.describe('Story 5-S14 — enable flow: browser permission granted (AC7)', () => {
  test('clicking the toggle sends PATCH with enabled+purpose and toggle stays on', async ({
    page,
  }) => {
    await stubGeolocationGranted(page);
    await mockBaseRoutes(page, false);

    let capturedBody: Record<string, unknown> | null = null;
    await page.route(CONSENT_URL, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      capturedBody = (await route.request().postDataJSON()) as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(consentBody(true)),
      });
    });

    await loginAndNavigate(page, '/app/household/settings');
    const toggle = page.getByRole('switch', { name: /find cultural suppliers near me/i });
    await expect(toggle).not.toBeChecked();
    await toggle.click();

    await expect.poll(() => capturedBody).toMatchObject({
      geolocation_enabled: true,
      geolocation_purpose: 'cultural_supplier_routing',
    });
    await expect(toggle).toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// AC8 — enable flow: browser permission denied
// ---------------------------------------------------------------------------

test.describe('Story 5-S14 — enable flow: browser permission denied (AC8)', () => {
  test('denied permission shows the exact error message and toggle stays unchecked', async ({
    page,
  }) => {
    await stubGeolocationDenied(page);
    await mockBaseRoutes(page, false);

    await loginAndNavigate(page, '/app/household/settings');
    const toggle = page.getByRole('switch', { name: /find cultural suppliers near me/i });
    await expect(toggle).not.toBeChecked();
    await toggle.click();

    await expect(page.getByRole('alert')).toContainText(
      'Location access was denied. Enable it in your browser settings.',
    );
    await expect(toggle).not.toBeChecked();
  });

  test('PATCH is not called when browser permission is denied', async ({ page }) => {
    await stubGeolocationDenied(page);
    await mockBaseRoutes(page, false);

    let patchCalled = false;
    await page.route(CONSENT_URL, (route) => {
      if (route.request().method() === 'PATCH') patchCalled = true;
      return route.fallback();
    });

    await loginAndNavigate(page, '/app/household/settings');
    await page.getByRole('switch', { name: /find cultural suppliers near me/i }).click();

    // Wait for the error to confirm the async flow has settled.
    await expect(page.getByRole('alert')).toBeVisible();
    expect(patchCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC9 — disable flow
// ---------------------------------------------------------------------------

test.describe('Story 5-S14 — disable flow (AC9)', () => {
  test('clicking an enabled toggle sends PATCH with disabled and toggle stays off', async ({
    page,
  }) => {
    await mockBaseRoutes(page, true);

    let capturedBody: Record<string, unknown> | null = null;
    await page.route(CONSENT_URL, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      capturedBody = (await route.request().postDataJSON()) as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(consentBody(false)),
      });
    });

    await loginAndNavigate(page, '/app/household/settings');
    const toggle = page.getByRole('switch', { name: /find cultural suppliers near me/i });
    await expect(toggle).toBeChecked();
    await toggle.click();

    await expect.poll(() => capturedBody).toMatchObject({ geolocation_enabled: false });
    await expect(toggle).not.toBeChecked();
  });

  test('failed PATCH reverts the toggle to checked and shows an error', async ({ page }) => {
    await mockBaseRoutes(page, true);
    await page.route(CONSENT_URL, (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      return route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server error' }),
      });
    });

    await loginAndNavigate(page, '/app/household/settings');
    const toggle = page.getByRole('switch', { name: /find cultural suppliers near me/i });
    await expect(toggle).toBeChecked();
    await toggle.click();

    // Optimistic flip to off → PATCH fails → revert to on + error alert.
    await expect(page.getByRole('alert')).toContainText(/could not update location setting/i);
    await expect(toggle).toBeChecked();
  });
});

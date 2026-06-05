import { test, expect, type Page } from '@playwright/test';
import {
  loginAndNavigate,
  mockLogin,
  userProfile,
  authUser,
  SAMPLE_HOUSEHOLD_ID,
} from './_helpers.js';

const EXPORT_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/export`;

const QUEUED_RESPONSE = {
  status: 'queued',
  message:
    "We're preparing your export. You'll receive an email with a download link within 72 hours.",
};

async function mockProfile(page: Page, role = 'primary_parent') {
  const profile = userProfile({ role });
  await page.route('**/v1/users/me', async (route, request) => {
    if (request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
    }
    return route.continue();
  });
}

test.describe('7-S10: JSON Data Export', () => {
  test('"Data portability" section is visible and button is enabled for primary_parent', async ({
    page,
  }) => {
    await mockProfile(page, 'primary_parent');
    await loginAndNavigate(page, '/account');

    await expect(page.getByRole('heading', { name: /your account/i })).toBeVisible();
    await expect(page.getByText('Data portability')).toBeVisible();
    const button = page.getByRole('button', { name: 'Export my data' });
    await expect(button).toBeVisible();
    await expect(button).not.toBeDisabled();
  });

  test('"Data portability" section is hidden for secondary_caregiver', async ({ page }) => {
    await mockProfile(page, 'secondary_caregiver');
    await mockLogin(page, { user: authUser({ role: 'secondary_caregiver' }) });
    await page.goto('/auth/login?next=/account');
    await page.getByLabel('Email Address', { exact: true }).fill('parent@example.com');
    await page.getByLabel('Password', { exact: true }).fill('verylongpassword');
    await page.getByRole('button', { name: /enter kitchen/i }).click();
    await page.waitForURL(/\/account/);

    await expect(page.getByRole('heading', { name: /your account/i })).toBeVisible();
    await expect(page.getByText('Data portability')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export my data' })).toHaveCount(0);
  });

  test('click "Export my data" → 202 → success copy replaces button (no polling)', async ({
    page,
  }) => {
    await mockProfile(page);
    await page.route(EXPORT_URL, async (route) =>
      route.fulfill({
        status: 202,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(QUEUED_RESPONSE),
      }),
    );

    await loginAndNavigate(page, '/account');
    await page.getByRole('button', { name: 'Export my data' }).click();

    await expect(
      page.getByText(/preparing your export/i),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export my data' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Exporting…' })).toHaveCount(0);
  });

  test('button is disabled and shows "Exporting…" while request is in-flight', async ({
    page,
  }) => {
    await mockProfile(page);
    let resolveRoute!: () => void;
    const pendingRoute = new Promise<void>((resolve) => {
      resolveRoute = resolve;
    });
    await page.route(EXPORT_URL, async (route) => {
      await pendingRoute;
      return route.fulfill({
        status: 202,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(QUEUED_RESPONSE),
      });
    });

    await loginAndNavigate(page, '/account');
    await page.getByRole('button', { name: 'Export my data' }).click();

    const pendingButton = page.getByRole('button', { name: 'Exporting…' });
    await expect(pendingButton).toBeVisible();
    await expect(pendingButton).toBeDisabled();

    resolveRoute();

    await expect(page.getByText(/preparing your export/i)).toBeVisible();
  });

  test('error alert shown and button re-enabled when export POST fails', async ({ page }) => {
    await mockProfile(page);
    await page.route(EXPORT_URL, async (route) =>
      route.fulfill({ status: 500, body: 'Internal Server Error' }),
    );

    await loginAndNavigate(page, '/account');
    await page.getByRole('button', { name: 'Export my data' }).click();

    await expect(page.getByRole('alert')).toContainText(/something went wrong/i);
    const button = page.getByRole('button', { name: 'Export my data' });
    await expect(button).toBeVisible();
    await expect(button).not.toBeDisabled();
  });
});

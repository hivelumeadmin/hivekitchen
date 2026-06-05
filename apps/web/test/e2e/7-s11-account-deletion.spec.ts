import { test, expect, type Page } from '@playwright/test';
import {
  loginAndNavigate,
  mockLogin,
  userProfile,
  authUser,
  SAMPLE_HOUSEHOLD_ID,
} from './_helpers.js';

const DELETE_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/delete`;
const KITCHEN_MAP_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/kitchen-map`;
const HOUSEHOLD_NAME = 'The Menon Kitchen';

const KITCHEN_MAP_RESPONSE = {
  household: { display_name: HOUSEHOLD_NAME },
};

const SCHEDULED_RESPONSE = {
  status: 'scheduled',
  scheduled_hard_delete_at: '2026-07-12T04:00:00.000Z',
  message: 'Your account and all data will be permanently deleted on 2026-07-12.',
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

async function mockKitchenMap(page: Page) {
  await page.route(KITCHEN_MAP_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(KITCHEN_MAP_RESPONSE),
    }),
  );
}

async function openDeleteDialog(page: Page) {
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('7-S11: Account Deletion', () => {
  test('"Delete account" section is visible and button is enabled for primary_parent', async ({
    page,
  }) => {
    await mockProfile(page, 'primary_parent');
    await loginAndNavigate(page, '/account');

    await expect(page.getByRole('heading', { name: /your account/i })).toBeVisible();
    await expect(page.getByText('Delete account')).toBeVisible();
    const button = page.getByRole('button', { name: 'Delete my account' });
    await expect(button).toBeVisible();
    await expect(button).not.toBeDisabled();
  });

  test('"Delete account" section is hidden for secondary_caregiver', async ({ page }) => {
    await mockProfile(page, 'secondary_caregiver');
    await mockLogin(page, { user: authUser({ role: 'secondary_caregiver' }) });
    await page.goto('/auth/login?next=/account');
    await page.getByLabel('Email Address', { exact: true }).fill('parent@example.com');
    await page.getByLabel('Password', { exact: true }).fill('verylongpassword');
    await page.getByRole('button', { name: /enter kitchen/i }).click();
    await page.waitForURL(/\/account/);

    await expect(page.getByRole('heading', { name: /your account/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete my account' })).toHaveCount(0);
  });

  test('dialog opens and "Delete forever" is disabled with empty input', async ({ page }) => {
    await mockProfile(page);
    await mockKitchenMap(page);
    await loginAndNavigate(page, '/account');

    await openDeleteDialog(page);

    await expect(page.getByLabel(`Type "${HOUSEHOLD_NAME}" to confirm`)).toBeVisible();
    const confirm = page.getByRole('button', { name: 'Delete forever' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toBeDisabled();
  });

  test('"Delete forever" stays disabled when input does not match household name', async ({
    page,
  }) => {
    await mockProfile(page);
    await mockKitchenMap(page);
    await loginAndNavigate(page, '/account');

    await openDeleteDialog(page);
    await page.getByLabel(`Type "${HOUSEHOLD_NAME}" to confirm`).fill('Wrong Name');

    await expect(page.getByRole('button', { name: 'Delete forever' })).toBeDisabled();
  });

  test('"Delete forever" enables on case-insensitive trimmed match', async ({ page }) => {
    await mockProfile(page);
    await mockKitchenMap(page);
    await loginAndNavigate(page, '/account');

    await openDeleteDialog(page);
    await page.getByLabel(`Type "${HOUSEHOLD_NAME}" to confirm`).fill('  the menon kitchen  ');

    await expect(page.getByRole('button', { name: 'Delete forever' })).not.toBeDisabled();
  });

  test('successful deletion logs out and redirects to /auth/login', async ({ page }) => {
    await mockProfile(page);
    await mockKitchenMap(page);
    await page.route(DELETE_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(SCHEDULED_RESPONSE),
      }),
    );
    // Allow logout API call to resolve cleanly.
    await page.route('**/v1/auth/logout', (route) => route.fulfill({ status: 200, body: '{}' }));

    await loginAndNavigate(page, '/account');
    await openDeleteDialog(page);
    await page.getByLabel(`Type "${HOUSEHOLD_NAME}" to confirm`).fill(HOUSEHOLD_NAME);
    await page.getByRole('button', { name: 'Delete forever' }).click();

    await page.waitForURL(/\/auth\/login/);
    await expect(page.getByRole('button', { name: /enter kitchen/i })).toBeVisible();
  });

  test('error shown and dialog stays open when deletion POST fails', async ({ page }) => {
    await mockProfile(page);
    await mockKitchenMap(page);
    await page.route(DELETE_URL, (route) =>
      route.fulfill({ status: 500, body: 'Internal Server Error' }),
    );

    await loginAndNavigate(page, '/account');
    await openDeleteDialog(page);
    await page.getByLabel(`Type "${HOUSEHOLD_NAME}" to confirm`).fill(HOUSEHOLD_NAME);
    await page.getByRole('button', { name: 'Delete forever' }).click();

    await expect(page.getByRole('alert')).toContainText(/something went wrong/i);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete forever' })).not.toBeDisabled();
  });
});

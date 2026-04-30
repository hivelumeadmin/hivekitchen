import { test, expect } from '@playwright/test';
import { loginAndNavigate } from './_helpers.js';

const SAMPLE_TOKEN = 'inv-token-abc123';

test.describe('Story 2-3: secondary caregiver invite redemption', () => {
  test('unauthenticated redeem redirects to /auth/login with next=/invite/<token>', async ({ page }) => {
    await page.goto(`/invite/${SAMPLE_TOKEN}`);
    await expect(page).toHaveURL(
      new RegExp(`/auth/login\\?next=%2Finvite%2F${SAMPLE_TOKEN}$`),
    );
  });

  test('successful redemption follows scope_target', async ({ page }) => {
    // Mock both the invite redeem endpoint AND the destination's profile fetch
    // so that landing on /app does not crash on missing data.
    await page.route('**/v1/auth/invites/redeem', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope_target: '/app' }),
      }),
    );
    await loginAndNavigate(page, `/invite/${SAMPLE_TOKEN}`);
    await expect(page).toHaveURL(/\/app$/);
  });

  test('410 (expired/used token) shows the expired message', async ({ page }) => {
    await page.route('**/v1/auth/invites/redeem', (route) =>
      route.fulfill({
        status: 410,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/gone', status: 410, title: 'Gone' }),
      }),
    );
    await loginAndNavigate(page, `/invite/${SAMPLE_TOKEN}`);
    await expect(page.getByRole('alert')).toContainText(/expired or already been used/i);
  });

  test('5xx surfaces the generic error message', async ({ page }) => {
    await page.route('**/v1/auth/invites/redeem', (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server' }),
      }),
    );
    await loginAndNavigate(page, `/invite/${SAMPLE_TOKEN}`);
    await expect(page.getByRole('alert')).toContainText(/something went wrong/i);
  });

  test('non-relative scope_target is rejected → generic error', async ({ page }) => {
    // The route refuses `/^\/[^/]/` violations as a defence-in-depth check.
    await page.route('**/v1/auth/invites/redeem', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope_target: 'https://evil.example/steal' }),
      }),
    );
    await loginAndNavigate(page, `/invite/${SAMPLE_TOKEN}`);
    await expect(page.getByRole('alert')).toContainText(/something went wrong/i);
  });
});

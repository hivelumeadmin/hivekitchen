import { test, expect } from '@playwright/test';
import { authUser } from './_helpers.js';

test.describe('Story 2-4b: password reset completion page', () => {
  test('no recovery hash → "Link expired" view', async ({ page }) => {
    await page.goto('/auth/reset-password');
    await expect(page.getByRole('heading', { name: /link expired/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /send a new link/i })).toBeVisible();
  });

  test('non-recovery hash type → "Link expired" view', async ({ page }) => {
    await page.goto('/auth/reset-password#access_token=abc&type=signup');
    await expect(page.getByRole('heading', { name: /link expired/i })).toBeVisible();
  });

  test('valid hash renders the reset form and accepts a new password', async ({ page }) => {
    let postedBody: Record<string, unknown> | null = null;
    await page.route('**/v1/auth/password-reset-complete', async (route, request) => {
      postedBody = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: 'jwt-after-reset',
          expires_in: 900,
          user: authUser(),
          is_first_login: false,
        }),
      });
    });

    await page.goto('/auth/reset-password#access_token=recovery-token-xyz&type=recovery');
    await expect(page.getByRole('heading', { name: /reset your password/i })).toBeVisible();
    await page.getByLabel(/new password/i).fill('a-new-strong-password');
    await page.getByRole('button', { name: /^reset password$/i }).click();
    await expect(page).toHaveURL(/\/app$/);
    expect(postedBody).toEqual({
      token: 'recovery-token-xyz',
      password: 'a-new-strong-password',
    });
  });

  test('show/hide button toggles the password input type', async ({ page }) => {
    await page.goto('/auth/reset-password#access_token=any-token&type=recovery');
    const passwordInput = page.getByLabel(/new password/i);
    await expect(passwordInput).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: /^show$/i }).click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: /^hide$/i }).click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  test('410 from the API switches to the "Link expired" view', async ({ page }) => {
    await page.route('**/v1/auth/password-reset-complete', (route) =>
      route.fulfill({
        status: 410,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/gone', status: 410, title: 'Gone' }),
      }),
    );

    await page.goto('/auth/reset-password#access_token=stale-token&type=recovery');
    await page.getByLabel(/new password/i).fill('a-new-strong-password');
    await page.getByRole('button', { name: /^reset password$/i }).click();
    await expect(page.getByRole('heading', { name: /link expired/i })).toBeVisible();
  });

  test('400 from the API surfaces the validation message', async ({ page }) => {
    await page.route('**/v1/auth/password-reset-complete', (route) =>
      route.fulfill({
        status: 400,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/validation', status: 400, title: 'Bad Request' }),
      }),
    );

    await page.goto('/auth/reset-password#access_token=any-token&type=recovery');
    await page.getByLabel(/new password/i).fill('a-new-strong-password');
    await page.getByRole('button', { name: /^reset password$/i }).click();
    await expect(page.getByRole('alert')).toContainText(/12.*128 characters/i);
  });

  test('client-side: too-short password fires Zod validation alert', async ({ page }) => {
    await page.goto('/auth/reset-password#access_token=any-token&type=recovery');
    const pw = page.getByLabel(/new password/i);
    await pw.fill('short');
    await pw.blur();
    await expect(page.getByRole('alert')).toContainText(/12.*128 characters/i);
  });
});

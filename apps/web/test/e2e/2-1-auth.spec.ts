import { test, expect } from '@playwright/test';
import { authUser, mockLogin } from './_helpers.js';

test.describe('Story 2-1: email/password + OAuth login', () => {
  test('returning user lands on /app after email login', async ({ page }) => {
    await mockLogin(page, { isFirstLogin: false });
    await page.goto('/auth/login');
    await page.getByLabel(/^email$/i).fill('parent@example.com');
    await page.getByLabel(/^password$/i).fill('verylongpassword');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('first-login user is routed to /onboarding regardless of email path', async ({ page }) => {
    await mockLogin(page, { isFirstLogin: true });
    await page.goto('/auth/login');
    await page.getByLabel(/^email$/i).fill('parent@example.com');
    await page.getByLabel(/^password$/i).fill('verylongpassword');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test('401 from /v1/auth/login surfaces "Invalid email or password"', async ({ page }) => {
    await page.route('**/v1/auth/login', (route) =>
      route.fulfill({
        status: 401,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/unauthorized', status: 401, title: 'Unauthorized' }),
      }),
    );
    await page.goto('/auth/login');
    await page.getByLabel(/^email$/i).fill('parent@example.com');
    await page.getByLabel(/^password$/i).fill('wrongpassword12');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByRole('alert')).toContainText(/invalid email or password/i);
    await expect(page).toHaveURL(/\/auth\/login$/);
  });

  test('5xx from /v1/auth/login surfaces a generic retry message', async ({ page }) => {
    await page.route('**/v1/auth/login', (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server' }),
      }),
    );
    await page.goto('/auth/login');
    await page.getByLabel(/^email$/i).fill('parent@example.com');
    await page.getByLabel(/^password$/i).fill('verylongpassword');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByRole('alert')).toContainText(/something went wrong/i);
  });

  test('OAuth callback exchanges code → returning user lands on /app', async ({ page }) => {
    await page.route('**/v1/auth/callback', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: 'jwt-oauth-token',
          expires_in: 900,
          user: authUser(),
          is_first_login: false,
        }),
      }),
    );
    await page.goto('/auth/callback?code=oauth-code&provider=google');
    await expect(page).toHaveURL(/\/app$/);
  });

  test('OAuth callback with missing code redirects back to /auth/login', async ({ page }) => {
    await page.goto('/auth/callback?provider=google');
    await expect(page).toHaveURL(/\/auth\/login$/);
  });

  test('OAuth callback with unknown provider redirects to /auth/login', async ({ page }) => {
    await page.goto('/auth/callback?code=anything&provider=facebook');
    await expect(page).toHaveURL(/\/auth\/login$/);
  });

  test('OAuth callback failure (401) redirects back to /auth/login', async ({ page }) => {
    await page.route('**/v1/auth/callback', (route) =>
      route.fulfill({
        status: 401,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/unauthorized', status: 401, title: 'Unauthorized' }),
      }),
    );
    await page.goto('/auth/callback?code=bad&provider=apple');
    await expect(page).toHaveURL(/\/auth\/login$/);
  });
});

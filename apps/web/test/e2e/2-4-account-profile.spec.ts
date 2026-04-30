import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, userProfile } from './_helpers.js';

async function mockProfile(
  page: Page,
  overrides: Parameters<typeof userProfile>[0] = {},
) {
  const profile = userProfile(overrides);
  await page.route('**/v1/users/me', async (route, request) => {
    if (request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
    }
    if (request.method() === 'PATCH') {
      const body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...profile, ...body }),
      });
    }
    return route.continue();
  });
}

test.describe('Story 2-4: account profile management & recovery', () => {
  test('renders profile fields populated from /v1/users/me', async ({ page }) => {
    await mockProfile(page, { display_name: 'Asha Kapoor' });
    await loginAndNavigate(page, '/account');

    await expect(page.getByLabel(/display name/i)).toHaveValue('Asha Kapoor');
    await expect(page.getByText('parent@example.com')).toBeVisible();
    await expect(page.getByRole('heading', { name: /your account/i })).toBeVisible();
  });

  test('display name change is persisted via PATCH /v1/users/me', async ({ page }) => {
    await mockProfile(page);
    let patched: Record<string, unknown> | null = null;
    await page.route('**/v1/users/me', async (route, request) => {
      if (request.method() === 'GET') {
        return route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(userProfile()),
        });
      }
      if (request.method() === 'PATCH') {
        patched = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
        return route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(userProfile({ display_name: patched.display_name as string })),
        });
      }
      return route.continue();
    });

    await loginAndNavigate(page, '/account');
    await page.getByLabel(/display name/i).fill('Maya');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect.poll(() => patched).not.toBeNull();
    expect(patched).toEqual({ display_name: 'Maya' });
  });

  test('409 on email change shows "already in use" and resets the email field', async ({ page }) => {
    await page.route('**/v1/users/me', async (route, request) => {
      if (request.method() === 'GET') {
        return route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(userProfile()),
        });
      }
      if (request.method() === 'PATCH') {
        return route.fulfill({
          status: 409,
          headers: { 'Content-Type': 'application/problem+json' },
          body: JSON.stringify({ type: '/errors/conflict', status: 409, title: 'Conflict' }),
        });
      }
      return route.continue();
    });

    await loginAndNavigate(page, '/account');
    await page.getByRole('button', { name: /change email/i }).click();
    await page.getByLabel(/^email$/i).fill('taken@example.com');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByRole('alert')).toContainText(/already in use/i);
    // Email editor collapses back to display mode showing the original email
    await expect(page.getByText('parent@example.com')).toBeVisible();
  });

  test('password reset button posts to /v1/auth/password-reset and shows confirmation', async ({ page }) => {
    await mockProfile(page);
    let resetCalled = false;
    await page.route('**/v1/auth/password-reset', (route) => {
      resetCalled = true;
      return route.fulfill({ status: 204, body: '' });
    });

    await loginAndNavigate(page, '/account');
    await page.getByRole('button', { name: /send password reset email/i }).click();
    await expect(page.getByRole('button', { name: /check your inbox/i })).toBeDisabled();
    expect(resetCalled).toBe(true);
  });

  test('password reset section is hidden for OAuth-only accounts', async ({ page }) => {
    await mockProfile(page, { auth_providers: ['google'] });
    await loginAndNavigate(page, '/account');
    await expect(page.getByRole('button', { name: /send password reset email/i })).toHaveCount(0);
    await expect(page.getByText(/account is managed at google/i)).toBeVisible();
  });

  test('notification preference toggle PATCHes /v1/users/me/notifications', async ({ page }) => {
    let notifBody: Record<string, unknown> | null = null;
    await page.route('**/v1/users/me', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile()),
      }),
    );
    await page.route('**/v1/users/me/notifications', async (route, request) => {
      notifBody = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          userProfile({
            notification_prefs: { weekly_plan_ready: false, grocery_list_ready: true },
          }),
        ),
      });
    });

    await loginAndNavigate(page, '/account');
    await page.getByRole('checkbox', { name: /weekly plan is ready/i }).uncheck();
    await expect.poll(() => notifBody).not.toBeNull();
    expect(notifBody).toEqual({ weekly_plan_ready: false });
  });

  test('cultural language change is persisted, then disabled (cannot revert)', async ({ page }) => {
    let culturalBody: Record<string, unknown> | null = null;
    await page.route('**/v1/users/me', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile()),
      }),
    );
    await page.route('**/v1/users/me/preferences', async (route, request) => {
      culturalBody = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile({ cultural_language: 'south_asian' })),
      });
    });

    await loginAndNavigate(page, '/account');
    await page.getByLabel(/family language/i).selectOption('south_asian');
    await expect.poll(() => culturalBody).not.toBeNull();
    expect(culturalBody).toEqual({ cultural_language: 'south_asian' });
    await expect(
      page.getByText(/family language cannot be changed back once set/i),
    ).toBeVisible();
  });
});

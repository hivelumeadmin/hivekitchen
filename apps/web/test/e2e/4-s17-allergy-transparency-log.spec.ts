import { test, expect, type Page } from '@playwright/test';
import {
  loginAndNavigate,
  mockLogin,
  userProfile,
  authUser,
  SAMPLE_HOUSEHOLD_ID,
} from './_helpers.js';

const SAMPLE_LOG = {
  household_id: SAMPLE_HOUSEHOLD_ID,
  exported_at: '2026-06-03T00:00:00.000Z',
  event_count: 1,
  events: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      timestamp: '2026-06-01T10:00:00.000Z',
      event_type: 'allergy.guardrail_rejection',
      label: 'Plan blocked due to allergen conflict',
      detail: 'peanut',
    },
  ],
};

// Matches the pattern used by the existing passing 2-4-account-profile tests:
// async handler + method check + route.continue() fallthrough.
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

test.describe('4-S17: Allergy Transparency Log Export', () => {
  test('allergy safety log section is visible for primary_parent', async ({ page }) => {
    await mockProfile(page, 'primary_parent');
    await loginAndNavigate(page, '/account');

    // Wait for the profile to load first (confirms page reached ready state).
    await expect(page.getByRole('heading', { name: /your account/i })).toBeVisible();
    await expect(page.getByText('Allergy safety log')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download JSON' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();
  });

  test('allergy safety log section is hidden for guest_author', async ({ page }) => {
    await mockProfile(page, 'guest_author');
    await mockLogin(page, { user: authUser({ role: 'guest_author' }) });
    await page.goto('/auth/login?next=/account');
    await page.getByLabel('Email Address', { exact: true }).fill('parent@example.com');
    await page.getByLabel('Password', { exact: true }).fill('verylongpassword');
    await page.getByRole('button', { name: /enter kitchen/i }).click();
    await page.waitForURL(/\/account/);

    // Profile loads (heading visible) but allergy section is not rendered.
    await expect(page.getByRole('heading', { name: /your account/i })).toBeVisible();
    await expect(page.getByText('Allergy safety log')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Download JSON' })).toHaveCount(0);
  });

  test('Download JSON button POSTs { format: "json" } to transparency-log endpoint', async ({ page }) => {
    await mockProfile(page);
    let capturedBody: Record<string, unknown> | null = null;
    await page.route('**/v1/heart-notes/transparency-log', async (route, request) => {
      capturedBody = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(SAMPLE_LOG),
      });
    });

    await loginAndNavigate(page, '/account');
    await expect(page.getByRole('button', { name: 'Download JSON' })).toBeVisible();
    await page.getByRole('button', { name: 'Download JSON' }).click();

    await expect.poll(() => capturedBody).not.toBeNull();
    expect(capturedBody).toEqual({ format: 'json' });
  });

  test('Download PDF button POSTs { format: "pdf" } to transparency-log endpoint', async ({ page }) => {
    await mockProfile(page);
    let capturedBody: Record<string, unknown> | null = null;
    await page.route('**/v1/heart-notes/transparency-log', async (route, request) => {
      capturedBody = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="allergy-log-2026-06-03.pdf"',
        },
        body: Buffer.from('%PDF-1.4 mock'),
      });
    });

    await loginAndNavigate(page, '/account');
    await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();
    await page.getByRole('button', { name: 'Download PDF' }).click();

    await expect.poll(() => capturedBody).not.toBeNull();
    expect(capturedBody).toEqual({ format: 'pdf' });
  });

  test('button shows "Preparing…" while download is in-flight and returns to original label after', async ({ page }) => {
    await mockProfile(page);
    let resolveRoute!: () => void;
    const pendingRoute = new Promise<void>((resolve) => {
      resolveRoute = resolve;
    });
    await page.route('**/v1/heart-notes/transparency-log', async (route) => {
      await pendingRoute;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(SAMPLE_LOG),
      });
    });

    await loginAndNavigate(page, '/account');
    await expect(page.getByRole('button', { name: 'Download JSON' })).toBeVisible();
    await page.getByRole('button', { name: 'Download JSON' }).click();

    await expect(page.getByRole('button', { name: 'Preparing…' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download PDF' })).toBeDisabled();

    resolveRoute();

    await expect(page.getByRole('button', { name: 'Download JSON' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download JSON' })).not.toBeDisabled();
  });

  test('error alert shown when transparency-log endpoint returns 500', async ({ page }) => {
    await mockProfile(page);
    await page.route('**/v1/heart-notes/transparency-log', async (route) =>
      route.fulfill({ status: 500, body: 'Internal Server Error' }),
    );

    await loginAndNavigate(page, '/account');
    await expect(page.getByRole('button', { name: 'Download JSON' })).toBeVisible();
    await page.getByRole('button', { name: 'Download JSON' }).click();

    await expect(page.getByRole('alert')).toContainText(/could not download/i);
    await expect(page.getByRole('button', { name: 'Download JSON' })).not.toBeDisabled();
  });

  test('allergy safety log section is visible for secondary_caregiver', async ({ page }) => {
    await mockProfile(page, 'secondary_caregiver');
    await mockLogin(page, { user: authUser({ role: 'secondary_caregiver' }) });
    await page.goto('/auth/login?next=/account');
    await page.getByLabel('Email Address', { exact: true }).fill('parent@example.com');
    await page.getByLabel('Password', { exact: true }).fill('verylongpassword');
    await page.getByRole('button', { name: /enter kitchen/i }).click();
    await page.waitForURL(/\/account/);

    await expect(page.getByRole('heading', { name: /your account/i })).toBeVisible();
    await expect(page.getByText('Allergy safety log')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download JSON' })).toBeVisible();
  });
});

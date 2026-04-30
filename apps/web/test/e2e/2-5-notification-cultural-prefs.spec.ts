import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, userProfile } from './_helpers.js';

/**
 * Story 2-5 covers notification preferences and the cultural language ratchet.
 * The wired UI lives on the account page; this spec focuses on the
 * story-specific contracts (separate endpoints, optimistic UI, irreversibility)
 * rather than re-asserting the page-level CRUD covered by the 2-4 spec.
 */

async function mockProfileGet(
  page: Page,
  overrides: Parameters<typeof userProfile>[0] = {},
) {
  await page.route('**/v1/users/me', (route, request) => {
    if (request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile(overrides)),
      });
    }
    return route.fallback();
  });
}

test.describe('Story 2-5: notification preferences + cultural language ratchet', () => {
  test('notification toggle hits the dedicated /notifications endpoint, not /users/me', async ({
    page,
  }) => {
    await mockProfileGet(page);
    let notifEndpointCalled = false;
    let usersMePatchCalled = false;
    await page.route('**/v1/users/me/notifications', (route) => {
      notifEndpointCalled = true;
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
    await page.route('**/v1/users/me', (route, request) => {
      if (request.method() === 'PATCH') {
        usersMePatchCalled = true;
      }
      return route.fallback();
    });

    await loginAndNavigate(page, '/account');
    await page.getByRole('checkbox', { name: /weekly plan is ready/i }).uncheck();
    await expect.poll(() => notifEndpointCalled).toBe(true);
    expect(usersMePatchCalled).toBe(false);
  });

  test('failed notification toggle reverts the optimistic UI and surfaces an error', async ({
    page,
  }) => {
    await mockProfileGet(page);
    await page.route('**/v1/users/me/notifications', (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server' }),
      }),
    );

    await loginAndNavigate(page, '/account');
    const checkbox = page.getByRole('checkbox', { name: /weekly plan is ready/i });
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect(page.getByRole('alert')).toContainText(/could not update notification/i);
    // Optimistic UI rolled back to the prior server-truth value.
    await expect(checkbox).toBeChecked();
  });

  test('cultural language change is locked-once-set (default option disabled afterwards)', async ({
    page,
  }) => {
    await mockProfileGet(page);
    await page.route('**/v1/users/me/preferences', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile({ cultural_language: 'south_asian' })),
      }),
    );

    await loginAndNavigate(page, '/account');
    const select = page.getByLabel(/family language/i);
    await select.selectOption('south_asian');
    await expect(page.getByText(/cannot be changed back once set/i)).toBeVisible();
    // The "default" option is now disabled — re-selecting it is impossible.
    const defaultOption = select.locator('option[value="default"]');
    await expect(defaultOption).toBeDisabled();
  });

  test('409 from cultural language change reverts the select and surfaces "cannot be changed back"', async ({
    page,
  }) => {
    await mockProfileGet(page, { cultural_language: 'hispanic' });
    await page.route('**/v1/users/me/preferences', (route) =>
      route.fulfill({
        status: 409,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/conflict', status: 409, title: 'Conflict' }),
      }),
    );

    await loginAndNavigate(page, '/account');
    const select = page.getByLabel(/family language/i);
    await expect(select).toHaveValue('hispanic');
    // Try to switch — server says no.
    await select.selectOption('east_asian');
    await expect(page.getByRole('alert')).toContainText(/cannot be changed back/i);
    // Optimistic UI rolled back.
    await expect(select).toHaveValue('hispanic');
  });

  test('all seven cultural language options are present in the select', async ({ page }) => {
    await mockProfileGet(page);
    await loginAndNavigate(page, '/account');
    const select = page.getByLabel(/family language/i);
    const options = await select.locator('option').allTextContents();
    expect(options).toHaveLength(7);
    expect(options.join('\n')).toMatch(/english/i);
    expect(options.join('\n')).toMatch(/south asian/i);
    expect(options.join('\n')).toMatch(/spanish/i);
    expect(options.join('\n')).toMatch(/swahili/i);
    expect(options.join('\n')).toMatch(/teta|jiddo|middle eastern/i);
    expect(options.join('\n')).toMatch(/east asian/i);
    expect(options.join('\n')).toMatch(/caribbean/i);
  });
});

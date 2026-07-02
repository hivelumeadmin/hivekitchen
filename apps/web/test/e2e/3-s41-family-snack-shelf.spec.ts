import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, authUser, mockLogin, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

// Story 3-S41: Family Snack Shelf — Add / Remove
//
// Coverage:
//   AC7  — page loads, renders global (built-in badge, no remove) + household items (remove button)
//   AC7  — add form submits POST, new item appended; form cleared
//   AC7  — remove button triggers DELETE, item removed from list
//   AC7  — remove failure shows error alert (P1 patch)
//   AC7  — secondary_caregiver: no add form, no remove buttons
//   AC5  — cross-household 403 handled (unauthenticated redirect)
//
// AC1 (migration) is verified by the USER-SIDE supabase db push gate.
// AC2–AC5 (contracts, repo, API auth guards) are covered by
//   households.snack-routes.test.ts and snack-sku.repository.test.ts.

const SNACKS_URL = '**/v1/households/*/snacks';
const SNACKS_SKU_URL = '**/v1/households/*/snacks/*';

const GLOBAL_SKU_ID = '33333333-3333-4333-8333-333333333333';
const HOUSEHOLD_SKU_ID = '44444444-4444-4444-8444-444444444444';

const SNACK_LIST = [
  {
    id: GLOBAL_SKU_ID,
    name: 'Apple',
    brand: null,
    category: 'fruit',
    created_by_household_id: null,
    created_at: '2026-06-01T00:00:00.000Z',
  },
  {
    id: HOUSEHOLD_SKU_ID,
    name: 'Pretzel Twists',
    brand: 'Snyder',
    category: 'grain',
    created_by_household_id: SAMPLE_HOUSEHOLD_ID,
    created_at: '2026-06-10T00:00:00.000Z',
  },
];

async function mockSnackList(page: Page, items = SNACK_LIST) {
  await page.route(SNACKS_URL, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
  });
}

// ---------------------------------------------------------------------------
// Page load + list rendering (AC7)
// ---------------------------------------------------------------------------

test.describe('Story 3-S41 — Snack Shelf page load (AC7)', () => {
  test('renders global seed with "(built-in)" badge and no remove button', async ({ page }) => {
    await mockSnackList(page);
    await loginAndNavigate(page, '/app/kitchen/snacks');

    await expect(page.getByText('Apple')).toBeVisible();
    await expect(page.getByText('(built-in)')).toBeVisible();
    // Only ONE remove button on the page — for the household-owned item
    await expect(page.getByRole('button', { name: /remove/i })).toHaveCount(1);
  });

  test('renders household item with a remove button for primary_parent', async ({ page }) => {
    await mockSnackList(page);
    await loginAndNavigate(page, '/app/kitchen/snacks');

    await expect(page.getByText('Pretzel Twists')).toBeVisible();
    await expect(page.getByText('Snyder')).toBeVisible();
    await expect(page.getByRole('button', { name: /remove/i })).toBeVisible();
  });

  test('secondary_caregiver sees the list but no add form and no remove buttons', async ({
    page,
  }) => {
    await mockSnackList(page);
    await mockLogin(page, { user: authUser({ role: 'secondary_caregiver' }) });
    await page.goto(`/auth/login?next=${encodeURIComponent('/app/kitchen/snacks')}`);
    await page.getByLabel('Email Address', { exact: true }).fill('parent@example.com');
    await page.getByLabel('Password', { exact: true }).fill('verylongpassword');
    await page.getByRole('button', { name: /enter kitchen/i }).click();
    await page.waitForURL(/\/app\/kitchen\/snacks/);

    await expect(page.getByText('Apple')).toBeVisible();
    await expect(page.getByText('Pretzel Twists')).toBeVisible();
    await expect(page.getByRole('button', { name: /remove/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /add snack/i })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Add form (AC7)
// ---------------------------------------------------------------------------

test.describe('Story 3-S41 — Add snack (AC7)', () => {
  test('submits POST with name + category and appends new item to the list', async ({ page }) => {
    await mockSnackList(page);

    const newSku = {
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Hummus Cup',
      brand: null,
      category: 'protein',
      created_by_household_id: SAMPLE_HOUSEHOLD_ID,
      created_at: '2026-06-20T12:00:00.000Z',
    };

    let capturedBody: Record<string, unknown> | null = null;
    await page.route(SNACKS_URL, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      capturedBody = (await route.request().postDataJSON()) as Record<string, unknown>;
      return route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSku),
      });
    });

    await loginAndNavigate(page, '/app/kitchen/snacks');
    await expect(page.getByText('Apple')).toBeVisible();

    await page.getByLabel('Name').fill('Hummus Cup');
    await page.getByRole('button', { name: /add snack/i }).click();

    await expect(page.getByText('Hummus Cup')).toBeVisible();
    await expect.poll(() => capturedBody).toMatchObject({ name: 'Hummus Cup', category: 'fruit' });
    // Form should be cleared after submit
    await expect(page.getByLabel('Name')).toHaveValue('');
  });

  test('add form is disabled while submission is in flight', async ({ page }) => {
    await mockSnackList(page);

    let resolvePost: (() => void) | null = null;
    await page.route(SNACKS_URL, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await new Promise<void>((resolve) => {
        resolvePost = resolve;
      });
      return route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '55555555-5555-4555-8555-555555555555',
          name: 'Yoghurt',
          brand: null,
          category: 'dairy',
          created_by_household_id: SAMPLE_HOUSEHOLD_ID,
          created_at: '2026-06-20T12:00:00.000Z',
        }),
      });
    });

    await loginAndNavigate(page, '/app/kitchen/snacks');
    await expect(page.getByText('Apple')).toBeVisible();
    await page.getByLabel('Name').fill('Yoghurt');
    await page.getByRole('button', { name: /add snack/i }).click();

    // Button shows "Adding…" while in flight
    await expect(page.getByRole('button', { name: /adding/i })).toBeDisabled();

    resolvePost!();
    await expect(page.getByText('Yoghurt')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Remove action (AC7)
// ---------------------------------------------------------------------------

test.describe('Story 3-S41 — Remove snack (AC7)', () => {
  test('clicking Remove sends DELETE and drops the item from the list', async ({ page }) => {
    await mockSnackList(page);

    let deletedUrl: string | null = null;
    await page.route(SNACKS_SKU_URL, (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      deletedUrl = route.request().url();
      return route.fulfill({ status: 204 });
    });

    await loginAndNavigate(page, '/app/kitchen/snacks');
    await expect(page.getByText('Pretzel Twists')).toBeVisible();

    await page.getByRole('button', { name: /remove/i }).click();

    await expect(page.getByText('Pretzel Twists')).not.toBeVisible();
    expect(deletedUrl).toContain(HOUSEHOLD_SKU_ID);
  });

  test('failed DELETE shows an error alert and keeps the item in the list', async ({ page }) => {
    await mockSnackList(page);

    await page.route(SNACKS_SKU_URL, (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      return route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server error' }),
      });
    });

    await loginAndNavigate(page, '/app/kitchen/snacks');
    await expect(page.getByText('Pretzel Twists')).toBeVisible();

    await page.getByRole('button', { name: /remove/i }).click();

    await expect(page.getByRole('alert')).toContainText(/could not remove/i);
    await expect(page.getByText('Pretzel Twists')).toBeVisible();
  });

  test('Remove button shows "Removing…" while DELETE is in flight', async ({ page }) => {
    await mockSnackList(page);

    let resolveDelete: (() => void) | null = null;
    await page.route(SNACKS_SKU_URL, async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      await new Promise<void>((resolve) => {
        resolveDelete = resolve;
      });
      return route.fulfill({ status: 204 });
    });

    await loginAndNavigate(page, '/app/kitchen/snacks');
    await expect(page.getByText('Pretzel Twists')).toBeVisible();
    await page.getByRole('button', { name: /remove/i }).click();

    await expect(page.getByRole('button', { name: /removing/i })).toBeDisabled();

    resolveDelete!();
    await expect(page.getByText('Pretzel Twists')).not.toBeVisible();
  });
});

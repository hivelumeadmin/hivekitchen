import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, userProfile, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

// ------------------------------------------------------------------
// Story 3-21: Extra-Rules Pin/Ban + Extra Library — E2E spec
//
// Page under test:  /app/children/:childId/extra-rules
// API under test:   GET   /v1/children/:id/extra-rules
//                   PATCH /v1/children/:id/extra-rules
//                   GET   /v1/households/:id/extra-library
//                   POST  /v1/households/:id/extra-library
// ------------------------------------------------------------------

const SAMPLE_CHILD_ID = '44444444-4444-4444-8444-444444444444';
const CHILD_NAME = 'Maya';
const PAGE_URL = `/app/children/${SAMPLE_CHILD_ID}/extra-rules?name=${encodeURIComponent(CHILD_NAME)}`;

// ------------------------------------------------------------------
// Fixture builders
// ------------------------------------------------------------------

function extraRulesBody(pins: string[] = [], bans: string[] = []) {
  return {
    child_id: SAMPLE_CHILD_ID,
    extra_rules: { pins, bans },
  };
}

function updateExtraRulesResponse(pins: string[] = [], bans: string[] = []) {
  return {
    child_id: SAMPLE_CHILD_ID,
    extra_rules: { pins, bans },
    updated_at: '2026-05-07T12:00:00.000Z',
  };
}

function libraryItem(overrides: { id?: string; name?: string; component_type?: string; is_allergen_free?: boolean } = {}) {
  return {
    id: overrides.id ?? '99999999-9999-4999-8999-999999999999',
    household_id: SAMPLE_HOUSEHOLD_ID,
    name: overrides.name ?? 'homemade oat bar',
    description: null,
    component_type: overrides.component_type ?? 'grain',
    is_allergen_free: overrides.is_allergen_free ?? false,
    archived_at: null,
    created_by: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-05-01T10:00:00.000Z',
    updated_at: '2026-05-01T10:00:00.000Z',
  };
}

function libraryListBody(items: ReturnType<typeof libraryItem>[] = []) {
  return { items };
}

// ------------------------------------------------------------------
// Common setup
// ------------------------------------------------------------------

async function reachExtraRulesPage(
  page: Page,
  opts: {
    pins?: string[];
    bans?: string[];
    libraryItems?: ReturnType<typeof libraryItem>[];
  } = {},
) {
  await page.route('**/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userProfile()),
    }),
  );
  await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: null }),
    }),
  );
  await page.route(`**/v1/children/${SAMPLE_CHILD_ID}/extra-rules`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(extraRulesBody(opts.pins ?? [], opts.bans ?? [])),
    });
  });
  await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/extra-library`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(libraryListBody(opts.libraryItems ?? [])),
    });
  });
  await loginAndNavigate(page, PAGE_URL);
}

// ------------------------------------------------------------------
// Tests — pin/ban pre-population and save
// ------------------------------------------------------------------

test.describe('Story 3-21: extra rules page — pins and bans', () => {
  test('pre-populates checked pins and bans from GET extra-rules', async ({ page }) => {
    await reachExtraRulesPage(page, { pins: ['fruit', 'dairy'], bans: ['sweet treat'] });

    await expect(
      page.getByRole('heading', { name: new RegExp(`${CHILD_NAME}.s Extra slot`, 'i') }),
    ).toBeVisible();

    // Pins section
    await expect(page.getByRole('checkbox', { name: /^fruit$/i }).first()).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /^dairy$/i }).first()).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /^grain$/i }).first()).not.toBeChecked();

    // Bans section — "sweet treat" should be checked in the bans fieldset
    const banCheckboxes = page.getByRole('checkbox', { name: /^sweet treat$/i });
    await expect(banCheckboxes.nth(1)).toBeChecked();
  });

  test('toggling a pin on and saving PATCHes correct body and shows save confirmation', async ({
    page,
  }) => {
    let patchBody: Record<string, unknown> | null = null;

    await reachExtraRulesPage(page, { pins: [], bans: [] });

    await page.route(`**/v1/children/${SAMPLE_CHILD_ID}/extra-rules`, (route, request) => {
      if (request.method() !== 'PATCH') return route.fallback();
      patchBody = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateExtraRulesResponse(['fruit'], [])),
      });
    });

    // Check the fruit pin checkbox (first one, inside the Pins fieldset)
    await page.getByRole('checkbox', { name: /^fruit$/i }).first().check();
    await page.getByRole('button', { name: /save rules/i }).click();

    await expect(page.getByRole('status')).toContainText(/saved.*lumi will use these/i);
    expect(patchBody).toEqual({ pins: ['fruit'], bans: [] });
  });

  test('"Save rules" shows "Saving…" and is disabled while PATCH is in-flight', async ({
    page,
  }) => {
    let resolvePatch: (() => void) | null = null;

    await reachExtraRulesPage(page);

    await page.route(`**/v1/children/${SAMPLE_CHILD_ID}/extra-rules`, (route, request) => {
      if (request.method() !== 'PATCH') return route.fallback();
      resolvePatch = () =>
        void route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateExtraRulesResponse()),
        });
    });

    await page.getByRole('button', { name: /save rules/i }).click();
    await expect(page.getByRole('button', { name: /saving/i })).toBeDisabled();

    resolvePatch?.();
  });

  test('5xx PATCH shows error in save status area; controls remain usable', async ({ page }) => {
    await reachExtraRulesPage(page);

    await page.route(`**/v1/children/${SAMPLE_CHILD_ID}/extra-rules`, (route, request) => {
      if (request.method() !== 'PATCH') return route.fallback();
      return route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server error' }),
      });
    });

    await page.getByRole('button', { name: /save rules/i }).click();

    await expect(page.getByRole('status')).toContainText(/couldn.t save extra rules/i);
    // Controls still rendered for retry
    await expect(page.getByRole('button', { name: /save rules/i })).toBeEnabled();
  });

  test('GET extra-rules failure surfaces an error alert; form is not rendered', async ({
    page,
  }) => {
    await page.route('**/v1/users/me', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile()),
      }),
    );
    await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: null }),
      }),
    );
    await page.route(`**/v1/children/${SAMPLE_CHILD_ID}/extra-rules`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server error' }),
      });
    });

    await loginAndNavigate(page, PAGE_URL);

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: /save rules/i })).toHaveCount(0);
  });
});

// ------------------------------------------------------------------
// Tests — Extra library
// ------------------------------------------------------------------

test.describe('Story 3-21: extra rules page — Extra library', () => {
  test('existing library items are listed on load', async ({ page }) => {
    await reachExtraRulesPage(page, {
      libraryItems: [
        libraryItem({ name: 'homemade oat bar', component_type: 'grain' }),
        libraryItem({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'apple slices', component_type: 'fruit' }),
      ],
    });

    await expect(page.getByText('homemade oat bar')).toBeVisible();
    await expect(page.getByText('apple slices')).toBeVisible();
  });

  test('"Add to library" is disabled when the name input is empty', async ({ page }) => {
    await reachExtraRulesPage(page);

    await expect(page.getByRole('button', { name: /add to library/i })).toBeDisabled();
  });

  test('adding a custom Extra POSTs correct body and appends item to list', async ({ page }) => {
    let postBody: Record<string, unknown> | null = null;
    const newItem = libraryItem({ name: 'homemade oat bar', component_type: 'grain', is_allergen_free: true });

    await reachExtraRulesPage(page);

    await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/extra-library`, (route, request) => {
      if (request.method() !== 'POST') return route.fallback();
      postBody = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newItem),
      });
    });

    await page.getByLabel(/add a custom extra/i).fill('homemade oat bar');
    await page.getByLabel(/component type/i).selectOption('grain');
    await page.getByLabel(/allergen.free/i).check();
    await page.getByRole('button', { name: /add to library/i }).click();

    await expect(page.getByRole('status')).toContainText(/added to your extra library/i);
    await expect(page.getByText('homemade oat bar')).toBeVisible();
    expect(postBody).toEqual({
      name: 'homemade oat bar',
      component_type: 'grain',
      is_allergen_free: true,
    });
  });

  test('after successful add the name input is cleared', async ({ page }) => {
    await reachExtraRulesPage(page);

    await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/extra-library`, (route, request) => {
      if (request.method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(libraryItem({ name: 'trail mix' })),
      });
    });

    await page.getByLabel(/add a custom extra/i).fill('trail mix');
    await page.getByRole('button', { name: /add to library/i }).click();

    await expect(page.getByLabel(/add a custom extra/i)).toHaveValue('');
  });

  test('5xx POST shows error in add status area; name input retains value', async ({ page }) => {
    await reachExtraRulesPage(page);

    await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/extra-library`, (route, request) => {
      if (request.method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server error' }),
      });
    });

    await page.getByLabel(/add a custom extra/i).fill('mystery item');
    await page.getByRole('button', { name: /add to library/i }).click();

    await expect(page.getByRole('status')).toContainText(/couldn.t save the new extra item/i);
    await expect(page.getByLabel(/add a custom extra/i)).toHaveValue('mystery item');
  });

  test('GET extra-library failure surfaces loadError inside the form', async ({ page }) => {
    await page.route('**/v1/users/me', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile()),
      }),
    );
    await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: null }),
      }),
    );
    await page.route(`**/v1/children/${SAMPLE_CHILD_ID}/extra-rules`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extraRulesBody()),
      });
    });
    await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/extra-library`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server error' }),
      });
    });

    await loginAndNavigate(page, PAGE_URL);

    await expect(page.getByRole('alert')).toContainText(/couldn.t load extra library/i);
    // Page-level heading still renders — the error is scoped to the library section
    await expect(
      page.getByRole('heading', { name: new RegExp(`${CHILD_NAME}.s Extra slot`, 'i') }),
    ).toBeVisible();
  });
});

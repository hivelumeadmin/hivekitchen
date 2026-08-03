import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, userProfile, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

// ------------------------------------------------------------------
// Story 3-20: Bag Composition Settings Page — E2E spec
//
// Page under test:  /app/children/:childId/bag-composition
// API under test:   GET  /v1/households/:hh/children/:childId
//                   PATCH /v1/children/:id/bag-composition
//
// Also covers the DN6 cross-link added to SchoolPoliciesForm:
//   Page under test: /app/children/:childId/school-policies?name=...
// ------------------------------------------------------------------

const SAMPLE_CHILD_ID = '44444444-4444-4444-8444-444444444444';
const CHILD_NAME = 'Maya';
const PAGE_URL = `/app/children/${SAMPLE_CHILD_ID}/bag-composition`;

// ------------------------------------------------------------------
// Fixture builders
// ------------------------------------------------------------------

function childBody(opts: { snack: boolean; extra: boolean } = { snack: true, extra: true }) {
  return {
    child: {
      id: SAMPLE_CHILD_ID,
      household_id: SAMPLE_HOUSEHOLD_ID,
      name: CHILD_NAME,
      age_band: 'child',
      declared_allergens: [],
      cultural_identifiers: [],
      dietary_preferences: [],
      // Story 3-DM-B1: schema now uses bag_composition_pattern enum + the
      // three variation enums; bag_composition jsonb + allergen_rule_version
      // dropped.
      appetite_level: 'normal',
      texture_needs: 'normal',
      spice_tolerance: 'mild',
      bag_composition_pattern: opts.snack
        ? opts.extra
          ? 'main_plus_snack_plus_extra'
          : 'main_plus_snack'
        : opts.extra
          ? 'main_plus_extra'
          : 'main_only',
      created_at: '2026-04-28T10:00:00.000Z',
    },
  };
}

// ------------------------------------------------------------------
// Common setup
// ------------------------------------------------------------------

async function reachBagCompositionPage(
  page: Page,
  opts: { snack?: boolean; extra?: boolean } = {},
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
  await page.route(
    `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/children/${SAMPLE_CHILD_ID}`,
    (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(childBody({ snack: opts.snack ?? true, extra: opts.extra ?? true })),
      }),
  );
  await loginAndNavigate(page, PAGE_URL);
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

test.describe('Story 3-20: bag composition settings page', () => {
  test('pre-populates Snack and Extra from child GET; Main is always locked', async ({ page }) => {
    await reachBagCompositionPage(page, { snack: false, extra: true });

    await expect(
      page.getByRole('heading', { name: new RegExp(`${CHILD_NAME}.s lunch bag`, 'i') }),
    ).toBeVisible();
    await expect(page.getByLabel(/^snack/i)).not.toBeChecked();
    await expect(page.getByLabel(/^extra/i)).toBeChecked();
    await expect(page.getByText('Locked')).toBeVisible();
    await expect(page.getByRole('button', { name: /save changes/i })).toBeEnabled();
  });

  test('toggling Snack on and saving PATCHes { snack: true, extra: true } and shows confirmation', async ({
    page,
  }) => {
    let patchBody: Record<string, unknown> | null = null;

    await reachBagCompositionPage(page, { snack: false, extra: true });

    await page.route(`**/v1/children/${SAMPLE_CHILD_ID}/bag-composition`, (route, request) => {
      patchBody = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(childBody({ snack: true, extra: true })),
      });
    });

    await page.getByLabel(/^snack/i).check();
    await page.getByRole('button', { name: /save changes/i }).click();

    // Epic 13 — LumiWhisper mounts an always-present sr-only role=status live
    // region at the app root; filter to the save-status element to avoid a
    // strict-mode violation.
    await expect(
      page.getByRole('status').filter({ hasText: /saved.*lumi will use this composition/i }),
    ).toBeVisible();
    expect(patchBody).toEqual({ snack: true, extra: true });
  });

  test('Save shows "Saving…" and is disabled while PATCH is in-flight', async ({ page }) => {
    let resolvePatch: (() => void) | null = null;

    await reachBagCompositionPage(page);

    await page.route(`**/v1/children/${SAMPLE_CHILD_ID}/bag-composition`, (route) => {
      resolvePatch = () =>
        void route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(childBody()),
        });
    });

    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByRole('button', { name: /saving/i })).toBeDisabled();

    resolvePatch?.();
  });

  test('5xx PATCH renders error alert; composition controls stay visible for retry', async ({
    page,
  }) => {
    await reachBagCompositionPage(page);

    await page.route(`**/v1/children/${SAMPLE_CHILD_ID}/bag-composition`, (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server error' }),
      }),
    );

    await page.getByRole('button', { name: /save changes/i }).click();

    await expect(page.getByRole('alert')).toContainText(/couldn.t save bag preferences/i);
    await expect(page.getByLabel(/^snack/i)).toBeVisible();
    await expect(page.getByLabel(/^extra/i)).toBeVisible();
  });

  test('child GET failure surfaces error alert; no composition form controls rendered', async ({
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
    await page.route(
      `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/children/${SAMPLE_CHILD_ID}`,
      (route) =>
        route.fulfill({
          status: 404,
          headers: { 'Content-Type': 'application/problem+json' },
          body: JSON.stringify({ type: '/errors/not-found', status: 404, title: 'Not Found' }),
        }),
    );

    await loginAndNavigate(page, PAGE_URL);

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByLabel(/^snack/i)).toHaveCount(0);
    await expect(page.getByLabel(/^extra/i)).toHaveCount(0);
  });
});

test.describe('Story 3-20: bag composition cross-link from school policies page (DN6)', () => {
  test('school policies page shows a link to the bag composition settings page', async ({ page }) => {
    const POLICIES_URL = `/app/children/${SAMPLE_CHILD_ID}/school-policies?name=${encodeURIComponent(CHILD_NAME)}`;

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
    await page.route(`**/v1/children/${SAMPLE_CHILD_ID}/school-policies`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policies: [] }),
      });
    });

    await loginAndNavigate(page, POLICIES_URL);

    const link = page.getByRole('link', {
      name: new RegExp(`edit ${CHILD_NAME}.s bag composition`, 'i'),
    });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      'href',
      new RegExp(`/app/children/${SAMPLE_CHILD_ID}/bag-composition`),
    );
  });
});

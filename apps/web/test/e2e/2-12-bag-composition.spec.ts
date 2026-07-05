import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, userProfile, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

const SAMPLE_CHILD_ID = '44444444-4444-4444-8444-444444444444';
const CHILD_NAME = 'Maya';

// Epic 13-s5 removed the post-add-child BagCompositionCard flow (the "Add your
// first child" CTA and AddChildForm are gone — children are created during
// Lumi onboarding). The live surface for per-child bag slot declaration is the
// settings-style BagCompositionForm mounted at
// /app/children/:childId/bag-composition (story 3.20), which writes through
// the same PATCH /v1/children/:id/bag-composition endpoint from story 2.12.
// These tests exercise that surface.

// Story 3-DM-B1: ChildResponseSchema replaced bag_composition jsonb +
// allergen_rule_version with bag_composition_pattern enum + the three
// variation enums. Accept the legacy (main, snack, extra) call-site shape and
// fold it into the new pattern so spec call-sites stay unchanged.
function childResponse(
  bag_composition: { main: true; snack: boolean; extra: boolean } = {
    main: true,
    snack: true,
    extra: true,
  },
) {
  const pattern = bag_composition.snack
    ? bag_composition.extra
      ? 'main_plus_snack_plus_extra'
      : 'main_plus_snack'
    : bag_composition.extra
      ? 'main_plus_extra'
      : 'main_only';
  return {
    id: SAMPLE_CHILD_ID,
    household_id: SAMPLE_HOUSEHOLD_ID,
    name: CHILD_NAME,
    age_band: 'child',
    school_policy_notes: null,
    declared_allergens: [],
    cultural_identifiers: [],
    dietary_preferences: [],
    appetite_level: 'normal',
    texture_needs: 'normal',
    spice_tolerance: 'mild',
    bag_composition_pattern: pattern,
    created_at: '2026-04-29T10:00:00.000Z',
  };
}

async function reachBagCompositionForm(page: Page) {
  await page.route('**/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userProfile()), // factory has prior ack
    }),
  );
  // ChildBagCompositionPage loads the child via
  // GET /v1/households/{householdId}/children/{childId} on mount.
  await page.route(`**/v1/households/*/children/${SAMPLE_CHILD_ID}`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ child: childResponse() }),
    }),
  );

  await loginAndNavigate(page, `/app/children/${SAMPLE_CHILD_ID}/bag-composition`);
  await expect(
    page.getByRole('heading', { name: new RegExp(`${CHILD_NAME}.s lunch bag`, 'i') }),
  ).toBeVisible();
}

test.describe('Story 2-12: per-child lunch-bag slot declaration', () => {
  test('form mounts with Main locked, Snack on, and Extra on from the loaded pattern', async ({
    page,
  }) => {
    await reachBagCompositionForm(page);
    await expect(page.getByText('Main', { exact: true })).toBeVisible();
    await expect(page.getByText('Always included')).toBeVisible();
    // Locked badge — non-interactive but accessible to screen readers.
    await expect(page.getByText('Locked')).toBeVisible();
    await expect(page.getByLabel(/^snack/i)).toBeChecked();
    await expect(page.getByLabel(/^extra/i)).toBeChecked();
  });

  test('Save with snack off + extra on PATCHes the bag-composition endpoint with no `main` key', async ({
    page,
  }) => {
    let patchedBody: Record<string, unknown> | null = null;
    let patchedUrl = '';
    await page.route(`**/v1/children/*/bag-composition`, (route, request) => {
      patchedUrl = request.url();
      patchedBody = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          child: childResponse({ main: true, snack: false, extra: true }),
        }),
      });
    });

    await reachBagCompositionForm(page);
    await page.getByLabel(/^snack/i).uncheck();
    await page.getByRole('button', { name: /save changes/i }).click();

    await expect.poll(() => patchedBody).not.toBeNull();
    expect(patchedUrl).toContain(`/v1/children/${SAMPLE_CHILD_ID}/bag-composition`);
    // The hook must never put `main` on the wire — it is a server-side invariant.
    expect(patchedBody).toEqual({ snack: false, extra: true });

    // The settings form stays mounted and confirms the explicit save.
    await expect(
      page.getByText(/saved\. lumi will use this composition/i),
    ).toBeVisible();
    await expect(page.getByLabel(/^snack/i)).not.toBeChecked();
  });

  test('5xx PATCH failure surfaces a friendly error and keeps the form open', async ({ page }) => {
    await page.route(`**/v1/children/*/bag-composition`, (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server' }),
      }),
    );

    await reachBagCompositionForm(page);
    await page.getByLabel(/^snack/i).uncheck();
    await page.getByRole('button', { name: /save changes/i }).click();

    await expect(page.getByRole('alert')).toContainText(/couldn.t save bag preferences/i);
    // Form stays mounted so the user can retry without losing their toggle.
    await expect(
      page.getByRole('heading', { name: new RegExp(`${CHILD_NAME}.s lunch bag`, 'i') }),
    ).toBeVisible();
    await expect(page.getByLabel(/^snack/i)).not.toBeChecked();
  });

  test('Save and the slot toggles are disabled while a PATCH is in-flight', async ({ page }) => {
    let resolveRequest: (() => void) | null = null;
    await page.route(`**/v1/children/*/bag-composition`, (route) => {
      resolveRequest = () =>
        void route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ child: childResponse() }),
        });
    });

    await reachBagCompositionForm(page);
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByRole('button', { name: /saving/i })).toBeDisabled();
    await expect(page.getByLabel(/^snack/i)).toBeDisabled();
    await expect(page.getByLabel(/^extra/i)).toBeDisabled();
    // Drain the in-flight request so Playwright can tear the page down cleanly.
    resolveRequest?.();
  });
});

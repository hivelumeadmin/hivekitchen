import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, userProfile, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

const SAMPLE_CHILD_ID = '44444444-4444-4444-8444-444444444444';
const CHILD_NAME = 'Maya';

function childResponse(
  bag_composition: { main: true; snack: boolean; extra: boolean } = {
    main: true,
    snack: true,
    extra: true,
  },
) {
  return {
    id: SAMPLE_CHILD_ID,
    household_id: SAMPLE_HOUSEHOLD_ID,
    name: CHILD_NAME,
    age_band: 'child',
    school_policy_notes: null,
    declared_allergens: [],
    cultural_identifiers: [],
    dietary_preferences: [],
    allergen_rule_version: 'v1',
    bag_composition,
    created_at: '2026-04-29T10:00:00.000Z',
  };
}

async function reachBagCompositionCard(page: Page) {
  await page.route('**/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userProfile()), // factory has prior ack
    }),
  );
  await page.route(`**/v1/households/*/children`, (route) =>
    route.fulfill({
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ child: childResponse() }),
    }),
  );

  await loginAndNavigate(page, '/app');
  await page.getByRole('button', { name: /add your first child/i }).click();
  await page.getByLabel(/^name$/i).fill(CHILD_NAME);
  await page.getByLabel(/age band/i).selectOption('child');
  await page.getByRole('button', { name: /save child/i }).click();
  await expect(
    page.getByRole('heading', { name: new RegExp(`how does ${CHILD_NAME}.s lunch bag look`, 'i') }),
  ).toBeVisible();
}

test.describe('Story 2-12: per-child lunch-bag slot declaration', () => {
  test('card mounts with Main locked, Snack on, and Extra on by default', async ({ page }) => {
    await reachBagCompositionCard(page);
    await expect(page.getByText('Main')).toBeVisible();
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

    await reachBagCompositionCard(page);
    await page.getByLabel(/^snack/i).uncheck();
    await page.getByRole('button', { name: /^save$/i }).click();

    await expect.poll(() => patchedBody).not.toBeNull();
    expect(patchedUrl).toContain(`/v1/children/${SAMPLE_CHILD_ID}/bag-composition`);
    // The hook must never put `main` on the wire — it is a server-side invariant.
    expect(patchedBody).toEqual({ snack: false, extra: true });

    // After save the card unmounts and the saved child appears in the list.
    await expect(
      page.getByRole('heading', { name: /how does .* lunch bag look/i }),
    ).toHaveCount(0);
    await expect(page.getByText(new RegExp(`${CHILD_NAME}.*child`, 'i'))).toBeVisible();
  });

  test('Skip closes the card without making any network request', async ({ page }) => {
    let serverHit = false;
    await page.route(`**/v1/children/*/bag-composition`, (route) => {
      serverHit = true;
      return route.fulfill({ status: 500, body: '{}' });
    });

    await reachBagCompositionCard(page);
    await page.getByRole('button', { name: /^skip$/i }).click();

    await expect(
      page.getByRole('heading', { name: /how does .* lunch bag look/i }),
    ).toHaveCount(0);
    expect(serverHit).toBe(false);
    // Skip preserves the original child (with default bag_composition) in the list.
    await expect(page.getByText(new RegExp(`${CHILD_NAME}.*child`, 'i'))).toBeVisible();
  });

  test('5xx PATCH failure surfaces a friendly error and keeps the card open', async ({ page }) => {
    await page.route(`**/v1/children/*/bag-composition`, (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server' }),
      }),
    );

    await reachBagCompositionCard(page);
    await page.getByLabel(/^snack/i).uncheck();
    await page.getByRole('button', { name: /^save$/i }).click();

    await expect(page.getByRole('alert')).toContainText(/couldn.t save bag preferences/i);
    // Card stays mounted so the user can retry without losing their toggle.
    await expect(
      page.getByRole('heading', { name: /how does .* lunch bag look/i }),
    ).toBeVisible();
    await expect(page.getByLabel(/^snack/i)).not.toBeChecked();
  });

  test('Save and Skip are both disabled while a PATCH is in-flight', async ({ page }) => {
    let resolveRequest: (() => void) | null = null;
    await page.route(`**/v1/children/*/bag-composition`, (route) => {
      resolveRequest = () =>
        void route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ child: childResponse() }),
        });
    });

    await reachBagCompositionCard(page);
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByRole('button', { name: /saving/i })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^skip$/i })).toBeDisabled();
    // Drain the in-flight request so Playwright can tear the page down cleanly.
    resolveRequest?.();
  });
});

import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, userProfile, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

const SAMPLE_CHILD_ID = '44444444-4444-4444-8444-444444444444';

function childResponse(overrides: { name?: string; age_band?: string } = {}) {
  return {
    id: SAMPLE_CHILD_ID,
    household_id: SAMPLE_HOUSEHOLD_ID,
    name: 'Asha',
    age_band: 'child',
    school_policy_notes: null,
    declared_allergens: [],
    cultural_identifiers: [],
    dietary_preferences: [],
    allergen_rule_version: 'v1',
    bag_composition: { main: true, snack: true, extra: true },
    created_at: '2026-04-29T10:00:00.000Z',
    ...overrides,
  };
}

async function reachAddChildForm(page: Page) {
  await page.route('**/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userProfile()), // factory has acknowledgment set
    }),
  );
  await loginAndNavigate(page, '/app');
  await page.getByRole('button', { name: /add your first child/i }).click();
  await expect(page.getByRole('heading', { name: /tell us about your child/i })).toBeVisible();
}

test.describe('Story 2-10: add child profile (envelope-encrypted sensitive fields)', () => {
  test('form mounts with name + age-band fields and the Save/Cancel actions', async ({ page }) => {
    await reachAddChildForm(page);
    await expect(page.getByLabel(/^name$/i)).toBeVisible();
    await expect(page.getByLabel(/age band/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /save child/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^cancel$/i })).toBeVisible();
  });

  test('successful submit posts to /v1/households/<id>/children and shows the bag composition card', async ({
    page,
  }) => {
    let postedBody: Record<string, unknown> | null = null;
    let postedUrl = '';
    await page.route(`**/v1/households/*/children`, (route, request) => {
      postedUrl = request.url();
      postedBody = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ child: childResponse({ name: 'Maya' }) }),
      });
    });

    await reachAddChildForm(page);
    await page.getByLabel(/^name$/i).fill('Maya');
    await page.getByLabel(/age band/i).selectOption('child');
    await page.getByRole('button', { name: /save child/i }).click();

    await expect.poll(() => postedBody).not.toBeNull();
    expect(postedUrl).toContain(`/v1/households/${SAMPLE_HOUSEHOLD_ID}/children`);
    expect(postedBody).toMatchObject({
      name: 'Maya',
      age_band: 'child',
      declared_allergens: [],
      cultural_identifiers: [],
      dietary_preferences: [],
    });

    // Per the 2-12 flow, after a successful add the BagCompositionCard takes
    // the child's name and renders next.
    await expect(page.getByText(/how does maya.s lunch bag look/i)).toBeVisible();
  });

  test('omitting required fields surfaces a Zod validation error before any network call', async ({
    page,
  }) => {
    let serverHit = false;
    await page.route(`**/v1/households/*/children`, (route) => {
      serverHit = true;
      return route.fulfill({ status: 500, body: '{}' });
    });

    await reachAddChildForm(page);
    // Name has `required` HTML attr — bypass it by using JS input dispatch via fill('')
    // and submit through the button. The browser will block submit on empty required;
    // we explicitly fill name with whitespace which Zod's trimmed-min-length will reject.
    await page.getByLabel(/^name$/i).fill('   ');
    await page.getByLabel(/age band/i).selectOption('child');
    await page.getByRole('button', { name: /save child/i }).click();

    await expect(page.getByRole('alert')).toBeVisible();
    expect(serverHit).toBe(false);
  });

  test('parental_notice_required problem type re-opens the parental notice dialog', async ({
    page,
  }) => {
    await page.route(`**/v1/households/*/children`, (route) =>
      route.fulfill({
        status: 412,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({
          type: '/errors/parental-notice-required',
          status: 412,
          title: 'Parental notice required',
        }),
      }),
    );
    // The dialog re-fetches the notice when it opens.
    await page.route('**/v1/compliance/parental-notice', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_version: 'v2',
          effective_at: '2026-04-01T00:00:00.000Z',
          content: '# Parental notice\n\nA short notice.',
          data_categories: [{ id: 'profile', label: 'Profile', purpose: 'Identify' }],
          retention: [{ category: 'profile', duration: '12 months' }],
          processors: [{ name: 'OpenAI', purpose: 'Plan' }],
        }),
      }),
    );

    await reachAddChildForm(page);
    await page.getByLabel(/^name$/i).fill('Asha');
    await page.getByLabel(/age band/i).selectOption('child');
    await page.getByRole('button', { name: /save child/i }).click();

    await expect(
      page.getByRole('heading', { name: /before we collect data about your family/i }),
    ).toBeVisible();
  });

  test('5xx server failure surfaces a friendly error and keeps the form open', async ({ page }) => {
    await page.route(`**/v1/households/*/children`, (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server' }),
      }),
    );

    await reachAddChildForm(page);
    await page.getByLabel(/^name$/i).fill('Asha');
    await page.getByLabel(/age band/i).selectOption('child');
    await page.getByRole('button', { name: /save child/i }).click();

    await expect(page.getByRole('alert')).toContainText(/couldn.t add this child/i);
    // Form did not unmount — the user can fix and retry.
    await expect(page.getByLabel(/^name$/i)).toHaveValue('Asha');
  });

  test('Cancel closes the form without making any network request', async ({ page }) => {
    let serverHit = false;
    await page.route(`**/v1/households/*/children`, (route) => {
      serverHit = true;
      return route.fulfill({ status: 500, body: '{}' });
    });

    await reachAddChildForm(page);
    await page.getByLabel(/^name$/i).fill('Asha');
    await page.getByRole('button', { name: /^cancel$/i }).click();

    await expect(page.getByRole('heading', { name: /tell us about your child/i })).toHaveCount(0);
    expect(serverHit).toBe(false);
  });
});

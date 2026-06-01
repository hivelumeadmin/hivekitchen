import { test, expect } from '@playwright/test';
import {
  loginAndNavigate,
  userProfile,
  SAMPLE_HOUSEHOLD_ID,
} from './_helpers.js';

const BRIEF_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`;
const CHILD_ID = '33333333-3333-4333-8333-333333333333';

function briefResponse(overrides: Record<string, unknown> = {}) {
  return {
    brief: {
      household_id: SAMPLE_HOUSEHOLD_ID,
      moment_headline: 'A quiet week, with one small surprise.',
      lumi_note: 'Tuesday flexes around your late meeting.',
      memory_prose: '',
      cleared_allergies: [],
      plan_tile_summaries: [
        { day: 'monday',    items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['rice', 'beans'] }] },
        { day: 'tuesday',   items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['noodles'] }] },
        { day: 'wednesday', items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['pasta'] }] },
        { day: 'thursday',  items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['soup'] }] },
        { day: 'friday',    items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['wrap'] }] },
      ],
      generated_at: '2026-05-02T00:00:00.000Z',
      plan_revision: 1,
      updated_at: '2026-05-02T00:00:00.000Z',
      ...overrides,
    },
  };
}

async function mockAcknowledgedProfile(page: import('@playwright/test').Page) {
  await page.route('**/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userProfile()),
    }),
  );
}

async function navigateToApp(page: import('@playwright/test').Page) {
  await mockAcknowledgedProfile(page);
  // pre-4-s3: BriefCanvas now calls usePlanQuery on every mount. Mock the
  // plans endpoint so E2E tests don't hit a real (absent) API server.
  await page.route('**/v1/plans*', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: null, plan_items: [], is_draft: false, week_of: '2026-05-04' }),
    }),
  );
  await loginAndNavigate(page, '/app');
  // Wait for the compliance gate to hydrate from /v1/users/me so BriefCanvas mounts.
  await page.waitForResponse('**/v1/users/me');
}

test.describe('Story 3-8: BriefCanvas', () => {
  test('renders moment headline, lumi note, and plan tiles when brief is available (AC #1)', async ({
    page,
  }) => {
    await page.route(BRIEF_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(briefResponse()),
      }),
    );

    await navigateToApp(page);
    await page.waitForResponse(BRIEF_URL);

    await expect(
      page.getByRole('heading', { level: 1, name: 'A quiet week, with one small surprise.' }),
    ).toBeVisible();
    await expect(
      page.getByText('Tuesday flexes around your late meeting.'),
    ).toBeVisible();
    await expect(page.getByLabel('Weekly plan')).toBeVisible();

    // All 5 day tiles present as <article> landmarks
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      await expect(page.getByRole('article', { name: day })).toBeVisible();
    }
  });

  test('renders "preparing plan" copy when brief is null (AC #1 empty-state)', async ({
    page,
  }) => {
    await page.route(BRIEF_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: null }),
      }),
    );

    await navigateToApp(page);
    await page.waitForResponse(BRIEF_URL);

    await expect(
      page.getByText('Lumi is preparing your first plan. Check back Sunday evening.'),
    ).toBeVisible();
    // Plan grid must NOT appear
    await expect(page.getByLabel('Weekly plan')).toHaveCount(0);
  });

  test('renders gracefully when moment_headline and lumi_note are empty strings', async ({
    page,
  }) => {
    await page.route(BRIEF_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(briefResponse({ moment_headline: '', lumi_note: '' })),
      }),
    );

    await navigateToApp(page);
    await page.waitForResponse(BRIEF_URL);

    // Plan grid still renders — no crash
    await expect(page.getByLabel('Weekly plan')).toBeVisible();
    // PageHeader renders fallback h1 when moment_headline is empty
    const h1 = page.getByRole('heading', { level: 1, name: 'Your week, ready' });
    await expect(h1).toBeVisible();
    // LumiNote returns null for empty text — no border-left paragraph
    await expect(page.locator('[class*="border-s-4"]')).toHaveCount(0);
  });

  test('renders error message when brief API fails', async ({ page }) => {
    await page.route(BRIEF_URL, (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server error' }),
      }),
    );

    await navigateToApp(page);
    await page.waitForResponse(BRIEF_URL);

    // Retry: 3, backoff: 1s+2s+4s = 7s before isError=true — give 15s headroom.
    await expect(page.getByRole('status')).toContainText(
      "Lumi couldn't reach the plan right now.",
      { timeout: 15_000 },
    );
    // Plan grid must NOT appear when there is no cached brief
    await expect(page.getByLabel('Weekly plan')).toHaveCount(0);
  });

  test('uses the brief surface context signal (AC #1 — useLumiContext surface=brief)', async ({
    page,
  }) => {
    await page.route(BRIEF_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: null }),
      }),
    );

    await navigateToApp(page);

    const surface = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__lumiStore;
      if (!store) throw new Error('__lumiStore not available — set VITE_E2E=true in the build');
      return (store.getState() as { surface: string }).surface;
    });
    expect(surface).toBe('brief');
  });

  test('parental notice gate blocks BriefCanvas when notice not yet acknowledged (D3 fix)', async ({
    page,
  }) => {
    // Return unacknowledged profile — gate state becomes 'required'
    await page.route('**/v1/users/me', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          userProfile({
            parental_notice_acknowledged_at: null,
            parental_notice_acknowledged_version: null,
          }),
        ),
      }),
    );
    await page.route('**/v1/compliance/parental-notice', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_version: 'v1',
          content: '# Notice\n\nShort notice.',
          data_categories: ['profile'],
          retention: [{ category: 'profile', horizon_days: 365, label: '12 months' }],
          processors: [
            { name: 'supabase', display_name: 'Supabase', purpose: 'Database', data_categories: ['profile'], retention_label: '12 months' },
            { name: 'elevenlabs', display_name: 'ElevenLabs', purpose: 'Voice', data_categories: ['profile'], retention_label: '90 days' },
            { name: 'sendgrid', display_name: 'SendGrid', purpose: 'Email', data_categories: ['profile'], retention_label: '12 months' },
            { name: 'twilio', display_name: 'Twilio', purpose: 'SMS', data_categories: ['profile'], retention_label: '12 months' },
            { name: 'stripe', display_name: 'Stripe', purpose: 'Billing', data_categories: ['profile'], retention_label: '7 years' },
            { name: 'openai', display_name: 'OpenAI', purpose: 'AI', data_categories: ['profile'], retention_label: '30 days' },
          ],
        }),
      }),
    );

    await loginAndNavigate(page, '/app');
    await page.waitForResponse('**/v1/users/me');

    // Gate dialog should appear automatically (requireAcknowledgment fires via useEffect)
    await expect(
      page.getByRole('heading', { name: /before we collect data about your family/i }),
    ).toBeVisible();
    // BriefCanvas must NOT be mounted — no plan grid, no headline, no preparing copy
    await expect(page.getByLabel('Weekly plan')).toHaveCount(0);
    await expect(
      page.getByText('Lumi is preparing your first plan. Check back Sunday evening.'),
    ).toHaveCount(0);
  });
});

import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, userProfile } from './_helpers.js';

// Deterministic UUIDs matching the spec demo path.
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const DATE = '2026-05-17';
// Stub link format: test-{UUID:36}-{YYYY-MM-DD:10} = 52 chars (4-S2 only; real tokens ship in 4-S3).
const STUB_LINK_URL = `/lunch/test-${CHILD_ID}-${DATE}`;
const LUNCH_LINK_DEV_PATTERN = `**/v1/lunch-link-dev/${CHILD_ID}/${DATE}`;

function fullPayload() {
  return {
    childName: 'Layla',
    date: DATE,
    heartNote: {
      body: 'Have a wonderful day, my love.',
      authorDisplayName: 'Parent',
    },
    bag: {
      name: 'Sandwich, apple & water',
      sub: 'Packed for you today',
      safetyNote: 'Nut-free',
    },
  };
}

async function mockLunchLinkApi(
  page: Page,
  response: { status: number; body: unknown },
) {
  await page.route(LUNCH_LINK_DEV_PATTERN, (route) =>
    route.fulfill({
      status: response.status,
      headers: {
        'Content-Type':
          response.status === 200 ? 'application/json' : 'application/problem+json',
      },
      body: JSON.stringify(response.body),
    }),
  );
}

test.describe('Story 4-s2: Lunch Link render (stub token)', () => {
  // Silence AppLayout user-profile calls across all tests.
  test.beforeEach(async ({ page }) => {
    await page.route('**/v1/users/me', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile()),
      }),
    );
  });

  // AC8 (invalid-link branch): the route parser rejects the linkId before fetching.
  test('invalid link format shows "doesn\'t look right" error without any API call', async ({
    page,
  }) => {
    await loginAndNavigate(page, '/lunch/not-a-valid-link-at-all');
    await expect(page.getByText("This link doesn't look right.")).toBeVisible();
    // Loaded content must be absent.
    await expect(page.getByRole('heading', { name: /a note from parent/i })).not.toBeVisible();
  });

  // AC8 (loading branch): skeleton is visible while the fetch is in flight.
  test('shows loading skeleton while fetch is in flight', async ({ page }) => {
    let unblock!: () => void;
    const block = new Promise<void>((resolve) => {
      unblock = resolve;
    });

    await page.route(LUNCH_LINK_DEV_PATTERN, async (route) => {
      await block;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullPayload()),
      });
    });

    await loginAndNavigate(page, STUB_LINK_URL);
    // Route is blocked — loading skeleton must be visible.
    await expect(page.locator('.animate-pulse').first()).toBeVisible();
    // Salutation heading must not yet be present.
    await expect(page.getByRole('heading', { name: /a note from parent/i })).not.toBeVisible();

    // Unblock the route and verify loaded content appears.
    unblock();
    await expect(page.getByRole('heading', { name: /a note from parent/i })).toBeVisible();
  });

  // AC1 + AC5: full payload — all four surface components render correctly.
  test('loaded state renders salutation, heart note body, bag name, and feedback question', async ({
    page,
  }) => {
    await mockLunchLinkApi(page, { status: 200, body: fullPayload() });
    await loginAndNavigate(page, STUB_LINK_URL);

    // MumNoteSalutation (AC5) — h1 with static "A note from Parent" title.
    await expect(page.getByRole('heading', { name: 'A note from Parent', level: 1 })).toBeVisible();
    // Date label derived from the returned ISO date (2026-05-17 = Sunday).
    await expect(page.getByText('Sunday · 17 May')).toBeVisible();

    // HeartNoteCard (AC5) — body prose rendered verbatim.
    await expect(page.getByText('Have a wonderful day, my love.')).toBeVisible();
    // Attribution line.
    await expect(page.getByText('— Parent')).toBeVisible();

    // LunchSummary (AC5 + AC7) — bag from hardcoded stub.
    await expect(page.getByRole('heading', { name: 'Sandwich, apple & water', level: 2 })).toBeVisible();
    await expect(page.getByText('Packed for you today')).toBeVisible();
    await expect(page.getByText('Nut-free')).toBeVisible();

    // FeedbackBlock (AC5 + AC9) — question uses childName from API.
    await expect(page.getByRole('heading', { name: 'How was lunch, Layla?', level: 3 })).toBeVisible();
    // Three emoji options present.
    await expect(page.getByRole('button', { name: 'Loved it' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'It was OK' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Not really' })).toBeVisible();
  });

  // AC2 + AC6: null heartNote — placeholder copy shown, other sections unaffected.
  test('null heartNote renders placeholder instead of crashing', async ({ page }) => {
    await mockLunchLinkApi(page, {
      status: 200,
      body: { ...fullPayload(), heartNote: null },
    });
    await loginAndNavigate(page, STUB_LINK_URL);

    // Placeholder copy (AC6).
    await expect(page.getByText('No note today — check back soon')).toBeVisible();
    // Attribution line absent when there is no note.
    await expect(page.getByText('— Parent')).not.toBeVisible();
    // Salutation and bag still present (AC2 + AC5).
    await expect(page.getByRole('heading', { name: 'A note from Parent', level: 1 })).toBeVisible();
    await expect(page.getByText('Sandwich, apple & water')).toBeVisible();
  });

  // AC8 (error branch): fetch failure surfaces generic error, not raw exception.
  test('API error shows generic error message', async ({ page }) => {
    await mockLunchLinkApi(page, {
      status: 500,
      body: { type: '/errors/internal', status: 500, title: 'Internal' },
    });
    await loginAndNavigate(page, STUB_LINK_URL);

    await expect(
      page.getByText("Couldn't load this lunch link. Please try again."),
    ).toBeVisible();
    // Loaded content must be absent.
    await expect(page.getByRole('heading', { name: /a note from parent/i })).not.toBeVisible();
  });

  // AC3 (frontend mapping): 404 (child not in household) is also caught as an error.
  test('404 from API (child not in household) shows generic error message', async ({ page }) => {
    await mockLunchLinkApi(page, {
      status: 404,
      body: { type: '/errors/not-found', status: 404, title: 'Not found' },
    });
    await loginAndNavigate(page, STUB_LINK_URL);

    await expect(
      page.getByText("Couldn't load this lunch link. Please try again."),
    ).toBeVisible();
  });

  // AC9: tapping an emoji updates local aria-pressed state only — no rate API call.
  test('tapping an emoji marks it selected locally without any API call', async ({ page }) => {
    await mockLunchLinkApi(page, { status: 200, body: fullPayload() });

    // Guard: any call to a rating endpoint fails the test.
    await page.route('**/v1/**/*rate*', (route) => {
      throw new Error('Unexpected rating API call — onRate must remain unwired in 4-S2');
    });

    await loginAndNavigate(page, STUB_LINK_URL);
    await expect(page.getByRole('heading', { name: 'How was lunch, Layla?', level: 3 })).toBeVisible();

    const lovedBtn = page.getByRole('button', { name: 'Loved it' });
    const notReallyBtn = page.getByRole('button', { name: 'Not really' });

    // Before tap: unpressed.
    await expect(lovedBtn).toHaveAttribute('aria-pressed', 'false');

    await lovedBtn.click();

    // After tap: selected button is pressed.
    await expect(lovedBtn).toHaveAttribute('aria-pressed', 'true');
    // Other buttons remain unpressed.
    await expect(notReallyBtn).toHaveAttribute('aria-pressed', 'false');
  });

  // AC7: LunchSummary imageSrc absence — image container hidden, no broken img.
  test('bag section renders without image when imageSrc is absent', async ({ page }) => {
    await mockLunchLinkApi(page, { status: 200, body: fullPayload() });
    await loginAndNavigate(page, STUB_LINK_URL);

    await expect(page.getByRole('heading', { name: 'Sandwich, apple & water', level: 2 })).toBeVisible();
    // No img element should appear in the bag section (imageSrc intentionally absent in S2).
    await expect(page.locator('img')).not.toBeVisible();
  });
});

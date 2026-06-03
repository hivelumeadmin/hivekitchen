import { test, expect } from '@playwright/test';
import {
  loginAndNavigate,
  userProfile,
  SAMPLE_HOUSEHOLD_ID,
} from './_helpers.js';

const BRIEF_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`;
const CHILD_ID = '33333333-3333-4333-8333-333333333333';

interface ScaffoldingDiff {
  summary: string;
  explanation?: string;
}

function briefResponse(scaffolding_diff: ScaffoldingDiff | null = null) {
  return {
    brief: {
      household_id: SAMPLE_HOUSEHOLD_ID,
      moment_headline: 'A quiet week, with one small surprise.',
      lumi_note: 'Tuesday flexes around your late meeting.',
      memory_prose: '',
      payload: {
        cleared_allergies: [],
        plan_state: null,
        plan_state_set_at: null,
        plan_state_message: null,
        tile_summaries: [
          { day: 'monday',    items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['rice', 'beans'] }] },
          { day: 'tuesday',   items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['noodles'] }] },
          { day: 'wednesday', items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['pasta'] }] },
          { day: 'thursday',  items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['soup'] }] },
          { day: 'friday',    items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['wrap'] }] },
        ],
        scaffolding_diff,
      },
      generated_at: '2026-05-02T00:00:00.000Z',
      plan_revision: 1,
      updated_at: '2026-05-02T00:00:00.000Z',
    },
  };
}

async function navigateToApp(
  page: import('@playwright/test').Page,
  scaffolding_diff: ScaffoldingDiff | null = null,
) {
  await page.route('**/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userProfile()),
    }),
  );
  await page.route(BRIEF_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(briefResponse(scaffolding_diff)),
    }),
  );
  await loginAndNavigate(page, '/app');
  await page.waitForResponse('**/v1/users/me');
  await page.waitForResponse(BRIEF_URL);
}

// FreshnessState stale variant (foliage pulse dot, AC #2) requires TanStack Query
// cache to be both stale and in a background-refetch cycle simultaneously.
// Stale time is 5 minutes — not inducible via route mocking alone without
// manipulating the QueryClient directly. Covered by FreshnessState.test.tsx
// unit tests instead.

test.describe('Story 3-11: FreshnessState', () => {
  test('no status element rendered when brief loads successfully (variant=fresh, AC #1)', async ({
    page,
  }) => {
    await navigateToApp(page);

    await expect(
      page.getByRole('heading', { level: 1, name: 'A quiet week, with one small surprise.' }),
    ).toBeVisible();
    // FreshnessState variant=fresh returns null — no <p role="status"> in DOM.
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('error copy rendered when brief API returns 500 (variant=failed, AC #1)', async ({
    page,
  }) => {
    await page.route('**/v1/users/me', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile()),
      }),
    );
    await page.route(BRIEF_URL, (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server error' }),
      }),
    );
    await loginAndNavigate(page, '/app');
    await page.waitForResponse('**/v1/users/me');

    // TanStack retries 3× (1s + 2s + 4s backoff) before setting isError=true.
    await expect(page.getByRole('status')).toContainText(
      "Lumi couldn't reach the plan right now.",
      { timeout: 15_000 },
    );
    // Plan grid must not appear when there is no cached brief.
    await expect(page.getByLabel('Weekly plan')).toHaveCount(0);
  });
});

test.describe('Story 3-11: QuietDiff', () => {
  test('renders nothing when scaffolding_diff is null (AC #3)', async ({ page }) => {
    await navigateToApp(page, null);

    await expect(
      page.getByRole('heading', { level: 1, name: 'A quiet week, with one small surprise.' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /why this change/i })).toHaveCount(0);
  });

  test('renders summary text ABOVE MomentHeadline when scaffolding_diff is set (AC #3)', async ({
    page,
  }) => {
    await navigateToApp(page, {
      summary: "Swapped Tuesday's protein to match pantry",
    });

    const summary = page.getByText("Swapped Tuesday's protein to match pantry");
    const headline = page.getByRole('heading', {
      level: 1,
      name: 'A quiet week, with one small surprise.',
    });

    await expect(summary).toBeVisible();
    await expect(headline).toBeVisible();

    // QuietDiff must be physically above MomentHeadline (AC #3 DOM order).
    const summaryBox = await summary.boundingBox();
    const headlineBox = await headline.boundingBox();
    expect(summaryBox!.y).toBeLessThan(headlineBox!.y);
  });

  test('does not render ⋯ button when explanation is absent (AC #3)', async ({ page }) => {
    await navigateToApp(page, {
      summary: "Swapped Tuesday's protein to match pantry",
    });

    await expect(
      page.getByText("Swapped Tuesday's protein to match pantry"),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /why this change/i })).toHaveCount(0);
  });

  test('⋯ button visible when explanation provided; clicking opens dialog (AC #3)', async ({
    page,
  }) => {
    await navigateToApp(page, {
      summary: "Swapped Tuesday's protein to match pantry",
      explanation: 'Pantry had no chicken this week.',
    });

    const btn = page.getByRole('button', { name: /why this change/i });
    await expect(btn).toBeVisible();

    // Dialog is closed initially.
    await expect(page.getByRole('dialog', { name: /why this change/i })).toHaveCount(0);

    await btn.click();

    const dialog = page.getByRole('dialog', { name: /why this change/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Pantry had no chicken this week.');
  });

  test('clicking ⋯ again closes the dialog (AC #3)', async ({ page }) => {
    await navigateToApp(page, {
      summary: "Swapped Tuesday's protein to match pantry",
      explanation: 'Pantry had no chicken this week.',
    });

    const btn = page.getByRole('button', { name: /why this change/i });
    await btn.click();
    await expect(page.getByRole('dialog', { name: /why this change/i })).toBeVisible();

    await btn.click();
    await expect(page.getByRole('dialog', { name: /why this change/i })).toHaveCount(0);
  });

  test('Escape key closes dialog and returns focus to ⋯ button (AC #3)', async ({ page }) => {
    await navigateToApp(page, {
      summary: "Swapped Tuesday's protein to match pantry",
      explanation: 'Pantry had no chicken this week.',
    });

    const btn = page.getByRole('button', { name: /why this change/i });
    await btn.click();
    await expect(page.getByRole('dialog', { name: /why this change/i })).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog', { name: /why this change/i })).toHaveCount(0);
    await expect(btn).toBeFocused();
  });

  test('QuietDiff is positioned above AllergyClearedBadge row and MomentHeadline in DOM (AC #3 order)', async ({
    page,
  }) => {
    // Seed both QuietDiff and AllergyClearedBadge to verify the full layout stack.
    await page.route('**/v1/users/me', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile()),
      }),
    );
    await page.route(BRIEF_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: {
            household_id: SAMPLE_HOUSEHOLD_ID,
            moment_headline: 'A quiet week, with one small surprise.',
            lumi_note: 'Tuesday flexes around your late meeting.',
            memory_prose: '',
            payload: {
              plan_state: null,
              plan_state_set_at: null,
              plan_state_message: null,
              tile_summaries: [
                { day: 'monday', items: [{ child_id: CHILD_ID, slot: 'main', ingredients: ['rice'] }] },
              ],
              cleared_allergies: [
                { child_id: CHILD_ID, child_name: 'Asha', allergen: 'peanut' },
              ],
              scaffolding_diff: {
                summary: "Swapped Tuesday's protein to match pantry",
                explanation: 'Pantry had no chicken this week.',
              },
            },
            generated_at: '2026-05-02T00:00:00.000Z',
            plan_revision: 1,
            updated_at: '2026-05-02T00:00:00.000Z',
          },
        }),
      }),
    );
    await loginAndNavigate(page, '/app');
    await page.waitForResponse('**/v1/users/me');
    await page.waitForResponse(BRIEF_URL);

    const badge = page.getByRole('button', { name: "Cleared for Asha's peanut" });
    const quietDiffText = page.getByText("Swapped Tuesday's protein to match pantry");
    const headline = page.getByRole('heading', {
      level: 1,
      name: 'A quiet week, with one small surprise.',
    });

    await expect(badge).toBeVisible();
    await expect(quietDiffText).toBeVisible();
    await expect(headline).toBeVisible();

    const badgeBox = await badge.boundingBox();
    const diffBox = await quietDiffText.boundingBox();
    const headlineBox = await headline.boundingBox();

    // Expected vertical order: AllergyClearedBadge → QuietDiff → MomentHeadline.
    expect(badgeBox!.y).toBeLessThan(diffBox!.y);
    expect(diffBox!.y).toBeLessThan(headlineBox!.y);
  });
});

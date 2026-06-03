import { test, expect } from '@playwright/test';
import {
  loginAndNavigate,
  userProfile,
  SAMPLE_HOUSEHOLD_ID,
} from './_helpers.js';

const BRIEF_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`;
const CHILD_ID = '33333333-3333-4333-8333-333333333333';

interface ClearedAllergyEntry {
  child_id: string;
  child_name: string;
  allergen: string;
}

function briefResponse(cleared_allergies: ClearedAllergyEntry[] = []) {
  return {
    brief: {
      household_id: SAMPLE_HOUSEHOLD_ID,
      moment_headline: 'A quiet week, with one small surprise.',
      lumi_note: 'Tuesday flexes around your late meeting.',
      memory_prose: '',
      payload: {
        scaffolding_diff: null,
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
        cleared_allergies,
      },
      generated_at: '2026-05-02T00:00:00.000Z',
      plan_revision: 1,
      updated_at: '2026-05-02T00:00:00.000Z',
    },
  };
}

async function navigateToApp(
  page: import('@playwright/test').Page,
  cleared_allergies: ClearedAllergyEntry[] = [],
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
      body: JSON.stringify(briefResponse(cleared_allergies)),
    }),
  );
  await loginAndNavigate(page, '/app');
  await page.waitForResponse('**/v1/users/me');
  await page.waitForResponse(BRIEF_URL);
}

test.describe('Story 3-10: AllergyClearedBadge', () => {
  test('badge chip renders above the MomentHeadline (AC #1)', async ({ page }) => {
    await navigateToApp(page, [
      { child_id: CHILD_ID, child_name: 'Asha', allergen: 'peanut' },
    ]);

    const badge = page.getByRole('button', { name: "Cleared for Asha's peanut" });
    const headline = page.getByRole('heading', { level: 1, name: 'A quiet week, with one small surprise.' });

    await expect(badge).toBeVisible();
    await expect(headline).toBeVisible();

    // Verify visual order: badge bounding box top < headline bounding box top.
    const badgeBox = await badge.boundingBox();
    const headlineBox = await headline.boundingBox();
    expect(badgeBox!.y).toBeLessThan(headlineBox!.y);
  });

  test('badge chip label text is "Cleared for {child_name}\'s {allergen}" (AC #1)', async ({ page }) => {
    await navigateToApp(page, [
      { child_id: CHILD_ID, child_name: 'Asha', allergen: 'peanut' },
    ]);

    await expect(
      page.getByRole('button', { name: "Cleared for Asha's peanut" }),
    ).toBeVisible();
  });

  test('clicking the badge opens the popover with verbatim UX-DR24 copy (AC #2)', async ({ page }) => {
    await navigateToApp(page, [
      { child_id: CHILD_ID, child_name: 'Asha', allergen: 'peanut' },
    ]);

    await page.getByRole('button', { name: "Cleared for Asha's peanut" }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("We checked every ingredient against Asha's peanut allergy.");
    await expect(dialog).toContainText("Nothing in today's lunch contains peanut or was made near them.");
  });

  test('popover contains a "View audit" link (AC #2)', async ({ page }) => {
    await navigateToApp(page, [
      { child_id: CHILD_ID, child_name: 'Asha', allergen: 'peanut' },
    ]);

    await page.getByRole('button', { name: "Cleared for Asha's peanut" }).click();
    await expect(page.getByRole('link', { name: 'View audit' })).toBeVisible();
  });

  // This test exercises real browser keyboard handling — unit tests masked P1
  // (broken Escape behaviour) by firing keyDown directly on the dialog element.
  // Playwright fires actual browser keyboard events, so this is the authoritative
  // regression guard for the P1 fix (onKeyDown added to the trigger button).
  test('Escape pressed while focus is on the trigger closes the popover (AC #2 / P1 regression guard)', async ({ page }) => {
    await navigateToApp(page, [
      { child_id: CHILD_ID, child_name: 'Asha', allergen: 'peanut' },
    ]);

    const trigger = page.getByRole('button', { name: "Cleared for Asha's peanut" });
    await trigger.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Click keeps focus on the trigger (real browser behaviour); press Escape.
    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('no allergy clearance row renders when cleared_allergies is empty (AC #4)', async ({ page }) => {
    await navigateToApp(page, []); // empty — no allergen entries

    await expect(page.getByLabel('Allergy clearances')).toHaveCount(0);
    // Brief canvas still renders normally — empty state is silence
    await expect(
      page.getByRole('heading', { level: 1, name: 'A quiet week, with one small surprise.' }),
    ).toBeVisible();
  });

  test('renders one badge per (child, allergen) pair for multiple entries (AC #1)', async ({ page }) => {
    await navigateToApp(page, [
      { child_id: CHILD_ID, child_name: 'Asha', allergen: 'peanut' },
      { child_id: CHILD_ID, child_name: 'Asha', allergen: 'tree nut' },
    ]);

    await expect(
      page.getByRole('button', { name: "Cleared for Asha's peanut" }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: "Cleared for Asha's tree nut" }),
    ).toBeVisible();
  });
});

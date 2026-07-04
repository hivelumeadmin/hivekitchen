import { test, expect } from '@playwright/test';
import { loginAndNavigate } from './_helpers.js';

const TURN_URL = '**/v1/onboarding/text/turn';
const FINALIZE_URL = '**/v1/onboarding/text/finalize';

function turnResponse(overrides: {
  lumi_response?: string;
  moment_key?: string | null;
  chip_config?: unknown;
  is_complete?: boolean;
  required_set_complete?: boolean | null;
  missing_required_set?: string[];
}) {
  return {
    thread_id: '88888888-8888-4888-8888-888888888888',
    turn_id: '44444444-4444-4444-8444-444444444444',
    lumi_turn_id: '55555555-5555-4555-8555-555555555555',
    lumi_response:
      overrides.lumi_response ??
      "Here's everything I've learned about your kitchen.",
    is_complete: overrides.is_complete ?? false,
    chip_config: overrides.chip_config ?? null,
    moment_key: overrides.moment_key ?? null,
    required_set_complete: overrides.required_set_complete ?? null,
    missing_required_set: overrides.missing_required_set ?? [],
  };
}

/** Stub /turn to advance into summary and navigate to /onboarding text mode. */
async function landOnSummary(
  page: Parameters<typeof loginAndNavigate>[0],
  opts: {
    required_set_complete?: boolean;
    missing_required_set?: string[];
    lumi_response?: string;
  } = {},
) {
  await page.route(TURN_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        turnResponse({
          moment_key: 'summary',
          lumi_response:
            opts.lumi_response ??
            "Here's everything I've learned about your kitchen. The Menon family — Layla and Adam.",
          required_set_complete: opts.required_set_complete ?? true,
          missing_required_set: opts.missing_required_set ?? [],
        }),
      ),
    }),
  );

  await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
  await page.getByRole('button', { name: /i'd rather type/i }).click();
  await page.getByLabel(/your message to lumi/i).fill('All set!');
  await page.getByRole('button', { name: /^send$/i }).click();

  await expect(page.getByText(/here's everything/i)).toBeVisible();
}

// Epic 13-s6 — the finalize gate is now the recognition ending: Lumi's prose
// playback + a quiet honey glow + a "Show me my first week" CTA (never-auto).
// The underlying required-set / finalize wiring is unchanged; only the surface
// moved. These tests were migrated from the 2.5-s10 finalize-gate assertions.
test.describe('Slice 2.5-s10 → 13-s6: Summary + Recognition Ending', () => {
  // AC8a — header subtitle switches to summary-specific copy (unchanged).
  test('header subtitle shows "Summary · Lock in your kitchen" in summary moment', async ({
    page,
  }) => {
    await landOnSummary(page);
    await expect(page.getByText(/summary · lock in your kitchen/i)).toBeVisible();
  });

  // The recognition ending renders when the moment is summary.
  test('recognition ending renders when moment is summary', async ({ page }) => {
    await landOnSummary(page);
    await expect(page.getByTestId('recognition-ending')).toBeVisible();
    await expect(page.getByText(/here's the kitchen i've come to know/i)).toBeVisible();
  });

  // The "Show me my first week" CTA appears and is enabled when required-set complete.
  test('CTA is shown and enabled when required-set is complete', async ({ page }) => {
    await landOnSummary(page, { required_set_complete: true, missing_required_set: [] });
    const btn = page.getByTestId('show-first-week-button');
    await expect(btn).toBeVisible();
    await expect(btn).not.toBeDisabled();
    await expect(btn).toContainText(/show me my first week/i);
  });

  // No raw disabled CTA when incomplete — a calm jump-back affordance stands in.
  test('CTA is absent and a jump-back affordance shows when required-set is incomplete', async ({
    page,
  }) => {
    await landOnSummary(page, {
      required_set_complete: false,
      missing_required_set: ['m5_starting_line'],
    });
    await expect(page.getByTestId('show-first-week-button')).toHaveCount(0);
    await expect(page.getByText(/one more thing before your first week/i)).toBeVisible();
  });

  // Jump-back for m5_starting_line shows label + "Back to Moment 5".
  test('jump-back for m5_starting_line shows label and "Back to Moment 5"', async ({ page }) => {
    await landOnSummary(page, {
      required_set_complete: false,
      missing_required_set: ['m5_starting_line'],
    });
    const jump = page.getByTestId('gap-jump-m5_starting_line');
    await expect(jump).toBeVisible();
    await expect(jump).toContainText(/a starting line for lumi/i);
    await expect(jump).toContainText(/back to moment 5/i);
  });

  // Jump-back for m3_taste (13-s6 — M3 joined the required set).
  test('jump-back for m3_taste shows label and "Back to Moment 3"', async ({ page }) => {
    await landOnSummary(page, {
      required_set_complete: false,
      missing_required_set: ['m3_taste'],
    });
    const jump = page.getByTestId('gap-jump-m3_taste');
    await expect(jump).toBeVisible();
    await expect(jump).toContainText(/how your family likes to eat/i);
    await expect(jump).toContainText(/back to moment 3/i);
  });

  // Jump-back for m2_safe shows correct label + back button.
  test('jump-back for m2_safe shows label and "Back to Moment 2"', async ({ page }) => {
    await landOnSummary(page, {
      required_set_complete: false,
      missing_required_set: ['m2_safe'],
    });
    const jump = page.getByTestId('gap-jump-m2_safe');
    await expect(jump).toBeVisible();
    await expect(jump).toContainText(/what i need to keep safe/i);
    await expect(jump).toContainText(/back to moment 2/i);
  });

  // "Back to Moment N" tap restores the input bar (client-side navigation).
  test('"Back to Moment N" tap restores the input bar', async ({ page }) => {
    await landOnSummary(page, {
      required_set_complete: false,
      missing_required_set: ['m5_starting_line'],
    });
    await page.getByRole('button', { name: /back to moment 5/i }).click();
    await expect(page.getByLabel(/your message to lumi/i)).toBeVisible();
    await expect(page.getByTestId('recognition-ending')).not.toBeVisible();
  });

  // AC4 + AC5 — tapping the CTA POSTs to /v1/onboarding/text/finalize.
  test('tapping "Show me my first week" calls POST /v1/onboarding/text/finalize', async ({
    page,
  }) => {
    let finalizeCalled = false;
    await page.route(FINALIZE_URL, (route) => {
      finalizeCalled = true;
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: '88888888-8888-4888-8888-888888888888',
          summary: {
            cultural_templates: ['indian'],
            palate_notes: ['mild'],
            allergens_mentioned: [],
            family_rhythms: [],
          },
        }),
      });
    });

    await landOnSummary(page, { required_set_complete: true, missing_required_set: [] });
    await page.getByTestId('show-first-week-button').click();

    await expect.poll(() => finalizeCalled).toBe(true);
  });

  // 13-s5 — the "All moments captured" footer belonged to the deleted
  // KitchenProfilePanel. The projection-only KitchenMapHero has no per-moment
  // footer; in summary the panel simply persists alongside the recognition ending.
  test('profile panel stays visible alongside the recognition ending in summary (desktop)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await landOnSummary(page, { required_set_complete: true, missing_required_set: [] });
    await expect(page.getByRole('region', { name: /your kitchen profile/i })).toBeVisible();
    await expect(page.getByTestId('recognition-ending')).toBeVisible();
    await expect(page.getByText(/all moments captured/i)).toHaveCount(0);
  });
});

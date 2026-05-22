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

test.describe('Slice 2.5-s10: Summary + Finalize Gate', () => {
  // AC8a — header subtitle switches to summary-specific copy.
  test('header subtitle shows "Summary · Lock in your kitchen" in summary moment', async ({
    page,
  }) => {
    await landOnSummary(page);
    await expect(page.getByText(/summary · lock in your kitchen/i)).toBeVisible();
  });

  // AC8c — finalize gate replaces the input bar when in summary.
  test('finalize gate renders and input bar is hidden when moment is summary', async ({
    page,
  }) => {
    await landOnSummary(page);
    await expect(page.getByTestId('finalize-gate')).toBeVisible();
    await expect(page.getByLabel(/your message to lumi/i)).not.toBeVisible();
  });

  // AC8c + P4 — Finalize button is enabled only when server confirms required_set_complete.
  test('Finalize button is enabled when required-set is complete', async ({ page }) => {
    await landOnSummary(page, { required_set_complete: true, missing_required_set: [] });
    const btn = page.getByTestId('finalize-button');
    await expect(btn).toBeVisible();
    await expect(btn).not.toBeDisabled();
    await expect(btn).toContainText(/finalize/i);
  });

  // AC8c + P4 — Finalize button stays disabled when required_set_complete is false.
  test('Finalize button is disabled when required-set is incomplete', async ({ page }) => {
    await landOnSummary(page, {
      required_set_complete: false,
      missing_required_set: ['m5_starting_line'],
    });
    await expect(page.getByTestId('finalize-button')).toBeDisabled();
  });

  // AC8b — gap callout for m5_starting_line shows correct label + back button.
  test('gap callout for m5_starting_line shows label and "Back to Moment 5"', async ({
    page,
  }) => {
    await landOnSummary(page, {
      required_set_complete: false,
      missing_required_set: ['m5_starting_line'],
    });
    const callout = page.getByTestId('gap-callout-m5_starting_line');
    await expect(callout).toBeVisible();
    await expect(callout).toContainText(/a starting line for lumi/i);
    await expect(callout).toContainText(/back to moment 5/i);
  });

  // AC8b — gap callout for m1_table shows correct label + back button.
  test('gap callout for m1_table shows label and "Back to Moment 1"', async ({ page }) => {
    await landOnSummary(page, {
      required_set_complete: false,
      missing_required_set: ['m1_table'],
    });
    const callout = page.getByTestId('gap-callout-m1_table');
    await expect(callout).toBeVisible();
    await expect(callout).toContainText(/who's at the table/i);
    await expect(callout).toContainText(/back to moment 1/i);
  });

  // AC8b — gap callout for m2_safe shows correct label + back button.
  test('gap callout for m2_safe shows label and "Back to Moment 2"', async ({ page }) => {
    await landOnSummary(page, {
      required_set_complete: false,
      missing_required_set: ['m2_safe'],
    });
    const callout = page.getByTestId('gap-callout-m2_safe');
    await expect(callout).toBeVisible();
    await expect(callout).toContainText(/what i need to keep safe/i);
    await expect(callout).toContainText(/back to moment 2/i);
  });

  // AC8b — "Back to Moment N" click restores the input bar (client-side navigation).
  test('"Back to Moment N" tap restores the input bar', async ({ page }) => {
    await landOnSummary(page, {
      required_set_complete: false,
      missing_required_set: ['m5_starting_line'],
    });
    await page.getByRole('button', { name: /back to moment 5/i }).click();
    // Input bar must reappear — no longer in summary mode client-side.
    await expect(page.getByLabel(/your message to lumi/i)).toBeVisible();
    await expect(page.getByTestId('finalize-gate')).not.toBeVisible();
  });

  // AC8c — status text shows "Ready when you are." when required-set complete.
  test('status text shows "Ready when you are." when required-set is complete', async ({
    page,
  }) => {
    await landOnSummary(page, { required_set_complete: true, missing_required_set: [] });
    await expect(page.getByText(/ready when you are/i)).toBeVisible();
  });

  // AC8c — status text shows amber copy when required-set incomplete.
  test('status text shows incomplete copy when required-set is incomplete', async ({
    page,
  }) => {
    await landOnSummary(page, {
      required_set_complete: false,
      missing_required_set: ['m2_safe'],
    });
    await expect(
      page.getByText(/a few things still need to be answered above/i),
    ).toBeVisible();
  });

  // AC5 (gate line) — "Finalize seals your kitchen" renders below the gate when complete.
  test('gate line shows "Finalize seals your kitchen" when required-set complete', async ({
    page,
  }) => {
    await landOnSummary(page, { required_set_complete: true, missing_required_set: [] });
    await expect(
      page.getByText(/finalize seals your kitchen and starts your first plan/i),
    ).toBeVisible();
  });

  // AC4 + AC5 — tapping Finalize POSTs to /v1/onboarding/text/finalize.
  test('tapping Finalize calls POST /v1/onboarding/text/finalize', async ({ page }) => {
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
    await page.getByTestId('finalize-button').click();

    await expect.poll(() => finalizeCalled).toBe(true);
  });

  // AC8d — KitchenProfilePanel shows "All moments captured" footer in summary (desktop).
  test('profile panel shows "All moments captured" in summary moment (desktop)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await landOnSummary(page, { required_set_complete: true, missing_required_set: [] });
    await expect(page.getByText(/all moments captured/i).first()).toBeVisible();
  });
});

import { test, expect } from '@playwright/test';
import { loginAndNavigate } from './_helpers.js';

const TURN_URL = '**/v1/onboarding/text/turn';

const M4_CHIP_CONFIG = {
  mode: 'action',
  options: [
    { key: 'main_only', label: 'Main only' },
    { key: 'main_plus_snack', label: 'Main + snack' },
    { key: 'main_plus_extra', label: 'Main + sides' },
    { key: 'main_plus_snack_plus_extra', label: 'Full bag' },
  ],
};

function turnResponse(overrides: {
  lumi_response?: string;
  moment_key?: string | null;
  chip_config?: unknown;
  is_complete?: boolean;
}) {
  return {
    thread_id: '88888888-8888-4888-8888-888888888888',
    turn_id: '44444444-4444-4444-8444-444444444444',
    lumi_turn_id: '55555555-5555-4555-8555-555555555555',
    lumi_response:
      overrides.lumi_response ?? "What goes in their bag?",
    is_complete: overrides.is_complete ?? false,
    chip_config: overrides.chip_config ?? null,
    moment_key: overrides.moment_key ?? null,
  };
}

/** Route all /turn calls to return the m4_bag moment and navigate to /onboarding. */
async function landOnM4(page: Parameters<typeof loginAndNavigate>[0]) {
  await page.route(TURN_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        turnResponse({
          moment_key: 'm4_bag',
          chip_config: M4_CHIP_CONFIG,
          lumi_response: 'What goes in their lunch bag?',
        }),
      ),
    }),
  );

  await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
  await page.getByRole('button', { name: /i'd rather type/i }).click();
  await page.getByLabel(/your message to lumi/i).fill('Two kids — Layla and Adam.');
  await page.getByRole('button', { name: /^send$/i }).click();

  // Wait for M4 chips to appear.
  await expect(page.getByRole('radiogroup', { name: 'Suggested replies' })).toBeVisible();
}

test.describe('Slice 2.5-s8: Moment 4 — What goes in the bag', () => {
  // AC1 / AC5 — chip config renders 4 single-select action chips with the correct
  // labels and keys for m4_bag. Role is 'radio' (action mode = single-select).
  test('renders all 4 M4 action chips with correct labels when agent enters m4_bag', async ({
    page,
  }) => {
    await landOnM4(page);

    for (const { label } of M4_CHIP_CONFIG.options) {
      await expect(page.getByRole('radio', { name: label, exact: true })).toBeVisible();
    }
  });

  // AC1 — "Tap one" label appears for action mode (not "Tap any that apply").
  test('shows "Tap one" label above M4 chips (action mode, not multi-select)', async ({ page }) => {
    await landOnM4(page);

    await expect(page.getByText(/tap one/i)).toBeVisible();
    await expect(page.getByText(/tap any that apply/i)).not.toBeVisible();
  });

  // AC1 — No skip chip at M4 (required-response gate, no skip_label in config).
  test('no skip chip is visible at m4_bag (required response — not skippable)', async ({ page }) => {
    await landOnM4(page);

    await expect(page.getByRole('button', { name: /skip/i })).not.toBeVisible();
  });

  // AC5 — tapping a chip marks it selected (aria-checked=true) and deselects others.
  test('tapping a chip selects it and deselects the previously selected chip', async ({ page }) => {
    await landOnM4(page);

    const snackChip = page.getByRole('radio', { name: 'Main + snack', exact: true });
    const fullBagChip = page.getByRole('radio', { name: 'Full bag', exact: true });

    await snackChip.click();
    await expect(snackChip).toHaveAttribute('aria-checked', 'true');
    await expect(fullBagChip).toHaveAttribute('aria-checked', 'false');

    await fullBagChip.click();
    await expect(fullBagChip).toHaveAttribute('aria-checked', 'true');
    await expect(snackChip).toHaveAttribute('aria-checked', 'false');
  });

  // AC6 / AC7 — M4 bag card appears in "Still listening…" state when the agent
  // enters m4_bag. Requires a wide viewport to show the right-column profile panel.
  test('M4 bag card shows "Still listening…" in the profile panel when agent enters m4_bag', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await landOnM4(page);

    const card = page.getByTestId('m4-bag-card').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText(/still listening/i);
  });

  // AC6 / AC7 — M4 bag card transitions to "Saved" after the parent submits a chip
  // and the agent advances to m5_starting_line.
  test('M4 bag card shows "Saved" copy after agent advances past m4_bag', async ({ page }) => {
    let callCount = 0;
    await page.route(TURN_URL, (route) => {
      callCount += 1;
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          callCount === 1
            ? turnResponse({
                moment_key: 'm4_bag',
                chip_config: M4_CHIP_CONFIG,
                lumi_response: 'What goes in their lunch bag?',
              })
            : turnResponse({
                moment_key: 'm5_starting_line',
                lumi_response: "Great — now let's pick 10 favourite lunches as a starting point.",
              }),
        ),
      });
    });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Two kids — Layla and Adam.');
    await page.getByRole('button', { name: /^send$/i }).click();

    // Wait for M4 chips.
    await expect(page.getByRole('radiogroup', { name: 'Suggested replies' })).toBeVisible();

    // Tap a chip and submit.
    await page.getByRole('radio', { name: 'Main + snack', exact: true }).click();
    await page.getByRole('button', { name: /^send$/i }).click();

    // Card should flip to "Saved" state.
    const card = page.getByTestId('m4-bag-card').first();
    await expect(card).toContainText(/saved/i);
    await expect(card).not.toContainText(/still listening/i);
  });

  // AC4 / AC5 — the chip selection key (matching BagCompositionPatternSchema) is
  // included in the POST body as chip_selections when the parent taps a chip and submits.
  test('POST body contains chip_selections with the tapped chip key', async ({ page }) => {
    let callCount = 0;
    let capturedChipBody: Record<string, unknown> | null = null;

    await page.route(TURN_URL, async (route) => {
      callCount += 1;
      if (callCount === 2) {
        capturedChipBody = await route.request().postDataJSON() as Record<string, unknown>;
      }
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          callCount === 1
            ? turnResponse({
                moment_key: 'm4_bag',
                chip_config: M4_CHIP_CONFIG,
                lumi_response: 'What goes in their lunch bag?',
              })
            : turnResponse({
                moment_key: 'm5_starting_line',
                lumi_response: "Let's pick favourites.",
              }),
        ),
      });
    });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Two kids — Layla and Adam.');
    await page.getByRole('button', { name: /^send$/i }).click();

    // Wait for M4 chips to appear before tapping.
    await expect(page.getByRole('radiogroup', { name: 'Suggested replies' })).toBeVisible();

    // Tap "Full bag" chip — key: 'main_plus_snack_plus_extra'.
    await page.getByRole('radio', { name: 'Full bag', exact: true }).click();
    await page.getByRole('button', { name: /^send$/i }).click();

    // Wait for the second turn's Lumi response to confirm the request was made.
    await expect(page.getByText(/let's pick favourites/i)).toBeVisible();

    expect(capturedChipBody).toMatchObject({
      chip_selections: ['main_plus_snack_plus_extra'],
    });
  });
});

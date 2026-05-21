import { test, expect } from '@playwright/test';
import { loginAndNavigate } from './_helpers.js';

const TURN_URL = '**/v1/onboarding/text/turn';

const M2_CHIP_CONFIG = {
  mode: 'choice',
  options: [
    { key: 'none', label: 'No known allergens' },
    { key: 'peanut', label: 'Peanut' },
    { key: 'tree-nuts', label: 'Tree nuts' },
    { key: 'dairy', label: 'Dairy' },
    { key: 'eggs', label: 'Eggs' },
    { key: 'soy', label: 'Soy' },
    { key: 'wheat', label: 'Wheat / gluten' },
    { key: 'fish', label: 'Fish' },
    { key: 'shellfish', label: 'Shellfish' },
    { key: 'sesame', label: 'Sesame' },
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
      overrides.lumi_response ?? 'Any allergens or dietary needs I should know about?',
    is_complete: overrides.is_complete ?? false,
    chip_config: overrides.chip_config ?? null,
    moment_key: overrides.moment_key ?? null,
  };
}

async function landOnM2(page: Parameters<typeof loginAndNavigate>[0]) {
  await page.route(TURN_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        turnResponse({
          moment_key: 'm2_safe',
          chip_config: M2_CHIP_CONFIG,
          lumi_response: 'Any allergens or dietary needs I should know about?',
        }),
      ),
    }),
  );

  await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
  await page.getByRole('button', { name: /i'd rather type/i }).click();
  await page.getByLabel(/your message to lumi/i).fill('The Sharma kitchen — two kids');
  await page.getByRole('button', { name: /^send$/i }).click();

  // Wait for M2 chip config to appear.
  await expect(page.getByRole('checkbox', { name: 'No known allergens' })).toBeVisible();
}

test.describe("Slice 2.5-s6: Moment 2 — What I need to keep safe", () => {
  // AC5 — chip config renders 10 allergen/dietary options for m2_safe moment.
  test('renders all 10 M2 choice chips when agent enters m2_safe', async ({ page }) => {
    await landOnM2(page);

    for (const { label } of M2_CHIP_CONFIG.options) {
      await expect(page.getByRole('checkbox', { name: label, exact: true })).toBeVisible();
    }
  });

  // AC6.1 — "No known allergens" is mutually exclusive with allergen chips.
  // Tapping an allergen chip after tapping "none" clears "none".
  test('"No known allergens" clears when an allergen chip is tapped after it', async ({
    page,
  }) => {
    await landOnM2(page);

    await page.getByRole('checkbox', { name: 'No known allergens' }).click();
    // "none" should now be selected (aria-checked=true).
    await expect(page.getByRole('checkbox', { name: 'No known allergens' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Tapping an allergen chip must deselect "none".
    await page.getByRole('checkbox', { name: 'Peanut' }).click();
    await expect(page.getByRole('checkbox', { name: 'No known allergens' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(page.getByRole('checkbox', { name: 'Peanut' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  // AC6.1 — "No known allergens" mutual exclusion, reverse direction:
  // tapping "none" after selecting allergen chips clears those chips.
  test('tapping "No known allergens" clears all previously selected allergen chips', async ({
    page,
  }) => {
    await landOnM2(page);

    await page.getByRole('checkbox', { name: 'Peanut' }).click();
    await page.getByRole('checkbox', { name: 'Dairy' }).click();

    // Both allergen chips should be selected.
    await expect(page.getByRole('checkbox', { name: 'Peanut' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('checkbox', { name: 'Dairy' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Tapping "none" must clear all allergen chips.
    await page.getByRole('checkbox', { name: 'No known allergens' }).click();
    await expect(page.getByRole('checkbox', { name: 'Peanut' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(page.getByRole('checkbox', { name: 'Dairy' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(page.getByRole('checkbox', { name: 'No known allergens' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  // AC6.2 — Required status line is shown when no chips and no text are present.
  test('shows "Required" status line when no chip and no text are present at M2', async ({
    page,
  }) => {
    await landOnM2(page);

    await expect(page.getByTestId('m2-status-line')).toContainText(/required/i);
  });

  // AC6.2 — Send button is disabled until a chip is selected or text typed.
  test('Send button is disabled at M2 until a chip is selected or text is typed', async ({
    page,
  }) => {
    await landOnM2(page);

    const sendBtn = page.getByRole('button', { name: /^send$/i });
    await expect(sendBtn).toBeDisabled();

    await page.getByRole('checkbox', { name: 'Peanut' }).click();
    await expect(sendBtn).toBeEnabled();
  });

  // AC6.2 — status line shows count copy when allergen chips are selected.
  test('status line shows selection count when allergen chips are selected', async ({ page }) => {
    await landOnM2(page);

    await page.getByRole('checkbox', { name: 'Peanut' }).click();
    await expect(page.getByTestId('m2-status-line')).toContainText(
      /1 selection will be sent with your message/i,
    );

    await page.getByRole('checkbox', { name: 'Dairy' }).click();
    await expect(page.getByTestId('m2-status-line')).toContainText(
      /2 selections will be sent with your message/i,
    );
  });

  // AC6.2 — status line shows "No known allergens — confirmed" when none chip is selected.
  test('status line shows confirmation copy when "No known allergens" is selected', async ({
    page,
  }) => {
    await landOnM2(page);

    await page.getByRole('checkbox', { name: 'No known allergens' }).click();
    await expect(page.getByTestId('m2-status-line')).toContainText(
      /no known allergens — confirmed/i,
    );
  });

  // AC6.3 — M2 placeholder.
  test('textarea shows M2-specific placeholder at m2_safe', async ({ page }) => {
    await landOnM2(page);

    await expect(
      page.getByPlaceholder(/add details — which child, severity, anything special/i),
    ).toBeVisible();
  });

  // AC7.3 — safety card shows "Waiting on your response…" while in m2_safe.
  test('safety card shows "Waiting on your response…" when m2_safe moment is active', async ({
    page,
  }) => {
    await landOnM2(page);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId('m2-safety-card').first()).toBeVisible();
    await expect(page.getByTestId('m2-safety-card').first()).toContainText(/waiting on your response/i);
  });

  // AC7.3 — safety card shows "✓ All clear" after submitting "No known allergens".
  test('safety card shows "All clear" after submitting "No known allergens"', async ({ page }) => {
    let callCount = 0;
    await page.route(TURN_URL, (route) => {
      callCount += 1;
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          callCount === 1
            ? turnResponse({
                moment_key: 'm2_safe',
                chip_config: M2_CHIP_CONFIG,
                lumi_response: 'Any allergens or dietary needs?',
              })
            : turnResponse({
                moment_key: 'm3_taste',
                lumi_response: 'Great, moving on to taste preferences.',
              }),
        ),
      });
    });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Sharma kitchen — two kids');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByRole('checkbox', { name: 'No known allergens', exact: true })).toBeVisible();

    // Select "none" and submit.
    await page.getByRole('checkbox', { name: 'No known allergens', exact: true }).click();
    await page.getByRole('button', { name: /^send$/i }).click();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByTestId('m2-safety-card').first()).toContainText(/all clear/i);
  });

  // AC7.3 — safety card shows allergen badge(s) after submitting allergen chip(s).
  test('safety card shows allergen badges after submitting allergen chips', async ({ page }) => {
    let callCount = 0;
    await page.route(TURN_URL, (route) => {
      callCount += 1;
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          callCount === 1
            ? turnResponse({
                moment_key: 'm2_safe',
                chip_config: M2_CHIP_CONFIG,
                lumi_response: 'Any allergens?',
              })
            : turnResponse({
                moment_key: 'm3_taste',
                lumi_response: "Got it. Let's talk taste.",
              }),
        ),
      });
    });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Sharma kitchen — two kids');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByRole('checkbox', { name: 'No known allergens', exact: true })).toBeVisible();

    // Select two allergen chips and submit.
    await page.getByRole('checkbox', { name: 'Peanut' }).click();
    await page.getByRole('checkbox', { name: 'Dairy' }).click();
    await page.getByRole('button', { name: /^send$/i }).click();

    await page.setViewportSize({ width: 1280, height: 800 });
    const safetyCard = page.getByTestId('m2-safety-card').first();
    await expect(safetyCard).toBeVisible();
    await expect(safetyCard).toContainText('Peanut');
    await expect(safetyCard).toContainText('Dairy');
  });
});

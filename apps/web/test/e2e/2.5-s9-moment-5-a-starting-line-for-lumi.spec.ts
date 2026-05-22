import { test, expect } from '@playwright/test';
import { loginAndNavigate } from './_helpers.js';

const TURN_URL = '**/v1/onboarding/text/turn';

const M5_CHIP_CONFIG = {
  mode: 'choice',
  options: [
    { key: 'paratha-roll', label: 'Paratha roll' },
    { key: 'dal-rice-thermos', label: 'Dal + rice (thermos)' },
    { key: 'idli', label: 'Idli + chutney' },
    { key: 'dosa', label: 'Dosa roll' },
    { key: 'khichdi', label: 'Khichdi thermos' },
    { key: 'biryani', label: 'Biryani (thermos)' },
    { key: 'sandwich', label: 'Sandwich' },
    { key: 'wrap', label: 'Wrap' },
    { key: 'pasta-salad', label: 'Pasta salad' },
    { key: 'rice-bowl', label: 'Rice bowl' },
    { key: 'quesadilla', label: 'Quesadilla' },
    { key: 'hummus-pita', label: 'Hummus + pita' },
    { key: 'noodle-box', label: 'Noodle box' },
    { key: 'pizza-slice', label: 'Pizza slice' },
    { key: 'sushi-roll', label: 'Sushi roll' },
    { key: 'bagel-spread', label: 'Bagel + spread' },
    { key: 'bento-box', label: 'Bento box' },
    { key: 'tortilla-pinwheels', label: 'Tortilla pinwheels' },
  ],
};

const M5_CHIP_CONFIG_WITH_OVERRIDE = {
  ...M5_CHIP_CONFIG,
  options: [
    ...M5_CHIP_CONFIG.options,
    { key: 'override_fewer', label: 'Start with fewer' },
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
      overrides.lumi_response ?? "Let's pick 10 favourite lunches as a starting point.",
    is_complete: overrides.is_complete ?? false,
    chip_config: overrides.chip_config ?? null,
    moment_key: overrides.moment_key ?? null,
  };
}

/** Route all /turn calls to return m5_starting_line and navigate to /onboarding. */
async function landOnM5(page: Parameters<typeof loginAndNavigate>[0]) {
  await page.route(TURN_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        turnResponse({
          moment_key: 'm5_starting_line',
          chip_config: M5_CHIP_CONFIG,
          lumi_response: "Let's pick 10 favourite lunches as a starting point.",
        }),
      ),
    }),
  );

  await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
  await page.getByRole('button', { name: /i'd rather type/i }).click();
  await page.getByLabel(/your message to lumi/i).fill('Two kids — Layla and Adam.');
  await page.getByRole('button', { name: /^send$/i }).click();

  // Wait for M5 chips to appear (choice mode = group, not radiogroup).
  await expect(page.getByRole('group', { name: 'Suggested replies' })).toBeVisible();
}

test.describe('Slice 2.5-s9: Moment 5 — A starting line for Lumi', () => {
  // AC1 — chip config renders all 18 multi-select choice chips with correct labels.
  // Verifies the static catalog in momentToChipConfig matches Moment5Page.tsx verbatim.
  test('renders all 18 M5 choice chips with correct labels', async ({ page }) => {
    await landOnM5(page);

    for (const { label } of M5_CHIP_CONFIG.options) {
      await expect(page.getByRole('checkbox', { name: label, exact: true })).toBeVisible();
    }
  });

  // AC1 — "Tap any that apply" appears for choice mode; "Tap one" must not appear.
  test('shows "Tap any that apply" label for M5 chips (multi-select, not single-select)', async ({
    page,
  }) => {
    await landOnM5(page);

    await expect(page.getByText(/tap any that apply/i)).toBeVisible();
    await expect(page.getByText(/^tap one$/i)).not.toBeVisible();
  });

  // AC1 — M5 is a required-response gate. No skip_label in the static chip config.
  test('no skip chip is visible at m5_starting_line (required-response — not skippable)', async ({
    page,
  }) => {
    await landOnM5(page);

    await expect(page.getByRole('button', { name: /skip/i })).not.toBeVisible();
  });

  // AC1 — Choice chips use role="checkbox"; multiple can be aria-checked simultaneously.
  test('multiple chips can be selected at the same time (multi-select)', async ({ page }) => {
    await landOnM5(page);

    const parathaChip = page.getByRole('checkbox', { name: 'Paratha roll', exact: true });
    const sandwichChip = page.getByRole('checkbox', { name: 'Sandwich', exact: true });
    const wrapChip = page.getByRole('checkbox', { name: 'Wrap', exact: true });

    await parathaChip.click();
    await sandwichChip.click();
    await wrapChip.click();

    await expect(parathaChip).toHaveAttribute('aria-checked', 'true');
    await expect(sandwichChip).toHaveAttribute('aria-checked', 'true');
    await expect(wrapChip).toHaveAttribute('aria-checked', 'true');
  });

  // AC2 — "Start with fewer" override chip renders when the server returns it in chip_config.
  // The server only includes override_fewer when favorite_lunch_count >= 4.
  test('override chip "Start with fewer" renders when server includes it in chip_config', async ({
    page,
  }) => {
    await page.route(TURN_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          turnResponse({
            moment_key: 'm5_starting_line',
            chip_config: M5_CHIP_CONFIG_WITH_OVERRIDE,
            lumi_response: 'Six down, four to go — or start with what you have.',
          }),
        ),
      }),
    );

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Six chips already.');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByRole('group', { name: 'Suggested replies' })).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: 'Start with fewer', exact: true }),
    ).toBeVisible();
  });

  // AC7 — M5 "Still listening…" card appears in the right-column profile panel
  // the moment the agent enters m5_starting_line. Requires wide viewport.
  test('M5 card shows "Still listening…" in the profile panel when agent enters m5_starting_line', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await landOnM5(page);

    const card = page.getByTestId('m5-starting-line-card').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText(/still listening/i);
  });

  // AC7 — M5 card transitions to "X lunches — Lumi has a starting line." after the
  // parent submits chips and the agent advances to summary.
  test('M5 card shows session chip count after agent advances past m5_starting_line', async ({
    page,
  }) => {
    let callCount = 0;
    await page.route(TURN_URL, (route) => {
      callCount += 1;
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          callCount === 1
            ? turnResponse({
                moment_key: 'm5_starting_line',
                chip_config: M5_CHIP_CONFIG,
                lumi_response: "Let's pick 10 favourite lunches.",
              })
            : turnResponse({
                moment_key: 'summary',
                chip_config: null,
                lumi_response: "All set — here's what we've gathered.",
              }),
        ),
      });
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Two kids — Layla and Adam.');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByRole('group', { name: 'Suggested replies' })).toBeVisible();

    // Tap 3 chips and submit — agent advances to summary.
    await page.getByRole('checkbox', { name: 'Paratha roll', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Sandwich', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Wrap', exact: true }).click();
    await page.getByRole('button', { name: /^send$/i }).click();

    const card = page.getByTestId('m5-starting-line-card').first();
    await expect(card).toContainText(/3 lunches — Lumi has a starting line\./);
    await expect(card).not.toContainText(/still listening/i);
    await expect(card).not.toContainText(/started with fewer/i);
  });

  // AC7 — "(started with fewer)" suffix appears on the M5 card when the override chip
  // was included in the submitted chip_selections and the agent advanced past M5.
  test('M5 card shows "(started with fewer)" suffix when parent invokes the override chip', async ({
    page,
  }) => {
    let callCount = 0;
    await page.route(TURN_URL, (route) => {
      callCount += 1;
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          callCount === 1
            ? turnResponse({
                moment_key: 'm5_starting_line',
                chip_config: M5_CHIP_CONFIG_WITH_OVERRIDE,
                lumi_response: 'Four down — start with what you have?',
              })
            : turnResponse({
                moment_key: 'summary',
                chip_config: null,
                lumi_response: "Starting strong with what we've got.",
              }),
        ),
      });
    });

    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Two kids — Layla and Adam.');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByRole('group', { name: 'Suggested replies' })).toBeVisible();

    // Tap one real chip + the override chip.
    await page.getByRole('checkbox', { name: 'Paratha roll', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Start with fewer', exact: true }).click();
    await page.getByRole('button', { name: /^send$/i }).click();

    const card = page.getByTestId('m5-starting-line-card').first();
    await expect(card).toContainText(/lunches — Lumi has a starting line\./);
    await expect(card).toContainText(/started with fewer/i);
  });

  // AC4 — POST body carries all selected chip keys in chip_selections (multi-key array).
  test('POST body contains all tapped chip keys in chip_selections', async ({ page }) => {
    let callCount = 0;
    let capturedBody: Record<string, unknown> | null = null;

    await page.route(TURN_URL, async (route) => {
      callCount += 1;
      if (callCount === 2) {
        capturedBody = (await route.request().postDataJSON()) as Record<string, unknown>;
      }
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          callCount === 1
            ? turnResponse({
                moment_key: 'm5_starting_line',
                chip_config: M5_CHIP_CONFIG,
                lumi_response: "Let's pick 10 favourite lunches.",
              })
            : turnResponse({
                moment_key: 'm5_starting_line',
                chip_config: M5_CHIP_CONFIG,
                lumi_response: 'Good start! Keep picking.',
              }),
        ),
      });
    });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Two kids — Layla and Adam.');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByRole('group', { name: 'Suggested replies' })).toBeVisible();

    // Tap 3 chips — keys must all appear in chip_selections.
    await page.getByRole('checkbox', { name: 'Paratha roll', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Dal + rice (thermos)', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Wrap', exact: true }).click();
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByText(/good start/i)).toBeVisible();

    expect(capturedBody).toMatchObject({
      chip_selections: expect.arrayContaining(['paratha-roll', 'dal-rice-thermos', 'wrap']),
    });
    expect((capturedBody?.chip_selections as string[]).length).toBe(3);
  });
});

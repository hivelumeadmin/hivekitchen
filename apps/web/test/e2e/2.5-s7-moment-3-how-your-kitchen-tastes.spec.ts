import { test, expect } from '@playwright/test';
import { loginAndNavigate } from './_helpers.js';

const TURN_URL = '**/v1/onboarding/text/turn';

const M3_HINT_CHIP_CONFIG = {
  mode: 'hint',
  hints: [
    'Halal Punjabi household, mostly home-cooked Indian',
    'Italian heritage, kids love pasta — dairy-light for the youngest',
    'Hindu vegetarian — South Indian for me, Mexican for them',
  ],
  skip_label: 'Skip this moment',
};

const M3_ELEVATION_CHIP_CONFIG = {
  mode: 'action',
  options: [
    { key: 'always-respect', label: 'Always respect' },
    { key: 'prefer', label: 'Prefer when possible' },
    { key: 'just-context', label: 'Just for context' },
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
    lumi_response: overrides.lumi_response ?? 'Tell me about your kitchen culture.',
    is_complete: overrides.is_complete ?? false,
    chip_config: overrides.chip_config ?? null,
    moment_key: overrides.moment_key ?? null,
  };
}

/** Route all /turn calls to return the m3_taste moment and navigate to /onboarding.
 *  SkipChip renders as <button role="radio"> so we wait on role='radio'. */
async function landOnM3(page: Parameters<typeof loginAndNavigate>[0]) {
  await page.route(TURN_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        turnResponse({
          moment_key: 'm3_taste',
          chip_config: M3_HINT_CHIP_CONFIG,
          lumi_response: 'Tell me about your kitchen culture — religion, cuisine, food values.',
        }),
      ),
    }),
  );

  await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
  await page.getByRole('button', { name: /i'd rather type/i }).click();
  await page.getByLabel(/your message to lumi/i).fill('Two kids — Layla and Adam.');
  await page.getByRole('button', { name: /^send$/i }).click();

  // SkipChip is a <button role="radio"> (ChoiceChip mode="single" variant="skip").
  await expect(page.getByRole('radio', { name: /skip this moment/i })).toBeVisible();
}

test.describe('Slice 2.5-s7: Moment 3 — How your kitchen tastes', () => {
  // AC8 — hint chip config renders 3 hint chips (non-interactive, illustrative).
  // HintChip wraps text in curly quotes ("…") so exact match would fail — use
  // partial match (default) which finds the text as a substring of the rendered span.
  test('renders all 3 M3 hint chips when agent enters m3_taste', async ({ page }) => {
    await landOnM3(page);

    for (const hint of M3_HINT_CHIP_CONFIG.hints) {
      await expect(page.getByText(hint)).toBeVisible();
    }
  });

  // AC8 — "Something like" label appears above hint chips.
  test('shows "Something like" label above M3 hint chips', async ({ page }) => {
    await landOnM3(page);

    await expect(page.getByText(/something like/i)).toBeVisible();
  });

  // AC8 — skip chip is visible and labelled "Skip this moment" at M3
  // (M3 is optional — the skip affordance is first-class).
  // SkipChip renders role="radio" via ChoiceChip(mode="single").
  test('skip chip is visible at m3_taste (M3 is optional)', async ({ page }) => {
    await landOnM3(page);

    await expect(page.getByRole('radio', { name: /skip this moment/i })).toBeVisible();
  });

  // AC8 — no action chip group is visible in hint mode (hint chips are not selectable).
  test('no radiogroup / action chip group is visible in M3 hint mode', async ({ page }) => {
    await landOnM3(page);

    await expect(page.getByRole('radiogroup', { name: 'Suggested replies' })).not.toBeVisible();
  });

  // AC11 — M3 taste card shows "Waiting on your response…" in the profile panel
  // when agent enters m3_taste. Requires wide viewport to show the right column.
  test('M3 taste card shows "Waiting on your response…" in the profile panel when m3_taste is active', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await landOnM3(page);

    const card = page.getByTestId('m3-taste-card').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText(/waiting on your response/i);
  });

  // AC11 — M3 taste card shows "Skipped for now" when the parent taps Skip.
  test('M3 taste card shows "Skipped for now" copy after parent taps Skip', async ({ page }) => {
    let callCount = 0;
    await page.route(TURN_URL, (route) => {
      callCount += 1;
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          callCount === 1
            ? turnResponse({
                moment_key: 'm3_taste',
                chip_config: M3_HINT_CHIP_CONFIG,
                lumi_response: 'Tell me about your kitchen culture.',
              })
            : turnResponse({
                moment_key: 'm4_bag',
                lumi_response: "No problem — you can always tell me later. What goes in the bag?",
              }),
        ),
      });
    });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Two kids — Layla and Adam.');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByRole('radio', { name: /skip this moment/i })).toBeVisible();

    // Tap the skip chip.
    await page.getByRole('radio', { name: /skip this moment/i }).click();

    const card = page.getByTestId('m3-taste-card').first();
    await expect(card).toContainText(/skipped for now/i);
    await expect(card).not.toContainText(/waiting on your response/i);
  });

  // AC11 — M3 taste card transitions to "Noted" state when the parent submits
  // free text and the agent advances out of m3_taste.
  test('M3 taste card shows "Noted" copy after parent submits free text and agent advances', async ({
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
                moment_key: 'm3_taste',
                chip_config: M3_HINT_CHIP_CONFIG,
                lumi_response: 'Tell me about your kitchen culture.',
              })
            : turnResponse({
                moment_key: 'm4_bag',
                lumi_response: "Lovely, I've noted that. What goes in their lunch bag?",
              }),
        ),
      });
    });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Two kids — Layla and Adam.');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByRole('radio', { name: /skip this moment/i })).toBeVisible();

    // Submit free text response (no chip tap — hint chips are non-interactive).
    await page.getByLabel(/your message to lumi/i).fill('We are a Halal household, mostly home-cooked.');
    await page.getByRole('button', { name: /^send$/i }).click();

    // Wait for the second turn's Lumi response to confirm the request landed.
    await expect(page.getByText(/what goes in their lunch bag/i)).toBeVisible();

    const card = page.getByTestId('m3-taste-card').first();
    await expect(card).toContainText(/noted/i);
    await expect(card).not.toContainText(/waiting on your response/i);
  });

  // AC9 / AC12 — elevation chip flow: when the agent emits elevation chips,
  // 3 action chips ("Always respect", "Prefer when possible", "Just for context")
  // render instead of the hint chips, and they are single-select (radio).
  // The skip chip should NOT be visible on the elevation follow-up (no skip_label).
  test('renders elevation action chips (single-select) when agent emits elevation chip_config', async ({
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
                moment_key: 'm3_taste',
                chip_config: M3_HINT_CHIP_CONFIG,
                lumi_response: 'Tell me about your kitchen culture.',
              })
            : turnResponse({
                moment_key: 'm3_taste',
                chip_config: M3_ELEVATION_CHIP_CONFIG,
                lumi_response:
                  "Got it — 'strictly Halal.' Should I treat that as a hard rule I always respect, or more like a preference?",
              }),
        ),
      });
    });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Two kids — Layla and Adam.');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByRole('radio', { name: /skip this moment/i })).toBeVisible();

    // Submit a response that triggers the elevation follow-up.
    await page.getByLabel(/your message to lumi/i).fill("We're strictly Halal.");
    await page.getByRole('button', { name: /^send$/i }).click();

    // Wait for elevation chip group (action mode → radiogroup).
    await expect(page.getByRole('radiogroup', { name: 'Suggested replies' })).toBeVisible();

    for (const { label } of M3_ELEVATION_CHIP_CONFIG.options) {
      await expect(page.getByRole('radio', { name: label, exact: true })).toBeVisible();
    }

    // Elevation config has no skip_label — skip chip must be absent.
    await expect(page.getByRole('radio', { name: /skip this moment/i })).not.toBeVisible();
  });
});

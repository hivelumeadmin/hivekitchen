import { test, expect } from '@playwright/test';
import { loginAndNavigate } from './_helpers.js';

// Slice 2.6-s4 — M5 Chip Card Personalization (Wire-Format Flip)
//
// Tests the new per-household catalog chip delivery:
//   - Chip keys are recipe UUIDs; labels are canonical_name strings
//   - parent_added chips render a leading ＋ badge (data-testid="chip-parent-added-badge")
//   - inferred / declared chips render no badge
//   - UUID keys appear verbatim in chip_selections POST body
//   - override_fewer appends correctly to the personalized chip set
//
// All tests mock the /turn endpoint — no real DB or Stage 1 pipeline required.

const TURN_URL = '**/v1/onboarding/text/turn';

// Stable recipe UUIDs used as chip keys after the wire-format flip.
const RECIPE_ID_ANJERO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECIPE_ID_BARIIS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RECIPE_ID_SANDWICH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const M5_PERSONALIZED_CONFIG = {
  mode: 'choice',
  options: [
    { key: RECIPE_ID_ANJERO,   label: 'Anjero + suqaar',    provenance: 'declared' },
    { key: RECIPE_ID_BARIIS,   label: 'Bariis iskukaris',   provenance: 'inferred' },
    { key: RECIPE_ID_SANDWICH, label: 'Sandwich',            provenance: 'parent_added' },
  ],
};

const M5_PERSONALIZED_WITH_OVERRIDE = {
  ...M5_PERSONALIZED_CONFIG,
  options: [
    ...M5_PERSONALIZED_CONFIG.options,
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
      overrides.lumi_response ?? "Here are some ideas — tap any that fit your family.",
    is_complete: overrides.is_complete ?? false,
    chip_config: overrides.chip_config ?? null,
    moment_key: overrides.moment_key ?? null,
  };
}

/** Route all /turn calls to return m5_starting_line with personalized chips. */
async function landOnM5Personalized(
  page: Parameters<typeof loginAndNavigate>[0],
  chipConfig = M5_PERSONALIZED_CONFIG,
) {
  await page.route(TURN_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        turnResponse({
          moment_key: 'm5_starting_line',
          chip_config: chipConfig,
          lumi_response: "Here are some ideas — tap any that fit your family.",
        }),
      ),
    }),
  );

  await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
  await page.getByRole('button', { name: /i'd rather type/i }).click();
  await page.getByLabel(/your message to lumi/i).fill('Two kids — Layla and Adam.');
  await page.getByRole('button', { name: /^send$/i }).click();

  await expect(page.getByRole('group', { name: 'Suggested replies' })).toBeVisible();
}

test.describe('Slice 2.6-s4: M5 Chip Personalization', () => {
  // AC2 / AC4 — personalized chips from the household catalog render at M5.
  // Keys are UUIDs; labels are canonical_name strings from the recipes table.
  test('renders personalized chips with UUID keys and canonical name labels', async ({ page }) => {
    await landOnM5Personalized(page);

    await expect(page.getByRole('checkbox', { name: 'Anjero + suqaar', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Bariis iskukaris', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Sandwich', exact: true })).toBeVisible();
  });

  // AC8 — parent_added chip renders leading ＋ badge (amber, bold).
  test('renders ＋ badge on chips with provenance="parent_added"', async ({ page }) => {
    await landOnM5Personalized(page);

    // "Sandwich" has provenance: 'parent_added' in the fixture — expect exactly one badge.
    const badges = page.getByTestId('chip-parent-added-badge');
    await expect(badges).toHaveCount(1);
    await expect(badges.first()).toHaveText('＋');
  });

  // AC8 — inferred and declared chips render no ＋ badge.
  test('renders no ＋ badge on chips with provenance="inferred" or "declared"', async ({ page }) => {
    await landOnM5Personalized(page, {
      mode: 'choice',
      options: [
        { key: RECIPE_ID_ANJERO, label: 'Anjero + suqaar', provenance: 'declared' },
        { key: RECIPE_ID_BARIIS, label: 'Bariis iskukaris', provenance: 'inferred' },
      ],
    });

    await expect(page.getByRole('checkbox', { name: 'Anjero + suqaar', exact: true })).toBeVisible();
    await expect(page.getByTestId('chip-parent-added-badge')).toHaveCount(0);
  });

  // AC8 — chips without a provenance field (non-M5 surfaces) render no badge.
  // Replicates the M2-allergen legacy shape to confirm the badge branch is M5-only.
  test('renders no ＋ badge on chips without a provenance field (legacy M2 shape)', async ({
    page,
  }) => {
    await page.route(TURN_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          turnResponse({
            moment_key: 'm2_safe',
            chip_config: {
              mode: 'choice',
              options: [
                { key: 'none', label: 'No known allergens' },
                { key: 'peanut', label: 'Peanut' },
              ],
            },
            lumi_response: 'Any allergens in the household?',
          }),
        ),
      }),
    );

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Two kids.');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByRole('checkbox', { name: 'Peanut', exact: true })).toBeVisible();
    await expect(page.getByTestId('chip-parent-added-badge')).toHaveCount(0);
  });

  // AC4 — chip_selections in the POST body carries the recipe UUID, not a slug.
  test('POST body contains recipe UUID keys in chip_selections (wire-format flip)', async ({
    page,
  }) => {
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
                chip_config: M5_PERSONALIZED_CONFIG,
                lumi_response: "Here are some ideas.",
              })
            : turnResponse({
                moment_key: 'm5_starting_line',
                chip_config: M5_PERSONALIZED_CONFIG,
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

    await page.getByRole('checkbox', { name: 'Anjero + suqaar', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Bariis iskukaris', exact: true }).click();
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByText(/good start/i)).toBeVisible();

    expect(capturedBody).toMatchObject({
      chip_selections: expect.arrayContaining([RECIPE_ID_ANJERO, RECIPE_ID_BARIIS]),
    });
    // Keys must be UUIDs, not hyphenated slugs.
    const selections = capturedBody?.chip_selections as string[];
    expect(selections.every((k) => /^[0-9a-f-]{36}$/.test(k))).toBe(true);
  });

  // AC4 — override_fewer renders alongside personalized UUID chips and is sendable.
  test('override_fewer chip renders and submits correctly alongside personalized chips', async ({
    page,
  }) => {
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
                chip_config: M5_PERSONALIZED_WITH_OVERRIDE,
                lumi_response: 'Four down — or start with what you have.',
              })
            : turnResponse({
                moment_key: 'summary',
                chip_config: null,
                lumi_response: "Great — here's your profile.",
              }),
        ),
      });
    });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Two kids — Layla and Adam.');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByRole('group', { name: 'Suggested replies' })).toBeVisible();

    // override_fewer renders as the last chip.
    await expect(
      page.getByRole('checkbox', { name: 'Start with fewer', exact: true }),
    ).toBeVisible();

    // Tap override_fewer and submit.
    await page.getByRole('checkbox', { name: 'Start with fewer', exact: true }).click();
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByText(/great/i)).toBeVisible();
    expect(capturedBody).toMatchObject({
      chip_selections: expect.arrayContaining(['override_fewer']),
    });
  });
});

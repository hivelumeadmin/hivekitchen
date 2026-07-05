import { test, expect } from '@playwright/test';
import { loginAndNavigate, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

const TURN_URL = '**/v1/onboarding/text/turn';
const KITCHEN_MAP_URL = '**/v1/households/*/kitchen-map';

// 13-s5 — the hero taste card is projection-sourced: it renders ONLY when the
// authoritative GET /households/:id/kitchen-map projection carries taste data
// (household dietary/cultural tags or liked food-preferences). The old
// client-side m3 state machine (Waiting/Skipped/Noted) was deleted.
function sampleKitchenMap(opts: {
  dietary?: string[];
  cultural?: string[];
} = {}): Record<string, unknown> {
  return {
    household: {
      id: SAMPLE_HOUSEHOLD_ID,
      tier: 'standard',
      tier_variant: 'control',
      timezone: 'Europe/London',
      display_name: 'Sharma Kitchen',
      cultural_identifiers: opts.cultural ?? [],
      dietary_preferences: opts.dietary ?? [],
      declared_allergens: [],
    },
    caregivers: [],
    children: [],
    cultural: { active: [], suggested: [] },
    memory: { nodes: [] },
    household_extras: { library: [] },
    recipes: { favourites: [], banned: [] },
    allergens: [],
    dietary: [],
    food_preferences: [],
    favorite_lunches: [],
    rules: [],
    meta: {
      composed_at: '2026-05-22T00:00:00.000Z',
      map_version: 1,
      schema_version: '1.1.0',
      is_complete: false,
      required_set_complete: false,
    },
  };
}

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

  // AC11 → 13-s5 — the taste card is projection-gated: while m3_taste is active
  // and the projection carries no taste data, NO taste card renders (the old
  // "Waiting on your response…" client-side state was deleted by design).
  test('taste card stays absent while m3_taste is active with an empty projection', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route(KITCHEN_MAP_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleKitchenMap()),
      }),
    );
    await landOnM3(page);

    await expect(page.getByTestId('taste-card')).toHaveCount(0);
  });

  // AC11 → 13-s5/13-s6 — tapping Skip advances the agent to m4_bag; no taste
  // card renders because the projection carries no taste data.
  test('Skip advances to m4_bag and no taste card renders (projection stays empty)', async ({
    page,
  }) => {
    await page.route(KITCHEN_MAP_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sampleKitchenMap()),
      }),
    );
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

    // The agent advances to m4_bag; a skipped M3 leaves the projection empty,
    // so no taste card ever appears (13-s5 — no client-side "Skipped for now").
    await expect(page.getByText(/moment 4 of 5 · what goes in the bag/i)).toBeVisible();
    await expect(page.getByTestId('taste-card')).toHaveCount(0);
  });

  // AC11 → 13-s5 — after the parent submits free text and the agent advances,
  // the taste card renders the tags the backend wrote, read back through the
  // kitchen-map projection (replaces the old client-side "Noted" state).
  test('taste card renders projection taste tags after parent submits free text and agent advances', async ({
    page,
  }) => {
    // Projection stays empty until the taste turn lands server-side.
    let tastePersisted = false;
    await page.route(KITCHEN_MAP_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          tastePersisted
            ? sampleKitchenMap({ dietary: ['Halal'], cultural: ['Punjabi'] })
            : sampleKitchenMap(),
        ),
      }),
    );
    let callCount = 0;
    await page.route(TURN_URL, (route) => {
      callCount += 1;
      if (callCount >= 2) tastePersisted = true;
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

    // The hero refetches the projection after the turn — taste tags land.
    const card = page.getByTestId('taste-card').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Halal');
    await expect(card).toContainText('Punjabi');
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

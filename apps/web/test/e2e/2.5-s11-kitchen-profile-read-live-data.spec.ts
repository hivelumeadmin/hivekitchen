import { test, expect } from '@playwright/test';
import { loginAndNavigate, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

const KITCHEN_MAP_URL = '**/v1/households/*/kitchen-map';

function sampleKitchenMap(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    household: {
      id: SAMPLE_HOUSEHOLD_ID,
      tier: 'standard',
      tier_variant: 'control',
      timezone: 'Europe/London',
      display_name: 'Menon Family',
      cultural_identifiers: [],
      dietary_preferences: [],
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
      is_complete: true,
      required_set_complete: true,
    },
    ...overrides,
  };
}

/** Route the kitchen-map endpoint and navigate to the profile page. */
async function landOnKitchenProfile(
  page: Parameters<typeof loginAndNavigate>[0],
  overrides: Record<string, unknown> = {},
) {
  await page.route(KITCHEN_MAP_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sampleKitchenMap(overrides)),
    }),
  );
  await loginAndNavigate(page, '/app/kitchen-profile');
  await expect(page.getByText(/what lumi knows about your kitchen/i)).toBeVisible();
}

test.describe('Slice 2.5-s11: Kitchen Profile — Live Data Read', () => {
  // AC3 — headline and eyebrow render, confirming the live route is wired up.
  test('renders page headline and "Visible Memory" eyebrow from live data', async ({ page }) => {
    await landOnKitchenProfile(page);

    await expect(page.getByText(/what lumi knows about your kitchen/i)).toBeVisible();
    await expect(page.getByText(/visible memory/i)).toBeVisible();
    await expect(
      page.getByText(/lumi only suggests things that fit/i),
    ).toBeVisible();
  });

  // AC3 — loading state shows while the kitchen-map API call is pending.
  test('shows "Loading your kitchen…" while kitchen map is loading', async ({ page }) => {
    // Never fulfill — holds the request open so we can assert the loading state.
    await page.route(KITCHEN_MAP_URL, () => undefined);
    await page.route('**/v1/auth/login', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: 'jwt-test-token',
          expires_in: 900,
          user: {
            id: '11111111-1111-4111-8111-111111111111',
            email: 'parent@example.com',
            display_name: 'Parent',
            current_household_id: SAMPLE_HOUSEHOLD_ID,
            role: 'primary_parent',
          },
          is_first_login: false,
          is_onboarded: true,
          is_onboarding_in_progress: false,
        }),
      }),
    );

    await page.goto('/auth/login?next=%2Fapp%2Fkitchen-profile');
    await page.getByLabel('Email Address', { exact: true }).fill('parent@example.com');
    await page.getByLabel('Password', { exact: true }).fill('verylongpassword');
    await page.getByRole('button', { name: /enter kitchen/i }).click();

    await expect(page.getByText(/loading your kitchen/i)).toBeVisible();
  });

  // AC3 — error state renders role="alert" when the API returns a non-200.
  test('shows error message with role=alert when kitchen map API fails', async ({ page }) => {
    await page.route(KITCHEN_MAP_URL, (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'internal server error' }),
      }),
    );
    await loginAndNavigate(page, '/app/kitchen-profile');

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/couldn.?t load your kitchen profile/i);
  });

  // AC5 — "Collective Kitchen Identity" section renders from live cultural data.
  test('renders active cultural prior chip label in the identity section', async ({ page }) => {
    await landOnKitchenProfile(page, {
      cultural: {
        active: [
          {
            key: 'halal',
            label: 'Halal',
            state: 'active',
            tier: 'L1',
            confidence: 100,
            presence: 100,
            enforcement: 'non_negotiable',
          },
        ],
        suggested: [],
      },
    });

    await expect(page.getByText(/collective kitchen identity/i)).toBeVisible();
    // The synthesizeQuote adapter should produce "A Halal household." — unique on the page.
    await expect(page.getByText(/"A Halal household\."/)).toBeVisible();
  });

  // AC5 — suggested cultural prior chip is also rendered (merged with active).
  test('renders suggested cultural prior chip alongside active priors', async ({ page }) => {
    await landOnKitchenProfile(page, {
      cultural: {
        active: [],
        suggested: [
          {
            key: 'vegetarian',
            label: 'Vegetarian',
            state: 'suggested',
            tier: 'L1',
            confidence: 70,
            presence: 70,
            enforcement: 'soft',
          },
        ],
      },
    });

    await expect(page.getByText('Vegetarian')).toBeVisible();
  });

  // AC5 — ChildProfileCard renders for each child in the household.
  test('renders a child profile card for each child in the kitchen map', async ({ page }) => {
    await landOnKitchenProfile(page, {
      children: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Layla',
          age_band: 'preteen',
          declared_allergens: [],
          cultural_identifiers: [],
          dietary_preferences: [],
          bag_composition: { main: true, snack: false, extra: false },
          bag_composition_pattern: 'main_only',
          school_policies: ['nut-free'],
          extra_rules: { pinned: [], banned: [] },
        },
      ],
    });

    await expect(page.getByText(/children/i)).toBeVisible();
    await expect(page.getByText('Layla')).toBeVisible();
  });

  // AC5 — StartingLineCard shows "No starting line yet" when favorite_lunches is empty.
  test('shows "No starting line yet" placeholder when favorite_lunches is empty', async ({
    page,
  }) => {
    await landOnKitchenProfile(page, { favorite_lunches: [] });

    await expect(page.getByText(/lumi.?s starting line/i)).toBeVisible();
    await expect(page.getByText(/no starting line yet/i)).toBeVisible();
  });

  // AC5 — StartingLineCard renders actual items when favorite_lunches has entries.
  test('renders favorite lunch items in the starting line section', async ({ page }) => {
    await landOnKitchenProfile(page, {
      favorite_lunches: [
        // Slice 2.6-s1 — KitchenMapFavoriteLunchSchema shape is
        // { item, provenance, position } (no id). 'declared' replaces the
        // retired 'onboarding_seed' value.
        { item: 'Paratha roll', provenance: 'declared', position: 0 },
        { item: 'Dal + rice (thermos)', provenance: 'declared', position: 1 },
      ],
    });

    await expect(page.getByText('Paratha roll')).toBeVisible();
    await expect(page.getByText('Dal + rice (thermos)')).toBeVisible();
  });

  // AC5 — Schools section renders with addLabel and is visually present.
  test('renders the Schools section with "Add a school" label', async ({ page }) => {
    await landOnKitchenProfile(page);

    await expect(page.getByText(/^schools$/i)).toBeVisible();
    await expect(page.getByText(/add a school/i)).toBeVisible();
  });

  // AC5 — Calendar section renders with sync label and is visually present.
  test('renders the Calendar section with "Sync Google Calendar" label', async ({ page }) => {
    await landOnKitchenProfile(page);

    await expect(page.getByText(/^calendar$/i)).toBeVisible();
    await expect(page.getByText(/sync google calendar/i)).toBeVisible();
  });

  // AC6 — route is accessible at /app/kitchen-profile (not a 404/redirect on load).
  test('route /app/kitchen-profile is reachable and stays on the profile URL', async ({
    page,
  }) => {
    await landOnKitchenProfile(page);
    await expect(page).toHaveURL(/\/app\/kitchen-profile/);
  });

  // AC3 — unauthenticated visitor is redirected to login with the correct next param.
  test('unauthenticated visit redirects to /auth/login with next=/app/kitchen-profile', async ({
    page,
  }) => {
    // Block the refresh cookie path so tryRefreshSession returns null.
    await page.route('**/v1/auth/refresh', (route) =>
      route.fulfill({ status: 401, body: '' }),
    );

    await page.goto('/app/kitchen-profile');
    await page.waitForURL(/\/auth\/login/);
    expect(page.url()).toContain('next=');
  });
});

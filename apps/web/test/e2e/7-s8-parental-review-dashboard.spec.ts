import { test, expect } from '@playwright/test';
import { loginAndNavigate, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

const DASHBOARD_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/dashboard`;
const DASHBOARD_ROUTE = '/app/memory/dashboard';

// ── Fixture builders ────────────────────────────────────────────────────────

function emptyCounts() {
  return { onboarding: 0, turn: 0, tool: 0, user_edit: 0, plan_outcome: 0, import: 0 };
}

function sampleDashboard(overrides: Record<string, unknown> = {}) {
  return {
    household: {
      cultural_priors: [{ key: 'bengali', label: 'Bengali', tier: 'L2', state: 'active' }],
      voice_retention_days: 90,
      recent_vpc_events: [
        {
          mechanism: 'signed_declaration',
          document_version: 'v1',
          signed_at: '2026-06-01T00:00:00.000Z',
        },
      ],
      general_memory_node_counts: { ...emptyCounts(), turn: 2 },
    },
    children: [
      {
        child_id: '33333333-3333-4333-8333-333333333333',
        name: 'Layla',
        age_band: 'child',
        declared_allergens: ['peanut'],
        dietary_preferences: ['halal'],
        memory_node_counts: { ...emptyCounts(), onboarding: 1 },
      },
    ],
    ...overrides,
  };
}

async function landOnDashboard(
  page: import('@playwright/test').Page,
  body: unknown = sampleDashboard(),
) {
  await page.route(DASHBOARD_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  await loginAndNavigate(page, DASHBOARD_ROUTE);
  await page.waitForResponse(DASHBOARD_URL);
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Story 7-S8: Parental Review Dashboard', () => {
  // AC8 — household card renders cultural priors, voice retention, VPC events.
  test('renders household summary card with cultural priors, voice retention, and VPC event (AC8)', async ({
    page,
  }) => {
    await landOnDashboard(page);

    await expect(page.getByText('Bengali')).toBeVisible();
    await expect(page.getByText('90 days')).toBeVisible();
    await expect(page.getByText(/signed_declaration/)).toBeVisible();
  });

  // AC8 — household general memory counts appear.
  test('renders household general memory counts (AC8)', async ({ page }) => {
    await landOnDashboard(page);

    await expect(page.getByText('2 from conversations')).toBeVisible();
  });

  // AC8 — per-child card renders name, allergens, dietary prefs, non-zero memory counts.
  test('renders a per-child card with name, allergens, dietary prefs, and memory counts (AC8)', async ({
    page,
  }) => {
    await landOnDashboard(page);

    await expect(page.getByText('Layla')).toBeVisible();
    await expect(page.getByText('peanut')).toBeVisible();
    await expect(page.getByText('halal')).toBeVisible();
    await expect(page.getByText('1 from onboarding')).toBeVisible();
  });

  // AC8 — each child card links to /app/memory.
  test('each child card contains a link to /app/memory (AC8)', async ({ page }) => {
    await landOnDashboard(page);

    const link = page.getByRole('link', { name: /See everything Lumi remembers/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/app/memory');
  });

  // AC8 — empty-state line when children array is empty.
  test('shows empty-state copy and no child cards when children is empty (AC7 + AC8)', async ({
    page,
  }) => {
    await landOnDashboard(page, sampleDashboard({ children: [] }));

    await expect(page.getByText(/No children are set up yet/i)).toBeVisible();
    await expect(page.getByText('Layla')).toHaveCount(0);
  });

  // AC8 — loading skeleton shows before fetch resolves.
  test('shows a loading status indicator before the fetch resolves (AC8)', async ({ page }) => {
    await page.route(DASHBOARD_URL, () => undefined); // never fulfill
    await loginAndNavigate(page, DASHBOARD_ROUTE);

    await expect(page.getByRole('status', { name: /loading your data review/i })).toBeVisible();
    await expect(page.getByText(/No children are set up yet/i)).toHaveCount(0);
  });

  // AC8 — honest error line with role=alert on API failure.
  test('shows an honest error line with role=alert when the dashboard API returns 500 (AC8)', async ({
    page,
  }) => {
    await page.route(DASHBOARD_URL, (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'internal server error' }),
      }),
    );
    await loginAndNavigate(page, DASHBOARD_ROUTE);

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("couldn't load your data review");
  });

  // AC1 — route is reachable and the URL is preserved after load.
  test('route /app/memory/dashboard is reachable and stays on that URL after load (AC1)', async ({
    page,
  }) => {
    await landOnDashboard(page);

    await expect(page).toHaveURL(/\/app\/memory\/dashboard/);
  });

  // AC1 — unauthenticated visitor is redirected to login with a next param.
  test('unauthenticated visit redirects to /auth/login with next=/app/memory/dashboard (AC1)', async ({
    page,
  }) => {
    await page.route('**/v1/auth/refresh', (route) =>
      route.fulfill({ status: 401, body: '' }),
    );
    await page.goto(DASHBOARD_ROUTE);
    await page.waitForURL(/\/auth\/login/);
    expect(page.url()).toContain('next=');
  });
});

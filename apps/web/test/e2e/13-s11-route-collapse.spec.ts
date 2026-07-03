import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { loginAndNavigate, mockLogin, userProfile, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

// ---------------------------------------------------------------------------
// Story 13-s11 — Route collapse to 4 anchors (Brief · Kitchen · People · Lumi).
//
// Frontend-only topology WALL. Verifies: the nav collapses to four anchors; the
// named non-anchor screens become artifacts summoned OVER the Brief at their
// kept URLs (deep-link lands on Brief + open artifact, axe-clean); /app/plan
// redirects to /app instead of 404ing; and the /app/lumi anchor renders the
// full-screen thread with the ambient presence dot suppressed.
//
// Locators + a11y helper mirror 13-s1 so this stays consistent with the baseline.
// Run in isolation (`--workers=1`, from apps/web) — the full local suite has a
// known service-worker-bypass failure mode (see memory e2e-full-suite-sw-bypass).
// ---------------------------------------------------------------------------

const BRIEF_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/brief`;
const CHILD_ID = '33333333-3333-4333-8333-333333333333';
const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const BRIEF_HEADLINE = 'A quiet week, with one small surprise.';

type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
const WEEKDAYS: readonly Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

function briefResponse() {
  return {
    brief: {
      household_id: SAMPLE_HOUSEHOLD_ID,
      plan_id: PLAN_ID,
      moment_headline: BRIEF_HEADLINE,
      lumi_note: 'Tuesday flexes around your late meeting.',
      memory_prose: '',
      payload: {
        cleared_allergies: [],
        scaffolding_diff: null,
        plan_state: null,
        plan_state_set_at: null,
        plan_state_message: null,
        tile_summaries: WEEKDAYS.map((day, i) => ({
          day,
          paused: false,
          items: [
            {
              plan_item_id: `55555555-5555-4555-8555-55555555550${i + 1}`,
              child_id: CHILD_ID,
              slot: 'main',
              ingredients: ['rice', 'beans'],
            },
          ],
        })),
      },
      generated_at: '2026-05-02T00:00:00.000Z',
      plan_revision: 1,
      updated_at: '2026-05-02T00:00:00.000Z',
    },
  };
}

// Mock every endpoint the Brief needs, then drive login → destination. Mirrors
// 13-s1's navigateToApp but parameterized on the landing route so the same setup
// serves the artifact deep-links, the redirect, and the Lumi anchor.
async function mockAppEndpoints(page: Page) {
  await page.clock.install({ time: new Date('2026-05-04T08:00:00Z') });
  await page.route('**/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userProfile()),
    }),
  );
  await page.route('**/v1/plans*', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: null, plan_items: [], is_draft: false, week_of: '2026-05-04' }),
    }),
  );
  await page.route(BRIEF_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(briefResponse()),
    }),
  );
}

// Pre-existing WCAG-AA color-contrast debt scoped to the offending nodes so a
// NEW contrast failure still fails the gate. `amber-warm` is the design-system
// debt characterized in 13-s1; `lumi-terracotta` is the re-hosted grocery mock's
// "Pro-tip" line (3.43:1 on surface-2). This story re-hosts the grocery screen
// UNCHANGED (Editorial Hearth frozen, "do not rebuild these screens"), so its own
// pre-existing debt is out of scope — but the artifact HOST chrome must stay clean.
function isKnownContrastDebtNode(node: { html: string; target: unknown }): boolean {
  const hay = `${node.html} ${JSON.stringify(node.target)}`;
  return hay.includes('amber-warm') || hay.includes('lumi-terracotta');
}

// The grocery mock's StoreSession progress bar (`role="progressbar"`) ships
// without an accessible name — pre-existing content debt in the re-hosted screen,
// not the artifact host. Documented and excluded like the contrast debt above.
const KNOWN_SCREEN_DEBT_RULES = new Set(['aria-progressbar-name']);

async function checkA11y(page: Page, selector: string) {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  const newViolations = results.violations
    .filter((v) => !KNOWN_SCREEN_DEBT_RULES.has(v.id))
    .map((v) => ({
      ...v,
      nodes:
        v.id === 'color-contrast' ? v.nodes.filter((n) => !isKnownContrastDebtNode(n)) : v.nodes,
    }))
    .filter((v) => v.nodes.length > 0);
  if (newViolations.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `axe on ${selector} — new: [${newViolations.map((v) => `${v.id}: ${v.help}`).join(' | ')}]`,
    );
  }
  expect(newViolations).toHaveLength(0);
}

// ===========================================================================
// AC2 — Nav collapses to four anchors
// ===========================================================================
test.describe('13-s11 / AC2 — four-anchor sidebar', () => {
  test('the sidebar shows exactly Brief · Kitchen · People · Lumi and drops the rest', async ({
    page,
  }) => {
    await mockAppEndpoints(page);
    await loginAndNavigate(page, '/app');
    await page.waitForResponse(BRIEF_URL);

    const nav = page.getByRole('navigation', { name: /main navigation/i });
    for (const anchor of ['Brief', 'Kitchen', 'People', 'Lumi']) {
      await expect(nav.getByRole('link', { name: anchor, exact: true })).toBeVisible();
    }
    for (const gone of ['Grocery List', 'My Snacks', 'Memory', 'Settings', 'Account']) {
      await expect(nav.getByRole('link', { name: gone, exact: true })).toHaveCount(0);
    }
  });
});

// ===========================================================================
// AC4 — Artifact over the Brief (deep-link)
// ===========================================================================
test.describe('13-s11 / AC4 — grocery artifact over the Brief', () => {
  test('deep-linking /app/grocery-list renders the Brief with the grocery artifact open (axe-clean)', async ({
    page,
  }) => {
    await mockAppEndpoints(page);
    await loginAndNavigate(page, '/app/grocery-list');
    await page.waitForResponse(BRIEF_URL);

    // The Brief renders behind the artifact...
    await expect(
      page.getByRole('heading', { level: 1, name: BRIEF_HEADLINE }),
    ).toBeVisible();
    // ...with the grocery screen summoned as a modal artifact over it.
    const artifact = page.getByRole('dialog', { name: /grocery list/i });
    await expect(artifact).toBeVisible();
    await expect(page.getByRole('button', { name: /close grocery list/i })).toBeVisible();

    await checkA11y(page, '[role="dialog"]');

    // Closing the artifact returns to the Brief anchor.
    await page.getByRole('button', { name: /close grocery list/i }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(artifact).toHaveCount(0);
  });
});

// ===========================================================================
// AC5 — /app/plan redirects to the Brief (not a 404)
// ===========================================================================
test.describe('13-s11 / AC5 — /app/plan redirect', () => {
  test('/app/plan lands on /app', async ({ page }) => {
    await mockAppEndpoints(page);
    await mockLogin(page);
    await page.goto(`/auth/login?next=${encodeURIComponent('/app/plan')}`);
    await page.getByLabel('Email Address', { exact: true }).fill('parent@example.com');
    await page.getByLabel('Password', { exact: true }).fill('verylongpassword');
    await page.getByRole('button', { name: /enter kitchen/i }).click();

    await page.waitForURL(/\/app$/);
    await expect(page.getByRole('heading', { level: 1, name: BRIEF_HEADLINE })).toBeVisible();
  });
});

// ===========================================================================
// AC3 — Lumi anchor: full-screen thread, presence dot suppressed
// ===========================================================================
test.describe('13-s11 / AC3 — Lumi anchor page', () => {
  test('/app/lumi renders the thread page with no ambient presence dot', async ({ page }) => {
    await mockAppEndpoints(page);
    await loginAndNavigate(page, '/app/lumi');

    await expect(page.getByRole('heading', { level: 1, name: 'Lumi' })).toBeVisible();
    await expect(page.getByLabel(/ask lumi/i)).toBeVisible();

    // The ambient dot/sheet are suppressed on the full-screen thread.
    await expect(page.getByRole('button', { name: /open lumi/i })).toHaveCount(0);
  });
});

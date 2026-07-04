import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, userProfile } from './_helpers.js';

// Story 12-S12: Orb breathing, proactive nudge SSE delivery & opt-out.
//
// Coverage:
//   AC#4  — orb gets animate-pulse when pendingNudge is set and panel is closed
//   AC#4  — breathing suppressed when panel is open or voice is active
//   AC#10 — openPanel() clears pendingNudge (orb returns to calm)
//   AC#7  — "Pause nudges" / "Resume nudges" toggle in the panel footer
//   AC#7  — optimistic flip reverts on PATCH failure
//   AC#8  — "Lumi proactive nudges" checkbox on the account page
//   AC#8  — checkbox PATCH hits /v1/users/me/notifications
//   AC#8  — failed PATCH reverts the checkbox and shows an error alert
//   AC#8  — profile load syncs proactive_lumi_nudges to lumi store
//
// AC#1–3 (SSE wire-up) are covered by useLumiNudgeSSE unit tests.
// E2E seeding confirms the observable outcome when the store is populated
// as the hook would populate it after receiving a lumi.nudge SSE event.

const NUDGE_TURN = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  thread_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  server_seq: 1,
  created_at: '2026-06-06T09:00:00.000Z',
  role: 'lumi',
  body: { type: 'message', content: "Here's a nudge from Lumi." },
};

type LumiStoreHandle = {
  setState: (s: Record<string, unknown>) => void;
  getState: () => Record<string, unknown>;
};

async function seedLumiStore(page: Page, state: Record<string, unknown>) {
  await page.evaluate((s) => {
    const store = (window as Record<string, unknown>).__lumiStore as LumiStoreHandle | undefined;
    if (!store) throw new Error('__lumiStore not available — set VITE_E2E=true in the build');
    store.setState(s);
  }, state);
}

async function getLumiState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).__lumiStore;
    if (!store) throw new Error('__lumiStore not available — set VITE_E2E=true in the build');
    return store.getState() as Record<string, unknown>;
  });
}

async function mockProfileGet(
  page: Page,
  notifPrefs: { weekly_plan_ready: boolean; grocery_list_ready: boolean; proactive_lumi_nudges: boolean } = {
    weekly_plan_ready: true,
    grocery_list_ready: true,
    proactive_lumi_nudges: true,
  },
) {
  await page.route('**/v1/users/me', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...userProfile(), notification_prefs: notifPrefs }),
    });
  });
}

// ---------------------------------------------------------------------------
// Orb breathing (AC#4)
// ---------------------------------------------------------------------------

test.describe('Story 12-S12 — orb breathing (AC#4)', () => {
  test('dot has animate-pulse when pendingNudge is set and at rest', async ({ page }) => {
    await page.goto('/app');
    await seedLumiStore(page, { pendingNudge: NUDGE_TURN });
    await expect(page.getByRole('button', { name: /open lumi/i })).toHaveClass(/animate-pulse/);
  });

  test('dot does NOT have animate-pulse when no nudge is pending', async ({ page }) => {
    await page.goto('/app');
    await seedLumiStore(page, { pendingNudge: null });
    await expect(page.getByRole('button', { name: /open lumi/i })).not.toHaveClass(/animate-pulse/);
  });

  test('dot does NOT have animate-pulse when summoned (even with pending nudge)', async ({
    page,
  }) => {
    await page.goto('/app');
    // Wait for the route to mount before seeding: useLumiContext's setContext
    // (Epic 13) resets presenceState to 'atRest' on registration, which would
    // wipe a seed applied while the router is still gated on session restore.
    await expect(page.getByRole('button', { name: /open lumi/i })).toBeVisible();
    // Seed summoned + pending nudge — breathing is suppressed while the sheet is showing.
    await seedLumiStore(page, { pendingNudge: NUDGE_TURN, presenceState: 'summoned' });
    // When summoned the dot aria-label becomes "Lumi is open".
    await expect(page.getByRole('button', { name: /lumi is open/i })).not.toHaveClass(
      /animate-pulse/,
    );
  });
});

// ---------------------------------------------------------------------------
// Opening the panel clears pendingNudge (AC#10)
// ---------------------------------------------------------------------------

test.describe('Story 12-S12 — summon clears pendingNudge (AC#10)', () => {
  test('tapping the dot clears pendingNudge and stops the animation', async ({ page }) => {
    await page.goto('/app');
    await seedLumiStore(page, { pendingNudge: NUDGE_TURN });

    const orb = page.getByRole('button', { name: /open lumi/i });
    await expect(orb).toHaveClass(/animate-pulse/);

    await orb.click();
    await expect(page.getByRole('dialog', { name: /lumi/i })).toBeVisible();

    // After summon: dot label flips and animate-pulse is gone.
    const openOrb = page.getByRole('button', { name: /lumi is open/i });
    await expect(openOrb).not.toHaveClass(/animate-pulse/);

    // pendingNudge is null in the store.
    const state = await getLumiState(page);
    expect(state['pendingNudge']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// "Pause nudges" / "Resume nudges" panel footer toggle (AC#7)
// ---------------------------------------------------------------------------

test.describe('Story 12-S12 — panel nudge toggle (AC#7)', () => {
  test('"Pause nudges" button is visible when proactiveNudges is true', async ({ page }) => {
    await page.goto('/app');
    await seedLumiStore(page, { proactiveNudges: true });
    await page.getByRole('button', { name: /open lumi/i }).click();
    await expect(page.getByRole('button', { name: /pause nudges/i })).toBeVisible();
  });

  test('"Resume nudges" button is visible when proactiveNudges is false', async ({ page }) => {
    await page.goto('/app');
    await seedLumiStore(page, { proactiveNudges: false });
    await page.getByRole('button', { name: /open lumi/i }).click();
    await expect(page.getByRole('button', { name: /resume nudges/i })).toBeVisible();
  });

  test('clicking "Pause nudges" sends PATCH with proactive_lumi_nudges: false and flips label', async ({
    page,
  }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route('**/v1/users/me/notifications', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      capturedBody = (await route.request().postDataJSON()) as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...userProfile(),
          notification_prefs: {
            weekly_plan_ready: true,
            grocery_list_ready: true,
            proactive_lumi_nudges: false,
          },
        }),
      });
    });

    await page.goto('/app');
    await seedLumiStore(page, { proactiveNudges: true });
    await page.getByRole('button', { name: /open lumi/i }).click();
    await page.getByRole('button', { name: /pause nudges/i }).click();

    await expect(page.getByRole('button', { name: /resume nudges/i })).toBeVisible();
    expect(capturedBody).toMatchObject({ proactive_lumi_nudges: false });
  });

  test('clicking "Resume nudges" sends PATCH with proactive_lumi_nudges: true and flips label', async ({
    page,
  }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route('**/v1/users/me/notifications', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      capturedBody = (await route.request().postDataJSON()) as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...userProfile(),
          notification_prefs: {
            weekly_plan_ready: true,
            grocery_list_ready: true,
            proactive_lumi_nudges: true,
          },
        }),
      });
    });

    await page.goto('/app');
    await seedLumiStore(page, { proactiveNudges: false });
    await page.getByRole('button', { name: /open lumi/i }).click();
    await page.getByRole('button', { name: /resume nudges/i }).click();

    await expect(page.getByRole('button', { name: /pause nudges/i })).toBeVisible();
    expect(capturedBody).toMatchObject({ proactive_lumi_nudges: true });
  });

  test('PATCH failure reverts the label (optimistic revert)', async ({ page }) => {
    await page.route('**/v1/users/me/notifications', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server error' }),
      });
    });

    await page.goto('/app');
    await seedLumiStore(page, { proactiveNudges: true });
    await page.getByRole('button', { name: /open lumi/i }).click();
    await page.getByRole('button', { name: /pause nudges/i }).click();

    // After the failed PATCH completes the store reverts — label returns to "Pause nudges".
    await expect(page.getByRole('button', { name: /pause nudges/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Account page "Lumi proactive nudges" checkbox (AC#8)
// ---------------------------------------------------------------------------

test.describe('Story 12-S12 — account page nudge checkbox (AC#8)', () => {
  test('"Lumi proactive nudges" checkbox is visible and checked by default', async ({ page }) => {
    await mockProfileGet(page);
    await loginAndNavigate(page, '/account');
    const checkbox = page.getByRole('checkbox', { name: /lumi proactive nudges/i });
    await expect(checkbox).toBeVisible();
    await expect(checkbox).toBeChecked();
  });

  test('checkbox reflects opted-out state when profile returns proactive_lumi_nudges: false', async ({
    page,
  }) => {
    await mockProfileGet(page, {
      weekly_plan_ready: true,
      grocery_list_ready: true,
      proactive_lumi_nudges: false,
    });
    await loginAndNavigate(page, '/account');
    await expect(page.getByRole('checkbox', { name: /lumi proactive nudges/i })).not.toBeChecked();
  });

  test('unchecking the checkbox PATCHes /notifications with proactive_lumi_nudges: false', async ({
    page,
  }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await mockProfileGet(page);
    await page.route('**/v1/users/me/notifications', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      capturedBody = (await route.request().postDataJSON()) as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...userProfile(),
          notification_prefs: {
            weekly_plan_ready: true,
            grocery_list_ready: true,
            proactive_lumi_nudges: false,
          },
        }),
      });
    });

    await loginAndNavigate(page, '/account');
    await page.getByRole('checkbox', { name: /lumi proactive nudges/i }).uncheck();
    await expect.poll(() => capturedBody).toMatchObject({ proactive_lumi_nudges: false });
    await expect(
      page.getByRole('checkbox', { name: /lumi proactive nudges/i }),
    ).not.toBeChecked();
  });

  test('checking the checkbox when opted-out PATCHes with proactive_lumi_nudges: true', async ({
    page,
  }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await mockProfileGet(page, {
      weekly_plan_ready: true,
      grocery_list_ready: true,
      proactive_lumi_nudges: false,
    });
    await page.route('**/v1/users/me/notifications', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      capturedBody = (await route.request().postDataJSON()) as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...userProfile(),
          notification_prefs: {
            weekly_plan_ready: true,
            grocery_list_ready: true,
            proactive_lumi_nudges: true,
          },
        }),
      });
    });

    await loginAndNavigate(page, '/account');
    await page.getByRole('checkbox', { name: /lumi proactive nudges/i }).check();
    await expect.poll(() => capturedBody).toMatchObject({ proactive_lumi_nudges: true });
  });

  test('failed toggle reverts the checkbox and shows an error alert', async ({ page }) => {
    await mockProfileGet(page);
    await page.route('**/v1/users/me/notifications', (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server' }),
      }),
    );

    await loginAndNavigate(page, '/account');
    const checkbox = page.getByRole('checkbox', { name: /lumi proactive nudges/i });
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect(page.getByRole('alert')).toContainText(/could not update notification/i);
    await expect(checkbox).toBeChecked();
  });

  test('loading /account syncs proactive_lumi_nudges: false to the lumi store', async ({
    page,
  }) => {
    await mockProfileGet(page, {
      weekly_plan_ready: true,
      grocery_list_ready: true,
      proactive_lumi_nudges: false,
    });
    await loginAndNavigate(page, '/account');
    // Wait for the page to finish loading and the profile to be reflected in the UI.
    await expect(page.getByRole('checkbox', { name: /lumi proactive nudges/i })).toBeVisible();

    const state = await getLumiState(page);
    expect(state['proactiveNudges']).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SSE nudge delivery — observable outcome (AC#1–3)
//
// The full SSE wire-up (EventSource → lumi.nudge event → store update) is
// covered by the useLumiNudgeSSE unit tests. E2E tests verify the observable
// outcome by seeding the store as the hook would after receiving the event.
// ---------------------------------------------------------------------------

test.describe('Story 12-S12 — SSE nudge delivery observable outcome (AC#1–3)', () => {
  test('setNudge triggers orb breathing (models what useLumiNudgeSSE does on receipt)', async ({
    page,
  }) => {
    await page.goto('/app');
    await seedLumiStore(page, { pendingNudge: NUDGE_TURN });
    await expect(page.getByRole('button', { name: /open lumi/i })).toHaveClass(/animate-pulse/);
  });

  // Full SSE integration (real EventSource → named lumi.nudge event → store update)
  // requires a running API with a live BullMQ worker. Covered by unit tests and
  // manual demo path: trigger a nudge job → EventSource fires → orb breathes.
  test.skip(
    'AC#1–3 full SSE path [USER-SIDE GATE — live API + BullMQ nudge job]',
    async () => {},
  );
});

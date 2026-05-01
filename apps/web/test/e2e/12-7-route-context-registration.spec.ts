import { test, expect } from '@playwright/test';

// Requires VITE_E2E=true build to access window.__lumiStore.
// Build: VITE_E2E=true pnpm --filter @hivekitchen/web build

const THREAD_ID = '22222222-2222-4222-8222-222222222222';

interface LumiStateSlice {
  surface: string;
  contextSignal: Record<string, unknown> | null;
  threadIds: Record<string, string | undefined>;
  turns: unknown[];
  isHydrating: boolean;
  talkSessionId: string | null;
  voiceStatus: string;
  isSpeaking: boolean;
}

async function getLumiState(page: import('@playwright/test').Page): Promise<LumiStateSlice> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).__lumiStore;
    if (!store) throw new Error('__lumiStore not available — set VITE_E2E=true in the build');
    return store.getState() as LumiStateSlice;
  });
}

async function seedLumiStore(
  page: import('@playwright/test').Page,
  state: Partial<LumiStateSlice>,
): Promise<void> {
  await page.evaluate((s) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).__lumiStore;
    if (!store) throw new Error('__lumiStore not available — set VITE_E2E=true in the build');
    store.setState(s);
  }, state as Record<string, unknown>);
}

// Injects a fake Bearer token so auth-dependent effects don't redirect away from
// the current route during the test. Used only where we need to keep AppLayout
// mounted long enough to interact with the LumiPanel.
async function seedFakeAuthToken(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).__authStore;
    if (!store) throw new Error('__authStore not available — set VITE_E2E=true in the build');
    store.setState({ accessToken: 'e2e-fake-token' });
  });
}

// Triggers SPA navigation without a full page reload.
// React Router v6 (createBrowserRouter) listens to popstate and reads window.location.
async function spaNavigate(page: import('@playwright/test').Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, path);
  await page.waitForTimeout(150);
}

test.describe('Story 12-7: Route context registration', () => {
  test('useLumiContext sets surface=general and contextSignal on /app mount (AC #1, #7)', async ({
    page,
  }) => {
    await page.goto('/app');
    const { surface, contextSignal } = await getLumiState(page);
    expect(surface).toBe('general');
    expect(contextSignal).toEqual({ surface: 'general' });
  });

  test('useLumiContext sets surface=general and contextSignal on /account mount (AC #1, #8)', async ({
    page,
  }) => {
    await page.goto('/account');
    const { surface, contextSignal } = await getLumiState(page);
    expect(surface).toBe('general');
    expect(contextSignal).toEqual({ surface: 'general' });
  });

  test('no hydration fetch when threadIds[general] is undefined on mount (AC #5)', async ({
    page,
  }) => {
    let hydrationFetched = false;
    await page.route('**/v1/lumi/threads/**/turns', () => {
      hydrationFetched = true;
    });

    await page.goto('/app');
    await page.waitForTimeout(200);

    expect(hydrationFetched).toBe(false);
    const { isHydrating } = await getLumiState(page);
    expect(isHydrating).toBe(false);
  });

  test('pre-hydration fetch fires on SPA navigation when threadId is in store (AC #3)', async ({
    page,
  }) => {
    let fetchCount = 0;
    await page.route(`**/v1/lumi/threads/${THREAD_ID}/turns`, (route) => {
      fetchCount++;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: THREAD_ID, turns: [] }),
      });
    });

    // Mount /app with no threadId — no fetch
    await page.goto('/app');
    expect(fetchCount).toBe(0);

    // Seed threadIds, then SPA-navigate to /account — useLumiContext sees the threadId at mount
    await seedLumiStore(page, { threadIds: { general: THREAD_ID } });
    await spaNavigate(page, '/account');
    await page.waitForTimeout(300);

    expect(fetchCount).toBeGreaterThanOrEqual(1);
    const { isHydrating } = await getLumiState(page);
    expect(isHydrating).toBe(false);
  });

  test('pre-hydrated turns appear in panel without a second fetch (AC #3, #10)', async ({
    page,
  }) => {
    const turns = [
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        thread_id: THREAD_ID,
        server_seq: 1,
        created_at: '2026-04-30T00:00:00.000Z',
        role: 'lumi',
        body: { type: 'message', content: 'Pre-hydrated before panel opened' },
      },
    ];

    let fetchCount = 0;
    await page.route(`**/v1/lumi/threads/${THREAD_ID}/turns`, (route) => {
      fetchCount++;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: THREAD_ID, turns }),
      });
    });

    await page.goto('/app');
    // Suppress auth-redirect effects so AppLayout stays mounted for the panel assertion
    await seedFakeAuthToken(page);
    await seedLumiStore(page, { threadIds: { general: THREAD_ID } });

    // Synchronise on the network response rather than polling the store —
    // waitForResponse resolves as soon as the fulfilled response is received.
    const responsePromise = page.waitForResponse(
      `**/v1/lumi/threads/${THREAD_ID}/turns`,
      { timeout: 5000 },
    );
    await spaNavigate(page, '/account');
    await responsePromise;
    // Allow Zod parse + hydrateThread store update to flush
    await page.waitForTimeout(150);

    const countAfterPreHydration = fetchCount;

    // Opening the panel must NOT trigger another fetch — turns already in store
    await page.getByRole('button', { name: /open lumi/i }).click();
    await page.waitForTimeout(200);

    expect(fetchCount).toBe(countAfterPreHydration);
    await expect(page.getByText('Pre-hydrated before panel opened')).toBeVisible();
  });

  test('voice session fields survive route navigation (AC #9)', async ({ page }) => {
    await page.goto('/app');
    await seedLumiStore(page, {
      talkSessionId: 'session-alive',
      voiceStatus: 'active',
      isSpeaking: true,
    });

    // setContext must NOT touch talkSessionId / voiceStatus / isSpeaking
    await spaNavigate(page, '/account');
    await page.waitForTimeout(100);

    const { talkSessionId, voiceStatus, isSpeaking } = await getLumiState(page);
    expect(talkSessionId).toBe('session-alive');
    expect(voiceStatus).toBe('active');
    expect(isSpeaking).toBe(true);
  });
});

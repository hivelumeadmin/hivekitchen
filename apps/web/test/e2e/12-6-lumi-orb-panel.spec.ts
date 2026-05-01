import { test, expect } from '@playwright/test';

// Most tests navigate to /app which has no auth-redirect guard. Tests that
// assert the orb is visible on /account must pre-seed a fake auth token first —
// AccountPage redirects to /auth/login when accessToken is null, which unmounts
// AppLayout and removes the orb. Requires a VITE_E2E=true build.

const THREAD_ID = '33333333-3333-4333-8333-333333333333';

type LumiStoreHandle = {
  setState: (s: Record<string, unknown>) => void;
  getState: () => Record<string, unknown>;
};

async function seedLumiStore(page: import('@playwright/test').Page, state: Record<string, unknown>) {
  await page.evaluate((s) => {
    const store = (window as Record<string, unknown>).__lumiStore as LumiStoreHandle | undefined;
    if (!store) throw new Error('__lumiStore not available — set VITE_E2E=true in the build');
    store.setState(s);
  }, state);
}

async function seedFakeAuthToken(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).__authStore;
    if (!store) throw new Error('__authStore not available — set VITE_E2E=true in the build');
    store.setState({ accessToken: 'e2e-fake-token' });
  });
}

async function spaNavigate(page: import('@playwright/test').Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, path);
  await page.waitForTimeout(150);
}

test.describe('Story 12-6: LumiOrb + LumiPanel ambient surface', () => {
  test('orb is present on /app (inside AppLayout)', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('button', { name: /open lumi/i })).toBeVisible();
  });

  test('orb is absent on /onboarding (flat route, outside AppLayout)', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page.getByRole('button', { name: /open lumi/i })).not.toBeVisible();
  });

  test('orb is visible on /account — verifies /account is inside AppLayout', async ({ page }) => {
    // AccountPage redirects to /auth/login when accessToken is null, unmounting AppLayout.
    // Load /app first (no auth guard), seed a fake token, then SPA-navigate to /account.
    // Return 500 so hkFetch throws and AccountPage renders its error state — a clean path
    // that does not touch profile.auth_providers (which would crash on an empty object).
    await page.route('**/v1/users/me', (route) =>
      route.fulfill({ status: 500, body: '{"error":"stub"}' }),
    );
    await page.goto('/app');
    await seedFakeAuthToken(page);
    await spaNavigate(page, '/account');
    await expect(page.getByRole('button', { name: /open lumi/i })).toBeVisible();
  });

  test('tapping the orb opens the Lumi panel', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: /open lumi/i }).click();
    await expect(page.getByRole('complementary', { name: /lumi panel/i })).toBeVisible();
  });

  test('panel contains Lumi header, dismiss button, and disabled textarea', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: /open lumi/i }).click();
    const panel = page.getByRole('complementary', { name: /lumi panel/i });
    await expect(panel.getByRole('button', { name: /close lumi panel/i })).toBeVisible();
    const textarea = panel.getByLabel(/ask lumi/i);
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeDisabled();
  });

  test('panel shows empty-state copy when no turns are loaded', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: /open lumi/i }).click();
    await expect(page.getByText(/nothing to show yet/i)).toBeVisible();
  });

  test('dismiss button closes the panel', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: /open lumi/i }).click();
    await page.getByRole('button', { name: /close lumi panel/i }).click();
    await expect(page.getByRole('complementary', { name: /lumi panel/i })).not.toBeVisible();
  });

  test('tapping the orb while panel is open closes it', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: /open lumi/i }).click();
    await expect(page.getByRole('complementary', { name: /lumi panel/i })).toBeVisible();
    // aria-label flips to "Lumi is open" while panel is open
    await page.getByRole('button', { name: /lumi is open/i }).click();
    await expect(page.getByRole('complementary', { name: /lumi panel/i })).not.toBeVisible();
  });

  test('orb aria-expanded tracks panel open/closed state', async ({ page }) => {
    await page.goto('/app');
    const orb = page.getByRole('button', { name: /open lumi/i });
    await expect(orb).toHaveAttribute('aria-expanded', 'false');
    await orb.click();
    await expect(page.getByRole('button', { name: /lumi is open/i })).toHaveAttribute('aria-expanded', 'true');
  });

  test('orb aria-controls points to the panel element', async ({ page }) => {
    await page.goto('/app');
    const orb = page.getByRole('button', { name: /open lumi/i });
    await expect(orb).toHaveAttribute('aria-controls', 'lumi-panel');
  });

  test('orb is keyboard-activatable via Enter', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: /open lumi/i }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('complementary', { name: /lumi panel/i })).toBeVisible();
  });

  test('orb is keyboard-activatable via Space', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: /open lumi/i }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('complementary', { name: /lumi panel/i })).toBeVisible();
  });

  test('panel fetches and renders turns when a thread ID is seeded (requires VITE_E2E build)', async ({
    page,
  }) => {
    await page.route(`**/v1/lumi/threads/${THREAD_ID}/turns`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: THREAD_ID,
          turns: [
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              thread_id: THREAD_ID,
              server_seq: 1,
              created_at: '2026-04-30T00:00:00.000Z',
              role: 'lumi',
              body: { type: 'message', content: 'Hello from Lumi!' },
            },
          ],
        }),
      }),
    );

    await page.goto('/app');
    await seedLumiStore(page, { surface: 'general', threadIds: { general: THREAD_ID } });
    await page.getByRole('button', { name: /open lumi/i }).click();

    await expect(page.getByText('Hello from Lumi!')).toBeVisible();
    await expect(page.getByText(/nothing to show yet/i)).not.toBeVisible();
  });
});

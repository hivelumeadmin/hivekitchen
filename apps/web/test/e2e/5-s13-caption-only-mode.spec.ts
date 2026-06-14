import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, userProfile } from './_helpers.js';

// Story 5-S13: Caption-only ("Text only") accessibility mode.
//
// Coverage:
//   AC1  — GET /v1/users/me returns caption_only_mode; account page reflects it
//   AC3  — Accessibility section renders "Text only" toggle (unchecked by default)
//   AC3  — Toggle is checked when profile has caption_only_mode: true
//   AC4  — Click sends PATCH /v1/users/me/accessibility with { caption_only_mode }
//   AC4  — Optimistic revert + error alert on PATCH failure
//   AC8  — Account page load syncs captionOnlyMode flag to the lumi store
//
// AC5/AC6/AC7 (voice-hook TTS skip) are covered by the useLumiVoiceSession unit
// tests — they require a live WebSocket session unavailable in the preview server.

type LumiStoreHandle = {
  getState: () => Record<string, unknown>;
};

async function getLumiState(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const store = (window as Record<string, unknown>).__lumiStore as LumiStoreHandle | undefined;
    if (!store) throw new Error('__lumiStore not found — ensure VITE_E2E=true at build time');
    return store.getState();
  });
}

async function mockProfileGet(page: Page, captionOnlyMode = false) {
  await page.route('**/v1/users/me', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userProfile({ caption_only_mode: captionOnlyMode })),
    });
  });
}

// ---------------------------------------------------------------------------
// Accessibility section visibility — AC3
// ---------------------------------------------------------------------------

test.describe('Story 5-S13 — Accessibility section (AC3)', () => {
  test('"Text only" toggle is visible and unchecked when caption_only_mode is false', async ({
    page,
  }) => {
    await mockProfileGet(page, false);
    await loginAndNavigate(page, '/account');

    const toggle = page.getByRole('switch', { name: /text only — captions without audio/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
  });

  test('"Text only" toggle is checked when profile has caption_only_mode: true', async ({
    page,
  }) => {
    await mockProfileGet(page, true);
    await loginAndNavigate(page, '/account');

    await expect(
      page.getByRole('switch', { name: /text only — captions without audio/i }),
    ).toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// Toggle PATCH interaction — AC4
// ---------------------------------------------------------------------------

test.describe('Story 5-S13 — PATCH /v1/users/me/accessibility (AC4)', () => {
  test('checking the toggle sends PATCH with caption_only_mode: true and stays checked', async ({
    page,
  }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await mockProfileGet(page, false);
    await page.route('**/v1/users/me/accessibility', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      capturedBody = (await route.request().postDataJSON()) as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile({ caption_only_mode: true })),
      });
    });

    await loginAndNavigate(page, '/account');
    await page.getByRole('switch', { name: /text only — captions without audio/i }).click();

    await expect.poll(() => capturedBody).toMatchObject({ caption_only_mode: true });
    await expect(
      page.getByRole('switch', { name: /text only — captions without audio/i }),
    ).toBeChecked();
  });

  test('unchecking the toggle sends PATCH with caption_only_mode: false and stays unchecked', async ({
    page,
  }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await mockProfileGet(page, true);
    await page.route('**/v1/users/me/accessibility', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      capturedBody = (await route.request().postDataJSON()) as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile({ caption_only_mode: false })),
      });
    });

    await loginAndNavigate(page, '/account');
    await page.getByRole('switch', { name: /text only — captions without audio/i }).click();

    await expect.poll(() => capturedBody).toMatchObject({ caption_only_mode: false });
    await expect(
      page.getByRole('switch', { name: /text only — captions without audio/i }),
    ).not.toBeChecked();
  });

  test('failed PATCH reverts toggle to unchecked and shows error alert', async ({ page }) => {
    await mockProfileGet(page, false);
    await page.route('**/v1/users/me/accessibility', (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server error' }),
      }),
    );

    await loginAndNavigate(page, '/account');
    const toggle = page.getByRole('switch', { name: /text only — captions without audio/i });
    await expect(toggle).not.toBeChecked();
    await toggle.click();

    // Optimistic flip → PATCH fails → revert to unchecked + error alert.
    await expect(page.getByRole('alert')).toContainText(/could not update accessibility/i);
    await expect(toggle).not.toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// Lumi store hydration — AC8
// ---------------------------------------------------------------------------

test.describe('Story 5-S13 — lumi store hydration (AC8)', () => {
  test('account page with caption_only_mode: true sets captionOnlyMode: true in the store', async ({
    page,
  }) => {
    await mockProfileGet(page, true);
    await loginAndNavigate(page, '/account');

    // Wait for the profile to render before reading store state.
    await expect(
      page.getByRole('switch', { name: /text only — captions without audio/i }),
    ).toBeChecked();

    const state = await getLumiState(page);
    expect(state['captionOnlyMode']).toBe(true);
  });

  test('account page with caption_only_mode: false keeps captionOnlyMode: false in the store', async ({
    page,
  }) => {
    await mockProfileGet(page, false);
    await loginAndNavigate(page, '/account');

    await expect(
      page.getByRole('switch', { name: /text only — captions without audio/i }),
    ).toBeVisible();

    const state = await getLumiState(page);
    expect(state['captionOnlyMode']).toBe(false);
  });
});

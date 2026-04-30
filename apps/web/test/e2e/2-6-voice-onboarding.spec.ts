import { test, expect } from '@playwright/test';
import { loginAndNavigate, userProfile } from './_helpers.js';

/**
 * Story 2-6 wires the voice-first onboarding interview. The full audio path
 * (mic VAD + ElevenLabs WebSocket + audio playback) is too brittle to drive
 * end-to-end from a headless browser — those layers are covered by unit /
 * integration tests. This spec asserts the SPA-level behavior:
 *   - Entry-point UI renders the choice between voice and text
 *   - Voice mode renders the listening indicator scaffold
 *   - When /v1/voice/sessions fails, the fallback "Continue with text" link
 *     surfaces (FR — voice failure must always be recoverable via text)
 */

test.describe('Story 2-6: voice-first onboarding entry point + fallback', () => {
  test('first-login user lands on the onboarding mode-select screen', async ({ page }) => {
    await page.route('**/v1/users/me', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile()),
      }),
    );
    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await expect(page.getByRole('heading', { name: /welcome to hivekitchen/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /start with voice/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /i'd rather type/i })).toBeVisible();
  });

  test('clicking "Start with voice" enters voice mode and POSTs /v1/voice/sessions', async ({
    page,
  }) => {
    let sessionPostBody: Record<string, unknown> | null = null;
    await page.route('**/v1/voice/sessions', (route, request) => {
      sessionPostBody = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      // Fulfill with a valid session_id, but never send WS frames — the test
      // only asserts that the POST fires and the voice surface mounts.
      return route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: '33333333-3333-4333-8333-333333333333',
        }),
      });
    });
    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /start with voice/i }).click();
    await expect(
      page.getByRole('heading', { name: /let.s get to know your family/i }),
    ).toBeVisible();
    await expect.poll(() => sessionPostBody).not.toBeNull();
    expect(sessionPostBody).toEqual({ context: 'onboarding' });
  });

  test('5xx on /v1/voice/sessions surfaces the "Continue with text instead" fallback link', async ({
    page,
  }) => {
    await page.route('**/v1/voice/sessions', (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server' }),
      }),
    );
    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /start with voice/i }).click();
    await expect(
      page.getByRole('button', { name: /continue with text instead/i }),
    ).toBeVisible();
  });

  test('clicking the text-fallback link switches the page into text mode', async ({ page }) => {
    await page.route('**/v1/voice/sessions', (route) =>
      route.fulfill({ status: 500, body: '{}' }),
    );
    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /start with voice/i }).click();
    await page.getByRole('button', { name: /continue with text instead/i }).click();
    await expect(page.getByLabel(/your message to lumi/i)).toBeVisible();
  });
});

import { test, expect } from '@playwright/test';
import { loginAndNavigate } from './_helpers.js';

/**
 * Story 2-S20 — "Listen to Lumi" tab on the onboarding landing page.
 *
 * The AudioPanel uses a browser-direct ElevenLabs TTS WebSocket: the HK API
 * mints a single-use token (POST /v1/voice/tts/token) and the browser opens
 * the WS to ElevenLabs directly. Audio bytes never transit the HK API.
 *
 * The full WebSocket path (audio playback, isFinal, waveform animation) is
 * too brittle to assert from a headless browser — those layers are exercised
 * by the AudioPanel unit tests and the voice.routes integration tests. This
 * spec asserts the SPA-level contract:
 *   - The "Listen to Lumi" tab renders the AudioPanel
 *   - Initial idle state is correct (play button + status text)
 *   - Clicking play issues POST /v1/voice/tts/token with auth header
 *   - 401 on the token endpoint surfaces a user-visible error
 *   - 502 on the token endpoint surfaces a user-visible error
 *   - Play button is disabled while connecting
 */

/** Navigate to /onboarding and switch to the "Listen to Lumi" tab. */
async function navigateToAudioPanel(page: import('@playwright/test').Page) {
  await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
  // The tab button has text content "Listen to Lumi"; use an exact text match
  // scoped to the tab bar to avoid conflating it with the AudioPanel play button
  // (which has aria-label="Listen to Lumi" but no visible text).
  await page.getByRole('button', { name: 'Listen to Lumi', exact: true }).first().click();
}

/** The AudioPanel play/pause button — identified by aria-label, never by text content. */
function audioPlayButton(page: import('@playwright/test').Page) {
  return page.locator('button[aria-label="Listen to Lumi"], button[aria-label="Pause Lumi"]');
}

test.describe('Story 2-S20: TTS "Listen to Lumi" tab on onboarding landing', () => {
  test('AudioPanel renders in idle state when "Listen to Lumi" tab is active', async ({
    page,
  }) => {
    await navigateToAudioPanel(page);

    await expect(audioPlayButton(page)).toBeVisible();
    await expect(page.getByRole('status')).toHaveText(/tap play to hear lumi read this aloud/i);
  });

  test('clicking play calls POST /v1/voice/tts/token and receives a token', async ({
    page,
  }) => {
    // page.route() with route.fulfill() doesn't intercept cross-origin requests
    // reliably here (4173 → 3001 with Authorization triggers CORS preflight;
    // fulfilling the OPTIONS without CORS headers causes the browser to fail
    // the preflight before the POST fires). Instead, patch window.fetch inside
    // the page's JS context with page.evaluate() after navigation — same
    // execution world as the React bundle, so the patch is picked up by hkFetch.
    await navigateToAudioPanel(page);

    await page.evaluate(() => {
      const orig = (window as Window & { _origFetch?: typeof fetch }).fetch.bind(window);
      (window as Window & { _origFetch?: typeof fetch })._origFetch = orig;
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : (input as Request).url ?? (input as URL).toString();
        if (url.includes('/v1/voice/tts/token')) {
          const hdrs = (init?.headers ?? {}) as Record<string, string>;
          (window as Record<string, unknown>)['__ttsTokenCapture'] = {
            method: init?.method ?? 'GET',
            authorization: hdrs['Authorization'] ?? hdrs['authorization'] ?? null,
          };
          return new Response(
            JSON.stringify({ token: 'el-test-single-use-token', voice_id: 'voice_test_xyz', model_id: 'eleven_flash_v2_5' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return orig(input as Parameters<typeof orig>[0], init);
      };
    });

    await audioPlayButton(page).click();

    await page.waitForFunction(() => !!(window as Record<string, unknown>)['__ttsTokenCapture']);
    const capture = await page.evaluate(
      () => (window as Record<string, unknown>)['__ttsTokenCapture'] as { method: string; authorization: string | null },
    );

    expect(capture.method).toBe('POST');
    expect(capture.authorization).toMatch(/^Bearer /i);
  });

  test('play button is disabled while connecting to Lumi', async ({ page }) => {
    // Simulate a slow upstream — never fulfill so the component stays in
    // "connecting" state long enough to assert the disabled attribute.
    await page.route('**/v1/voice/tts/token', () => {
      // intentionally never resolve
    });

    await navigateToAudioPanel(page);
    await audioPlayButton(page).click();

    await expect(page.getByRole('status')).toHaveText(/connecting to lumi/i);
    await expect(audioPlayButton(page)).toBeDisabled();
  });

  test('401 from /v1/voice/tts/token surfaces an error status', async ({ page }) => {
    await page.route('**/v1/voice/tts/token', (route) =>
      route.fulfill({
        status: 401,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/unauthorized', status: 401, title: 'Unauthorized' }),
      }),
    );

    await navigateToAudioPanel(page);
    await audioPlayButton(page).click();

    // Any error from hkFetch is surfaced as an error status label.
    // The exact message is implementation-defined; we assert it is not the
    // happy-path idle label.
    await expect(page.getByRole('status')).not.toHaveText(/tap play to hear lumi read this aloud/i);
  });

  test('502 from /v1/voice/tts/token surfaces the upstream error label', async ({ page }) => {
    await page.route('**/v1/voice/tts/token', (route) =>
      route.fulfill({
        status: 502,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({
          type: '/errors/upstream',
          status: 502,
          title: 'Upstream error',
          detail: 'ElevenLabs single-use-token mint failed',
        }),
      }),
    );

    await navigateToAudioPanel(page);
    await audioPlayButton(page).click();

    await expect(page.getByRole('status')).not.toHaveText(/tap play to hear lumi read this aloud/i);
    // After error the play button must be re-enabled so users can retry.
    await expect(audioPlayButton(page)).toBeEnabled();
  });

  test('switching away from "Listen to Lumi" tab and back resets to idle', async ({ page }) => {
    await navigateToAudioPanel(page);

    // Tab away to "Read Text" and back — component unmounts + remounts.
    await page.getByRole('button', { name: /read text/i }).click();
    await expect(page.getByRole('status')).not.toBeVisible();

    await page.getByRole('button', { name: /listen to lumi/i }).click();
    await expect(page.getByRole('status')).toHaveText(/tap play to hear lumi read this aloud/i);
  });
});

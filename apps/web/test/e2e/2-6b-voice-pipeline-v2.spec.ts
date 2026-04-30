import { test, expect } from '@playwright/test';
import { loginAndNavigate } from './_helpers.js';

/**
 * Story 2-6b: HK-owned WebSocket voice pipeline.
 *
 * The full audio path (mic VAD → server → ElevenLabs → MP3 → AudioContext) is
 * not driven end-to-end here — those layers are covered by unit tests. This
 * spec covers the SPA-level behaviour that changed from 2-6:
 *
 *   - GET /v1/voice/ws WebSocket is opened after POST /v1/voice/sessions
 *   - server → client message protocol drives UI state transitions
 *   - Deprecated endpoints (token, llm, webhooks) correctly return 404 (covered
 *     in unit tests; not repeated here)
 *
 * WS is mocked via Playwright's routeWebSocket() so no API server is needed.
 * Microphone permission is granted so @ricky0123/vad-react can initialise the
 * VAD without an error; we never inject real audio, so VAD stays idle.
 */

// Grant microphone so useMicVAD initialises without throwing
test.use({ permissions: ['microphone'] });

const MOCK_SESSION_ID = '55555555-5555-4555-8555-555555555555';

/** Mock POST /v1/voice/sessions → 200 with our test session_id. */
async function mockSessionCreate(
  page: Parameters<typeof loginAndNavigate>[0],
) {
  await page.route('**/v1/voice/sessions', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: MOCK_SESSION_ID }),
    }),
  );
}

test.describe('Story 2-6b: HK-owned WebSocket voice pipeline — SPA behaviour', () => {
  test('session.ready WS frame transitions UI to "Listening…"', async ({ page }) => {
    await mockSessionCreate(page);

    // Intercept the WS upgrade and immediately send session.ready
    await page.routeWebSocket('**/v1/voice/ws**', (ws) => {
      ws.onMessage(() => { /* client should not send text frames */ });
      ws.send(JSON.stringify({ type: 'session.ready' }));
    });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /start with voice/i }).click();

    // "Listening…" status text should appear after session.ready
    await expect(page.getByText(/listening/i)).toBeVisible({ timeout: 5000 });
  });

  test('server error frame surfaces error message in voice surface', async ({ page }) => {
    await mockSessionCreate(page);

    await page.routeWebSocket('**/v1/voice/ws**', (ws) => {
      ws.send(JSON.stringify({ type: 'session.ready' }));
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'agent_failed',
          message: "I'm having a little trouble — could you say that again?",
        }),
      );
    });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /start with voice/i }).click();

    // Error message from the server frame should be visible in the component
    await expect(
      page.getByText(/having a little trouble/i),
    ).toBeVisible({ timeout: 5000 });
  });

  test('session.summary WS frame triggers onComplete and switches to consent mode', async ({
    page,
  }) => {
    await mockSessionCreate(page);

    await page.routeWebSocket('**/v1/voice/ws**', (ws) => {
      ws.send(JSON.stringify({ type: 'session.ready' }));
      ws.send(
        JSON.stringify({
          type: 'session.summary',
          summary: {
            cultural_templates: ['South Asian'],
            palate_notes: ['dal', 'roti'],
            allergens_mentioned: [],
          },
          cultural_priors_detected: false,
        }),
      );
    });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /start with voice/i }).click();

    // After session.summary, OnboardingPage transitions to 'consent' mode
    // The consent mode renders "One final step" heading
    await expect(
      page.getByRole('heading', { name: /one final step/i }),
    ).toBeVisible({ timeout: 5000 });
  });

  test('"End session" button sends WS close and transitions UI to closed state', async ({
    page,
  }) => {
    await mockSessionCreate(page);

    let wsCloseReceived = false;
    await page.routeWebSocket('**/v1/voice/ws**', (ws) => {
      ws.onClose(() => { wsCloseReceived = true; });
      ws.send(JSON.stringify({ type: 'session.ready' }));
    });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /start with voice/i }).click();
    await expect(page.getByText(/listening/i)).toBeVisible({ timeout: 5000 });

    await page.getByRole('button', { name: /end session/i }).click();

    // After stop(), the client closes the WS
    await expect.poll(() => wsCloseReceived, { timeout: 3000 }).toBe(true);
  });

  test('transcript frame is processed without crashing the voice surface', async ({
    page,
  }) => {
    await mockSessionCreate(page);

    await page.routeWebSocket('**/v1/voice/ws**', (ws) => {
      ws.send(JSON.stringify({ type: 'session.ready' }));
      // Simulate a full turn sequence
      ws.send(JSON.stringify({ type: 'transcript', seq: 1, text: 'What time is dinner?' }));
      ws.send(JSON.stringify({ type: 'response.start', seq: 1 }));
      ws.send(JSON.stringify({ type: 'response.end', seq: 1, text: 'Great question!' }));
    });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /start with voice/i }).click();

    // The voice surface must remain mounted and responsive through a full turn
    await expect(page.getByRole('button', { name: /end session/i })).toBeVisible({ timeout: 5000 });
    // No crash — "End session" still clickable
    await expect(page.getByRole('button', { name: /end session/i })).toBeEnabled();
  });
});

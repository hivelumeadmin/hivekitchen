import { test, expect } from '@playwright/test';
import { loginAndNavigate } from './_helpers.js';

/**
 * Story 5-S16: Voice Tier Cap
 *
 * Coverage:
 *   AC2  — POST /v1/lumi/voice/sessions returns 429 when weekly cap is reached
 *   AC9  — Cap copy appears in the Lumi panel (voiceError → role="alert") on 429
 *           or on a voice_cap_reached WS frame mid-session
 *   AC6  — Text turns (POST /v1/lumi/turns) remain functional even when voice is capped
 *
 * API-level enforcement (increment_voice_usage RPC, getWeeklyUsage boundary,
 * WAV duration estimate) and WS-frame unit tests are in lumi.routes.test.ts,
 * lumi.service.test.ts, voice-usage.repository.test.ts, and voice-tier.test.ts.
 */

const MOCK_TALK_SESSION_ID = '66666666-6666-4666-8666-666666666666';
const VOICE_CAP_COPY = "You've used this week's voice time. Text still works.";
const THREAD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeTurnResponse() {
  return {
    thread_id: THREAD_ID,
    user_turn: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      thread_id: THREAD_ID,
      server_seq: 1,
      created_at: '2026-10-28T10:00:00.000Z',
      role: 'user',
      body: { type: 'message', content: 'What is for lunch today?' },
    },
    lumi_turn: {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      thread_id: THREAD_ID,
      server_seq: 2,
      created_at: '2026-10-28T10:00:01.000Z',
      role: 'lumi',
      body: { type: 'message', content: 'Text works great!' },
    },
  };
}

// ---------------------------------------------------------------------------
// AC2 / AC9 — 429 at session creation → cap copy in panel
// ---------------------------------------------------------------------------

test.describe('Story 5-S16 — cap message on 429 (AC2/AC9)', () => {
  test('cap copy appears in Lumi panel when POST /v1/lumi/voice/sessions returns 429', async ({
    page,
  }) => {
    await page.route('**/v1/lumi/voice/sessions', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 429,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: VOICE_CAP_COPY }),
      });
    });

    await loginAndNavigate(page, '/app');

    await page.getByRole('button', { name: /open lumi/i }).click();
    await expect(page.getByRole('dialog', { name: /lumi/i })).toBeVisible();

    await page.getByRole('button', { name: /voice mode/i }).click();

    await expect(page.getByRole('alert')).toContainText(VOICE_CAP_COPY, { timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// AC6 — text turns succeed after the voice cap is hit
// ---------------------------------------------------------------------------

test.describe('Story 5-S16 — text turns unaffected by voice cap (AC6)', () => {
  test('text input works after voice cap is reached', async ({ page }) => {
    await page.route('**/v1/lumi/voice/sessions', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 429,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: VOICE_CAP_COPY }),
      });
    });

    await page.route('**/v1/lumi/turns', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      return route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeTurnResponse()),
      });
    });

    await loginAndNavigate(page, '/app');

    await page.getByRole('button', { name: /open lumi/i }).click();
    await expect(page.getByRole('dialog', { name: /lumi/i })).toBeVisible();

    // Hit the voice cap
    await page.getByRole('button', { name: /voice mode/i }).click();
    await expect(page.getByRole('alert')).toContainText(VOICE_CAP_COPY, { timeout: 5000 });

    // Text turn still goes through
    await page.getByLabel(/ask lumi/i).fill('What is for lunch today?');
    await page.getByLabel(/ask lumi/i).press('Enter');

    await expect(page.getByText('Text works great!')).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// AC9 — voice_cap_reached WS frame mid-session → cap copy in panel
// ---------------------------------------------------------------------------

test.describe('Story 5-S16 — cap message on WS voice_cap_reached frame (AC9)', () => {
  // Mic permission required so useMicVAD initialises without error and the
  // session reaches 'active' state before the WS frame is processed.
  test.use({ permissions: ['microphone'] });

  test('cap copy appears when server sends voice_cap_reached error frame over WS', async ({
    page,
  }) => {
    await page.route('**/v1/lumi/voice/sessions', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ talk_session_id: MOCK_TALK_SESSION_ID }),
      });
    });

    // Best-effort DELETE so endSession cleanup does not log network errors
    await page.route(`**/v1/lumi/voice/sessions/${MOCK_TALK_SESSION_ID}`, (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      return route.fulfill({ status: 204 });
    });

    await page.routeWebSocket('**/v1/lumi/voice/ws**', (ws) => {
      ws.send(JSON.stringify({ type: 'session.ready' }));
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'voice_cap_reached',
          message: VOICE_CAP_COPY,
        }),
      );
    });

    await loginAndNavigate(page, '/app');

    await page.getByRole('button', { name: /open lumi/i }).click();
    await expect(page.getByRole('dialog', { name: /lumi/i })).toBeVisible();

    await page.getByRole('button', { name: /voice mode/i }).click();

    await expect(page.getByRole('alert')).toContainText(VOICE_CAP_COPY, { timeout: 5000 });
  });
});

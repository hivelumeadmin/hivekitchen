import { test, expect } from '@playwright/test';
import { loginAndNavigate } from './_helpers.js';

const TURN_URL = '**/v1/onboarding/text/turn';

function turnResponse(overrides: {
  lumi_response?: string;
  moment_key?: string | null;
  chip_config?: unknown;
  is_complete?: boolean;
}) {
  return {
    thread_id: '88888888-8888-4888-8888-888888888888',
    turn_id: '44444444-4444-4444-8444-444444444444',
    lumi_turn_id: '55555555-5555-4555-8555-555555555555',
    lumi_response: overrides.lumi_response ?? "Nice to meet your family — let's get started.",
    is_complete: overrides.is_complete ?? false,
    chip_config: overrides.chip_config ?? null,
    moment_key: overrides.moment_key ?? null,
  };
}

test.describe('Slice 2.5-s5: Moment 1 — Who\'s at the table', () => {
  // AC3 — header subtitle changes from legacy "Step N of ~8" to
  // "Moment 1 of 5 · Who's at the table" when the wire emits moment_key: 'm1_table'.
  test('header subtitle shows "Moment 1 of 5 · Who\'s at the table" after first turn with m1_table', async ({
    page,
  }) => {
    await page.route(TURN_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(turnResponse({ moment_key: 'm1_table' })),
      }),
    );

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();

    // Before any turn, header is still in legacy step mode.
    await expect(page.getByText(/step \d+ of ~8/i)).toBeVisible();

    await page.getByLabel(/your message to lumi/i).fill('The Sharma kitchen — two kids');
    await page.getByRole('button', { name: /^send$/i }).click();

    // After the turn resolves, header must show the moment-based subtitle.
    await expect(page.getByText(/moment 1 of 5 · who's at the table/i)).toBeVisible();
    await expect(page.getByText(/step \d+ of ~8/i)).not.toBeVisible();
  });

  // AC3 — header advances when server emits a later moment key (m2_safe).
  test('header advances to "Moment 2 of 5 · What I need to keep safe" when agent moves to m2_safe', async ({
    page,
  }) => {
    let callCount = 0;
    await page.route(TURN_URL, (route) => {
      callCount += 1;
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          callCount === 1
            ? turnResponse({ moment_key: 'm1_table' })
            : turnResponse({ moment_key: 'm2_safe', lumi_response: 'Any allergies to note?' }),
        ),
      });
    });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();

    await page.getByLabel(/your message to lumi/i).fill('Sharma kitchen, two kids');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText(/moment 1 of 5/i)).toBeVisible();

    await page.getByLabel(/your message to lumi/i).fill('Done with the intro');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText(/moment 2 of 5 · what i need to keep safe/i)).toBeVisible();
  });

  // AC2 — hint chips render with "Something like" label when chip_config is mode:hint.
  test('hint chips render below Lumi\'s message with "Something like" label', async ({
    page,
  }) => {
    await page.route(TURN_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          turnResponse({
            moment_key: 'm1_table',
            chip_config: {
              mode: 'hint',
              hints: [
                'Khan-Patel family kitchen — two kids, Layla 10 and Adam 12',
                'Sharma kitchen — three girls aged 5, 7, and 11',
                'Just my son Aarav, 8 years old',
              ],
            },
          }),
        ),
      }),
    );

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Hello');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByText(/something like/i)).toBeVisible();
    await expect(page.getByText(/Khan-Patel family kitchen/i)).toBeVisible();
    await expect(page.getByText(/Sharma kitchen/i)).toBeVisible();
    await expect(page.getByText(/Just my son Aarav/i)).toBeVisible();
  });

  // AC2 — hint chips are non-interactive; clicking one does NOT send a turn.
  test('hint chips are non-interactive — clicking does not trigger a turn submission', async ({
    page,
  }) => {
    let turnCallCount = 0;
    await page.route(TURN_URL, (route) => {
      turnCallCount += 1;
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          turnResponse({
            moment_key: 'm1_table',
            chip_config: {
              mode: 'hint',
              hints: ['Just my son Aarav, 8 years old'],
            },
          }),
        ),
      });
    });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Hello');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByText(/Just my son Aarav/i)).toBeVisible();
    const countBeforeClick = turnCallCount;
    await page.getByText(/Just my son Aarav/i).click();

    // Allow a tick for any async turn submission to start.
    await page.waitForTimeout(200);
    expect(turnCallCount).toBe(countBeforeClick);
  });

  // AC5 / MOMENT_CONFIG — summary is assigned number:6 so the progress bar
  // shows 100% (5 of 5 moments complete) rather than 80%.
  test('profile panel progress shows 100% at summary moment', async ({ page }) => {
    await page.route(TURN_URL, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(turnResponse({ moment_key: 'summary' })),
      }),
    );

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Done');
    await page.getByRole('button', { name: /^send$/i }).click();

    // Header must render "Moment 5 of 5" (clamped from number:6) not "Moment 6 of 5".
    await expect(page.getByText(/moment 5 of 5 · summary/i)).toBeVisible();

    // Profile panel footer on desktop shows "Moment 5 of 5 complete".
    // The panel is in the right column (hidden on mobile viewport — use a wider viewport).
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByText(/moment 5 of 5 complete/i)).toBeVisible();
  });

  // parseMomentKey guard — a stale or malicious directive of 'pre_start' must
  // not revert the header back to the initial state.
  test('pre_start moment_key in response is ignored — header stays on current moment', async ({
    page,
  }) => {
    let callCount = 0;
    await page.route(TURN_URL, (route) => {
      callCount += 1;
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          callCount === 1
            ? turnResponse({ moment_key: 'm1_table' })
            // Second turn returns pre_start — should be discarded.
            : turnResponse({ moment_key: 'pre_start' }),
        ),
      });
    });

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();

    await page.getByLabel(/your message to lumi/i).fill('First message');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText(/moment 1 of 5/i)).toBeVisible();

    await page.getByLabel(/your message to lumi/i).fill('Second message');
    await page.getByRole('button', { name: /^send$/i }).click();

    // Header should NOT revert to step/pre_start — moment_key 'pre_start' is
    // rejected by parseMomentKey; the UI stays on the last known moment or
    // falls back to the legacy step counter (not "pre_start" mode).
    await expect(page.getByText(/step \d+ of ~8/i).or(page.getByText(/moment \d+ of 5/i))).toBeVisible();
    // Must NOT be showing "Step 1 of ~8" which would imply a regression to
    // initial state; we've already had 2 user turns so step count is > 1.
    await expect(page.getByText(/step 1 of ~8/i)).not.toBeVisible();
  });
});

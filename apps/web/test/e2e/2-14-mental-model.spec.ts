import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

const SENTENCE_ONE =
  "The plan is always ready. Change anything, anytime. You don't need to approve it.";
const SENTENCE_TWO = 'Changes save as you go. No button needed.';

// Wire API mocks for the text onboarding path through VPC consent signing.
// Callers supply their own cultural-priors mock (and optionally mental-model-shown mock).
async function mockThroughConsent(page: Page) {
  await page.route('**/v1/onboarding/text/turn', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        thread_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        lumi_turn_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        lumi_response: 'OK.',
        is_complete: true,
      }),
    }),
  );
  await page.route('**/v1/onboarding/text/finalize', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        thread_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        summary: { cultural_templates: [], palate_notes: [], allergens_mentioned: [] },
      }),
    }),
  );
  await page.route('**/v1/compliance/consent-declaration', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_version: 'v1', content: '# Consent\nShort.' }),
    }),
  );
  await page.route('**/v1/compliance/vpc-consent', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        household_id: SAMPLE_HOUSEHOLD_ID,
        signed_at: '2026-04-29T10:00:00.000Z',
        document_version: 'v1',
        mechanism: 'soft_signed_declaration',
      }),
    }),
  );
}

// Navigate to the mental-model step via the fast-path: zero cultural priors cause
// CulturalRatificationStep to call onComplete() immediately, which sets mode to
// 'mental-model'. Returns with SENTENCE_ONE visible on screen.
//
// Note: does NOT mock /v1/onboarding/mental-model-shown so that individual tests
// can register their own handlers before calling this helper.
async function reachMentalModel(page: Page) {
  await mockThroughConsent(page);
  await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priors: [] }),
    }),
  );

  await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
  await page.getByRole('button', { name: /i'd rather type/i }).click();
  await page.getByLabel(/your message to lumi/i).fill('done');
  await page.getByRole('button', { name: /^send$/i }).click();
  await page.getByRole('button', { name: /finish onboarding/i }).click();
  await page.getByRole('button', { name: /i agree and sign/i }).click();

  // Zero priors → CulturalRatificationStep immediately calls onComplete → mental-model
  await expect(page.getByText(SENTENCE_ONE)).toBeVisible();
}

test.describe('Story 2-14: onboarding mental-model copy + anxiety-leakage telemetry', () => {
  test('renders the two exact UX-DR65 sentences (AC #1)', async ({ page }) => {
    await reachMentalModel(page);
    await expect(page.getByText(SENTENCE_ONE)).toBeVisible();
    await expect(page.getByText(SENTENCE_TWO)).toBeVisible();
  });

  test('renders exactly one "Get started" CTA and no extra chrome — no progress bar, tooltip, alert, or status region (AC #1)', async ({
    page,
  }) => {
    await reachMentalModel(page);
    await expect(page.getByRole('button', { name: /get started/i })).toHaveCount(1);
    // Anti-patterns that the UX spec explicitly forbids on this surface:
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('"Get started" navigates to /app (AC #1)', async ({ page }) => {
    await reachMentalModel(page);
    await page.getByRole('button', { name: /get started/i }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('POST /v1/onboarding/mental-model-shown fires on mount — fire-and-forget breadcrumb (AC #2)', async ({
    page,
  }) => {
    let capturedMethod: string | undefined;
    // Register BEFORE reachMentalModel so Playwright's first-match semantics pick it up.
    await page.route('**/v1/onboarding/mental-model-shown', (route, request) => {
      capturedMethod = request.method();
      return route.fulfill({ status: 204, body: '' });
    });
    await reachMentalModel(page);
    await expect.poll(() => capturedMethod).toBe('POST');
  });

  test('500 on mental-model-shown is silently swallowed — user still navigates to /app (AC #2)', async ({
    page,
  }) => {
    await page.route('**/v1/onboarding/mental-model-shown', (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server' }),
      }),
    );
    await reachMentalModel(page);
    await page.getByRole('button', { name: /get started/i }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('zero detected cultural priors → mental-model, not directly to /app — Story 2-14 regression guard', async ({
    page,
  }) => {
    // Pre-2.14: zero priors called navigate('/app') directly.
    // Post-2.14: zero priors → onComplete() → mode = 'mental-model' → user must click "Get started".
    // This test guards against that regression.
    await reachMentalModel(page);
    await expect(page).not.toHaveURL(/\/app$/);
    await expect(page.getByText(SENTENCE_ONE)).toBeVisible();
  });

  test('cultural-ratification completes (one prior confirmed) → transitions to mental-model then /app (AC #1)', async ({
    page,
  }) => {
    await mockThroughConsent(page);
    const PRIOR = {
      id: '55555555-5555-4555-8555-555555555555',
      household_id: SAMPLE_HOUSEHOLD_ID,
      key: 'halal',
      label: 'halal',
      tier: 'L1',
      state: 'detected',
      presence: 80,
      confidence: 70,
      opted_in_at: null,
      opted_out_at: null,
      last_signal_at: '2026-04-29T10:00:00.000Z',
      created_at: '2026-04-29T10:00:00.000Z',
      updated_at: '2026-04-29T10:00:00.000Z',
    };
    await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priors: [PRIOR] }),
      }),
    );
    await page.route(
      `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${PRIOR.id}`,
      (route) =>
        route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prior: { ...PRIOR, state: 'opt_in_confirmed' } }),
        }),
    );

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('done');
    await page.getByRole('button', { name: /^send$/i }).click();
    await page.getByRole('button', { name: /finish onboarding/i }).click();
    await page.getByRole('button', { name: /i agree and sign/i }).click();
    await page.getByRole('button', { name: /yes, keep it in mind/i }).click();

    // All priors resolved → onComplete → mental-model step renders
    await expect(page.getByText(SENTENCE_ONE)).toBeVisible();
    await expect(page.getByText(SENTENCE_TWO)).toBeVisible();
    await page.getByRole('button', { name: /get started/i }).click();
    await expect(page).toHaveURL(/\/app$/);
  });
});

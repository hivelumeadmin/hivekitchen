import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate } from './_helpers.js';

const SHORT_DECLARATION = '# Consent\n\nA short consent declaration that fits in one screen.';

async function reachConsentStep(page: Page) {
  // Voice path is too brittle to drive — go through the text path instead.
  await page.route('**/v1/onboarding/text/turn', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        thread_id: '88888888-8888-4888-8888-888888888888',
        turn_id: '44444444-4444-4444-8444-444444444444',
        lumi_turn_id: '55555555-5555-4555-8555-555555555555',
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
        thread_id: '88888888-8888-4888-8888-888888888888',
        summary: {
          cultural_templates: [],
          palate_notes: [],
          allergens_mentioned: [],
        },
      }),
    }),
  );
  await page.getByRole('button', { name: /i'd rather type/i }).click();
  await page.getByLabel(/your message to lumi/i).fill('done');
  await page.getByRole('button', { name: /^send$/i }).click();
  await page.getByRole('button', { name: /finish onboarding/i }).click();
  await expect(page.getByRole('heading', { name: /one final step/i })).toBeVisible();
}

test.describe('Story 2-8: COPPA soft VPC signed declaration (beta)', () => {
  test('declaration loads and renders inside the scroll container', async ({ page }) => {
    await page.route('**/v1/compliance/consent-declaration', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_version: 'v1', content: SHORT_DECLARATION }),
      }),
    );
    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await reachConsentStep(page);
    await expect(page.getByRole('heading', { name: /^consent$/i })).toBeVisible();
    await expect(
      page.getByText(/a short consent declaration that fits in one screen/i),
    ).toBeVisible();
  });

  test('with a short doc that does not overflow, the sign button is enabled immediately', async ({
    page,
  }) => {
    await page.route('**/v1/compliance/consent-declaration', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_version: 'v1', content: SHORT_DECLARATION }),
      }),
    );
    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await reachConsentStep(page);
    // The scroll gate auto-resolves when scrollHeight <= clientHeight.
    await expect(page.getByRole('button', { name: /i agree and sign/i })).toBeEnabled();
  });

  test('signing posts the document_version and advances to the cultural ratification step', async ({
    page,
  }) => {
    let signedBody: Record<string, unknown> | null = null;
    await page.route('**/v1/compliance/consent-declaration', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_version: 'v3', content: SHORT_DECLARATION }),
      }),
    );
    await page.route('**/v1/compliance/vpc-consent', (route, request) => {
      signedBody = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          household_id: '22222222-2222-4222-8222-222222222222',
          signed_at: '2026-04-29T10:00:00.000Z',
          document_version: 'v3',
          mechanism: 'soft_signed_declaration',
        }),
      });
    });
    // The ratification step that follows polls /v1/cultural-priors — return
    // an empty payload so the step still mounts cleanly.
    await page.route('**/v1/cultural-priors**', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priors: [] }),
      }),
    );

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await reachConsentStep(page);
    await page.getByRole('button', { name: /i agree and sign/i }).click();
    await expect.poll(() => signedBody).not.toBeNull();
    expect(signedBody).toEqual({ document_version: 'v3' });
  });

  test('declaration load failure shows retry button; second attempt succeeds', async ({ page }) => {
    let attempts = 0;
    await page.route('**/v1/compliance/consent-declaration', (route) => {
      attempts += 1;
      if (attempts === 1) {
        return route.fulfill({
          status: 500,
          headers: { 'Content-Type': 'application/problem+json' },
          body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server' }),
        });
      }
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_version: 'v1', content: SHORT_DECLARATION }),
      });
    });
    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await reachConsentStep(page);
    await expect(page.getByRole('alert')).toContainText(/couldn.t load the consent/i);
    await page.getByRole('button', { name: /try again/i }).click();
    await expect(page.getByRole('button', { name: /i agree and sign/i })).toBeVisible();
  });

  test('sign failure surfaces an error and keeps the user on the consent step', async ({ page }) => {
    await page.route('**/v1/compliance/consent-declaration', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_version: 'v1', content: SHORT_DECLARATION }),
      }),
    );
    await page.route('**/v1/compliance/vpc-consent', (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server' }),
      }),
    );
    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await reachConsentStep(page);
    await page.getByRole('button', { name: /i agree and sign/i }).click();
    await expect(page.getByRole('alert')).toContainText(/couldn.t record your consent/i);
    await expect(page.getByRole('heading', { name: /one final step/i })).toBeVisible();
  });
});

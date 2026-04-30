import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

function priorFactory(overrides: { id: string; key: string; label: string; state?: string }) {
  return {
    id: overrides.id,
    household_id: SAMPLE_HOUSEHOLD_ID,
    key: overrides.key,
    label: overrides.label,
    tier: 'L1',
    state: overrides.state ?? 'detected',
    presence: 80,
    confidence: 70,
    opted_in_at: null,
    opted_out_at: null,
    last_signal_at: '2026-04-29T10:00:00.000Z',
    created_at: '2026-04-29T10:00:00.000Z',
    updated_at: '2026-04-29T10:00:00.000Z',
  };
}

const PRIOR_A = priorFactory({
  id: '66666666-6666-4666-8666-666666666666',
  key: 'south_asian',
  label: 'south_asian',
});

const PRIOR_B = priorFactory({
  id: '77777777-7777-4777-8777-777777777777',
  key: 'caribbean',
  label: 'caribbean',
});

async function reachRatificationStep(page: Page) {
  // Drive: login → text onboarding → finalize → consent → sign → ratification
  await page.route('**/v1/onboarding/text/turn', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        thread_id: '88888888-8888-4888-8888-888888888888',
        turn_id: '99999999-9999-4999-8999-999999999999',
        lumi_turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
  await page.route('**/v1/compliance/consent-declaration', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_version: 'v1',
        content: '# Consent\nShort consent declaration.',
      }),
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

  await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
  await page.getByRole('button', { name: /i'd rather type/i }).click();
  await page.getByLabel(/your message to lumi/i).fill('done');
  await page.getByRole('button', { name: /^send$/i }).click();
  await page.getByRole('button', { name: /finish onboarding/i }).click();
  await page.getByRole('button', { name: /i agree and sign/i }).click();
  await expect(page.getByRole('heading', { name: /lumi noticed a few things/i })).toBeVisible();
}

test.describe('Story 2-11: cultural template inference + parental confirmation', () => {
  test('zero detected priors auto-skips the step and lands the user on /app', async ({ page }) => {
    await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priors: [] }),
      }),
    );
    await reachRatificationStep(page);
    await expect(page).toHaveURL(/\/app$/);
  });

  test('one card per detected prior is rendered with the three sanctioned actions', async ({
    page,
  }) => {
    await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priors: [PRIOR_A, PRIOR_B] }),
      }),
    );
    await reachRatificationStep(page);
    await expect(page.getByText(/i noticed south_asian comes up/i)).toBeVisible();
    await expect(page.getByText(/i noticed caribbean comes up/i)).toBeVisible();
    // Three actions per card; with two cards that's six buttons total.
    await expect(page.getByRole('button', { name: /yes, keep it in mind/i })).toHaveCount(2);
    await expect(page.getByRole('button', { name: /tell lumi more/i })).toHaveCount(2);
    await expect(page.getByRole('button', { name: /not for us/i })).toHaveCount(2);
  });

  test('"Yes, keep it in mind" PATCHes opt_in and removes the card', async ({ page }) => {
    await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priors: [PRIOR_A] }),
      }),
    );
    let patchedBody: Record<string, unknown> | null = null;
    await page.route(
      `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${PRIOR_A.id}`,
      (route, request) => {
        patchedBody = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
        return route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prior: priorFactory({
              id: PRIOR_A.id,
              key: 'south_asian',
              label: 'south_asian',
              state: 'opt_in_confirmed',
            }),
          }),
        });
      },
    );

    await reachRatificationStep(page);
    await page.getByRole('button', { name: /yes, keep it in mind/i }).click();
    await expect.poll(() => patchedBody).toEqual({ action: 'opt_in' });
    // Last card resolved → step completes → onComplete navigates to /app.
    await expect(page).toHaveURL(/\/app$/);
  });

  test('"Tell Lumi more" renders the inline reply WITHOUT removing the card', async ({ page }) => {
    await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priors: [PRIOR_A] }),
      }),
    );
    await page.route(
      `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${PRIOR_A.id}`,
      (route) =>
        route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prior: PRIOR_A,
            lumi_response: "Tell me what feels closer — Tamil home cooking, or something else?",
          }),
        }),
    );

    await reachRatificationStep(page);
    await page.getByRole('button', { name: /tell lumi more/i }).click();
    await expect(
      page.getByRole('status').filter({ hasText: /tell me what feels closer/i }),
    ).toBeVisible();
    // Card is still present — user has not finished resolving it.
    await expect(page.getByText(/i noticed south_asian comes up/i)).toBeVisible();
    await expect(page).not.toHaveURL(/\/app$/);
  });

  test('"Not for us" PATCHes forget and removes the card', async ({ page }) => {
    await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priors: [PRIOR_A] }),
      }),
    );
    let patchedBody: Record<string, unknown> | null = null;
    await page.route(
      `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${PRIOR_A.id}`,
      (route, request) => {
        patchedBody = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
        return route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prior: priorFactory({
              id: PRIOR_A.id,
              key: 'south_asian',
              label: 'south_asian',
              state: 'forgotten',
            }),
          }),
        });
      },
    );

    await reachRatificationStep(page);
    await page.getByRole('button', { name: /not for us/i }).click();
    await expect.poll(() => patchedBody).toEqual({ action: 'forget' });
    await expect(page).toHaveURL(/\/app$/);
  });

  test('403/404 from PATCH treats the prior as already-resolved (card disappears)', async ({
    page,
  }) => {
    await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priors: [PRIOR_A] }),
      }),
    );
    await page.route(
      `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${PRIOR_A.id}`,
      (route) =>
        route.fulfill({
          status: 404,
          headers: { 'Content-Type': 'application/problem+json' },
          body: JSON.stringify({ type: '/errors/not-found', status: 404, title: 'Not Found' }),
        }),
    );

    await reachRatificationStep(page);
    await page.getByRole('button', { name: /yes, keep it in mind/i }).click();
    await expect(page).toHaveURL(/\/app$/);
  });

  test('5xx error keeps the card AND surfaces a friendly error message', async ({ page }) => {
    await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priors: [PRIOR_A] }),
      }),
    );
    await page.route(
      `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors/${PRIOR_A.id}`,
      (route) =>
        route.fulfill({
          status: 500,
          headers: { 'Content-Type': 'application/problem+json' },
          body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server' }),
        }),
    );

    await reachRatificationStep(page);
    await page.getByRole('button', { name: /yes, keep it in mind/i }).click();
    await expect(page.getByRole('alert')).toContainText(/couldn.t save that/i);
    // Card is still present; user is not stranded.
    await expect(page.getByText(/i noticed south_asian comes up/i)).toBeVisible();
  });

  test('priors-list load failure shows a soft-fail Continue button that navigates to /app', async ({
    page,
  }) => {
    await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/cultural-priors`, (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server' }),
      }),
    );
    await reachRatificationStep(page);
    await expect(page.getByText(/couldn.t load lumi.s notes/i)).toBeVisible();
    await page.getByRole('button', { name: /^continue$/i }).click();
    await expect(page).toHaveURL(/\/app$/);
  });
});

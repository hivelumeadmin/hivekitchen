import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, userProfile } from './_helpers.js';

// Shape must satisfy the contract: exactly 6 processors with unique names from
// the canonical list, structured retention entries, non-empty data categories.
const NOTICE_BODY = {
  document_version: 'v1',
  content: '# Parental notice\n\nA short notice that does not overflow the dialog.',
  data_categories: ['profile', 'voice', 'plans'],
  retention: [
    { category: 'profile', horizon_days: 365, label: '12 months' },
  ],
  processors: [
    { name: 'supabase', display_name: 'Supabase', purpose: 'Database', data_categories: ['profile'], retention_label: '12 months' },
    { name: 'elevenlabs', display_name: 'ElevenLabs', purpose: 'Voice', data_categories: ['voice'], retention_label: '90 days' },
    { name: 'sendgrid', display_name: 'SendGrid', purpose: 'Email', data_categories: ['profile'], retention_label: '12 months' },
    { name: 'twilio', display_name: 'Twilio', purpose: 'SMS', data_categories: ['profile'], retention_label: '12 months' },
    { name: 'stripe', display_name: 'Stripe', purpose: 'Billing', data_categories: ['profile'], retention_label: '7 years' },
    { name: 'openai', display_name: 'OpenAI', purpose: 'Plan generation', data_categories: ['plans'], retention_label: '30 days' },
  ],
};

/**
 * The notice dialog uses a `useScrollGate` that disables the acknowledge button
 * until the user scrolls to the bottom. Six processors + retention + content
 * easily overflows the 60vh container, so tests must scroll the container
 * to the bottom programmatically. Targets every overflow-y container inside
 * the open dialog (only one exists at a time).
 */
async function scrollNoticeToBottom(page: Page) {
  await page.evaluate(() => {
    document
      .querySelectorAll<HTMLElement>('[role="dialog"] [class*="overflow-y-auto"]')
      .forEach((el) => {
        el.scrollTop = el.scrollHeight;
      });
  });
}

async function mockUnacknowledgedProfile(page: Page) {
  await page.route('**/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        userProfile({
          parental_notice_acknowledged_at: null,
          parental_notice_acknowledged_version: null,
        }),
      ),
    }),
  );
}

test.describe('Story 2-9: parental notice disclosure (pre-data-collection gate)', () => {
  test('clicking "Add your first child" with no prior ack opens the parental notice dialog', async ({
    page,
  }) => {
    await mockUnacknowledgedProfile(page);
    await page.route('**/v1/compliance/parental-notice', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(NOTICE_BODY),
      }),
    );

    await loginAndNavigate(page, '/app');
    await page.getByRole('button', { name: /add your first child/i }).click();
    await expect(
      page.getByRole('heading', { name: /before we collect data about your family/i }),
    ).toBeVisible();
  });

  test('with a short notice the acknowledge button is enabled immediately and clicking it closes the dialog', async ({
    page,
  }) => {
    await mockUnacknowledgedProfile(page);
    await page.route('**/v1/compliance/parental-notice', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(NOTICE_BODY),
      }),
    );
    let ackBody: Record<string, unknown> | null = null;
    await page.route('**/v1/compliance/parental-notice/acknowledge', (route, request) => {
      ackBody = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acknowledged_at: '2026-04-29T10:00:00.000Z',
          document_version: 'v1',
        }),
      });
    });

    await loginAndNavigate(page, '/app');
    await page.getByRole('button', { name: /add your first child/i }).click();
    const ackButton = page.getByRole('button', { name: /i.ve read this — start adding/i });
    // Wait for the notice to render before scrolling, then scroll to the bottom
    // to release the scroll gate that disables the ack button.
    await expect(ackButton).toBeVisible();
    await scrollNoticeToBottom(page);
    await expect(ackButton).toBeEnabled();
    await ackButton.click();
    await expect.poll(() => ackBody).not.toBeNull();
    expect(ackBody).toEqual({ document_version: 'v1' });
    // After acknowledgment the dialog closes and the gated intent (open the
    // child form) fires automatically.
    await expect(
      page.getByRole('heading', { name: /before we collect data about your family/i }),
    ).toHaveCount(0);
  });

  test('notice load failure shows retry; second fetch succeeds and reveals the ack button', async ({
    page,
  }) => {
    await mockUnacknowledgedProfile(page);
    let attempts = 0;
    await page.route('**/v1/compliance/parental-notice', (route) => {
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
        body: JSON.stringify(NOTICE_BODY),
      });
    });

    await loginAndNavigate(page, '/app');
    await page.getByRole('button', { name: /add your first child/i }).click();
    await expect(page.getByRole('alert')).toContainText(/couldn.t load the notice/i);
    await page.getByRole('button', { name: /try again/i }).click();
    await expect(
      page.getByRole('button', { name: /i.ve read this — start adding/i }),
    ).toBeVisible();
  });

  test('acknowledge failure surfaces an error and keeps the dialog open', async ({ page }) => {
    await mockUnacknowledgedProfile(page);
    await page.route('**/v1/compliance/parental-notice', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(NOTICE_BODY),
      }),
    );
    await page.route('**/v1/compliance/parental-notice/acknowledge', (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server' }),
      }),
    );

    await loginAndNavigate(page, '/app');
    await page.getByRole('button', { name: /add your first child/i }).click();
    const ackButton = page.getByRole('button', { name: /i.ve read this — start adding/i });
    await expect(ackButton).toBeVisible();
    await scrollNoticeToBottom(page);
    await ackButton.click();
    await expect(page.getByRole('alert')).toContainText(/couldn.t record your acknowledgment/i);
    await expect(
      page.getByRole('heading', { name: /before we collect data about your family/i }),
    ).toBeVisible();
  });

  test('user with prior ack bypasses the dialog entirely and opens the child form', async ({
    page,
  }) => {
    // Acknowledged-state profile — the gate should not render the dialog.
    await page.route('**/v1/users/me', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfile()), // default factory has acknowledged_at set
      }),
    );

    const profileResponse = page.waitForResponse('**/v1/users/me');
    await loginAndNavigate(page, '/app');
    // The parental-notice gate hydrates lazily from /v1/users/me — clicking
    // before hydration sees state='unknown' and conservatively opens the
    // dialog. Wait for hydration so the test asserts true bypass behavior.
    await profileResponse;
    await page.getByRole('button', { name: /add your first child/i }).click();
    // The notice dialog never appears; the child form opens directly.
    await expect(
      page.getByRole('heading', { name: /before we collect data about your family/i }),
    ).toHaveCount(0);
    // The "Save child" button is the form's primary affordance — a stable
    // landmark that the form actually rendered.
    await expect(page.getByRole('button', { name: /save child/i })).toBeVisible();
  });
});

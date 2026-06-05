import { test, expect } from '@playwright/test';
import { loginAndNavigate, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

const CONSENT_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/consent-history`;
const CONSENT_ROUTE = '/app/memory/consent-history';

// ── Fixture builders ────────────────────────────────────────────────────────

function consentEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    event_type: 'vpc.consented',
    metadata: { mechanism: 'signed_declaration', document_version: 'v1.0' },
    created_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function consentResponse(events: unknown[] = []) {
  return { events };
}

async function landOnConsentHistory(
  page: import('@playwright/test').Page,
  events: unknown[] = [consentEvent()],
) {
  await page.route(CONSENT_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(consentResponse(events)),
    }),
  );
  await loginAndNavigate(page, CONSENT_ROUTE);
  await page.waitForResponse(CONSENT_URL);
}

// ── Tests ───────────────────────────────────────────────────────────────────

test.describe('Story 7-S9: Consent History View', () => {
  // AC8 — event list renders with human-readable label and formatted date.
  test('renders a consent event row with label and formatted date (AC8)', async ({ page }) => {
    await landOnConsentHistory(page, [
      consentEvent({
        id: '00000000-0000-4000-8000-000000000001',
        event_type: 'vpc.consented',
        metadata: { mechanism: 'signed_declaration' },
        created_at: '2026-06-01T00:00:00.000Z',
      }),
    ]);

    await expect(page.getByText(/consent recorded/i)).toBeVisible();
    // Date is inside a <li> — scope away from the footer copyright year.
    await expect(page.locator('li').getByText(/2026/).first()).toBeVisible();
  });

  // AC8 — mechanism from metadata is appended to the event label.
  test('appends mechanism from metadata to the event label when present (AC8)', async ({
    page,
  }) => {
    await landOnConsentHistory(page, [
      consentEvent({ metadata: { mechanism: 'signed_declaration' } }),
    ]);

    await expect(page.getByText(/\(signed_declaration\)/)).toBeVisible();
  });

  // AC8 — multiple event types render with their correct labels.
  test('renders correct labels for parental_notice.acknowledged and account.created events (AC8)', async ({
    page,
  }) => {
    await landOnConsentHistory(page, [
      consentEvent({
        id: '00000000-0000-4000-8000-000000000001',
        event_type: 'parental_notice.acknowledged',
        metadata: {},
        created_at: '2026-06-02T00:00:00.000Z',
      }),
      consentEvent({
        id: '00000000-0000-4000-8000-000000000002',
        event_type: 'account.created',
        metadata: {},
        created_at: '2026-06-01T00:00:00.000Z',
      }),
    ]);

    await expect(page.getByText(/parental notice acknowledged/i)).toBeVisible();
    await expect(page.getByText(/account created/i)).toBeVisible();
  });

  // AC8 — unknown event_type falls back to the raw event_type string.
  test('falls back to the raw event_type string for an unknown event type (AC8)', async ({
    page,
  }) => {
    await landOnConsentHistory(page, [
      consentEvent({ event_type: 'vpc.revoked', metadata: {} }),
    ]);

    await expect(page.getByText('vpc.revoked')).toBeVisible();
  });

  // AC7 + AC8 — empty-state line renders when events: [].
  test('shows empty-state copy and no event rows when events is empty (AC7 + AC8)', async ({
    page,
  }) => {
    await landOnConsentHistory(page, []);

    await expect(
      page.getByText(/No consent events have been recorded for this household yet/i),
    ).toBeVisible();
    await expect(page.getByText(/consent recorded/i)).toHaveCount(0);
  });

  // AC8 — loading skeleton shows before fetch resolves.
  test('shows a loading status indicator before the fetch resolves (AC8)', async ({ page }) => {
    await page.route(CONSENT_URL, () => undefined); // never fulfill
    await loginAndNavigate(page, CONSENT_ROUTE);

    await expect(
      page.getByRole('status', { name: /loading your consent history/i }),
    ).toBeVisible();
    await expect(
      page.getByText(/No consent events have been recorded/i),
    ).toHaveCount(0);
  });

  // AC8 — honest error line with role=alert on API failure.
  test('shows a role=alert error line when the consent-history API returns 500 (AC8)', async ({
    page,
  }) => {
    await page.route(CONSENT_URL, (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'internal server error' }),
      }),
    );
    await loginAndNavigate(page, CONSENT_ROUTE);

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("couldn't load your consent history");
  });

  // AC1 — route is reachable and URL is preserved after load.
  test('route /app/memory/consent-history is reachable and stays on that URL after load (AC1)', async ({
    page,
  }) => {
    await landOnConsentHistory(page);

    await expect(page).toHaveURL(/\/app\/memory\/consent-history/);
    await expect(page.getByRole('heading', { name: /consent history/i })).toBeVisible();
  });

  // AC1 — unauthenticated visitor is redirected to login with a next param.
  test('unauthenticated visit redirects to /auth/login with next=/app/memory/consent-history (AC1)', async ({
    page,
  }) => {
    await page.route('**/v1/auth/refresh', (route) =>
      route.fulfill({ status: 401, body: '' }),
    );
    await page.goto(CONSENT_ROUTE);
    await page.waitForURL(/\/auth\/login/);
    expect(page.url()).toContain('next=');
  });
});

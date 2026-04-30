import { test, expect } from '@playwright/test';
import { loginAndNavigate } from './_helpers.js';

const OPENING_GREETING_FRAGMENT = /i'm lumi.*your family/i;

test.describe('Story 2-7: text-equivalent onboarding path', () => {
  test('clicking "I\'d rather type" mounts the text conversation with Lumi\'s opening greeting', async ({
    page,
  }) => {
    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await expect(page.getByText(OPENING_GREETING_FRAGMENT)).toBeVisible();
    await expect(page.getByLabel(/your message to lumi/i)).toBeVisible();
  });

  test('Send is disabled while the textarea is empty and re-enabled after typing', async ({
    page,
  }) => {
    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    const send = page.getByRole('button', { name: /^send$/i });
    await expect(send).toBeDisabled();
    await page.getByLabel(/your message to lumi/i).fill('My grandmother made daal.');
    await expect(send).toBeEnabled();
  });

  test('successful turn: user message echoed, Lumi response appended', async ({ page }) => {
    await page.route('**/v1/onboarding/text/turn', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: '88888888-8888-4888-8888-888888888888',
          turn_id: '44444444-4444-4444-8444-444444444444',
          lumi_turn_id: '55555555-5555-4555-8555-555555555555',
          lumi_response: 'Tell me more about that.',
          is_complete: false,
        }),
      }),
    );

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('My grandmother made daal.');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText('My grandmother made daal.')).toBeVisible();
    await expect(page.getByText('Tell me more about that.')).toBeVisible();
  });

  test('is_complete=true reveals the Finish onboarding button', async ({ page }) => {
    await page.route('**/v1/onboarding/text/turn', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: '88888888-8888-4888-8888-888888888888',
          turn_id: '44444444-4444-4444-8444-444444444444',
          lumi_turn_id: '55555555-5555-4555-8555-555555555555',
          lumi_response: "I have what I need — let's wrap up.",
          is_complete: true,
        }),
      }),
    );
    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('We eat rice and lentils most days.');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByRole('button', { name: /finish onboarding/i })).toBeVisible();
    // Textarea must be disabled once Lumi signals completion.
    await expect(page.getByLabel(/your message to lumi/i)).toBeDisabled();
  });

  test('502 (upstream LLM hiccup) keeps the user turn rendered and shows a retry-y message', async ({
    page,
  }) => {
    await page.route('**/v1/onboarding/text/turn', (route) =>
      route.fulfill({
        status: 502,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/upstream', status: 502, title: 'Upstream' }),
      }),
    );
    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Test message that the server will reject.');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByRole('alert')).toContainText(/little trouble.*try sending that again/i);
    // F11/F12 — for 502 the user turn stays rendered (server kept it).
    await expect(page.getByText('Test message that the server will reject.')).toBeVisible();
  });

  test('non-502 failure rolls the user turn back into the draft for editing', async ({ page }) => {
    await page.route('**/v1/onboarding/text/turn', (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server' }),
      }),
    );
    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    const textarea = page.getByLabel(/your message to lumi/i);
    await textarea.fill('Will be rolled back on 500.');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByRole('alert')).toContainText(/something went wrong/i);
    // F11/F12 — the optimistic user turn is removed and the text comes back to the draft.
    await expect(page.getByText('Will be rolled back on 500.', { exact: false })).toBeVisible();
    await expect(textarea).toHaveValue('Will be rolled back on 500.');
  });

  test('finalize success advances to the consent step', async ({ page }) => {
    await page.route('**/v1/onboarding/text/turn', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thread_id: '88888888-8888-4888-8888-888888888888',
          turn_id: '99999999-9999-4999-8999-999999999999',
          lumi_turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          lumi_response: 'ack',
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
    // The consent step calls /v1/compliance/consent-declaration on mount.
    await page.route('**/v1/compliance/consent-declaration', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_version: 'v1',
          content: '# Consent\nA short doc.',
        }),
      }),
    );

    await loginAndNavigate(page, '/onboarding', { isFirstLogin: true });
    await page.getByRole('button', { name: /i'd rather type/i }).click();
    await page.getByLabel(/your message to lumi/i).fill('Done.');
    await page.getByRole('button', { name: /^send$/i }).click();
    await page.getByRole('button', { name: /finish onboarding/i }).click();
    await expect(page.getByRole('heading', { name: /one final step/i })).toBeVisible();
  });
});

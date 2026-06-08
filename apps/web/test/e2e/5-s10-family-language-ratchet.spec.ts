import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

// Story 5-S10 — Cultural Recognition: family-language ratchet.
// The parent uses a kinship term ("Nani") in ambient Lumi; the API returns a
// family_language_prompt as `ratification_turn` on the same POST /v1/lumi/turns
// response, which the panel renders as a <FamilyLanguageRatificationCard>. Opt-in
// locks the term forward-only. Includes the review-patch D1 suppression path:
// a prompt whose term is already `active` must NOT render.
//
// Auth is required: the ratify URL is /v1/households/:id/... and the review patch
// disables the pills when no household is in scope, so we log in (household =
// SAMPLE_HOUSEHOLD_ID via authUser()).

const THREAD_ID = '88888888-8888-4888-8888-888888888888';

interface TermState {
  state: 'candidate' | 'active' | 'forgotten';
}

function familyLanguageTerm(overrides: TermState) {
  return {
    term: 'Nani',
    maps_to: 'grandmother',
    usage_count: 2,
    state: overrides.state,
    first_seen_at: '2026-06-08T10:00:00.000Z',
    ratified_at: overrides.state === 'active' ? '2026-06-08T10:05:00.000Z' : null,
  };
}

// POST /v1/lumi/turns response carrying the ratification turn (AC3).
function turnResponseWithRatification(userContent = 'I had lunch with Nani') {
  return {
    thread_id: THREAD_ID,
    user_turn: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      thread_id: THREAD_ID,
      server_seq: 1,
      created_at: '2026-06-08T12:00:00.000Z',
      role: 'user',
      body: { type: 'message', content: userContent },
    },
    lumi_turn: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      thread_id: THREAD_ID,
      server_seq: 2,
      created_at: '2026-06-08T12:00:01.000Z',
      role: 'lumi',
      body: { type: 'message', content: 'Lovely — that sounds like a warm lunch.' },
    },
    ratification_turn: {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      thread_id: THREAD_ID,
      server_seq: 3,
      created_at: '2026-06-08T12:00:02.000Z',
      role: 'lumi',
      body: { type: 'family_language_prompt', term: 'Nani', maps_to: 'grandmother' },
    },
  };
}

// Mock GET /v1/households/:id/family-language (review-patch D1 suppression source).
// NOTE: the trailing-segment glob keeps this from matching .../family-language/ratify.
async function mockFamilyLanguageTerms(page: Page, state: TermState['state']) {
  await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/family-language`, (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terms: [familyLanguageTerm({ state })] }),
    });
  });
}

async function mockTurnPost(page: Page) {
  await page.route('**/v1/lumi/turns', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(turnResponseWithRatification()),
    });
  });
}

async function openPanelAndSendNani(page: Page) {
  await loginAndNavigate(page, '/app');
  await page.getByRole('button', { name: /open lumi/i }).click();
  await page.getByLabel(/ask lumi/i).fill('I had lunch with Nani');
  await page.getByLabel(/ask lumi/i).press('Enter');
}

test.describe('Story 5-S10: family-language ratchet', () => {
  test('a family_language_prompt turn renders the ratification card with the three sanctioned actions (AC2, AC10)', async ({
    page,
  }) => {
    await mockFamilyLanguageTerms(page, 'candidate'); // not yet resolved → card shows
    await mockTurnPost(page);

    await openPanelAndSendNani(page);

    await expect(page.getByText(/i noticed you call them/i)).toBeVisible();
    // The kinship term is shown (sacred-plum tinted in the UI). Exact match so we
    // hit the <span> term, not the "I had lunch with Nani" user message.
    await expect(page.getByText('Nani', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /yes, keep it in mind/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /tell lumi more/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /not for us/i })).toBeVisible();
  });

  test('"Yes, keep it in mind" POSTs opt_in and removes the card (AC4)', async ({ page }) => {
    await mockFamilyLanguageTerms(page, 'candidate');
    await mockTurnPost(page);

    let ratifyBody: Record<string, unknown> | null = null;
    await page.route(
      `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/family-language/ratify`,
      async (route) => {
        ratifyBody = (await route.request().postDataJSON()) as Record<string, unknown>;
        return route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ term: familyLanguageTerm({ state: 'active' }) }),
        });
      },
    );

    await openPanelAndSendNani(page);
    await expect(page.getByText(/i noticed you call them/i)).toBeVisible();

    await page.getByRole('button', { name: /yes, keep it in mind/i }).click();

    await expect.poll(() => ratifyBody).toEqual({ term: 'Nani', action: 'opt_in' });
    // onResolved removes the card.
    await expect(page.getByText(/i noticed you call them/i)).toHaveCount(0);
  });

  test('"Tell Lumi more" renders the inline reply WITHOUT removing the card (AC6)', async ({
    page,
  }) => {
    await mockFamilyLanguageTerms(page, 'candidate');
    await mockTurnPost(page);

    await page.route(
      `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/family-language/ratify`,
      (route) =>
        route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            term: familyLanguageTerm({ state: 'candidate' }),
            lumi_response: "Tell me — what should I call them, and I'll use your word.",
          }),
        }),
    );

    await openPanelAndSendNani(page);
    await expect(page.getByText(/i noticed you call them/i)).toBeVisible();

    await page.getByRole('button', { name: /tell lumi more/i }).click();

    await expect(
      page.getByRole('status').filter({ hasText: /what should i call them/i }),
    ).toBeVisible();
    // Card is still present — the parent has not decided yet.
    await expect(page.getByText(/i noticed you call them/i)).toBeVisible();
  });

  test('"Not for us" POSTs forget and removes the card (AC5 — candidate path)', async ({ page }) => {
    await mockFamilyLanguageTerms(page, 'candidate');
    await mockTurnPost(page);

    let ratifyBody: Record<string, unknown> | null = null;
    await page.route(
      `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/family-language/ratify`,
      async (route) => {
        ratifyBody = (await route.request().postDataJSON()) as Record<string, unknown>;
        return route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ term: familyLanguageTerm({ state: 'forgotten' }) }),
        });
      },
    );

    await openPanelAndSendNani(page);
    await expect(page.getByText(/i noticed you call them/i)).toBeVisible();

    await page.getByRole('button', { name: /not for us/i }).click();

    await expect.poll(() => ratifyBody).toEqual({ term: 'Nani', action: 'forget' });
    await expect(page.getByText(/i noticed you call them/i)).toHaveCount(0);
  });

  test('a prompt whose term is already active is suppressed, not re-prompted (review patch D1)', async ({
    page,
  }) => {
    // The household terms report Nani as already `active` — the persisted prompt
    // must NOT render even though the turn is in the thread.
    await mockFamilyLanguageTerms(page, 'active');
    await mockTurnPost(page);

    await openPanelAndSendNani(page);

    // The user + Lumi message turns still appear…
    await expect(page.getByText('Lovely — that sounds like a warm lunch.')).toBeVisible();
    // …but the ratification card is suppressed because the term is resolved.
    await expect(page.getByText(/i noticed you call them/i)).toHaveCount(0);
  });

  test('a 5xx from ratify keeps the card and surfaces a friendly error (no strand)', async ({
    page,
  }) => {
    await mockFamilyLanguageTerms(page, 'candidate');
    await mockTurnPost(page);

    await page.route(`**/v1/households/${SAMPLE_HOUSEHOLD_ID}/family-language/ratify`, (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/problem+json' },
        body: JSON.stringify({ type: '/errors/server', status: 500, title: 'Server' }),
      }),
    );

    await openPanelAndSendNani(page);
    await expect(page.getByText(/i noticed you call them/i)).toBeVisible();

    await page.getByRole('button', { name: /yes, keep it in mind/i }).click();

    await expect(page.getByRole('alert')).toContainText(/couldn.t save that/i);
    // Card still present; the parent is not stranded.
    await expect(page.getByText(/i noticed you call them/i)).toBeVisible();
  });

  // AC8 (PII-safe audit) and the forward-only no-op on an ALREADY-active term are
  // server-side invariants verified by the API unit/route suite (the audit context
  // never leaves the server, and the repo no-ops a forget on an active term). They
  // are not observable through the browser, so they are not duplicated here.
});

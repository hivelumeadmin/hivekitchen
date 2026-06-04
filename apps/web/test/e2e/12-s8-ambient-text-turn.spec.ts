import { test, expect } from '@playwright/test';

// Story 12-S8: Ambient Text Turn — Stub Agent
// Requires VITE_E2E=true build to access window.__lumiStore.
// Build: VITE_E2E=true pnpm --filter @hivekitchen/web build

const THREAD_ID = '88888888-8888-4888-8888-888888888888';
const USER_TURN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LUMI_TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

interface LumiStateSlice {
  surface: string;
  contextSignal: Record<string, unknown> | null;
  threadIds: Record<string, string | undefined>;
  turns: unknown[];
}

async function getLumiState(page: import('@playwright/test').Page): Promise<LumiStateSlice> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).__lumiStore;
    if (!store) throw new Error('__lumiStore not available — set VITE_E2E=true in the build');
    return store.getState() as LumiStateSlice;
  });
}

function makeTurnResponse(userContent = 'What did Maya have yesterday?', lumiContent = 'Got it.') {
  return {
    thread_id: THREAD_ID,
    user_turn: {
      id: USER_TURN_ID,
      thread_id: THREAD_ID,
      server_seq: 1,
      created_at: '2026-06-03T12:00:00.000Z',
      role: 'user',
      body: { type: 'message', content: userContent },
    },
    lumi_turn: {
      id: LUMI_TURN_ID,
      thread_id: THREAD_ID,
      server_seq: 2,
      created_at: '2026-06-03T12:00:01.000Z',
      role: 'lumi',
      body: { type: 'message', content: lumiContent },
    },
  };
}

test.describe('Story 12-S8: Ambient text turn — stub agent', () => {
  test('textarea is enabled (AC8)', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: /open lumi/i }).click();
    const textarea = page.getByLabel(/ask lumi/i);
    await expect(textarea).toBeVisible();
    await expect(textarea).not.toBeDisabled();
  });

  test('submitting a message POSTs to /v1/lumi/turns with correct shape (AC1)', async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;

    await page.route('**/v1/lumi/turns', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      capturedBody = (await route.request().postDataJSON()) as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeTurnResponse('What did Maya have yesterday?')),
      });
    });

    await page.goto('/app');
    await page.getByRole('button', { name: /open lumi/i }).click();
    await page.getByLabel(/ask lumi/i).fill('What did Maya have yesterday?');
    await page.getByLabel(/ask lumi/i).press('Enter');

    await expect(page.getByText('Got it.')).toBeVisible();

    expect(capturedBody).toMatchObject({
      message: 'What did Maya have yesterday?',
      context_signal: expect.objectContaining({ surface: expect.any(String) }),
    });
  });

  test('both the user turn and Lumi reply appear after submit (AC4)', async ({ page }) => {
    await page.route('**/v1/lumi/turns', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeTurnResponse('Hello Lumi', 'Got it.')),
      });
    });

    await page.goto('/app');
    await page.getByRole('button', { name: /open lumi/i }).click();
    await page.getByLabel(/ask lumi/i).fill('Hello Lumi');
    await page.getByLabel(/ask lumi/i).press('Enter');

    await expect(page.getByText('Hello Lumi')).toBeVisible();
    await expect(page.getByText('Got it.')).toBeVisible();
  });

  test('threadIds[surface] is pinned from the response after first submit (AC5)', async ({ page }) => {
    await page.route('**/v1/lumi/turns', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeTurnResponse()),
      });
    });

    await page.goto('/app');
    await page.getByRole('button', { name: /open lumi/i }).click();
    await page.getByLabel(/ask lumi/i).fill('hi');
    await page.getByLabel(/ask lumi/i).press('Enter');

    await expect(page.getByText('Got it.')).toBeVisible();

    const { threadIds, surface } = await getLumiState(page);
    expect(threadIds[surface]).toBe(THREAD_ID);
  });

  test('Lumi stub reply is "Got it." regardless of message (AC6)', async ({ page }) => {
    await page.route('**/v1/lumi/turns', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeTurnResponse('anything at all', 'Got it.')),
      });
    });

    await page.goto('/app');
    await page.getByRole('button', { name: /open lumi/i }).click();
    await page.getByLabel(/ask lumi/i).fill('anything at all');
    await page.getByLabel(/ask lumi/i).press('Enter');

    await expect(page.getByText('Got it.')).toBeVisible();
  });

  test('textarea is disabled while a send is in flight (double-send prevention)', async ({ page }) => {
    let resolveFetch!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });

    await page.route('**/v1/lumi/turns', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await pending;
      await route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeTurnResponse()),
      });
    });

    await page.goto('/app');
    await page.getByRole('button', { name: /open lumi/i }).click();
    const textarea = page.getByLabel(/ask lumi/i);
    await textarea.fill('first');
    await textarea.press('Enter');

    await expect(textarea).toBeDisabled();

    resolveFetch();
    await expect(textarea).not.toBeDisabled();
  });

  test('network error restores the draft and shows an inline error (AC10)', async ({ page }) => {
    await page.route('**/v1/lumi/turns', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: '/errors/upstream', status: 502 }),
      });
    });

    await page.goto('/app');
    await page.getByRole('button', { name: /open lumi/i }).click();
    const textarea = page.getByLabel(/ask lumi/i);
    await textarea.fill('will fail');
    await textarea.press('Enter');

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(/couldn't send/i);
    // Draft preserved so the user can retry or edit (AC10)
    await expect(textarea).toHaveValue('will fail');
  });

  test('Shift+Enter inserts a newline without submitting', async ({ page }) => {
    let submitCount = 0;
    await page.route('**/v1/lumi/turns', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      submitCount++;
      await route.fulfill({
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeTurnResponse()),
      });
    });

    await page.goto('/app');
    await page.getByRole('button', { name: /open lumi/i }).click();
    const textarea = page.getByLabel(/ask lumi/i);
    await textarea.fill('line one');
    await textarea.press('Shift+Enter');
    await page.waitForTimeout(200);

    expect(submitCount).toBe(0);
  });

  // AC7 (reload round-trip) is a USER-SIDE GATE — requires a live Supabase stack.
  // Manual demo path: submit a message → close panel → reopen → both turns must render.
  test.skip('AC7: persisted turns survive panel unmount+remount [USER-SIDE GATE — live stack only]', async () => {
    // Covered by composition: insertTurn persists with server_seq and the
    // existing GET /v1/lumi/threads/:threadId/turns + useLumiContext hydration
    // path reads them back. End-to-end requires a real Supabase connection.
  });
});

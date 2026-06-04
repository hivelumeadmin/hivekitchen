import { test, expect } from '@playwright/test';
import { loginAndNavigate, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

const MEMORY_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/memory`;

function memoryResponse(nodes: unknown[] = []) {
  return { nodes };
}

function sampleNode(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    household_id: SAMPLE_HOUSEHOLD_ID,
    node_type: 'preference',
    facet: 'avoids spicy',
    subject_child_id: null,
    prose_text: 'Layla avoids spicy peppers.',
    soft_forget_at: null,
    hard_forgotten: false,
    created_at: '2026-04-30T00:00:00.000Z',
    updated_at: '2026-04-30T00:00:00.000Z',
    ...overrides,
  };
}

async function landOnMemory(
  page: import('@playwright/test').Page,
  nodes: unknown[] = [],
) {
  await page.route(MEMORY_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(memoryResponse(nodes)),
    }),
  );
  await loginAndNavigate(page, '/app/memory');
  await page.waitForResponse(MEMORY_URL);
}

test.describe('Story 7-S1: Visible Memory Read', () => {
  // AC1 — page renders each active node as a prose sentence row.
  test('renders a prose row for each active memory node returned by the API (AC1)', async ({
    page,
  }) => {
    await landOnMemory(page, [
      sampleNode({ id: '00000000-0000-4000-8000-00000000000a', prose_text: 'Layla avoids spicy peppers.' }),
      sampleNode({ id: '00000000-0000-4000-8000-00000000000b', prose_text: 'Thursday is leftover night.' }),
    ]);

    await expect(page.getByText('Layla avoids spicy peppers.')).toBeVisible();
    await expect(page.getByText('Thursday is leftover night.')).toBeVisible();
  });

  // AC2 — each row has an always-present "More options" button stub.
  test('every memory row has an aria-labeled "More options" button (AC2)', async ({ page }) => {
    await landOnMemory(page, [
      sampleNode({ id: '00000000-0000-4000-8000-00000000000a', prose_text: 'First node.' }),
      sampleNode({ id: '00000000-0000-4000-8000-00000000000b', prose_text: 'Second node.' }),
    ]);

    const buttons = page.getByRole('button', { name: 'More options' });
    await expect(buttons).toHaveCount(2);
  });

  // AC3 — exact UX-DR39 empty-state copy, no CTA.
  test('shows exact UX-DR39 empty-state copy when no active nodes exist (AC3)', async ({
    page,
  }) => {
    await landOnMemory(page, []);

    await expect(
      page.getByText(
        'Lumi is still learning about your family. Memory will show up here as patterns appear.',
      ),
    ).toBeVisible();
    // No "More options" row-action buttons when the list is empty.
    await expect(page.getByRole('button', { name: 'More options' })).toHaveCount(0);
  });

  // AC4 — loading skeleton is shown while the fetch is in-flight; empty state never flashes first.
  test('shows a loading status indicator before the fetch resolves and never flashes empty state (AC4)', async ({
    page,
  }) => {
    // Never fulfill — holds the request open.
    await page.route(MEMORY_URL, () => undefined);
    await loginAndNavigate(page, '/app/memory');

    await expect(page.getByRole('status')).toBeVisible();
    // Empty-state copy must not appear before the fetch completes.
    await expect(
      page.getByText(/still learning about your family/i),
    ).toHaveCount(0);
  });

  // AC5 — honest error line on API failure with role=alert.
  test('shows an honest error line with role=alert when the memory API returns 500 (AC5)', async ({
    page,
  }) => {
    await page.route(MEMORY_URL, (route) =>
      route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'internal server error' }),
      }),
    );
    await loginAndNavigate(page, '/app/memory');

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Lumi couldn't load your memory right now. Try refreshing.");
  });

  // AC1 — route is mounted at /app/memory and the URL is preserved after load.
  test('route /app/memory is reachable and stays on that URL after load (AC1)', async ({
    page,
  }) => {
    await landOnMemory(page);
    await expect(page).toHaveURL(/\/app\/memory/);
  });

  // AC1 — unauthenticated visitor is redirected to login with a next param.
  test('unauthenticated visit redirects to /auth/login with next=/app/memory', async ({ page }) => {
    await page.route('**/v1/auth/refresh', (route) =>
      route.fulfill({ status: 401, body: '' }),
    );
    await page.goto('/app/memory');
    await page.waitForURL(/\/auth\/login/);
    expect(page.url()).toContain('next=');
  });
});

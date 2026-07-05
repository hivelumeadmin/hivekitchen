import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

// One active node (we drive its `⋯` → Forget) and one already soft-forgotten
// node (renders as a tombstone from the initial list).
const ACTIVE_NODE_ID = '00000000-0000-4000-8000-00000000000a';
const FORGOTTEN_NODE_ID = '00000000-0000-4000-8000-00000000000b';

const MEMORY_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/memory`;
const PROVENANCE_URL = '**/v1/memory/*/provenance';
// Specific forget glob — avoids colliding with the bare edit PATCH path.
const FORGET_URL = '**/v1/memory/*/forget';

const ORIGINAL = 'Layla avoids spicy peppers.';

function sampleNode(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTIVE_NODE_ID,
    household_id: SAMPLE_HOUSEHOLD_ID,
    node_type: 'other',
    facet: 'avoids spicy',
    subject_child_id: null,
    prose_text: ORIGINAL,
    soft_forget_at: null,
    forget_reason: null,
    hard_forgotten: false,
    created_at: '2026-04-30T00:00:00.000Z',
    updated_at: '2026-04-30T00:00:00.000Z',
    ...overrides,
  };
}

function sampleProvenance(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-0000000000f1',
    memory_node_id: ACTIVE_NODE_ID,
    source_type: 'turn',
    source_ref: {},
    captured_at: '2026-04-21T10:00:00.000Z',
    captured_by: '00000000-0000-4000-8000-0000000000f2',
    confidence: 0.87,
    superseded_by: null,
    ...overrides,
  };
}

// Mock the memory list (one active + one soft-forgotten node), provenance, and
// the forget PATCH (echoes the request reason). Drive login, land on /app/memory.
async function landOnMemory(page: Page): Promise<{ forgetCalls: () => number }> {
  let forgetCalls = 0;

  await page.route(MEMORY_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: [
          sampleNode(),
          sampleNode({
            id: FORGOTTEN_NODE_ID,
            prose_text: 'Thursday is leftover night.',
            soft_forget_at: '2026-05-01T00:00:00.000Z',
            forget_reason: 'too spicy',
          }),
        ],
      }),
    }),
  );

  await page.route(PROVENANCE_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provenance: [sampleProvenance()] }),
    }),
  );

  // PATCH /v1/memory/<id>/forget → echo the reason back on the forgotten node.
  await page.route(FORGET_URL, (route) => {
    if (route.request().method() !== 'PATCH') {
      route.fallback();
      return;
    }
    forgetCalls += 1;
    const body = route.request().postDataJSON() as { reason?: string } | null;
    const reason = body?.reason ?? null;
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        node: sampleNode({
          id: ACTIVE_NODE_ID,
          soft_forget_at: '2026-06-05T00:00:00.000Z',
          forget_reason: reason,
        }),
      }),
    });
  });

  await loginAndNavigate(page, '/app/memory');
  await page.waitForResponse(MEMORY_URL);

  return { forgetCalls: () => forgetCalls };
}

test.describe('Story 7-S4: Soft-forget a memory sentence', () => {
  // AC4/AC10 — active node renders prose + `⋯`; a soft-forgotten node renders
  // the tombstone (with reason) and no `⋯`.
  test('renders active prose with `⋯` and a tombstone for an already-forgotten node (AC4/AC10)', async ({
    page,
  }) => {
    await landOnMemory(page);

    await expect(page.getByText(ORIGINAL)).toBeVisible();
    await expect(page.getByText("Lumi won't use this anymore — too spicy")).toBeVisible();
    // The forgotten row has no `⋯`; only the active row does.
    await expect(page.getByRole('button', { name: 'More options' })).toHaveCount(1);
  });

  // AC1/AC2 — open `⋯` → Forget → confirmation → Cancel → original prose, no PATCH.
  test('Cancel exits the forget confirmation and issues no PATCH (AC1/AC2)', async ({ page }) => {
    const { forgetCalls } = await landOnMemory(page);

    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('button', { name: 'Forget this memory' }).click();

    const reasonInput = page.getByPlaceholder('Why are you forgetting this? (optional)');
    await expect(reasonInput).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(reasonInput).toBeHidden();
    await expect(page.getByText(ORIGINAL)).toBeVisible();
    expect(forgetCalls()).toBe(0);
  });

  // AC3/AC4 — open `⋯` → Forget → type a reason → Confirm → tombstone with reason.
  test('forgets with a reason and renders the tombstone with the reason (AC3/AC4)', async ({
    page,
  }) => {
    const { forgetCalls } = await landOnMemory(page);

    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('button', { name: 'Forget this memory' }).click();

    await page.getByPlaceholder('Why are you forgetting this? (optional)').fill('no longer needed');
    await page.getByRole('button', { name: 'Confirm forget' }).click();

    await expect(page.getByText("Lumi won't use this anymore — no longer needed")).toBeVisible();
    await expect(page.getByText(ORIGINAL)).toBeHidden();
    expect(forgetCalls()).toBe(1);
  });

  // AC3/AC4 — Confirm with no reason → tombstone without the dash.
  test('forgets without a reason and renders the plain tombstone (AC3/AC4)', async ({ page }) => {
    const { forgetCalls } = await landOnMemory(page);

    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('button', { name: 'Forget this memory' }).click();
    await page.getByRole('button', { name: 'Confirm forget' }).click();

    await expect(page.getByText("Lumi won't use this anymore", { exact: true })).toBeVisible();
    await expect(page.getByText(ORIGINAL)).toBeHidden();
    expect(forgetCalls()).toBe(1);
  });
});

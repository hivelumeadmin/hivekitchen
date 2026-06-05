import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

// One memory node whose `⋯` → Edit we drive.
const NODE_ID = '00000000-0000-4000-8000-00000000000a';

const MEMORY_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/memory`;
const PROVENANCE_URL = '**/v1/memory/*/provenance';
// Bare node path — the PATCH target. The provenance glob (registered last →
// higher priority) carves the `/provenance` GET out so the two never collide.
const NODE_URL = '**/v1/memory/*';

const ORIGINAL = 'Layla avoids spicy peppers.';
const EDITED = 'Layla now likes mild spice.';

function sampleNode(overrides: Record<string, unknown> = {}) {
  return {
    id: NODE_ID,
    household_id: SAMPLE_HOUSEHOLD_ID,
    node_type: 'preference',
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
    memory_node_id: NODE_ID,
    source_type: 'turn',
    source_ref: {},
    captured_at: '2026-04-21T10:00:00.000Z',
    captured_by: '00000000-0000-4000-8000-0000000000f2',
    confidence: 0.87,
    superseded_by: null,
    ...overrides,
  };
}

// Mock the memory list + provenance + PATCH, drive login, land on /app/memory.
async function landOnMemory(page: Page): Promise<{ patchCalls: () => number }> {
  let patchCalls = 0;

  await page.route(MEMORY_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes: [sampleNode()] }),
    }),
  );

  // PATCH the bare node path → return the edited node. Non-PATCH requests fall
  // through to other handlers (e.g. the provenance GET registered below).
  await page.route(NODE_URL, (route) => {
    if (route.request().method() === 'PATCH') {
      patchCalls += 1;
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node: sampleNode({ prose_text: EDITED }) }),
      });
    } else {
      route.fallback();
    }
  });

  // Registered last → highest priority, so `/v1/memory/<id>/provenance` GETs
  // resolve here rather than via NODE_URL.
  await page.route(PROVENANCE_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provenance: [sampleProvenance()] }),
    }),
  );

  await loginAndNavigate(page, '/app/memory');
  await page.waitForResponse(MEMORY_URL);

  return { patchCalls: () => patchCalls };
}

test.describe('Story 7-S3: Edit a Sentence', () => {
  // AC1/AC2 — open `⋯` → Edit → inline textarea → change text → Save → the row
  // renders the updated text.
  test('edits a sentence end-to-end and reflects the new text inline (AC1/AC2)', async ({
    page,
  }) => {
    const { patchCalls } = await landOnMemory(page);

    await expect(page.getByText(ORIGINAL)).toBeVisible();

    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('button', { name: 'Edit this memory' }).click();

    const textarea = page.getByRole('textbox', { name: 'Edit memory' });
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue(ORIGINAL);

    await textarea.fill(EDITED);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText(EDITED)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Edit memory' })).toBeHidden();
    expect(patchCalls()).toBe(1);
  });

  // AC3 — Cancel exits edit mode without a PATCH and preserves the original text.
  test('Cancel preserves the original text and issues no PATCH (AC3)', async ({ page }) => {
    const { patchCalls } = await landOnMemory(page);

    await page.getByRole('button', { name: 'More options' }).click();
    await page.getByRole('button', { name: 'Edit this memory' }).click();

    const textarea = page.getByRole('textbox', { name: 'Edit memory' });
    await textarea.fill('something I will abandon');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('textbox', { name: 'Edit memory' })).toBeHidden();
    await expect(page.getByText(ORIGINAL)).toBeVisible();
    expect(patchCalls()).toBe(0);
  });
});

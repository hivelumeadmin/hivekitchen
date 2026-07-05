import { test, expect, type Page } from '@playwright/test';
import { loginAndNavigate, SAMPLE_HOUSEHOLD_ID } from './_helpers.js';

// One memory node whose `⋯` we drive. The provenance fetch keys off this id.
const NODE_ID = '00000000-0000-4000-8000-00000000000a';

const MEMORY_URL = `**/v1/households/${SAMPLE_HOUSEHOLD_ID}/memory`;
const PROVENANCE_URL = '**/v1/memory/*/provenance';

function sampleNode(overrides: Record<string, unknown> = {}) {
  return {
    id: NODE_ID,
    household_id: SAMPLE_HOUSEHOLD_ID,
    node_type: 'other',
    facet: 'avoids spicy',
    subject_child_id: null,
    prose_text: 'Layla avoids spicy peppers.',
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

// Mock the memory list, drive the SPA login, and land on /app/memory with one row.
async function landOnMemory(page: Page) {
  await page.route(MEMORY_URL, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodes: [sampleNode()] }),
    }),
  );
  await loginAndNavigate(page, '/app/memory');
  await page.waitForResponse(MEMORY_URL);
}

async function mockProvenance(page: Page, body: unknown, status = 200) {
  await page.route(PROVENANCE_URL, (route) =>
    route.fulfill({
      status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

test.describe('Story 7-S2: Provenance Chips', () => {
  // AC1 — tapping `⋯` opens the popover with the most-recent non-superseded
  // source label and confidence percentage.
  test('opens the provenance popover showing source label and confidence on `⋯` click (AC1)', async ({
    page,
  }) => {
    await landOnMemory(page);
    await mockProvenance(page, { provenance: [sampleProvenance()] });

    await page.getByRole('button', { name: 'More options' }).click();

    const region = page.getByRole('region');
    await expect(region).toBeVisible();
    await expect(region.getByText(/from a conversation on/i)).toBeVisible();
    await expect(region.getByText(/87% confident/i)).toBeVisible();
  });

  // AC9 — the trigger exposes aria-expanded (toggles) and aria-controls
  // pointing at the popover region.
  test('trigger toggles aria-expanded and wires aria-controls to the region (AC9)', async ({
    page,
  }) => {
    await landOnMemory(page);
    await mockProvenance(page, { provenance: [sampleProvenance()] });

    const trigger = page.getByRole('button', { name: 'More options' });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const region = page.getByRole('region');
    await expect(region).toBeVisible();
    const controls = await trigger.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    await expect(region).toHaveAttribute('id', controls!);
  });

  // AC8 — action pills render when ready. Story 7-S3 enabled the Edit pill and
  // Story 7-S4 enabled the Forget pill on the live memory page (Forget opens the
  // inline confirmation). Only Adjust stays disabled.
  test('renders the action pills when ready — Edit + Forget enabled, Adjust disabled (AC8, 7-S4)', async ({
    page,
  }) => {
    await landOnMemory(page);
    await mockProvenance(page, { provenance: [sampleProvenance()] });

    await page.getByRole('button', { name: 'More options' }).click();

    await expect(page.getByRole('button', { name: 'Edit this memory' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Forget this memory' })).toBeEnabled();

    const adjust = page.getByRole('button', { name: 'Adjust (available in a future update)' });
    await expect(adjust).toBeVisible();
    await expect(adjust).toBeDisabled();
  });

  // AC7 — a loading indicator shows while the provenance fetch is in-flight.
  test('shows a loading indicator while the provenance fetch is in-flight (AC7)', async ({
    page,
  }) => {
    await landOnMemory(page);
    // Hold the provenance request open so the loading state stays visible.
    await page.route(PROVENANCE_URL, () => undefined);

    await page.getByRole('button', { name: 'More options' }).click();

    await expect(page.getByRole('region').getByText(/loading/i)).toBeVisible();
  });

  // AC7 — the fetch fires only on first open; re-opening uses the cached result.
  test('fetches provenance only once across open/close/re-open cycles (AC7)', async ({ page }) => {
    await landOnMemory(page);

    let provenanceCalls = 0;
    await page.route(PROVENANCE_URL, (route) => {
      provenanceCalls += 1;
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provenance: [sampleProvenance()] }),
      });
    });

    const trigger = page.getByRole('button', { name: 'More options' });
    await trigger.click(); // open (fetch fires)
    await expect(page.getByRole('region')).toBeVisible();
    await trigger.click(); // close
    await expect(page.getByRole('region')).toBeHidden();
    await trigger.click(); // re-open (cached — no fetch)
    await expect(page.getByRole('region')).toBeVisible();

    expect(provenanceCalls).toBe(1);
  });

  // AC2 — Escape closes the popover and restores focus to the trigger.
  test('Escape closes the popover and restores focus to the trigger (AC2)', async ({ page }) => {
    await landOnMemory(page);
    await mockProvenance(page, { provenance: [sampleProvenance()] });

    const trigger = page.getByRole('button', { name: 'More options' });
    await trigger.click();
    await expect(page.getByRole('region')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('region')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  // AC3 — clicking outside the popover closes it; clicking the trigger re-opens it (toggle).
  test('click outside closes the popover and the trigger re-opens it (AC3)', async ({ page }) => {
    await landOnMemory(page);
    await mockProvenance(page, { provenance: [sampleProvenance()] });

    const trigger = page.getByRole('button', { name: 'More options' });
    await trigger.click();
    await expect(page.getByRole('region')).toBeVisible();

    // Click an element outside the trigger+region (the page heading).
    await page.getByRole('heading', { name: 'Memory' }).click();
    await expect(page.getByRole('region')).toBeHidden();

    // Toggle back open.
    await trigger.click();
    await expect(page.getByRole('region')).toBeVisible();
  });

  // AC1 / AC4 — with rows ordered captured_at DESC, the popover surfaces the
  // most-recent NON-superseded record, skipping a superseded newer one.
  test('surfaces the most-recent non-superseded record, skipping a superseded newer one (AC1/AC4)', async ({
    page,
  }) => {
    await landOnMemory(page);
    await mockProvenance(page, {
      provenance: [
        // Newest by captured_at (DESC) but superseded → must be skipped.
        sampleProvenance({
          id: '00000000-0000-4000-8000-0000000000f3',
          source_type: 'user_edit',
          captured_at: '2026-05-01T10:00:00.000Z',
          confidence: 0.99,
          superseded_by: '00000000-0000-4000-8000-0000000000f4',
        }),
        // Older but live → the record the popover must display.
        sampleProvenance({
          id: '00000000-0000-4000-8000-0000000000f4',
          source_type: 'onboarding',
          captured_at: '2026-04-01T10:00:00.000Z',
          confidence: 0.5,
          superseded_by: null,
        }),
      ],
    });

    await page.getByRole('button', { name: 'More options' }).click();

    const region = page.getByRole('region');
    await expect(region.getByText('from your setup conversation')).toBeVisible();
    await expect(region.getByText(/50% confident/i)).toBeVisible();
    await expect(region.getByText(/99% confident/i)).toHaveCount(0);
  });

  // AC1 — empty provenance (node seeded without records) renders "Source unknown".
  test('renders "Source unknown" when the node has no provenance records (AC1)', async ({
    page,
  }) => {
    await landOnMemory(page);
    await mockProvenance(page, { provenance: [] });

    await page.getByRole('button', { name: 'More options' }).click();

    await expect(page.getByRole('region').getByText('Source unknown')).toBeVisible();
  });

  // AC5 — a 404 (not-found / cross-household) surfaces as an in-popover error
  // line rather than leaking whether the node exists elsewhere.
  test('shows an error line when the provenance endpoint returns 404 (AC5)', async ({ page }) => {
    await landOnMemory(page);
    await mockProvenance(page, { type: '/errors/not-found', title: 'Memory node not found' }, 404);

    await page.getByRole('button', { name: 'More options' }).click();

    await expect(page.getByRole('region').getByText(/couldn.?t load provenance/i)).toBeVisible();
  });
});

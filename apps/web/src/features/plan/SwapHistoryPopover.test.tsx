import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { PlanSwapSummaryTree } from '@hivekitchen/types';
import { SwapHistoryPopover } from './SwapHistoryPopover.js';

afterEach(() => {
  cleanup();
});

const CHILD_A = '00000000-0000-4000-8000-0000000000a1';
const CHILD_B = '00000000-0000-4000-8000-0000000000b2';

// Story 3-DM-C1 Phase 9b part 4 step 4 — fixtures migrated from the flat
// PlanItemSwapSummary (slot + previous_ingredients) to the canonical tree
// PlanSwapSummaryTree (kind + slot_kind + at) — the canonical model has no
// archived plan_items, so audit-derived population is what the popover
// renders going forward.
function makeSwap(overrides: Partial<PlanSwapSummaryTree> = {}): PlanSwapSummaryTree {
  return {
    kind: 'main_swap',
    child_id: CHILD_A,
    day: 'monday',
    slot_kind: 'main',
    at: '2026-04-22T10:00:00.000Z',
    ...overrides,
  };
}

describe('SwapHistoryPopover (Story 3.15 — tree shape)', () => {
  it('renders a trigger labeled with the swap count (singular)', () => {
    render(<SwapHistoryPopover swaps={[makeSwap()]} />);
    const trigger = screen.getByRole('button', { name: 'View 1 swap for this day' });
    expect(trigger.textContent).toBe('1 swap');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders a trigger labeled with the swap count (plural)', () => {
    render(
      <SwapHistoryPopover
        swaps={[
          makeSwap(),
          makeSwap({ kind: 'slot_recipe_swap', slot_kind: 'extra', at: '2026-04-23T10:00:00.000Z' }),
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'View 2 swaps for this day' });
    expect(trigger.textContent).toBe('2 swaps');
  });

  it('clicking the trigger opens the region with the swap list', () => {
    render(
      <SwapHistoryPopover
        swaps={[makeSwap({ kind: 'slot_recipe_swap', slot_kind: 'extra' })]}
      />,
    );
    const trigger = screen.getByRole('button');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const region = screen.getByRole('region');
    expect(region).toBeDefined();
    expect(screen.getByText('Swap history')).toBeDefined();
    expect(screen.getByText('Slot recipe swap')).toBeDefined();
    expect(screen.getByText(/extra ·/)).toBeDefined();
  });

  it('Escape closes the region and restores focus to the trigger', () => {
    render(<SwapHistoryPopover swaps={[makeSwap()]} />);
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    const region = screen.getByRole('region');
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('region')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('clicking the trigger does not bubble (would otherwise trigger parent tile click)', () => {
    let parentClicks = 0;
    render(
      <div onClick={() => parentClicks++}>
        <SwapHistoryPopover swaps={[makeSwap()]} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(parentClicks).toBe(0);
  });

  it('renders the kind label cleanly when slot_kind is null (plan-level main_swap)', () => {
    render(<SwapHistoryPopover swaps={[makeSwap({ slot_kind: null })]} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Main swap')).toBeDefined();
  });

  it('groups swaps by child_id with fallback labels when no childLabels prop is supplied', () => {
    render(
      <SwapHistoryPopover
        swaps={[
          makeSwap({ child_id: CHILD_A, slot_kind: 'main' }),
          makeSwap({
            kind: 'slot_recipe_swap',
            child_id: CHILD_B,
            slot_kind: 'extra',
            at: '2026-04-23T10:00:00.000Z',
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Child A')).toBeDefined();
    expect(screen.getByText('Child B')).toBeDefined();
  });

  it('uses childLabels for grouping headings when provided', () => {
    render(
      <SwapHistoryPopover
        swaps={[
          makeSwap({ child_id: CHILD_A }),
          makeSwap({
            kind: 'slot_recipe_swap',
            child_id: CHILD_B,
            slot_kind: 'extra',
            at: '2026-04-23T10:00:00.000Z',
          }),
        ]}
        childLabels={{ [CHILD_A]: 'Maya', [CHILD_B]: 'Liam' }}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Maya')).toBeDefined();
    expect(screen.getByText('Liam')).toBeDefined();
  });

  it('omits child headings when there is only one child in the swap list', () => {
    render(
      <SwapHistoryPopover
        swaps={[
          makeSwap({ child_id: CHILD_A }),
          makeSwap({
            kind: 'slot_recipe_swap',
            child_id: CHILD_A,
            slot_kind: 'extra',
            at: '2026-04-23T10:00:00.000Z',
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('Child A')).toBeNull();
  });

  it('collapses plan-level (null child_id) swaps under a "Family" heading when mixed with per-child swaps', () => {
    render(
      <SwapHistoryPopover
        swaps={[
          makeSwap({ child_id: null, slot_kind: null }),
          makeSwap({
            kind: 'variation_edit',
            child_id: CHILD_A,
            slot_kind: 'snack',
            at: '2026-04-23T10:00:00.000Z',
          }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Family')).toBeDefined();
    expect(screen.getByText('Child B')).toBeDefined();
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { PlanItemSwapSummary } from '@hivekitchen/types';
import { SwapHistoryPopover } from './SwapHistoryPopover.js';

afterEach(() => {
  cleanup();
});

const CHILD_A = '00000000-0000-4000-8000-0000000000a1';
const CHILD_B = '00000000-0000-4000-8000-0000000000b2';

function makeSwap(overrides: Partial<PlanItemSwapSummary> = {}): PlanItemSwapSummary {
  return {
    child_id: CHILD_A,
    day: 'monday',
    slot: 'main',
    previous_ingredients: ['rice', 'beans'],
    replaced_at: '2026-04-22T10:00:00.000Z',
    ...overrides,
  };
}

describe('SwapHistoryPopover (Story 3.15)', () => {
  it('renders a trigger labeled with the swap count (singular)', () => {
    render(<SwapHistoryPopover swaps={[makeSwap()]} />);
    const trigger = screen.getByRole('button', { name: 'View 1 swap for this day' });
    expect(trigger.textContent).toBe('1 swap');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders a trigger labeled with the swap count (plural)', () => {
    render(
      <SwapHistoryPopover
        swaps={[makeSwap(), makeSwap({ slot: 'extra', replaced_at: '2026-04-23T10:00:00.000Z' })]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'View 2 swaps for this day' });
    expect(trigger.textContent).toBe('2 swaps');
  });

  it('clicking the trigger opens the region with the swap list', () => {
    render(<SwapHistoryPopover swaps={[makeSwap({ slot: 'extra', previous_ingredients: ['hummus'] })]} />);
    const trigger = screen.getByRole('button');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const region = screen.getByRole('region');
    expect(region).toBeDefined();
    expect(screen.getByText('Swap history')).toBeDefined();
    expect(screen.getByText('extra')).toBeDefined();
    expect(screen.getByText('Was: hummus')).toBeDefined();
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

  it('renders "(none recorded)" when previous_ingredients is empty', () => {
    render(<SwapHistoryPopover swaps={[makeSwap({ previous_ingredients: [] })]} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Was: (none recorded)')).toBeDefined();
  });

  it('groups swaps by child_id with fallback labels when no childLabels prop is supplied', () => {
    render(
      <SwapHistoryPopover
        swaps={[
          makeSwap({ child_id: CHILD_A, slot: 'main' }),
          makeSwap({ child_id: CHILD_B, slot: 'extra', replaced_at: '2026-04-23T10:00:00.000Z' }),
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
          makeSwap({ child_id: CHILD_B, slot: 'extra', replaced_at: '2026-04-23T10:00:00.000Z' }),
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
        swaps={[makeSwap({ child_id: CHILD_A }), makeSwap({ child_id: CHILD_A, slot: 'extra', replaced_at: '2026-04-23T10:00:00.000Z' })]}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('Child A')).toBeNull();
  });
});

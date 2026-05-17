import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { PlanTileSummary } from '@hivekitchen/types';
import { PlanTile } from './PlanTile.js';

const CHILD_ID = '33333333-3333-4333-8333-333333333333';

function makeSummary(
  overrides: Partial<PlanTileSummary> = {},
): PlanTileSummary {
  return {
    day: 'monday',
    items: [
      {
        plan_item_id: null,
        child_id: CHILD_ID,
        slot: 'main',
        ingredients: ['rice', 'beans', 'cheese'],
      },
    ],
    paused: false,
    ...overrides,
  };
}

// Use a Monday at 08:00 local time as the default "today" baseline so
// variant=today and isMorning=true unless a test overrides the system time.
const MONDAY_MORNING = new Date(2026, 4, 4, 8, 0, 0); // Mon May 4 2026 08:00
const MONDAY_AFTERNOON = new Date(2026, 4, 4, 14, 0, 0);
const WEDNESDAY_NOON = new Date(2026, 4, 6, 12, 0, 0);
const SUNDAY_NOON = new Date(2026, 4, 3, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(MONDAY_MORNING);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('PlanTile structure', () => {
  it('renders an <article> with aria-label equal to the day name', () => {
    render(<PlanTile summary={makeSummary({ day: 'tuesday' })} />);
    const article = screen.getByLabelText('Tuesday');
    expect(article.tagName).toBe('ARTICLE');
  });

  it('renders the weekday name as an <h2>', () => {
    render(<PlanTile summary={makeSummary({ day: 'wednesday' })} />);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('Wednesday');
  });

  it('renders the dish line from joined unique ingredients', () => {
    render(
      <PlanTile
        summary={makeSummary({
          items: [
            { plan_item_id: null, child_id: CHILD_ID, slot: 'main', ingredients: ['rice', 'beans'] },
          ],
        })}
      />,
    );
    expect(screen.getByText('rice, beans')).toBeDefined();
  });

  it('shows "+N more" overflow when more than 3 unique ingredients', () => {
    render(
      <PlanTile
        summary={makeSummary({
          items: [
            {
              plan_item_id: null,
              child_id: CHILD_ID,
              slot: 'main',
              ingredients: ['rice', 'beans', 'cheese', 'salsa', 'lime'],
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('rice, beans, cheese +2 more')).toBeDefined();
  });

  it('renders "Plan pending" when items array is empty', () => {
    render(<PlanTile summary={makeSummary({ items: [] })} />);
    expect(screen.getByText('Plan pending')).toBeDefined();
  });

  it('deduplicates ingredients across items before slicing', () => {
    render(
      <PlanTile
        summary={makeSummary({
          items: [
            { plan_item_id: null, child_id: CHILD_ID, slot: 'main', ingredients: ['rice', 'beans'] },
            { plan_item_id: null, child_id: CHILD_ID, slot: 'extra', ingredients: ['rice', 'fruit'] },
          ],
        })}
      />,
    );
    // Set: ['rice', 'beans', 'fruit'] — 3 items, no overflow.
    expect(screen.getByText('rice, beans, fruit')).toBeDefined();
  });
});

describe('PlanTile variants', () => {
  it('today + morning: applies bg-amber-warm/10 tint', () => {
    vi.setSystemTime(MONDAY_MORNING);
    render(<PlanTile summary={makeSummary({ day: 'monday' })} />);
    const article = screen.getByLabelText('Monday');
    expect(article.className).toContain('bg-amber-warm/10');
  });

  it('today + afternoon: omits the morning tint', () => {
    vi.setSystemTime(MONDAY_AFTERNOON);
    render(<PlanTile summary={makeSummary({ day: 'monday' })} />);
    const article = screen.getByLabelText('Monday');
    expect(article.className).not.toContain('bg-amber-warm/10');
  });

  it('past variant: low-saturation classes and tabIndex=-1', () => {
    vi.setSystemTime(WEDNESDAY_NOON);
    render(<PlanTile summary={makeSummary({ day: 'monday' })} />);
    const article = screen.getByLabelText('Monday');
    expect(article.className).toContain('opacity-60');
    expect(article.className).toContain('pointer-events-none');
    expect(article.tabIndex).toBe(-1);
  });

  it('upcoming variant: tabIndex=0 and no past dimming', () => {
    vi.setSystemTime(MONDAY_MORNING);
    render(<PlanTile summary={makeSummary({ day: 'friday' })} />);
    const article = screen.getByLabelText('Friday');
    expect(article.tabIndex).toBe(0);
    expect(article.className).not.toContain('opacity-60');
  });

  it('on Sunday, all weekday tiles are upcoming (new week not started)', () => {
    vi.setSystemTime(SUNDAY_NOON);
    render(<PlanTile summary={makeSummary({ day: 'monday' })} />);
    const article = screen.getByLabelText('Monday');
    expect(article.tabIndex).toBe(0);
    expect(article.className).not.toContain('opacity-60');
  });
});

describe('PlanTile states', () => {
  it('pending-input: applies dashed honey-accent border', () => {
    render(
      <PlanTile summary={makeSummary({ day: 'monday' })} state="pending-input" />,
    );
    const article = screen.getByLabelText('Monday');
    expect(article.className).toContain('border-dashed');
    expect(article.className).toContain('border-amber-warm');
  });

  it('swap-in-progress: renders an aria-busy overlay', () => {
    render(
      <PlanTile
        summary={makeSummary({ day: 'monday' })}
        state="swap-in-progress"
      />,
    );
    expect(screen.getByLabelText('Swap in progress').getAttribute('aria-busy')).toBe(
      'true',
    );
  });

  it('locked: renders the PresenceIndicator with partner name', () => {
    render(
      <PlanTile
        summary={makeSummary({ day: 'monday' })}
        state="locked"
        partnerName="Priya"
      />,
    );
    expect(screen.getByText('Priya is editing')).toBeDefined();
  });

  it('mutability-frozen: renders an Editing locked button (collapsed by default)', () => {
    render(
      <PlanTile
        summary={makeSummary({ day: 'monday' })}
        state="mutability-frozen"
      />,
    );
    const button = screen.getByRole('button', { name: 'Editing locked' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    // Explanation copy is hidden until tap.
    expect(screen.queryByText(/Editing is locked every Sunday/)).toBeNull();
  });

  it('mutability-frozen: tap reveals the lockdown explanation copy', () => {
    render(
      <PlanTile
        summary={makeSummary({ day: 'monday' })}
        state="mutability-frozen"
      />,
    );
    const button = screen.getByRole('button', { name: 'Editing locked' });
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/Editing is locked every Sunday/)).toBeDefined();
  });
});

describe('PlanTile keyboard interaction', () => {
  it('Enter on a decided tile calls onSwapIntent', () => {
    const onSwapIntent = vi.fn();
    render(
      <PlanTile
        summary={makeSummary({ day: 'monday' })}
        onSwapIntent={onSwapIntent}
      />,
    );
    const article = screen.getByLabelText('Monday');
    fireEvent.keyDown(article, { key: 'Enter' });
    expect(onSwapIntent).toHaveBeenCalledTimes(1);
  });

  it('Space on a decided tile calls onSwapIntent', () => {
    const onSwapIntent = vi.fn();
    render(
      <PlanTile
        summary={makeSummary({ day: 'monday' })}
        onSwapIntent={onSwapIntent}
      />,
    );
    const article = screen.getByLabelText('Monday');
    fireEvent.keyDown(article, { key: ' ' });
    expect(onSwapIntent).toHaveBeenCalledTimes(1);
  });

  it('Enter on a past tile does NOT call onSwapIntent', () => {
    vi.setSystemTime(WEDNESDAY_NOON);
    const onSwapIntent = vi.fn();
    render(
      <PlanTile
        summary={makeSummary({ day: 'monday' })}
        onSwapIntent={onSwapIntent}
      />,
    );
    const article = screen.getByLabelText('Monday');
    fireEvent.keyDown(article, { key: 'Enter' });
    expect(onSwapIntent).not.toHaveBeenCalled();
  });

  it('Enter on a mutability-frozen tile does NOT call onSwapIntent', () => {
    const onSwapIntent = vi.fn();
    render(
      <PlanTile
        summary={makeSummary({ day: 'monday' })}
        state="mutability-frozen"
        onSwapIntent={onSwapIntent}
      />,
    );
    const article = screen.getByLabelText('Monday');
    fireEvent.keyDown(article, { key: 'Enter' });
    expect(onSwapIntent).not.toHaveBeenCalled();
  });

  it('Escape blurs the focused tile', () => {
    render(<PlanTile summary={makeSummary({ day: 'monday' })} />);
    const article = screen.getByLabelText('Monday') as HTMLElement;
    article.focus();
    expect(document.activeElement).toBe(article);
    fireEvent.keyDown(article, { key: 'Escape' });
    expect(document.activeElement).not.toBe(article);
  });
});

describe('PlanTile trust chips', () => {
  it('renders a TrustChip per entry in trustChips', () => {
    render(
      <PlanTile
        summary={makeSummary({ day: 'monday' })}
        trustChips={[
          { variant: 'allergy-cleared', label: 'Cleared for Maya' },
          { variant: 'cultural-template', label: 'Jollof Friday' },
        ]}
      />,
    );
    expect(screen.getByText('Cleared for Maya')).toBeDefined();
    expect(screen.getByText('Jollof Friday')).toBeDefined();
  });

  it('omits the trust-chip container when trustChips is undefined', () => {
    render(<PlanTile summary={makeSummary({ day: 'monday' })} />);
    expect(screen.queryByLabelText('Trust indicators')).toBeNull();
  });

  it('omits the trust-chip container when trustChips is empty', () => {
    render(
      <PlanTile summary={makeSummary({ day: 'monday' })} trustChips={[]} />,
    );
    expect(screen.queryByLabelText('Trust indicators')).toBeNull();
  });
});

describe('PlanTile — paused state (Story 3.12)', () => {
  it('renders the "Paused" copy with the day-paused aria label', () => {
    render(<PlanTile summary={makeSummary({ day: 'monday' })} state="paused" />);
    const label = screen.getByLabelText('Day paused — sick day');
    expect(label).toBeDefined();
    expect(label.textContent).toBe('Paused');
  });

  it('removes the paused tile from the tab order (tabIndex=-1)', () => {
    render(<PlanTile summary={makeSummary({ day: 'monday' })} state="paused" />);
    const article = screen.getByLabelText('Monday');
    expect(article.getAttribute('tabindex')).toBe('-1');
  });

  it('does not invoke onSwapIntent when paused tile receives click', () => {
    const onSwapIntent = vi.fn();
    render(
      <PlanTile
        summary={makeSummary({ day: 'monday' })}
        state="paused"
        onSwapIntent={onSwapIntent}
      />,
    );
    fireEvent.click(screen.getByLabelText('Monday'));
    expect(onSwapIntent).not.toHaveBeenCalled();
  });
});

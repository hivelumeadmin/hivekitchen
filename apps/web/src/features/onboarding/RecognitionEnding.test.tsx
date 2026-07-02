import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { KitchenMap } from '@hivekitchen/types';
import { RecognitionEnding } from './RecognitionEnding.js';

function makeMap(overrides: Partial<KitchenMap>): KitchenMap {
  const base = {
    household: {
      id: '00000000-0000-4000-8000-000000000001',
      tier: 'standard',
      timezone: 'UTC',
      display_name: null,
      cultural_identifiers: [],
      dietary_preferences: [],
      declared_allergens: [],
    },
    caregivers: [],
    children: [],
    cultural: { collective_identity: null, notes: [] },
    memory: { nodes: [] },
    allergens: [],
    dietary: [],
    food_preferences: [],
    favorite_lunches: [],
    rules: [],
    meta: { generated_at: '2026-07-01T00:00:00.000Z', version: 1 },
  };
  return { ...base, ...overrides } as unknown as KitchenMap;
}

describe('RecognitionEnding', () => {
  afterEach(cleanup);

  it('shows the "Show me my first week" CTA and plays back the prose when the required set is complete', () => {
    const onFinalize = vi.fn();
    const map = makeMap({
      children: [
        {
          id: 'c1',
          name: 'Layla',
          age_band: 'preteen',
          declared_allergens: [],
          cultural_identifiers: [],
          dietary_preferences: [],
          bag_composition_pattern: null,
          school_policies: [],
        },
      ] as never,
    });

    render(
      <RecognitionEnding
        kitchenMap={map}
        requiredSetComplete={true}
        missingRequiredSet={[]}
        finalizing={false}
        onFinalize={onFinalize}
        onJumpToMoment={vi.fn()}
      />,
    );

    expect(screen.getByText(/you're cooking for layla/i)).toBeDefined();
    fireEvent.click(screen.getByTestId('show-first-week-button'));
    expect(onFinalize).toHaveBeenCalledTimes(1);
  });

  it('renders no CTA and a jump-back affordance for each missing moment when incomplete', () => {
    const onJumpToMoment = vi.fn();
    render(
      <RecognitionEnding
        kitchenMap={makeMap({})}
        requiredSetComplete={false}
        missingRequiredSet={['m3_taste']}
        finalizing={false}
        onFinalize={vi.fn()}
        onJumpToMoment={onJumpToMoment}
      />,
    );

    expect(screen.queryByTestId('show-first-week-button')).toBeNull();
    fireEvent.click(screen.getByTestId('gap-jump-m3_taste'));
    expect(onJumpToMoment).toHaveBeenCalledWith('m3_taste');
  });

  it('shows neutral "Reply above" copy when requiredSetComplete is null and no missing moments', () => {
    render(
      <RecognitionEnding
        kitchenMap={makeMap({})}
        requiredSetComplete={null}
        missingRequiredSet={[]}
        finalizing={false}
        onFinalize={vi.fn()}
        onJumpToMoment={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('show-first-week-button')).toBeNull();
    expect(screen.queryByText(/one more thing/i)).toBeNull();
    expect(screen.getByText(/reply above to pick up/i)).toBeDefined();
  });

  it('pairs the honey glow with motion-reduce:animate-none (reduced-motion safe)', () => {
    render(
      <RecognitionEnding
        kitchenMap={makeMap({})}
        requiredSetComplete={true}
        missingRequiredSet={[]}
        finalizing={false}
        onFinalize={vi.fn()}
        onJumpToMoment={vi.fn()}
      />,
    );

    const surface = screen.getByTestId('recognition-ending');
    expect(surface.className).toContain('animate-[hk-glow');
    expect(surface.className).toContain('motion-reduce:animate-none');
  });
});

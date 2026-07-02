import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { KitchenMap } from '@hivekitchen/types';
import { KitchenMapHero } from './KitchenMapHero.js';

// Minimal authoritative-projection fixture. Only the fields the hero reads are
// populated; the rest of KitchenMapSchema is filled with empty defaults.
function makeMap(overrides: Partial<KitchenMap>): KitchenMap {
  const base = {
    household: {
      id: '00000000-0000-4000-8000-000000000001',
      tier: 'standard',
      tier_variant: 'a',
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
    household_extras: { pinned: [], banned: [] },
    recipes: { count: 0, cold_start_reason: null },
    allergens: [],
    dietary: [],
    food_preferences: [],
    favorite_lunches: [],
    rules: [],
    meta: { generated_at: '2026-07-01T00:00:00.000Z', version: 1 },
  };
  return { ...base, ...overrides } as unknown as KitchenMap;
}

describe('KitchenMapHero', () => {
  afterEach(cleanup);

  it('always shows the live "Building as we talk…" line and the deferred bag ghost', () => {
    render(
      <KitchenMapHero kitchenMap={null} momentKey={null} mapPending={false} householdDisplayName={null} />,
    );
    expect(screen.getByText(/building as we talk/i)).toBeDefined();
    expect(screen.getByText(/lumi learns these as you cook the first week/i)).toBeDefined();
  });

  it('renders the kitchen name from the projection display_name', () => {
    const map = makeMap({
      household: { ...makeMap({}).household, display_name: 'The Khan Family' },
    });
    render(
      <KitchenMapHero kitchenMap={map} momentKey="m1_table" mapPending={false} householdDisplayName={null} />,
    );
    expect(screen.getByText('The Khan Family')).toBeDefined();
  });

  it('lands a child card with an age-band label from the projection', () => {
    const map = makeMap({
      children: [
        {
          id: '00000000-0000-4000-8000-0000000000c1',
          name: 'Maya',
          age_band: 'child',
          declared_allergens: [],
          cultural_identifiers: [],
          dietary_preferences: [],
          bag_composition: {},
          bag_composition_pattern: null,
          school_policies: [],
          extra_rules: { pinned: [], banned: [] },
        },
      ] as unknown as KitchenMap['children'],
    });
    render(
      <KitchenMapHero kitchenMap={map} momentKey="m2_safe" mapPending={false} householdDisplayName={null} />,
    );
    expect(screen.getByText(/Maya · Child/)).toBeDefined();
  });

  it('renders per-child allergen safety pills once M2 is reached', () => {
    const map = makeMap({
      children: [
        {
          id: '00000000-0000-4000-8000-0000000000c1',
          name: 'Maya',
          age_band: 'child',
          declared_allergens: ['Peanut'],
          cultural_identifiers: [],
          dietary_preferences: [],
          bag_composition: {},
          bag_composition_pattern: null,
          school_policies: [],
          extra_rules: { pinned: [], banned: [] },
        },
      ] as unknown as KitchenMap['children'],
    });
    render(
      <KitchenMapHero kitchenMap={map} momentKey="m2_safe" mapPending={false} householdDisplayName={null} />,
    );
    expect(screen.getByTestId('m2-safety-card')).toBeDefined();
    expect(screen.getByText('Peanut')).toBeDefined();
  });

  it('shows "All clear" only after advancing past M2 with no allergens', () => {
    const map = makeMap({});
    const { rerender } = render(
      <KitchenMapHero kitchenMap={map} momentKey="m2_safe" mapPending={false} householdDisplayName={null} />,
    );
    // Still in M2 → placeholder, never a premature "All clear".
    expect(screen.queryByText(/all clear/i)).toBeNull();
    expect(screen.getByText(/noting what to keep safe/i)).toBeDefined();

    rerender(
      <KitchenMapHero kitchenMap={map} momentKey="m3_taste" mapPending={false} householdDisplayName={null} />,
    );
    expect(screen.getByText(/all clear — no known allergens/i)).toBeDefined();
  });

  it('does not render the safety card before M2 is reached', () => {
    render(
      <KitchenMapHero kitchenMap={makeMap({})} momentKey="m1_table" mapPending={false} householdDisplayName={null} />,
    );
    expect(screen.queryByTestId('m2-safety-card')).toBeNull();
  });

  it('never fabricates "All clear" when the projection is null (P2 safety)', () => {
    render(
      <KitchenMapHero kitchenMap={null} momentKey="m3_taste" mapPending={false} householdDisplayName="A Kitchen" />,
    );
    expect(screen.queryByText(/all clear/i)).toBeNull();
    expect(screen.getByText(/noting what to keep safe/i)).toBeDefined();
  });

  it('shows an allergen without a name rather than a raw UUID when the child is unresolved (P9)', () => {
    const map = makeMap({
      allergens: [
        { child_id: '00000000-0000-4000-8000-00000000dead', allergen: 'Sesame', source: 'onboarding_declared' },
      ] as unknown as KitchenMap['allergens'],
    });
    render(
      <KitchenMapHero kitchenMap={map} momentKey="m2_safe" mapPending={false} householdDisplayName={null} />,
    );
    expect(screen.getByText('Sesame')).toBeDefined();
    expect(screen.queryByText(/dead/)).toBeNull();
  });

  it('renders the M5 starting-line lunches from the projection (D1)', () => {
    const map = makeMap({
      favorite_lunches: [
        { item: 'Paratha roll', provenance: 'parent_added', position: 0 },
        { item: 'Dal & rice', provenance: 'parent_added', position: 1 },
      ] as unknown as KitchenMap['favorite_lunches'],
    });
    render(
      <KitchenMapHero kitchenMap={map} momentKey="m5_starting_line" mapPending={false} householdDisplayName={null} />,
    );
    expect(screen.getByTestId('starting-lineup-card')).toBeDefined();
    expect(screen.getByText('Paratha roll')).toBeDefined();
    expect(screen.getByText('Dal & rice')).toBeDefined();
  });
});

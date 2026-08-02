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

  it('always shows the live "Building as we talk…" line', () => {
    render(
      <KitchenMapHero kitchenMap={null} momentKey={null} mapPending={false} householdDisplayName={null} />,
    );
    expect(screen.getByText(/building as we talk/i)).toBeDefined();
  });

  // 14-s3b AC9 — the deferred-bag section is now progressively revealed rather
  // than always-on, matching the mockup. Both halves of that are asserted.
  it('reveals the deferred bag section only once M3 is reached', () => {
    const { rerender } = render(
      <KitchenMapHero kitchenMap={null} momentKey={null} mapPending={false} householdDisplayName={null} />,
    );
    expect(screen.queryByText(/lumi learns these as you cook the first week/i)).toBeNull();

    rerender(
      <KitchenMapHero kitchenMap={null} momentKey="m3_taste" mapPending={false} householdDisplayName={null} />,
    );
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
    // 14-s3b AC4 — the flat "Maya · Child" pill became an avatar row. Scoped to
    // the row so this still proves the three facts belong to the SAME child,
    // which is what the old single-string match guaranteed.
    const row = screen.getByText('Maya').closest('div');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('M');
    expect(row?.textContent).toContain('Maya');
    expect(row?.textContent).toContain('Child');
  });

  // Regression: charAt(0) returns a lone surrogate for non-BMP names and paints
  // U+FFFD. Iterating code points is the fix.
  it('renders a whole code point as the avatar initial for a non-BMP name', () => {
    const map = makeMap({
      children: [
        { id: '00000000-0000-4000-8000-0000000000c9', name: '𐐷ase', age_band: 'child',
          declared_allergens: [], cultural_identifiers: [], dietary_preferences: [],
          bag_composition: {}, bag_composition_pattern: null, school_policies: [],
          extra_rules: { pinned: [], banned: [] } },
      ] as unknown as KitchenMap['children'],
    });
    render(
      <KitchenMapHero kitchenMap={map} momentKey="m2_safe" mapPending={false} householdDisplayName={null} />,
    );
    expect(screen.queryByText('�')).toBeNull();
    expect(screen.getByText('𐐷'.toUpperCase())).toBeDefined();
  });

  // Regression (AC6): household tags and prefs keyed on different shapes meant a
  // household-scoped pref with matching text rendered a duplicate pill.
  it('does not duplicate a household tag that also exists as a household-scoped preference', () => {
    const base = makeMap({});
    const map = makeMap({
      household: { ...base.household, dietary_preferences: ['Halal'] },
      food_preferences: [
        { child_id: null, item: 'Halal', valence: 'likes' },
      ] as unknown as KitchenMap['food_preferences'],
    });
    render(
      <KitchenMapHero kitchenMap={map} momentKey="m3_taste" mapPending={false} householdDisplayName={null} />,
    );
    expect(screen.getAllByText('Halal')).toHaveLength(1);
  });

  // Regression (AC6): keying dedup on the child's NAME dropped a chip when two
  // children share one. children.name has no UNIQUE constraint.
  it('keeps both chips when two children share a name and the same preference', () => {
    const kids = ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2'];
    const map = makeMap({
      children: kids.map((id) => ({
        id, name: 'Alex', age_band: 'child', declared_allergens: [], cultural_identifiers: [],
        dietary_preferences: [], bag_composition: {}, bag_composition_pattern: null,
        school_policies: [], extra_rules: { pinned: [], banned: [] },
      })) as unknown as KitchenMap['children'],
      food_preferences: kids.map((id) => ({
        child_id: id, item: 'pasta', valence: 'loves',
      })) as unknown as KitchenMap['food_preferences'],
    });
    render(
      <KitchenMapHero kitchenMap={map} momentKey="m3_taste" mapPending={false} householdDisplayName={null} />,
    );
    expect(screen.getAllByText('Alex · pasta')).toHaveLength(2);
  });

  // Regression: an unrecognised moment_key made indexOf return -1, which failed
  // every gate and left the panel with no body.
  it('does not collapse every section when the server sends an unknown moment key', () => {
    const map = makeMap({});
    render(
      <KitchenMapHero kitchenMap={map} momentKey="m9_brand_new" mapPending={false} householdDisplayName={null} />,
    );
    expect(screen.getByTestId('m2-safety-card')).toBeDefined();
    expect(screen.getByText(/lumi learns these as you cook the first week/i)).toBeDefined();
  });

  it('glows the panel only once recognition is reached (AC7)', () => {
    const map = makeMap({});
    const { rerender } = render(
      <KitchenMapHero kitchenMap={map} momentKey="m3_taste" mapPending={false} householdDisplayName={null} />,
    );
    expect(screen.getByTestId('kitchen-map-panel').className).not.toContain('hk-map-glow');

    rerender(
      <KitchenMapHero kitchenMap={map} momentKey="summary" mapPending={false} householdDisplayName={null} />,
    );
    expect(screen.getByTestId('kitchen-map-panel').className).toContain('hk-map-glow');
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
    // 14-s3b AC5 — negated phrasing; the allergen keeps its vocabulary casing.
    expect(screen.getByText(/✓ No Peanut/)).toBeDefined();
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
    expect(screen.getByText(/✓ No Sesame/)).toBeDefined();
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

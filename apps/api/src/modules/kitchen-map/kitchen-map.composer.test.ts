import { describe, it, expect } from 'vitest';
import { composeKitchenMap } from './kitchen-map.composer.js';
import type { RawKitchenMapData } from './kitchen-map.repository.js';

const UUID = (n: number): string =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const NOW = '2026-05-14T10:00:00.000Z';

function makeRaw(overrides: Partial<RawKitchenMapData> = {}): RawKitchenMapData {
  return {
    household: {
      id: UUID(1),
      tier: 'standard',
      tier_variant: 'beta',
      timezone: 'America/New_York',
      kitchen_map_version: 7,
    },
    caregivers: [],
    children: [],
    cultural_priors: [],
    memory_nodes: [],
    school_policies: [],
    allergy_rules: [],
    extra_library: [],
    recipe_usage: [],
    ...overrides,
  };
}

describe('composeKitchenMap — household + meta', () => {
  it('passes through household fields verbatim', () => {
    const map = composeKitchenMap(makeRaw());
    expect(map.household).toEqual({
      id: UUID(1),
      tier: 'standard',
      tier_variant: 'beta',
      timezone: 'America/New_York',
    });
    expect(map.meta.map_version).toBe(7);
    expect(map.meta.schema_version).toBe('1.0.0');
  });

  it('is_complete=false when there are no children', () => {
    const map = composeKitchenMap(makeRaw());
    expect(map.meta.is_complete).toBe(false);
  });

  it('is_complete=true when at least one child is recorded', () => {
    const map = composeKitchenMap(
      makeRaw({
        children: [
          {
            id: UUID(10),
            name: 'Layla',
            age_band: 'child',
            declared_allergens: [],
            cultural_identifiers: [],
            dietary_preferences: [],
            bag_composition: { main: true, snack: true, extra: false },
            extra_rules: { pins: [], bans: [] },
          },
        ],
      }),
    );
    expect(map.meta.is_complete).toBe(true);
  });
});

describe('composeKitchenMap — caregivers', () => {
  it('passes primary_parent and secondary_caregiver through', () => {
    const map = composeKitchenMap(
      makeRaw({
        caregivers: [
          {
            user_id: UUID(2),
            role: 'primary_parent',
            display_name: 'Alex',
            cultural_language: null,
          },
          {
            user_id: UUID(3),
            role: 'secondary_caregiver',
            display_name: 'Sam',
            cultural_language: 'spanish',
          },
        ],
      }),
    );
    expect(map.caregivers).toHaveLength(2);
    expect(map.caregivers.map((c) => c.role)).toEqual([
      'primary_parent',
      'secondary_caregiver',
    ]);
  });

  it('filters out guest_author / ops roles', () => {
    const map = composeKitchenMap(
      makeRaw({
        caregivers: [
          { user_id: UUID(2), role: 'primary_parent', display_name: 'Alex', cultural_language: null },
          { user_id: UUID(3), role: 'guest_author', display_name: 'Guest', cultural_language: null },
          { user_id: UUID(4), role: 'ops', display_name: 'Ops', cultural_language: null },
        ],
      }),
    );
    expect(map.caregivers).toHaveLength(1);
    expect(map.caregivers[0]?.role).toBe('primary_parent');
  });

  it('falls back to "(unnamed caregiver)" when display_name is null', () => {
    const map = composeKitchenMap(
      makeRaw({
        caregivers: [
          {
            user_id: UUID(2),
            role: 'primary_parent',
            display_name: null,
            cultural_language: null,
          },
        ],
      }),
    );
    expect(map.caregivers[0]?.display_name).toBe('(unnamed caregiver)');
  });
});

describe('composeKitchenMap — children + school_policies', () => {
  it('groups school policies under their child', () => {
    const map = composeKitchenMap(
      makeRaw({
        children: [
          {
            id: UUID(10),
            name: 'Layla',
            age_band: 'child',
            declared_allergens: ['peanut'],
            cultural_identifiers: ['south_asian'],
            dietary_preferences: ['vegetarian'],
            bag_composition: { main: true, snack: true, extra: false },
            extra_rules: { pins: ['hummus'], bans: ['fruit_snack'] },
          },
        ],
        school_policies: [
          { child_id: UUID(10), policy_text: 'no_nuts' },
          { child_id: UUID(10), policy_text: 'school_provides_water' },
          { child_id: UUID(99), policy_text: 'should_not_appear_no_such_child' },
        ],
      }),
    );
    expect(map.children[0]?.school_policies).toEqual([
      'no_nuts',
      'school_provides_water',
    ]);
  });

  it('maps extra_rules pins/bans to pinned/banned', () => {
    const map = composeKitchenMap(
      makeRaw({
        children: [
          {
            id: UUID(10),
            name: 'L',
            age_band: 'child',
            declared_allergens: [],
            cultural_identifiers: [],
            dietary_preferences: [],
            bag_composition: { main: true, snack: false, extra: true },
            extra_rules: { pins: ['cheese_stick'], bans: ['gummy'] },
          },
        ],
      }),
    );
    expect(map.children[0]?.extra_rules).toEqual({
      pinned: ['cheese_stick'],
      banned: ['gummy'],
    });
  });

  it('always sets bag_composition.main = true (CHECK invariant)', () => {
    const map = composeKitchenMap(
      makeRaw({
        children: [
          {
            id: UUID(10),
            name: 'L',
            age_band: 'child',
            declared_allergens: [],
            cultural_identifiers: [],
            dietary_preferences: [],
            bag_composition: { main: false, snack: false, extra: false }, // shouldn't happen but defended
            extra_rules: { pins: [], bans: [] },
          },
        ],
      }),
    );
    expect(map.children[0]?.bag_composition.main).toBe(true);
  });
});

describe('composeKitchenMap — cultural priors bucketing', () => {
  function priorRow(state: string, key = 'south_asian') {
    return {
      key,
      label: 'South Asian',
      tier: 'L2' as const,
      state,
      confidence: 80,
      presence: 70,
    };
  }

  it("'active' goes to active", () => {
    const m = composeKitchenMap(makeRaw({ cultural_priors: [priorRow('active')] }));
    expect(m.cultural.active).toHaveLength(1);
    expect(m.cultural.suggested).toHaveLength(0);
  });

  it("'opt_in_confirmed' goes to active", () => {
    const m = composeKitchenMap(makeRaw({ cultural_priors: [priorRow('opt_in_confirmed')] }));
    expect(m.cultural.active).toHaveLength(1);
  });

  it("'detected' and 'suggested' go to suggested", () => {
    const m = composeKitchenMap(
      makeRaw({
        cultural_priors: [priorRow('detected', 'kosher'), priorRow('suggested', 'halal')],
      }),
    );
    expect(m.cultural.suggested).toHaveLength(2);
  });

  it("'dormant' and 'forgotten' are excluded entirely", () => {
    const m = composeKitchenMap(
      makeRaw({
        cultural_priors: [priorRow('dormant'), priorRow('forgotten', 'kosher')],
      }),
    );
    expect(m.cultural.active).toHaveLength(0);
    expect(m.cultural.suggested).toHaveLength(0);
  });

  it("rogue state coerces to 'suggested' and lands in nowhere bucket", () => {
    // unknown state → 'suggested' projected state, but ACTIVE_PRIOR_STATES /
    // SUGGESTED_PRIOR_STATES sets only match the literal DB state values,
    // so rogue states land in neither array. That's the safe default.
    const m = composeKitchenMap(makeRaw({ cultural_priors: [priorRow('unknown_state')] }));
    expect(m.cultural.active).toHaveLength(0);
    expect(m.cultural.suggested).toHaveLength(0);
  });
});

describe('composeKitchenMap — memory', () => {
  it('passes valid node types through', () => {
    const m = composeKitchenMap(
      makeRaw({
        memory_nodes: [
          {
            node_type: 'preference',
            facet: 'palate',
            prose_text: 'Loves yogurt and rice.',
            subject_child_id: UUID(10),
          },
          {
            node_type: 'rhythm',
            facet: 'family_rhythm',
            prose_text: 'Friday is leftover night.',
            subject_child_id: null,
          },
        ],
      }),
    );
    expect(m.memory.nodes).toHaveLength(2);
  });

  it('drops unknown node types', () => {
    const m = composeKitchenMap(
      makeRaw({
        memory_nodes: [
          {
            node_type: 'opinion',
            facet: 'x',
            prose_text: 'y',
            subject_child_id: null,
          },
        ],
      }),
    );
    expect(m.memory.nodes).toHaveLength(0);
  });
});

describe('composeKitchenMap — allergy rules', () => {
  it('splits FALCPA system rows from household-declared rows', () => {
    const m = composeKitchenMap(
      makeRaw({
        allergy_rules: [
          // System FALCPA reference row
          { household_id: null, child_id: null, allergen: 'peanut', rule_type: 'falcpa' },
          // Household-declared parent-class rule for a specific child
          { household_id: UUID(1), child_id: UUID(10), allergen: 'sesame', rule_type: 'parent_declared' },
          // Household-declared FALCPA-class scoped to the household
          { household_id: UUID(1), child_id: null, allergen: 'peanut', rule_type: 'falcpa' },
        ],
      }),
    );
    expect(m.allergy_rules.falcpa).toHaveLength(1);
    expect(m.allergy_rules.falcpa[0]).toEqual({
      allergen: 'peanut',
      rule_type: 'falcpa',
      scope_child_id: null,
    });
    expect(m.allergy_rules.household_declared).toHaveLength(2);
  });

  it('drops mixed-invalid combinations', () => {
    const m = composeKitchenMap(
      makeRaw({
        allergy_rules: [
          // household_id NULL but rule_type parent_declared — nonsensical, drop
          { household_id: null, child_id: null, allergen: 'mustard', rule_type: 'parent_declared' },
        ],
      }),
    );
    expect(m.allergy_rules.falcpa).toHaveLength(0);
    expect(m.allergy_rules.household_declared).toHaveLength(0);
  });
});

describe('composeKitchenMap — recipes bucketing', () => {
  function usageRow(opts: {
    confidence: number;
    favorite?: boolean;
    banned?: boolean;
    name?: string;
  }) {
    return {
      recipe_id: UUID(100 + opts.confidence),
      canonical_name: opts.name ?? 'Recipe',
      primary_ingredient_key: null,
      cuisine_tags: [],
      confidence_score: opts.confidence,
      is_household_favorite: opts.favorite ?? false,
      is_household_banned: opts.banned ?? false,
      use_count: 3,
      last_used_at: NOW,
    };
  }

  it('flagged favourites land in favourites regardless of confidence', () => {
    const m = composeKitchenMap(
      makeRaw({ recipe_usage: [usageRow({ confidence: 20, favorite: true })] }),
    );
    expect(m.recipes.favourites).toHaveLength(1);
  });

  it('high-confidence recipes (>=75) land in favourites', () => {
    const m = composeKitchenMap(
      makeRaw({ recipe_usage: [usageRow({ confidence: 80 })] }),
    );
    expect(m.recipes.favourites).toHaveLength(1);
  });

  it('low-confidence non-favourites are dropped', () => {
    const m = composeKitchenMap(
      makeRaw({ recipe_usage: [usageRow({ confidence: 40 })] }),
    );
    expect(m.recipes.favourites).toHaveLength(0);
  });

  it('banned recipes land in banned (and skip favourites)', () => {
    const m = composeKitchenMap(
      makeRaw({
        recipe_usage: [usageRow({ confidence: 95, favorite: true, banned: true })],
      }),
    );
    expect(m.recipes.banned).toHaveLength(1);
    expect(m.recipes.favourites).toHaveLength(0);
  });

  it('favourites sort by confidence descending', () => {
    const m = composeKitchenMap(
      makeRaw({
        recipe_usage: [
          usageRow({ confidence: 80, name: 'B' }),
          usageRow({ confidence: 95, name: 'A' }),
          usageRow({ confidence: 75, name: 'C' }),
        ],
      }),
    );
    expect(m.recipes.favourites.map((f) => f.canonical_name)).toEqual(['A', 'B', 'C']);
  });
});

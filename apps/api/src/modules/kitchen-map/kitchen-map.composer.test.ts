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
      // Slice 2.5-s1 — placeholder matches migration backfill format.
      display_name: 'Household 00000000',
      cultural_identifiers: [],
      dietary_preferences: [],
      declared_allergens: [],
    },
    caregivers: [],
    children: [],
    cultural_priors: [],
    memory_nodes: [],
    school_policies: [],
    extra_library: [],
    recipe_usage: [],
    // Slice 2.5-s1 — five new top-level arrays.
    allergens: [],
    dietary: [],
    food_preferences: [],
    rules: [],
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
      display_name: 'Household 00000000',
      cultural_identifiers: [],
      dietary_preferences: [],
      declared_allergens: [],
    });
    expect(map.meta.map_version).toBe(7);
    // Slice 2.5-s1 — schema bumped 1.0.0 → 1.1.0.
    expect(map.meta.schema_version).toBe('1.1.0');
  });

  it('projects display_name=null when household row has no name', () => {
    const map = composeKitchenMap(
      makeRaw({
        household: {
          ...makeRaw().household,
          display_name: null,
        },
      }),
    );
    expect(map.household.display_name).toBeNull();
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

  it('required_set_complete=false for every existing household (stub in s1)', () => {
    const map = composeKitchenMap(makeRaw());
    expect(map.meta.required_set_complete).toBe(false);
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
          {
            child_id: UUID(10),
            policy_type: 'nut_free',
            policy_description: null,
            slot_scope: 'bag_wide',
          },
          {
            child_id: UUID(10),
            policy_type: 'no_heating',
            policy_description: 'School provides water; no microwaves',
            slot_scope: 'main',
          },
          {
            child_id: UUID(99),
            policy_type: 'should_not_appear_no_such_child',
            policy_description: null,
            slot_scope: 'bag_wide',
          },
        ],
      }),
    );
    expect(map.children[0]?.school_policies).toEqual([
      'nut_free',
      'no_heating:main — School provides water; no microwaves',
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
  function priorRow(state: string, key = 'south_asian', enforcement = 'just_for_context') {
    return {
      key,
      label: 'South Asian',
      tier: 'L2' as const,
      state,
      confidence: 80,
      presence: 70,
      enforcement,
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

  it('passes enforcement through verbatim when valid', () => {
    const m = composeKitchenMap(
      makeRaw({ cultural_priors: [priorRow('active', 'halal', 'non_negotiable')] }),
    );
    expect(m.cultural.active[0]?.enforcement).toBe('non_negotiable');
  });

  it("falls back to 'just_for_context' for rogue enforcement value", () => {
    const m = composeKitchenMap(
      makeRaw({ cultural_priors: [priorRow('active', 'halal', 'gospel_truth')] }),
    );
    expect(m.cultural.active[0]?.enforcement).toBe('just_for_context');
  });
});

// Slice 2.5-s1 — bag_composition_pattern is derived from the booleans.
describe('composeKitchenMap — bag_composition_pattern derivation', () => {
  function childRow(snack: boolean, extra: boolean) {
    return {
      id: UUID(10),
      name: 'Layla',
      age_band: 'child' as const,
      declared_allergens: [],
      cultural_identifiers: [],
      dietary_preferences: [],
      bag_composition: { main: true, snack, extra },
      extra_rules: { pins: [], bans: [] },
    };
  }

  it("snack=false, extra=false → 'main_only'", () => {
    const m = composeKitchenMap(makeRaw({ children: [childRow(false, false)] }));
    expect(m.children[0]?.bag_composition_pattern).toBe('main_only');
  });

  it("snack=true, extra=false → 'main_plus_snack'", () => {
    const m = composeKitchenMap(makeRaw({ children: [childRow(true, false)] }));
    expect(m.children[0]?.bag_composition_pattern).toBe('main_plus_snack');
  });

  it("snack=false, extra=true → 'main_plus_extra'", () => {
    const m = composeKitchenMap(makeRaw({ children: [childRow(false, true)] }));
    expect(m.children[0]?.bag_composition_pattern).toBe('main_plus_extra');
  });

  it("snack=true, extra=true → 'main_plus_snack_plus_extra'", () => {
    const m = composeKitchenMap(makeRaw({ children: [childRow(true, true)] }));
    expect(m.children[0]?.bag_composition_pattern).toBe('main_plus_snack_plus_extra');
  });
});

// Slice 2.5-s1 — five new top-level arrays. Each empty by default;
// projection passes through raw rows verbatim with defensive enforcement
// coercion for rogue values.
describe('composeKitchenMap — Epic 2.5 structured signal arrays', () => {
  it('emits empty arrays for an existing household (no rows in new tables)', () => {
    const m = composeKitchenMap(makeRaw());
    expect(m.allergens).toEqual([]);
    expect(m.dietary).toEqual([]);
    expect(m.food_preferences).toEqual([]);
    expect(m.favorite_lunches).toEqual([]);
    expect(m.rules).toEqual([]);
  });

  it('projects allergen rows verbatim', () => {
    const m = composeKitchenMap(
      makeRaw({
        allergens: [
          { child_id: UUID(10), allergen: 'peanut', source: 'onboarding_declared' },
        ],
      }),
    );
    expect(m.allergens).toEqual([
      { child_id: UUID(10), allergen: 'peanut', source: 'onboarding_declared' },
    ]);
  });

  it('projects dietary rows verbatim with valid enforcement', () => {
    const m = composeKitchenMap(
      makeRaw({
        dietary: [
          {
            child_id: null,
            tag: 'halal',
            enforcement: 'non_negotiable',
            source: 'onboarding_declared',
          },
        ],
      }),
    );
    expect(m.dietary[0]?.enforcement).toBe('non_negotiable');
  });

  it("falls back to 'just_for_context' for rogue dietary enforcement", () => {
    const m = composeKitchenMap(
      makeRaw({
        dietary: [
          {
            child_id: null,
            tag: 'halal',
            enforcement: 'gospel_truth',
            source: 'onboarding_declared',
          },
        ],
      }),
    );
    expect(m.dietary[0]?.enforcement).toBe('just_for_context');
  });

  it("falls back to 'soft' for rogue food_preference enforcement", () => {
    const m = composeKitchenMap(
      makeRaw({
        food_preferences: [
          {
            child_id: null,
            item: 'cilantro',
            valence: 'refuses',
            enforcement: 'beyond_law',
            source: 'onboarding_declared',
          },
        ],
      }),
    );
    expect(m.food_preferences[0]?.enforcement).toBe('soft');
  });

  it('projects favorite_lunches derived from recipe_usage (slice 2.6-s1)', () => {
    const m = composeKitchenMap(
      makeRaw({
        recipe_usage: [
          {
            recipe_id: UUID(20),
            canonical_name: 'dal chawal',
            primary_ingredient_key: null,
            cuisine_tags: [],
            confidence_score: 80,
            is_household_favorite: true,
            is_household_banned: false,
            catalog_provenance: 'declared',
            use_count: 0,
            last_used_at: NOW,
          },
        ],
      }),
    );
    expect(m.favorite_lunches).toHaveLength(1);
    expect(m.favorite_lunches[0]?.item).toBe('dal chawal');
    expect(m.favorite_lunches[0]?.provenance).toBe('declared');
    expect(m.favorite_lunches[0]?.position).toBe(0);
  });

  it('projects household_rule rows verbatim with null custom_label for non-custom', () => {
    const m = composeKitchenMap(
      makeRaw({
        rules: [
          {
            rule_type: 'no_pork',
            custom_label: null,
            enforcement: 'non_negotiable',
            source: 'onboarding_declared',
          },
        ],
      }),
    );
    expect(m.rules[0]?.custom_label).toBeNull();
    expect(m.rules[0]?.enforcement).toBe('non_negotiable');
  });
});

describe('composeKitchenMap — memory', () => {
  it('passes valid (narrowed) node types through', () => {
    const m = composeKitchenMap(
      makeRaw({
        memory_nodes: [
          {
            node_type: 'rhythm',
            facet: 'family_rhythm',
            prose_text: 'Friday is leftover night.',
            subject_child_id: null,
          },
          {
            node_type: 'child_obsession',
            facet: 'fixation',
            prose_text: 'Layla only wants pasta this month.',
            subject_child_id: UUID(10),
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

  // Slice 2.5-s2 — node_types narrowed; rogue rows of removed types
  // (e.g. lingering 'preference' if a soft-forgotten row somehow gets
  // returned by a misbehaving repository) are silently excluded by the
  // VALID_MEMORY_NODE_TYPES filter.
  it("excludes node_type='preference' from the projection", () => {
    const m = composeKitchenMap(
      makeRaw({
        memory_nodes: [
          {
            node_type: 'preference',
            facet: 'palate',
            prose_text: 'Loves yogurt.',
            subject_child_id: null,
          },
        ],
      }),
    );
    expect(m.memory.nodes).toHaveLength(0);
  });
});

describe('composeKitchenMap — recipes bucketing', () => {
  function usageRow(opts: {
    confidence: number;
    favorite?: boolean;
    banned?: boolean;
    name?: string;
    provenance?: 'declared' | 'inferred' | 'parent_added' | 'plan_promoted';
  }) {
    return {
      recipe_id: UUID(100 + opts.confidence),
      canonical_name: opts.name ?? 'Recipe',
      primary_ingredient_key: null,
      cuisine_tags: [],
      confidence_score: opts.confidence,
      is_household_favorite: opts.favorite ?? false,
      is_household_banned: opts.banned ?? false,
      // Slice 2.6-s1 — defaults to 'plan_promoted' (the column's backfill
      // default), matching the existing-row semantics in production.
      catalog_provenance: opts.provenance ?? 'plan_promoted',
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

  it('surfaces catalog_provenance on each favourites entry (slice 2.6-s1)', () => {
    const m = composeKitchenMap(
      makeRaw({
        recipe_usage: [
          usageRow({ confidence: 80, favorite: true, name: 'Dal', provenance: 'declared' }),
        ],
      }),
    );
    expect(m.recipes.favourites[0]?.catalog_provenance).toBe('declared');
  });

  it('coerces rogue catalog_provenance to plan_promoted (defensive read)', () => {
    const m = composeKitchenMap(
      makeRaw({
        recipe_usage: [
          {
            ...usageRow({ confidence: 80, favorite: true, name: 'Dal' }),
            catalog_provenance: 'totally_bogus_value',
          },
        ],
      }),
    );
    expect(m.recipes.favourites[0]?.catalog_provenance).toBe('plan_promoted');
  });
});

// Slice 2.6-s1 — favorite_lunches projection is now derived from
// household_recipe_usage rows (was a standalone table query).
describe('composeKitchenMap — favorite_lunches derivation from usage', () => {
  function lunchRow(opts: {
    name: string;
    provenance: 'declared' | 'inferred' | 'parent_added' | 'plan_promoted';
    favorite?: boolean;
    banned?: boolean;
    lastUsedAt?: string;
  }) {
    return {
      recipe_id: UUID(100 + opts.name.length),
      canonical_name: opts.name,
      primary_ingredient_key: null,
      cuisine_tags: [],
      confidence_score: 50,
      is_household_favorite: opts.favorite ?? false,
      is_household_banned: opts.banned ?? false,
      catalog_provenance: opts.provenance,
      use_count: 0,
      last_used_at: opts.lastUsedAt ?? NOW,
    };
  }

  it("includes 'declared' rows (cold-start seed from Moment 5)", () => {
    const m = composeKitchenMap(
      makeRaw({
        recipe_usage: [lunchRow({ name: 'dal chawal', provenance: 'declared' })],
      }),
    );
    expect(m.favorite_lunches.map((l) => l.item)).toEqual(['dal chawal']);
  });

  it("includes 'parent_added' rows (post-onboarding additions)", () => {
    const m = composeKitchenMap(
      makeRaw({
        recipe_usage: [lunchRow({ name: 'wrap', provenance: 'parent_added' })],
      }),
    );
    expect(m.favorite_lunches).toHaveLength(1);
  });

  it("includes is_household_favorite rows regardless of provenance", () => {
    const m = composeKitchenMap(
      makeRaw({
        recipe_usage: [
          lunchRow({ name: 'pasta', provenance: 'plan_promoted', favorite: true }),
        ],
      }),
    );
    expect(m.favorite_lunches.map((l) => l.item)).toEqual(['pasta']);
  });

  it("excludes 'inferred' / 'plan_promoted' rows that aren't favorited", () => {
    const m = composeKitchenMap(
      makeRaw({
        recipe_usage: [
          lunchRow({ name: 'inferred-only', provenance: 'inferred' }),
          lunchRow({ name: 'plan-only', provenance: 'plan_promoted' }),
        ],
      }),
    );
    expect(m.favorite_lunches).toEqual([]);
  });

  it('excludes banned rows even when favorited', () => {
    const m = composeKitchenMap(
      makeRaw({
        recipe_usage: [
          lunchRow({
            name: 'avoid',
            provenance: 'declared',
            favorite: true,
            banned: true,
          }),
        ],
      }),
    );
    expect(m.favorite_lunches).toEqual([]);
  });

  it('orders favorited first, then by last_used_at DESC; emits 0-based positions', () => {
    const m = composeKitchenMap(
      makeRaw({
        recipe_usage: [
          lunchRow({
            name: 'older-fav',
            provenance: 'plan_promoted',
            favorite: true,
            lastUsedAt: '2026-01-01T00:00:00.000Z',
          }),
          lunchRow({
            name: 'newer-fav',
            provenance: 'plan_promoted',
            favorite: true,
            lastUsedAt: '2026-05-01T00:00:00.000Z',
          }),
          lunchRow({
            name: 'non-fav-declared',
            provenance: 'declared',
            lastUsedAt: '2026-04-01T00:00:00.000Z',
          }),
        ],
      }),
    );
    expect(m.favorite_lunches.map((l) => l.item)).toEqual([
      'newer-fav',
      'older-fav',
      'non-fav-declared',
    ]);
    expect(m.favorite_lunches.map((l) => l.position)).toEqual([0, 1, 2]);
  });
});

import { describe, it, expect } from 'vitest';
import {
  KitchenMapAllergenSchema,
  KitchenMapCulturalPriorSchema,
  KitchenMapDietarySchema,
  KitchenMapFavoriteLunchSchema,
  KitchenMapFoodPreferenceSchema,
  KitchenMapMemoryNodeSchema,
  KitchenMapRuleSchema,
  KitchenMapSchema,
} from './kitchen-map.js';

const UUID = (n: number): string => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const NOW = '2026-05-14T10:00:00.000Z';

function makeMinimalMap() {
  return {
    household: {
      id: UUID(1),
      tier: 'standard',
      tier_variant: 'beta',
      timezone: 'America/New_York',
      display_name: 'The Menons',
      cultural_identifiers: [],
      dietary_preferences: [],
      declared_allergens: [],
    },
    caregivers: [
      {
        user_id: UUID(2),
        role: 'primary_parent' as const,
        display_name: 'Alex',
        cultural_language: null,
      },
    ],
    children: [],
    cultural: { active: [], suggested: [] },
    memory: { nodes: [] },
    household_extras: { library: [] },
    recipes: { favourites: [], banned: [] },
    allergens: [],
    dietary: [],
    food_preferences: [],
    favorite_lunches: [],
    rules: [],
    meta: {
      composed_at: NOW,
      map_version: 1,
      schema_version: '1.1.0' as const,
      is_complete: false,
      required_set_complete: false,
    },
  };
}

describe('KitchenMapSchema', () => {
  it('round-trips an empty (just-onboarding) household', () => {
    const r = KitchenMapSchema.safeParse(makeMinimalMap());
    expect(r.success).toBe(true);
  });

  it('accepts null display_name (mid-onboarding household)', () => {
    const base = makeMinimalMap();
    const m: Record<string, unknown> = {
      ...base,
      household: { ...base.household, display_name: null },
    };
    const r = KitchenMapSchema.safeParse(m);
    expect(r.success).toBe(true);
  });

  it('round-trips a fully-populated household with Epic 2.5 arrays', () => {
    const base = makeMinimalMap();
    const m: Record<string, unknown> = {
      ...base,
      children: [
        {
          id: UUID(10),
          name: 'Layla',
          age_band: 'child',
          declared_allergens: ['peanut'],
          cultural_identifiers: ['south_asian'],
          dietary_preferences: ['vegetarian'],
          bag_composition: { main: true, snack: true, extra: false },
          bag_composition_pattern: 'main_plus_snack',
          school_policies: ['no_nuts'],
          extra_rules: { pinned: [], banned: ['fruit_snacks'] },
        },
      ],
      cultural: {
        active: [
          {
            key: 'south_asian',
            label: 'South Asian',
            state: 'active',
            tier: 'L2',
            confidence: 85,
            presence: 70,
            enforcement: 'strong',
          },
        ],
        suggested: [],
      },
      memory: {
        nodes: [
          {
            node_type: 'rhythm',
            facet: 'family_rhythm',
            prose_text: 'Friday is leftover night.',
            subject_child_id: UUID(10),
          },
        ],
      },
      recipes: {
        favourites: [
          {
            recipe_id: UUID(20),
            canonical_name: 'Yogurt rice bowl',
            primary_ingredient_key: 'rice',
            cuisine_tags: ['south_indian'],
            confidence_score: 88,
            is_household_favorite: true,
            use_count: 6,
            last_used_at: NOW,
          },
        ],
        banned: [],
      },
      allergens: [
        {
          child_id: UUID(10),
          allergen: 'peanut',
          source: 'onboarding_declared',
        },
      ],
      dietary: [
        {
          child_id: null,
          tag: 'halal',
          enforcement: 'non_negotiable',
          source: 'onboarding_declared',
        },
      ],
      food_preferences: [
        {
          child_id: UUID(10),
          item: 'cilantro',
          valence: 'refuses',
          enforcement: 'soft',
          source: 'onboarding_declared',
        },
      ],
      favorite_lunches: [
        {
          item: 'dal chawal',
          provenance: 'onboarding_seed',
          position: 0,
        },
      ],
      rules: [
        {
          rule_type: 'no_pork',
          custom_label: null,
          enforcement: 'non_negotiable',
          source: 'onboarding_declared',
        },
      ],
      meta: {
        ...(base.meta as Record<string, unknown>),
        required_set_complete: true,
      },
    };
    const r = KitchenMapSchema.safeParse(m);
    expect(r.success).toBe(true);
  });

  it('rejects unknown schema_version (1.0.0 no longer valid)', () => {
    const base = makeMinimalMap();
    const m: Record<string, unknown> = {
      ...base,
      meta: { ...base.meta, schema_version: '1.0.0' },
    };
    expect(KitchenMapSchema.safeParse(m).success).toBe(false);
  });

  it('rejects negative map_version', () => {
    const base = makeMinimalMap();
    const m: Record<string, unknown> = {
      ...base,
      meta: { ...base.meta, map_version: -1 },
    };
    expect(KitchenMapSchema.safeParse(m).success).toBe(false);
  });

  it('requires required_set_complete in meta', () => {
    const base = makeMinimalMap();
    const meta = { ...base.meta } as Record<string, unknown>;
    delete meta.required_set_complete;
    const m: Record<string, unknown> = { ...base, meta };
    expect(KitchenMapSchema.safeParse(m).success).toBe(false);
  });
});

describe('KitchenMapCulturalPriorSchema', () => {
  it('rejects state outside the mirror of cultural_priors.state enum', () => {
    const r = KitchenMapCulturalPriorSchema.safeParse({
      key: 'halal',
      label: 'Halal',
      state: 'ratified',
      tier: 'L2',
      confidence: 80,
      presence: 70,
      enforcement: 'just_for_context',
    });
    expect(r.success).toBe(false);
  });

  it('requires enforcement', () => {
    const r = KitchenMapCulturalPriorSchema.safeParse({
      key: 'halal',
      label: 'Halal',
      state: 'active',
      tier: 'L2',
      confidence: 80,
      presence: 70,
    });
    expect(r.success).toBe(false);
  });
});

describe('KitchenMapMemoryNodeSchema', () => {
  it('accepts a household-scoped memory (null subject_child_id)', () => {
    const r = KitchenMapMemoryNodeSchema.safeParse({
      node_type: 'rhythm',
      facet: 'family_rhythm',
      prose_text: 'Friday is leftover night.',
      subject_child_id: null,
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown node_type', () => {
    const r = KitchenMapMemoryNodeSchema.safeParse({
      node_type: 'opinion',
      facet: 'x',
      prose_text: 'y',
      subject_child_id: null,
    });
    expect(r.success).toBe(false);
  });

  it('rejects the four node_types removed in slice 2.5-s2', () => {
    for (const node_type of [
      'preference',
      'cultural_rhythm',
      'allergy',
      'school_policy',
    ] as const) {
      const r = KitchenMapMemoryNodeSchema.safeParse({
        node_type,
        facet: 'x',
        prose_text: 'y',
        subject_child_id: null,
      });
      expect(r.success).toBe(false);
    }
  });

  it('accepts every value in the narrowed enum', () => {
    for (const node_type of ['rhythm', 'child_obsession', 'other'] as const) {
      const r = KitchenMapMemoryNodeSchema.safeParse({
        node_type,
        facet: 'x',
        prose_text: 'y',
        subject_child_id: null,
      });
      expect(r.success).toBe(true);
    }
  });
});

describe('KitchenMapAllergenSchema', () => {
  it('rejects source value not in the allowed enum', () => {
    const r = KitchenMapAllergenSchema.safeParse({
      child_id: UUID(10),
      allergen: 'peanut',
      source: 'manual',
    });
    expect(r.success).toBe(false);
  });
});

describe('KitchenMapDietarySchema', () => {
  it('accepts null child_id (household-scoped)', () => {
    const r = KitchenMapDietarySchema.safeParse({
      child_id: null,
      tag: 'halal',
      enforcement: 'non_negotiable',
      source: 'onboarding_declared',
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown enforcement', () => {
    const r = KitchenMapDietarySchema.safeParse({
      child_id: null,
      tag: 'halal',
      enforcement: 'mandatory',
      source: 'onboarding_declared',
    });
    expect(r.success).toBe(false);
  });
});

describe('KitchenMapFoodPreferenceSchema', () => {
  it('rejects unknown valence', () => {
    const r = KitchenMapFoodPreferenceSchema.safeParse({
      child_id: null,
      item: 'cilantro',
      valence: 'hates',
      enforcement: 'soft',
      source: 'onboarding_declared',
    });
    expect(r.success).toBe(false);
  });
});

describe('KitchenMapFavoriteLunchSchema', () => {
  it('rejects negative position', () => {
    const r = KitchenMapFavoriteLunchSchema.safeParse({
      item: 'dal chawal',
      provenance: 'onboarding_seed',
      position: -1,
    });
    expect(r.success).toBe(false);
  });
});

describe('KitchenMapRuleSchema', () => {
  it('accepts non-custom rule with null custom_label', () => {
    const r = KitchenMapRuleSchema.safeParse({
      rule_type: 'no_pork',
      custom_label: null,
      enforcement: 'non_negotiable',
      source: 'onboarding_declared',
    });
    expect(r.success).toBe(true);
  });

  it('accepts custom rule with custom_label', () => {
    const r = KitchenMapRuleSchema.safeParse({
      rule_type: 'custom',
      custom_label: 'no peanut butter on Fridays',
      enforcement: 'strong',
      source: 'onboarding_declared',
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown rule_type', () => {
    const r = KitchenMapRuleSchema.safeParse({
      rule_type: 'no_dairy',
      custom_label: null,
      enforcement: 'strong',
      source: 'onboarding_declared',
    });
    expect(r.success).toBe(false);
  });
});

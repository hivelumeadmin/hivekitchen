import { describe, it, expect } from 'vitest';
import {
  KitchenMapSchema,
  KitchenMapCulturalPriorSchema,
  KitchenMapMemoryNodeSchema,
  KitchenMapAllergyRuleSchema,
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
    allergy_rules: { falcpa: [], household_declared: [] },
    household_extras: { library: [] },
    recipes: { favourites: [], banned: [] },
    meta: {
      composed_at: NOW,
      map_version: 1,
      schema_version: '1.0.0' as const,
      is_complete: false,
    },
  };
}

describe('KitchenMapSchema', () => {
  it('round-trips an empty (just-onboarding) household', () => {
    const r = KitchenMapSchema.safeParse(makeMinimalMap());
    expect(r.success).toBe(true);
  });

  it('round-trips a fully-populated household', () => {
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
          },
        ],
        suggested: [],
      },
      memory: {
        nodes: [
          {
            node_type: 'preference',
            facet: 'palate',
            prose_text: 'Loves yogurt and rice.',
            subject_child_id: UUID(10),
          },
        ],
      },
      allergy_rules: {
        falcpa: [],
        household_declared: [
          { allergen: 'peanut', rule_type: 'falcpa', scope_child_id: UUID(10) },
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
    };
    const r = KitchenMapSchema.safeParse(m);
    expect(r.success).toBe(true);
  });

  it('rejects unknown schema_version', () => {
    const base = makeMinimalMap();
    const m: Record<string, unknown> = {
      ...base,
      meta: { ...base.meta, schema_version: '2.0.0' },
    };
    const r = KitchenMapSchema.safeParse(m);
    expect(r.success).toBe(false);
  });

  it('rejects negative map_version', () => {
    const base = makeMinimalMap();
    const m: Record<string, unknown> = {
      ...base,
      meta: { ...base.meta, map_version: -1 },
    };
    const r = KitchenMapSchema.safeParse(m);
    expect(r.success).toBe(false);
  });
});

describe('KitchenMapCulturalPriorSchema', () => {
  it('rejects state outside the mirror of cultural_priors.state enum', () => {
    const r = KitchenMapCulturalPriorSchema.safeParse({
      key: 'halal',
      label: 'Halal',
      state: 'ratified', // not a real state
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
});

describe('KitchenMapAllergyRuleSchema', () => {
  it('accepts a FALCPA-class rule with both scopes null (system reference row)', () => {
    const r = KitchenMapAllergyRuleSchema.safeParse({
      allergen: 'peanut',
      rule_type: 'falcpa',
      scope_child_id: null,
    });
    expect(r.success).toBe(true);
  });
});

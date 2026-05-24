import { describe, it, expect } from 'vitest';
import {
  AllergenDeclareInputSchema,
  ChildUpsertInputSchema,
  CuisineDeclareInputSchema,
  CulturalNoteInputSchema,
  DietaryDeclareInputSchema,
  FavoriteLunchAddInputSchema,
  FoodPreferenceDeclareInputSchema,
  HouseholdSetNameInputSchema,
  MemoryNoteFromOnboardingInputSchema,
  RuleSetInputSchema,
} from './onboarding-tools.js';

const CHILD_ID = '33333333-3333-4333-8333-333333333333';

describe('ChildUpsertInputSchema', () => {
  it('accepts bag_composition_pattern', () => {
    const r = ChildUpsertInputSchema.safeParse({
      name: 'Layla',
      age_band: 'child',
      bag_composition_pattern: 'main_plus_snack',
    });
    expect(r.success).toBe(true);
  });

  it('still accepts input without bag_composition_pattern (backwards compat)', () => {
    const r = ChildUpsertInputSchema.safeParse({
      name: 'Layla',
      age_band: 'child',
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown bag_composition_pattern', () => {
    const r = ChildUpsertInputSchema.safeParse({
      name: 'Layla',
      age_band: 'child',
      bag_composition_pattern: 'main_only_plus_drink',
    });
    expect(r.success).toBe(false);
  });
});

describe('CulturalNoteInputSchema', () => {
  it("defaults enforcement to 'just_for_context' when omitted", () => {
    const r = CulturalNoteInputSchema.parse({
      key: 'halal',
      label: 'Halal',
      confidence: 80,
      presence: 70,
    });
    expect(r.enforcement).toBe('just_for_context');
  });

  it('accepts explicit enforcement', () => {
    const r = CulturalNoteInputSchema.parse({
      key: 'halal',
      label: 'Halal',
      confidence: 80,
      presence: 70,
      enforcement: 'non_negotiable',
    });
    expect(r.enforcement).toBe('non_negotiable');
  });
});

describe('MemoryNoteFromOnboardingInputSchema', () => {
  it('accepts the narrowed enum (rhythm, child_obsession, other)', () => {
    for (const node_type of ['rhythm', 'child_obsession', 'other'] as const) {
      const r = MemoryNoteFromOnboardingInputSchema.safeParse({
        node_type,
        facet: 'palate',
        prose_text: 'Loves yogurt and rice.',
      });
      expect(r.success).toBe(true);
    }
  });

  it('rejects the four node_types removed in slice 2.5-s2', () => {
    for (const node_type of [
      'preference',
      'cultural_rhythm',
      'allergy',
      'school_policy',
    ] as const) {
      const r = MemoryNoteFromOnboardingInputSchema.safeParse({
        node_type,
        facet: 'palate',
        prose_text: 'Loves yogurt and rice.',
      });
      expect(r.success).toBe(false);
    }
  });
});

describe('HouseholdSetNameInputSchema', () => {
  it('happy path', () => {
    const r = HouseholdSetNameInputSchema.safeParse({ display_name: 'The Menons' });
    expect(r.success).toBe(true);
  });

  it('rejects empty string', () => {
    const r = HouseholdSetNameInputSchema.safeParse({ display_name: '' });
    expect(r.success).toBe(false);
  });

  it('rejects display_name longer than 120 chars', () => {
    const r = HouseholdSetNameInputSchema.safeParse({ display_name: 'x'.repeat(121) });
    expect(r.success).toBe(false);
  });
});

describe('AllergenDeclareInputSchema', () => {
  it('happy path: child_id + allergen', () => {
    const r = AllergenDeclareInputSchema.safeParse({
      child_id: CHILD_ID,
      allergen: 'peanut',
    });
    expect(r.success).toBe(true);
  });

  it('accepts child_name instead of child_id', () => {
    const r = AllergenDeclareInputSchema.safeParse({
      child_name: 'Layla',
      allergen: 'peanut',
    });
    expect(r.success).toBe(true);
  });

  it('rejects when both child_id and child_name are absent', () => {
    const r = AllergenDeclareInputSchema.safeParse({ allergen: 'peanut' });
    expect(r.success).toBe(false);
  });

  it('rejects when both child_id and child_name are provided', () => {
    const r = AllergenDeclareInputSchema.safeParse({
      child_id: CHILD_ID,
      child_name: 'Layla',
      allergen: 'peanut',
    });
    expect(r.success).toBe(false);
  });

  it("defaults source to 'onboarding_declared'", () => {
    const r = AllergenDeclareInputSchema.parse({
      child_id: CHILD_ID,
      allergen: 'peanut',
    });
    expect(r.source).toBe('onboarding_declared');
  });
});

describe('DietaryDeclareInputSchema', () => {
  it('accepts household-scoped (null child_id)', () => {
    const r = DietaryDeclareInputSchema.safeParse({
      child_id: null,
      tag: 'halal',
      enforcement: 'non_negotiable',
    });
    expect(r.success).toBe(true);
  });

  it('rejects when enforcement is missing', () => {
    const r = DietaryDeclareInputSchema.safeParse({
      tag: 'halal',
    });
    expect(r.success).toBe(false);
  });
});

describe('CuisineDeclareInputSchema', () => {
  it("defaults enforcement to 'just_for_context'", () => {
    const r = CuisineDeclareInputSchema.parse({
      key: 'south_indian',
      label: 'South Indian',
      confidence: 80,
      presence: 70,
    });
    expect(r.enforcement).toBe('just_for_context');
  });
});

describe('FoodPreferenceDeclareInputSchema', () => {
  it('happy path: household-scoped (both child fields absent)', () => {
    const r = FoodPreferenceDeclareInputSchema.safeParse({
      item: 'cilantro',
      valence: 'refuses',
    });
    expect(r.success).toBe(true);
  });

  it("defaults enforcement to 'soft'", () => {
    const r = FoodPreferenceDeclareInputSchema.parse({
      item: 'cilantro',
      valence: 'refuses',
    });
    expect(r.enforcement).toBe('soft');
  });

  it('rejects unknown valence', () => {
    const r = FoodPreferenceDeclareInputSchema.safeParse({
      item: 'cilantro',
      valence: 'detests',
    });
    expect(r.success).toBe(false);
  });
});

describe('FavoriteLunchAddInputSchema', () => {
  it('accepts item', () => {
    const r = FavoriteLunchAddInputSchema.safeParse({ item: 'dal chawal' });
    expect(r.success).toBe(true);
  });

  it('rejects empty item', () => {
    const r = FavoriteLunchAddInputSchema.safeParse({ item: '' });
    expect(r.success).toBe(false);
  });
});

describe('RuleSetInputSchema', () => {
  it('non-custom rule without custom_label is valid', () => {
    const r = RuleSetInputSchema.safeParse({ rule_type: 'no_pork' });
    expect(r.success).toBe(true);
  });

  it('non-custom rule with custom_label is rejected', () => {
    const r = RuleSetInputSchema.safeParse({
      rule_type: 'no_pork',
      custom_label: 'extra label',
    });
    expect(r.success).toBe(false);
  });

  it('custom rule requires custom_label', () => {
    const r = RuleSetInputSchema.safeParse({ rule_type: 'custom' });
    expect(r.success).toBe(false);
  });

  it('custom rule with custom_label is valid', () => {
    const r = RuleSetInputSchema.safeParse({
      rule_type: 'custom',
      custom_label: 'no peanut butter on Fridays',
    });
    expect(r.success).toBe(true);
  });

  it("defaults enforcement to 'strong'", () => {
    const r = RuleSetInputSchema.parse({ rule_type: 'no_pork' });
    expect(r.enforcement).toBe('strong');
  });
});

// HouseholdUpsertInputSchema lives in household-profile.ts (slice 2-s27);
// coverage for it lives in household-profile.test.ts.

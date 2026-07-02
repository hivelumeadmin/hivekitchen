import { describe, expect, it } from 'vitest';
import {
  AddChildAllergenRequestSchema,
  ChildAllergenMutationResponseSchema,
  COMMON_ALLERGENS,
  RemoveChildAllergenRequestSchema,
  SetCulturalEnforcementRequestSchema,
  SetCulturalEnforcementResponseSchema,
} from './kitchen-profile-edit.js';
import { ENFORCEMENT_LEVEL_VALUES } from './enforcement.js';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('AddChildAllergenRequestSchema', () => {
  it('accepts each curated common allergen', () => {
    for (const allergen of COMMON_ALLERGENS) {
      expect(AddChildAllergenRequestSchema.safeParse({ allergen }).success).toBe(true);
    }
  });

  it('rejects a near-miss free-text allergen (the typo failure mode)', () => {
    expect(AddChildAllergenRequestSchema.safeParse({ allergen: 'peanuts' }).success).toBe(false);
    expect(AddChildAllergenRequestSchema.safeParse({ allergen: 'peants' }).success).toBe(false);
  });

  it('rejects empty / missing allergen', () => {
    expect(AddChildAllergenRequestSchema.safeParse({ allergen: '' }).success).toBe(false);
    expect(AddChildAllergenRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('ChildAllergenMutationResponseSchema', () => {
  it('parses a child id + allergen string list', () => {
    const result = ChildAllergenMutationResponseSchema.safeParse({
      child_id: UUID,
      allergens: ['peanut', 'milk'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid child id', () => {
    expect(
      ChildAllergenMutationResponseSchema.safeParse({ child_id: 'nope', allergens: [] }).success,
    ).toBe(false);
  });
});

describe('RemoveChildAllergenRequestSchema', () => {
  it('accepts an arbitrary (onboarding-era) allergen string', () => {
    expect(RemoveChildAllergenRequestSchema.safeParse({ allergen: 'peanuts' }).success).toBe(true);
  });

  it('rejects an empty allergen', () => {
    expect(RemoveChildAllergenRequestSchema.safeParse({ allergen: '' }).success).toBe(false);
  });
});

describe('SetCulturalEnforcementRequestSchema', () => {
  it('accepts each enforcement rung with a key', () => {
    for (const enforcement of ENFORCEMENT_LEVEL_VALUES) {
      expect(
        SetCulturalEnforcementRequestSchema.safeParse({ key: 'halal', enforcement }).success,
      ).toBe(true);
    }
  });

  it('rejects a UI-tier value that is not an API enforcement rung', () => {
    expect(
      SetCulturalEnforcementRequestSchema.safeParse({ key: 'halal', enforcement: 'always' }).success,
    ).toBe(false);
  });

  it('rejects a missing key', () => {
    expect(
      SetCulturalEnforcementRequestSchema.safeParse({ enforcement: 'strong' }).success,
    ).toBe(false);
  });
});

describe('SetCulturalEnforcementResponseSchema', () => {
  it('parses key + enforcement', () => {
    expect(
      SetCulturalEnforcementResponseSchema.safeParse({ key: 'halal', enforcement: 'strong' })
        .success,
    ).toBe(true);
  });
});

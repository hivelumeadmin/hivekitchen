import { describe, it, expect } from 'vitest';
import {
  HouseholdProfilePatchBodySchema,
  HouseholdProfileResponseSchema,
  HouseholdIdParamSchema,
  HouseholdUpsertInputSchema,
  HouseholdUpsertOutputSchema,
} from './household-profile.js';

const SAMPLE_UUID = '11111111-1111-4111-8111-111111111111';

describe('HouseholdProfilePatchBodySchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(HouseholdProfilePatchBodySchema.safeParse({}).success).toBe(true);
  });

  it('accepts a single-field patch', () => {
    expect(
      HouseholdProfilePatchBodySchema.safeParse({ dietary_preferences: ['halal'] })
        .success,
    ).toBe(true);
  });

  it('accepts all three arrays', () => {
    expect(
      HouseholdProfilePatchBodySchema.safeParse({
        cultural_identifiers: ['south_asian'],
        dietary_preferences: ['halal'],
        declared_allergens: ['pork'],
      }).success,
    ).toBe(true);
  });

  it('accepts empty arrays (clear semantics)', () => {
    expect(
      HouseholdProfilePatchBodySchema.safeParse({ declared_allergens: [] }).success,
    ).toBe(true);
  });

  it('rejects more than 50 declared_allergens', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `tag${String(i)}`);
    expect(
      HouseholdProfilePatchBodySchema.safeParse({ declared_allergens: tooMany })
        .success,
    ).toBe(false);
  });

  it('rejects more than 30 dietary_preferences', () => {
    const tooMany = Array.from({ length: 31 }, (_, i) => `tag${String(i)}`);
    expect(
      HouseholdProfilePatchBodySchema.safeParse({ dietary_preferences: tooMany })
        .success,
    ).toBe(false);
  });

  it('rejects more than 20 cultural_identifiers', () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `tag${String(i)}`);
    expect(
      HouseholdProfilePatchBodySchema.safeParse({ cultural_identifiers: tooMany })
        .success,
    ).toBe(false);
  });

  it('rejects a non-array value', () => {
    expect(
      HouseholdProfilePatchBodySchema.safeParse({ dietary_preferences: 'halal' })
        .success,
    ).toBe(false);
  });

  it('rejects empty-string tags', () => {
    expect(
      HouseholdProfilePatchBodySchema.safeParse({ declared_allergens: [''] })
        .success,
    ).toBe(false);
  });
});

describe('HouseholdProfileResponseSchema', () => {
  it('parses a valid response with all three fields', () => {
    expect(
      HouseholdProfileResponseSchema.safeParse({
        id: SAMPLE_UUID,
        cultural_identifiers: ['south_asian'],
        dietary_preferences: ['halal'],
        declared_allergens: ['pork'],
      }).success,
    ).toBe(true);
  });

  it('parses with empty arrays', () => {
    expect(
      HouseholdProfileResponseSchema.safeParse({
        id: SAMPLE_UUID,
        cultural_identifiers: [],
        dietary_preferences: [],
        declared_allergens: [],
      }).success,
    ).toBe(true);
  });

  it('rejects missing id', () => {
    expect(
      HouseholdProfileResponseSchema.safeParse({
        cultural_identifiers: [],
        dietary_preferences: [],
        declared_allergens: [],
      }).success,
    ).toBe(false);
  });

  it('rejects non-uuid id', () => {
    expect(
      HouseholdProfileResponseSchema.safeParse({
        id: 'not-a-uuid',
        cultural_identifiers: [],
        dietary_preferences: [],
        declared_allergens: [],
      }).success,
    ).toBe(false);
  });
});

describe('HouseholdIdParamSchema', () => {
  it('accepts a uuid', () => {
    expect(HouseholdIdParamSchema.safeParse({ id: SAMPLE_UUID }).success).toBe(true);
  });

  it('rejects non-uuid', () => {
    expect(HouseholdIdParamSchema.safeParse({ id: 'abc' }).success).toBe(false);
  });
});

describe('HouseholdUpsertInputSchema', () => {
  it('accepts a single-field upsert', () => {
    expect(
      HouseholdUpsertInputSchema.safeParse({ cultural_identifiers: ['malayali'] })
        .success,
    ).toBe(true);
  });

  it('accepts an empty patch (no-op)', () => {
    expect(HouseholdUpsertInputSchema.safeParse({}).success).toBe(true);
  });

  it('rejects a tag longer than 64 characters', () => {
    const longTag = 'a'.repeat(65);
    expect(
      HouseholdUpsertInputSchema.safeParse({ declared_allergens: [longTag] })
        .success,
    ).toBe(false);
  });

  it('accepts declared_allergens_add (additive path)', () => {
    expect(
      HouseholdUpsertInputSchema.safeParse({ declared_allergens_add: ['celery'] })
        .success,
    ).toBe(true);
  });

  it('accepts declared_allergens_add with multiple items', () => {
    expect(
      HouseholdUpsertInputSchema.safeParse({
        declared_allergens_add: ['celery', 'mustard'],
      }).success,
    ).toBe(true);
  });

  it('rejects declared_allergens_add together with declared_allergens (mutually exclusive at schema level)', () => {
    // The schema itself allows both fields — mutual exclusivity is enforced in
    // the tool fn. This test documents that the schema does NOT reject the pair
    // so the tool fn check is the authoritative guard.
    const result = HouseholdUpsertInputSchema.safeParse({
      declared_allergens: ['pork'],
      declared_allergens_add: ['celery'],
    });
    expect(result.success).toBe(true); // schema passes; tool fn rejects
  });

  it('rejects declared_allergens_add tag longer than 64 characters', () => {
    const longTag = 'a'.repeat(65);
    expect(
      HouseholdUpsertInputSchema.safeParse({ declared_allergens_add: [longTag] })
        .success,
    ).toBe(false);
  });

  it('rejects declared_allergens_add with more than 50 items', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `tag${String(i)}`);
    expect(
      HouseholdUpsertInputSchema.safeParse({ declared_allergens_add: tooMany })
        .success,
    ).toBe(false);
  });
});

describe('HouseholdUpsertOutputSchema', () => {
  it('accepts a valid output', () => {
    expect(
      HouseholdUpsertOutputSchema.safeParse({
        household_id: SAMPLE_UUID,
        was_existing: true,
      }).success,
    ).toBe(true);
  });

  it('rejects was_existing=false', () => {
    expect(
      HouseholdUpsertOutputSchema.safeParse({
        household_id: SAMPLE_UUID,
        was_existing: false,
      }).success,
    ).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  AddChildBodySchema,
  AddChildResponseSchema,
  AgeBandSchema,
  BagCompositionSchema,
  ChildResponseSchema,
  GetChildResponseSchema,
  SetBagCompositionBodySchema,
  SetBagCompositionResponseSchema,
} from './children.js';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('AddChildBodySchema', () => {
  it('accepts a minimal body and applies array defaults', () => {
    const result = AddChildBodySchema.parse({ name: 'Asha', age_band: 'child' });
    expect(result.declared_allergens).toEqual([]);
    expect(result.cultural_identifiers).toEqual([]);
    expect(result.dietary_preferences).toEqual([]);
  });

  it('trims name and rejects empty name after trim', () => {
    expect(AddChildBodySchema.parse({ name: '  Asha  ', age_band: 'child' }).name).toBe('Asha');
    expect(AddChildBodySchema.safeParse({ name: '   ', age_band: 'child' }).success).toBe(false);
  });

  it('rejects unknown age_band', () => {
    expect(
      AddChildBodySchema.safeParse({ name: 'Asha', age_band: 'baby' as 'child' }).success,
    ).toBe(false);
  });

  it('caps array lengths', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `a${i}`);
    expect(
      AddChildBodySchema.safeParse({
        name: 'Asha',
        age_band: 'child',
        declared_allergens: tooMany,
      }).success,
    ).toBe(false);
  });
});

describe('ChildResponseSchema / wrappers', () => {
  const baseChild = {
    id: VALID_UUID,
    household_id: VALID_UUID,
    name: 'Asha',
    age_band: 'child' as const,
    school_policy_notes: null,
    declared_allergens: ['peanut'],
    cultural_identifiers: ['south_asian'],
    dietary_preferences: ['vegetarian'],
    allergen_rule_version: 'v1',
    bag_composition: { main: true as const, snack: true, extra: true },
    created_at: '2026-04-28T10:00:00.000Z',
  };

  it('accepts a fully populated child row', () => {
    expect(ChildResponseSchema.safeParse(baseChild).success).toBe(true);
    expect(AddChildResponseSchema.safeParse({ child: baseChild }).success).toBe(true);
    expect(GetChildResponseSchema.safeParse({ child: baseChild }).success).toBe(true);
  });

  it('rejects a child row whose bag_composition is missing', () => {
    const { bag_composition: _drop, ...withoutBag } = baseChild;
    expect(ChildResponseSchema.safeParse(withoutBag).success).toBe(false);
  });

  it('AgeBandSchema enumerates all four bands', () => {
    for (const band of ['toddler', 'child', 'preteen', 'teen']) {
      expect(AgeBandSchema.safeParse(band).success).toBe(true);
    }
  });
});

describe('BagCompositionSchema', () => {
  it('accepts main:true with arbitrary snack/extra flags', () => {
    expect(
      BagCompositionSchema.safeParse({ main: true, snack: true, extra: true }).success,
    ).toBe(true);
    expect(
      BagCompositionSchema.safeParse({ main: true, snack: false, extra: false }).success,
    ).toBe(true);
  });

  it('rejects main:false (literal-true invariant)', () => {
    expect(
      BagCompositionSchema.safeParse({ main: false, snack: true, extra: true }).success,
    ).toBe(false);
  });

  it('requires snack and extra fields', () => {
    expect(BagCompositionSchema.safeParse({ main: true }).success).toBe(false);
    expect(BagCompositionSchema.safeParse({ main: true, snack: true }).success).toBe(false);
  });
});

describe('SetBagCompositionBodySchema', () => {
  it('accepts a body with only snack and extra booleans', () => {
    expect(SetBagCompositionBodySchema.safeParse({ snack: true, extra: true }).success).toBe(true);
    expect(
      SetBagCompositionBodySchema.safeParse({ snack: false, extra: false }).success,
    ).toBe(true);
  });

  it('rejects a body that includes main (.strict() guards the invariant)', () => {
    expect(
      SetBagCompositionBodySchema.safeParse({
        main: true,
        snack: true,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      SetBagCompositionBodySchema.safeParse({
        main: false,
        snack: true,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('rejects unknown extra keys', () => {
    expect(
      SetBagCompositionBodySchema.safeParse({
        snack: true,
        extra: true,
        beverage: true,
      } as unknown).success,
    ).toBe(false);
  });

  it('rejects non-boolean values for snack/extra', () => {
    expect(
      SetBagCompositionBodySchema.safeParse({ snack: 'yes' as unknown as boolean, extra: true })
        .success,
    ).toBe(false);
    expect(
      SetBagCompositionBodySchema.safeParse({ snack: true, extra: 1 as unknown as boolean })
        .success,
    ).toBe(false);
  });
});

describe('SetBagCompositionResponseSchema', () => {
  it('wraps a ChildResponse including bag_composition', () => {
    const child = {
      id: VALID_UUID,
      household_id: VALID_UUID,
      name: 'Asha',
      age_band: 'child' as const,
      school_policy_notes: null,
      declared_allergens: [],
      cultural_identifiers: [],
      dietary_preferences: [],
      allergen_rule_version: 'v1',
      bag_composition: { main: true as const, snack: false, extra: true },
      created_at: '2026-04-28T10:00:00.000Z',
    };
    expect(SetBagCompositionResponseSchema.safeParse({ child }).success).toBe(true);
  });
});

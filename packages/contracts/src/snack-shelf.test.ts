import { describe, it, expect } from 'vitest';
import {
  SnackAllergenTagSchema,
  SnackSkuSchema,
  CreateSnackSkuInputSchema,
} from './snack-shelf.js';

const FALCPA_9 = [
  'peanut',
  'tree_nut',
  'dairy',
  'egg',
  'wheat',
  'soy',
  'fish',
  'shellfish',
  'sesame',
] as const;

describe('SnackAllergenTagSchema', () => {
  it('accepts all 9 FALCPA values', () => {
    for (const tag of FALCPA_9) {
      expect(SnackAllergenTagSchema.safeParse(tag).success).toBe(true);
    }
  });

  it('rejects an unknown allergen string', () => {
    expect(SnackAllergenTagSchema.safeParse('gluten').success).toBe(false);
  });
});

describe('CreateSnackSkuInputSchema', () => {
  it('defaults allergen_tags to [] when omitted', () => {
    const parsed = CreateSnackSkuInputSchema.parse({ name: 'Apple', category: 'fruit' });
    expect(parsed.allergen_tags).toEqual([]);
  });

  it('accepts an explicit allergen_tags array', () => {
    const parsed = CreateSnackSkuInputSchema.parse({
      name: 'Cheese Stick',
      category: 'dairy',
      allergen_tags: ['dairy'],
    });
    expect(parsed.allergen_tags).toEqual(['dairy']);
  });

  it('rejects an unknown allergen tag', () => {
    const result = CreateSnackSkuInputSchema.safeParse({
      name: 'Apple',
      category: 'fruit',
      allergen_tags: ['gluten'],
    });
    expect(result.success).toBe(false);
  });
});

describe('SnackSkuSchema', () => {
  const base = {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Cheese Stick',
    brand: null,
    category: 'dairy',
    created_by_household_id: null,
    created_at: '2026-06-20T00:00:00.000Z',
    upc_code: null,
    package_type: null,
    in_stock: true,
  };

  it('requires allergen_tags to be present on the response', () => {
    expect(SnackSkuSchema.safeParse(base).success).toBe(false);
    expect(SnackSkuSchema.safeParse({ ...base, allergen_tags: ['dairy'] }).success).toBe(true);
  });
});

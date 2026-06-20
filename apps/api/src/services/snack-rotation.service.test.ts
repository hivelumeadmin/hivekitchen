import { describe, it, expect } from 'vitest';
import { assignSnackRotation } from './snack-rotation.service.js';
import type { SnackSkuRow } from '../modules/recipe/snack-sku.repository.js';

const sku = (overrides: Partial<SnackSkuRow> & { id: string; category: string }): SnackSkuRow => ({
  name: `Snack-${overrides.id}`,
  brand: null,
  contains_peanut: false,
  contains_tree_nut: false,
  contains_dairy: false,
  contains_egg: false,
  contains_wheat: false,
  contains_soy: false,
  contains_fish: false,
  contains_shellfish: false,
  contains_sesame: false,
  is_halal: true,
  is_kosher: false,
  is_vegetarian: true,
  is_vegan: false,
  is_active: true,
  created_by_household_id: null,
  ...overrides,
});

const FRUIT_SKU = sku({ id: 'aaaa0000-0000-4000-8000-000000000001', category: 'fruit' });
const VEG_SKU = sku({ id: 'aaaa0000-0000-4000-8000-000000000002', category: 'vegetable' });
const GRAIN_SKU = sku({ id: 'aaaa0000-0000-4000-8000-000000000003', category: 'grain' });
const DAIRY_SKU = sku({ id: 'aaaa0000-0000-4000-8000-000000000004', category: 'dairy' });

const CHILD_A = 'bbbb0000-0000-4000-8000-000000000001';
const CHILD_B = 'bbbb0000-0000-4000-8000-000000000002';

describe('assignSnackRotation', () => {
  it('returns empty when no children have snack=ON', () => {
    const result = assignSnackRotation({
      bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: false, extra: false }],
      extraRules: [],
      activeSkus: [FRUIT_SKU],
      weekOf: '2026-10-13',
    });
    expect(result).toHaveLength(0);
  });

  it('returns empty when no active SKUs exist', () => {
    const result = assignSnackRotation({
      bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
      extraRules: [],
      activeSkus: [],
      weekOf: '2026-10-13',
    });
    expect(result).toHaveLength(0);
  });

  it('produces one slot per planned day', () => {
    const result = assignSnackRotation({
      bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
      extraRules: [],
      activeSkus: [FRUIT_SKU, VEG_SKU, GRAIN_SKU],
      weekOf: '2026-10-13',
    });
    expect(result).toHaveLength(5);
    expect(result.map((r) => r.day)).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
  });

  it('respects plannedDays subset', () => {
    const result = assignSnackRotation({
      bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
      extraRules: [],
      activeSkus: [FRUIT_SKU, VEG_SKU],
      weekOf: '2026-10-13',
      plannedDays: ['monday', 'wednesday', 'friday'],
    });
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.day)).toEqual(['monday', 'wednesday', 'friday']);
  });

  it('honours category ban from extra_rules (veggie → vegetable normalization)', () => {
    const result = assignSnackRotation({
      bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
      extraRules: [{ child_id: CHILD_A, child_name: 'Aarav', bans: ['veggie'], pins: [] }],
      activeSkus: [VEG_SKU, FRUIT_SKU],
      weekOf: '2026-10-13',
    });
    // Every day must pick FRUIT_SKU (the only non-veggie option)
    for (const slot of result) {
      expect(slot.snack_sku_id).toBe(FRUIT_SKU.id);
    }
  });

  it('honours category ban when it uses normalized form ("vegetable")', () => {
    const result = assignSnackRotation({
      bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
      extraRules: [{ child_id: CHILD_A, child_name: 'Aarav', bans: ['vegetable'], pins: [] }],
      activeSkus: [VEG_SKU, FRUIT_SKU],
      weekOf: '2026-10-13',
    });
    for (const slot of result) {
      expect(slot.snack_sku_id).toBe(FRUIT_SKU.id);
    }
  });

  it('no adjacent day repeats (when ≥2 eligible SKUs exist)', () => {
    const result = assignSnackRotation({
      bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
      extraRules: [],
      activeSkus: [FRUIT_SKU, VEG_SKU],
      weekOf: '2026-10-13',
    });
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.snack_sku_id).not.toBe(result[i - 1]!.snack_sku_id);
    }
  });

  it('is deterministic — same inputs produce identical output', () => {
    const opts = {
      bagCompositions: [
        { child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false },
        { child_id: CHILD_B, child_name: 'Mira', snack: true, extra: false },
      ],
      extraRules: [],
      activeSkus: [FRUIT_SKU, VEG_SKU, GRAIN_SKU, DAIRY_SKU],
      weekOf: '2026-10-13',
    };
    const r1 = assignSnackRotation(opts);
    const r2 = assignSnackRotation(opts);
    expect(r1.map((r) => r.snack_sku_id)).toEqual(r2.map((r) => r.snack_sku_id));
  });

  it('different weekOf produces potentially different ordering', () => {
    const opts = (weekOf: string) => ({
      bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
      extraRules: [],
      activeSkus: [FRUIT_SKU, VEG_SKU, GRAIN_SKU, DAIRY_SKU],
      weekOf,
    });
    const r1 = assignSnackRotation(opts('2026-10-13')).map((r) => r.snack_sku_id);
    const r2 = assignSnackRotation(opts('2026-10-20')).map((r) => r.snack_sku_id);
    // At least one day should differ across weeks (statistically always true with ≥4 SKUs)
    const differs = r1.some((id, i) => id !== r2[i]);
    expect(differs).toBe(true);
  });

  it('falls back to all SKUs when every category is banned', () => {
    const result = assignSnackRotation({
      bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
      extraRules: [{ child_id: CHILD_A, child_name: 'Aarav', bans: ['fruit', 'vegetable', 'grain', 'dairy'], pins: [] }],
      activeSkus: [FRUIT_SKU, VEG_SKU, GRAIN_SKU, DAIRY_SKU],
      weekOf: '2026-10-13',
    });
    // Should not throw; should produce 5 slots using any available SKU
    expect(result).toHaveLength(5);
  });

  it('all snack-ON children appear in child_ids', () => {
    const result = assignSnackRotation({
      bagCompositions: [
        { child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false },
        { child_id: CHILD_B, child_name: 'Mira', snack: true, extra: false },
      ],
      extraRules: [],
      activeSkus: [FRUIT_SKU, VEG_SKU],
      weekOf: '2026-10-13',
    });
    for (const slot of result) {
      expect(slot.child_ids).toContain(CHILD_A);
      expect(slot.child_ids).toContain(CHILD_B);
    }
  });

  it('children with snack=OFF are excluded from child_ids', () => {
    const result = assignSnackRotation({
      bagCompositions: [
        { child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false },
        { child_id: CHILD_B, child_name: 'Mira', snack: false, extra: false },
      ],
      extraRules: [],
      activeSkus: [FRUIT_SKU, VEG_SKU],
      weekOf: '2026-10-13',
    });
    for (const slot of result) {
      expect(slot.child_ids).toContain(CHILD_A);
      expect(slot.child_ids).not.toContain(CHILD_B);
    }
  });

  it('ban from ONE child applies to the shared slot', () => {
    const result = assignSnackRotation({
      bagCompositions: [
        { child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false },
        { child_id: CHILD_B, child_name: 'Mira', snack: true, extra: false },
      ],
      extraRules: [
        // Only CHILD_B bans 'veggie' — the ban still applies to the shared slot
        { child_id: CHILD_B, child_name: 'Mira', bans: ['veggie'], pins: [] },
      ],
      activeSkus: [VEG_SKU, FRUIT_SKU],
      weekOf: '2026-10-13',
    });
    for (const slot of result) {
      expect(slot.snack_sku_id).toBe(FRUIT_SKU.id);
    }
  });
});

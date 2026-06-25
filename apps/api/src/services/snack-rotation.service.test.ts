import { describe, it, expect } from 'vitest';
import { assignSnackRotation } from './snack-rotation.service.js';
import type { SnackSkuRow } from '../modules/recipe/snack-sku.repository.js';

const sku = (overrides: Partial<SnackSkuRow> & { id: string; category: string }): SnackSkuRow => ({
  name: `Snack-${overrides.id}`,
  brand: null,
  allergen_tags: [],
  dietary_tags: ['vegetarian', 'halal'],
  is_active: true,
  in_stock: true,
  created_by_household_id: null,
  archived_at: null,
  created_at: '2026-06-20T00:00:00.000Z',
  upc_code: null,
  package_type: null,
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

  it('excludes out-of-stock (paused) SKUs from the rotation', () => {
    const pausedVeg = sku({ id: VEG_SKU.id, category: 'vegetable', in_stock: false });
    const result = assignSnackRotation({
      bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
      extraRules: [],
      activeSkus: [FRUIT_SKU, pausedVeg],
      weekOf: '2026-10-13',
    });
    // FRUIT_SKU is the only stocked SKU → every day picks it.
    expect(result.length).toBeGreaterThan(0);
    for (const slot of result) {
      expect(slot.snack_sku_id).toBe(FRUIT_SKU.id);
    }
  });

  it('returns empty when every SKU is out of stock', () => {
    const result = assignSnackRotation({
      bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
      extraRules: [],
      activeSkus: [sku({ id: FRUIT_SKU.id, category: 'fruit', in_stock: false })],
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

  // Story 3-S42 — pins ("prefer" semantics: bias, never starve)
  it('pin biases selection — only the pinned category is assigned when it is the sole preferred SKU', () => {
    const result = assignSnackRotation({
      bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
      extraRules: [{ child_id: CHILD_A, child_name: 'Aarav', bans: [], pins: ['fruit'] }],
      activeSkus: [FRUIT_SKU, VEG_SKU, GRAIN_SKU],
      weekOf: '2026-10-13',
    });
    expect(result).toHaveLength(5);
    for (const slot of result) {
      expect(slot.snack_sku_id).toBe(FRUIT_SKU.id);
    }
  });

  it('pin with multiple preferred SKUs still respects no-adjacent-repeat', () => {
    const FRUIT_SKU_2 = sku({ id: 'aaaa0000-0000-4000-8000-000000000005', category: 'fruit' });
    const result = assignSnackRotation({
      bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
      extraRules: [{ child_id: CHILD_A, child_name: 'Aarav', bans: [], pins: ['fruit'] }],
      activeSkus: [FRUIT_SKU, FRUIT_SKU_2, VEG_SKU],
      weekOf: '2026-10-13',
    });
    const fruitIds = new Set([FRUIT_SKU.id, FRUIT_SKU_2.id]);
    for (const slot of result) {
      expect(fruitIds.has(slot.snack_sku_id)).toBe(true);
    }
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.snack_sku_id).not.toBe(result[i - 1]!.snack_sku_id);
    }
  });

  it('empty pins is a no-op (identical to an explicit pins: [] run)', () => {
    const base = {
      bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
      activeSkus: [FRUIT_SKU, VEG_SKU, GRAIN_SKU, DAIRY_SKU],
      weekOf: '2026-10-13',
    };
    const withEmptyPins = assignSnackRotation({
      ...base,
      extraRules: [{ child_id: CHILD_A, child_name: 'Aarav', bans: [], pins: [] }],
    });
    const withNoRules = assignSnackRotation({ ...base, extraRules: [] });
    expect(withEmptyPins.map((r) => r.snack_sku_id)).toEqual(
      withNoRules.map((r) => r.snack_sku_id),
    );
  });

  it('pin that matches no stocked SKU falls back to the full eligible pool', () => {
    const result = assignSnackRotation({
      bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
      extraRules: [{ child_id: CHILD_A, child_name: 'Aarav', bans: [], pins: ['protein'] }],
      activeSkus: [FRUIT_SKU, VEG_SKU],
      weekOf: '2026-10-13',
    });
    // No protein SKU exists → preference is best-effort; the day is never emptied.
    expect(result).toHaveLength(5);
    const usedIds = new Set(result.map((r) => r.snack_sku_id));
    expect([...usedIds].every((id) => id === FRUIT_SKU.id || id === VEG_SKU.id)).toBe(true);
  });

  it('pin + ban interaction across children — ban wins, pinned category never selected', () => {
    const result = assignSnackRotation({
      bagCompositions: [
        { child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false },
        { child_id: CHILD_B, child_name: 'Mira', snack: true, extra: false },
      ],
      extraRules: [
        { child_id: CHILD_A, child_name: 'Aarav', bans: [], pins: ['fruit'] },
        { child_id: CHILD_B, child_name: 'Mira', bans: ['fruit'], pins: [] },
      ],
      activeSkus: [FRUIT_SKU, VEG_SKU, GRAIN_SKU],
      weekOf: '2026-10-13',
    });
    expect(result).toHaveLength(5);
    for (const slot of result) {
      expect(slot.snack_sku_id).not.toBe(FRUIT_SKU.id);
    }
  });

  it('veggie→vegetable normalization applies to pins', () => {
    const result = assignSnackRotation({
      bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
      extraRules: [{ child_id: CHILD_A, child_name: 'Aarav', bans: [], pins: ['veggie'] }],
      activeSkus: [VEG_SKU, FRUIT_SKU, GRAIN_SKU],
      weekOf: '2026-10-13',
    });
    // pin 'veggie' must match the 'vegetable' SKU → every slot is VEG_SKU.
    for (const slot of result) {
      expect(slot.snack_sku_id).toBe(VEG_SKU.id);
    }
  });

  it('unions pins across children — different pins widen the preferred pool', () => {
    // CHILD_A pins fruit, CHILD_B pins grain (shared slot). buildPinnedCategories
    // unions both → preferred = {fruit, grain}; the unpinned VEG_SKU is excluded.
    const result = assignSnackRotation({
      bagCompositions: [
        { child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false },
        { child_id: CHILD_B, child_name: 'Mira', snack: true, extra: false },
      ],
      extraRules: [
        { child_id: CHILD_A, child_name: 'Aarav', bans: [], pins: ['fruit'] },
        { child_id: CHILD_B, child_name: 'Mira', bans: [], pins: ['grain'] },
      ],
      activeSkus: [FRUIT_SKU, VEG_SKU, GRAIN_SKU],
      weekOf: '2026-10-13',
    });
    expect(result).toHaveLength(5);
    const pinnedIds = new Set([FRUIT_SKU.id, GRAIN_SKU.id]);
    for (const slot of result) {
      expect(pinnedIds.has(slot.snack_sku_id)).toBe(true);
      expect(slot.snack_sku_id).not.toBe(VEG_SKU.id);
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

  // Story 3-s43 (Phase-2, AC6) — deterministic allergen pre-filter. SKUs whose
  // allergen_tags intersect a snack-ON child's declared allergens are excluded
  // from the rotation; NO fallback when all are excluded.
  describe('allergen pre-filter (declaredAllergensByChildId)', () => {
    const DAIRY_TAGGED = sku({
      id: 'cccc0000-0000-4000-8000-000000000001',
      category: 'dairy',
      allergen_tags: ['dairy'],
    });
    const SAFE_FRUIT = sku({
      id: 'cccc0000-0000-4000-8000-000000000002',
      category: 'fruit',
      allergen_tags: [],
    });

    it('excludes a SKU whose allergen_tags conflict with a snack-ON child', () => {
      const result = assignSnackRotation({
        bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
        extraRules: [],
        activeSkus: [DAIRY_TAGGED, SAFE_FRUIT],
        weekOf: '2026-10-13',
        declaredAllergensByChildId: new Map([[CHILD_A, ['dairy']]]),
      });
      expect(result.length).toBeGreaterThan(0);
      for (const slot of result) {
        expect(slot.snack_sku_id).toBe(SAFE_FRUIT.id);
      }
    });

    it('returns empty (NO fallback) when every stocked SKU conflicts', () => {
      const result = assignSnackRotation({
        bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
        extraRules: [],
        activeSkus: [DAIRY_TAGGED],
        weekOf: '2026-10-13',
        declaredAllergensByChildId: new Map([[CHILD_A, ['dairy']]]),
      });
      expect(result).toHaveLength(0);
    });

    it("one child's allergen removes the SKU from the shared slot for everyone", () => {
      const result = assignSnackRotation({
        bagCompositions: [
          { child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false },
          { child_id: CHILD_B, child_name: 'Mira', snack: true, extra: false },
        ],
        extraRules: [],
        activeSkus: [DAIRY_TAGGED, SAFE_FRUIT],
        weekOf: '2026-10-13',
        // Only CHILD_B is dairy-allergic; the SKU is still pulled for the slot.
        declaredAllergensByChildId: new Map([[CHILD_B, ['dairy']]]),
      });
      for (const slot of result) {
        expect(slot.snack_sku_id).toBe(SAFE_FRUIT.id);
      }
    });

    it('a non-snack child’s allergen does not constrain the slot', () => {
      const result = assignSnackRotation({
        bagCompositions: [
          { child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false },
          { child_id: CHILD_B, child_name: 'Mira', snack: false, extra: false },
        ],
        extraRules: [],
        activeSkus: [DAIRY_TAGGED],
        weekOf: '2026-10-13',
        // CHILD_B (snack=OFF) is dairy-allergic, but is not in the slot.
        declaredAllergensByChildId: new Map([[CHILD_B, ['dairy']]]),
      });
      expect(result.length).toBeGreaterThan(0);
      for (const slot of result) {
        expect(slot.snack_sku_id).toBe(DAIRY_TAGGED.id);
      }
    });

    it('is a no-op when declaredAllergensByChildId is omitted or empty', () => {
      const base = {
        bagCompositions: [{ child_id: CHILD_A, child_name: 'Aarav', snack: true, extra: false }],
        extraRules: [],
        activeSkus: [DAIRY_TAGGED, SAFE_FRUIT],
        weekOf: '2026-10-13',
      };
      const omitted = assignSnackRotation(base);
      const empty = assignSnackRotation({ ...base, declaredAllergensByChildId: new Map() });
      expect(empty.map((r) => r.snack_sku_id)).toEqual(omitted.map((r) => r.snack_sku_id));
      // DAIRY_TAGGED is eligible because there is no allergen context.
      const used = new Set(omitted.map((r) => r.snack_sku_id));
      expect(used.has(DAIRY_TAGGED.id)).toBe(true);
    });
  });
});

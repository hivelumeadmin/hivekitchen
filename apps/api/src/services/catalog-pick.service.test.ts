import { describe, it, expect } from 'vitest';
import { pickCatalogCandidate } from './catalog-pick.service.js';
import type { CandidateSlateRow } from '../modules/recipe/recipes.repository.js';

const row = (
  overrides: Partial<CandidateSlateRow> & { id: string },
): CandidateSlateRow => ({
  canonical_name: `Recipe ${overrides.id}`,
  cuisine_tags: [],
  allergen_flags: [],
  applicable_slots: ['main'],
  ingredient_keys: [],
  confidence_score: 0.5,
  is_household_favorite: false,
  use_count: 0,
  ...overrides,
});

describe('pickCatalogCandidate', () => {
  it('returns null on an empty slate (catalog miss)', () => {
    expect(
      pickCatalogCandidate({ slot: 'main', slate: [], declaredAllergens: [] }),
    ).toBeNull();
  });

  it('filters by applicable_slots', () => {
    const slate = [
      row({ id: 'snack-only', applicable_slots: ['snack'] }),
      row({ id: 'main-ok', applicable_slots: ['main', 'extra'] }),
    ];
    const pick = pickCatalogCandidate({ slot: 'main', slate, declaredAllergens: [] });
    expect(pick?.id).toBe('main-ok');
  });

  it('returns null when only candidate is wrong slot', () => {
    const slate = [row({ id: 'snack-only', applicable_slots: ['snack'] })];
    expect(
      pickCatalogCandidate({ slot: 'extra', slate, declaredAllergens: [] }),
    ).toBeNull();
  });

  describe('fail-closed allergen pre-filter', () => {
    it('drops recipes whose allergen_flags intersect a declared allergen', () => {
      const slate = [
        row({ id: 'has-peanut', allergen_flags: ['peanut'] }),
        row({ id: 'safe', allergen_flags: ['wheat'] }),
      ];
      const pick = pickCatalogCandidate({
        slot: 'main',
        slate,
        declaredAllergens: ['peanut'],
      });
      expect(pick?.id).toBe('safe');
    });

    it('honors the shared-recipe union — a recipe unsafe for ANY listed allergen is dropped', () => {
      // caller passes the union across all children + household
      const slate = [row({ id: 'has-dairy', allergen_flags: ['dairy'] })];
      const pick = pickCatalogCandidate({
        slot: 'main',
        slate,
        declaredAllergens: ['peanut', 'dairy'], // dairy from a sibling
      });
      expect(pick).toBeNull(); // no safe candidate → miss
    });

    it('keeps everything when no allergens are declared', () => {
      const slate = [row({ id: 'a', allergen_flags: ['peanut', 'dairy'] })];
      const pick = pickCatalogCandidate({ slot: 'main', slate, declaredAllergens: [] });
      expect(pick?.id).toBe('a');
    });
  });

  it('dedups recipes already used this week', () => {
    const slate = [
      row({ id: 'used', is_household_favorite: true }),
      row({ id: 'fresh' }),
    ];
    const pick = pickCatalogCandidate({
      slot: 'main',
      slate,
      declaredAllergens: [],
      excludeRecipeIds: ['used'],
    });
    expect(pick?.id).toBe('fresh');
  });

  describe('constraint: exclude:<ingredient_key>', () => {
    it('drops recipes containing the excluded ingredient', () => {
      const slate = [
        row({ id: 'with-fish', ingredient_keys: ['fish', 'rice'] }),
        row({ id: 'no-fish', ingredient_keys: ['chicken', 'rice'] }),
      ];
      const pick = pickCatalogCandidate({
        slot: 'main',
        slate,
        declaredAllergens: [],
        constraint: 'exclude:fish',
      });
      expect(pick?.id).toBe('no-fish');
    });

    it('treats unrecognized constraints as a no-op (v1)', () => {
      const slate = [row({ id: 'a' })];
      const pick = pickCatalogCandidate({
        slot: 'main',
        slate,
        declaredAllergens: [],
        constraint: 'time:down',
      });
      expect(pick?.id).toBe('a');
    });
  });

  describe('deterministic ranking', () => {
    it('prefers household favorites first', () => {
      const slate = [
        row({ id: 'plain', confidence_score: 0.9 }),
        row({ id: 'fav', is_household_favorite: true, confidence_score: 0.1 }),
      ];
      expect(
        pickCatalogCandidate({ slot: 'main', slate, declaredAllergens: [] })?.id,
      ).toBe('fav');
    });

    it('then higher confidence', () => {
      const slate = [
        row({ id: 'low', confidence_score: 0.2 }),
        row({ id: 'high', confidence_score: 0.8 }),
      ];
      expect(
        pickCatalogCandidate({ slot: 'main', slate, declaredAllergens: [] })?.id,
      ).toBe('high');
    });

    it('then least-used for variety', () => {
      const slate = [
        row({ id: 'often', use_count: 10 }),
        row({ id: 'rare', use_count: 1 }),
      ];
      expect(
        pickCatalogCandidate({ slot: 'main', slate, declaredAllergens: [] })?.id,
      ).toBe('rare');
    });

    it('then stable tiebreak by id', () => {
      const slate = [row({ id: 'b' }), row({ id: 'a' })];
      expect(
        pickCatalogCandidate({ slot: 'main', slate, declaredAllergens: [] })?.id,
      ).toBe('a');
    });

    it('is deterministic — same inputs yield the same pick', () => {
      const slate = [
        row({ id: 'x', use_count: 3 }),
        row({ id: 'y', use_count: 3 }),
        row({ id: 'z', use_count: 1 }),
      ];
      const opts = { slot: 'main' as const, slate, declaredAllergens: [] };
      const first = pickCatalogCandidate(opts);
      const second = pickCatalogCandidate(opts);
      expect(first?.id).toBe(second?.id);
      expect(first?.id).toBe('z'); // least used
    });
  });

  it('returns a recipe-kind candidate with the canonical name as title', () => {
    const slate = [row({ id: 'r1', canonical_name: 'Teriyaki rice bowls' })];
    const pick = pickCatalogCandidate({ slot: 'main', slate, declaredAllergens: [] });
    expect(pick).toEqual({ id: 'r1', kind: 'recipe', title: 'Teriyaki rice bowls' });
  });
});

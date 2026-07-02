import { describe, it, expect } from 'vitest';
import type { KitchenMap } from '@hivekitchen/types';
import { CatalogRepo, computeSharedDeclaredUnion } from './catalog-pick.repository.js';
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

// The wrapper only reads household.declared_allergens + children[].declared_allergens,
// so a minimal projection cast to KitchenMap is sufficient for these unit tests.
const kitchenMap = (
  householdAllergens: string[],
  childAllergens: string[][],
): KitchenMap =>
  ({
    household: { declared_allergens: householdAllergens },
    children: childAllergens.map((a, i) => ({
      id: `child-${i}`,
      declared_allergens: a,
    })),
  }) as unknown as KitchenMap;

const makeDeps = (slate: CandidateSlateRow[], km: KitchenMap) => ({
  recipesRepository: {
    findCandidateSlateForHousehold: () => Promise.resolve(slate),
  },
  kitchenMapService: {
    get: () => Promise.resolve(km),
  },
});

describe('computeSharedDeclaredUnion', () => {
  it('unions household-wide + every child, deduped', () => {
    const km = kitchenMap(['sesame'], [['peanut'], ['dairy', 'peanut']]);
    expect(computeSharedDeclaredUnion(km).sort()).toEqual(['dairy', 'peanut', 'sesame']);
  });

  it('is empty when nothing is declared', () => {
    expect(computeSharedDeclaredUnion(kitchenMap([], [[], []]))).toEqual([]);
  });
});

describe('CatalogRepo.pickRecipe', () => {
  it('returns a safe candidate, loading slate + kitchen map', async () => {
    const slate = [row({ id: 'safe', allergen_flags: ['wheat'] })];
    const repo = new CatalogRepo(makeDeps(slate, kitchenMap([], [[]])));
    const pick = await repo.pickRecipe({ householdId: 'hh', slot: 'main' });
    expect(pick).toEqual({ id: 'safe', kind: 'recipe', title: 'Recipe safe' });
  });

  it("enforces the shared-recipe union — drops a recipe unsafe for a sibling's allergen", async () => {
    // requester is child-0 (no allergens); child-1 has dairy. A shared Main with
    // dairy must still be rejected.
    const slate = [row({ id: 'has-dairy', allergen_flags: ['dairy'] })];
    const repo = new CatalogRepo(makeDeps(slate, kitchenMap([], [[], ['dairy']])));
    const pick = await repo.pickRecipe({ householdId: 'hh', slot: 'main' });
    expect(pick).toBeNull();
  });

  it('passes excludeRecipeIds + constraint through to the selector', async () => {
    const slate = [
      row({ id: 'used', is_household_favorite: true }),
      row({ id: 'with-fish', ingredient_keys: ['fish'], is_household_favorite: true }),
      row({ id: 'pickable' }),
    ];
    const repo = new CatalogRepo(makeDeps(slate, kitchenMap([], [[]])));
    const pick = await repo.pickRecipe({
      householdId: 'hh',
      slot: 'main',
      excludeRecipeIds: ['used'],
      constraint: 'exclude:fish',
    });
    expect(pick?.id).toBe('pickable');
  });

  it('returns null on a catalog miss', async () => {
    const repo = new CatalogRepo(makeDeps([], kitchenMap([], [[]])));
    expect(await repo.pickRecipe({ householdId: 'hh', slot: 'extra' })).toBeNull();
  });
});

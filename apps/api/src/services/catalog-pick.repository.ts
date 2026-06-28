import type { KitchenMap } from '@hivekitchen/types';
import type { CandidateSlateRow } from '../modules/recipe/recipes.repository.js';
import {
  pickCatalogCandidate,
  type CatalogCandidate,
  type RecipeSlotKind,
} from './catalog-pick.service.js';

// Epic 13-s8 / routing-spec §7 — the I/O wrapper around the pure
// pickCatalogCandidate selector. It owns the two reads the selector needs (the
// cached recipe slate + the KitchenMap projection for the safety union) and
// keeps the selection itself a pure, separately-tested function.
//
// SCOPE (v1): recipe slots (main / extra). Snack picks are served by
// assignSnackRotation (snack-rotation.service) — routed there by the caller.

// Structural deps so tests can inject fakes without a real DB / Redis.
export interface CatalogRepoDeps {
  recipesRepository: {
    findCandidateSlateForHousehold(householdId: string): Promise<CandidateSlateRow[]>;
  };
  kitchenMapService: {
    get(householdId: string): Promise<KitchenMap>;
  };
}

export interface PickRecipeArgs {
  householdId: string;
  slot: RecipeSlotKind;
  // Recipe ids already placed in the current week (no repeats).
  excludeRecipeIds?: readonly string[];
  // Optional normalized constraint, e.g. "exclude:fish".
  constraint?: string | null;
}

/**
 * Shared-recipe declared-allergen union. A Main/Extra is cooked for the whole
 * family (family-first doctrine), so it must clear the union across the
 * household-wide set AND every child — never just one child. This is the safety
 * set handed to the fail-closed pre-filter in pickCatalogCandidate. Pure.
 */
export function computeSharedDeclaredUnion(kitchenMap: KitchenMap): string[] {
  const set = new Set<string>(kitchenMap.household.declared_allergens);
  for (const child of kitchenMap.children) {
    for (const allergen of child.declared_allergens) set.add(allergen);
  }
  return [...set];
}

export class CatalogRepo {
  constructor(private readonly deps: CatalogRepoDeps) {}

  /**
   * Load the household's cached slate + safety union, then delegate to the pure
   * selector. Returns null on a catalog miss (caller escalates to the agentic
   * add-dish path behind a confirm gate). Recipe slots only.
   */
  async pickRecipe(args: PickRecipeArgs): Promise<CatalogCandidate | null> {
    const [slate, kitchenMap] = await Promise.all([
      this.deps.recipesRepository.findCandidateSlateForHousehold(args.householdId),
      this.deps.kitchenMapService.get(args.householdId),
    ]);

    return pickCatalogCandidate({
      slot: args.slot,
      slate,
      declaredAllergens: computeSharedDeclaredUnion(kitchenMap),
      excludeRecipeIds: args.excludeRecipeIds,
      constraint: args.constraint,
    });
  }
}

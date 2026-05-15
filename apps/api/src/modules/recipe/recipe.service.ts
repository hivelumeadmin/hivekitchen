import type { FastifyBaseLogger } from 'fastify';
import type {
  RecipeFetchInput,
  RecipeFetchOutput,
  RecipeSearchInput,
  RecipeSearchOutput,
} from '@hivekitchen/types';
import { NotImplementedError } from '../../common/errors.js';
import type { RecipesRepository } from './recipes.repository.js';

// ===========================================================================
// Slice D — Recipe catalog service
// ===========================================================================
// Two-faced service:
//
//  1. AGENT READ PATH (slice D.2, still stubbed):
//     `search()` / `fetch()` back the planner agent's recipe.search /
//     recipe.fetch tools. Both still throw NotImplementedError until D.2
//     wires the agent to consume the populated recipe catalog.
//
//  2. SERVER WRITE PATH (this slice — D.1):
//     `materializeFromPlanItem()` creates (or reuses) a recipes row at
//     plan-commit time so plan_items.recipe_id always points at a real
//     recipe. `recordUse()` upserts household_recipe_usage so the kitchen
//     map's favourite-recipes projection has signal to rank by.
//
// The orchestrator constructs RecipeService without a repository (read
// path is stubbed). PlansService.commit() constructs RecipeService with
// a repository so the write path actually persists. Both forms coexist.
// ===========================================================================

const NAME_WORDS_KEPT = 3; // first N words of an ingredient string kept for the canonical_name fragment

export class RecipeService {
  /** When the repository is undefined, only the legacy stub methods work.
   *  Plan-commit callers must provide the repository. */
  private readonly repository: RecipesRepository | null;
  private readonly logger: FastifyBaseLogger | null;

  constructor(
    repository?: RecipesRepository,
    logger?: FastifyBaseLogger,
  ) {
    this.repository = repository ?? null;
    this.logger = logger ?? null;
  }

  // ---- Agent read path (still stubbed) -----------------------------------

  async search(_input: RecipeSearchInput): Promise<RecipeSearchOutput> {
    throw new NotImplementedError('recipe.search — real service is a future story');
  }

  async fetch(_input: RecipeFetchInput): Promise<RecipeFetchOutput> {
    throw new NotImplementedError('recipe.fetch — real service is a future story');
  }

  // ---- Server write path (slice D) ---------------------------------------

  /**
   * Slice D — at plan-commit time, given an agent-emitted plan item's
   * free-text ingredients, ensure a recipes row exists for this household
   * and return its id. Idempotent by case-insensitive canonical_name.
   *
   * Returns null when materialization is intentionally skipped:
   *   - slot !== 'main': only main slots carry a recipe_id in the plan
   *     contract; snack + extra slots reference item_sku_id instead
   *   - ingredients array is empty
   *
   * Returns the recipe id (existing or freshly inserted) otherwise. Plan
   * commit attaches this id to plan_items.recipe_id.
   *
   * Naming heuristic (deterministic, no LLM):
   *   - one ingredient  → "Chickpea curry"
   *   - two ingredients → "Chicken thigh with rice"
   *   - three+         → first ingredient + " with " + second
   * The agent doesn't emit names today (slice D.2 will add a `name` field
   * to PlanComposeItem); until then this heuristic produces serviceable
   * labels. Future-better names are an upgrade path, not a correctness gap.
   */
  async materializeFromPlanItem(input: {
    householdId: string;
    ingredients: string[];
    slot: 'main' | 'snack' | 'extra';
  }): Promise<{ recipeId: string; wasExisting: boolean } | null> {
    if (this.repository === null) {
      throw new Error(
        'RecipeService.materializeFromPlanItem requires a RecipesRepository — ' +
          'caller constructed RecipeService without one. Wire the repository in plans.hook.ts.',
      );
    }

    // Only main-slot items materialize a recipe. The plan contract refines
    // plan_items so recipe_id is only valid for slot === 'main'; snack/extra
    // slots reference snack_skus.item_sku_id instead.
    if (input.slot !== 'main') return null;
    if (input.ingredients.length === 0) return null;

    const canonical_name = deriveCanonicalName(input.ingredients);

    // Idempotency: same household + same case-insensitive name → reuse.
    // This means a household that has lemon-garlic chicken on Tuesday AND
    // Friday gets one recipe row, two household_recipe_usage hits.
    const existing = await this.repository.findByHouseholdAndName(
      input.householdId,
      canonical_name,
    );
    if (existing !== null) {
      return { recipeId: existing.id, wasExisting: true };
    }

    const ingredient_keys = deduplicate(input.ingredients.map(toIngredientKey));
    const primary_ingredient_key = ingredient_keys[0] ?? null;
    const structured = input.ingredients.map((display, i) => ({
      key: ingredient_keys[i] ?? `ingredient_${String(i)}`,
      modifier: null,
      display,
      quantity: null,
      unit: null,
      optional: false,
      substitutes: [],
    }));

    const inserted = await this.repository.insertRecipe({
      canonical_name,
      ingredients: structured,
      ingredient_keys,
      primary_ingredient_key,
      // Slice D — these flags are left empty for v1. The allergy guardrail
      // already runs per-item at commit time on the free-text ingredients;
      // it doesn't depend on recipe-level pre-computation. Backfilling
      // proper allergen/dietary/cultural/cuisine tags is slice D.2 work,
      // when the planner agent emits structured tags directly.
      allergen_flags: [],
      dietary_flags: [],
      cultural_tags: [],
      cuisine_tags: [],
      applicable_slots: ['main'],
      prep_time_minutes: null,
      source: 'agent_generated',
      created_by_household_id: input.householdId,
      visibility: 'private',
    });

    this.logger?.debug(
      {
        module: 'recipes',
        action: 'recipe.materialized',
        household_id: input.householdId,
        recipe_id: inserted.id,
        canonical_name,
      },
      'recipe materialized from plan item',
    );

    return { recipeId: inserted.id, wasExisting: false };
  }

  /**
   * Slice D — record one use of a recipe by a household. Triggers an
   * atomic INSERT(use_count=1) or UPDATE(use_count++) on
   * household_recipe_usage. Idempotent: safe to call multiple times in
   * the same plan commit if the same recipe appears for multiple
   * (child, day) combinations.
   */
  async recordUse(input: { householdId: string; recipeId: string }): Promise<void> {
    if (this.repository === null) {
      throw new Error(
        'RecipeService.recordUse requires a RecipesRepository — ' +
          'caller constructed RecipeService without one.',
      );
    }
    await this.repository.upsertUsageIncrement(input.householdId, input.recipeId);
  }
}

// ---------------------------------------------------------------------------
// Helpers — exported for tests
// ---------------------------------------------------------------------------

/**
 * Derive a recipe canonical_name from free-text ingredients. Deterministic;
 * same input → same output → idempotent across plan commits.
 *
 *   ["chicken thigh", "rice", "lemon zest"]  → "Chicken thigh with rice"
 *   ["chickpea curry"]                       → "Chickpea curry"
 *   []                                       → "Untitled dish" (caller-guarded;
 *                                                shouldn't reach here)
 */
export function deriveCanonicalName(ingredients: readonly string[]): string {
  if (ingredients.length === 0) return 'Untitled dish';
  const first = cleanIngredientPhrase(ingredients[0] ?? '');
  if (ingredients.length === 1) return capitaliseFirst(first || 'Untitled dish');
  const second = cleanIngredientPhrase(ingredients[1] ?? '');
  if (second.length === 0) return capitaliseFirst(first || 'Untitled dish');
  return capitaliseFirst(`${first} with ${second}`);
}

/**
 * Slugify a free-text ingredient string into a vocabulary key. Best-effort —
 * the agent emits unstructured strings today, so we lossy-compress to a
 * lowercase snake_case form. Slice D.2 will have the agent emit canonical
 * keys directly via the new structured ingredient shape.
 *
 *   "Chicken thigh, sliced" → "chicken_thigh_sliced"
 *   "1/2 cup rice"          → "cup_rice" (strips numbers + punctuation)
 *   "Salt to taste"         → "salt_to_taste"
 */
export function toIngredientKey(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[0-9/]+/g, ' ') // strip quantities like "1/2"
    .replace(/[^a-z\s]+/g, ' ') // strip everything except letters + whitespace
    .trim()
    .replace(/\s+/g, '_');
  return cleaned.length > 0 ? cleaned : 'unknown';
}

/** Strips quantities and parenthetical content, keeps the first N words. */
function cleanIngredientPhrase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, '') // drop parenthetical content
    .replace(/[0-9/]+\s*(cup|cups|tbsp|tsp|oz|g|ml|kg|lb|pound|pinch|dash|slice|slices|piece|pieces|can|cans|package)?s?\b/gi, ' ') // drop quantity + unit
    .replace(/[,.;].*$/, '') // drop everything after first comma/period/semi (preparation notes)
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, NAME_WORDS_KEPT)
    .join(' ');
}

function capitaliseFirst(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

function deduplicate<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

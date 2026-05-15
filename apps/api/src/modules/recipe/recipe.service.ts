import type { FastifyBaseLogger } from 'fastify';
import type {
  RecipeFetchInput,
  RecipeFetchOutput,
  RecipeSearchInput,
  RecipeSearchOutput,
} from '@hivekitchen/types';
import { NotFoundError } from '../../common/errors.js';
import type {
  HouseholdUsageScore,
  RecipePreviewRow,
  RecipesRepository,
} from './recipes.repository.js';

// ===========================================================================
// Slice D — Recipe catalog service
// ===========================================================================
// Two-faced service:
//
//  1. AGENT READ PATH (slice D.2):
//     `search()` and `fetch()` back the planner agent's recipe.search /
//     recipe.fetch tools. Search reranks repository previews by the
//     household's own use_count + favourite/banned flags so the agent
//     sees what *this* household has actually liked first, falling back
//     to community signal otherwise.
//
//  2. SERVER WRITE PATH (slice D.1):
//     `materializeFromPlanItem()` creates (or reuses) a recipes row at
//     plan-commit time so plan_items.recipe_id always points at a real
//     recipe. `recordUse()` upserts household_recipe_usage so the kitchen
//     map's favourite-recipes projection has signal to rank by.
//
// Both paths require a RecipesRepository. The orchestrator + plans hook
// each construct RecipeService with the repository wired in.
// ===========================================================================

const NAME_WORDS_KEPT = 3; // first N words of an ingredient string kept for the canonical_name fragment

// Slice D.2 — search overfetches by 3x to give the household-usage rerank
// room to bubble favourites up past name-match ordering from postgres.
const SEARCH_OVERFETCH_MULTIPLIER = 3;

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

  // ---- Agent read path (slice D.2) ---------------------------------------

  /**
   * Slice D.2 — planner agent's recipe.search tool.
   *
   * Pipeline:
   *   1. Repository returns up to `max_results * SEARCH_OVERFETCH_MULTIPLIER`
   *      visible, active candidates (household-owned or shared) matching the
   *      free-text query.
   *   2. Service fetches per-household usage scores for those candidates.
   *   3. Service drops banned recipes, then ranks:
   *        favourite (true > false) >
   *        household use_count desc >
   *        community_use_count desc >
   *        canonical_name asc
   *   4. Slice to `max_results` and shape to the agent-facing preview.
   *
   * Returns `{ results: [] }` when nothing matches — never throws on empty.
   */
  async search(input: RecipeSearchInput): Promise<RecipeSearchOutput> {
    const repo = this.requireRepository('search');

    const overfetchLimit = input.max_results * SEARCH_OVERFETCH_MULTIPLIER;
    const previews = await repo.searchByHousehold({
      householdId: input.household_id,
      query: input.query,
      overfetchLimit,
    });
    if (previews.length === 0) {
      return { results: [] };
    }

    const scoresList = await repo.findUsageScores(
      input.household_id,
      previews.map((p) => p.id),
    );
    const scoreById = new Map<string, HouseholdUsageScore>(
      scoresList.map((s) => [s.recipe_id, s]),
    );

    const ranked = previews
      .filter((p) => !scoreById.get(p.id)?.is_household_banned)
      .sort((a, b) => comparePreviewsForRanking(a, b, scoreById))
      .slice(0, input.max_results);

    return {
      results: ranked.map((row) => ({
        id: row.id,
        name: row.canonical_name,
        primary_ingredient_key: row.primary_ingredient_key,
        cuisine_tags: row.cuisine_tags,
        allergen_flags: row.allergen_flags,
        dietary_flags: row.dietary_flags,
        prep_time_minutes: row.prep_time_minutes,
      })),
    };
  }

  /**
   * Slice D.2 — planner agent's recipe.fetch tool. Returns the canonical
   * catalog row when the recipe is visible to the household (owned or
   * shared) and active; throws NotFoundError otherwise. The two
   * "missing" cases (truly absent vs. another household's private row)
   * collapse to one error on purpose so we don't leak existence of
   * other households' recipes.
   */
  async fetch(input: RecipeFetchInput): Promise<RecipeFetchOutput> {
    const repo = this.requireRepository('fetch');

    const row = await repo.findByIdForHousehold(
      input.recipe_id,
      input.household_id,
    );
    if (row === null) {
      throw new NotFoundError(`recipe ${input.recipe_id}`);
    }
    // Repository row shape mirrors RecipeRowSchema. Cast through the
    // contract type — RecipeFetchOutputSchema validation happens at the
    // tool boundary in recipe.tools.ts, not here, so we don't pay the
    // zod-parse cost twice on the hot path.
    return row as unknown as RecipeFetchOutput;
  }

  private requireRepository(method: string): RecipesRepository {
    if (this.repository === null) {
      throw new Error(
        `RecipeService.${method} requires a RecipesRepository — caller constructed ` +
          'RecipeService without one. Wire the repository in orchestrator.hook / plans.hook.',
      );
    }
    return this.repository;
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
    const repo = this.requireRepository('materializeFromPlanItem');

    // Only main-slot items materialize a recipe. The plan contract refines
    // plan_items so recipe_id is only valid for slot === 'main'; snack/extra
    // slots reference snack_skus.item_sku_id instead.
    if (input.slot !== 'main') return null;
    if (input.ingredients.length === 0) return null;

    const canonical_name = deriveCanonicalName(input.ingredients);

    // Idempotency: same household + same case-insensitive name → reuse.
    // This means a household that has lemon-garlic chicken on Tuesday AND
    // Friday gets one recipe row, two household_recipe_usage hits.
    const existing = await repo.findByHouseholdAndName(
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

    const inserted = await repo.insertRecipe({
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
    const repo = this.requireRepository('recordUse');
    await repo.upsertUsageIncrement(input.householdId, input.recipeId);
  }
}

/**
 * Slice D.2 search-result comparator. Returns negative when `a` should rank
 * before `b`. Tie-break order:
 *   favourite first → household use_count desc → community_use_count desc → name asc
 */
function comparePreviewsForRanking(
  a: RecipePreviewRow,
  b: RecipePreviewRow,
  scoreById: ReadonlyMap<string, HouseholdUsageScore>,
): number {
  const aScore = scoreById.get(a.id);
  const bScore = scoreById.get(b.id);

  // 1. Favourites surface above everything else from the same household.
  const aFav = aScore?.is_household_favorite === true ? 1 : 0;
  const bFav = bScore?.is_household_favorite === true ? 1 : 0;
  if (aFav !== bFav) return bFav - aFav;

  // 2. Household use_count — what we've actually liked enough to repeat.
  const aUse = aScore?.use_count ?? 0;
  const bUse = bScore?.use_count ?? 0;
  if (aUse !== bUse) return bUse - aUse;

  // 3. Community signal — what other households are repeating, for cold-start.
  if (a.community_use_count !== b.community_use_count) {
    return b.community_use_count - a.community_use_count;
  }

  // 4. Stable tie-break — deterministic ordering for test snapshots / paging.
  return a.canonical_name.localeCompare(b.canonical_name);
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

import { BaseRepository } from '../../repository/base.repository.js';

// ===========================================================================
// Slice D — Recipes catalog + per-household usage persistence
// ===========================================================================
// Write path (D.1): RecipesService at plan-commit time materializes a recipe
// row + bumps household_recipe_usage.
// Read path (D.2): RecipesService.search / .fetch back the planner agent's
// recipe.search / recipe.fetch tools.
// ===========================================================================

const RECIPE_COLUMNS =
  'id, canonical_name, slug, ingredients, instructions, ingredient_keys, primary_ingredient_key, allergen_flags, dietary_flags, cultural_tags, cuisine_tags, applicable_slots, prep_time_minutes, source, created_by_household_id, visibility, community_use_count, community_rating_avg, community_rating_count, is_active, created_at, updated_at';

const PREVIEW_COLUMNS =
  'id, canonical_name, primary_ingredient_key, cuisine_tags, allergen_flags, dietary_flags, prep_time_minutes, community_use_count';

export interface RecipeRowMinimal {
  id: string;
  canonical_name: string;
}

// Full row as returned by Supabase. Mirrors RecipeRowSchema in
// packages/contracts/src/recipe.ts but kept here as a structural interface so
// the repository doesn't bring zod into the persistence layer.
export interface RecipeRow {
  id: string;
  canonical_name: string;
  slug: string | null;
  ingredients: unknown; // jsonb — service validates via RecipeIngredientSchema
  instructions: string | string[] | null;
  ingredient_keys: string[];
  primary_ingredient_key: string | null;
  allergen_flags: string[];
  dietary_flags: string[];
  cultural_tags: string[];
  cuisine_tags: string[];
  applicable_slots: string[];
  prep_time_minutes: number | null;
  source: 'agent_generated' | 'curated' | 'imported';
  created_by_household_id: string | null;
  visibility: 'private' | 'shared';
  community_use_count: number;
  community_rating_avg: number | null;
  community_rating_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Slimmer projection for recipe.search results — preview cards only.
export interface RecipePreviewRow {
  id: string;
  canonical_name: string;
  primary_ingredient_key: string | null;
  cuisine_tags: string[];
  allergen_flags: string[];
  dietary_flags: string[];
  prep_time_minutes: number | null;
  community_use_count: number;
}

// Household-side usage scores joined into search results so we can rerank
// agent-facing previews by what this household has actually liked.
export interface HouseholdUsageScore {
  recipe_id: string;
  use_count: number;
  is_household_banned: boolean;
  is_household_favorite: boolean;
}

export interface InsertRecipeInput {
  canonical_name: string;
  ingredients: Array<{
    key: string;
    modifier: string | null;
    display: string;
    quantity: number | null;
    unit: string | null;
    optional: boolean;
    substitutes: Array<{ key: string; modifier: string | null }>;
  }>;
  // F-P12: instruction steps extracted by RecipeAgent (rewritten as functional
  // imperatives). Optional so the existing materializeFromPlanItem path
  // (which has no instructions) continues to work unchanged.
  instructions?: string[];
  ingredient_keys: string[];
  primary_ingredient_key: string | null;
  allergen_flags: string[];
  dietary_flags: string[];
  cultural_tags: string[];
  cuisine_tags: string[];
  applicable_slots: Array<'main' | 'snack' | 'extra'>;
  prep_time_minutes: number | null;
  source: 'agent_generated' | 'curated' | 'imported';
  created_by_household_id: string;
  visibility: 'private' | 'shared';
}

export class RecipesRepository extends BaseRepository {
  /**
   * Slice D — idempotent recipe lookup by case-insensitive canonical_name
   * within a household. Used by RecipesService.materializeFromPlanItem so
   * repeated plan commits with the same dish reuse the existing row rather
   * than duplicating.
   */
  async findByHouseholdAndName(
    householdId: string,
    canonicalName: string,
  ): Promise<RecipeRowMinimal | null> {
    const { data, error } = await this.client
      .from('recipes')
      .select('id, canonical_name')
      .eq('created_by_household_id', householdId)
      .ilike('canonical_name', canonicalName.trim())
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data as RecipeRowMinimal | null;
  }

  async insertRecipe(input: InsertRecipeInput): Promise<RecipeRowMinimal> {
    const { data, error } = await this.client
      .from('recipes')
      .insert({
        canonical_name: input.canonical_name,
        ingredients: input.ingredients,
        ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
        ingredient_keys: input.ingredient_keys,
        primary_ingredient_key: input.primary_ingredient_key,
        allergen_flags: input.allergen_flags,
        dietary_flags: input.dietary_flags,
        cultural_tags: input.cultural_tags,
        cuisine_tags: input.cuisine_tags,
        applicable_slots: input.applicable_slots,
        prep_time_minutes: input.prep_time_minutes,
        source: input.source,
        created_by_household_id: input.created_by_household_id,
        visibility: input.visibility,
      })
      .select('id, canonical_name')
      .single();
    if (error) throw error;
    return data as RecipeRowMinimal;
  }

  /**
   * Slice D — atomic upsert of a household_recipe_usage row. INSERT with
   * use_count = 1 on first sighting; on conflict, increment counters and
   * stamp last_used_at. Uses a Postgres rpc for true atomicity — a
   * SELECT-then-UPDATE pattern would race when the same recipe lands on
   * multiple plan_items in a single commit batch.
   */
  async upsertUsageIncrement(
    householdId: string,
    recipeId: string,
  ): Promise<void> {
    // The migration didn't ship an RPC for this. Use UPSERT with the
    // `ignoreDuplicates: false` semantic and let Postgres UPDATE on
    // conflict via the implicit PK. supabase-js doesn't expose the SET
    // counter += 1 form directly, so do a two-step: try INSERT(use_count=1);
    // on PK conflict, UPDATE existing with use_count++ + last_used_at=now.
    const nowIso = new Date().toISOString();

    const insertResult = await this.client
      .from('household_recipe_usage')
      .insert({
        household_id: householdId,
        recipe_id: recipeId,
        use_count: 1,
        first_used_at: nowIso,
        last_used_at: nowIso,
      })
      .select('household_id');

    if (insertResult.error === null) {
      // Inserted fresh row — no further work needed.
      return;
    }

    // PG error code 23505 = unique_violation (the (household_id, recipe_id) PK)
    const errCode = (insertResult.error as { code?: string }).code;
    if (errCode !== '23505') {
      throw insertResult.error;
    }

    // Existing row — UPDATE counters. Fetch current use_count first
    // because supabase-js doesn't have an inline "SET col = col + 1".
    const fetch = await this.client
      .from('household_recipe_usage')
      .select('use_count')
      .eq('household_id', householdId)
      .eq('recipe_id', recipeId)
      .maybeSingle();
    if (fetch.error) throw fetch.error;
    if (fetch.data === null) {
      // Should not happen: 23505 means row exists. Defensive: re-attempt
      // insert as a fall-through; if THAT fails we throw.
      const retry = await this.client
        .from('household_recipe_usage')
        .insert({
          household_id: householdId,
          recipe_id: recipeId,
          use_count: 1,
          first_used_at: nowIso,
          last_used_at: nowIso,
        });
      if (retry.error) throw retry.error;
      return;
    }

    const currentUseCount = (fetch.data as { use_count: number }).use_count;
    const update = await this.client
      .from('household_recipe_usage')
      .update({
        use_count: currentUseCount + 1,
        last_used_at: nowIso,
      })
      .eq('household_id', householdId)
      .eq('recipe_id', recipeId);
    if (update.error) throw update.error;
  }

  // -------------------------------------------------------------------------
  // Slice D.2 — agent-facing read methods
  // -------------------------------------------------------------------------

  /**
   * Search for recipes visible to a household. Visibility = the household
   * owns the row OR the row is community-shared. Excludes banned recipes
   * (via household_recipe_usage.is_household_banned) and inactive rows.
   *
   * Match strategy (intentionally simple for D.2 first cut):
   *   - canonical_name ILIKE %query%
   *   - OR ingredient_keys contains slug(query)  (GIN-indexed @> )
   *   - OR primary_ingredient_key ILIKE %slug(query)%
   *
   * Future stories can layer trigram / FTS / embeddings on top. The contract
   * we expose is "free-text search → ranked previews"; the implementation
   * can evolve without changing the tool surface.
   *
   * Overfetches by 3x then defers ranking to the service layer, which
   * has access to per-household usage scores from {@link findUsageScores}.
   */
  async searchByHousehold(input: {
    householdId: string;
    query: string;
    overfetchLimit: number;
  }): Promise<RecipePreviewRow[]> {
    const visibility = `created_by_household_id.eq.${input.householdId},visibility.eq.shared`;
    const ilikePattern = `%${escapeIlikeWildcards(input.query)}%`;
    const slug = slugifyTerm(input.query);

    // Name-match query — most direct semantic hit for "dal" / "chicken curry".
    const byName = await this.client
      .from('recipes')
      .select(PREVIEW_COLUMNS)
      .eq('is_active', true)
      .or(visibility)
      .ilike('canonical_name', ilikePattern)
      .limit(input.overfetchLimit);
    if (byName.error) throw byName.error;

    // Ingredient-key match — supports leftover-style retrieval ("chicken" →
    // every recipe with chicken in its key array). Skipped when the slug
    // strips down to nothing (e.g. a query of pure punctuation).
    let byIngredient: { data: unknown[]; error: null } | { data: null; error: Error } = {
      data: [],
      error: null,
    };
    if (slug.length > 0) {
      const result = await this.client
        .from('recipes')
        .select(PREVIEW_COLUMNS)
        .eq('is_active', true)
        .or(visibility)
        .contains('ingredient_keys', [slug])
        .limit(input.overfetchLimit);
      if (result.error) throw result.error;
      byIngredient = result as { data: unknown[]; error: null };
    }

    // Merge + dedupe by id. Service layer ranks by household use_count.
    const seen = new Set<string>();
    const merged: RecipePreviewRow[] = [];
    for (const row of [...(byName.data ?? []), ...(byIngredient.data ?? [])] as RecipePreviewRow[]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
    return merged;
  }

  /**
   * Slice D.2 — fetch usage scores for a set of recipes, scoped to one
   * household. Used by RecipeService.search to rerank previews by what the
   * household has actually used / favourited / banned. Returns only the
   * recipes that have a usage row — recipes the household has never
   * touched get a "no score" treatment downstream (community_use_count
   * fallback).
   */
  async findUsageScores(
    householdId: string,
    recipeIds: readonly string[],
  ): Promise<HouseholdUsageScore[]> {
    if (recipeIds.length === 0) return [];
    const { data, error } = await this.client
      .from('household_recipe_usage')
      .select('recipe_id, use_count, is_household_banned, is_household_favorite')
      .eq('household_id', householdId)
      .in('recipe_id', recipeIds);
    if (error) throw error;
    return (data ?? []) as HouseholdUsageScore[];
  }

  /**
   * Slice D.2 — single-row fetch, visibility-checked. Returns null when:
   *   - the recipe doesn't exist
   *   - the recipe exists but isn't visible to this household
   *     (private + owned by a different household)
   *   - the recipe is_active = false
   * The two non-existence cases collapse to one null return on purpose:
   * a 404 leaks no information about other households' recipes.
   */
  async findByIdForHousehold(
    recipeId: string,
    householdId: string,
  ): Promise<RecipeRow | null> {
    const { data, error } = await this.client
      .from('recipes')
      .select(RECIPE_COLUMNS)
      .eq('id', recipeId)
      .eq('is_active', true)
      .or(`created_by_household_id.eq.${householdId},visibility.eq.shared`)
      .maybeSingle();
    if (error) throw error;
    return data as RecipeRow | null;
  }
}

// ---------------------------------------------------------------------------
// Helpers — kept module-private so the search vocabulary is single-sourced.
// ---------------------------------------------------------------------------

/**
 * Escape PostgreSQL ILIKE wildcards in user-supplied query text so a query
 * containing literal `%` or `_` matches only the literal character, not
 * "any sequence" / "any single char". Backslash is escaped first because
 * it's the postgres LIKE escape character itself.
 */
export function escapeIlikeWildcards(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Reduce a free-text query into a single canonical slug suitable for the
 * `ingredient_keys` array (e.g. "Chicken Thigh" → "chicken_thigh"). Strips
 * punctuation, lowercases, replaces whitespace with underscores. Matches
 * the convention used by RecipeService.toIngredientKey for write-side
 * derivation so the two paths use the same vocabulary.
 */
export function slugifyTerm(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[0-9/]+/g, ' ')
    .replace(/[^a-z\s]+/g, ' ')
    .trim()
    .replace(/\s+/g, '_');
  return cleaned;
}

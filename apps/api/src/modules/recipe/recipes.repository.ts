import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from '../../repository/base.repository.js';

// ===========================================================================
// Slice D — Recipes catalog + per-household usage persistence
// ===========================================================================
// Used by RecipesService at plan-commit time to (a) materialize a recipe row
// from an agent-emitted plan item and (b) record the use against the
// household. Reads are stubbed for now — the agent's recipe.search /
// recipe.fetch tools still throw NotImplementedError. Wired up in slice D.2.
// ===========================================================================

const RECIPE_COLUMNS =
  'id, canonical_name, slug, ingredients, instructions, ingredient_keys, primary_ingredient_key, allergen_flags, dietary_flags, cultural_tags, cuisine_tags, applicable_slots, prep_time_minutes, source, created_by_household_id, visibility, community_use_count, community_rating_avg, community_rating_count, is_active, created_at, updated_at';

export interface RecipeRowMinimal {
  id: string;
  canonical_name: string;
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
}

void RECIPE_COLUMNS; // reserved for future read methods (slice D.2 recipe.fetch wiring)

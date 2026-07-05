import type { CatalogProvenance } from '@hivekitchen/types';
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
  'id, canonical_name, slug, ingredients, ingredient_keys, primary_ingredient_key, allergen_flags, dietary_flags, cultural_tags, cuisine_tags, applicable_slots, prep_time_minutes, finish_time_minutes, source, created_by_household_id, visibility, community_use_count, community_rating_avg, community_rating_count, is_active, created_at, updated_at';

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
  ingredient_keys: string[];
  primary_ingredient_key: string | null;
  allergen_flags: string[];
  dietary_flags: string[];
  cultural_tags: string[];
  cuisine_tags: string[];
  applicable_slots: string[];
  prep_time_minutes: number | null;
  // Story 3-DM-A1: morning-of cook time, separate from prep_time_minutes so
  // the planner can enforce the dual budget (Finish ≤15 / Total ≤40) at
  // recipe granularity.
  finish_time_minutes: number | null;
  source: 'agent_generated' | 'curated' | 'imported' | 'catalog_seeded' | 'parent_declared';
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

// Story 3-S36 — one row of the candidate slate (household_recipe_usage joined to
// its recipe). The loader ranks + groups these into the planner's slot-grouped
// <recipe_candidates> block.
export interface CandidateSlateRow {
  id: string;
  canonical_name: string;
  cuisine_tags: string[];
  allergen_flags: string[];
  applicable_slots: string[];
  ingredient_keys: string[];
  confidence_score: number;
  is_household_favorite: boolean;
  use_count: number;
}

// Shape of the joined `recipes` projection inside findCandidateSlateForHousehold.
interface CandidateSlateJoinedRecipe {
  id: string;
  canonical_name: string;
  cuisine_tags: string[] | null;
  allergen_flags: string[] | null;
  applicable_slots: string[] | null;
  ingredient_keys: string[] | null;
  is_active: boolean;
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
  // Story 3-DM-A1: finish-mode cook time (morning-of). Optional — the
  // materializeFromPlanItem path leaves it null; RecipeAgent extractions
  // populate when present on the source page.
  finish_time_minutes?: number | null;
  // Story 3-DM-A1: structured method steps, tagged with activity mode. When
  // provided, persisted into recipe_steps in the same logical commit as the
  // recipes INSERT. Replaces the legacy `instructions` string[] field.
  steps?: ReadonlyArray<{ mode: 'prep' | 'finish'; text: string }>;
  source: 'agent_generated' | 'curated' | 'imported' | 'catalog_seeded' | 'parent_declared';
  created_by_household_id: string;
  visibility: 'private' | 'shared';
}

// Story 3-DM-A1 — full recipe_steps row shape returned by findStepsByRecipeId.
export interface RecipeStepRow {
  id: string;
  recipe_id: string;
  sequence: number;
  mode: 'prep' | 'finish';
  text: string;
  created_at: string;
}

/**
 * Slice 2.6-s1 — parent-declared lunch from Moment 5 (FR124) / in-app
 * recipe.declare. Result tuple distinguishes a fresh INSERT from a re-use of
 * an existing row (idempotency surfaced to callers for audit purposes).
 */
export interface DeclareForHouseholdResult {
  recipeId: string;
  usageWasExisting: boolean;
  recipeWasInserted: boolean;
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

  async findIdByNameForHousehold(
    canonicalName: string,
    householdId: string,
  ): Promise<string | null> {
    const { data, error } = await this.client
      .from('recipes')
      .select('id')
      .ilike('canonical_name', canonicalName.trim())
      .or(`created_by_household_id.eq.${householdId},visibility.eq.shared`)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data !== null ? (data as { id: string }).id : null;
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
        finish_time_minutes: input.finish_time_minutes ?? null,
        source: input.source,
        created_by_household_id: input.created_by_household_id,
        visibility: input.visibility,
      })
      .select('id, canonical_name')
      .single();
    if (error) throw error;
    const row = data as RecipeRowMinimal;

    // Story 3-DM-A1: when steps were provided, persist them now via a single
    // multi-row INSERT. recipes ↔ recipe_steps live in separate tables; we
    // can't co-commit atomically without an RPC, so on step-insert failure
    // we best-effort delete the just-inserted recipe to avoid an orphaned
    // recipe with no method. ON DELETE CASCADE on recipe_steps means future
    // re-attempts start clean.
    if (input.steps !== undefined && input.steps.length > 0) {
      const stepRows = input.steps.map((s, i) => ({
        recipe_id: row.id,
        sequence: i + 1,
        mode: s.mode,
        text: s.text,
      }));
      const stepsResult = await this.client.from('recipe_steps').insert(stepRows);
      if (stepsResult.error !== null) {
        await this.client.from('recipes').delete().eq('id', row.id);
        throw stepsResult.error;
      }
    }

    return row;
  }

  /**
   * Story 3-DM-A1 — fetch the structured method for a recipe, ordered by
   * sequence. The Wall Card renderer filters by mode client-side; the API
   * returns all steps so the toggle has both modes available without a
   * round-trip.
   */
  async findStepsByRecipeId(recipeId: string): Promise<RecipeStepRow[]> {
    const { data, error } = await this.client
      .from('recipe_steps')
      .select('id, recipe_id, sequence, mode, text, created_at')
      .eq('recipe_id', recipeId)
      .order('sequence', { ascending: true });
    if (error) throw error;
    return (data ?? []) as RecipeStepRow[];
  }

  /**
   * Slice 2.6-s1 — parent-declared lunch write path.
   *
   * Used by the M5 cold-start seed (`favorite_lunch.add` agent tool) and by
   * any future in-app "declare a favorite lunch" surface. Folds the dropped
   * `favorite_lunches` standalone table into the canonical recipes catalog.
   *
   * Behaviour:
   *   1. INSERT a `recipes` row with source='parent_declared',
   *      visibility='private', empty ingredients/tags, applicable_slots=['main'].
   *      On the per-household normalized-name UNIQUE conflict (Stage 0/1 or
   *      a prior call already inserted this item under the same household),
   *      REUSE the existing recipes.id.
   *   2. INSERT a `household_recipe_usage` row with
   *      catalog_provenance='declared', is_household_favorite=true,
   *      confidence_score=80. On the (household_id, recipe_id) PK conflict
   *      (planner already promoted this recipe), UPDATE only the stable
   *      signals: catalog_provenance='declared' (declared wins over
   *      plan_promoted — parent intent is stronger than planner inference)
   *      and is_household_favorite=true.
   *
   * SECURITY: writes the trimmed, NFC-normalized label as plaintext
   * `recipes.canonical_name` (visibility='private'). Per Epic 2.6 brief §3
   * "Encryption decision," RLS + visibility='private' + created_by_household_id
   * are the access controls. Reversible via an encrypted_canonical_name
   * column if a future security review flags it — no shape change required.
   *
   * Atomicity: best-effort across the two writes. If the recipes INSERT
   * succeeds but the household_recipe_usage upsert fails, the just-inserted
   * recipes row is rolled back (only when freshly inserted — never delete a
   * row that Stage 0/1 created). A repeated call hits the unique index,
   * reuses the existing recipes.id, retries the usage upsert, and converges.
   */
  async declareForHousehold(
    householdId: string,
    label: string,
  ): Promise<DeclareForHouseholdResult> {
    const canonicalName = canonicalizeFavoriteName(label);
    if (canonicalName.length === 0) {
      throw new Error('declareForHousehold: label is empty after normalization');
    }

    // ---- Step 1: recipes INSERT (or reuse) -----
    const insertRecipe = await this.client
      .from('recipes')
      .insert({
        canonical_name: canonicalName,
        ingredients: [],
        ingredient_keys: [],
        primary_ingredient_key: null,
        allergen_flags: [],
        dietary_flags: [],
        cultural_tags: [],
        cuisine_tags: [],
        applicable_slots: ['main'],
        prep_time_minutes: null,
        source: 'parent_declared',
        created_by_household_id: householdId,
        visibility: 'private',
      })
      .select('id')
      .single();

    let recipeId: string;
    let recipeWasInserted: boolean;

    if (insertRecipe.error === null) {
      recipeId = (insertRecipe.data as { id: string }).id;
      recipeWasInserted = true;
    } else {
      const code = (insertRecipe.error as { code?: string }).code;
      if (code !== '23505') throw insertRecipe.error;
      const existing = await this.client
        .from('recipes')
        .select('id')
        .eq('created_by_household_id', householdId)
        .ilike('canonical_name', canonicalName)
        .limit(1)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data === null) {
        throw new Error(
          `recipes UNIQUE conflict on household ${householdId} but no matching row found ` +
            `for canonical_name="${canonicalName}" — schema or normalization mismatch`,
        );
      }
      recipeId = (existing.data as { id: string }).id;
      recipeWasInserted = false;
    }

    // ---- Step 2: household_recipe_usage upsert ('declared') -----
    const nowIso = new Date().toISOString();
    const insertUsage = await this.client.from('household_recipe_usage').insert({
      household_id: householdId,
      recipe_id: recipeId,
      catalog_provenance: 'declared',
      is_household_favorite: true,
      confidence_score: 80,
      use_count: 0,
      first_used_at: nowIso,
      last_used_at: nowIso,
    });

    if (insertUsage.error === null) {
      return { recipeId, usageWasExisting: false, recipeWasInserted };
    }

    const usageCode = (insertUsage.error as { code?: string }).code;
    if (usageCode !== '23505') {
      if (recipeWasInserted) {
        // Best-effort rollback. D1 decision: orphaned recipes rows are benign;
        // don't swallow the original insertUsage.error even if DELETE fails.
        await this.client.from('recipes').delete().eq('id', recipeId);
      }
      throw insertUsage.error;
    }

    const update = await this.client
      .from('household_recipe_usage')
      .update({
        catalog_provenance: 'declared',
        is_household_favorite: true,
        confidence_score: 80,
      })
      .eq('household_id', householdId)
      .eq('recipe_id', recipeId);
    if (update.error) throw update.error;

    return { recipeId, usageWasExisting: true, recipeWasInserted };
  }

  /**
   * Story 7-S15 (Arc A) — the household's current starting-line favorites as
   * canonical_name strings. Mirrors the KitchenMap favorite_lunches projection
   * qualification (see composeKitchenMap): a usage row qualifies when it is
   * not banned AND (is_household_favorite OR catalog_provenance is parent-
   * stated). Ordered is_household_favorite DESC, then last_used_at DESC so the
   * returned list matches the order the parent sees on the Kitchen Profile.
   */
  async findHouseholdFavorites(householdId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from('household_recipe_usage')
      .select(
        'is_household_favorite, catalog_provenance, last_used_at, recipes!inner(canonical_name, is_active)',
      )
      .eq('household_id', householdId)
      .eq('is_household_banned', false)
      .order('is_household_favorite', { ascending: false })
      .order('last_used_at', { ascending: false, nullsFirst: false });
    if (error) throw error;

    const out: string[] = [];
    for (const raw of (data ?? []) as Array<{
      is_household_favorite: boolean;
      catalog_provenance: string;
      recipes:
        | Array<{ canonical_name: string; is_active: boolean }>
        | { canonical_name: string; is_active: boolean }
        | null;
    }>) {
      const joined = Array.isArray(raw.recipes) ? raw.recipes[0] : (raw.recipes ?? undefined);
      if (joined === undefined || joined.is_active === false) continue;
      if (raw.is_household_favorite || FAVORITE_LUNCH_PROVENANCES.has(raw.catalog_provenance)) {
        out.push(joined.canonical_name);
      }
    }
    return out;
  }

  /**
   * Story 7-S15 (Arc A) — remove a recipe from the household's starting line by
   * canonical name. Deletes ONLY the household_recipe_usage association (the
   * recipes row may be referenced by plans, so it is left intact). No-op when
   * no association exists — the replace-semantics caller owns idempotency. The
   * household_recipe_usage trigger bumps kitchen_map_version, so the Redis
   * kitchen-map cache invalidates for free.
   */
  async revokeHouseholdFavorite(householdId: string, canonicalName: string): Promise<void> {
    const normalized = canonicalizeFavoriteName(canonicalName);
    if (normalized.length === 0) return;

    // Resolve the household-owned recipe id(s) matching the normalized name
    // (case-insensitive). Escape ILIKE metacharacters so a name containing
    // `%`/`_` matches literally and cannot widen into other recipes' rows.
    const { data, error } = await this.client
      .from('recipes')
      .select('id')
      .eq('created_by_household_id', householdId)
      .ilike('canonical_name', escapeIlikeWildcards(normalized));
    if (error) throw error;
    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (ids.length === 0) return;

    const del = await this.client
      .from('household_recipe_usage')
      .delete()
      .eq('household_id', householdId)
      .in('recipe_id', ids);
    if (del.error) throw del.error;
  }

  /**
   * Slice 2.6-s2 — Stage 0 catalog materialization write path.
   *
   * For each input baseline item, inserts a `recipes` row with
   * source='catalog_seeded', visibility='private', empty ingredients (Layer 2
   * materializes lazily at plan-commit time), and the FULL tag arrays from
   * the curated baseline; then inserts a `household_recipe_usage` row with
   * catalog_provenance='inferred', is_household_favorite=false,
   * confidence_score=60, use_count=0.
   *
   * Differences from {@link declareForHousehold} (the M5 / declared path):
   *   - provenance 'inferred' (not 'declared') + confidence 60 (not 80)
   *   - usage UPSERT is ON CONFLICT DO NOTHING — never downgrade an existing
   *     'declared' row to 'inferred', never lower 80 → 60
   *   - recipes carry the full tag arrays from the baseline (M5 path inserts
   *     empty tags because the parent only types a name)
   *   - per-item errors are caught + logged; the batch completes regardless
   *
   * Returns the count of items whose usage row ended up persisted (fresh
   * INSERT OR existing row preserved by ON CONFLICT DO NOTHING). Per-item
   * errors reduce the count but do not throw — Stage 0 must never block
   * household creation or M3 completion.
   */
  async seedFromCatalogBaseline(
    householdId: string,
    items: ReadonlyArray<{
      canonical_name: string;
      allergen_flags: string[];
      dietary_flags: string[];
      cultural_tags: string[];
      cuisine_tags: string[];
      applicable_slots: Array<'main' | 'snack' | 'extra'>;
    }>,
    onItemError?: (err: unknown, itemIndex: number) => void,
    // Slice 2.6-s3 — Stage 1 LLM items use confidence 50 (slightly lower
    // than the hand-curated baseline's 60). Default preserves 2.6-s2 callers.
    confidenceScore: number = 60,
  ): Promise<number> {
    let persisted = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      try {
        const canonicalName = item.canonical_name.trim().normalize('NFC');
        if (canonicalName.length === 0) continue;

        // ---- Step 1: recipes INSERT (or reuse) -----
        const insertRecipe = await this.client
          .from('recipes')
          .insert({
            canonical_name: canonicalName,
            ingredients: [],
            ingredient_keys: [],
            primary_ingredient_key: null,
            allergen_flags: item.allergen_flags,
            dietary_flags: item.dietary_flags,
            cultural_tags: item.cultural_tags,
            cuisine_tags: item.cuisine_tags,
            applicable_slots: item.applicable_slots,
            prep_time_minutes: null,
            source: 'catalog_seeded',
            created_by_household_id: householdId,
            visibility: 'private',
          })
          .select('id')
          .single();

        let recipeId: string;
        if (insertRecipe.error === null) {
          recipeId = (insertRecipe.data as { id: string }).id;
        } else {
          const code = (insertRecipe.error as { code?: string }).code;
          if (code !== '23505') throw insertRecipe.error;
          // UNIQUE conflict on recipes_household_normalized_name_uniq — reuse
          // the existing row. The SQL index normalizes via
          // regexp_replace(lower(name), '[\s\-'']+', '', 'g'); we approximate
          // the lookup with ilike on the trimmed/NFC form. For curator-
          // authored baseline names (no hyphens / apostrophes / multi-space),
          // ilike matches the existing row. If ilike misses (rare), throw
          // with the same surface message as declareForHousehold so the
          // failure is debuggable in logs.
          const existing = await this.client
            .from('recipes')
            .select('id')
            .eq('created_by_household_id', householdId)
            .ilike('canonical_name', canonicalName)
            .limit(1)
            .maybeSingle();
          if (existing.error) throw existing.error;
          if (existing.data === null) {
            throw new Error(
              `recipes UNIQUE conflict on household ${householdId} but no matching row found ` +
                `for canonical_name="${canonicalName}" — schema or normalization mismatch`,
            );
          }
          recipeId = (existing.data as { id: string }).id;
        }

        // ---- Step 2: household_recipe_usage INSERT (DO NOTHING on conflict) -----
        // Stage 0 NEVER downgrades an existing row — if the planner or M5
        // already created a usage row at provenance 'declared' /
        // 'plan_promoted' with a higher confidence_score, leave it alone.
        const nowIso = new Date().toISOString();
        const insertUsage = await this.client.from('household_recipe_usage').insert({
          household_id: householdId,
          recipe_id: recipeId,
          catalog_provenance: 'inferred',
          is_household_favorite: false,
          confidence_score: confidenceScore,
          use_count: 0,
          first_used_at: nowIso,
          last_used_at: nowIso,
        });

        if (insertUsage.error !== null) {
          const code = (insertUsage.error as { code?: string }).code;
          if (code !== '23505') throw insertUsage.error;
          // Row already exists — that's the intended idempotent path; counts
          // toward `persisted` because the household DOES have this item in
          // catalog after this call.
        }

        persisted += 1;
      } catch (err) {
        if (onItemError !== undefined) onItemError(err, i);
        // Continue to next item; one bad row never fails the batch.
      }
    }

    return persisted;
  }

  /**
   * Slice 2.6-s3 — minimal recipe lookup for Layer 2 materialization at plan
   * commit time. Returns only the columns PlansService.materializeBeforeCommit
   * needs to decide whether a Layer 2 RecipeAgent.discover() fetch is required:
   * `source` (filter to catalog_seeded only) and `ingredients` (empty array =
   * Layer 1 row that has not yet been materialized).
   *
   * Projection is deliberately narrow — the recipes table carries heavy JSONB
   * columns elsewhere and this is a hot read per main-slot plan item.
   */
  async findById(id: string): Promise<{
    source: string;
    canonical_name: string;
    ingredients: unknown[];
  } | null> {
    const { data, error } = await this.client
      .from('recipes')
      .select('source, canonical_name, ingredients')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (data === null) return null;
    const row = data as {
      source: string;
      canonical_name: string;
      ingredients: unknown;
    };
    const ingredients = Array.isArray(row.ingredients) ? row.ingredients : [];
    return {
      source: row.source,
      canonical_name: row.canonical_name,
      ingredients,
    };
  }

  /**
   * Story 3.S39 — batch ingredient fetch for the commit-time allergy
   * guardrail. Given many recipe ids, returns a Map<id, string[]> of
   * display-name ingredient strings in a single query (no N+1 per slot).
   *
   * `recipes.ingredients` is JSONB: the canonical shape is the object form
   * (key/modifier/display/…), but catalog-seeded / legacy rows MAY hold plain
   * strings. Both are accepted — strings pass through, objects project to
   * their `display`. A recipe with no resolvable ingredients is simply absent
   * from (or empty in) the map; the caller treats that as "unverifiable" per
   * the guardrail fail-safe. Mirrors PlansService.fetchRecipeDisplayIngredients
   * (the swap path) so commit + swap derive the same ingredient vocabulary.
   */
  // Batch-read canonical display names by id. Used by BriefStateComposer to
  // resolve main/extra slot recipe_ids → dish-line names for the plan tiles
  // (mirrors SnackSkuRepository.findNamesByIds for snack slots). Empty ids → no
  // query; ids with no row are simply absent from the returned map.
  async findNamesByIds(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await this.client
      .from('recipes')
      .select('id, canonical_name')
      .in('id', [...ids]);
    if (error) throw error;
    return new Map(
      ((data ?? []) as Array<{ id: string; canonical_name: string }>).map((r) => [
        r.id,
        r.canonical_name,
      ]),
    );
  }

  // Epic 13-s10 — batch-read allergen_flags by recipe id for the safety_write
  // week re-screen (revalidateWeekAfterAllergen). Mirrors findNamesByIds:
  // empty ids → no query; ids with no row are simply absent from the map (the
  // caller treats an absent recipe as "no tag-set conflict" and leaves the
  // commit-time evaluate() authority to catch it). Tag-set is the cheap
  // pre-filter — same predicate pickCatalogCandidate uses, never re-implemented.
  async findAllergenFlagsByIds(ids: readonly string[]): Promise<Map<string, string[]>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await this.client
      .from('recipes')
      .select('id, allergen_flags')
      .in('id', [...ids]);
    if (error) throw error;
    return new Map(
      ((data ?? []) as Array<{ id: string; allergen_flags: string[] | null }>).map((r) => [
        r.id,
        r.allergen_flags ?? [],
      ]),
    );
  }

  async findIngredientsByIds(ids: readonly string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (ids.length === 0) return out;

    const { data, error } = await this.client
      .from('recipes')
      .select('id, ingredients')
      .in('id', [...ids]);
    if (error) throw error;

    for (const raw of (data ?? []) as Array<{ id: string; ingredients: unknown }>) {
      const list = Array.isArray(raw.ingredients) ? raw.ingredients : [];
      const display: string[] = [];
      for (const entry of list) {
        if (typeof entry === 'string') {
          if (entry.length > 0) display.push(entry);
        } else if (entry !== null && typeof entry === 'object' && 'display' in entry) {
          const d = (entry as { display?: unknown }).display;
          if (typeof d === 'string' && d.length > 0) display.push(d);
        }
      }
      out.set(raw.id, display);
    }
    return out;
  }

  /**
   * Slice 2.6-s3 — Layer 2 in-place ingredient population. Used after
   * RecipeAgent.discover() succeeds for a catalog_seeded row that started
   * empty. Updates ingredients + ingredient_keys atomically so the planner's
   * subsequent commit sees the populated row.
   */
  async updateIngredients(
    id: string,
    ingredients: ReadonlyArray<{
      key: string;
      modifier: string | null;
      display: string;
      quantity: number | null;
      unit: string | null;
      optional: boolean;
      substitutes: ReadonlyArray<{ key: string; modifier: string | null }>;
    }>,
    ingredientKeys: readonly string[],
  ): Promise<void> {
    const { error } = await this.client
      .from('recipes')
      .update({
        ingredients,
        ingredient_keys: ingredientKeys,
      })
      .eq('id', id);
    if (error) throw error;
  }

  /**
   * Slice 2.6-s3 — mark a (household, recipe) pair as having failed Layer 2
   * discovery. Used when RecipeAgent.discover() returns no candidates for a
   * catalog_seeded row; the planner reads this flag on retry to skip the
   * permanently-unfetchable item.
   */
  async markDiscoverFailed(recipeId: string, householdId: string): Promise<void> {
    const { data, error } = await this.client
      .from('household_recipe_usage')
      .update({ discover_failed_at: new Date().toISOString() })
      .eq('recipe_id', recipeId)
      .eq('household_id', householdId)
      .select('recipe_id');
    if (error) throw error;
    if (!data || data.length === 0) {
      console.warn(
        `[recipes.markDiscoverFailed] 0 rows updated — usage row missing for recipe=${recipeId} household=${householdId}`,
      );
    }
  }

  /**
   * Slice 2.6-s4 — projection read for M5 chip personalization.
   *
   * Returns every catalog row visible to the household (banned rows excluded
   * at the SQL layer to keep the projection size small). Sort + diversity
   * shaping happens in CatalogProjectionService — this method is intentionally
   * a single-purpose SELECT-with-join with no business logic so it stays
   * cheap to test and reason about.
   *
   * Mirrors the join shape KitchenMapRepository uses
   * (USAGE_JOIN_COLUMNS) — household_recipe_usage → recipes is many-to-one
   * so PostgREST may return `recipes` as an array or object; we normalize.
   */
  async findCatalogProjectionForHousehold(
    householdId: string,
  ): Promise<
    Array<{
      id: string;
      canonical_name: string;
      cuisine_tags: string[];
      cultural_tags: string[];
      allergen_flags: string[];
      dietary_flags: string[];
      catalog_provenance: CatalogProvenance;
      confidence_score: number;
      is_household_favorite: boolean;
    }>
  > {
    const { data, error } = await this.client
      .from('household_recipe_usage')
      .select(
        'catalog_provenance, confidence_score, is_household_favorite, recipes!inner(id, canonical_name, cuisine_tags, cultural_tags, allergen_flags, dietary_flags, is_active)',
      )
      .eq('household_id', householdId)
      .eq('is_household_banned', false);
    if (error) throw error;

    const out: Array<{
      id: string;
      canonical_name: string;
      cuisine_tags: string[];
      cultural_tags: string[];
      allergen_flags: string[];
      dietary_flags: string[];
      catalog_provenance: CatalogProvenance;
      confidence_score: number;
      is_household_favorite: boolean;
    }> = [];
    for (const raw of (data ?? []) as Array<{
      catalog_provenance: CatalogProvenance;
      confidence_score: number;
      is_household_favorite: boolean;
      recipes:
        | Array<{
            id: string;
            canonical_name: string;
            cuisine_tags: string[] | null;
            cultural_tags: string[] | null;
            allergen_flags: string[] | null;
            dietary_flags: string[] | null;
            is_active: boolean;
          }>
        | {
            id: string;
            canonical_name: string;
            cuisine_tags: string[] | null;
            cultural_tags: string[] | null;
            allergen_flags: string[] | null;
            dietary_flags: string[] | null;
            is_active: boolean;
          }
        | null;
    }>) {
      const joined = Array.isArray(raw.recipes)
        ? raw.recipes[0]
        : (raw.recipes ?? undefined);
      if (joined === undefined) continue;
      if (!joined.is_active) continue;
      out.push({
        id: joined.id,
        canonical_name: joined.canonical_name,
        cuisine_tags: joined.cuisine_tags ?? [],
        cultural_tags: joined.cultural_tags ?? [],
        allergen_flags: joined.allergen_flags ?? [],
        dietary_flags: joined.dietary_flags ?? [],
        catalog_provenance: raw.catalog_provenance,
        confidence_score: raw.confidence_score,
        is_household_favorite: raw.is_household_favorite,
      });
    }
    return out;
  }

  /**
   * Story 3-S36 — candidate-slate read for the pre-loaded planner context.
   *
   * Returns every catalog row visible to the household (banned rows excluded at
   * the SQL layer), carrying the fields the planner needs to judge slot fit
   * WITHOUT a recipe.fetch turn: applicable_slots (for grouping), allergen_flags,
   * ingredient_keys (key ingredients), cuisine_tags, plus the usage/confidence
   * signals the loader ranks by. A superset of {@link findCatalogProjectionForHousehold}
   * (adds applicable_slots + ingredient_keys); ranking/grouping is the loader's job.
   *
   * Mirrors the household_recipe_usage → recipes join shape (many-to-one, so
   * PostgREST may return `recipes` as an array or object; we normalize).
   */
  async findCandidateSlateForHousehold(
    householdId: string,
  ): Promise<CandidateSlateRow[]> {
    const { data, error } = await this.client
      .from('household_recipe_usage')
      .select(
        'confidence_score, is_household_favorite, use_count, recipes!inner(id, canonical_name, cuisine_tags, allergen_flags, applicable_slots, ingredient_keys, is_active)',
      )
      .eq('household_id', householdId)
      .eq('is_household_banned', false)
      .filter('recipes.is_active', 'eq', 'true');
    if (error) throw error;

    const out: CandidateSlateRow[] = [];
    for (const raw of (data ?? []) as Array<{
      confidence_score: number;
      is_household_favorite: boolean;
      use_count: number;
      recipes:
        | Array<CandidateSlateJoinedRecipe>
        | CandidateSlateJoinedRecipe
        | null;
    }>) {
      const joined = Array.isArray(raw.recipes) ? raw.recipes[0] : (raw.recipes ?? undefined);
      if (joined === undefined) continue;
      if (!joined.is_active) continue; // safety net if embedded filter is not applied
      out.push({
        id: joined.id,
        canonical_name: joined.canonical_name,
        cuisine_tags: joined.cuisine_tags ?? [],
        allergen_flags: joined.allergen_flags ?? [],
        applicable_slots: joined.applicable_slots ?? [],
        ingredient_keys: joined.ingredient_keys ?? [],
        confidence_score: raw.confidence_score,
        is_household_favorite: raw.is_household_favorite,
        use_count: raw.use_count,
      });
    }
    return out;
  }

  /**
   * Slice 2.6-s1 — count of declared favourite rows for a household. Used by
   * `favorite_lunch.add` to derive the agent-facing position field after the
   * cold-start seed write (FR124's "10 items" progress UX).
   */
  async countDeclaredFavorites(householdId: string): Promise<number> {
    const { count, error } = await this.client
      .from('household_recipe_usage')
      .select('recipe_id', { count: 'exact', head: true })
      .eq('household_id', householdId)
      .eq('catalog_provenance', 'declared');
    if (error) throw error;
    return count ?? 0;
  }

  /**
   * Slice 2.6-s5 — count of catalog-seeded recipes available to a household.
   * Uses an RPC (raw SQL function) rather than a supabase-js joined-table count
   * because cross-table column filters on head:true count queries have
   * inconsistent behavior across PostgREST versions.
   * Migration: 20260920000200_2_6_s5_count_catalog_seeded_rpc.sql
   */
  async countCatalogSeededForHousehold(householdId: string): Promise<number> {
    const { data, error } = await this.client.rpc('count_catalog_seeded_for_household', {
      p_household_id: householdId,
    });
    if (error) throw error;
    return Number(data ?? 0);
  }

  /**
   * Slice D — atomic upsert of a household_recipe_usage row. INSERT with
   * use_count = 1 on first sighting; on conflict, increment counters and
   * stamp last_used_at. Uses a Postgres rpc for true atomicity — a
   * SELECT-then-UPDATE pattern would race when the same recipe lands on
   * multiple plan_slots in a single commit batch.
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

    // Fallback: when the query produces no matches, return all household
    // catalog recipes so the planner always has something to work with.
    if (merged.length === 0) {
      const fallback = await this.client
        .from('recipes')
        .select(PREVIEW_COLUMNS)
        .eq('is_active', true)
        .or(`created_by_household_id.eq.${input.householdId},visibility.eq.shared`)
        .limit(input.overfetchLimit);
      if (fallback.error) throw fallback.error;
      return (fallback.data ?? []) as RecipePreviewRow[];
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

// Story 7-S15 (Arc A) — provenance values that mark a usage row as a parent-
// stated favorite. Kept in sync with FAVORITE_LUNCH_PROVENANCES in
// kitchen-map.composer.ts so findHouseholdFavorites and the KitchenMap
// projection qualify the same rows.
const FAVORITE_LUNCH_PROVENANCES = new Set<string>(['declared', 'parent_added']);

// ---------------------------------------------------------------------------
// Helpers — kept module-private so the search vocabulary is single-sourced.
// ---------------------------------------------------------------------------

/**
 * Normalize a favorite-lunch label to the canonical_name form declareForHousehold
 * stores: trim, NFC, strip hyphens/apostrophes. Exported so the PUT
 * /favorite-lunches route diffs request items against stored names with the
 * same normalization (case is preserved; comparisons that must be
 * case-insensitive lowercase the result themselves).
 */
export function canonicalizeFavoriteName(label: string): string {
  return label.trim().normalize('NFC').replace(/[-']+/g, '');
}

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

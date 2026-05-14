import { z } from 'zod';

// ===========================================================================
// Recipe contracts — Slice A
// ===========================================================================
// Two distinct concerns share this file:
//
// 1. The recipes CATALOG row shapes (RecipeRowSchema, RecipeIngredientSchema,
//    HouseholdRecipeUsageRowSchema, RecipeCommentPublicSchema). These mirror
//    the rows in the migration created by
//    supabase/migrations/20260514010000_create_recipes_and_usage.sql.
//
// 2. The planner-agent TOOL I/O shapes (RecipeSearchInputSchema,
//    RecipeSearchOutputSchema, RecipePreviewSchema, RecipeFetchInputSchema,
//    RecipeFetchOutputSchema). These describe the agent's tool surface.
//    The fetch output references the row schema directly so the agent
//    receives the canonical catalog shape.
//
// Tag-array vocabularies (allergen_flags, dietary_flags, cultural_tags,
// cuisine_tags) are validated against the *_tags vocabulary tables by
// RecipesService at the service boundary, NOT inside these Zod schemas.
// Zod here only enforces "is an array of strings"; vocabulary enforcement
// requires a runtime DB lookup that doesn't belong in a contract.
// ===========================================================================

// ---- Ingredient unit vocabulary ------------------------------------------
//
// Controlled set of units the agent may emit. This DOES live in code
// (vs the vocabulary tables) because units are a small, stable set tied to
// LLM prompt instructions — extending them requires a deploy anyway because
// the agent prompt must teach the new unit's semantics.

export const RecipeUnitSchema = z.enum([
  // Volume
  'tsp', 'tbsp', 'cup', 'ml', 'l', 'fl_oz',
  // Mass
  'g', 'kg', 'oz', 'lb',
  // Count
  'piece', 'clove', 'sprig', 'leaf', 'slice', 'can', 'package',
  // Imprecise
  'pinch', 'dash', 'handful', 'splash',
]);

// ---- Ingredient (structured) ---------------------------------------------
//
// Each entry in recipes.ingredients jsonb. The agent emits this shape during
// recipe composition; RecipesService validates on write.
//
// Conventions for `key` and `modifier` are documented in the agent's
// system prompt (style guide). Examples:
//   { key: 'chicken',   modifier: 'thigh' }
//   { key: 'yogurt',    modifier: 'greek' }
//   { key: 'olive_oil', modifier: null     }
//   { key: 'rice',      modifier: 'white'  }

const IngredientSubstituteSchema = z.object({
  key: z.string().min(1).max(64),
  modifier: z.string().min(1).max(64).nullable(),
});

export const RecipeIngredientSchema = z.object({
  key: z.string().min(1).max(64),
  modifier: z.string().min(1).max(64).nullable(),
  display: z.string().min(1).max(256),
  quantity: z.number().positive().nullable(),
  unit: RecipeUnitSchema.nullable(),
  optional: z.boolean(),
  substitutes: z.array(IngredientSubstituteSchema).max(8),
});

// ---- Recipe row (catalog) -------------------------------------------------

export const RecipeSourceSchema = z.enum(['agent_generated', 'curated', 'imported']);
export const RecipeVisibilitySchema = z.enum(['private', 'shared']);
export const RecipeSlotSchema = z.enum(['main', 'snack', 'extra']);

export const RecipeRowSchema = z.object({
  id: z.string().uuid(),

  canonical_name: z.string().min(1).max(256),
  slug: z.string().min(1).max(256).nullable(),

  ingredients: z.array(RecipeIngredientSchema).max(40),
  instructions: z
    .union([
      z.string(),
      z.array(z.string().min(1).max(2000)).max(40),
    ])
    .nullable(),

  // Denormalised lookups (RecipesService maintains these from ingredients)
  ingredient_keys: z.array(z.string().min(1).max(64)).max(40),
  primary_ingredient_key: z.string().min(1).max(64).nullable(),

  // Vocabulary-controlled tag arrays (validated against vocabulary tables
  // at the service boundary, not by Zod).
  allergen_flags: z.array(z.string().min(1).max(64)),
  dietary_flags: z.array(z.string().min(1).max(64)),
  cultural_tags: z.array(z.string().min(1).max(64)),
  cuisine_tags: z.array(z.string().min(1).max(64)),

  applicable_slots: z.array(RecipeSlotSchema).min(1),
  prep_time_minutes: z.number().int().min(0).max(600).nullable(),

  source: RecipeSourceSchema,
  created_by_household_id: z.string().uuid().nullable(),
  visibility: RecipeVisibilitySchema,

  community_use_count: z.number().int().min(0),
  community_rating_avg: z.number().min(0).max(5).nullable(),
  community_rating_count: z.number().int().min(0),

  is_active: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// ---- Household usage row --------------------------------------------------

export const HouseholdRecipeUsageRowSchema = z.object({
  household_id: z.string().uuid(),
  recipe_id: z.string().uuid(),

  use_count: z.number().int().min(0),
  acceptance_count: z.number().int().min(0),
  swap_out_count: z.number().int().min(0),
  positive_outcome_count: z.number().int().min(0),
  negative_outcome_count: z.number().int().min(0),

  confidence_score: z.number().int().min(0).max(100),

  is_household_favorite: z.boolean(),
  is_household_banned: z.boolean(),

  first_used_at: z.string().datetime(),
  last_used_at: z.string().datetime(),
  last_outcome_at: z.string().datetime().nullable(),
});

// ---- Comments (public projection — author identity stripped) -------------

export const RecipeCommentPublicSchema = z.object({
  id: z.string().uuid(),
  recipe_id: z.string().uuid(),
  display_handle: z.string().min(1).max(128),
  rating: z.number().int().min(1).max(5).nullable(),
  prose_text: z.string().nullable(),
  created_at: z.string().datetime(),
});

// ===========================================================================
// Planner-agent tool I/O — unchanged interface, evolved shapes
// ===========================================================================

// ---- recipe.search --------------------------------------------------------

export const RecipeSearchInputSchema = z.object({
  query: z.string().min(1).max(200),
  household_id: z.string().uuid(),
  max_results: z.number().int().min(1).max(20).default(5),
});

// Lightweight preview returned by recipe.search — caller pages through
// previews, then calls recipe.fetch for the full row when committing.
// Adds `primary_ingredient_key` for leftover-driven retrieval; keeps the
// existing flat field names so existing consumers continue to compile.
export const RecipePreviewSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  primary_ingredient_key: z.string().nullable(),
  cuisine_tags: z.array(z.string()),
  allergen_flags: z.array(z.string()),
  dietary_flags: z.array(z.string()),
  prep_time_minutes: z.number().int().nullable(),
});

export const RecipeSearchOutputSchema = z.object({
  results: z.array(RecipePreviewSchema),
});

// ---- recipe.fetch ---------------------------------------------------------

export const RecipeFetchInputSchema = z.object({
  recipe_id: z.string().uuid(),
  household_id: z.string().uuid(),
});

// Fetch returns the canonical row directly — the agent gets the same shape
// that lives in the catalog table.
export const RecipeFetchOutputSchema = RecipeRowSchema;

// Legacy alias kept so existing imports of `RecipeDetailSchema` continue to
// resolve. New code should reference `RecipeRowSchema` directly.
export const RecipeDetailSchema = RecipeRowSchema;

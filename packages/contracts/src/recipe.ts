import { z } from 'zod';

// ===========================================================================
// Recipe contracts — Slice A
// ===========================================================================
// Two distinct concerns share this file:
//
// 1. The recipes CATALOG row shapes (RecipeRowSchema, RecipeIngredientSchema).
//    These mirror the rows in the migration created by
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

// Slice 2.6-s1 — extended with two values to fold the M5 catalog into recipes:
//   'catalog_seeded'   — Stage 0/1 catalog rows (curated baseline + LLM-
//                        inferred Layer 1; rows whose ingredients=[] until
//                        Layer 2 materialization).
//   'parent_declared'  — parent-stated lunch name from Moment 5 / FR124
//                        (replaces the dropped favorite_lunches table).
export const RecipeSourceSchema = z.enum([
  'agent_generated',
  'curated',
  'imported',
  'catalog_seeded',
  'parent_declared',
]);
export const RecipeVisibilitySchema = z.enum(['private', 'shared']);
export const RecipeSlotSchema = z.enum(['main', 'snack', 'extra']);

export const RecipeRowSchema = z.object({
  id: z.string().uuid(),

  canonical_name: z.string().min(1).max(256),
  slug: z.string().min(1).max(256).nullable(),

  ingredients: z.array(RecipeIngredientSchema).max(40),

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
  // Story 3-DM-A1: morning-of (finish) time, read alongside prep_time_minutes
  // to compute the dual-budget total. NULL until next recipe-agent fetch.
  finish_time_minutes: z.number().int().min(0).max(600).nullable(),

  source: RecipeSourceSchema,
  created_by_household_id: z.string().uuid().nullable(),
  visibility: RecipeVisibilitySchema,

  community_use_count: z.number().int().min(0),
  community_rating_avg: z.number().min(0).max(5).nullable(),
  community_rating_count: z.number().int().min(0),

  is_active: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

// ---- Step mode -------------------------------------------------------------
//
// Story 3-DM-A1 — mode classifies a method step as part of the make-ahead
// (prep) or morning-of (finish) phase; the Wall Card's mode toggle filters
// by this tag. Used by RecipeAgentExtractionSchema's steps array below.

export const StepModeSchema = z.enum(['prep', 'finish']);

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

// ===========================================================================
// Story 3-31 — RecipeAgent extraction + discover tool I/O
// ===========================================================================
// The RecipeAgent extracts structured recipe data from a Tavily-fetched
// webpage. The extraction shape conforms to the existing catalog schema:
// `ingredients` uses RecipeIngredientSchema (key/modifier/display/quantity/
// unit/optional/substitutes) — NOT a new shape. The four controlled tag
// arrays (cuisine/cultural/dietary/allergen) are Zod-validated only as
// "array of strings" here; the service layer drops unknown vocabulary
// values via the *_tags table lookup. RecipeService.discover writes each
// validated extraction to Redis under a synthetic candidate id; plan
// commit resolves the candidate id and inserts a real recipes row.
// ===========================================================================

export const RecipeAgentExtractionSchema = z.object({
  name: z.string().min(1).max(256),
  source_url: z.string().url(),
  source_site: z.enum(['allrecipes', 'recipetineats']),

  // Tag arrays — vocabulary enforcement happens in the service layer's
  // post-pass against the *_tags tables, not here. Empty arrays are valid
  // (the agent emits empty when no value matches the controlled list).
  cuisine_tags: z.array(z.string().min(1).max(64)).max(20),
  cultural_tags: z.array(z.string().min(1).max(64)).max(20),
  dietary_flags: z.array(z.string().min(1).max(64)).max(20),
  allergen_flags: z.array(z.string().min(1).max(64)).max(20),

  prep_time_minutes: z.number().int().positive().max(600).nullable(),
  // Story 3-DM-A1: morning-of cook time. Optional on the extraction (some
  // recipes are pure prep or pure finish). Service layer fills NULL when
  // the LLM omits.
  finish_time_minutes: z.number().int().min(0).max(600).nullable().optional(),

  // Ingredients use the SAME shape as the catalog row. The agent prompt
  // enforces head-noun discipline (key = base food, modifier = variant).
  ingredients: z.array(RecipeIngredientSchema).min(1).max(40),

  // Story 3-DM-A1 — structured steps with mode tags. Replaces the legacy
  // flat `instructions` array. The agent emits each step tagged 'prep'
  // (make-ahead) or 'finish' (morning-of); when the mode tag is missing,
  // we default to 'prep' (the conservative choice — surfaces in both Wall
  // Card filters today but lets future planner logic catch the omission).
  steps: z
    .array(
      z.object({
        mode: StepModeSchema.default('prep'),
        text: z.string().min(1).max(600),
      }),
    )
    .min(1)
    .max(40),

  // Verbatim allergen warning printed on the source page (e.g. "Contains:
  // wheat, soy"). Never inferred. Null when no such text appears.
  allergen_info_from_source: z.string().max(500).nullable(),
});

export type RecipeAgentExtraction = z.infer<typeof RecipeAgentExtractionSchema>;

// ---- recipe.discover tool I/O --------------------------------------------
//
// Deterministic structured input — no opaque prompts. The planner agent
// fills these fields from the household profile already in its context
// (kitchen-map injection). RecipeAgent does not re-fetch the profile.

export const RecipeDiscoverConstraintsSchema = z.object({
  cuisine_tags: z.array(z.string().min(1).max(64)).max(20),
  cultural_tags: z.array(z.string().min(1).max(64)).max(20),
  dietary_flags: z.array(z.string().min(1).max(64)).max(20),
  allergen_exclusions: z.array(z.string().min(1).max(64)).max(20),
  max_prep_minutes: z.number().int().positive().max(600).nullable(),
});

export const RecipeDiscoverInputSchema = z.object({
  household_id: z.string().uuid(),
  // The planner's run-level requestId. Used as cache namespace + audit
  // correlation key. Same ID for every discover call within one planWeek.
  plan_build_id: z.string().min(1).max(128),
  slot: RecipeSlotSchema,
  count: z.number().int().min(1).max(10),
  intent: z.string().min(1).max(200),
  constraints: RecipeDiscoverConstraintsSchema,
});

// Discover returns the SAME shape as recipe.search so the planner agent
// treats previews uniformly regardless of which surface produced them.
// The `id` of a discover preview is a synthetic candidate UUID; the full
// extraction lives in Redis at lumi:plan-build:{plan_build_id}:recipe-
// candidate:{candidate_id} until plan commit resolves it.
export const RecipeDiscoverOutputSchema = RecipeSearchOutputSchema;

export type RecipeDiscoverInput = z.infer<typeof RecipeDiscoverInputSchema>;
export type RecipeDiscoverOutput = z.infer<typeof RecipeDiscoverOutputSchema>;
export type RecipeDiscoverConstraints = z.infer<typeof RecipeDiscoverConstraintsSchema>;

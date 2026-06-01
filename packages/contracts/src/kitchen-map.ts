import { z } from 'zod';
import { AgeBandSchema, BagCompositionSchema } from './children.js';
import { EnforcementLevelSchema } from './enforcement.js';

// ===========================================================================
// Kitchen Map — Slice A (extended by Epic 2.5)
// ===========================================================================
// The Kitchen Map is a household-state PROJECTION composed in application
// code (apps/api/src/modules/kitchen-map/) and cached in Redis under a
// key parameterised by household_id + households.kitchen_map_version
// (migration 20260514000000). Triggers on satellite tables bump the
// version atomically with each write, so the next read computes a new
// cache key.
//
// The shape here is what every agent receives as static context. It
// replaces multiple per-turn tool calls (memory.recall, cultural.lookup,
// child reads, etc.) with one prompt-cached block at the top of the
// system message. Same map serves Onboarding, Planner, Swap Agent, and
// ambient Lumi.
//
// PII note: child names + caregiver display names are present here.
// Callers that don't need PII (ops dashboards, anonymous-comment surfaces)
// must use a redacted projection. The map itself is privileged.
// ===========================================================================

// ---- Household ------------------------------------------------------------

export const KitchenMapHouseholdSchema = z.object({
  id: z.string().uuid(),
  // households.tier (billing) — 'standard' | 'premium' today.
  tier: z.string().min(1),
  // households.tier_variant (Epic 10 A/B cohort tag).
  tier_variant: z.string().min(1),
  timezone: z.string().min(1),
  // Slice 2.5-s1 — parent-chosen household label. Nullable because
  // mid-onboarding households haven't been through Moment 1 yet. Existing
  // pre-Epic-2.5 households get a deterministic placeholder backfill so
  // production reads should never see null after the migration runs.
  display_name: z.string().min(1).max(120).nullable(),
  // Slice 2-s27 — household-level food identity. Cultural / dietary live
  // here (moved up from per-child). declared_allergens carries household-
  // wide allergen rules (religious "no pork", etc.); per-child medical
  // allergens remain on KitchenMapChildSchema.declared_allergens.
  cultural_identifiers: z.array(z.string().min(1).max(64)),
  dietary_preferences: z.array(z.string().min(1).max(64)),
  declared_allergens: z.array(z.string().min(1).max(64)),
});

// ---- Caregivers -----------------------------------------------------------

export const KitchenMapCaregiverRoleSchema = z.enum([
  'primary_parent',
  'secondary_caregiver',
]);

export const KitchenMapCaregiverSchema = z.object({
  user_id: z.string().uuid(),
  role: KitchenMapCaregiverRoleSchema,
  display_name: z.string().min(1).max(128),
  cultural_language: z.string().min(1).max(64).nullable(),
});

// ---- Children -------------------------------------------------------------

// Story 3-DM-B1 — BagCompositionPatternSchema moved to children.ts (canonical
// column home). Re-export from this module so existing imports continue to work.
import { BagCompositionPatternSchema } from './children.js';
export { BagCompositionPatternSchema };
export type BagCompositionPattern = z.infer<typeof BagCompositionPatternSchema>;

// Re-uses AgeBandSchema + BagCompositionSchema from children.ts to avoid
// drift between the source contract and the projection.
export const KitchenMapChildSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  age_band: AgeBandSchema,
  declared_allergens: z.array(z.string().min(1).max(64)),
  cultural_identifiers: z.array(z.string().min(1).max(64)),
  dietary_preferences: z.array(z.string().min(1).max(64)),
  bag_composition: BagCompositionSchema,
  bag_composition_pattern: BagCompositionPatternSchema.nullable(),
  school_policies: z.array(z.string()),
  extra_rules: z.object({
    pinned: z.array(z.string()),
    banned: z.array(z.string()),
  }),
});

// ---- Cultural priors (projected from cultural_priors table) --------------

// State enum mirrors the cultural_priors.state CHECK constraint exactly.
export const KitchenMapCulturalPriorStateSchema = z.enum([
  'detected',
  'suggested',
  'opt_in_confirmed',
  'active',
  'dormant',
  'forgotten',
]);

export const KitchenMapCulturalPriorSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  state: KitchenMapCulturalPriorStateSchema,
  tier: z.enum(['L1', 'L2', 'L3']),
  confidence: z.number().int().min(0).max(100),
  presence: z.number().int().min(0).max(100),
  // Slice 2.5-s1 — enforcement strength from cultural_priors.enforcement.
  // Existing rows default to 'just_for_context' which matches today's
  // shipped advisory-only behaviour.
  enforcement: EnforcementLevelSchema,
});

export const KitchenMapCulturalSchema = z.object({
  // Ratified priors that the planner treats as authoritative.
  active: z.array(KitchenMapCulturalPriorSchema),
  // Inferred but not yet ratified — surface for ratification, but planner
  // treats as a soft hint, not a hard constraint.
  suggested: z.array(KitchenMapCulturalPriorSchema),
});

// ---- Memory (projected from memory_nodes table) --------------------------

// Mirrors memory_nodes.node_type enum, narrowed in slice 2.5-s2. The four
// removed types ('preference', 'cultural_rhythm', 'allergy', 'school_policy')
// were backfilled into the structured signal tables (child_allergens,
// dietary_preferences, cultural_priors) and soft-forgotten by migrations
// 20260904000100 + 20260904000300.
export const KitchenMapMemoryNodeTypeSchema = z.enum([
  'rhythm',
  'child_obsession',
  'other',
]);

export const KitchenMapMemoryNodeSchema = z.object({
  node_type: KitchenMapMemoryNodeTypeSchema,
  facet: z.string().min(1),
  prose_text: z.string().min(1),
  // child-scoped memory; null = household-wide
  subject_child_id: z.string().uuid().nullable(),
});

export const KitchenMapMemorySchema = z.object({
  nodes: z.array(KitchenMapMemoryNodeSchema),
});

// ---- Household extras library --------------------------------------------

export const KitchenMapExtraLibraryItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(128),
  component_type: z.string().min(1).max(64),
});

export const KitchenMapHouseholdExtrasSchema = z.object({
  library: z.array(KitchenMapExtraLibraryItemSchema),
});

// ---- Catalog provenance enum (slice 2.6-s1) ------------------------------
//
// How a household_recipe_usage row entered the catalog. Replaces the
// 2.5-s9 favorite_lunches.provenance enum after the folding migration.
//   'declared'      — parent stated it in onboarding (Moment 5 / FR124)
//                     OR in-app via recipe.declare. Was 'onboarding_seed'.
//   'inferred'      — Stage 1 LLM seeding from household profile (slice 2.6-s3).
//                     Layer 1 only (name + tags, no ingredients yet).
//   'parent_added'  — parent added it in-app after onboarding (Epic 7+).
//   'plan_promoted' — surfaced by the planner; default for backfill of
//                     existing household_recipe_usage rows.

export const CatalogProvenanceSchema = z.enum([
  'declared',
  'inferred',
  'parent_added',
  'plan_promoted',
]);
export type CatalogProvenance = z.infer<typeof CatalogProvenanceSchema>;

// ---- Favourite recipes (projected from household_recipe_usage table) ----
//
// Lightweight projection of the household's high-confidence recipes — gives
// the planner immediate context on what this family has accepted before.
// Full recipe row available via recipe.fetch when the planner needs it.

export const KitchenMapFavouriteRecipeSchema = z.object({
  recipe_id: z.string().uuid(),
  canonical_name: z.string().min(1).max(256),
  primary_ingredient_key: z.string().min(1).max(64).nullable(),
  cuisine_tags: z.array(z.string().min(1).max(64)),
  confidence_score: z.number().int().min(0).max(100),
  is_household_favorite: z.boolean(),
  // Slice 2.6-s1 — surfaces household_recipe_usage.catalog_provenance so the
  // planner / personalization layer can distinguish parent-declared favorites
  // from inferred / plan-promoted ones.
  catalog_provenance: CatalogProvenanceSchema,
  use_count: z.number().int().min(0),
  last_used_at: z.string().datetime({ offset: true }),
});

export const KitchenMapRecipesSchema = z.object({
  // Recipes with is_household_favorite = true OR confidence_score >= 75.
  favourites: z.array(KitchenMapFavouriteRecipeSchema),
  // Recipes the household has explicitly banned — planner must never propose.
  banned: z.array(KitchenMapFavouriteRecipeSchema),
});

// ---- Epic 2.5 structured signal arrays -----------------------------------
//
// All four arrays land as TOP-LEVEL fields on KitchenMapSchema (sibling to
// `children`, `cultural`, `recipes`) — flat projection keeps the planner's
// iteration loop simple and matches existing precedent (recipes, cultural).

// child_allergens projection. Uniform shape, NO severity field — per FR122
// allergens are uniformly hard. The planner treats every entry here as a
// guardrail-relevant constraint.
export const KitchenMapAllergenSchema = z.object({
  child_id: z.string().uuid(),
  allergen: z.string().min(1).max(64),
  source: z.enum([
    'onboarding_declared',
    'memory_promoted',
    'vocabulary_inferred',
    'parent_edited',
    'backfill_migration',
  ]),
});

// dietary_preferences (the new structured table — distinct from the legacy
// encrypted-JSONB column on households that feeds KitchenMapHouseholdSchema.
// dietary_preferences). `child_id` is null for household-scoped dietary
// identity (the common case post-Epic-2.5).
export const KitchenMapDietarySchema = z.object({
  child_id: z.string().uuid().nullable(),
  tag: z.string().min(1).max(64),
  enforcement: EnforcementLevelSchema,
  source: z.enum([
    'onboarding_declared',
    'vocabulary_inferred',
    'parent_edited',
    'backfill_migration',
  ]),
});

// food_preferences — open-vocabulary likes/dislikes. Enforcement is typically
// 'soft' or 'default'; the planner uses it to weight signals.
export const KitchenMapFoodPreferenceSchema = z.object({
  child_id: z.string().uuid().nullable(),
  item: z.string().min(1).max(128),
  valence: z.enum(['loves', 'likes', 'neutral', 'dislikes', 'refuses']),
  enforcement: EnforcementLevelSchema,
  source: z.enum([
    'onboarding_declared',
    'memory_promoted',
    'rating_signal',
    'parent_edited',
    'backfill_migration',
  ]),
});

// favorite_lunches — household-scoped cold-start seed (FR124). Ordered by
// position for stable rendering. Slice 2.6-s1 — backing store moved from the
// dropped `favorite_lunches` table to `household_recipe_usage` joined with
// `recipes`. `provenance` now uses the catalog-wide CatalogProvenance enum
// ('declared' replaces 'onboarding_seed' as the parent-stated provenance).
// Shape preserved at the projection boundary (still { item, provenance,
// position }); only the value domain of `provenance` evolved.
export const KitchenMapFavoriteLunchSchema = z.object({
  item: z.string().min(1).max(128),
  provenance: CatalogProvenanceSchema,
  position: z.number().int().nonnegative(),
});

// household_rules — closed set of common rules plus a 'custom' escape hatch.
// Read-side: only enforces the "custom requires a label" direction. A non-custom
// row with a stale custom_label (corrupt DB or migration artifact) is tolerated
// rather than rejected — a single bad row must not break the entire household's
// Kitchen Map projection. Write-side enforcement lives in RuleSetInputSchema.
export const KitchenMapRuleSchema = z
  .object({
    rule_type: z.enum([
      'no_pork',
      'no_alcohol',
      'no_beef',
      'no_overnight_leftovers',
      'no_microwave_at_school',
      'custom',
    ]),
    custom_label: z.string().min(1).max(120).nullable(),
    enforcement: EnforcementLevelSchema,
    source: z.enum([
      'onboarding_declared',
      'memory_promoted',
      'parent_edited',
      'backfill_migration',
    ]),
  })
  .refine(
    (v) => {
      if (v.rule_type === 'custom') {
        return v.custom_label !== null && v.custom_label !== undefined && v.custom_label.length > 0;
      }
      return true; // tolerate non-null custom_label on non-custom rules (defensive read path)
    },
    {
      message: "custom_label is required when rule_type='custom'",
      path: ['custom_label'],
    },
  );

// ---- Meta -----------------------------------------------------------------

export const KitchenMapMetaSchema = z.object({
  composed_at: z.string().datetime({ offset: true }),
  // Mirrors households.kitchen_map_version — the cache-key suffix.
  map_version: z.number().int().nonnegative(),
  // Bumped when the KitchenMapSchema shape itself changes; old-shape cache
  // entries naturally become unreachable.
  //
  // 1.0.0 → 1.1.0 in slice 2.5-s1 (added: household.display_name,
  // child.bag_composition_pattern, cultural prior enforcement, five new
  // top-level arrays, meta.required_set_complete).
  schema_version: z.literal('1.1.0'),
  // false = household still onboarding, projection is partial.
  is_complete: z.boolean(),
  // Slice 2.5-s1 — required-set completion gate. The exact required-set
  // definition is committed in slice 2.5-s4; until then the composer emits
  // `false` for every household. Slice 2.5-s10 flips this to `true` when
  // the parent finalizes onboarding.
  required_set_complete: z.boolean(),
});

// ---- The full Kitchen Map -------------------------------------------------

export const KitchenMapSchema = z.object({
  household: KitchenMapHouseholdSchema,
  caregivers: z.array(KitchenMapCaregiverSchema),
  children: z.array(KitchenMapChildSchema),
  cultural: KitchenMapCulturalSchema,
  memory: KitchenMapMemorySchema,
  household_extras: KitchenMapHouseholdExtrasSchema,
  recipes: KitchenMapRecipesSchema,
  // Slice 2.5-s1 — Epic 2.5 structured signal arrays. Empty by default for
  // existing households; populated by the chaptered conversation moments
  // (slices 2.5-s5 through 2.5-s9).
  allergens: z.array(KitchenMapAllergenSchema),
  dietary: z.array(KitchenMapDietarySchema),
  food_preferences: z.array(KitchenMapFoodPreferenceSchema),
  favorite_lunches: z.array(KitchenMapFavoriteLunchSchema),
  rules: z.array(KitchenMapRuleSchema),
  meta: KitchenMapMetaSchema,
});

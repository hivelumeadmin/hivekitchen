import { z } from 'zod';
import { AgeBandSchema, BagCompositionSchema } from './children.js';

// ===========================================================================
// Kitchen Map — Slice A
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
});

export const KitchenMapCulturalSchema = z.object({
  // Ratified priors that the planner treats as authoritative.
  active: z.array(KitchenMapCulturalPriorSchema),
  // Inferred but not yet ratified — surface for ratification, but planner
  // treats as a soft hint, not a hard constraint.
  suggested: z.array(KitchenMapCulturalPriorSchema),
});

// ---- Memory (projected from memory_nodes table) --------------------------

// Mirrors memory_nodes.node_type enum from migration 20260601000000.
export const KitchenMapMemoryNodeTypeSchema = z.enum([
  'preference',
  'rhythm',
  'cultural_rhythm',
  'allergy',
  'child_obsession',
  'school_policy',
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
  use_count: z.number().int().min(0),
  last_used_at: z.string().datetime({ offset: true }),
});

export const KitchenMapRecipesSchema = z.object({
  // Recipes with is_household_favorite = true OR confidence_score >= 75.
  favourites: z.array(KitchenMapFavouriteRecipeSchema),
  // Recipes the household has explicitly banned — planner must never propose.
  banned: z.array(KitchenMapFavouriteRecipeSchema),
});

// ---- Meta -----------------------------------------------------------------

export const KitchenMapMetaSchema = z.object({
  composed_at: z.string().datetime({ offset: true }),
  // Mirrors households.kitchen_map_version — the cache-key suffix.
  map_version: z.number().int().nonnegative(),
  // Bumped when the KitchenMapSchema shape itself changes; old-shape cache
  // entries naturally become unreachable.
  schema_version: z.literal('1.0.0'),
  // false = household still onboarding, projection is partial.
  is_complete: z.boolean(),
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
  meta: KitchenMapMetaSchema,
});

import { z } from 'zod';

// ---- Slice A0c — Vocabulary table row schemas -----------------------------
//
// Row shapes for the four parent vocabulary tables created in
// supabase/migrations/20260514005000_create_vocabulary_tables.sql.
//
// These describe DB rows; downstream services use them to validate that a
// tag value exists in the vocabulary on insert. The actual vocabulary
// listings (set of valid `key` values) are LOADED FROM THE DB AT RUNTIME
// (VocabularyService), not enumerated here as TypeScript constants.
// That's the whole point — ops can extend the vocabulary via SQL INSERT
// without a deploy.

// ---- allergen_tags --------------------------------------------------------

export const AllergenRuleClassSchema = z.enum(['falcpa', 'extended', 'sensitivity']);

export const AllergenSeveritySchema = z.enum(['block', 'warn']);

export const AllergenTagRowSchema = z.object({
  key: z.string().min(1).max(64),
  display_name: z.string().min(1).max(128),
  rule_class: AllergenRuleClassSchema,
  legal_jurisdiction: z.array(z.string().min(1).max(8)),
  severity_default: AllergenSeveritySchema,
  alias_keys: z.array(z.string().min(1).max(64)),
  display_icon: z.string().nullable(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  sort_order: z.number().int(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// ---- dietary_tags ---------------------------------------------------------

export const DietaryCategorySchema = z.enum([
  'religious',
  'plant_based',
  'health',
  'cuisine',
  'allergen_derived',
]);

export const DietaryTagRowSchema = z.object({
  key: z.string().min(1).max(64),
  display_name: z.string().min(1).max(128),
  category: DietaryCategorySchema,
  implies: z.array(z.string().min(1).max(64)),
  conflicts_with: z.array(z.string().min(1).max(64)),
  description: z.string().nullable(),
  is_active: z.boolean(),
  sort_order: z.number().int(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// ---- cultural_tags --------------------------------------------------------

export const CulturalTagRowSchema = z.object({
  key: z.string().min(1).max(64),
  display_name: z.string().min(1).max(128),
  parent_key: z.string().min(1).max(64).nullable(),
  is_template: z.boolean(),
  observance_calendar: z.string().nullable(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  sort_order: z.number().int(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// ---- cuisine_tags ---------------------------------------------------------

export const CuisineRegionSchema = z.enum([
  'asia',
  'europe',
  'africa',
  'americas',
  'oceania',
]);

export const CuisineTagRowSchema = z.object({
  key: z.string().min(1).max(64),
  display_name: z.string().min(1).max(128),
  parent_key: z.string().min(1).max(64).nullable(),
  region: CuisineRegionSchema.nullable(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  sort_order: z.number().int(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// ---- Vocabulary snapshot --------------------------------------------------
//
// Container shape used by VocabularyService.snapshot() — the in-memory
// cache of all vocabulary tables, refreshed when any *_tags table changes.
// Agents receive this (or a projection of it) as part of their system
// prompt augmentation so they emit only valid tag values.

export const VocabularySnapshotSchema = z.object({
  allergen_tags: z.array(AllergenTagRowSchema),
  dietary_tags: z.array(DietaryTagRowSchema),
  cultural_tags: z.array(CulturalTagRowSchema),
  cuisine_tags: z.array(CuisineTagRowSchema),
  loaded_at: z.string().datetime(),
});

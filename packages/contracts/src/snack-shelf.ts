import { z } from 'zod';

// ---- Story 3-S41: Family Snack Shelf — add / remove household snack SKUs ----

// Story 3-S43 — FALCPA-9 allergen vocabulary. CHECK-pinned in the DB
// (migration 20261031000000) and identical to FALCPA_TOP_9 in
// allergy-rules.engine.ts, so set-membership comparison needs no synonym
// expansion at the guardrail callsite.
export const SnackAllergenTagSchema = z.enum([
  'peanut',
  'tree_nut',
  'dairy',
  'egg',
  'wheat',
  'soy',
  'fish',
  'shellfish',
  'sesame',
]);

// Canonical snack category vocabulary. Matches snack_skus.category values from
// the 20261028000000 global seeds and the normalization in
// snack-rotation.service.ts (which folds 'veggie' → 'vegetable'). The contract
// uses the canonical DB value only — never 'veggie'.
export const SnackCategorySchema = z.enum([
  'fruit',
  'vegetable',
  'grain',
  'protein',
  'dairy',
  'other',
]);

// Story 3-S44 — optional package form factor. Values MUST match the DB CHECK
// constraint in 20261030000000_snack_sku_upc_package_type.sql exactly.
export const SnackPackageTypeSchema = z.enum(['bag', 'box', 'cup', 'pouch', 'other']);

// A snack SKU as surfaced on the "My Snacks" shelf. created_by_household_id is
// null for the 10 global seeds (not removable) and the household id for
// family-added rows (removable).
export const SnackSkuSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  brand: z.string().nullable(),
  category: SnackCategorySchema,
  created_by_household_id: z.string().uuid().nullable(),
  created_at: z.string().datetime({ offset: true }),
  // Story 3-S43 — FALCPA-9 allergen tags. Always an array (DB column is
  // NOT NULL DEFAULT '{}'); empty = untagged (conservative-unknown at commit).
  allergen_tags: z.array(SnackAllergenTagSchema),
  // Story 3-S44 — optional product metadata. NULL = not specified.
  upc_code: z.string().nullable(),
  package_type: SnackPackageTypeSchema.nullable(),
  // Reversible pause flag: true = in the weekly rotation, false = temporarily
  // out of stock (still on the shelf). Distinct from removal.
  in_stock: z.boolean(),
});

// POST /v1/households/:id/snacks
export const CreateSnackSkuInputSchema = z.object({
  name: z.string().min(1).max(100),
  brand: z.string().max(100).optional(),
  category: SnackCategorySchema,
  // Story 3-S43 — optional on input; defaults to empty (untagged). Parents
  // tick the FALCPA-9 allergens a snack contains on the add form.
  allergen_tags: z.array(SnackAllergenTagSchema).default([]),
  // Story 3-S44 — both optional; omitted = NULL in the DB.
  upc_code: z.string().max(20).optional(),
  package_type: SnackPackageTypeSchema.optional(),
});

// PATCH /v1/households/:id/snacks/:skuId — toggle the in-stock / pause flag.
export const UpdateSnackSkuInputSchema = z.object({
  in_stock: z.boolean(),
});

// GET /v1/households/:id/snacks
export const ListSnackSkusResponseSchema = z.object({
  items: z.array(SnackSkuSchema),
});

export const SnackShelfHouseholdIdParamSchema = z.object({ id: z.string().uuid() });

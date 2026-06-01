import { z } from 'zod';

// Slice 2-s27 — household-level food-identity profile. These fields used to
// live on each child row (children.cultural_identifiers / .dietary_preferences
// / .declared_allergens). They now live on the household because they describe
// the home, not the person. Per-child medical allergens stay on children.

// Reasonable upper bounds to keep the encrypted text column small and to
// reject runaway agent emissions. The numbers mirror children.ts limits.
const CULTURAL_MAX_TAGS = 20;
const DIETARY_MAX_TAGS = 30;
const ALLERGEN_MAX_TAGS = 50;
const TAG_MIN_LEN = 1;
// Aligned with KitchenMapHouseholdSchema's max(64) — a tag that passes write
// validation must also pass the kitchen-map read-path parse.
const TAG_MAX_LEN = 64;

const TagSchema = z.string().trim().min(TAG_MIN_LEN).max(TAG_MAX_LEN);

// ---- PATCH /v1/households/:id (parent-facing route) ---------------------

export const HouseholdProfilePatchBodySchema = z.object({
  cultural_identifiers: z.array(TagSchema).max(CULTURAL_MAX_TAGS).optional(),
  dietary_preferences: z.array(TagSchema).max(DIETARY_MAX_TAGS).optional(),
  declared_allergens: z.array(TagSchema).max(ALLERGEN_MAX_TAGS).optional(),
});

export const HouseholdProfileResponseSchema = z.object({
  id: z.string().uuid(),
  cultural_identifiers: z.array(z.string()),
  dietary_preferences: z.array(z.string()),
  declared_allergens: z.array(z.string()),
});

export const HouseholdIdParamSchema = z.object({
  id: z.string().uuid(),
});

// ---- household.upsert agent tool (onboarding loop) ----------------------

export const HouseholdUpsertInputSchema = z.object({
  cultural_identifiers: z.array(TagSchema).max(CULTURAL_MAX_TAGS).optional(),
  dietary_preferences: z.array(TagSchema).max(DIETARY_MAX_TAGS).optional(),
  // Replace semantics: the supplied array becomes the complete list.
  declared_allergens: z.array(TagSchema).max(ALLERGEN_MAX_TAGS).optional(),
  // Additive semantics: items are merged into the existing list (deduplicated).
  // Mutually exclusive with declared_allergens.
  declared_allergens_add: z.array(TagSchema).max(ALLERGEN_MAX_TAGS).optional(),
});

export const HouseholdUpsertOutputSchema = z.object({
  household_id: z.string().uuid(),
  // The household row always exists by the time the agent runs (created at
  // signup); kept in the contract for symmetry with child.upsert.
  was_existing: z.literal(true),
});

// Story 3.29 — PATCH /v1/households/:id/sovereignty-mode body. The toggle
// switches how the planner reconciles overlapping cultural rule sets across
// the household: 'unified' (default) honors all rules simultaneously;
// 'alternating' rotates which tradition leads each day.
export const UpdateSovereigntyModeInputSchema = z.object({
  sovereignty_mode: z.enum(['unified', 'alternating']),
});

export const UpdateSovereigntyModeResponseSchema = z.object({
  sovereignty_mode: z.enum(['unified', 'alternating']),
});

export type HouseholdProfilePatchBody = z.infer<typeof HouseholdProfilePatchBodySchema>;
export type HouseholdProfileResponse = z.infer<typeof HouseholdProfileResponseSchema>;
export type HouseholdIdParam = z.infer<typeof HouseholdIdParamSchema>;
export type HouseholdUpsertInput = z.infer<typeof HouseholdUpsertInputSchema>;
export type HouseholdUpsertOutput = z.infer<typeof HouseholdUpsertOutputSchema>;
export type UpdateSovereigntyModeInput = z.infer<typeof UpdateSovereigntyModeInputSchema>;
export type UpdateSovereigntyModeResponse = z.infer<typeof UpdateSovereigntyModeResponseSchema>;

import { z } from 'zod';
import { EnforcementLevelSchema } from './enforcement.js';

// ===========================================================================
// Story 7-S14 — Kitchen Profile parent-deterministic safety edits (Phase 1)
// ===========================================================================
// Two safety-critical, parent-authoritative edit surfaces with NO LLM in the
// write path:
//   1. child allergens (add / remove)
//   2. cultural-rule enforcement level
// Soft/narrative edits (identity quote, shared tastes, favorites) are Phase 2.

// --- Allergen add -----------------------------------------------------------
// Phase 1 ships a curated, deterministic vocabulary — NOT free-text — to avoid
// the silent-typo failure mode on safety data (a mistyped "peants" would match
// nothing and silently fail to protect the child). The FALCPA "big 9" covers
// the overwhelming majority; custom allergens are a Phase-2 follow-up.
export const COMMON_ALLERGENS = [
  'milk',
  'egg',
  'fish',
  'shellfish',
  'tree_nut',
  'peanut',
  'wheat',
  'soy',
  'sesame',
] as const;
export const AllergenKeySchema = z.enum(COMMON_ALLERGENS);
export type AllergenKey = z.infer<typeof AllergenKeySchema>;

// Human-readable label stored for each curated key (and shown on the add-chips).
// The API persists the label, not the snake_case key, so the allergen reads
// naturally in the Kitchen Profile and the allergy guardrail tokenizes it the
// same as an onboarding-declared allergen.
export const ALLERGEN_LABELS: Record<AllergenKey, string> = {
  milk: 'milk',
  egg: 'egg',
  fish: 'fish',
  shellfish: 'shellfish',
  tree_nut: 'tree nut',
  peanut: 'peanut',
  wheat: 'wheat',
  soy: 'soy',
  sesame: 'sesame',
};

// Add is restricted to the curated vocabulary (deterministic, typo-proof).
export const AddChildAllergenRequestSchema = z.object({
  allergen: AllergenKeySchema,
});
export type AddChildAllergenRequest = z.infer<typeof AddChildAllergenRequestSchema>;

// Response is the child's current allergen list as plain strings — the same
// shape the KitchenMap projection exposes, so the client can swap it straight in.
export const ChildAllergenMutationResponseSchema = z.object({
  child_id: z.string().uuid(),
  allergens: z.array(z.string()),
});
export type ChildAllergenMutationResponse = z.infer<typeof ChildAllergenMutationResponseSchema>;

// --- Cultural enforcement edit ----------------------------------------------
// Keyed by the cultural prior's `key`, not its UUID: the KitchenMap projection
// (KitchenMapCulturalPriorSchema) exposes `key` but NOT `id`, and
// cultural_priors enforces UNIQUE (household_id, key) — so `key` is the stable
// identifier the kitchen-profile UI actually has.
export const SetCulturalEnforcementRequestSchema = z.object({
  key: z.string().min(1).max(64),
  enforcement: EnforcementLevelSchema,
});
export type SetCulturalEnforcementRequest = z.infer<typeof SetCulturalEnforcementRequestSchema>;

// Deliberately minimal: returns only the confirmed write. We do NOT reuse
// CulturalPriorSchema here — its `key` is constrained to 6 cultural enum values
// while cultural_priors.key is a widened string column (cuisine tags etc.), so
// echoing an arbitrary prior back through CulturalPriorSchema could fail
// response validation. key + enforcement is all the client needs.
export const SetCulturalEnforcementResponseSchema = z.object({
  key: z.string(),
  enforcement: EnforcementLevelSchema,
});
export type SetCulturalEnforcementResponse = z.infer<typeof SetCulturalEnforcementResponseSchema>;

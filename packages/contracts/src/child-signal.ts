import { z } from 'zod';

// ===========================================================================
// Story 4-S11 — child_signal agent tool I/O.
// ===========================================================================
// The planner calls child_signal once at the start of a planning run to surface
// per-child recipe preference signals derived from recent emoji ratings
// (child_preferences). Liked recipes bias placement in the same slot kind;
// disliked recipes are avoidance hints. Absence of a signal is NEVER a dislike
// (FR125). Per-slot independence is enforced upstream by the slot_kind grouping
// (FR124). family_liked requires >= 2 children (FR126).
// ===========================================================================

export const ChildSignalInputSchema = z.object({
  household_id: z.string().uuid(),
  lookback_days: z.number().int().min(7).max(90).default(30),
});

export const ChildSignalRecipeItemSchema = z.object({
  recipe_id: z.string().uuid(),
  recipe_name: z.string(),
  slot_kind: z.enum(['main', 'snack', 'extra']),
  count: z.number().int().min(1),
  last_at: z.string(), // ISO date 'YYYY-MM-DD'
});

export const ChildSignalPerChildSchema = z.object({
  child_id: z.string().uuid(),
  child_name: z.string(),
  liked: z.array(ChildSignalRecipeItemSchema), // loved_count > 0 OR ok_count > 0
  disliked: z.array(ChildSignalRecipeItemSchema), // not_really_count > 0 AND liked_count === 0
});

export const ChildSignalFamilyPatternSchema = z.object({
  recipe_id: z.string().uuid(),
  recipe_name: z.string(),
  slot_kind: z.enum(['main', 'snack', 'extra']),
  child_count: z.number().int().min(2), // FR126: at least 2 children required
});

export const ChildSignalOutputSchema = z.object({
  per_child: z.array(ChildSignalPerChildSchema),
  family_liked: z.array(ChildSignalFamilyPatternSchema),
});

import { z } from 'zod';

// ---- Story 2.10: child profiles with envelope-encrypted sensitive fields ---

export const AgeBandSchema = z.enum(['toddler', 'child', 'preteen', 'teen']);

// Story 3-DM-B1 — variation-driving attribute enums. Defaults are the safe
// choice (normal portion, normal texture, mild spice); onboarding captures
// overrides per child.
export const AppetiteLevelSchema = z.enum(['light', 'normal', 'heavy']);
export const TextureNeedsSchema = z.enum(['soft', 'mixed', 'normal']);
export const SpiceToleranceSchema = z.enum(['mild', 'regular', 'spicy']);

// Story 3-DM-B1 — bag_composition_pattern promoted to a proper enum. Defined
// here (canonical column home on the children table) and re-imported by
// kitchen-map.ts for the projection. The legacy duplicate definition in
// kitchen-map.ts is replaced with a re-export to avoid circular imports.
export const BagCompositionPatternSchema = z.enum([
  'main_only',
  'main_plus_snack',
  'main_plus_extra',
  'main_plus_snack_plus_extra',
]);

export const AddChildBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  age_band: AgeBandSchema,
  declared_allergens: z.array(z.string().min(1).max(100)).max(50).default([]),
  cultural_identifiers: z.array(z.string().min(1).max(100)).max(20).default([]),
  dietary_preferences: z.array(z.string().min(1).max(100)).max(30).default([]),
});

// ---- Story 2.12: per-child Lunch Bag slot declaration -----------------------
//
// Story 3-DM-B1: BagComposition booleans are now a DERIVED view from
// bag_composition_pattern; they are not stored. The body schema below stays as
// the public API surface — the route service maps it to a pattern internally.

// `main` is always true. The literal-true narrowing keeps it impossible for
// a caller to receive a row that disagrees with the DB invariant.
export const BagCompositionSchema = z.object({
  main: z.literal(true),
  snack: z.boolean(),
  extra: z.boolean(),
});

// .strict() rejects unknown keys — including `main` — so callers cannot
// override the always-true invariant through this body.
export const SetBagCompositionBodySchema = z
  .object({
    snack: z.boolean(),
    extra: z.boolean(),
  })
  .strict();

export const ChildResponseSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  name: z.string(),
  age_band: AgeBandSchema,
  declared_allergens: z.array(z.string()),
  cultural_identifiers: z.array(z.string()),
  dietary_preferences: z.array(z.string()),
  // Story 3-DM-B1 — new variation-driving attributes.
  appetite_level: AppetiteLevelSchema,
  texture_needs: TextureNeedsSchema,
  spice_tolerance: SpiceToleranceSchema,
  // Story 3-DM-B1 — promoted enum, NOT NULL post-migration.
  bag_composition_pattern: BagCompositionPatternSchema,
  created_at: z.string(),
});

// Story 3-DM-B1 — derive the per-slot booleans from the pattern enum. Used
// by API responses + planner paths that still need the boolean struct (e.g.
// kitchen-map projection, planner allergy-filter selection). Single source of
// truth lives on the column; this helper is pure.
export function bagCompositionFromPattern(
  pattern: z.infer<typeof BagCompositionPatternSchema>,
): { main: true; snack: boolean; extra: boolean } {
  switch (pattern) {
    case 'main_only':
      return { main: true, snack: false, extra: false };
    case 'main_plus_snack':
      return { main: true, snack: true, extra: false };
    case 'main_plus_extra':
      return { main: true, snack: false, extra: true };
    case 'main_plus_snack_plus_extra':
      return { main: true, snack: true, extra: true };
  }
}

export const AddChildResponseSchema = z.object({ child: ChildResponseSchema });
export const GetChildResponseSchema = z.object({ child: ChildResponseSchema });
export const SetBagCompositionResponseSchema = z.object({ child: ChildResponseSchema });

// Slice 4-S1 — household-scoped list of children. The Heart Note compose
// surface picks the active child from this list (multi-child picker is a
// later slice).
export const ListChildrenResponseSchema = z.object({
  children: z.array(ChildResponseSchema),
});

// Story 7-S7 — response for the annual flavor-journey reset.
export const ResetFlavorJourneyResponseSchema = z.object({
  child_id: z.string().uuid(),
  reset_at: z.string().datetime({ offset: true }),
});
export type ResetFlavorJourneyResponse = z.infer<typeof ResetFlavorJourneyResponseSchema>;

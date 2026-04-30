import { z } from 'zod';

// ---- Story 2.10: child profiles with envelope-encrypted sensitive fields ---

export const AgeBandSchema = z.enum(['toddler', 'child', 'preteen', 'teen']);

export const AddChildBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  age_band: AgeBandSchema,
  school_policy_notes: z.string().trim().max(500).nullish(),
  declared_allergens: z.array(z.string().min(1).max(100)).max(50).default([]),
  cultural_identifiers: z.array(z.string().min(1).max(100)).max(20).default([]),
  dietary_preferences: z.array(z.string().min(1).max(100)).max(30).default([]),
});

// ---- Story 2.12: per-child Lunch Bag slot declaration -----------------------

// `main` is always true. The literal-true narrowing keeps it impossible for
// a caller to receive a row that disagrees with the DB CHECK constraint.
export const BagCompositionSchema = z.object({
  main: z.literal(true),
  snack: z.boolean(),
  extra: z.boolean(),
});

// .strict() rejects unknown keys — including `main` — so callers cannot
// override the always-true invariant through this body. The route additionally
// validates that no `main` key was sent before Zod sees it (defense in depth).
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
  school_policy_notes: z.string().nullable(),
  declared_allergens: z.array(z.string()),
  cultural_identifiers: z.array(z.string()),
  dietary_preferences: z.array(z.string()),
  allergen_rule_version: z.string(),
  bag_composition: BagCompositionSchema,
  created_at: z.string(),
});

export const AddChildResponseSchema = z.object({ child: ChildResponseSchema });
export const GetChildResponseSchema = z.object({ child: ChildResponseSchema });
export const SetBagCompositionResponseSchema = z.object({ child: ChildResponseSchema });

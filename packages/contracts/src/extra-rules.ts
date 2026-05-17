import { z } from 'zod';

// ---- Story 3.21: per-child Extra slot pin/ban rules + household library ----

// Pin/ban rules for a child's Extra slot. Component types are plain-text labels
// (e.g., "fruit", "grain", "sweet treat") that the planner agent interprets when
// composing the Extra slot. They are NOT specific items — the planner decides
// how to fulfil a pinned type.
export const ExtraRulesSchema = z
  .object({
    pins: z
      .array(z.string().min(1).max(50))
      .max(10)
      .refine((arr) => new Set(arr).size === arr.length, { message: 'pins must be unique' }),
    bans: z
      .array(z.string().min(1).max(50))
      .max(20)
      .refine((arr) => new Set(arr).size === arr.length, { message: 'bans must be unique' }),
  })
  .refine((v) => v.pins.every((p) => !v.bans.includes(p)), {
    message: 'a component type cannot be both pinned and banned',
  });

// PATCH /v1/children/:id/extra-rules — full replacement, not a patch.
export const UpdateExtraRulesInputSchema = ExtraRulesSchema;

export const UpdateExtraRulesResponseSchema = z.object({
  child_id: z.string().uuid(),
  extra_rules: ExtraRulesSchema,
  updated_at: z.string().datetime({ offset: true }),
});

export const ExtraRulesChildIdParamSchema = z.object({ id: z.string().uuid() });

// POST /v1/households/:id/extra-library
export const CreateExtraLibraryItemInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  component_type: z.string().min(1).max(50),
  is_allergen_free: z.boolean().default(false),
});

export const ExtraLibraryItemSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  component_type: z.string(),
  is_allergen_free: z.boolean(),
  archived_at: z.string().datetime({ offset: true }).nullable(),
  created_by: z.string().uuid(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const ListExtraLibraryResponseSchema = z.object({
  items: z.array(ExtraLibraryItemSchema),
});

export const ExtraLibraryHouseholdIdParamSchema = z.object({ id: z.string().uuid() });

// GET /v1/children/:id/extra-rules
export const GetExtraRulesResponseSchema = z.object({
  child_id: z.string().uuid(),
  extra_rules: ExtraRulesSchema,
});

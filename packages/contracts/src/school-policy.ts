import { z } from 'zod';

// Story 3.16 — School-policy update + propagation (FR22, FR112).
// Each policy row is one rule (e.g. nut_free, no_heating) targeting a slot
// via slot_scope. Mirrors supabase/migrations/.../create_school_policies.sql.

export const SlotScopeSchema = z.enum(['bag_wide', 'main', 'snack', 'extra']);

export const SchoolPolicySchema = z.object({
  id: z.string().uuid(),
  child_id: z.string().uuid(),
  policy_type: z.string().min(1).max(100),
  policy_description: z.string().max(500).nullable(),
  slot_scope: SlotScopeSchema,
  is_active: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

// PATCH /v1/children/:id/school-policies — body upserts on (child_id, policy_type).
// .strict() rejects unknown keys so a stale client cannot smuggle in fields
// outside this contract (matches the Story 2.12 SetBagCompositionBody pattern).
export const UpdateSchoolPolicyInputSchema = z
  .object({
    policy_type: z.string().min(1).max(100),
    policy_description: z.string().max(500).nullable().optional(),
    slot_scope: SlotScopeSchema.default('bag_wide'),
    is_active: z.boolean(),
  })
  .strict();

export const UpdateSchoolPolicyResponseSchema = z.object({
  policy: SchoolPolicySchema,
  regeneration_triggered: z.boolean(),
  affected_plan_ids: z.array(z.string().uuid()),
});

// GET /v1/children/:id/school-policies
export const GetSchoolPoliciesResponseSchema = z.object({
  policies: z.array(SchoolPolicySchema),
});

// :id path param shared by both routes — renamed to avoid colliding with the
// Story 2.10 children path-param shapes which use householdId+childId.
export const SchoolPolicyChildIdParamSchema = z.object({
  id: z.string().uuid(),
});

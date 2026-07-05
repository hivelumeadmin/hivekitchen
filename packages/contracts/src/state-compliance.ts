import { z } from 'zod';

// @unused-by-design — 7-S12 state-compliance scaffold; wired when the story lands

export const StateComplianceOverrideSchema = z.object({
  id: z.string().uuid(),
  state: z.string().min(2).max(2),
  override_type: z.string().min(1),
  value: z.record(z.string(), z.unknown()),
  effective_from: z.string(),
  created_at: z.string().datetime({ offset: true }),
});

export const StateComplianceOverridesResponseSchema = z.object({
  state_residency: z.string().min(2).max(2).nullable(),
  overrides: z.array(StateComplianceOverrideSchema),
});

export type StateComplianceOverride = z.infer<typeof StateComplianceOverrideSchema>;
export type StateComplianceOverridesResponse = z.infer<typeof StateComplianceOverridesResponseSchema>;

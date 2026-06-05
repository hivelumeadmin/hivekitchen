import { z } from 'zod';

// Story 7-S8 — counts of active memory_provenance records bucketed by source_type.
// Every source_type key is always present (0 when none) so the UI is deterministic.
export const MemorySourceCountsSchema = z.object({
  onboarding: z.number().int().nonnegative(),
  turn: z.number().int().nonnegative(),
  tool: z.number().int().nonnegative(),
  user_edit: z.number().int().nonnegative(),
  plan_outcome: z.number().int().nonnegative(),
  import: z.number().int().nonnegative(),
});
export type MemorySourceCounts = z.infer<typeof MemorySourceCountsSchema>;

export const DashboardCulturalPriorSchema = z.object({
  key: z.string(),
  label: z.string(),
  tier: z.enum(['L1', 'L2', 'L3']),
  state: z.string(),
});

export const DashboardVpcEventSchema = z.object({
  mechanism: z.string(),
  document_version: z.string(),
  signed_at: z.string().datetime({ offset: true }),
});

export const DashboardChildSchema = z.object({
  child_id: z.string().uuid(),
  name: z.string(),
  age_band: z.enum(['toddler', 'child', 'preteen', 'teen']),
  declared_allergens: z.array(z.string()),
  dietary_preferences: z.array(z.string()),
  memory_node_counts: MemorySourceCountsSchema,
});

export const ParentalDashboardResponseSchema = z.object({
  household: z.object({
    cultural_priors: z.array(DashboardCulturalPriorSchema),
    voice_retention_days: z.number().int().positive(),
    recent_vpc_events: z.array(DashboardVpcEventSchema),
    general_memory_node_counts: MemorySourceCountsSchema,
  }),
  children: z.array(DashboardChildSchema),
});
export type ParentalDashboardResponse = z.infer<typeof ParentalDashboardResponseSchema>;

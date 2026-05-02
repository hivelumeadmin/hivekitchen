import { z } from 'zod';

// ---- Story 2.11: cultural template inference + parental confirm -----------
//
// Six Phase-1 supported templates only — onboarding inference produces L1
// (method/ingredient) priors. L2/L3 require ongoing usage signals (Epic 5).

export const CulturalKeySchema = z.enum([
  'halal',
  'kosher',
  'hindu_vegetarian',
  'south_asian',
  'east_african',
  'caribbean',
]);

export const TierSchema = z.enum(['L1', 'L2', 'L3']);

// State machine spans 2.11 (detected → opt_in_confirmed | forgotten) and
// Epic 5 (suggested / active / dormant). Listing all values keeps the
// contract stable as later stories land.
export const TemplateStateSchema = z.enum([
  'detected',
  'suggested',
  'opt_in_confirmed',
  'active',
  'dormant',
  'forgotten',
]);

export const CulturalPriorSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  key: CulturalKeySchema,
  label: z.string(),
  tier: TierSchema,
  state: TemplateStateSchema,
  presence: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  opted_in_at: z.string().nullable(),
  opted_out_at: z.string().nullable(),
  last_signal_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const RatifyActionSchema = z.enum(['opt_in', 'forget', 'tell_lumi_more']);

export const RatifyCulturalPriorBodySchema = z.object({
  action: RatifyActionSchema,
});

export const CulturalPriorListResponseSchema = z.object({
  priors: z.array(CulturalPriorSchema),
});

export const RatifyCulturalPriorResponseSchema = z.object({
  prior: CulturalPriorSchema,
  lumi_response: z.string().optional(),
});

// Story 3.4 — cultural.lookup tool I/O. Returns the household's confirmed and
// active cultural templates for the planner; trims CulturalPriorSchema to the
// fields the planner actually uses.
export const CulturalLookupInputSchema = z.object({
  household_id: z.string().uuid(),
});

const CulturalLookupPriorSchema = CulturalPriorSchema.pick({
  id: true,
  key: true,
  state: true,
  tier: true,
}).extend({ label: z.string() });

export const CulturalLookupOutputSchema = z.object({
  priors: z.array(CulturalLookupPriorSchema),
});

// SSE event — Story 5.2 wires the real fan-out. Defined here so consumers
// can already type-check against the wire shape.
export const TemplateStateChangedEventSchema = z.object({
  type: z.literal('template.state_changed'),
  prior_id: z.string().uuid(),
  household_id: z.string().uuid(),
  key: CulturalKeySchema,
  from_state: TemplateStateSchema,
  to_state: TemplateStateSchema,
  at: z.string(),
});

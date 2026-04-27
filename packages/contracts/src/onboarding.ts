import { z } from 'zod';

// POST /v1/onboarding/text/turn — request body
export const TextOnboardingTurnRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
});

// POST /v1/onboarding/text/turn — response
export const TextOnboardingTurnResponseSchema = z.object({
  thread_id: z.string().uuid(),
  turn_id: z.string().uuid(),
  lumi_turn_id: z.string().uuid(),
  lumi_response: z.string(),
  is_complete: z.boolean(),
});

// POST /v1/onboarding/text/finalize — response (no request body)
export const TextOnboardingFinalizeResponseSchema = z.object({
  thread_id: z.string().uuid(),
  summary: z.object({
    cultural_templates: z.array(z.string()),
    palate_notes: z.array(z.string()),
    allergens_mentioned: z.array(z.string()),
  }),
});

export type TextOnboardingTurnRequest = z.infer<typeof TextOnboardingTurnRequestSchema>;
export type TextOnboardingTurnResponse = z.infer<typeof TextOnboardingTurnResponseSchema>;
export type TextOnboardingFinalizeResponse = z.infer<typeof TextOnboardingFinalizeResponseSchema>;

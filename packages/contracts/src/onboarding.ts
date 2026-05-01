import { z } from 'zod';

// Opening greeting rendered by the text-onboarding client and prepended to
// the agent's history on the very first text turn so the LLM has matching
// context (otherwise it commonly re-introduces itself on turn 2). Shared
// between `apps/web` (client render) and `apps/api` (synthetic agentInput
// prefix on first turn) to prevent drift.
export const OPENING_GREETING =
  "I'm Lumi. I'd love to learn a little about your family — three short questions, and you can answer however feels natural. Tell me, what did your grandmother cook?";

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
    family_rhythms: z.array(z.string()).optional(),
  }),
});

// Story 2.14 — POST /v1/households/tile-retry — anxiety-leakage telemetry.
// edit_key groups retries that are conceptually the same edit (e.g. a single
// per-day swap). 3 retries within 60s on the same edit_key in the week-1–2
// window flips the household-level ghost-timestamp flag.
export const TileRetryRequestSchema = z.object({
  tile_id: z.string().min(1).max(255),
  edit_key: z.string().min(1).max(255),
  timestamp_ms: z
    .number()
    .int()
    .positive()
    .refine((v) => Math.abs(v - Date.now()) < 300_000, {
      message: 'timestamp_ms must be within 5 minutes of current time',
    }),
});

export type TextOnboardingTurnRequest = z.infer<typeof TextOnboardingTurnRequestSchema>;
export type TextOnboardingTurnResponse = z.infer<typeof TextOnboardingTurnResponseSchema>;
export type TextOnboardingFinalizeResponse = z.infer<typeof TextOnboardingFinalizeResponseSchema>;
export type TileRetryRequest = z.infer<typeof TileRetryRequestSchema>;

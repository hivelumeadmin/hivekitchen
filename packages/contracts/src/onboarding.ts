import { z } from 'zod';
import { CatalogProvenanceSchema } from './kitchen-map.js';

// Opening greeting rendered by the text-onboarding client and prepended to
// the agent's history on the very first text turn so the LLM has matching
// context (otherwise it commonly re-introduces itself on turn 2). Shared
// between `apps/web` (client render) and `apps/api` (synthetic agentInput
// prefix on first turn) to prevent drift. Must match the "First Message"
// section of docs/OnboardingPrompt.md — both opening copies are read as
// authoritative by the agent prompt, and any drift makes Lumi look
// schizophrenic on turn 2.
export const OPENING_GREETING =
  "Hi, I'm Lumi. I'll help learn your kitchen so HiveKitchen can plan school lunches that are safe, realistic, and actually get eaten. Let's start simple — who am I planning lunches for?";

// POST /v1/onboarding/text/turn — request body
//
// Slice 2.5-s3 introduces a chip-turn shape alongside the original text turn.
// The route handler discriminates on which keys are present (no shared
// `kind` field — Zod tries each branch in order). See `_bmad-output/
// implementation-artifacts/2.5-s3-chip-turn-ux-primitive.md` for context.

// Text-only turn (existing — unchanged).
export const TextTurnBodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
});

// Chip turn — at least one selection. `text` is an optional free-text
// addendum the parent can attach while chips remain primary.
export const ChipTurnBodySchema = z.object({
  chip_selections: z.array(z.string().min(1).max(64)).min(1).max(20),
  text: z.string().trim().max(4000).optional(),
});

export const TextOnboardingTurnRequestSchema = z.union([
  TextTurnBodySchema,
  ChipTurnBodySchema,
]);

// Slice 2.6-s4 — ChipOption may carry `provenance` for M5 personalized chips
// fetched from the catalog (recipes + household_recipe_usage). Optional so all
// non-M5 surfaces (M1 hints, M2 allergens, M3 hints, M4 bag, M5 override_fewer,
// M3 elevation prompt) keep their existing shape unchanged.
export const ChipOptionSchema = z.object({
  key: z.string(),
  label: z.string(),
  provenance: CatalogProvenanceSchema.optional(),
});

// Chip config returned by the agent to tell the client which chips to render
// alongside Lumi's next question. `chip_config: null` (or absent) means the
// client should render text-only input.
//
// `mode` taxonomy (see `chip-taxonomy-three-types` memory):
//  - 'hint'   — non-selectable illustrative examples; `hints` populated
//  - 'action' — single-select; `options` populated
//  - 'choice' — multi-select; `options` populated
export const ChipConfigSchema = z.object({
  mode: z.enum(['hint', 'action', 'choice']),
  options: z.array(ChipOptionSchema).optional(),
  hints: z.array(z.string()).optional(),
  skip_label: z.string().optional(),
});

// POST /v1/onboarding/text/turn — response
export const TextOnboardingTurnResponseSchema = z.object({
  thread_id: z.string().uuid(),
  turn_id: z.string().uuid(),
  lumi_turn_id: z.string().uuid(),
  lumi_response: z.string(),
  is_complete: z.boolean(),
  chip_config: ChipConfigSchema.nullable().optional(),
  // Slice 2.5-s5 — current moment after this turn. Client renders the
  // "Moment X of 5 · <name>" header from this. Optional + nullable so old
  // clients ignore it without breaking; null/undefined falls back to the
  // legacy "Step N of ~8" subtitle.
  moment_key: z.string().nullable().optional(),
  // Slice 2.5-s10 — required-set completion surfaced to the client so the
  // summary moment can enable/disable the finalize gate. null = no moment
  // repository wired (legacy/test path); true/false = computed status.
  required_set_complete: z.boolean().nullable().optional(),
  // Slice 2.5-s10 — moment keys ('m1_table'|'m2_safe'|'m5_starting_line')
  // whose required answers are still missing. Empty when all complete.
  missing_required_set: z.array(z.string()).optional(),
  // Slice 2.6-s6 — cold-start fallback mode for M5. When true, the client
  // renders the conversational tail (no chip card, "3 dishes" gate) instead
  // of the chip catalog. Sticky once true on the client.
  cold_start_mode: z.boolean().optional().default(false),
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

export type TextTurnBody = z.infer<typeof TextTurnBodySchema>;
export type ChipTurnBody = z.infer<typeof ChipTurnBodySchema>;
export type ChipOption = z.infer<typeof ChipOptionSchema>;
export type ChipConfig = z.infer<typeof ChipConfigSchema>;
export type TextOnboardingTurnRequest = z.infer<typeof TextOnboardingTurnRequestSchema>;
export type TextOnboardingTurnResponse = z.infer<typeof TextOnboardingTurnResponseSchema>;
export type TextOnboardingFinalizeResponse = z.infer<typeof TextOnboardingFinalizeResponseSchema>;
export type TileRetryRequest = z.infer<typeof TileRetryRequestSchema>;

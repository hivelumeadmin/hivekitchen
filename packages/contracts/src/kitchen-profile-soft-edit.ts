import { z } from 'zod';

// ===========================================================================
// Story 7-S15 — Kitchen Profile Lumi-conversational soft edits (Phase 2)
// ===========================================================================
// Phase 1 (7-S14) shipped the safety-critical, parent-deterministic edits.
// Phase 2 covers the soft/narrative data classes:
//   - Arc A: starting-line favorites (deterministic — replace-semantics)
//   - Arc B: cultural identity chip state (deterministic — opt_in / forget)
//   - Arc C: shared-tastes prose (Lumi-conversational — LumiAgent tool-call;
//            schemas for that path live on lumi.ts / food-preference tooling)
//
// Arc B and Arc A are deterministic write paths (no LLM); their contracts live
// here. Arc C reuses the existing POST /v1/lumi/turns surface.

// --- Arc B: cultural chip state --------------------------------------------
// Only the two ratchet transitions the kitchen-profile chips can drive. The
// richer RatifyAction enum (which also has 'tell_lumi_more') is the onboarding
// ratification surface; the soft-edit chips never emit it.
const CulturalStateActionSchema = z.enum(['opt_in', 'forget']);

// Keyed by the prior's `key` (the KitchenMap projection exposes `key`, not the
// UUID id; cultural_priors enforces UNIQUE (household_id, key)). Mirrors the
// Phase-1 enforcement endpoint, which is keyed the same way.
export const SetCulturalStateRequestSchema = z.object({
  key: z.string().min(1).max(64),
  action: CulturalStateActionSchema,
});
export type SetCulturalStateRequest = z.infer<typeof SetCulturalStateRequestSchema>;

// Returns the confirmed key + resulting state. `state` is a plain string for
// forward-compat: the canonical TemplateState enum lives in cultural.ts and the
// client only needs to echo the new state, not re-validate the full enum.
export const SetCulturalStateResponseSchema = z.object({
  key: z.string(),
  state: z.string(),
});
export type SetCulturalStateResponse = z.infer<typeof SetCulturalStateResponseSchema>;

// --- Arc A: starting-line favorites ----------------------------------------
// Replace-semantics: `items` is the FULL desired favorites list after the
// user's chip interactions. The server diffs against the current set, declaring
// the additions and revoking the removals. Capped at 10 (the starting-line
// target); each item is a canonical lunch name, not free prose.
export const SetFavoriteLunchesRequestSchema = z.object({
  items: z.array(z.string().min(1).max(128)).max(10),
});
export type SetFavoriteLunchesRequest = z.infer<typeof SetFavoriteLunchesRequestSchema>;

// Echoes the new favorites list as canonical_name strings, in display order.
export const SetFavoriteLunchesResponseSchema = z.object({
  items: z.array(z.string()),
});
export type SetFavoriteLunchesResponse = z.infer<typeof SetFavoriteLunchesResponseSchema>;

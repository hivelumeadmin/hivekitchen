import { z } from 'zod';
import { CulturalKeySchema } from './cultural.js';
import { WeekdaySchema } from './plan.js';

// Monotonic sequence ID. Accepts bigint, integer number, or a numeric string.
// Rejects empty string / empty array / non-numeric string — which z.coerce.bigint
// would silently coerce to 0n.
const SequenceId = z.union([
  z.bigint(),
  z.number().int().nonnegative(),
  z
    .string()
    .regex(/^\d+$/)
    .transform((s) => BigInt(s)),
]);

export const TurnBodyMessage = z.object({
  type: z.literal('message'),
  content: z.string(),
});

export const TurnBodyPlanDiff = z.object({
  type: z.literal('plan_diff'),
  week_id: z.string().uuid(),
  diff: z.record(z.string(), z.unknown()),
});

export const TurnBodyProposal = z.object({
  type: z.literal('proposal'),
  proposal_id: z.string().uuid(),
  // Slice 5-S12 — the swap-proposal target day. Persisted so the deferred
  // LumiAgent (D-5S12-2) resolves the swap against a structured day rather than
  // re-parsing free text. Mirrors TurnBodyPlanDiff carrying week_id.
  day: WeekdaySchema,
  content: z.string(),
});

export const TurnBodySystemEvent = z.object({
  type: z.literal('system_event'),
  event: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const TurnBodyPresence = z.object({
  type: z.literal('presence'),
  user_id: z.string().uuid(),
});

// Story 2.11 — Lumi appends one ratification_prompt turn after onboarding
// finalization when cultural priors are detected from the transcript.
// Each entry is a (prior_id, key, label) triple the web client renders as
// a CulturalRatificationCard.
export const TurnBodyRatificationPrompt = z.object({
  type: z.literal('ratification_prompt'),
  priors: z.array(
    z.object({
      prior_id: z.string().uuid(),
      key: CulturalKeySchema,
      label: z.string(),
    }),
  ).min(1),
});

// Slice 5-S10 — Lumi originates this turn when a family-language kinship term
// crosses the ratification threshold. The web renders it as a
// FamilyLanguageRatificationCard (three pills, sacred-plum tinted term).
export const TurnBodyFamilyLanguagePrompt = z.object({
  type: z.literal('family_language_prompt'),
  term: z.string().min(1).max(40),
  maps_to: z.string().min(1).max(40),
});

export const TurnBody = z.discriminatedUnion('type', [
  TurnBodyMessage,
  TurnBodyPlanDiff,
  TurnBodyProposal,
  TurnBodySystemEvent,
  TurnBodyPresence,
  TurnBodyRatificationPrompt,
  TurnBodyFamilyLanguagePrompt,
]);

export const Turn = z.object({
  id: z.string().uuid(),
  thread_id: z.string().uuid(),
  server_seq: SequenceId,
  created_at: z.string().datetime({ offset: true }),
  role: z.enum(['user', 'lumi', 'system']),
  body: TurnBody,
  modality: z.enum(['text', 'voice']).optional(),
});

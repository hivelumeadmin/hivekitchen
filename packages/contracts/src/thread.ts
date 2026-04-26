import { z } from 'zod';

// Monotonic sequence ID. Accepts bigint, integer number, or a numeric string.
// Rejects empty string / empty array / non-numeric string — which z.coerce.bigint
// would silently coerce to 0n.
const SequenceId = z.union([
  z.bigint(),
  z.number().int(),
  z
    .string()
    .regex(/^-?\d+$/)
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

export const TurnBody = z.discriminatedUnion('type', [
  TurnBodyMessage,
  TurnBodyPlanDiff,
  TurnBodyProposal,
  TurnBodySystemEvent,
  TurnBodyPresence,
]);

export const Turn = z.object({
  id: z.string().uuid(),
  thread_id: z.string().uuid(),
  server_seq: SequenceId,
  created_at: z.string().datetime(),
  role: z.enum(['user', 'lumi', 'system']),
  body: TurnBody,
  modality: z.enum(['text', 'voice']).optional(),
});

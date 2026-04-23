import { z } from 'zod';

export const TurnBodyMessage = z.object({
  type: z.literal('message'),
  content: z.string(),
});

export const TurnBodyPlanDiff = z.object({
  type: z.literal('plan_diff'),
  week_id: z.string().uuid(),
  diff: z.record(z.unknown()),
});

export const TurnBodyProposal = z.object({
  type: z.literal('proposal'),
  proposal_id: z.string().uuid(),
  content: z.string(),
});

export const TurnBodySystemEvent = z.object({
  type: z.literal('system_event'),
  event: z.string(),
  payload: z.record(z.unknown()).optional(),
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
  server_seq: z.coerce.bigint(),
  created_at: z.string().datetime(),
  role: z.enum(['user', 'lumi', 'system']),
  body: TurnBody,
});

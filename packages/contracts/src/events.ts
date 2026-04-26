import { z } from 'zod';
import { Turn } from './thread.js';
import { AllergyVerdict, PlanUpdatedEvent } from './plan.js';
import { ForgetCompletedEvent } from './memory.js';
import { PresenceEvent } from './presence.js';

// Stub for pantry delta — refined when packages/contracts/src/pantry.ts is created (Epic 3+).
const PantryDelta = z.object({
  items_added: z.array(z.string().uuid()).optional(),
  items_removed: z.array(z.string().uuid()).optional(),
});

// Same union used for Turn.server_seq in thread.ts. Kept local to avoid widening the public API.
const SequenceId = z.union([
  z.bigint(),
  z.number().int(),
  z
    .string()
    .regex(/^-?\d+$/)
    .transform((s) => BigInt(s)),
]);

export const InvalidationEvent = z.discriminatedUnion('type', [
  PlanUpdatedEvent,
  z.object({ type: z.literal('memory.updated'), node_id: z.string().uuid() }),
  ForgetCompletedEvent,
  z.object({ type: z.literal('thread.turn'), thread_id: z.string().uuid(), turn: Turn }),
  z.object({ type: z.literal('packer.assigned'), date: z.string().date(), packer_id: z.string().uuid() }),
  z.object({ type: z.literal('pantry.delta'), delta: PantryDelta }),
  z.object({ type: z.literal('allergy.verdict'), plan_id: z.string().uuid(), verdict: AllergyVerdict }),
  PresenceEvent,
  z.object({ type: z.literal('thread.resync'), thread_id: z.string().uuid(), from_seq: SequenceId }),
  z.object({ type: z.literal('voice.session.started'), session_id: z.string().uuid(), user_id: z.string().uuid() }),
  z.object({ type: z.literal('voice.session.ended'), session_id: z.string().uuid(), user_id: z.string().uuid() }),
]);

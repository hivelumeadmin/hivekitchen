import { z } from 'zod';
import { Turn } from './thread.js';
import { AllergyVerdict } from './plan.js';

// Stub for pantry delta — refined when packages/contracts/src/pantry.ts is created (Epic 3+).
const PantryDelta = z.object({
  items_added: z.array(z.string().uuid()).optional(),
  items_removed: z.array(z.string().uuid()).optional(),
});

export const InvalidationEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('plan.updated'), week_id: z.string().uuid() }),
  z.object({ type: z.literal('memory.updated'), node_id: z.string().uuid() }),
  z.object({ type: z.literal('thread.turn'), thread_id: z.string().uuid(), turn: Turn }),
  z.object({ type: z.literal('packer.assigned'), date: z.string().date(), packer_id: z.string().uuid() }),
  z.object({ type: z.literal('pantry.delta'), delta: PantryDelta }),
  z.object({ type: z.literal('allergy.verdict'), plan_id: z.string().uuid(), verdict: AllergyVerdict }),
  z.object({ type: z.literal('presence.partner-active'), thread_id: z.string().uuid(), user_id: z.string().uuid() }),
  z.object({ type: z.literal('thread.resync'), thread_id: z.string().uuid(), from_seq: z.coerce.bigint() }),
]);

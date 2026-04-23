import { z } from 'zod';

export const ForgetRequest = z.object({
  node_id: z.string().uuid(),
  mode: z.literal('soft'),
  reason: z.string().optional(),
});

export const ForgetCompletedEvent = z.object({
  type: z.literal('memory.forget.completed'),
  node_id: z.string().uuid(),
  mode: z.literal('soft'),
  completed_at: z.string().datetime(),
});

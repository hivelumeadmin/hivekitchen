import { z } from 'zod';

export const ConsentHistoryEventSchema = z.object({
  id: z.string().uuid(),
  event_type: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string().datetime({ offset: true }),
});
export type ConsentHistoryEvent = z.infer<typeof ConsentHistoryEventSchema>;

export const ConsentHistoryResponseSchema = z.object({
  events: z.array(ConsentHistoryEventSchema),
});
export type ConsentHistoryResponse = z.infer<typeof ConsentHistoryResponseSchema>;

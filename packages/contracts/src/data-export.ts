import { z } from 'zod';

// Story 7-S10 — POST /v1/households/:householdId/export returns 202 immediately;
// the JSON snapshot is composed asynchronously by the data-export BullMQ job and
// delivered as a 30-day signed URL by email. The 202 body only confirms the
// request was queued.
export const DataExportResponseSchema = z.object({
  status: z.literal('queued'),
  message: z.string(),
});
export type DataExportResponse = z.infer<typeof DataExportResponseSchema>;

import { z } from 'zod';

// Story 3.28 — Lunch Link suppression: pause/resume delivery for a (child, date).
// The underlying plan_item is unchanged; only the delivery session is suppressed.

export const LunchLinkPauseInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format'),
  // If false, un-suppress a previously suppressed session.
  suppress: z.boolean().default(false),
});

export const LunchLinkPauseResponseSchema = z.object({
  child_id: z.string().uuid(),
  date: z.string(),
  suppressed: z.boolean(),
  suppressed_at: z.string().datetime({ offset: true }).nullable(),
});

export type LunchLinkPauseInput = z.infer<typeof LunchLinkPauseInputSchema>;
export type LunchLinkPauseResponse = z.infer<typeof LunchLinkPauseResponseSchema>;

// Slice 4-S2 — dev-only Lunch Link surface. The `test-{childId}-{date}` URL
// shape stands in for the real HMAC-signed token that ships in 4-S3. The
// endpoint is gated to NODE_ENV=development|test at the route layer.

export const LunchLinkDevParamsSchema = z.object({
  childId: z.string().uuid(),
  date: z.string().date(),
});

export const LunchLinkDevHeartNoteSchema = z.object({
  body: z.string(),
  authorDisplayName: z.string(),
});

export const LunchLinkDevBagSchema = z.object({
  name: z.string(),
  sub: z.string(),
  safetyNote: z.string(),
});

export const LunchLinkDevResponseSchema = z.object({
  childName: z.string(),
  date: z.string().date(),
  heartNote: LunchLinkDevHeartNoteSchema.nullable(),
  bag: LunchLinkDevBagSchema,
});

export type LunchLinkDevParams = z.infer<typeof LunchLinkDevParamsSchema>;
export type LunchLinkDevHeartNote = z.infer<typeof LunchLinkDevHeartNoteSchema>;
export type LunchLinkDevBag = z.infer<typeof LunchLinkDevBagSchema>;
export type LunchLinkDevResponse = z.infer<typeof LunchLinkDevResponseSchema>;

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

// ── Slice 4-S3: real signed tokens ──────────────────────────────────────────

export const GenerateLunchLinkBodySchema = z.object({
  child_id: z.string().uuid(),
  date: z.string().date(),
});

export const GenerateLunchLinkResponseSchema = z.object({
  url: z.string().url(),
});

export const LunchLinkTokenParamSchema = z.object({
  token: z.string().min(1),
});

export const LunchLinkPublicHeartNoteSchema = z.object({
  body: z.string(),
  authorDisplayName: z.string(),
});

export const LunchLinkPublicBagSchema = z.object({
  name: z.string(),
  sub: z.string(),
  safetyNote: z.string(),
});

export const LunchLinkPayloadSchema = z.object({
  childName: z.string(),
  date: z.string().date(),
  heartNote: LunchLinkPublicHeartNoteSchema.nullable(),
  bag: LunchLinkPublicBagSchema,
  expired: z.literal(false),
  // Slice 4-S4: pre-existing child rating for this session, null when no rating
  // has been submitted yet. Default keeps pre-S4 fixtures/parses valid.
  rating: z.enum(['loved', 'ok', 'not-really']).nullable().default(null),
});

export const LunchLinkExpiredPayloadSchema = z.object({
  expired: z.literal(true),
  last_state_snapshot: z.object({
    heartNote: LunchLinkPublicHeartNoteSchema.nullable(),
    rating: z.enum(['loved', 'ok', 'not-really']).nullable(),
    bag: LunchLinkPublicBagSchema,
  }),
});

export type GenerateLunchLinkBody = z.infer<typeof GenerateLunchLinkBodySchema>;
export type GenerateLunchLinkResponse = z.infer<typeof GenerateLunchLinkResponseSchema>;
export type LunchLinkTokenParam = z.infer<typeof LunchLinkTokenParamSchema>;
export type LunchLinkPayload = z.infer<typeof LunchLinkPayloadSchema>;
export type LunchLinkExpiredPayload = z.infer<typeof LunchLinkExpiredPayloadSchema>;
export type LunchLinkPublicHeartNote = z.infer<typeof LunchLinkPublicHeartNoteSchema>;
export type LunchLinkPublicBag = z.infer<typeof LunchLinkPublicBagSchema>;

// ── Slice 4-S4: emoji rating ─────────────────────────────────────────────────

export const RateLunchLinkBodySchema = z.object({
  rating: z.enum(['loved', 'ok', 'not-really']),
});

export type RateLunchLinkBody = z.infer<typeof RateLunchLinkBodySchema>;

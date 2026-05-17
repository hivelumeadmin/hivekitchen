import { z } from 'zod';

// Slice 4-S1: Heart Note composition. S1 stores content as plaintext;
// envelope encryption ships in slice 4-S5. Status enum widens (scheduling /
// delivery) in 4-S6 — the values are reserved here so the contract doesn't
// have to break later.

export const HeartNoteStatusSchema = z.enum([
  'draft',
  'scheduled',
  'delivered',
  'viewed',
  'rated',
  'cancelled',
]);

// 280 char cap mirrors the StationeryCard textarea (heart-note charCap),
// chosen by the Sacred Channel design — a heart note is a single thought,
// not a paragraph.
const HEART_NOTE_CONTENT_MAX = 280;

export const CreateHeartNoteBodySchema = z.object({
  child_id: z.string().uuid(),
  content: z.string().max(HEART_NOTE_CONTENT_MAX).default(''),
  scheduled_for: z.string().date().optional(),
});

export const PatchHeartNoteBodySchema = z.object({
  content: z.string().max(HEART_NOTE_CONTENT_MAX).optional(),
  scheduled_for: z.string().date().nullable().optional(),
});

export const HeartNoteResponseSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  child_id: z.string().uuid(),
  author_user_id: z.string().uuid(),
  content: z.string(),
  status: HeartNoteStatusSchema,
  scheduled_for: z.string().date().nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

// Wrapped envelope shapes — keep callers from juggling a bare row vs null.
export const HeartNotePayloadSchema = z.object({ note: HeartNoteResponseSchema });
export const HeartNoteNullablePayloadSchema = z.object({
  note: HeartNoteResponseSchema.nullable(),
});

export const GetHeartNotesQuerySchema = z.object({
  child_id: z.string().uuid(),
  date: z.string().date().optional(),
});

export const HeartNoteIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type HeartNoteStatus = z.infer<typeof HeartNoteStatusSchema>;
export type CreateHeartNoteBody = z.infer<typeof CreateHeartNoteBodySchema>;
export type PatchHeartNoteBody = z.infer<typeof PatchHeartNoteBodySchema>;
export type HeartNoteResponse = z.infer<typeof HeartNoteResponseSchema>;
export type HeartNotePayload = z.infer<typeof HeartNotePayloadSchema>;
export type HeartNoteNullablePayload = z.infer<typeof HeartNoteNullablePayloadSchema>;
export type GetHeartNotesQuery = z.infer<typeof GetHeartNotesQuerySchema>;
export type HeartNoteIdParam = z.infer<typeof HeartNoteIdParamSchema>;

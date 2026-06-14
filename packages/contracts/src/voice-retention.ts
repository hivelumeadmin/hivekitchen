import { z } from 'zod';

export const VoiceRetentionModeSchema = z.enum(['standard', 'immediate_delete']);

// PATCH /v1/users/me/voice-retention request body.
export const UpdateVoiceRetentionRequestSchema = z.object({
  voice_retention_mode: VoiceRetentionModeSchema,
});

// One item in the GET /v1/users/me/voice-transcripts list.
export const VoiceTranscriptItemSchema = z.object({
  id: z.string().uuid(),
  transcript: z.string(),
  retention_until: z.string().datetime({ offset: true }),
  created_at: z.string().datetime({ offset: true }),
});

// GET /v1/users/me/voice-transcripts response.
export const VoiceTranscriptsResponseSchema = z.object({
  transcripts: z.array(VoiceTranscriptItemSchema),
  voice_retention_mode: VoiceRetentionModeSchema,
});

export type VoiceRetentionMode = z.infer<typeof VoiceRetentionModeSchema>;
export type UpdateVoiceRetentionRequest = z.infer<typeof UpdateVoiceRetentionRequestSchema>;
export type VoiceTranscriptItem = z.infer<typeof VoiceTranscriptItemSchema>;
export type VoiceTranscriptsResponse = z.infer<typeof VoiceTranscriptsResponseSchema>;

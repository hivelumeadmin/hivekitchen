import { z } from 'zod';
import { LumiSurfaceSchema } from './lumi.js';

// POST /v1/voice/sessions — request body.
// Surface widened from z.literal('onboarding') to LumiSurfaceSchema in Story
// 12.1 (ADR-002). 'onboarding' remains a valid value so the onboarding voice
// pipeline keeps working unchanged.
export const VoiceSessionCreateSchema = z.object({
  context: LumiSurfaceSchema,
});

// POST /v1/voice/sessions — response
export const VoiceSessionCreateResponseSchema = z.object({
  session_id: z.string().uuid(),
});

// WebSocket — client → server text frames
export const WsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }).strict(),
]);

// WebSocket — server → client text frames
export const WsSessionReadySchema = z.object({
  type: z.literal('session.ready'),
});

export const WsTranscriptSchema = z.object({
  type: z.literal('transcript'),
  seq: z.number().int().min(1),
  text: z.string().min(1),
});

export const WsResponseStartSchema = z.object({
  type: z.literal('response.start'),
  seq: z.number().int().min(1),
});

export const WsResponseEndSchema = z.object({
  type: z.literal('response.end'),
  seq: z.number().int().min(1),
  text: z.string().min(1),
});

export const WsSessionSummarySchema = z.object({
  type: z.literal('session.summary'),
  summary: z.object({
    cultural_templates: z.array(z.string()),
    palate_notes: z.array(z.string()),
    allergens_mentioned: z.array(z.string()),
  }),
  cultural_priors_detected: z.boolean(),
});

export const WsErrorCodeSchema = z.enum([
  'stt_failed',
  'agent_failed',
  'tts_failed',
  'summary_failed',
]);

export const WsErrorSchema = z.object({
  type: z.literal('error'),
  code: WsErrorCodeSchema,
  message: z.string(),
});

export const WsServerMessageSchema = z.discriminatedUnion('type', [
  WsSessionReadySchema,
  WsTranscriptSchema,
  WsResponseStartSchema,
  WsResponseEndSchema,
  WsSessionSummarySchema,
  WsErrorSchema,
]);

// Types
export type WsErrorCode = z.infer<typeof WsErrorCodeSchema>;
export type VoiceSessionCreate = z.infer<typeof VoiceSessionCreateSchema>;
export type VoiceSessionCreateResponse = z.infer<typeof VoiceSessionCreateResponseSchema>;
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
export type WsSessionReady = z.infer<typeof WsSessionReadySchema>;
export type WsTranscript = z.infer<typeof WsTranscriptSchema>;
export type WsResponseStart = z.infer<typeof WsResponseStartSchema>;
export type WsResponseEnd = z.infer<typeof WsResponseEndSchema>;
export type WsSessionSummary = z.infer<typeof WsSessionSummarySchema>;
export type WsError = z.infer<typeof WsErrorSchema>;

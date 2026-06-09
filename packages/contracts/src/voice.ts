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

// POST /v1/voice/tts/token — browser-direct TTS via ElevenLabs TTS WebSocket.
// Slice 2-S20. The HK API mints a short-lived single-use token via the
// ElevenLabs single-use-token endpoint; the browser then opens the TTS
// WebSocket directly at
//   wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input
//     ?single_use_token=<token>&model_id=<model>&output_format=pcm_16000
// and streams audio back. Raw audio bypasses the HK API entirely; the
// long-lived xi-api-key stays server-side. Token TTL is 15 minutes,
// single-use (consumed on connect).
// Request body is empty (voice and model are server-configured).
export const TtsTokenResponseSchema = z.object({
  token: z.string().min(1),
  voice_id: z.string().min(1),
  model_id: z.string().min(1),
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

// Slice 5-S6 — non-verbal "thinking" signal. The server emits this in the
// STT→reply gap (after `transcript`, before reply generation) so the client can
// show a calm orb pulse while Lumi works. Carries no spoken text — the doctrine
// is that Lumi waits like a person thinking, not a chatbot performing (AR-14).
export const WsLumiThinkingSchema = z.object({
  type: z.literal('lumi.thinking'),
  seq: z.number().int().min(1),
});

export const WsResponseStartSchema = z.object({
  type: z.literal('response.start'),
  seq: z.number().int().min(1),
});

export const WsResponseEndSchema = z.object({
  type: z.literal('response.end'),
  seq: z.number().int().min(1),
  text: z.string(),
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

// Slice 5-S6 (Deliverable D — DEFERRED). The early-ack continuation transport
// is NOT built yet (no real-time tool-calling conversational orchestrator
// exists to trigger the >6000ms branch — see story 5-S6 WALL). This frame
// shape lands now so the future wiring (Epic 12 phase 2+) is purely additive:
// the server would emit `text` (EARLY_ACK_COPY, spoken first), then deliver the
// real answer later. NO server currently emits this.
export const WsResponseEarlyAckSchema = z.object({
  type: z.literal('response.early_ack'),
  seq: z.number().int().min(1),
  text: z.string(), // EARLY_ACK_COPY — spoken first
  expected_within_ms: z.number().int().positive(),
});

export const WsErrorCodeSchema = z.enum([
  'stt_failed',
  'agent_failed',
  'tts_failed',
  'summary_failed',
  'audio_too_large',
  'voice_cap_reached', // 5-S16 — standard-tier weekly voice cap exceeded
]);

export const WsErrorSchema = z.object({
  type: z.literal('error'),
  code: WsErrorCodeSchema,
  message: z.string(),
});

export const WsServerMessageSchema = z.discriminatedUnion('type', [
  WsSessionReadySchema,
  WsTranscriptSchema,
  WsLumiThinkingSchema,
  WsResponseStartSchema,
  WsResponseEndSchema,
  WsResponseEarlyAckSchema,
  WsSessionSummarySchema,
  WsErrorSchema,
]);

// Types
export type WsErrorCode = z.infer<typeof WsErrorCodeSchema>;
export type VoiceSessionCreate = z.infer<typeof VoiceSessionCreateSchema>;
export type VoiceSessionCreateResponse = z.infer<typeof VoiceSessionCreateResponseSchema>;
export type TtsTokenResponse = z.infer<typeof TtsTokenResponseSchema>;
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
export type WsSessionReady = z.infer<typeof WsSessionReadySchema>;
export type WsTranscript = z.infer<typeof WsTranscriptSchema>;
export type WsLumiThinking = z.infer<typeof WsLumiThinkingSchema>;
export type WsResponseStart = z.infer<typeof WsResponseStartSchema>;
export type WsResponseEnd = z.infer<typeof WsResponseEndSchema>;
export type WsResponseEarlyAck = z.infer<typeof WsResponseEarlyAckSchema>;
export type WsSessionSummary = z.infer<typeof WsSessionSummarySchema>;
export type WsError = z.infer<typeof WsErrorSchema>;

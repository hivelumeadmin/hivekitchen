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

// POST /v1/voice/stt/token — browser-direct STT via ElevenLabs Scribe WebSocket.
// The HK API mints a short-lived single-use token; the browser opens the Scribe
// WebSocket directly at wss://api.elevenlabs.io/v1/speech-to-text/realtime?token=<token>
// and streams PCM audio. Audio never transits the HK API.
export const SttTokenResponseSchema = z.object({
  token: z.string().min(1),
});

// POST /v1/voice/turns — REST onboarding voice turn (replaces GET /v1/voice/ws proxy).
// The browser transcribes via ElevenLabs Scribe WS (token from POST /v1/voice/stt/token),
// then submits the transcript here. The response includes the agent reply for TTS
// (browser fetches its own TTS token via POST /v1/voice/tts/token).
export const VoiceTurnRequestSchema = z.object({
  session_id: z.string().uuid(),
  transcript: z.string().trim().min(1).max(4000),
});

export const VoiceTurnSummarySchema = z.object({
  cultural_templates: z.array(z.string()),
  palate_notes: z.array(z.string()),
  allergens_mentioned: z.array(z.string()),
  family_rhythms: z.array(z.string()),
});

export const VoiceTurnResponseSchema = z.object({
  reply: z.string(),
  complete: z.boolean(),
  summary: VoiceTurnSummarySchema.optional(),
  cultural_priors_detected: z.boolean().optional(),
});

// Types
export type VoiceSessionCreate = z.infer<typeof VoiceSessionCreateSchema>;
export type VoiceSessionCreateResponse = z.infer<typeof VoiceSessionCreateResponseSchema>;
export type TtsTokenResponse = z.infer<typeof TtsTokenResponseSchema>;
export type SttTokenResponse = z.infer<typeof SttTokenResponseSchema>;
export type VoiceTurnRequest = z.infer<typeof VoiceTurnRequestSchema>;
export type VoiceTurnSummary = z.infer<typeof VoiceTurnSummarySchema>;
export type VoiceTurnResponse = z.infer<typeof VoiceTurnResponseSchema>;

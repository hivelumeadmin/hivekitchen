import { z } from "zod";

// POST /v1/voice/token
export const VoiceTokenResponse = z.object({
  token: z.string(),
  sessionId: z.string().uuid(),
});

// POST /v1/voice/webhook/elevenlabs
export const ElevenLabsWebhookPayload = z.object({
  session_id: z.string(),
  user_id: z.string(),
  thread_id: z.string(),
  turn_id: z.string(),
  transcript: z.string(),
  timestamp: z.string(),
});

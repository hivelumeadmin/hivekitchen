import { z } from 'zod';

// POST /v1/voice/token — request body
export const VoiceTokenRequestSchema = z.object({
  context: z.literal('onboarding'),
});

// POST /v1/voice/token — response
export const VoiceTokenResponse = z.object({
  token: z.string(),
  sessionId: z.string().uuid(),
});

// POST /v1/voice/llm — what ElevenLabs sends (OpenAI Chat Completions format)
// elevenlabs_extra_body.UUID carries ElevenLabs' conversation_id for session lookup
export const ElevenLabsLlmRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
      }),
    )
    .min(1),
  model: z.string(),
  stream: z.boolean(),
  temperature: z.number().optional(),
  max_tokens: z.number().int().optional(),
  user_id: z.string().optional(),
  elevenlabs_extra_body: z
    .object({
      UUID: z.string(),
    })
    .passthrough(),
});

// POST /v1/webhooks/elevenlabs — post-call webhook (fires once after session ends)
// Only 'post_call_transcription' type is consumed; others are acknowledged and ignored
export const ElevenLabsPostCallWebhookPayload = z.object({
  type: z.string(),
  event_timestamp: z.number(),
  data: z
    .object({
      agent_id: z.string(),
      conversation_id: z.string(),
      status: z.string(),
      transcript: z
        .array(
          z.object({
            role: z.enum(['user', 'agent']),
            message: z.string(),
            time_in_call_secs: z.number().optional(),
          }),
        )
        .optional(),
    })
    .passthrough(),
});

export type VoiceTokenRequest = z.infer<typeof VoiceTokenRequestSchema>;
export type ElevenLabsLlmRequest = z.infer<typeof ElevenLabsLlmRequestSchema>;
export type ElevenLabsPostCallWebhook = z.infer<typeof ElevenLabsPostCallWebhookPayload>;

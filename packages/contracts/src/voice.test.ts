import { describe, it, expect } from 'vitest';
import {
  VoiceTokenRequestSchema,
  VoiceTokenResponse,
  ElevenLabsLlmRequestSchema,
  ElevenLabsPostCallWebhookPayload,
} from './voice.js';

describe('VoiceTokenRequestSchema', () => {
  it('accepts onboarding context', () => {
    expect(VoiceTokenRequestSchema.safeParse({ context: 'onboarding' }).success).toBe(true);
  });

  it('rejects unknown context', () => {
    expect(VoiceTokenRequestSchema.safeParse({ context: 'profile' }).success).toBe(false);
  });

  it('rejects missing context', () => {
    expect(VoiceTokenRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('VoiceTokenResponse', () => {
  it('accepts a valid token response', () => {
    expect(
      VoiceTokenResponse.safeParse({
        token: 'https://api.elevenlabs.io/v1/convai/conversation?agent_id=abc&token=xyz',
        sessionId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(true);
  });

  it('rejects non-UUID sessionId', () => {
    expect(
      VoiceTokenResponse.safeParse({ token: 'https://example.com', sessionId: 'not-a-uuid' }).success,
    ).toBe(false);
  });
});

describe('ElevenLabsLlmRequestSchema', () => {
  const validRequest = {
    messages: [
      { role: 'system', content: 'You are Lumi.' },
      { role: 'user', content: 'What did your grandmother cook?' },
    ],
    model: 'gpt-4o',
    stream: true,
    elevenlabs_extra_body: { UUID: 'conv_abc123' },
  };

  it('accepts a valid LLM request with elevenlabs_extra_body.UUID', () => {
    expect(ElevenLabsLlmRequestSchema.safeParse(validRequest).success).toBe(true);
  });

  it('accepts optional temperature and max_tokens', () => {
    expect(
      ElevenLabsLlmRequestSchema.safeParse({ ...validRequest, temperature: 0.7, max_tokens: 300 })
        .success,
    ).toBe(true);
  });

  it('rejects an invalid message role', () => {
    const invalid = {
      ...validRequest,
      messages: [{ role: 'admin', content: 'hi' }],
    };
    expect(ElevenLabsLlmRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects missing elevenlabs_extra_body', () => {
    const { elevenlabs_extra_body: _, ...rest } = validRequest;
    expect(ElevenLabsLlmRequestSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing UUID in elevenlabs_extra_body', () => {
    expect(
      ElevenLabsLlmRequestSchema.safeParse({ ...validRequest, elevenlabs_extra_body: {} }).success,
    ).toBe(false);
  });
});

describe('ElevenLabsPostCallWebhookPayload', () => {
  const validPayload = {
    type: 'post_call_transcription',
    event_timestamp: 1717171717,
    data: {
      agent_id: 'agent_abc',
      conversation_id: 'conv_xyz',
      status: 'done',
      transcript: [
        { role: 'agent', message: 'What did your grandmother cook?', time_in_call_secs: 1.5 },
        { role: 'user', message: 'She made dal and rice every Sunday.' },
      ],
    },
  };

  it('accepts a valid post-call webhook payload', () => {
    expect(ElevenLabsPostCallWebhookPayload.safeParse(validPayload).success).toBe(true);
  });

  it('accepts payload without transcript (optional)', () => {
    const { data: { transcript: _, ...dataRest } } = validPayload;
    expect(
      ElevenLabsPostCallWebhookPayload.safeParse({ ...validPayload, data: dataRest }).success,
    ).toBe(true);
  });

  it('accepts unknown webhook type (passthrough)', () => {
    expect(
      ElevenLabsPostCallWebhookPayload.safeParse({ ...validPayload, type: 'other_event' }).success,
    ).toBe(true);
  });

  it('rejects invalid transcript role', () => {
    const invalid = {
      ...validPayload,
      data: {
        ...validPayload.data,
        transcript: [{ role: 'assistant', message: 'hi' }],
      },
    };
    expect(ElevenLabsPostCallWebhookPayload.safeParse(invalid).success).toBe(false);
  });

  it('rejects missing conversation_id', () => {
    const { data: { conversation_id: _, ...dataRest } } = validPayload;
    expect(
      ElevenLabsPostCallWebhookPayload.safeParse({ ...validPayload, data: dataRest }).success,
    ).toBe(false);
  });
});

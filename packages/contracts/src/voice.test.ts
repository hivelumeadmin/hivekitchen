import { describe, it, expect } from 'vitest';
import {
  VoiceSessionCreateSchema,
  VoiceSessionCreateResponseSchema,
  WsClientMessageSchema,
  WsServerMessageSchema,
  WsSessionReadySchema,
  WsTranscriptSchema,
  WsResponseStartSchema,
  WsResponseEndSchema,
  WsSessionSummarySchema,
  WsErrorSchema,
  WsErrorCodeSchema,
} from './voice.js';

describe('VoiceSessionCreateSchema', () => {
  it('accepts onboarding context', () => {
    expect(VoiceSessionCreateSchema.safeParse({ context: 'onboarding' }).success).toBe(true);
  });

  it('rejects unknown context', () => {
    expect(VoiceSessionCreateSchema.safeParse({ context: 'evening' }).success).toBe(false);
  });

  it('rejects missing context', () => {
    expect(VoiceSessionCreateSchema.safeParse({}).success).toBe(false);
  });
});

describe('VoiceSessionCreateResponseSchema', () => {
  it('accepts a uuid session_id', () => {
    expect(
      VoiceSessionCreateResponseSchema.safeParse({
        session_id: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(true);
  });

  it('rejects a non-uuid session_id', () => {
    expect(VoiceSessionCreateResponseSchema.safeParse({ session_id: 'not-a-uuid' }).success).toBe(
      false,
    );
  });

  it('rejects missing session_id', () => {
    expect(VoiceSessionCreateResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe('WsClientMessageSchema', () => {
  it('accepts a ping message', () => {
    expect(WsClientMessageSchema.safeParse({ type: 'ping' }).success).toBe(true);
  });

  it('rejects an unknown message type', () => {
    expect(WsClientMessageSchema.safeParse({ type: 'unknown' }).success).toBe(false);
  });
});

describe('WsServerMessageSchema variants', () => {
  it('accepts session.ready', () => {
    expect(WsSessionReadySchema.safeParse({ type: 'session.ready' }).success).toBe(true);
  });

  it('accepts transcript with seq + text', () => {
    expect(
      WsTranscriptSchema.safeParse({ type: 'transcript', seq: 1, text: 'hello' }).success,
    ).toBe(true);
  });

  it('accepts response.start with seq', () => {
    expect(WsResponseStartSchema.safeParse({ type: 'response.start', seq: 2 }).success).toBe(true);
  });

  it('accepts response.end with seq + text', () => {
    expect(
      WsResponseEndSchema.safeParse({ type: 'response.end', seq: 3, text: 'hello' }).success,
    ).toBe(true);
  });

  it('accepts session.summary with cultural_priors_detected true', () => {
    expect(
      WsSessionSummarySchema.safeParse({
        type: 'session.summary',
        summary: {
          cultural_templates: ['halal'],
          palate_notes: ['mild spice'],
          allergens_mentioned: [],
        },
        cultural_priors_detected: true,
      }).success,
    ).toBe(true);
  });

  it('accepts session.summary with cultural_priors_detected false', () => {
    expect(
      WsSessionSummarySchema.safeParse({
        type: 'session.summary',
        summary: { cultural_templates: [], palate_notes: [], allergens_mentioned: [] },
        cultural_priors_detected: false,
      }).success,
    ).toBe(true);
  });

  it('accepts an error frame', () => {
    expect(
      WsErrorSchema.safeParse({
        type: 'error',
        code: 'stt_failed',
        message: 'Could not hear that — try again',
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown server message type via discriminated union', () => {
    expect(
      WsServerMessageSchema.safeParse({ type: 'unknown', code: 'x', message: 'y' }).success,
    ).toBe(false);
  });
});

describe('WsServerMessageSchema — union routing', () => {
  it('routes session.ready through the union', () => {
    expect(WsServerMessageSchema.safeParse({ type: 'session.ready' }).success).toBe(true);
  });

  it('routes transcript through the union', () => {
    expect(
      WsServerMessageSchema.safeParse({ type: 'transcript', seq: 1, text: 'hi' }).success,
    ).toBe(true);
  });

  it('routes response.start through the union', () => {
    expect(WsServerMessageSchema.safeParse({ type: 'response.start', seq: 1 }).success).toBe(true);
  });

  it('routes response.end through the union', () => {
    expect(
      WsServerMessageSchema.safeParse({ type: 'response.end', seq: 1, text: 'ok' }).success,
    ).toBe(true);
  });

  it('routes session.summary through the union', () => {
    expect(
      WsServerMessageSchema.safeParse({
        type: 'session.summary',
        summary: { cultural_templates: [], palate_notes: [], allergens_mentioned: [] },
        cultural_priors_detected: false,
      }).success,
    ).toBe(true);
  });

  it('routes tts_failed error through the union (AC12)', () => {
    expect(
      WsServerMessageSchema.safeParse({
        type: 'error',
        code: 'tts_failed',
        message: 'Voice unavailable — please read the response instead',
      }).success,
    ).toBe(true);
  });
});

describe('WsErrorCodeSchema', () => {
  it('accepts all known error codes', () => {
    for (const code of ['stt_failed', 'agent_failed', 'tts_failed', 'summary_failed'] as const) {
      expect(WsErrorCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it('rejects an unknown error code', () => {
    expect(WsErrorCodeSchema.safeParse('unknown_error').success).toBe(false);
  });

  it('rejects empty string error code', () => {
    expect(WsErrorCodeSchema.safeParse('').success).toBe(false);
  });
});

describe('seq field — boundary validation', () => {
  it('rejects seq: 0 on transcript', () => {
    expect(
      WsTranscriptSchema.safeParse({ type: 'transcript', seq: 0, text: 'hi' }).success,
    ).toBe(false);
  });

  it('rejects seq: -1 on transcript', () => {
    expect(
      WsTranscriptSchema.safeParse({ type: 'transcript', seq: -1, text: 'hi' }).success,
    ).toBe(false);
  });

  it('rejects seq: 1.5 (non-integer) on transcript', () => {
    expect(
      WsTranscriptSchema.safeParse({ type: 'transcript', seq: 1.5, text: 'hi' }).success,
    ).toBe(false);
  });

  it('rejects seq: 0 on response.start', () => {
    expect(WsResponseStartSchema.safeParse({ type: 'response.start', seq: 0 }).success).toBe(false);
  });

  it('rejects seq: 0 on response.end', () => {
    expect(
      WsResponseEndSchema.safeParse({ type: 'response.end', seq: 0, text: 'ok' }).success,
    ).toBe(false);
  });
});

describe('text field — empty string validation', () => {
  it('rejects empty text on WsTranscriptSchema', () => {
    expect(
      WsTranscriptSchema.safeParse({ type: 'transcript', seq: 1, text: '' }).success,
    ).toBe(false);
  });

  it('rejects empty text on WsResponseEndSchema', () => {
    expect(
      WsResponseEndSchema.safeParse({ type: 'response.end', seq: 1, text: '' }).success,
    ).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { VoiceSessionCreateSchema, VoiceSessionCreateResponseSchema } from './voice.js';

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

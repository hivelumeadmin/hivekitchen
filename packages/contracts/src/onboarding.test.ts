import { describe, it, expect } from 'vitest';
import {
  TextOnboardingTurnRequestSchema,
  TextOnboardingTurnResponseSchema,
  TextOnboardingFinalizeResponseSchema,
} from './onboarding.js';

const SAMPLE_UUID = '11111111-1111-4111-8111-111111111111';

describe('TextOnboardingTurnRequestSchema', () => {
  it('accepts a normal message', () => {
    const result = TextOnboardingTurnRequestSchema.safeParse({ message: 'Grandma made dal.' });
    expect(result.success).toBe(true);
  });

  it('trims surrounding whitespace before length check', () => {
    const result = TextOnboardingTurnRequestSchema.parse({ message: '   hi   ' });
    expect(result.message).toBe('hi');
  });

  it('rejects an empty string', () => {
    const result = TextOnboardingTurnRequestSchema.safeParse({ message: '' });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only message (trims to empty)', () => {
    const result = TextOnboardingTurnRequestSchema.safeParse({ message: '     ' });
    expect(result.success).toBe(false);
  });

  it('rejects a message over 4000 characters', () => {
    const message = 'a'.repeat(4001);
    const result = TextOnboardingTurnRequestSchema.safeParse({ message });
    expect(result.success).toBe(false);
  });

  it('accepts a message at exactly 4000 characters', () => {
    const message = 'a'.repeat(4000);
    const result = TextOnboardingTurnRequestSchema.safeParse({ message });
    expect(result.success).toBe(true);
  });

  it('rejects a missing message field', () => {
    const result = TextOnboardingTurnRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('TextOnboardingTurnResponseSchema', () => {
  it('accepts a fully populated response', () => {
    const result = TextOnboardingTurnResponseSchema.safeParse({
      thread_id: SAMPLE_UUID,
      turn_id: SAMPLE_UUID,
      lumi_turn_id: SAMPLE_UUID,
      lumi_response: 'What did your grandmother cook?',
      is_complete: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid thread_id', () => {
    const result = TextOnboardingTurnResponseSchema.safeParse({
      thread_id: 'not-a-uuid',
      turn_id: SAMPLE_UUID,
      lumi_turn_id: SAMPLE_UUID,
      lumi_response: 'hi',
      is_complete: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects when is_complete is missing', () => {
    const result = TextOnboardingTurnResponseSchema.safeParse({
      thread_id: SAMPLE_UUID,
      turn_id: SAMPLE_UUID,
      lumi_turn_id: SAMPLE_UUID,
      lumi_response: 'hi',
    });
    expect(result.success).toBe(false);
  });
});

describe('TextOnboardingFinalizeResponseSchema', () => {
  it('accepts a populated summary', () => {
    const result = TextOnboardingFinalizeResponseSchema.safeParse({
      thread_id: SAMPLE_UUID,
      summary: {
        cultural_templates: ['South Asian'],
        palate_notes: ['comfort food on Fridays'],
        allergens_mentioned: ['nuts'],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty arrays for all summary fields', () => {
    const result = TextOnboardingFinalizeResponseSchema.safeParse({
      thread_id: SAMPLE_UUID,
      summary: {
        cultural_templates: [],
        palate_notes: [],
        allergens_mentioned: [],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects when a summary array is replaced with a string', () => {
    const result = TextOnboardingFinalizeResponseSchema.safeParse({
      thread_id: SAMPLE_UUID,
      summary: {
        cultural_templates: 'South Asian',
        palate_notes: [],
        allergens_mentioned: [],
      },
    });
    expect(result.success).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import {
  TextTurnBodySchema,
  ChipTurnBodySchema,
  ChipConfigSchema,
  TextOnboardingTurnRequestSchema,
  TextOnboardingTurnResponseSchema,
  TextOnboardingFinalizeResponseSchema,
} from './onboarding.js';

const SAMPLE_UUID = '11111111-1111-4111-8111-111111111111';

describe('TextTurnBodySchema', () => {
  it('accepts a valid message', () => {
    const result = TextTurnBodySchema.safeParse({ message: 'hello' });
    expect(result.success).toBe(true);
  });

  it('rejects an empty string', () => {
    const result = TextTurnBodySchema.safeParse({ message: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing message field', () => {
    const result = TextTurnBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('TextOnboardingTurnRequestSchema', () => {
  it('accepts a normal message', () => {
    const result = TextOnboardingTurnRequestSchema.safeParse({ message: 'Grandma made dal.' });
    expect(result.success).toBe(true);
  });

  it('trims surrounding whitespace before length check', () => {
    const result = TextTurnBodySchema.parse({ message: '   hi   ' });
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

  it('accepts a response with chip_config null', () => {
    const result = TextOnboardingTurnResponseSchema.safeParse({
      thread_id: SAMPLE_UUID,
      turn_id: SAMPLE_UUID,
      lumi_turn_id: SAMPLE_UUID,
      lumi_response: 'hi',
      is_complete: false,
      chip_config: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a response with a populated chip_config', () => {
    const result = TextOnboardingTurnResponseSchema.safeParse({
      thread_id: SAMPLE_UUID,
      turn_id: SAMPLE_UUID,
      lumi_turn_id: SAMPLE_UUID,
      lumi_response: 'Tap any that apply',
      is_complete: false,
      chip_config: {
        mode: 'choice',
        options: [
          { key: 'peanut', label: 'Peanut' },
          { key: 'dairy', label: 'Dairy' },
        ],
      },
    });
    expect(result.success).toBe(true);
  });
});

// Slice 2.5-s3 — chip turn primitives.

describe('ChipTurnBodySchema', () => {
  it('accepts chip_selections only', () => {
    const result = ChipTurnBodySchema.safeParse({
      chip_selections: ['peanut', 'dairy'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts chip_selections with text', () => {
    const result = ChipTurnBodySchema.safeParse({
      chip_selections: ['halal'],
      text: 'and we avoid beef',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty chip_selections array', () => {
    const result = ChipTurnBodySchema.safeParse({ chip_selections: [] });
    expect(result.success).toBe(false);
  });

  it('rejects more than 20 chip_selections', () => {
    const result = ChipTurnBodySchema.safeParse({
      chip_selections: Array.from({ length: 21 }, (_, i) => `chip-${i}`),
    });
    expect(result.success).toBe(false);
  });

  it('accepts exactly 20 chip_selections', () => {
    const result = ChipTurnBodySchema.safeParse({
      chip_selections: Array.from({ length: 20 }, (_, i) => `chip-${i}`),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a chip key over 64 characters', () => {
    const result = ChipTurnBodySchema.safeParse({
      chip_selections: ['a'.repeat(65)],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty chip key', () => {
    const result = ChipTurnBodySchema.safeParse({ chip_selections: [''] });
    expect(result.success).toBe(false);
  });
});

describe('TextOnboardingTurnRequestSchema (union)', () => {
  it('accepts a text-turn body', () => {
    const result = TextOnboardingTurnRequestSchema.safeParse({ message: 'hello' });
    expect(result.success).toBe(true);
  });

  it('accepts a chip-turn body', () => {
    const result = TextOnboardingTurnRequestSchema.safeParse({
      chip_selections: ['peanut'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a chip-turn body with text', () => {
    const result = TextOnboardingTurnRequestSchema.safeParse({
      chip_selections: ['halal'],
      text: 'and we avoid beef',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty object', () => {
    const result = TextOnboardingTurnRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('ChipConfigSchema', () => {
  it('accepts hint mode with hints', () => {
    const result = ChipConfigSchema.safeParse({
      mode: 'hint',
      hints: ['Maya, 8', 'Two kids — 4 and 7'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts action mode with options', () => {
    const result = ChipConfigSchema.safeParse({
      mode: 'action',
      options: [{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts choice mode with options and skip_label', () => {
    const result = ChipConfigSchema.safeParse({
      mode: 'choice',
      options: [{ key: 'punjabi', label: 'Punjabi' }],
      skip_label: 'Skip this moment',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown mode', () => {
    const result = ChipConfigSchema.safeParse({ mode: 'freeform' });
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

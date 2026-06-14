import { describe, expect, it } from 'vitest';
import {
  VoiceRetentionModeSchema,
  UpdateVoiceRetentionRequestSchema,
  VoiceTranscriptsResponseSchema,
} from './voice-retention.js';

describe('VoiceRetentionModeSchema', () => {
  it('accepts standard', () => expect(VoiceRetentionModeSchema.parse('standard')).toBe('standard'));
  it('accepts immediate_delete', () =>
    expect(VoiceRetentionModeSchema.parse('immediate_delete')).toBe('immediate_delete'));
  it('rejects unknown mode', () => expect(() => VoiceRetentionModeSchema.parse('delete')).toThrow());
});

describe('UpdateVoiceRetentionRequestSchema', () => {
  it('accepts standard', () =>
    expect(UpdateVoiceRetentionRequestSchema.parse({ voice_retention_mode: 'standard' })).toEqual({
      voice_retention_mode: 'standard',
    }));
  it('accepts immediate_delete', () =>
    expect(
      UpdateVoiceRetentionRequestSchema.parse({ voice_retention_mode: 'immediate_delete' }),
    ).toEqual({ voice_retention_mode: 'immediate_delete' }));
  it('rejects empty body', () =>
    expect(() => UpdateVoiceRetentionRequestSchema.parse({})).toThrow());
});

describe('VoiceTranscriptsResponseSchema', () => {
  it('parses response with transcripts', () => {
    const result = VoiceTranscriptsResponseSchema.parse({
      transcripts: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          transcript: 'What is for lunch today?',
          retention_until: '2026-11-01T00:00:00.000Z',
          created_at: '2026-10-23T10:00:00.000Z',
        },
      ],
      voice_retention_mode: 'standard',
    });
    expect(result.transcripts).toHaveLength(1);
    expect(result.voice_retention_mode).toBe('standard');
  });

  it('parses empty transcripts for immediate_delete', () => {
    const result = VoiceTranscriptsResponseSchema.parse({
      transcripts: [],
      voice_retention_mode: 'immediate_delete',
    });
    expect(result.transcripts).toHaveLength(0);
  });
});

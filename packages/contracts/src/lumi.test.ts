import { describe, it, expect } from 'vitest';
import {
  LumiSurfaceSchema,
  LumiContextSignalSchema,
  LumiTurnRequestSchema,
  LumiThreadTurnsResponseSchema,
  VoiceTalkSessionCreateSchema,
  VoiceTalkSessionResponseSchema,
  LumiNudgeEventSchema,
} from './lumi.js';

const UUID1 = '00000000-0000-4000-8000-000000000001';
const UUID2 = '00000000-0000-4000-8000-000000000002';
const UUID3 = '00000000-0000-4000-8000-000000000003';
const DT = '2026-04-29T00:00:00Z';

const TURN_FIXTURE = {
  id: UUID1,
  thread_id: UUID2,
  server_seq: '1',
  created_at: DT,
  role: 'lumi',
  body: { type: 'message', content: 'Hi from Lumi' },
} as const;

describe('LumiSurfaceSchema', () => {
  it('pins the exact set of 8 surface values (drift guard)', () => {
    expect(LumiSurfaceSchema.options).toEqual([
      'onboarding',
      'planning',
      'meal-detail',
      'child-profile',
      'grocery-list',
      'evening-check-in',
      'heart-note',
      'general',
    ]);
  });

  it('accepts each known surface', () => {
    for (const surface of [
      'onboarding',
      'planning',
      'meal-detail',
      'child-profile',
      'grocery-list',
      'evening-check-in',
      'heart-note',
      'general',
    ] as const) {
      expect(LumiSurfaceSchema.safeParse(surface).success).toBe(true);
    }
  });

  it('rejects an unknown surface string', () => {
    expect(LumiSurfaceSchema.safeParse('dashboard').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(LumiSurfaceSchema.safeParse('').success).toBe(false);
  });
});

describe('LumiContextSignalSchema', () => {
  it('round-trips with all optional fields populated', () => {
    const input = {
      surface: 'planning',
      entity_type: 'plan',
      entity_id: UUID1,
      entity_summary: 'Week of April 29 — 5 meals planned',
      recent_actions: ['Approved Thursday meal', 'Flagged strawberry allergen'],
    };
    const result = LumiContextSignalSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(input);
  });

  it('round-trips with only surface', () => {
    const result = LumiContextSignalSchema.safeParse({ surface: 'general' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.surface).toBe('general');
  });

  it('rejects empty entity_type', () => {
    expect(
      LumiContextSignalSchema.safeParse({ surface: 'meal-detail', entity_type: '' }).success,
    ).toBe(false);
  });

  it('rejects entity_type longer than 64 chars', () => {
    expect(
      LumiContextSignalSchema.safeParse({
        surface: 'meal-detail',
        entity_type: 'x'.repeat(65),
      }).success,
    ).toBe(false);
  });

  it('accepts entity_type exactly at cap of 64 chars', () => {
    expect(
      LumiContextSignalSchema.safeParse({
        surface: 'meal-detail',
        entity_type: 'x'.repeat(64),
      }).success,
    ).toBe(true);
  });

  it('rejects recent_actions longer than 5 items', () => {
    const result = LumiContextSignalSchema.safeParse({
      surface: 'planning',
      recent_actions: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(result.success).toBe(false);
  });

  it('accepts recent_actions exactly at cap of 5', () => {
    const result = LumiContextSignalSchema.safeParse({
      surface: 'planning',
      recent_actions: ['a', 'b', 'c', 'd', 'e'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty string inside recent_actions', () => {
    expect(
      LumiContextSignalSchema.safeParse({
        surface: 'planning',
        recent_actions: ['valid', ''],
      }).success,
    ).toBe(false);
  });

  it('rejects recent_actions item longer than 200 chars', () => {
    expect(
      LumiContextSignalSchema.safeParse({
        surface: 'planning',
        recent_actions: ['x'.repeat(201)],
      }).success,
    ).toBe(false);
  });

  it('accepts recent_actions item exactly at cap of 200 chars', () => {
    expect(
      LumiContextSignalSchema.safeParse({
        surface: 'planning',
        recent_actions: ['x'.repeat(200)],
      }).success,
    ).toBe(true);
  });

  it('rejects entity_summary longer than 500 chars', () => {
    const result = LumiContextSignalSchema.safeParse({
      surface: 'meal-detail',
      entity_summary: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('accepts entity_summary exactly at cap of 500 chars', () => {
    const result = LumiContextSignalSchema.safeParse({
      surface: 'meal-detail',
      entity_summary: 'x'.repeat(500),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid entity_id', () => {
    const result = LumiContextSignalSchema.safeParse({
      surface: 'meal-detail',
      entity_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing surface', () => {
    expect(LumiContextSignalSchema.safeParse({ entity_type: 'plan' }).success).toBe(false);
  });
});

describe('LumiTurnRequestSchema', () => {
  it('accepts a valid request', () => {
    const result = LumiTurnRequestSchema.safeParse({
      message: 'What did Maya have for lunch yesterday?',
      context_signal: { surface: 'general' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts message of length 1 (inclusive lower boundary)', () => {
    expect(
      LumiTurnRequestSchema.safeParse({
        message: 'x',
        context_signal: { surface: 'general' },
      }).success,
    ).toBe(true);
  });

  it('accepts message of length 4000 (inclusive upper boundary)', () => {
    expect(
      LumiTurnRequestSchema.safeParse({
        message: 'x'.repeat(4000),
        context_signal: { surface: 'general' },
      }).success,
    ).toBe(true);
  });

  it('rejects empty message', () => {
    expect(
      LumiTurnRequestSchema.safeParse({
        message: '',
        context_signal: { surface: 'general' },
      }).success,
    ).toBe(false);
  });

  it('rejects whitespace-only message (trim happens before min check)', () => {
    expect(
      LumiTurnRequestSchema.safeParse({
        message: '    ',
        context_signal: { surface: 'general' },
      }).success,
    ).toBe(false);
  });

  it('trims surrounding whitespace and accepts the trimmed content', () => {
    const result = LumiTurnRequestSchema.safeParse({
      message: '   hello   ',
      context_signal: { surface: 'general' },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.message).toBe('hello');
  });

  it('rejects message longer than 4000 chars', () => {
    expect(
      LumiTurnRequestSchema.safeParse({
        message: 'x'.repeat(4001),
        context_signal: { surface: 'general' },
      }).success,
    ).toBe(false);
  });

  it('rejects missing context_signal', () => {
    expect(LumiTurnRequestSchema.safeParse({ message: 'hi' }).success).toBe(false);
  });
});

describe('LumiThreadTurnsResponseSchema', () => {
  it('accepts a valid response with turns', () => {
    const result = LumiThreadTurnsResponseSchema.safeParse({
      thread_id: UUID3,
      turns: [TURN_FIXTURE],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.turns).toHaveLength(1);
  });

  it('accepts an empty turns array', () => {
    const result = LumiThreadTurnsResponseSchema.safeParse({
      thread_id: UUID3,
      turns: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-uuid thread_id', () => {
    const result = LumiThreadTurnsResponseSchema.safeParse({
      thread_id: 'not-a-uuid',
      turns: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects when a turn does not match Turn schema', () => {
    const result = LumiThreadTurnsResponseSchema.safeParse({
      thread_id: UUID3,
      turns: [{ ...TURN_FIXTURE, role: 'admin' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('VoiceTalkSessionCreateSchema', () => {
  it('accepts a valid create request with only context_signal', () => {
    const result = VoiceTalkSessionCreateSchema.safeParse({
      context_signal: { surface: 'planning' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown surface inside context_signal', () => {
    const result = VoiceTalkSessionCreateSchema.safeParse({
      context_signal: { surface: 'dashboard' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing context_signal', () => {
    const result = VoiceTalkSessionCreateSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('VoiceTalkSessionResponseSchema', () => {
  it('accepts a valid response', () => {
    const result = VoiceTalkSessionResponseSchema.safeParse({
      talk_session_id: UUID1,
      stt_token: 'stt-abc',
      tts_token: 'tts-xyz',
      voice_id: 'voice-lumi',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty stt_token', () => {
    expect(
      VoiceTalkSessionResponseSchema.safeParse({
        talk_session_id: UUID1,
        stt_token: '',
        tts_token: 'tts-xyz',
        voice_id: 'voice-lumi',
      }).success,
    ).toBe(false);
  });

  it('rejects whitespace-only stt_token', () => {
    expect(
      VoiceTalkSessionResponseSchema.safeParse({
        talk_session_id: UUID1,
        stt_token: '   ',
        tts_token: 'tts-xyz',
        voice_id: 'voice-lumi',
      }).success,
    ).toBe(false);
  });

  it('rejects token containing internal whitespace', () => {
    expect(
      VoiceTalkSessionResponseSchema.safeParse({
        talk_session_id: UUID1,
        stt_token: 'stt token',
        tts_token: 'tts-xyz',
        voice_id: 'voice-lumi',
      }).success,
    ).toBe(false);
  });

  it('rejects token longer than 2048 chars', () => {
    expect(
      VoiceTalkSessionResponseSchema.safeParse({
        talk_session_id: UUID1,
        stt_token: 'x'.repeat(2049),
        tts_token: 'tts-xyz',
        voice_id: 'voice-lumi',
      }).success,
    ).toBe(false);
  });

  it('accepts token exactly at cap of 2048 chars', () => {
    expect(
      VoiceTalkSessionResponseSchema.safeParse({
        talk_session_id: UUID1,
        stt_token: 'x'.repeat(2048),
        tts_token: 'tts-xyz',
        voice_id: 'voice-lumi',
      }).success,
    ).toBe(true);
  });

  it('rejects non-uuid talk_session_id', () => {
    expect(
      VoiceTalkSessionResponseSchema.safeParse({
        talk_session_id: 'not-a-uuid',
        stt_token: 'stt-abc',
        tts_token: 'tts-xyz',
        voice_id: 'voice-lumi',
      }).success,
    ).toBe(false);
  });
});

describe('LumiNudgeEventSchema', () => {
  it('accepts a valid nudge event', () => {
    const result = LumiNudgeEventSchema.safeParse({
      type: 'lumi.nudge',
      turn: TURN_FIXTURE,
      surface: 'planning',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a wrong type literal', () => {
    expect(
      LumiNudgeEventSchema.safeParse({
        type: 'lumi.message',
        turn: TURN_FIXTURE,
        surface: 'planning',
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid surface', () => {
    expect(
      LumiNudgeEventSchema.safeParse({
        type: 'lumi.nudge',
        turn: TURN_FIXTURE,
        surface: 'dashboard',
      }).success,
    ).toBe(false);
  });

  it('rejects when turn is malformed', () => {
    expect(
      LumiNudgeEventSchema.safeParse({
        type: 'lumi.nudge',
        turn: { ...TURN_FIXTURE, role: 'admin' },
        surface: 'planning',
      }).success,
    ).toBe(false);
  });
});

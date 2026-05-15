import { describe, it, expect } from 'vitest';
import {
  OnboardingStateResponseSchema,
  OnboardingStateStatusSchema,
  OnboardingTurnSnapshotSchema,
} from './onboarding-state.js';

describe('OnboardingStateStatusSchema', () => {
  it.each(['not_started', 'in_progress', 'completed'] as const)('accepts %s', (s) => {
    expect(OnboardingStateStatusSchema.safeParse(s).success).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(OnboardingStateStatusSchema.safeParse('pending').success).toBe(false);
  });
});

describe('OnboardingTurnSnapshotSchema', () => {
  const validTurn = {
    id: '11111111-1111-4111-8111-111111111111',
    role: 'user' as const,
    content: 'My family loves pasta.',
    created_at: '2026-05-15T12:00:00.000Z',
  };

  it('accepts a valid turn', () => {
    expect(OnboardingTurnSnapshotSchema.safeParse(validTurn).success).toBe(true);
  });

  it('rejects a non-uuid id', () => {
    expect(
      OnboardingTurnSnapshotSchema.safeParse({ ...validTurn, id: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('rejects an invalid role', () => {
    expect(
      OnboardingTurnSnapshotSchema.safeParse({ ...validTurn, role: 'system' }).success,
    ).toBe(false);
  });
});

describe('OnboardingStateResponseSchema', () => {
  it('accepts a not_started shape (just the status)', () => {
    expect(
      OnboardingStateResponseSchema.safeParse({ status: 'not_started' }).success,
    ).toBe(true);
  });

  it('accepts a completed shape (just the status)', () => {
    expect(
      OnboardingStateResponseSchema.safeParse({ status: 'completed' }).success,
    ).toBe(true);
  });

  it('accepts a full in_progress shape', () => {
    expect(
      OnboardingStateResponseSchema.safeParse({
        status: 'in_progress',
        thread_id: '22222222-2222-4222-8222-222222222222',
        modality: 'text',
        started_at: '2026-05-14T10:00:00.000Z',
        last_activity_at: '2026-05-14T10:05:00.000Z',
        turns: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            role: 'user',
            content: 'We are Bengali.',
            created_at: '2026-05-14T10:00:30.000Z',
          },
          {
            id: '44444444-4444-4444-8444-444444444444',
            role: 'lumi',
            content: 'Thank you for sharing.',
            created_at: '2026-05-14T10:00:45.000Z',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(
      OnboardingStateResponseSchema.safeParse({ status: 'partial' }).success,
    ).toBe(false);
  });

  it('rejects an in_progress shape with malformed thread_id', () => {
    expect(
      OnboardingStateResponseSchema.safeParse({
        status: 'in_progress',
        thread_id: 'not-a-uuid',
        modality: 'text',
        turns: [],
      }).success,
    ).toBe(false);
  });
});

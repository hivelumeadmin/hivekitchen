import { describe, it, expect } from 'vitest';
import {
  BriefStatePayloadSchema,
  LearningMomentCalloutSchema,
  RespondToLearningMomentRequestSchema,
} from './plan.js';

// Slice 5-S8 — "I noticed" learning moment contract round-trips.

const NODE_A = '11111111-1111-4111-8111-111111111111';
const NODE_B = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-06-07T12:00:00.000Z';

describe('LearningMomentCalloutSchema', () => {
  it('parses a valid callout object', () => {
    const parsed = LearningMomentCalloutSchema.parse({
      prose: "I've noticed your family loves spicy food — want me to keep that in mind?",
      node_ids: [NODE_A, NODE_B],
      surfaced_at: NOW,
    });
    expect(parsed.node_ids).toHaveLength(2);
    expect(parsed.surfaced_at).toBe(NOW);
  });

  it('rejects prose longer than 400 chars', () => {
    const result = LearningMomentCalloutSchema.safeParse({
      prose: 'x'.repeat(401),
      node_ids: [NODE_A],
      surfaced_at: NOW,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty node_ids array', () => {
    const result = LearningMomentCalloutSchema.safeParse({
      prose: 'noticed',
      node_ids: [],
      surfaced_at: NOW,
    });
    expect(result.success).toBe(false);
  });
});

describe('RespondToLearningMomentRequestSchema', () => {
  it('accepts confirm | tell_more | dismiss', () => {
    for (const action of ['confirm', 'tell_more', 'dismiss'] as const) {
      expect(RespondToLearningMomentRequestSchema.parse({ action }).action).toBe(action);
    }
  });

  it('rejects an unknown action', () => {
    expect(RespondToLearningMomentRequestSchema.safeParse({ action: 'banana' }).success).toBe(false);
  });
});

describe('BriefStatePayloadSchema — 5-S8 fields', () => {
  it('parses the empty JSONB default with both learning-moment fields null', () => {
    const parsed = BriefStatePayloadSchema.parse({});
    expect(parsed.learning_moment_callout).toBeNull();
    expect(parsed.learning_moment_suppressed_until).toBeNull();
  });

  it('round-trips a populated learning_moment_callout', () => {
    const parsed = BriefStatePayloadSchema.parse({
      learning_moment_callout: {
        prose: 'noticed',
        node_ids: [NODE_A],
        surfaced_at: NOW,
      },
      learning_moment_suppressed_until: NOW,
    });
    expect(parsed.learning_moment_callout?.prose).toBe('noticed');
    expect(parsed.learning_moment_suppressed_until).toBe(NOW);
  });
});

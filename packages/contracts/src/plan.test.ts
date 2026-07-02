import { describe, it, expect } from 'vitest';
import {
  BriefStatePayloadSchema,
  LearningMomentCalloutSchema,
  PlanComposeTreeInputSchema,
  PlanComposeTreeOutputSchema,
  ProposeSwapInputSchema,
  ProposeSwapResponseSchema,
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

// Slice 5-S9 — "Why this?" plan reasoning.

describe('BriefStatePayloadSchema — 5-S9 plan_reasoning', () => {
  it('defaults plan_reasoning to null when absent', () => {
    expect(BriefStatePayloadSchema.parse({}).plan_reasoning).toBeNull();
  });

  it('round-trips a non-null plan_reasoning', () => {
    const parsed = BriefStatePayloadSchema.parse({
      plan_reasoning: 'Lumi chose pasta for continuity.',
    });
    expect(parsed.plan_reasoning).toBe('Lumi chose pasta for continuity.');
  });
});

describe('PlanComposeTreeOutputSchema — 5-S9 reasoning', () => {
  const RECIPE_ID = '33333333-3333-4333-8333-333333333333';
  const minimalValidPlanOutput = {
    plan_id: '44444444-4444-4444-8444-444444444444',
    household_id: '55555555-5555-4555-8555-555555555555',
    week_of: '2026-06-09',
    main_assignments: [{ sequence: 1, recipe_id: RECIPE_ID }],
    days: [{ day: 'monday' as const, slots: [{ slot_kind: 'main' as const, main_assignment_sequence: 1 }] }],
    prompt_version: 'v1',
  };

  it('accepts optional reasoning within 600 chars', () => {
    const out = PlanComposeTreeOutputSchema.parse({
      ...minimalValidPlanOutput,
      reasoning: 'Pasta Mon+Tue for batch-prep; peanut-free swap for Isla.',
    });
    expect(out.reasoning).toBeDefined();
  });

  it('parses without reasoning (optional)', () => {
    const out = PlanComposeTreeOutputSchema.parse(minimalValidPlanOutput);
    expect(out.reasoning).toBeUndefined();
  });

  it('rejects reasoning longer than 600 chars', () => {
    const result = PlanComposeTreeOutputSchema.safeParse({
      ...minimalValidPlanOutput,
      reasoning: 'x'.repeat(601),
    });
    expect(result.success).toBe(false);
  });
});

describe('PlanComposeTreeInputSchema — 3.5-s2 reasoning', () => {
  const minimalValidPlanInput = {
    household_id: '55555555-5555-4555-8555-555555555555',
    week_of: '2026-06-09',
    main_assignments: [{ sequence: 1, recipe_id: 'Turkey & Cheese Pinwheel' }],
    days: [{ day: 'monday' as const, slots: [{ slot_kind: 'main' as const, main_assignment_sequence: 1 }] }],
    prompt_version: 'v2.8.0',
  };

  it('accepts optional reasoning within 600 chars', () => {
    const parsed = PlanComposeTreeInputSchema.parse({
      ...minimalValidPlanInput,
      reasoning: 'Pinwheels Mon for batch-prep continuity.',
    });
    expect(parsed.reasoning).toBe('Pinwheels Mon for batch-prep continuity.');
  });

  it('parses without reasoning (optional)', () => {
    const parsed = PlanComposeTreeInputSchema.parse(minimalValidPlanInput);
    expect(parsed.reasoning).toBeUndefined();
  });

  it('rejects reasoning longer than 600 chars', () => {
    const result = PlanComposeTreeInputSchema.safeParse({
      ...minimalValidPlanInput,
      reasoning: 'x'.repeat(601),
    });
    expect(result.success).toBe(false);
  });
});

// Slice 5-S12 — conversational swap proposal contract round-trips.

describe('ProposeSwapInputSchema', () => {
  it('accepts a valid weekday + content', () => {
    const input = ProposeSwapInputSchema.parse({
      day: 'wednesday',
      content: 'something lighter, maybe a wrap',
    });
    expect(input.day).toBe('wednesday');
  });

  it('rejects empty content', () => {
    expect(
      ProposeSwapInputSchema.safeParse({ day: 'monday', content: '' }).success,
    ).toBe(false);
  });

  it('rejects content longer than 500 chars', () => {
    expect(
      ProposeSwapInputSchema.safeParse({ day: 'monday', content: 'x'.repeat(501) })
        .success,
    ).toBe(false);
  });

  it('rejects an invalid weekday', () => {
    expect(
      ProposeSwapInputSchema.safeParse({ day: 'someday', content: 'ok' }).success,
    ).toBe(false);
  });
});

describe('ProposeSwapResponseSchema', () => {
  it('accepts a uuid proposal_id', () => {
    const out = ProposeSwapResponseSchema.parse({
      proposal_id: '44444444-4444-4444-8444-444444444444',
    });
    expect(out.proposal_id).toBeDefined();
  });

  it('rejects a non-uuid proposal_id', () => {
    expect(ProposeSwapResponseSchema.safeParse({ proposal_id: 'nope' }).success).toBe(
      false,
    );
  });
});

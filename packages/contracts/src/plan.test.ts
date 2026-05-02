import { describe, it, expect } from 'vitest';
import {
  AllergyVerdict,
  PlanUpdatedEvent,
  WeeklyPlan,
  PlanComposeInputSchema,
  PlanComposeOutputSchema,
} from './plan.js';

const UUID1 = '00000000-0000-4000-8000-000000000001';
const UUID2 = '00000000-0000-4000-8000-000000000002';

describe('AllergyVerdict', () => {
  it('parses cleared verdict', () => {
    expect(AllergyVerdict.safeParse({ verdict: 'cleared' }).success).toBe(true);
  });

  it('parses blocked verdict with allergens', () => {
    const r = AllergyVerdict.safeParse({ verdict: 'blocked', allergens: ['peanut', 'tree nut'], reason: 'contains peanuts' });
    expect(r.success).toBe(true);
  });

  it('parses blocked verdict without optional reason', () => {
    const r = AllergyVerdict.safeParse({ verdict: 'blocked', allergens: ['gluten'] });
    expect(r.success).toBe(true);
  });

  it('parses pending verdict', () => {
    expect(AllergyVerdict.safeParse({ verdict: 'pending' }).success).toBe(true);
  });

  it('parses degraded verdict', () => {
    const r = AllergyVerdict.safeParse({
      verdict: 'degraded',
      reason: 'CULTURAL_INTERSECTION_EMPTY',
      suggestion: 'try_alternating_sovereignty',
    });
    expect(r.success).toBe(true);
  });

  it('parses degraded without optional suggestion', () => {
    expect(AllergyVerdict.safeParse({ verdict: 'degraded', reason: 'CULTURAL_INTERSECTION_EMPTY' }).success).toBe(true);
  });

  it('rejects invalid verdict discriminant', () => {
    expect(AllergyVerdict.safeParse({ verdict: 'unknown' }).success).toBe(false);
  });

  it('rejects blocked without required allergens', () => {
    expect(AllergyVerdict.safeParse({ verdict: 'blocked' }).success).toBe(false);
  });

  it('rejects blocked with empty allergens list', () => {
    expect(AllergyVerdict.safeParse({ verdict: 'blocked', allergens: [] }).success).toBe(false);
  });

  it('rejects blocked with empty-string allergen entry', () => {
    expect(AllergyVerdict.safeParse({ verdict: 'blocked', allergens: [''] }).success).toBe(false);
  });

  it('rejects degraded with empty reason', () => {
    expect(AllergyVerdict.safeParse({ verdict: 'degraded', reason: '' }).success).toBe(false);
  });
});

describe('PlanUpdatedEvent', () => {
  it('parses valid event with cleared verdict', () => {
    const r = PlanUpdatedEvent.safeParse({
      type: 'plan.updated',
      week_id: UUID1,
      guardrail_verdict: { verdict: 'cleared' },
    });
    expect(r.success).toBe(true);
  });

  it('parses valid event with blocked verdict', () => {
    const r = PlanUpdatedEvent.safeParse({
      type: 'plan.updated',
      week_id: UUID1,
      guardrail_verdict: { verdict: 'blocked', allergens: ['peanut'] },
    });
    expect(r.success).toBe(true);
  });

  it('rejects missing guardrail_verdict', () => {
    expect(PlanUpdatedEvent.safeParse({ type: 'plan.updated', week_id: UUID1 }).success).toBe(false);
  });

  it('rejects invalid week_id format', () => {
    expect(PlanUpdatedEvent.safeParse({
      type: 'plan.updated',
      week_id: 'not-a-uuid',
      guardrail_verdict: { verdict: 'cleared' },
    }).success).toBe(false);
  });
});

describe('WeeklyPlan', () => {
  const validPlan = {
    id: UUID1,
    weekOf: '2026-05-04',
    status: 'draft' as const,
    days: [
      {
        day: 'monday' as const,
        meal: { id: UUID2, name: 'Rice and lentils' },
      },
    ],
    promptVersion: 'v1.0.0',
  };

  it('parses a valid plan that includes promptVersion', () => {
    expect(WeeklyPlan.safeParse(validPlan).success).toBe(true);
  });

  it('rejects a plan missing promptVersion', () => {
    const { promptVersion: _drop, ...rest } = validPlan;
    expect(WeeklyPlan.safeParse(rest).success).toBe(false);
  });

  it('rejects a plan with non-string promptVersion', () => {
    expect(WeeklyPlan.safeParse({ ...validPlan, promptVersion: 1 }).success).toBe(false);
  });
});

describe('PlanComposeInputSchema', () => {
  const validInput = {
    household_id: UUID1,
    week_of: '2026-05-04',
    days: [
      {
        day: 'monday' as const,
        meal: { id: UUID2, name: 'Rice and lentils' },
      },
    ],
    prompt_version: 'v1.0.0',
  };

  it('round-trips a valid input', () => {
    expect(PlanComposeInputSchema.safeParse(validInput).success).toBe(true);
  });

  it('rejects an input with non-date week_of', () => {
    expect(
      PlanComposeInputSchema.safeParse({ ...validInput, week_of: 'next-week' }).success,
    ).toBe(false);
  });

  it('rejects an input missing prompt_version', () => {
    const { prompt_version: _drop, ...rest } = validInput;
    expect(PlanComposeInputSchema.safeParse(rest).success).toBe(false);
  });
});

describe('PlanComposeOutputSchema', () => {
  it('round-trips a WeeklyPlan-shaped output', () => {
    const r = PlanComposeOutputSchema.safeParse({
      id: UUID1,
      weekOf: '2026-05-04',
      status: 'draft',
      days: [{ day: 'monday', meal: { id: UUID2, name: 'Rice and lentils' } }],
      promptVersion: 'v1.0.0',
    });
    expect(r.success).toBe(true);
  });
});

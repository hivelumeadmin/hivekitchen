import { describe, it, expect } from 'vitest';
import {
  AllergyVerdict,
  PlanUpdatedEvent,
  WeeklyPlan,
  PlanComposeInputSchema,
  PlanComposeOutputSchema,
  PlanItemWriteSchema,
  CommitPlanInputSchema,
  PlanRowSchema,
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

describe('PlanItemWriteSchema', () => {
  const validItem = {
    child_id: UUID1,
    day: 'monday',
    slot: 'main',
    recipe_id: UUID2,
    ingredients: ['rice', 'lentils'],
  };

  it('round-trips a valid item with recipe_id', () => {
    expect(PlanItemWriteSchema.safeParse(validItem).success).toBe(true);
  });

  it('accepts an item without optional recipe_id / item_id', () => {
    const { recipe_id: _drop, ...rest } = validItem;
    expect(PlanItemWriteSchema.safeParse(rest).success).toBe(true);
  });

  it('rejects items with no ingredients (min(1) enforced — guardrail returns uncertain for empty arrays)', () => {
    const { ingredients: _drop, ...rest } = validItem;
    expect(PlanItemWriteSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an explicitly empty ingredients array', () => {
    expect(PlanItemWriteSchema.safeParse({ ...validItem, ingredients: [] }).success).toBe(false);
  });

  it('rejects child_id that is not a uuid', () => {
    expect(
      PlanItemWriteSchema.safeParse({ ...validItem, child_id: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('rejects empty day string', () => {
    expect(PlanItemWriteSchema.safeParse({ ...validItem, day: '' }).success).toBe(false);
  });

  it('rejects empty-string ingredient entry', () => {
    expect(
      PlanItemWriteSchema.safeParse({ ...validItem, ingredients: [''] }).success,
    ).toBe(false);
  });
});

describe('CommitPlanInputSchema', () => {
  const validInput = {
    plan_id: UUID1,
    household_id: UUID2,
    week_id: '00000000-0000-4000-8000-000000000003',
    revision: 1,
    generated_at: '2026-05-02T11:00:00.000Z',
    prompt_version: 'v1.0.0',
    items: [
      {
        child_id: UUID1,
        day: 'monday',
        slot: 'main',
        ingredients: ['rice', 'lentils'],
      },
    ],
  };

  it('round-trips a valid commit input', () => {
    expect(CommitPlanInputSchema.safeParse(validInput).success).toBe(true);
  });

  it('rejects revision below 1', () => {
    expect(
      CommitPlanInputSchema.safeParse({ ...validInput, revision: 0 }).success,
    ).toBe(false);
  });

  it('rejects non-integer revision', () => {
    expect(
      CommitPlanInputSchema.safeParse({ ...validInput, revision: 1.5 }).success,
    ).toBe(false);
  });

  it('rejects empty items array', () => {
    expect(
      CommitPlanInputSchema.safeParse({ ...validInput, items: [] }).success,
    ).toBe(false);
  });

  it('rejects invalid generated_at format', () => {
    expect(
      CommitPlanInputSchema.safeParse({ ...validInput, generated_at: 'yesterday' }).success,
    ).toBe(false);
  });

  it('rejects prompt_version longer than 32 chars', () => {
    expect(
      CommitPlanInputSchema.safeParse({ ...validInput, prompt_version: 'x'.repeat(33) }).success,
    ).toBe(false);
  });
});

describe('PlanRowSchema', () => {
  const validRow = {
    id: UUID1,
    household_id: UUID2,
    week_id: '00000000-0000-4000-8000-000000000003',
    revision: 2,
    generated_at: '2026-05-02T11:00:00.000Z',
    guardrail_cleared_at: '2026-05-02T11:00:01.000Z',
    guardrail_version: '1.1.0',
    prompt_version: 'v1.0.0',
    created_at: '2026-05-02T11:00:00.000Z',
    updated_at: '2026-05-02T11:00:01.000Z',
  };

  it('round-trips a cleared row', () => {
    expect(PlanRowSchema.safeParse(validRow).success).toBe(true);
  });

  it('round-trips a pre-clearance row (guardrail fields null)', () => {
    expect(
      PlanRowSchema.safeParse({
        ...validRow,
        guardrail_cleared_at: null,
        guardrail_version: null,
      }).success,
    ).toBe(true);
  });

  it('rejects non-nullable id', () => {
    expect(
      PlanRowSchema.safeParse({ ...validRow, id: null }).success,
    ).toBe(false);
  });

  it('rejects invalid guardrail_cleared_at datetime', () => {
    expect(
      PlanRowSchema.safeParse({ ...validRow, guardrail_cleared_at: 'cleared' }).success,
    ).toBe(false);
  });
});

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
  PlanItemRowSchema,
  PlanTileSummarySchema,
  ClearedAllergyEntrySchema,
  ScaffoldingDiffSchema,
  BriefStateRowSchema,
  BriefResponseSchema,
  SwapPlanItemInputSchema,
  PausePlanDayInputSchema,
  RegeneratePlanQuerySchema,
  RegeneratePlanResponseSchema,
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

describe('PlanComposeInputSchema (Story 3.7 — per-child/per-slot days)', () => {
  const validInput = {
    household_id: UUID1,
    week_of: '2026-05-11',
    days: [
      {
        day: 'monday' as const,
        items: [{ child_id: UUID2, slot: 'main', ingredients: ['rice', 'lentils'] }],
      },
    ],
    prompt_version: 'v1.0.0',
  };

  it('round-trips a valid input', () => {
    expect(PlanComposeInputSchema.safeParse(validInput).success).toBe(true);
  });

  it('rejects missing household_id', () => {
    const { household_id: _drop, ...rest } = validInput;
    expect(PlanComposeInputSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty days array', () => {
    expect(
      PlanComposeInputSchema.safeParse({ ...validInput, days: [] }).success,
    ).toBe(false);
  });

  it('rejects an item with empty ingredients', () => {
    expect(
      PlanComposeInputSchema.safeParse({
        ...validInput,
        days: [
          { day: 'monday', items: [{ child_id: UUID2, slot: 'main', ingredients: [] }] },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects non-date week_of', () => {
    expect(
      PlanComposeInputSchema.safeParse({ ...validInput, week_of: 'next-week' }).success,
    ).toBe(false);
  });

  it('rejects an input missing prompt_version', () => {
    const { prompt_version: _drop, ...rest } = validInput;
    expect(PlanComposeInputSchema.safeParse(rest).success).toBe(false);
  });
});

describe('PlanComposeOutputSchema (Story 3.7 — carries plan_id)', () => {
  const PLAN_ID = '00000000-0000-4000-8000-000000000099';
  const validOutput = {
    plan_id: PLAN_ID,
    household_id: UUID1,
    week_of: '2026-05-11',
    days: [
      {
        day: 'monday' as const,
        items: [{ child_id: UUID2, slot: 'main', ingredients: ['rice', 'lentils'] }],
      },
    ],
    prompt_version: 'v1.0.0',
  };

  it('round-trips a valid output with plan_id', () => {
    expect(PlanComposeOutputSchema.safeParse(validOutput).success).toBe(true);
  });

  it('rejects an output missing plan_id', () => {
    const { plan_id: _drop, ...rest } = validOutput;
    expect(PlanComposeOutputSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an output with empty days array', () => {
    expect(PlanComposeOutputSchema.safeParse({ ...validOutput, days: [] }).success).toBe(false);
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
    week_of: '2026-05-04',
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

describe('PlanItemRowSchema', () => {
  const validRow = {
    id: '00000000-0000-4000-8000-000000000010',
    plan_id: UUID1,
    child_id: UUID2,
    day: 'monday',
    slot: 'main',
    recipe_id: '00000000-0000-4000-8000-000000000011',
    item_id: '00000000-0000-4000-8000-000000000012',
    ingredients: ['rice', 'lentils'],
    created_at: '2026-05-02T11:00:00.000Z',
    updated_at: '2026-05-02T11:00:01.000Z',
  };

  it('round-trips a valid row', () => {
    expect(PlanItemRowSchema.safeParse(validRow).success).toBe(true);
  });

  it('accepts null recipe_id and item_id', () => {
    expect(
      PlanItemRowSchema.safeParse({ ...validRow, recipe_id: null, item_id: null }).success,
    ).toBe(true);
  });

  it('rejects missing plan_id', () => {
    const { plan_id: _drop, ...rest } = validRow;
    expect(PlanItemRowSchema.safeParse(rest).success).toBe(false);
  });
});

describe('PlanTileSummarySchema', () => {
  const validSummary = {
    day: 'monday',
    items: [
      { child_id: UUID1, slot: 'main', ingredients: ['rice'] },
      {
        child_id: UUID2,
        slot: 'main',
        ingredients: ['rice'],
        recipe_id: '00000000-0000-4000-8000-000000000020',
      },
    ],
  };

  it('round-trips a valid summary', () => {
    expect(PlanTileSummarySchema.safeParse(validSummary).success).toBe(true);
  });

  it('accepts saturday as a valid school day', () => {
    expect(
      PlanTileSummarySchema.safeParse({ ...validSummary, day: 'saturday' }).success,
    ).toBe(true);
  });

  it('rejects unknown day value', () => {
    expect(
      PlanTileSummarySchema.safeParse({ ...validSummary, day: 'sunday' }).success,
    ).toBe(false);
  });

  it('rejects an item with empty-string ingredient', () => {
    expect(
      PlanTileSummarySchema.safeParse({
        day: 'monday',
        items: [{ child_id: UUID1, slot: 'main', ingredients: [''] }],
      }).success,
    ).toBe(false);
  });
});

describe('ClearedAllergyEntrySchema (Story 3.10)', () => {
  const validEntry = {
    child_id: UUID1,
    child_name: 'Asha',
    allergen: 'peanut',
  };

  it('parses a valid entry', () => {
    expect(ClearedAllergyEntrySchema.safeParse(validEntry).success).toBe(true);
  });

  it('rejects missing child_id', () => {
    const { child_id: _drop, ...rest } = validEntry;
    expect(ClearedAllergyEntrySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects non-uuid child_id', () => {
    expect(
      ClearedAllergyEntrySchema.safeParse({ ...validEntry, child_id: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('rejects missing child_name', () => {
    const { child_name: _drop, ...rest } = validEntry;
    expect(ClearedAllergyEntrySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty child_name', () => {
    expect(
      ClearedAllergyEntrySchema.safeParse({ ...validEntry, child_name: '' }).success,
    ).toBe(false);
  });

  it('rejects missing allergen', () => {
    const { allergen: _drop, ...rest } = validEntry;
    expect(ClearedAllergyEntrySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty allergen', () => {
    expect(
      ClearedAllergyEntrySchema.safeParse({ ...validEntry, allergen: '' }).success,
    ).toBe(false);
  });
});

describe('ScaffoldingDiffSchema (Story 3.11)', () => {
  it('parses a valid entry with only summary', () => {
    expect(
      ScaffoldingDiffSchema.safeParse({ summary: 'Swapped Tuesday’s protein' }).success,
    ).toBe(true);
  });

  it('parses a valid entry with both summary and explanation', () => {
    expect(
      ScaffoldingDiffSchema.safeParse({
        summary: 'Swapped Tuesday’s protein',
        explanation: 'Pantry had no chicken this week.',
      }).success,
    ).toBe(true);
  });

  it('rejects an entry with an empty summary (min 1)', () => {
    expect(ScaffoldingDiffSchema.safeParse({ summary: '' }).success).toBe(false);
  });

  it('rejects an entry where summary exceeds 200 chars', () => {
    expect(
      ScaffoldingDiffSchema.safeParse({ summary: 'x'.repeat(201) }).success,
    ).toBe(false);
  });

  it('treats explanation as optional', () => {
    const parsed = ScaffoldingDiffSchema.safeParse({ summary: 'Swapped protein' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.explanation).toBeUndefined();
    }
  });

  it('rejects an entry with an empty explanation (min 1)', () => {
    expect(
      ScaffoldingDiffSchema.safeParse({ summary: 'Swapped protein', explanation: '' }).success,
    ).toBe(false);
  });

  it('rejects an entry where explanation exceeds 500 chars', () => {
    expect(
      ScaffoldingDiffSchema.safeParse({ summary: 'Swapped protein', explanation: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
});

describe('BriefStateRowSchema', () => {
  const validRow = {
    household_id: UUID1,
    moment_headline: '',
    lumi_note: '',
    memory_prose: '',
    plan_tile_summaries: [
      {
        day: 'monday' as const,
        items: [{ child_id: UUID2, slot: 'main', ingredients: ['rice'] }],
      },
    ],
    cleared_allergies: [
      { child_id: UUID2, child_name: 'Asha', allergen: 'peanut' },
    ],
    scaffolding_diff: null,
    generated_at: '2026-05-02T11:00:00.000Z',
    plan_revision: 1,
    updated_at: '2026-05-02T11:00:01.000Z',
  };

  it('round-trips a valid row with empty plan_tile_summaries', () => {
    expect(
      BriefStateRowSchema.safeParse({
        ...validRow,
        plan_tile_summaries: [],
        cleared_allergies: [],
      }).success,
    ).toBe(true);
  });

  it('round-trips a valid row with a populated tile and cleared_allergies', () => {
    expect(BriefStateRowSchema.safeParse(validRow).success).toBe(true);
  });

  it('rejects an invalid tile inside plan_tile_summaries', () => {
    expect(
      BriefStateRowSchema.safeParse({
        ...validRow,
        plan_tile_summaries: [{ day: 'unknown', items: [] }],
      }).success,
    ).toBe(false);
  });

  it('rejects negative plan_revision', () => {
    expect(
      BriefStateRowSchema.safeParse({ ...validRow, plan_revision: -1 }).success,
    ).toBe(false);
  });

  it('defaults cleared_allergies to [] when omitted from input', () => {
    const { cleared_allergies: _drop, ...rest } = validRow;
    const parsed = BriefStateRowSchema.safeParse(rest);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.cleared_allergies).toEqual([]);
    }
  });

  it('rejects an invalid entry inside cleared_allergies', () => {
    expect(
      BriefStateRowSchema.safeParse({
        ...validRow,
        cleared_allergies: [{ child_id: UUID2, child_name: '', allergen: 'peanut' }],
      }).success,
    ).toBe(false);
  });

  it('accepts scaffolding_diff: null', () => {
    const parsed = BriefStateRowSchema.safeParse({ ...validRow, scaffolding_diff: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.scaffolding_diff).toBeNull();
    }
  });

  it('defaults scaffolding_diff to null when omitted from input', () => {
    const { scaffolding_diff: _drop, ...rest } = validRow;
    const parsed = BriefStateRowSchema.safeParse(rest);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.scaffolding_diff).toBeNull();
    }
  });

  it('round-trips a populated scaffolding_diff with summary + explanation', () => {
    const parsed = BriefStateRowSchema.safeParse({
      ...validRow,
      scaffolding_diff: {
        summary: 'Swapped protein',
        explanation: 'Pantry had no chicken.',
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.scaffolding_diff).toEqual({
        summary: 'Swapped protein',
        explanation: 'Pantry had no chicken.',
      });
    }
  });
});

describe('BriefResponseSchema', () => {
  const validBriefRow = {
    household_id: UUID1,
    moment_headline: '',
    lumi_note: '',
    memory_prose: '',
    plan_tile_summaries: [],
    generated_at: '2026-05-02T11:00:00.000Z',
    plan_revision: 0,
    updated_at: '2026-05-02T11:00:01.000Z',
  };

  it('accepts a null brief (no projection committed yet)', () => {
    expect(BriefResponseSchema.safeParse({ brief: null }).success).toBe(true);
  });

  it('accepts a populated brief row', () => {
    expect(BriefResponseSchema.safeParse({ brief: validBriefRow }).success).toBe(true);
  });

  it('rejects a missing brief field', () => {
    expect(BriefResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe('PlanTileItemSchema (Story 3.12 — plan_item_id)', () => {
  it('parses a tile item with plan_item_id present', () => {
    const result = PlanTileSummarySchema.safeParse({
      day: 'monday',
      items: [
        {
          plan_item_id: '00000000-0000-4000-8000-000000000050',
          child_id: UUID1,
          slot: 'main',
          ingredients: ['rice'],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('parses a tile item without plan_item_id — defaults to null for pre-3.12 cached rows', () => {
    const result = PlanTileSummarySchema.safeParse({
      day: 'monday',
      items: [{ child_id: UUID1, slot: 'main', ingredients: ['rice'] }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].plan_item_id).toBeNull();
    }
  });

  it('rejects a non-uuid plan_item_id', () => {
    expect(
      PlanTileSummarySchema.safeParse({
        day: 'monday',
        items: [
          {
            plan_item_id: 'not-a-uuid',
            child_id: UUID1,
            slot: 'main',
            ingredients: ['rice'],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('PlanTileSummarySchema — paused (Story 3.12)', () => {
  const validSummary = {
    day: 'monday' as const,
    items: [{ child_id: UUID1, slot: 'main', ingredients: ['rice'] }],
  };

  it('defaults paused to false when omitted', () => {
    const parsed = PlanTileSummarySchema.safeParse(validSummary);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.paused).toBe(false);
    }
  });

  it('round-trips paused: true', () => {
    const parsed = PlanTileSummarySchema.safeParse({ ...validSummary, paused: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.paused).toBe(true);
    }
  });
});

describe('PlanItemRowSchema — paused_at (Story 3.12)', () => {
  const validRow = {
    id: '00000000-0000-4000-8000-000000000010',
    plan_id: UUID1,
    child_id: UUID2,
    day: 'monday',
    slot: 'main',
    recipe_id: null,
    item_id: null,
    ingredients: ['rice'],
    created_at: '2026-05-02T11:00:00.000Z',
    updated_at: '2026-05-02T11:00:01.000Z',
  };

  it('parses with paused_at: null', () => {
    expect(
      PlanItemRowSchema.safeParse({ ...validRow, paused_at: null }).success,
    ).toBe(true);
  });

  it('parses with paused_at as a datetime string', () => {
    expect(
      PlanItemRowSchema.safeParse({
        ...validRow,
        paused_at: '2026-05-04T12:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('defaults paused_at to null when omitted', () => {
    const parsed = PlanItemRowSchema.safeParse(validRow);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.paused_at).toBeNull();
    }
  });

  it('rejects non-datetime paused_at', () => {
    expect(
      PlanItemRowSchema.safeParse({ ...validRow, paused_at: 'yesterday' }).success,
    ).toBe(false);
  });
});

describe('BriefStateRowSchema — plan_id (Story 3.12)', () => {
  const baseRow = {
    household_id: UUID1,
    moment_headline: '',
    lumi_note: '',
    memory_prose: '',
    plan_tile_summaries: [],
    cleared_allergies: [],
    scaffolding_diff: null,
    generated_at: '2026-05-02T11:00:00.000Z',
    plan_revision: 0,
    updated_at: '2026-05-02T11:00:01.000Z',
  };

  it('parses with plan_id: null', () => {
    const parsed = BriefStateRowSchema.safeParse({ ...baseRow, plan_id: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.plan_id).toBeNull();
    }
  });

  it('parses with a valid uuid plan_id', () => {
    const parsed = BriefStateRowSchema.safeParse({
      ...baseRow,
      plan_id: '00000000-0000-4000-8000-000000000099',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.plan_id).toBe('00000000-0000-4000-8000-000000000099');
    }
  });

  it('defaults plan_id to null when omitted', () => {
    const parsed = BriefStateRowSchema.safeParse(baseRow);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.plan_id).toBeNull();
    }
  });

  it('rejects non-uuid plan_id', () => {
    expect(
      BriefStateRowSchema.safeParse({ ...baseRow, plan_id: 'not-a-uuid' }).success,
    ).toBe(false);
  });
});

describe('SwapPlanItemInputSchema (Story 3.12)', () => {
  it('parses a body with only ingredients', () => {
    expect(
      SwapPlanItemInputSchema.safeParse({ ingredients: ['hummus', 'crackers'] }).success,
    ).toBe(true);
  });

  it('parses a body with optional recipe_id and item_id', () => {
    expect(
      SwapPlanItemInputSchema.safeParse({
        ingredients: ['hummus'],
        recipe_id: '00000000-0000-4000-8000-000000000060',
        item_id: '00000000-0000-4000-8000-000000000061',
      }).success,
    ).toBe(true);
  });

  it('rejects empty ingredients array', () => {
    expect(SwapPlanItemInputSchema.safeParse({ ingredients: [] }).success).toBe(false);
  });

  it('rejects ingredients with empty-string entry', () => {
    expect(
      SwapPlanItemInputSchema.safeParse({ ingredients: [''] }).success,
    ).toBe(false);
  });

  it('rejects non-uuid recipe_id', () => {
    expect(
      SwapPlanItemInputSchema.safeParse({
        ingredients: ['hummus'],
        recipe_id: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });
});

describe('RegeneratePlanQuerySchema (Story 3.13)', () => {
  it('parses { scope: week } without day', () => {
    expect(RegeneratePlanQuerySchema.safeParse({ scope: 'week' }).success).toBe(true);
  });

  it('parses { scope: day, day: tuesday }', () => {
    expect(
      RegeneratePlanQuerySchema.safeParse({ scope: 'day', day: 'tuesday' }).success,
    ).toBe(true);
  });

  it('rejects { scope: day } without a day param', () => {
    expect(RegeneratePlanQuerySchema.safeParse({ scope: 'day' }).success).toBe(false);
  });

  it('rejects unknown scope value', () => {
    expect(RegeneratePlanQuerySchema.safeParse({ scope: 'month' }).success).toBe(false);
  });

  it('rejects unknown day value', () => {
    expect(
      RegeneratePlanQuerySchema.safeParse({ scope: 'day', day: 'sunday' }).success,
    ).toBe(false);
  });

  it('rejects { scope: week, day: tuesday } — day must be absent when scope=week', () => {
    expect(
      RegeneratePlanQuerySchema.safeParse({ scope: 'week', day: 'tuesday' }).success,
    ).toBe(false);
  });
});

describe('RegeneratePlanResponseSchema (Story 3.13)', () => {
  it('parses a valid 202 body', () => {
    expect(
      RegeneratePlanResponseSchema.safeParse({
        job_id: 'regen-1',
        rate_limit_remaining: 4,
      }).success,
    ).toBe(true);
  });

  it('rejects empty job_id', () => {
    expect(
      RegeneratePlanResponseSchema.safeParse({
        job_id: '',
        rate_limit_remaining: 4,
      }).success,
    ).toBe(false);
  });

  it('rejects negative rate_limit_remaining', () => {
    expect(
      RegeneratePlanResponseSchema.safeParse({
        job_id: 'regen-1',
        rate_limit_remaining: -1,
      }).success,
    ).toBe(false);
  });
});

describe('CommitPlanInputSchema — week_of (Story 3.13)', () => {
  const validInput = {
    plan_id: '00000000-0000-4000-8000-000000000001',
    household_id: '00000000-0000-4000-8000-000000000002',
    week_id: '00000000-0000-4000-8000-000000000003',
    week_of: '2026-04-28',
    revision: 1,
    generated_at: '2026-05-02T11:00:00.000Z',
    prompt_version: 'v1.0.0',
    items: [
      {
        child_id: '00000000-0000-4000-8000-000000000001',
        day: 'monday',
        slot: 'main',
        ingredients: ['rice'],
      },
    ],
  };

  it('round-trips with week_of present', () => {
    expect(CommitPlanInputSchema.safeParse(validInput).success).toBe(true);
  });

  it('rejects when week_of is missing', () => {
    const { week_of: _drop, ...rest } = validInput;
    expect(CommitPlanInputSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects when week_of is not an ISO date', () => {
    expect(
      CommitPlanInputSchema.safeParse({ ...validInput, week_of: 'next-week' }).success,
    ).toBe(false);
  });
});

describe('PlanRowSchema — week_of (Story 3.13)', () => {
  const baseRow = {
    id: '00000000-0000-4000-8000-000000000001',
    household_id: '00000000-0000-4000-8000-000000000002',
    week_id: '00000000-0000-4000-8000-000000000003',
    revision: 1,
    generated_at: '2026-05-02T11:00:00.000Z',
    guardrail_cleared_at: '2026-05-02T11:00:01.000Z',
    guardrail_version: '1.1.0',
    prompt_version: 'v1.0.0',
    created_at: '2026-05-02T11:00:00.000Z',
    updated_at: '2026-05-02T11:00:01.000Z',
  };

  it('parses with week_of: null', () => {
    expect(PlanRowSchema.safeParse({ ...baseRow, week_of: null }).success).toBe(true);
  });

  it('parses with a valid ISO week_of', () => {
    expect(
      PlanRowSchema.safeParse({ ...baseRow, week_of: '2026-04-28' }).success,
    ).toBe(true);
  });

  it('defaults week_of to null when omitted', () => {
    const parsed = PlanRowSchema.safeParse(baseRow);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.week_of).toBeNull();
    }
  });
});

describe('PlanItemRowSchema — replaced_by_plan_id (Story 3.13)', () => {
  const baseRow = {
    id: '00000000-0000-4000-8000-000000000010',
    plan_id: '00000000-0000-4000-8000-000000000001',
    child_id: '00000000-0000-4000-8000-000000000002',
    day: 'monday',
    slot: 'main',
    recipe_id: null,
    item_id: null,
    ingredients: ['rice'],
    paused_at: null,
    created_at: '2026-05-02T11:00:00.000Z',
    updated_at: '2026-05-02T11:00:01.000Z',
  };

  it('parses with replaced_by_plan_id: null', () => {
    expect(
      PlanItemRowSchema.safeParse({ ...baseRow, replaced_by_plan_id: null }).success,
    ).toBe(true);
  });

  it('parses with a valid uuid replaced_by_plan_id', () => {
    expect(
      PlanItemRowSchema.safeParse({
        ...baseRow,
        replaced_by_plan_id: '00000000-0000-4000-8000-000000000001',
      }).success,
    ).toBe(true);
  });

  it('defaults replaced_by_plan_id to null when omitted', () => {
    const parsed = PlanItemRowSchema.safeParse(baseRow);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.replaced_by_plan_id).toBeNull();
    }
  });

  it('rejects non-uuid replaced_by_plan_id', () => {
    expect(
      PlanItemRowSchema.safeParse({
        ...baseRow,
        replaced_by_plan_id: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });
});

describe('PausePlanDayInputSchema (Story 3.12)', () => {
  it('parses an empty body (reason is optional)', () => {
    expect(PausePlanDayInputSchema.safeParse({}).success).toBe(true);
  });

  it('parses with reason: sick', () => {
    expect(PausePlanDayInputSchema.safeParse({ reason: 'sick' }).success).toBe(true);
  });

  it('parses with reason: absent', () => {
    expect(PausePlanDayInputSchema.safeParse({ reason: 'absent' }).success).toBe(true);
  });

  it('parses with reason: holiday', () => {
    expect(PausePlanDayInputSchema.safeParse({ reason: 'holiday' }).success).toBe(true);
  });

  it('rejects unknown reason', () => {
    expect(PausePlanDayInputSchema.safeParse({ reason: 'other' }).success).toBe(false);
  });
});

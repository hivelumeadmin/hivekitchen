import { describe, it, expect } from 'vitest';
import {
  CommitPlanTreeInputSchema,
  PlanComposeTreeInputSchema,
  PlanComposeTreeOutputSchema,
  PlanDayRowSchema,
  PlanSlotRowSchema,
  PlanSlotVariationRowSchema,
  PlanRowCanonicalSchema,
  PlannerSlotInputSchema,
} from './plan.js';

// Story 3-DM-C1 — verifies the tree-shape schemas catch the same XOR /
// pause-consistency / sequence-cross-validation invariants the DB CHECK
// constraints enforce. These tests are the contract-layer mirror of
// supabase/migrations/20261010000000_plan_structure_canonical.sql.

const PLAN = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD = '22222222-2222-4222-8222-222222222222';
const DAY = '33333333-3333-4333-8333-333333333333';
const SLOT = '44444444-4444-4444-8444-444444444444';
const VARIATION = '55555555-5555-4555-8555-555555555555';
const CHILD_A = '66666666-6666-4666-8666-666666666666';
const RECIPE = '77777777-7777-4777-8777-777777777777';
const MAIN_ASSIGN = '88888888-8888-4888-8888-888888888888';
const NOW = '2026-06-01T12:00:00.000Z';

function validVariationRow() {
  return {
    id: VARIATION,
    plan_slot_id: SLOT,
    child_id: CHILD_A,
    portion_size: 'regular' as const,
    texture: 'normal' as const,
    spice_level: 'mild' as const,
    cutting_style: null,
    container: null,
    add_ons: [],
    removals: [],
    notes: null,
    paused_at: null,
    created_at: NOW,
    updated_at: NOW,
  };
}

describe('PlanRowCanonicalSchema', () => {
  it('accepts a row with absorbed state fields nulled', () => {
    expect(
      PlanRowCanonicalSchema.safeParse({
        id: PLAN,
        household_id: HOUSEHOLD,
        week_of: '2026-06-01',
        revision: 1,
        generated_at: NOW,
        guardrail_cleared_at: NOW,
        guardrail_version: '1.1.0',
        prompt_version: 'v1.0.0',
        created_at: NOW,
        updated_at: NOW,
      }).success,
    ).toBe(true);
  });

  it('rejects nullable week_of (post-cutover requires non-null date)', () => {
    expect(
      PlanRowCanonicalSchema.safeParse({
        id: PLAN,
        household_id: HOUSEHOLD,
        week_of: null,
        revision: 1,
        generated_at: NOW,
        guardrail_cleared_at: null,
        guardrail_version: null,
        prompt_version: 'v1.0.0',
        created_at: NOW,
        updated_at: NOW,
      }).success,
    ).toBe(false);
  });
});

describe('PlanDayRowSchema — pause consistency mirror', () => {
  const base = {
    id: DAY,
    plan_id: PLAN,
    day: 'monday' as const,
    paused_at: null,
    paused_reason: null,
    paused_note: null,
    created_at: NOW,
    updated_at: NOW,
  };

  it('accepts an unpaused day', () => {
    expect(PlanDayRowSchema.safeParse(base).success).toBe(true);
  });

  it('accepts a properly paused day', () => {
    expect(
      PlanDayRowSchema.safeParse({
        ...base,
        paused_at: NOW,
        paused_reason: 'snow_day',
        paused_note: 'school closed for weather',
      }).success,
    ).toBe(true);
  });

  it('rejects a half-paused day (paused_at without reason)', () => {
    expect(
      PlanDayRowSchema.safeParse({
        ...base,
        paused_at: NOW,
        paused_reason: null,
      }).success,
    ).toBe(false);
  });

  it('rejects paused_note set without paused_at', () => {
    expect(
      PlanDayRowSchema.safeParse({
        ...base,
        paused_note: 'orphan note',
      }).success,
    ).toBe(false);
  });
});

describe('PlanSlotRowSchema — XOR mirror of DB CHECK constraints', () => {
  const base = {
    id: SLOT,
    plan_day_id: DAY,
    main_assignment_id: null,
    recipe_id: null,
    extra_kind: null,
    paused_at: null,
    created_at: NOW,
    updated_at: NOW,
  };

  it('accepts main slot with main_assignment_id', () => {
    expect(
      PlanSlotRowSchema.safeParse({
        ...base,
        slot_kind: 'main',
        main_assignment_id: MAIN_ASSIGN,
      }).success,
    ).toBe(true);
  });

  it('rejects main slot missing main_assignment_id', () => {
    expect(
      PlanSlotRowSchema.safeParse({ ...base, slot_kind: 'main' }).success,
    ).toBe(false);
  });

  it('accepts snack slot with recipe_id', () => {
    expect(
      PlanSlotRowSchema.safeParse({
        ...base,
        slot_kind: 'snack',
        recipe_id: RECIPE,
      }).success,
    ).toBe(true);
  });

  it('rejects snack slot carrying main_assignment_id', () => {
    expect(
      PlanSlotRowSchema.safeParse({
        ...base,
        slot_kind: 'snack',
        recipe_id: RECIPE,
        main_assignment_id: MAIN_ASSIGN,
      }).success,
    ).toBe(false);
  });

  it('accepts extra slot with recipe_id + extra_kind', () => {
    expect(
      PlanSlotRowSchema.safeParse({
        ...base,
        slot_kind: 'extra',
        recipe_id: RECIPE,
        extra_kind: 'sports_add',
      }).success,
    ).toBe(true);
  });

  it('rejects extra slot missing extra_kind', () => {
    expect(
      PlanSlotRowSchema.safeParse({
        ...base,
        slot_kind: 'extra',
        recipe_id: RECIPE,
      }).success,
    ).toBe(false);
  });
});

describe('PlanSlotVariationRowSchema', () => {
  it('accepts a default variation row', () => {
    expect(PlanSlotVariationRowSchema.safeParse(validVariationRow()).success).toBe(true);
  });

  it('rejects oversized notes', () => {
    expect(
      PlanSlotVariationRowSchema.safeParse({
        ...validVariationRow(),
        notes: 'x'.repeat(281),
      }).success,
    ).toBe(false);
  });
});

describe('PlannerSlotInputSchema — planner-emit XOR mirror', () => {
  it('accepts main slot with sequence handle', () => {
    expect(
      PlannerSlotInputSchema.safeParse({
        slot_kind: 'main',
        main_assignment_sequence: 1,
        variations: [{ child_id: CHILD_A }],
      }).success,
    ).toBe(true);
  });

  it('rejects main slot with recipe_id present', () => {
    expect(
      PlannerSlotInputSchema.safeParse({
        slot_kind: 'main',
        main_assignment_sequence: 1,
        recipe_id: RECIPE,
        variations: [],
      }).success,
    ).toBe(false);
  });

  it('accepts snack slot with recipe_candidate_id (discover path)', () => {
    expect(
      PlannerSlotInputSchema.safeParse({
        slot_kind: 'snack',
        recipe_candidate_id: RECIPE,
        variations: [],
      }).success,
    ).toBe(true);
  });

  it('rejects when both recipe_id and recipe_candidate_id are present', () => {
    expect(
      PlannerSlotInputSchema.safeParse({
        slot_kind: 'snack',
        recipe_id: RECIPE,
        recipe_candidate_id: RECIPE,
        variations: [],
      }).success,
    ).toBe(false);
  });

  it('rejects extra slot missing extra_kind', () => {
    expect(
      PlannerSlotInputSchema.safeParse({
        slot_kind: 'extra',
        recipe_id: RECIPE,
        variations: [],
      }).success,
    ).toBe(false);
  });
});

describe('PlanComposeTreeInputSchema — cross-validation', () => {
  const baseInput = {
    household_id: HOUSEHOLD,
    week_of: '2026-06-01',
    prompt_version: 'v1.0.0',
    main_assignments: [
      { sequence: 1, recipe_id: RECIPE },
      { sequence: 2, recipe_id: RECIPE },
    ],
    days: [
      {
        day: 'monday' as const,
        slots: [
          {
            slot_kind: 'main' as const,
            main_assignment_sequence: 1,
            variations: [{ child_id: CHILD_A }],
          },
        ],
      },
    ],
  };

  it('accepts a coherent tree', () => {
    expect(PlanComposeTreeInputSchema.safeParse(baseInput).success).toBe(true);
  });

  it('rejects a slot referencing an undeclared sequence', () => {
    expect(
      PlanComposeTreeInputSchema.safeParse({
        ...baseInput,
        days: [
          {
            day: 'monday' as const,
            slots: [
              {
                slot_kind: 'main' as const,
                main_assignment_sequence: 9,
                variations: [{ child_id: CHILD_A }],
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate main_assignments.sequence', () => {
    expect(
      PlanComposeTreeInputSchema.safeParse({
        ...baseInput,
        main_assignments: [
          { sequence: 1, recipe_id: RECIPE },
          { sequence: 1, recipe_id: RECIPE },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects sequence > 6 (Mon-Sat ceiling per Q3)', () => {
    expect(
      PlanComposeTreeInputSchema.safeParse({
        ...baseInput,
        main_assignments: [{ sequence: 7, recipe_id: RECIPE }],
      }).success,
    ).toBe(false);
  });
});

describe('PlanComposeTreeOutputSchema + CommitPlanTreeInputSchema', () => {
  const treeBody = {
    plan_id: PLAN,
    household_id: HOUSEHOLD,
    week_of: '2026-06-01',
    prompt_version: 'v1.0.0',
    main_assignments: [{ sequence: 1, recipe_id: RECIPE }],
    days: [
      {
        day: 'monday' as const,
        slots: [
          {
            slot_kind: 'main' as const,
            main_assignment_sequence: 1,
            variations: [
              { child_id: CHILD_A, portion_size: 'small' as const },
            ],
          },
          {
            slot_kind: 'snack' as const,
            recipe_id: RECIPE,
            variations: [{ child_id: CHILD_A }],
          },
        ],
      },
    ],
  };

  it('PlanComposeTreeOutputSchema accepts a tree with multiple slot kinds', () => {
    expect(PlanComposeTreeOutputSchema.safeParse(treeBody).success).toBe(true);
  });

  it('CommitPlanTreeInputSchema accepts repository commit input', () => {
    expect(
      CommitPlanTreeInputSchema.safeParse({
        plan_id: PLAN,
        household_id: HOUSEHOLD,
        week_of: '2026-06-01',
        revision: 1,
        generated_at: NOW,
        prompt_version: 'v1.0.0',
        main_assignments: treeBody.main_assignments,
        days: treeBody.days,
      }).success,
    ).toBe(true);
  });
});

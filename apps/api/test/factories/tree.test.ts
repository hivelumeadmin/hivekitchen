import { describe, it, expect } from 'vitest';
import {
  buildPlanDay,
  buildPlanMainAssignment,
  buildPlanSlot,
  buildPlanSlotVariation,
  buildPlanTree,
  TEST_IDS,
} from './index.js';
import {
  PlanDayRowSchema,
  PlanMainAssignmentRowSchema,
  PlanSlotRowSchema,
  PlanSlotVariationRowSchema,
} from '@hivekitchen/contracts';

// Story 3-DM-C1 Phase 8 — verifies the new tree-shape factories produce rows
// that satisfy the contract schemas (PlanDayRowSchema etc), so any drift
// between factory defaults and the migration shape surfaces at test time.

describe('tree-shape factory defaults parse cleanly against the contract schemas', () => {
  it('buildPlanMainAssignment() parses PlanMainAssignmentRowSchema', () => {
    expect(PlanMainAssignmentRowSchema.safeParse(buildPlanMainAssignment()).success).toBe(true);
  });

  it('buildPlanDay() parses PlanDayRowSchema', () => {
    expect(PlanDayRowSchema.safeParse(buildPlanDay()).success).toBe(true);
  });

  it('buildPlanSlot() default (main slot) parses PlanSlotRowSchema', () => {
    expect(PlanSlotRowSchema.safeParse(buildPlanSlot()).success).toBe(true);
  });

  it('buildPlanSlot({ slot_kind: snack, recipe_id }) parses', () => {
    const snack = buildPlanSlot({
      id: '11111111-1111-4111-8111-111111111112',
      slot_kind: 'snack',
      main_assignment_id: null,
      recipe_id: TEST_IDS.recipe,
    });
    expect(PlanSlotRowSchema.safeParse(snack).success).toBe(true);
  });

  it('buildPlanSlot({ slot_kind: extra, recipe_id, extra_kind }) parses', () => {
    const extra = buildPlanSlot({
      id: '11111111-1111-4111-8111-111111111113',
      slot_kind: 'extra',
      main_assignment_id: null,
      recipe_id: TEST_IDS.recipe,
      extra_kind: 'protein_boost',
    });
    expect(PlanSlotRowSchema.safeParse(extra).success).toBe(true);
  });

  it('buildPlanSlot({ slot_kind: main, recipe_id }) FAILS the XOR check', () => {
    const malformed = buildPlanSlot({
      slot_kind: 'main',
      recipe_id: TEST_IDS.recipe,  // main slots must NOT carry recipe_id
    });
    expect(PlanSlotRowSchema.safeParse(malformed).success).toBe(false);
  });

  it('buildPlanSlotVariation() parses PlanSlotVariationRowSchema', () => {
    expect(PlanSlotVariationRowSchema.safeParse(buildPlanSlotVariation()).success).toBe(true);
  });
});

describe('buildPlanTree', () => {
  it('produces a 1-of-each-kind fixture by default', () => {
    const tree = buildPlanTree();
    expect(tree.mainAssignments).toHaveLength(1);
    expect(tree.days).toHaveLength(1);
    expect(tree.slots).toHaveLength(1);
    expect(tree.variations).toHaveLength(1);
    expect(tree.days[0]?.day).toBe('monday');
    expect(tree.slots[0]?.slot_kind).toBe('main');
    expect(tree.slots[0]?.main_assignment_id).toBe(TEST_IDS.mainAssignment);
  });

  it('accepts a full override tree (multi-day, multi-slot)', () => {
    const tree = buildPlanTree({
      mainAssignments: [
        buildPlanMainAssignment({ sequence: 1 }),
        buildPlanMainAssignment({
          id: '11111111-1111-4111-8111-111111111114',
          sequence: 2,
        }),
      ],
      days: [
        buildPlanDay(),
        buildPlanDay({
          id: '11111111-1111-4111-8111-111111111115',
          day: 'tuesday',
        }),
      ],
    });
    expect(tree.mainAssignments).toHaveLength(2);
    expect(tree.days).toHaveLength(2);
    expect(tree.days.map((d) => d.day)).toEqual(['monday', 'tuesday']);
  });
});

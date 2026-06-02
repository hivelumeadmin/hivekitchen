import { describe, it, expect } from 'vitest';
import { buildCommitInputTree } from './plan-generation.job.js';
import type { PlanComposeTreeOutput } from '@hivekitchen/types';

// Story 3-DM-C1 Phase 7 — verifies buildCommitInputTree converts a
// PlanComposeTreeOutput into a CommitPlanTreeInput cleanly.

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const RECIPE_M1 = '44444444-4444-4444-8444-444444444444';
const RECIPE_M2 = '55555555-5555-4555-8555-555555555555';
const RECIPE_SNACK = '66666666-6666-4666-8666-666666666666';
const RECIPE_CANDIDATE = '77777777-7777-4777-8777-777777777777';
const CHILD_A = '88888888-8888-4888-8888-888888888888';
const CHILD_B = '99999999-9999-4999-8999-999999999999';

function buildOutput(overrides: Partial<PlanComposeTreeOutput> = {}): PlanComposeTreeOutput {
  return {
    plan_id: PLAN_ID,
    household_id: HOUSEHOLD,
    week_of: '2026-06-01',
    prompt_version: 'v2.0.0',
    main_assignments: [
      { sequence: 1, recipe_id: RECIPE_M1 },
      { sequence: 2, recipe_id: RECIPE_M2 },
    ],
    days: [
      {
        day: 'monday',
        slots: [
          {
            slot_kind: 'main',
            main_assignment_sequence: 1,
            variations: [
              { child_id: CHILD_A, portion_size: 'regular' },
              { child_id: CHILD_B, portion_size: 'small', texture: 'soft' },
            ],
          },
          {
            slot_kind: 'snack',
            recipe_id: RECIPE_SNACK,
            variations: [{ child_id: CHILD_A }, { child_id: CHILD_B }],
          },
        ],
      },
      {
        day: 'wednesday',
        slots: [
          {
            slot_kind: 'main',
            main_assignment_sequence: 2,
            variations: [
              {
                child_id: CHILD_A,
                removals: ['peanut paste'],
                add_ons: ['coconut cream'],
              },
              { child_id: CHILD_B, portion_size: 'small' },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('buildCommitInputTree', () => {
  it('passes through plan_id / household_id / week_of / prompt_version', () => {
    const out = buildOutput();
    const input = buildCommitInputTree(out, REQUEST_ID);
    expect(input.plan_id).toBe(PLAN_ID);
    expect(input.household_id).toBe(HOUSEHOLD);
    expect(input.week_of).toBe('2026-06-01');
    expect(input.prompt_version).toBe('v2.0.0');
  });

  it('threads requestId through as plan_build_id (Story 3-31 candidate resolver)', () => {
    const input = buildCommitInputTree(buildOutput(), REQUEST_ID);
    expect(input.plan_build_id).toBe(REQUEST_ID);
  });

  it('sets revision=1 and a fresh generated_at timestamp', () => {
    const before = new Date().toISOString();
    const input = buildCommitInputTree(buildOutput(), REQUEST_ID);
    const after = new Date().toISOString();
    expect(input.revision).toBe(1);
    expect(input.generated_at >= before).toBe(true);
    expect(input.generated_at <= after).toBe(true);
  });

  it('passes main_assignments through 1:1 (no reshape)', () => {
    const out = buildOutput();
    const input = buildCommitInputTree(out, REQUEST_ID);
    expect(input.main_assignments).toEqual(out.main_assignments);
  });

  it('passes days[] through 1:1 (no flattening)', () => {
    const out = buildOutput();
    const input = buildCommitInputTree(out, REQUEST_ID);
    expect(input.days).toEqual(out.days);
    expect(input.days).toHaveLength(2);
    expect(input.days[0]?.slots).toHaveLength(2);
    expect(input.days[1]?.slots).toHaveLength(1);
  });

  it('preserves variation attributes (portion_size, texture, removals, add_ons)', () => {
    const out = buildOutput();
    const input = buildCommitInputTree(out, REQUEST_ID);
    const wedMain = input.days[1]?.slots[0];
    expect(wedMain?.variations[0]).toEqual({
      child_id: CHILD_A,
      removals: ['peanut paste'],
      add_ons: ['coconut cream'],
    });
    expect(wedMain?.variations[1]).toEqual({
      child_id: CHILD_B,
      portion_size: 'small',
    });
  });

  it('preserves a snack slot with recipe_candidate_id (discover path)', () => {
    const out = buildOutput({
      days: [
        {
          day: 'monday',
          slots: [
            {
              slot_kind: 'snack',
              recipe_candidate_id: RECIPE_CANDIDATE,
              variations: [{ child_id: CHILD_A }],
            },
          ],
        },
      ],
    });
    const input = buildCommitInputTree(out, REQUEST_ID);
    expect(input.days[0]?.slots[0]).toEqual(
      expect.objectContaining({ recipe_candidate_id: RECIPE_CANDIDATE }),
    );
  });

  it('does not surface a week_id field (canonical model drops plans.week_id)', () => {
    const input = buildCommitInputTree(buildOutput(), REQUEST_ID);
    expect(input).not.toHaveProperty('week_id');
  });

  it('does not surface a flat items field (legacy CommitPlanInput shape)', () => {
    const input = buildCommitInputTree(buildOutput(), REQUEST_ID);
    expect(input).not.toHaveProperty('items');
  });
});

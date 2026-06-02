import { describe, it, expect } from 'vitest';
import type {
  CommitPlanTreeInput,
  PlanDayRow,
  PlanMainAssignmentRow,
  PlanSlotRow,
  PlanSlotVariationRow,
  PlannerDayInput,
  PlannerSlotInput,
} from '@hivekitchen/types';
import {
  buildPlanDay,
  buildPlanMainAssignment,
  buildPlanSlot,
  buildPlanSlotVariation,
} from '../../test/factories/index.js';
import {
  existingTreeToPlannerShape,
  existingTreeToCommitInput,
  overlayDayScopeOntoFullTree,
  type ExistingPlanTree,
} from './day-scope-merge.helper.js';

// =============================================================================
// day-scope-merge.helper — tests (9b part 3)
// =============================================================================
// Covers the three helpers used by plan-regeneration.job to overlay a
// planner-emitted target day onto the existing plan tree:
//   - existingTreeToPlannerShape — row → planner-input conversion
//   - existingTreeToCommitInput — convert + pack into CommitPlanTreeInput
//   - overlayDayScopeOntoFullTree — replace one day, preserve siblings + Mains
// =============================================================================

const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID_A = '44444444-4444-4444-8444-444444444444';
const RECIPE_PEANUT = '66666666-6666-4666-8666-666666666666';
const RECIPE_SUNFLOWER = '77777777-7777-4777-8777-777777777777';
const MAIN_ID_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MAIN_ID_2 = 'aaaaaaaa-bbbb-4aaa-8aaa-aaaaaaaaaaaa';
const DAY_ID_MON = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DAY_ID_TUE = 'bbbbbbbb-cccc-4bbb-8bbb-bbbbbbbbbbbb';
const SLOT_ID_MON_MAIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SLOT_ID_MON_SNACK = 'cccccccc-dddd-4ccc-8ccc-cccccccccccc';
const SLOT_ID_TUE_MAIN = 'cccccccc-eeee-4ccc-8ccc-cccccccccccc';
const VAR_ID_MON_MAIN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const VAR_ID_TUE_MAIN = 'dddddddd-eeee-4ddd-8ddd-dddddddddddd';
const VAR_ID_MON_SNACK = 'dddddddd-ffff-4ddd-8ddd-dddddddddddd';

function buildTreeMondayTuesday(): ExistingPlanTree {
  const mainAssignments: PlanMainAssignmentRow[] = [
    buildPlanMainAssignment({ id: MAIN_ID_1, sequence: 1, recipe_id: RECIPE_PEANUT }),
    buildPlanMainAssignment({ id: MAIN_ID_2, sequence: 2, recipe_id: RECIPE_SUNFLOWER }),
  ];
  const days: PlanDayRow[] = [
    buildPlanDay({ id: DAY_ID_MON, day: 'monday' }),
    buildPlanDay({ id: DAY_ID_TUE, day: 'tuesday' }),
  ];
  const slots: PlanSlotRow[] = [
    buildPlanSlot({ id: SLOT_ID_MON_MAIN, plan_day_id: DAY_ID_MON, main_assignment_id: MAIN_ID_1 }),
    buildPlanSlot({
      id: SLOT_ID_MON_SNACK,
      plan_day_id: DAY_ID_MON,
      slot_kind: 'snack',
      main_assignment_id: null,
      recipe_id: RECIPE_SUNFLOWER,
    }),
    buildPlanSlot({ id: SLOT_ID_TUE_MAIN, plan_day_id: DAY_ID_TUE, main_assignment_id: MAIN_ID_2 }),
  ];
  const variations: PlanSlotVariationRow[] = [
    buildPlanSlotVariation({
      id: VAR_ID_MON_MAIN,
      plan_slot_id: SLOT_ID_MON_MAIN,
      child_id: CHILD_ID_A,
      portion_size: 'large',
      texture: 'soft',
      add_ons: ['peanut butter'],
    }),
    buildPlanSlotVariation({
      id: VAR_ID_MON_SNACK,
      plan_slot_id: SLOT_ID_MON_SNACK,
      child_id: CHILD_ID_A,
    }),
    buildPlanSlotVariation({
      id: VAR_ID_TUE_MAIN,
      plan_slot_id: SLOT_ID_TUE_MAIN,
      child_id: CHILD_ID_A,
    }),
  ];
  return { mainAssignments, days, slots, variations };
}

function dummyDay(name: PlannerDayInput['day'], slots: PlannerSlotInput[]): PlannerDayInput {
  return { day: name, slots };
}

function dummyMainSlot(seq: number): PlannerSlotInput {
  return {
    slot_kind: 'main',
    main_assignment_sequence: seq,
    variations: [
      {
        child_id: CHILD_ID_A,
        portion_size: 'regular',
        texture: 'normal',
        spice_level: 'mild',
        add_ons: [],
        removals: [],
      },
    ],
  };
}

function buildFullCommit(days: PlannerDayInput[]): CommitPlanTreeInput {
  return {
    plan_id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_of: '2026-05-18',
    revision: 1,
    generated_at: '2026-05-15T11:00:00.000Z',
    prompt_version: 'v2.0.0',
    main_assignments: [
      { sequence: 1, recipe_id: RECIPE_PEANUT },
      { sequence: 2, recipe_id: RECIPE_SUNFLOWER },
    ],
    days,
  };
}

function buildDayScopedCommit(targetDay: PlannerDayInput['day']): CommitPlanTreeInput {
  return {
    plan_id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_of: '2026-05-18',
    revision: 2,
    generated_at: '2026-05-15T12:00:00.000Z',
    prompt_version: 'v2.0.0',
    // The planner-emitted main_assignments are intentionally divergent from
    // the full tree's. Tests assert this gets discarded in favour of the
    // existing tree's mains.
    main_assignments: [{ sequence: 1, recipe_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }],
    days: [dummyDay(targetDay, [dummyMainSlot(1)])],
  };
}

describe('existingTreeToPlannerShape', () => {
  it('packs each slot kind correctly + resolves main_assignment_id → sequence', () => {
    const tree = buildTreeMondayTuesday();
    const { mainAssignments, days } = existingTreeToPlannerShape(tree);

    expect(mainAssignments).toEqual([
      { sequence: 1, recipe_id: RECIPE_PEANUT },
      { sequence: 2, recipe_id: RECIPE_SUNFLOWER },
    ]);
    expect(days).toHaveLength(2);
    const monday = days.find((d) => d.day === 'monday')!;
    const mondayMain = monday.slots.find((s) => s.slot_kind === 'main')!;
    expect(mondayMain.main_assignment_sequence).toBe(1);
    expect(mondayMain.recipe_id).toBeUndefined();
    const mondaySnack = monday.slots.find((s) => s.slot_kind === 'snack')!;
    expect(mondaySnack.recipe_id).toBe(RECIPE_SUNFLOWER);
    expect(mondaySnack.main_assignment_sequence).toBeUndefined();
    const tuesday = days.find((d) => d.day === 'tuesday')!;
    expect(tuesday.slots[0]!.main_assignment_sequence).toBe(2);
  });

  it('preserves variation attributes across the row → planner-input round-trip', () => {
    const tree = buildTreeMondayTuesday();
    const { days } = existingTreeToPlannerShape(tree);
    const monMainVar = days.find((d) => d.day === 'monday')!.slots.find((s) => s.slot_kind === 'main')!.variations[0]!;
    expect(monMainVar.child_id).toBe(CHILD_ID_A);
    expect(monMainVar.portion_size).toBe('large');
    expect(monMainVar.texture).toBe('soft');
    expect(monMainVar.add_ons).toEqual(['peanut butter']);
  });

  it('omits day-level pause fields when the row stores null (no half-paused day in output)', () => {
    const tree = buildTreeMondayTuesday();
    const { days } = existingTreeToPlannerShape(tree);
    const monday = days.find((d) => d.day === 'monday')!;
    expect(monday).not.toHaveProperty('paused_at');
    expect(monday).not.toHaveProperty('paused_reason');
    expect(monday).not.toHaveProperty('paused_note');
  });

  it('preserves day-level pause fields when set', () => {
    const tree = buildTreeMondayTuesday();
    const pausedDays: PlanDayRow[] = [
      buildPlanDay({
        id: DAY_ID_MON,
        day: 'monday',
        paused_at: '2026-05-19T08:00:00.000Z',
        paused_reason: 'sick_day',
        paused_note: 'kid home',
      }),
      buildPlanDay({ id: DAY_ID_TUE, day: 'tuesday' }),
    ];
    const { days } = existingTreeToPlannerShape({ ...tree, days: pausedDays });
    const monday = days.find((d) => d.day === 'monday')!;
    expect(monday.paused_at).toBe('2026-05-19T08:00:00.000Z');
    expect(monday.paused_reason).toBe('sick_day');
    expect(monday.paused_note).toBe('kid home');
  });

  it('throws when a main slot references an unknown main_assignment_id', () => {
    const tree = buildTreeMondayTuesday();
    const brokenSlot = buildPlanSlot({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      plan_day_id: DAY_ID_MON,
      main_assignment_id: 'eeeeeeee-1111-4eee-8eee-eeeeeeeeeeee', // not in mainAssignments
    });
    expect(() =>
      existingTreeToPlannerShape({ ...tree, slots: [...tree.slots, brokenSlot] }),
    ).toThrowError(/unknown main_assignment_id/);
  });
});

describe('overlayDayScopeOntoFullTree', () => {
  it('replaces the target day and preserves other days by reference', () => {
    const full = buildFullCommit([
      dummyDay('monday', [dummyMainSlot(1)]),
      dummyDay('tuesday', [dummyMainSlot(2)]),
    ]);
    const dayScoped = buildDayScopedCommit('monday');
    const merged = overlayDayScopeOntoFullTree({
      fullCommit: full,
      dayScopedCommit: dayScoped,
      targetDay: 'monday',
    });

    // monday replaced by the dayScoped emission
    const mergedMonday = merged.days.find((d) => d.day === 'monday')!;
    expect(mergedMonday).toBe(dayScoped.days[0]);
    // tuesday passes through identical to the full tree's tuesday
    const mergedTuesday = merged.days.find((d) => d.day === 'tuesday')!;
    expect(mergedTuesday).toBe(full.days[1]);
  });

  it('keeps main_assignments from the full tree (discards dayScoped emission)', () => {
    const full = buildFullCommit([
      dummyDay('monday', [dummyMainSlot(1)]),
      dummyDay('tuesday', [dummyMainSlot(2)]),
    ]);
    const dayScoped = buildDayScopedCommit('monday');
    const merged = overlayDayScopeOntoFullTree({
      fullCommit: full,
      dayScopedCommit: dayScoped,
      targetDay: 'monday',
    });
    expect(merged.main_assignments).toEqual(full.main_assignments);
    // Sanity: dayScoped's main_assignments deliberately differed.
    expect(merged.main_assignments).not.toEqual(dayScoped.main_assignments);
  });

  it('inherits revision/generated_at/prompt_version from the dayScoped commit', () => {
    const full = buildFullCommit([dummyDay('monday', [dummyMainSlot(1)])]);
    const dayScoped = buildDayScopedCommit('monday');
    const merged = overlayDayScopeOntoFullTree({
      fullCommit: full,
      dayScopedCommit: dayScoped,
      targetDay: 'monday',
    });
    expect(merged.revision).toBe(dayScoped.revision);
    expect(merged.generated_at).toBe(dayScoped.generated_at);
    expect(merged.prompt_version).toBe(dayScoped.prompt_version);
  });

  it('appends the target day when the full tree does not yet contain it', () => {
    const full = buildFullCommit([dummyDay('monday', [dummyMainSlot(1)])]);
    const dayScoped = buildDayScopedCommit('tuesday');
    const merged = overlayDayScopeOntoFullTree({
      fullCommit: full,
      dayScopedCommit: dayScoped,
      targetDay: 'tuesday',
    });
    expect(merged.days).toHaveLength(2);
    expect(merged.days.find((d) => d.day === 'monday')).toBe(full.days[0]);
    expect(merged.days.find((d) => d.day === 'tuesday')).toBe(dayScoped.days[0]);
  });

  it('throws when the dayScoped commit does not contain the target day', () => {
    const full = buildFullCommit([dummyDay('monday', [dummyMainSlot(1)])]);
    const dayScoped = buildDayScopedCommit('monday');
    expect(() =>
      overlayDayScopeOntoFullTree({
        fullCommit: full,
        dayScopedCommit: dayScoped,
        targetDay: 'tuesday',
      }),
    ).toThrowError(/no day matching targetDay='tuesday'/);
  });
});

describe('existingTreeToCommitInput', () => {
  it('packs the existing tree into a CommitPlanTreeInput using provided plan-context fields', () => {
    const tree = buildTreeMondayTuesday();
    const out = existingTreeToCommitInput({
      existing: tree,
      planId: PLAN_ID,
      householdId: HOUSEHOLD_ID,
      weekOf: '2026-05-18',
      revision: 3,
      promptVersion: 'v2.0.0',
      generatedAt: '2026-05-15T13:00:00.000Z',
      planBuildId: 'build-1',
    });
    expect(out.plan_id).toBe(PLAN_ID);
    expect(out.household_id).toBe(HOUSEHOLD_ID);
    expect(out.week_of).toBe('2026-05-18');
    expect(out.revision).toBe(3);
    expect(out.prompt_version).toBe('v2.0.0');
    expect(out.generated_at).toBe('2026-05-15T13:00:00.000Z');
    expect(out.plan_build_id).toBe('build-1');
    expect(out.main_assignments).toHaveLength(2);
    expect(out.days).toHaveLength(2);
  });

  it('omits plan_build_id when not provided', () => {
    const tree = buildTreeMondayTuesday();
    const out = existingTreeToCommitInput({
      existing: tree,
      planId: PLAN_ID,
      householdId: HOUSEHOLD_ID,
      weekOf: '2026-05-18',
      revision: 1,
      promptVersion: 'v2.0.0',
      generatedAt: '2026-05-15T11:00:00.000Z',
    });
    expect(out).not.toHaveProperty('plan_build_id');
  });
});

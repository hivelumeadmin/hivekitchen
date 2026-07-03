import { describe, it, expect } from 'vitest';
import { resolvePlanEditTarget } from './plan-edit-target.js';
import {
  TEST_IDS,
  buildPlanDay,
  buildPlanSlot,
  buildPlanSlotVariation,
} from '../../../test/factories/index.js';

// Epic 13-s9 — pure resolution: SlotTarget (mon..fri short days from the
// classifier) + loaded plan tree → the concrete row to mutate. Never throws,
// never guesses: unresolvable targets return a typed miss.

const DAY_MON = buildPlanDay({ id: 'aaaa1111-1111-4111-8111-111111111111', day: 'monday' });
const DAY_TUE = buildPlanDay({ id: 'aaaa2222-2222-4222-8222-222222222222', day: 'tuesday' });

const MAIN_SLOT = buildPlanSlot({
  id: 'cccc1111-1111-4111-8111-111111111111',
  plan_day_id: DAY_MON.id,
  slot_kind: 'main',
  main_assignment_id: TEST_IDS.mainAssignment,
});
const SNACK_SLOT = buildPlanSlot({
  id: 'cccc2222-2222-4222-8222-222222222222',
  plan_day_id: DAY_MON.id,
  slot_kind: 'snack',
  main_assignment_id: null,
  snack_sku_id: 'eeee1111-1111-4111-8111-111111111111',
});
const EXTRA_SLOT = buildPlanSlot({
  id: 'cccc3333-3333-4333-8333-333333333333',
  plan_day_id: DAY_MON.id,
  slot_kind: 'extra',
  main_assignment_id: null,
  recipe_id: TEST_IDS.recipe,
  extra_kind: 'sweet',
});
const MAIN_VARIATION = buildPlanSlotVariation({
  id: 'dddd1111-1111-4111-8111-111111111111',
  plan_slot_id: MAIN_SLOT.id,
  child_id: TEST_IDS.childA,
});

const TREE = {
  days: [DAY_MON, DAY_TUE],
  slots: [MAIN_SLOT, SNACK_SLOT, EXTRA_SLOT],
  variations: [MAIN_VARIATION],
};

describe('resolvePlanEditTarget', () => {
  it('resolves a main swap to the day main assignment', () => {
    const result = resolvePlanEditTarget('swap', { day: 'mon', slotKind: 'main' }, TREE);
    expect(result).toEqual({
      kind: 'main',
      mainAssignmentId: TEST_IDS.mainAssignment,
      planSlotId: MAIN_SLOT.id,
    });
  });

  it('defaults a swap with no slotKind to the main (the day anchor)', () => {
    const result = resolvePlanEditTarget('swap', { day: 'mon' }, TREE);
    expect(result).toMatchObject({ kind: 'main', mainAssignmentId: TEST_IDS.mainAssignment });
  });

  it('resolves a snack swap to the slot with its current SKU and day', () => {
    const result = resolvePlanEditTarget('swap', { day: 'mon', slotKind: 'snack' }, TREE);
    expect(result).toEqual({
      kind: 'slot',
      planSlotId: SNACK_SLOT.id,
      slotKind: 'snack',
      day: 'monday',
      currentSnackSkuId: SNACK_SLOT.snack_sku_id,
    });
  });

  it('resolves an extra swap to the slot', () => {
    const result = resolvePlanEditTarget('swap', { day: 'mon', slotKind: 'extra' }, TREE);
    expect(result).toMatchObject({ kind: 'slot', planSlotId: EXTRA_SLOT.id, slotKind: 'extra' });
  });

  it('resolves a vary to the child variation on the day main', () => {
    const result = resolvePlanEditTarget(
      'vary',
      { day: 'mon', slotKind: 'main', childId: TEST_IDS.childA },
      TREE,
    );
    expect(result).toEqual({ kind: 'variation', variationId: MAIN_VARIATION.id });
  });

  it('misses with day_required when a slot-scoped target has no day', () => {
    expect(resolvePlanEditTarget('swap', { slotKind: 'snack' }, TREE)).toEqual({
      kind: 'miss',
      reason: 'day_required',
    });
  });

  it('misses with day_not_found for a day outside the plan', () => {
    const treeWithoutTue = { ...TREE, days: [DAY_MON] };
    expect(resolvePlanEditTarget('swap', { day: 'tue', slotKind: 'main' }, treeWithoutTue)).toEqual({
      kind: 'miss',
      reason: 'day_not_found',
    });
  });

  it('misses with day_paused for a paused day', () => {
    const pausedMon = { ...DAY_MON, paused_at: '2026-06-29T07:00:00Z' };
    const tree = { ...TREE, days: [pausedMon, DAY_TUE] };
    expect(resolvePlanEditTarget('swap', { day: 'mon', slotKind: 'main' }, tree)).toEqual({
      kind: 'miss',
      reason: 'day_paused',
    });
  });

  it('misses with slot_not_found when the day has no slot of that kind', () => {
    expect(resolvePlanEditTarget('swap', { day: 'tue', slotKind: 'snack' }, TREE)).toEqual({
      kind: 'miss',
      reason: 'slot_not_found',
    });
  });

  it('misses with child_required for a vary without childId', () => {
    expect(resolvePlanEditTarget('vary', { day: 'mon', slotKind: 'main' }, TREE)).toEqual({
      kind: 'miss',
      reason: 'child_required',
    });
  });

  it('misses with variation_not_found when the child has no variation row', () => {
    expect(
      resolvePlanEditTarget('vary', { day: 'mon', slotKind: 'main', childId: TEST_IDS.childB }, TREE),
    ).toEqual({ kind: 'miss', reason: 'variation_not_found' });
  });
});

import type { PlanDayRow, PlanSlotRow, PlanSlotVariationRow, Weekday } from '@hivekitchen/types';
import type { SlotTarget } from '../../agents/dispatch-plan-intent.js';

// Epic 13-s9 — pure resolution of a dispatch SlotTarget against a loaded plan
// tree. The classifier emits short weekdays (mon..fri) and an optional
// slotKind/childId; this maps them to the concrete row the execution layer
// mutates: the day's main assignment (main swap), the plan_slot (snack/extra
// swap), or the child's variation row (vary). Unresolvable targets return a
// typed miss — never a throw, never a guess — so the endpoint can answer with
// a clarify instead of mutating the wrong row.

const DAY_BY_SHORT: Record<string, Weekday> = {
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
  sat: 'saturday',
};

type PlanEditMissReason =
  | 'day_required'
  | 'day_not_found'
  | 'day_paused'
  | 'slot_not_found'
  | 'child_required'
  | 'variation_not_found';

export type PlanEditTarget =
  | { kind: 'main'; mainAssignmentId: string; planSlotId: string }
  | {
      kind: 'slot';
      planSlotId: string;
      slotKind: 'snack' | 'extra';
      day: Weekday;
      currentSnackSkuId: string | null;
    }
  | { kind: 'variation'; variationId: string }
  | { kind: 'miss'; reason: PlanEditMissReason };

export interface PlanEditTree {
  days: readonly PlanDayRow[];
  slots: readonly PlanSlotRow[];
  variations: readonly PlanSlotVariationRow[];
}

export function resolvePlanEditTarget(
  mode: 'swap' | 'vary',
  target: SlotTarget,
  tree: PlanEditTree,
): PlanEditTarget {
  if (!target.day) return { kind: 'miss', reason: 'day_required' };
  const weekday = DAY_BY_SHORT[target.day];
  const day = weekday ? tree.days.find((d) => d.day === weekday) : undefined;
  if (!day) return { kind: 'miss', reason: 'day_not_found' };
  if (day.paused_at !== null) return { kind: 'miss', reason: 'day_paused' };

  // A target with no slotKind addresses the Main — the day's anchor.
  const slotKind = target.slotKind ?? 'main';
  const slot = tree.slots.find((s) => s.plan_day_id === day.id && s.slot_kind === slotKind);
  if (!slot) return { kind: 'miss', reason: 'slot_not_found' };

  if (mode === 'vary') {
    if (!target.childId) return { kind: 'miss', reason: 'child_required' };
    const variation = tree.variations.find(
      (v) => v.plan_slot_id === slot.id && v.child_id === target.childId,
    );
    if (!variation) return { kind: 'miss', reason: 'variation_not_found' };
    return { kind: 'variation', variationId: variation.id };
  }

  if (slot.slot_kind === 'main') {
    // The slot XOR CHECK guarantees main slots carry a main_assignment_id.
    if (slot.main_assignment_id === null) return { kind: 'miss', reason: 'slot_not_found' };
    return { kind: 'main', mainAssignmentId: slot.main_assignment_id, planSlotId: slot.id };
  }
  return {
    kind: 'slot',
    planSlotId: slot.id,
    slotKind: slot.slot_kind,
    day: day.day,
    currentSnackSkuId: slot.snack_sku_id,
  };
}

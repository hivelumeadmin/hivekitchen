import type { ClearedAllergyEntry, PauseReason, PlanSlotVariationRow, Weekday } from '@hivekitchen/types';
import type { DaySlotView, DayTreeView } from '../tree-adapter.js';

// Story 3-DM-C1 Phase 9b part 4 step 4 — the picker's seven navigation levels.
// Sick day (full-day pause), per-child pause and the conversational Swap Main
// proposal are surfaced from L1; "this day is different" is the override flow.
export type PickerLevel =
  | 'l1'
  | 'l2-select-variation'   // pick which child's variation to edit
  | 'l3-variation-ingredients'
  | 'l2-select-slot-override' // pick which slot to override
  | 'l4-override'
  | 'l2-select-pause-child'
  | 'l3-propose-swap';      // Slice 5-S12 — conversational swap proposal

export interface VariationWithSlot {
  readonly slot: DaySlotView;
  readonly variation: PlanSlotVariationRow;
}

// Default pause reason when the user hits "Sick day" without a follow-up
// reason selector. The new wire enum is mandatory; the prior 'sick' value
// maps to 'sick_day' under the six-value PauseReason set.
export const DEFAULT_SICK_DAY_REASON: PauseReason = 'sick_day';

export const DAY_LABEL: Record<Weekday, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
};

const DAY_INDEX: Record<Weekday, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
};

// Simple allergen check: does any new ingredient contain a declared allergen string?
// False positives (e.g. "butter" matching "peanut butter") are safe — they just
// send allergen-affecting variation edits through the pending (non-optimistic) path.
export function isAllergenAffecting(
  childId: string,
  newIngredients: string[],
  clearedAllergens: ReadonlyArray<Pick<ClearedAllergyEntry, 'child_id' | 'allergen'>>,
): boolean {
  const childAllergens = clearedAllergens
    .filter((a) => a.child_id === childId)
    .map((a) => a.allergen.toLowerCase());
  if (childAllergens.length === 0) return false;
  return newIngredients.some((i) =>
    childAllergens.some((a) => i.toLowerCase().includes(a)),
  );
}

// Story 3.19 — derive the calendar date for a tile's weekday in the current
// week using LOCAL time so the result matches the parent's wall-clock date
// regardless of UTC offset (a UTC+10 parent at 11 PM Monday sees Monday, not
// Tuesday).
export function deriveOverrideDate(day: Weekday): string {
  const today = new Date();
  const todayDow = today.getDay(); // local day-of-week: 0=Sun, 1=Mon … 6=Sat
  const daysSinceMonday = todayDow === 0 ? -1 : todayDow - 1;
  const monday = new Date(today);
  monday.setDate(today.getDate() - daysSinceMonday);
  const target = new Date(monday);
  target.setDate(monday.getDate() + DAY_INDEX[day]);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function collectVariations(view: DayTreeView): VariationWithSlot[] {
  const out: VariationWithSlot[] = [];
  for (const slot of view.slots) {
    for (const variation of slot.variations) {
      out.push({ slot, variation });
    }
  }
  return out;
}

export function distinctChildIds(view: DayTreeView): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const slot of view.slots) {
    for (const variation of slot.variations) {
      if (!seen.has(variation.child_id)) {
        seen.add(variation.child_id);
        order.push(variation.child_id);
      }
    }
  }
  return order;
}

// Shared class strings — identical to the pre-split inline literals, hoisted
// only so the seven panels cannot drift from one another.
export const CHIP_CLASS =
  'rounded-full border border-stone-300 px-3 py-1.5 text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400';

export const LIST_BUTTON_CLASS =
  'rounded-md border border-stone-200 px-3 py-2 text-start text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400';

export const LIST_BUTTON_DISABLED_CLASS =
  'rounded-md border border-stone-200 px-3 py-2 text-start text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400';

export const BACK_LINK_CLASS =
  'self-start text-[12px] text-stone-400 hover:text-stone-600 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300';

export const INLINE_BACK_LINK_CLASS =
  'text-[12px] text-stone-400 hover:text-stone-600 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300';

export const SUBMIT_CLASS =
  'rounded-full bg-stone-900 px-4 py-1.5 text-[13px] text-white hover:bg-stone-700 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400';

export const TEXT_INPUT_CLASS =
  'w-full rounded-md border border-stone-300 px-3 py-2 text-[14px] text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400';

export const PROMPT_CLASS = 'text-stone-500 text-[13px]';

export const ERROR_CLASS = 'text-[12px] text-red-600';

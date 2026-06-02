import { useState, useRef, useEffect, useId } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type {
  ClearedAllergyEntry,
  PauseReason,
  PlanSlotVariationRow,
  Weekday,
} from '@hivekitchen/types';
import { HkApiError } from '@/lib/fetch.js';
import {
  usePauseDayMutation,
  usePauseChildOnDayMutation,
  useUpdateVariationMutation,
} from './mutations.js';
import { OverridePicker } from './OverridePicker.js';
import type { DaySlotView, DayTreeView } from './tree-adapter.js';

// Story 3-DM-C1 Phase 9b part 4 step 4 — picker decomposed for the canonical
// model's tripartite swap surface.
//
// The picker no longer dispatches a single "swap item ingredients" call.
// Instead it routes to one of three operations depending on the user's
// intent + the slot they target:
//
//   • Main slot   → swap the M-assignment recipe (a follow-up slice ships the
//                   recipe picker UI; for now the entry point is wired and
//                   surfaces "coming soon" copy when no candidate recipe id
//                   is available).
//   • Snack/Extra → swap the slot's recipe.
//   • Per-child   → update a variation (the only place where the legacy
//                   ingredient-edit flow maps cleanly: the user-typed
//                   ingredient list lands in variation.add_ons).
//
// Sick day (full-day pause) and per-child pause are surfaced directly on L1.
// The "this day is different" override flow is preserved verbatim, now scoped
// to a slot (planSlotId param) per the route param swap.

type PickerLevel =
  | 'l1'
  | 'l2-select-variation'   // pick which child's variation to edit
  | 'l3-variation-ingredients'
  | 'l2-select-slot-override' // pick which slot to override
  | 'l4-override'
  | 'l2-select-pause-child';

interface DisambiguationPickerProps {
  planId: string;
  day: Weekday;
  // Story 3-DM-C1 Phase 9b part 4 step 4 — tree-shape replacement for the
  // legacy `items: PlanTileSummary['items']` prop. The picker now receives
  // the full day view so it can dispatch to swapMain / swapSlotRecipe /
  // updateVariation / pause-day / pause-child / override correctly.
  dayView: DayTreeView;
  clearedAllergens: ReadonlyArray<Pick<ClearedAllergyEntry, 'child_id' | 'allergen'>>;
  // Resolves child UUID → display name for variation-picker labeling.
  childNames?: Readonly<Record<string, string>>;
  onDismiss: () => void;
  // Called when an edit starts: tells BriefCanvas to show swap-in-progress on
  // the tile. The signaled id is the variation row id (the tree-shape stable
  // handle for an in-flight per-child edit).
  onSwapStarted: (variationId: string) => void;
  // Called when the edit settles (success or failure): clears the optimistic
  // in-progress marker.
  onSwapSettled: () => void;
  // Story 3.13 — when provided, L1 surfaces a "redo this day" affordance that
  // delegates to the parent (BriefCanvas) which fires the regeneration mutation.
  onRegenDay?: (day: Weekday) => void;
}

// Simple allergen check: does any new ingredient contain a declared allergen string?
// False positives (e.g. "butter" matching "peanut butter") are safe — they just
// send allergen-affecting variation edits through the pending (non-optimistic) path.
function isAllergenAffecting(
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

const DAY_LABEL: Record<Weekday, string> = {
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

// Story 3.19 — derive the calendar date for a tile's weekday in the current
// week using LOCAL time so the result matches the parent's wall-clock date
// regardless of UTC offset (a UTC+10 parent at 11 PM Monday sees Monday, not
// Tuesday).
function deriveOverrideDate(day: Weekday): string {
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

// Default pause reason when the user hits "Sick day" without a follow-up
// reason selector. The new wire enum is mandatory; the prior 'sick' value
// maps to 'sick_day' under the six-value PauseReason set.
const DEFAULT_SICK_DAY_REASON: PauseReason = 'sick_day';

interface VariationWithSlot {
  readonly slot: DaySlotView;
  readonly variation: PlanSlotVariationRow;
}

function collectVariations(view: DayTreeView): VariationWithSlot[] {
  const out: VariationWithSlot[] = [];
  for (const slot of view.slots) {
    for (const variation of slot.variations) {
      out.push({ slot, variation });
    }
  }
  return out;
}

function distinctChildIds(view: DayTreeView): string[] {
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

export function DisambiguationPicker({
  planId,
  day,
  dayView,
  clearedAllergens,
  childNames,
  onDismiss,
  onSwapStarted,
  onSwapSettled,
  onRegenDay,
}: DisambiguationPickerProps) {
  const [level, setLevel] = useState<PickerLevel>('l1');
  const [selectedVariation, setSelectedVariation] = useState<VariationWithSlot | null>(null);
  const [selectedOverrideSlot, setSelectedOverrideSlot] = useState<DaySlotView | null>(null);
  const [ingredientInput, setIngredientInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const pickerId = useId();

  const updateVariation = useUpdateVariationMutation();
  const pauseDay = usePauseDayMutation();
  const pauseChildOnDay = usePauseChildOnDayMutation();

  const isPending =
    updateVariation.isPending || pauseDay.isPending || pauseChildOnDay.isPending;

  const variations = collectVariations(dayView);
  const childIds = distinctChildIds(dayView);

  // Focus the ingredient input when entering L3.
  useEffect(() => {
    if (level === 'l3-variation-ingredients') {
      inputRef.current?.focus();
    }
  }, [level]);

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      onDismiss();
    }
  }

  function handleChangeItem() {
    if (variations.length === 0) {
      setError('No variations to edit on this day.');
      return;
    }
    if (variations.length === 1) {
      setSelectedVariation(variations[0]!);
      setLevel('l3-variation-ingredients');
    } else {
      setLevel('l2-select-variation');
    }
  }

  function handleOverrideIntent() {
    const slots = dayView.slots;
    if (slots.length === 0) {
      setError('No slots to override on this day.');
      return;
    }
    if (slots.length === 1) {
      setSelectedOverrideSlot(slots[0]!);
      setLevel('l4-override');
    } else {
      setLevel('l2-select-slot-override');
    }
  }

  function handleSickDayIntent() {
    if (isPending || dayView.paused) return;
    pauseDay.mutate(
      { planId, day, reason: DEFAULT_SICK_DAY_REASON },
      {
        onSuccess: () => {
          onSwapSettled();
          onDismiss();
        },
        onError: () => {
          onSwapSettled();
          setError('Could not pause this day. Please try again.');
        },
      },
    );
  }

  function handlePauseChildIntent() {
    if (childIds.length === 0) {
      setError('No child variations to pause on this day.');
      return;
    }
    setLevel('l2-select-pause-child');
  }

  function handlePauseChildSelected(childId: string) {
    if (isPending) return;
    pauseChildOnDay.mutate(
      { planId, day, childId },
      {
        onSuccess: () => {
          onSwapSettled();
          onDismiss();
        },
        onError: () => {
          onSwapSettled();
          setError('Could not pause this child for the day. Please try again.');
        },
      },
    );
  }

  async function handleVariationSubmit() {
    if (!selectedVariation) {
      setError('Variation not selected — refresh and try again.');
      return;
    }
    const newIngredients = ingredientInput
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (newIngredients.length === 0) {
      setError('Enter at least one ingredient.');
      return;
    }
    setError(null);

    const allergenAffecting = isAllergenAffecting(
      selectedVariation.variation.child_id,
      newIngredients,
      clearedAllergens,
    );

    if (!allergenAffecting) {
      onSwapStarted(selectedVariation.variation.id);
      onDismiss();
    }

    try {
      await updateVariation.mutateAsync({
        planId,
        variationId: selectedVariation.variation.id,
        // The legacy "type new ingredients" UX maps cleanly onto add_ons in
        // the canonical model. Removals stay as-is. A richer per-child
        // ingredient-edit UI is a follow-up slice.
        input: { add_ons: newIngredients },
      });
      onSwapSettled();
      if (allergenAffecting) onDismiss();
    } catch (err) {
      onSwapSettled();
      const is422 = err instanceof HkApiError && err.status === 422;
      setError(
        is422
          ? "That swap conflicts with a declared allergy. Try different ingredients."
          : 'Swap failed. Please try again.',
      );
    }
  }

  const dayDisabled = dayView.paused;
  const sickDayDisabled = isPending || dayDisabled;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="group"
      aria-label={`Edit ${DAY_LABEL[day]}`}
      id={pickerId}
      className="mt-2 rounded-lg border border-stone-200 bg-white p-3 flex flex-col gap-3 shadow-sm font-sans text-[14px]"
      onKeyDown={handleKeyDown}
    >
      {level === 'l1' && (
        <>
          <p className="text-stone-500 text-[13px]">What would you like to do?</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSickDayIntent}
              disabled={sickDayDisabled}
              className="rounded-full border border-stone-300 px-3 py-1.5 text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
            >
              Sick day
            </button>
            <button
              type="button"
              onClick={handleChangeItem}
              disabled={isPending}
              className="rounded-full border border-stone-300 px-3 py-1.5 text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
            >
              Change an item
            </button>
            <button
              type="button"
              onClick={handleOverrideIntent}
              disabled={isPending}
              className="rounded-full border border-stone-300 px-3 py-1.5 text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
            >
              This day is different…
            </button>
            {childIds.length > 1 && (
              <button
                type="button"
                onClick={handlePauseChildIntent}
                disabled={isPending}
                className="rounded-full border border-stone-300 px-3 py-1.5 text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
              >
                Pause one child
              </button>
            )}
            {onRegenDay !== undefined && (
              <button
                type="button"
                onClick={() => { onRegenDay(day); }}
                disabled={isPending}
                className="rounded-full border border-stone-300 px-3 py-1.5 text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
              >
                Ask Lumi to redo this day
              </button>
            )}
          </div>
          {error !== null && (
            <p role="alert" className="text-[12px] text-red-600">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="self-start text-[12px] text-stone-400 hover:text-stone-600 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300"
          >
            Cancel
          </button>
        </>
      )}

      {level === 'l2-select-variation' && (
        <>
          <p className="text-stone-500 text-[13px]">Which child / slot?</p>
          <div className="flex flex-col gap-1.5">
            {variations.map(({ slot, variation }) => {
              const childLabel = childNames?.[variation.child_id] ?? variation.child_id.slice(0, 8);
              return (
                <button
                  key={variation.id}
                  type="button"
                  onClick={() => {
                    setSelectedVariation({ slot, variation });
                    setLevel('l3-variation-ingredients');
                  }}
                  className="rounded-md border border-stone-200 px-3 py-2 text-start text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
                >
                  {slot.slot_kind} · {childLabel}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setLevel('l1')}
            className="self-start text-[12px] text-stone-400 hover:text-stone-600 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300"
          >
            Back
          </button>
        </>
      )}

      {level === 'l2-select-slot-override' && (
        <>
          <p className="text-stone-500 text-[13px]">Which slot is different today?</p>
          <div className="flex flex-col gap-1.5">
            {dayView.slots.map((slot) => (
              <button
                key={`override-${slot.plan_slot_id}`}
                type="button"
                onClick={() => {
                  setSelectedOverrideSlot(slot);
                  setLevel('l4-override');
                }}
                className="rounded-md border border-stone-200 px-3 py-2 text-start text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
              >
                {slot.slot_kind}
                {slot.extra_kind !== null ? ` · ${slot.extra_kind}` : ''}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setLevel('l1')}
            className="self-start text-[12px] text-stone-400 hover:text-stone-600 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300"
          >
            Back
          </button>
        </>
      )}

      {level === 'l2-select-pause-child' && (
        <>
          <p className="text-stone-500 text-[13px]">Pause which child for the day?</p>
          <div className="flex flex-col gap-1.5">
            {childIds.map((childId) => {
              const childLabel = childNames?.[childId] ?? childId.slice(0, 8);
              return (
                <button
                  key={`pause-child-${childId}`}
                  type="button"
                  onClick={() => handlePauseChildSelected(childId)}
                  disabled={isPending}
                  className="rounded-md border border-stone-200 px-3 py-2 text-start text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
                >
                  {childLabel}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setLevel('l1')}
            className="self-start text-[12px] text-stone-400 hover:text-stone-600 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300"
          >
            Back
          </button>
        </>
      )}

      {level === 'l4-override' && selectedOverrideSlot !== null && (
        // The override picker is per (slot, child). We pick the first child
        // variation under the selected slot as the override target; richer
        // per-child override UX is a follow-up slice.
        (() => {
          const targetVariation = selectedOverrideSlot.variations[0];
          if (targetVariation === undefined) {
            return (
              <>
                <p role="alert" className="text-[12px] text-red-600">
                  No variation to override on this slot.
                </p>
                <button
                  type="button"
                  onClick={() => setLevel(dayView.slots.length > 1 ? 'l2-select-slot-override' : 'l1')}
                  className="self-start text-[12px] text-stone-400 hover:text-stone-600 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300"
                >
                  Back
                </button>
              </>
            );
          }
          return (
            <OverridePicker
              planId={planId}
              planSlotId={selectedOverrideSlot.plan_slot_id}
              childId={targetVariation.child_id}
              overrideDate={deriveOverrideDate(day)}
              onConfirm={() => {
                onSwapSettled();
                onDismiss();
              }}
              onCancel={() => setLevel(dayView.slots.length > 1 ? 'l2-select-slot-override' : 'l1')}
            />
          );
        })()
      )}

      {level === 'l3-variation-ingredients' && (
        <>
          <label htmlFor={`${pickerId}-ingredients`} className="text-stone-500 text-[13px]">
            What should it be instead?
          </label>
          <input
            ref={inputRef}
            id={`${pickerId}-ingredients`}
            type="text"
            value={ingredientInput}
            onChange={(e) => setIngredientInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isPending) { void handleVariationSubmit(); }
            }}
            placeholder="e.g. hummus, rice crackers, apple"
            aria-describedby={error !== null ? `${pickerId}-error` : undefined}
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-[14px] text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
          />
          {error !== null && (
            <p id={`${pickerId}-error`} role="alert" className="text-[12px] text-red-600">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { void handleVariationSubmit(); }}
              disabled={isPending || ingredientInput.trim().length === 0}
              className="rounded-full bg-stone-900 px-4 py-1.5 text-[13px] text-white hover:bg-stone-700 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
            >
              {isPending ? 'Checking…' : 'Swap'}
            </button>
            <button
              type="button"
              onClick={() => setLevel(variations.length > 1 ? 'l2-select-variation' : 'l1')}
              disabled={isPending}
              className="text-[12px] text-stone-400 hover:text-stone-600 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300"
            >
              Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}

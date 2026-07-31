import { useState, useRef, useEffect, useId } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ClearedAllergyEntry, Weekday } from '@hivekitchen/types';
import { HkApiError } from '@/lib/fetch.js';
import {
  usePauseDayMutation,
  usePauseChildOnDayMutation,
  useUpdateVariationMutation,
} from './mutations.js';
import type { DaySlotView, DayTreeView } from './tree-adapter.js';
import {
  DAY_LABEL,
  DEFAULT_SICK_DAY_REASON,
  collectVariations,
  distinctChildIds,
  isAllergenAffecting,
} from './picker/picker-model.js';
import type { PickerLevel, VariationWithSlot } from './picker/picker-model.js';
import { PickerActionMenu } from './picker/PickerActionMenu.js';
import { PickerSelectVariation } from './picker/PickerSelectVariation.js';
import { PickerSelectSlotOverride } from './picker/PickerSelectSlotOverride.js';
import { PickerSelectPauseChild } from './picker/PickerSelectPauseChild.js';
import { PickerOverridePanel } from './picker/PickerOverridePanel.js';
import { PickerVariationIngredients } from './picker/PickerVariationIngredients.js';
import { PickerProposeSwap } from './picker/PickerProposeSwap.js';

// Story 3-DM-C1 Phase 9b part 4 step 4 — picker decomposed for the canonical
// model's tripartite swap surface.
//
// The picker no longer dispatches a single "swap item ingredients" call.
// Instead it routes to one of three operations depending on the user's
// intent + the slot they target:
//
//   • Main slot   → the conversational Swap Main proposal (5-S12).
//   • Snack/Extra → swap the slot's recipe.
//   • Per-child   → update a variation (the only place where the legacy
//                   ingredient-edit flow maps cleanly: the user-typed
//                   ingredient list lands in variation.add_ons).
//
// Sick day (full-day pause) and per-child pause are surfaced directly on L1.
// The "this day is different" override flow is scoped to a slot (planSlotId).
//
// Story 14-s6 — this file is the shell: it owns level routing, the shared
// error region, focus management and Escape, and dispatches to one per-level
// panel under ./picker/.

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
  // Slice 5-S12 — when provided, L1 surfaces a "Swap Main" affordance that opens
  // the conversational L3 proposal. Resolves to the proposal_id returned by the
  // API; the caller stores it to drive the tile's proposal-pending pulse.
  onProposeSwap?: (day: Weekday, content: string) => Promise<string>;
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
  onProposeSwap,
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

  // Focus the ingredient input when entering L3. (The proposal panel focuses
  // its own input on mount.)
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
  // Slice 5-S12 — "Swap Main" is offered only when the day has a main slot with
  // a committed assignment and the parent wired the conversational handler.
  const hasMainSlot = dayView.slots.some(
    (s) => s.slot_kind === 'main' && s.main_assignment_id !== null,
  );
  const overrideBackLevel: PickerLevel =
    dayView.slots.length > 1 ? 'l2-select-slot-override' : 'l1';

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
        <PickerActionMenu
          day={day}
          error={error}
          isPending={isPending}
          sickDayDisabled={sickDayDisabled}
          showSwapMain={hasMainSlot && onProposeSwap !== undefined}
          showPauseChild={childIds.length > 1}
          showRegenDay={onRegenDay !== undefined}
          onSickDay={handleSickDayIntent}
          onChangeItem={handleChangeItem}
          onSwapMain={() => { setError(null); setLevel('l3-propose-swap'); }}
          onOverride={handleOverrideIntent}
          onPauseChild={handlePauseChildIntent}
          onRegenDay={(d) => onRegenDay?.(d)}
          onDismiss={onDismiss}
        />
      )}

      {level === 'l2-select-variation' && (
        <PickerSelectVariation
          variations={variations}
          childNames={childNames}
          onSelect={(selected) => {
            setSelectedVariation(selected);
            setLevel('l3-variation-ingredients');
          }}
          onBack={() => setLevel('l1')}
        />
      )}

      {level === 'l2-select-slot-override' && (
        <PickerSelectSlotOverride
          slots={dayView.slots}
          onSelect={(slot) => {
            setSelectedOverrideSlot(slot);
            setLevel('l4-override');
          }}
          onBack={() => setLevel('l1')}
        />
      )}

      {level === 'l2-select-pause-child' && (
        <PickerSelectPauseChild
          childIds={childIds}
          childNames={childNames}
          isPending={isPending}
          onSelect={handlePauseChildSelected}
          onBack={() => setLevel('l1')}
        />
      )}

      {level === 'l4-override' && selectedOverrideSlot !== null && (
        <PickerOverridePanel
          planId={planId}
          day={day}
          slot={selectedOverrideSlot}
          onConfirm={() => {
            onSwapSettled();
            onDismiss();
          }}
          onBack={() => setLevel(overrideBackLevel)}
        />
      )}

      {level === 'l3-variation-ingredients' && (
        <PickerVariationIngredients
          pickerId={pickerId}
          inputRef={inputRef}
          value={ingredientInput}
          error={error}
          isPending={isPending}
          onChange={setIngredientInput}
          onSubmit={() => { void handleVariationSubmit(); }}
          onBack={() => setLevel(variations.length > 1 ? 'l2-select-variation' : 'l1')}
        />
      )}

      {level === 'l3-propose-swap' && onProposeSwap !== undefined && (
        <PickerProposeSwap
          pickerId={pickerId}
          day={day}
          onProposeSwap={onProposeSwap}
          onSwapStarted={onSwapStarted}
          onDismiss={onDismiss}
          onBack={() => { setError(null); setLevel('l1'); }}
        />
      )}
    </div>
  );
}

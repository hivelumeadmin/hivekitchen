import { useState, useRef, useEffect, useId } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PlanTileSummary, ClearedAllergyEntry } from '@hivekitchen/types';
import { HkApiError } from '@/lib/fetch.js';
import { useSwapPlanItemMutation, usePauseDayMutation } from './mutations.js';

type PickerLevel = 'l1' | 'l2-select-item' | 'l3-ingredients';

interface DisambiguationPickerProps {
  planId: string;
  day: PlanTileSummary['day'];
  items: PlanTileSummary['items'];
  clearedAllergens: ReadonlyArray<Pick<ClearedAllergyEntry, 'child_id' | 'allergen'>>;
  onDismiss: () => void;
  // Called when a swap starts: tells BriefCanvas to show swap-in-progress on the tile.
  onSwapStarted: (itemId: string) => void;
  // Called when swap/pause settles (success or failure): clears swap-in-progress state.
  onSwapSettled: () => void;
  // Story 3.13 — when provided, L1 surfaces a "redo this day" affordance that
  // delegates to the parent (BriefCanvas) which fires the regeneration mutation.
  onRegenDay?: (day: PlanTileSummary['day']) => void;
}

// Simple allergen check: does any new ingredient contain a declared allergen string?
// False positives (e.g. "butter" matching "peanut butter") are safe — they just
// send allergen-affecting swaps through the pending (non-optimistic) path.
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

const DAY_LABEL: Record<PlanTileSummary['day'], string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
};

export function DisambiguationPicker({
  planId,
  day,
  items,
  clearedAllergens,
  onDismiss,
  onSwapStarted,
  onSwapSettled,
  onRegenDay,
}: DisambiguationPickerProps) {
  const [level, setLevel] = useState<PickerLevel>('l1');
  const [selectedItem, setSelectedItem] = useState<PlanTileSummary['items'][number] | null>(null);
  const [ingredientInput, setIngredientInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const pickerId = useId();

  const swapMutation = useSwapPlanItemMutation();
  const pauseMutation = usePauseDayMutation();

  const isPending = swapMutation.isPending || pauseMutation.isPending;

  // Focus the ingredient input when entering L3.
  useEffect(() => {
    if (level === 'l3-ingredients') {
      inputRef.current?.focus();
    }
  }, [level]);

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      onDismiss();
    }
  }

  async function handleSickDay() {
    setError(null);
    try {
      await pauseMutation.mutateAsync({ planId, day, reason: 'sick' });
      onSwapSettled();
      onDismiss();
    } catch {
      setError('Could not pause this day. Please try again.');
      onSwapSettled();
    }
  }

  function handleChangeItem() {
    if (items.length === 1) {
      setSelectedItem(items[0]!);
      setLevel('l3-ingredients');
    } else {
      setLevel('l2-select-item');
    }
  }

  async function handleSwapSubmit() {
    if (!selectedItem?.plan_item_id) {
      setError('Item ID not available — refresh the page and try again.');
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
      selectedItem.child_id,
      newIngredients,
      clearedAllergens,
    );

    // For non-allergen swaps: close picker immediately and show swap-in-progress tile.
    // For allergen-affecting: keep picker open with pending state.
    if (!allergenAffecting) {
      onSwapStarted(selectedItem.plan_item_id);
      onDismiss();
    }

    try {
      await swapMutation.mutateAsync({
        planId,
        itemId: selectedItem.plan_item_id,
        input: { ingredients: newIngredients },
      });
      onSwapSettled();
      if (allergenAffecting) onDismiss();
    } catch (err) {
      onSwapSettled();
      const is422 =
        err instanceof HkApiError && err.status === 422;
      setError(
        is422
          ? "That swap conflicts with a declared allergy. Try different ingredients."
          : 'Swap failed. Please try again.',
      );
      // Picker stays open on allergen-affecting failure so parent sees the error.
      // For non-allergen (optimistic) failures: picker is already dismissed;
      // the brief re-fetches and tile reverts to previous ingredients automatically.
    }
  }

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
              onClick={() => { void handleSickDay(); }}
              disabled={isPending}
              className="rounded-full border border-stone-300 px-3 py-1.5 text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
            >
              Sick day — pause, keep the plan
            </button>
            <button
              type="button"
              onClick={handleChangeItem}
              disabled={isPending}
              className="rounded-full border border-stone-300 px-3 py-1.5 text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
            >
              Change an item
            </button>
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
          <button
            type="button"
            onClick={onDismiss}
            className="self-start text-[12px] text-stone-400 hover:text-stone-600 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300"
          >
            Cancel
          </button>
        </>
      )}

      {level === 'l2-select-item' && (
        <>
          <p className="text-stone-500 text-[13px]">Which slot?</p>
          <div className="flex flex-col gap-1.5">
            {items.map((item) => (
              <button
                key={`${item.child_id}-${item.slot}`}
                type="button"
                onClick={() => {
                  setSelectedItem(item);
                  setLevel('l3-ingredients');
                }}
                className="rounded-md border border-stone-200 px-3 py-2 text-start text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
              >
                {item.slot} — {item.ingredients.slice(0, 2).join(', ')}
                {item.ingredients.length > 2 ? ` +${item.ingredients.length - 2}` : ''}
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

      {level === 'l3-ingredients' && (
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
              if (e.key === 'Enter' && !isPending) { void handleSwapSubmit(); }
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
              onClick={() => { void handleSwapSubmit(); }}
              disabled={isPending || ingredientInput.trim().length === 0}
              className="rounded-full bg-stone-900 px-4 py-1.5 text-[13px] text-white hover:bg-stone-700 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
            >
              {isPending ? 'Checking…' : 'Swap'}
            </button>
            <button
              type="button"
              onClick={() => setLevel(items.length > 1 ? 'l2-select-item' : 'l1')}
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

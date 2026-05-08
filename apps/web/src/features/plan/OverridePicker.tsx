import { useState } from 'react';
import type { DayOverrideType } from '@hivekitchen/types';
import { useSetDayOverrideMutation, useRevertDayOverrideMutation } from './mutations.js';

interface OverridePickerProps {
  planId: string;
  planItemId: string;
  childId: string;
  overrideDate: string;
  onConfirm: () => void;
  onCancel: () => void;
  // When set, shows an active-override banner with an undo button at the top
  // of the picker. Pass when the brief reports an existing override for this slot.
  activeOverride?: { id: string; type: DayOverrideType };
}

const OVERRIDE_OPTIONS: ReadonlyArray<{
  type: DayOverrideType;
  label: string;
  description: string;
}> = [
  { type: 'bag_suspended', label: 'No lunch needed', description: 'Child is absent or skipping' },
  { type: 'half_day',      label: 'Half-day',        description: 'Shorter school day, lighter bag' },
  { type: 'field_trip',    label: 'Field trip',      description: 'Portable, no-mess foods' },
  { type: 'sick_day',      label: 'Sick day',        description: 'Gentle, easy-to-eat foods' },
  { type: 'post_dentist',  label: 'Post-dentist',    description: 'Soft foods only' },
  { type: 'early_release', label: 'Early release',   description: 'Same plan, earlier delivery' },
  { type: 'sport_practice',label: 'Sport practice',  description: 'Extra energy — protein + carbs' },
  { type: 'test_day',      label: 'Test day',        description: 'Familiar, stress-free foods' },
];

// Story 3.19 — day-level context override picker.
// Surfaced from DisambiguationPicker L1 ("This day is different…"). Calls
// POST /v1/plans/:planId/items/:itemId/override with the selected override
// type. Lumi-proposed overrides (FR119) are confirmed via a separate flow
// that is not yet wired — this component always sends is_lumi_proposed=false.
export function OverridePicker({
  planId,
  planItemId,
  childId,
  overrideDate,
  onConfirm,
  onCancel,
  activeOverride,
}: OverridePickerProps) {
  const [error, setError] = useState<string | null>(null);
  const setOverride = useSetDayOverrideMutation();
  const revertOverride = useRevertDayOverrideMutation();

  const isPending = setOverride.isPending || revertOverride.isPending;

  const activeLabel = activeOverride
    ? OVERRIDE_OPTIONS.find((o) => o.type === activeOverride.type)?.label
    : null;

  async function selectOverride(type: DayOverrideType) {
    setError(null);
    try {
      await setOverride.mutateAsync({
        planId,
        itemId: planItemId,
        input: {
          override_type: type,
          override_date: overrideDate,
          child_id: childId,
          is_lumi_proposed: false,
        },
      });
      onConfirm();
    } catch {
      setError('Could not save that override. Please try again.');
    }
  }

  async function handleRevert() {
    if (!activeOverride) return;
    setError(null);
    try {
      await revertOverride.mutateAsync({
        planId,
        itemId: planItemId,
        overrideId: activeOverride.id,
      });
      onConfirm();
    } catch {
      setError('Could not undo that override. Please try again.');
    }
  }

  return (
    <div
      role="group"
      aria-label="Choose a day-level context override"
      className="mt-2 rounded-lg border border-stone-200 bg-white p-3 flex flex-col gap-2 shadow-sm font-sans text-[14px]"
    >
      {activeLabel !== null && activeLabel !== undefined && (
        <div className="flex items-center justify-between rounded-md bg-stone-50 border border-stone-200 px-3 py-2">
          <span className="text-[13px] text-stone-600">
            Active: <span className="font-medium text-stone-800">{activeLabel}</span>
          </span>
          <button
            type="button"
            onClick={() => { void handleRevert(); }}
            disabled={isPending}
            className="text-[12px] text-stone-500 hover:text-stone-800 underline underline-offset-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300"
          >
            Undo
          </button>
        </div>
      )}
      <p className="text-stone-500 text-[13px]">What&apos;s happening this day?</p>
      <div className="flex flex-col gap-1.5">
        {OVERRIDE_OPTIONS.map(({ type, label, description }) => (
          <button
            key={type}
            type="button"
            disabled={isPending}
            onClick={() => { void selectOverride(type); }}
            className="flex flex-col items-start rounded-md border border-stone-200 px-3 py-2 text-start hover:bg-stone-50 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
          >
            <span className="font-sans text-[14px] font-medium text-stone-800">{label}</span>
            <span className="font-sans text-[12px] text-stone-400">{description}</span>
          </button>
        ))}
      </div>
      {error !== null && (
        <p role="alert" className="text-[12px] text-red-600">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={onCancel}
        disabled={isPending}
        className="self-start text-[12px] text-stone-400 hover:text-stone-600 underline underline-offset-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300"
      >
        Cancel
      </button>
    </div>
  );
}

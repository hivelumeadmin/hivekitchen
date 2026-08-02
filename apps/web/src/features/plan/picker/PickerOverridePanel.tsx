import type { Weekday } from '@hivekitchen/types';
import { OverridePicker } from '../OverridePicker.js';
import { BACK_LINK_CLASS, ERROR_CLASS, deriveOverrideDate } from './picker-model.js';
import type { DaySlotView } from '../tree-adapter.js';

interface PickerOverridePanelProps {
  planId: string;
  day: Weekday;
  slot: DaySlotView;
  onConfirm: () => void;
  onBack: () => void;
}

// The override picker is per (slot, child). We pick the first child variation
// under the selected slot as the override target; richer per-child override UX
// is a follow-up slice.
export function PickerOverridePanel({
  planId,
  day,
  slot,
  onConfirm,
  onBack,
}: PickerOverridePanelProps) {
  const targetVariation = slot.variations[0];

  if (targetVariation === undefined) {
    return (
      <>
        <p role="alert" className={ERROR_CLASS}>
          No variation to override on this slot.
        </p>
        <button type="button" onClick={onBack} className={BACK_LINK_CLASS}>
          Back
        </button>
      </>
    );
  }

  return (
    <OverridePicker
      planId={planId}
      planSlotId={slot.plan_slot_id}
      childId={targetVariation.child_id}
      overrideDate={deriveOverrideDate(day)}
      onConfirm={onConfirm}
      onCancel={onBack}
    />
  );
}

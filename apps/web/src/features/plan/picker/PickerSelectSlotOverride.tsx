import { BACK_LINK_CLASS, LIST_BUTTON_CLASS, PROMPT_CLASS } from './picker-model.js';
import type { DaySlotView } from '../tree-adapter.js';

interface PickerSelectSlotOverrideProps {
  slots: readonly DaySlotView[];
  onSelect: (slot: DaySlotView) => void;
  onBack: () => void;
}

export function PickerSelectSlotOverride({
  slots,
  onSelect,
  onBack,
}: PickerSelectSlotOverrideProps) {
  return (
    <>
      <p className={PROMPT_CLASS}>Which slot is different today?</p>
      <div className="flex flex-col gap-1.5">
        {slots.map((slot) => (
          <button
            key={`override-${slot.plan_slot_id}`}
            type="button"
            onClick={() => onSelect(slot)}
            className={LIST_BUTTON_CLASS}
          >
            {slot.slot_kind}
            {slot.extra_kind !== null ? ` · ${slot.extra_kind}` : ''}
          </button>
        ))}
      </div>
      <button type="button" onClick={onBack} className={BACK_LINK_CLASS}>
        Back
      </button>
    </>
  );
}

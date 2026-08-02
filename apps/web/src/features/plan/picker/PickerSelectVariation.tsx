import { BACK_LINK_CLASS, LIST_BUTTON_CLASS, PROMPT_CLASS } from './picker-model.js';
import type { VariationWithSlot } from './picker-model.js';

interface PickerSelectVariationProps {
  variations: VariationWithSlot[];
  childNames?: Readonly<Record<string, string>>;
  onSelect: (selected: VariationWithSlot) => void;
  onBack: () => void;
}

export function PickerSelectVariation({
  variations,
  childNames,
  onSelect,
  onBack,
}: PickerSelectVariationProps) {
  return (
    <>
      <p className={PROMPT_CLASS}>Which child / slot?</p>
      <div className="flex flex-col gap-1.5">
        {variations.map(({ slot, variation }) => {
          const childLabel = childNames?.[variation.child_id] ?? variation.child_id.slice(0, 8);
          return (
            <button
              key={variation.id}
              type="button"
              onClick={() => onSelect({ slot, variation })}
              className={LIST_BUTTON_CLASS}
            >
              {slot.slot_kind} · {childLabel}
            </button>
          );
        })}
      </div>
      <button type="button" onClick={onBack} className={BACK_LINK_CLASS}>
        Back
      </button>
    </>
  );
}

import {
  BACK_LINK_CLASS,
  LIST_BUTTON_DISABLED_CLASS,
  PROMPT_CLASS,
} from './picker-model.js';

interface PickerSelectPauseChildProps {
  childIds: string[];
  childNames?: Readonly<Record<string, string>>;
  isPending: boolean;
  onSelect: (childId: string) => void;
  onBack: () => void;
}

export function PickerSelectPauseChild({
  childIds,
  childNames,
  isPending,
  onSelect,
  onBack,
}: PickerSelectPauseChildProps) {
  return (
    <>
      <p className={PROMPT_CLASS}>Pause which child for the day?</p>
      <div className="flex flex-col gap-1.5">
        {childIds.map((childId) => {
          const childLabel = childNames?.[childId] ?? childId.slice(0, 8);
          return (
            <button
              key={`pause-child-${childId}`}
              type="button"
              onClick={() => onSelect(childId)}
              disabled={isPending}
              className={LIST_BUTTON_DISABLED_CLASS}
            >
              {childLabel}
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

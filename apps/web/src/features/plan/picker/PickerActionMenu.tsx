import type { Weekday } from '@hivekitchen/types';
import { BACK_LINK_CLASS, CHIP_CLASS, ERROR_CLASS, PROMPT_CLASS } from './picker-model.js';

interface PickerActionMenuProps {
  day: Weekday;
  error: string | null;
  isPending: boolean;
  sickDayDisabled: boolean;
  showSwapMain: boolean;
  showPauseChild: boolean;
  showRegenDay: boolean;
  onSickDay: () => void;
  onChangeItem: () => void;
  onSwapMain: () => void;
  onOverride: () => void;
  onPauseChild: () => void;
  onRegenDay: (day: Weekday) => void;
  onDismiss: () => void;
}

export function PickerActionMenu({
  day,
  error,
  isPending,
  sickDayDisabled,
  showSwapMain,
  showPauseChild,
  showRegenDay,
  onSickDay,
  onChangeItem,
  onSwapMain,
  onOverride,
  onPauseChild,
  onRegenDay,
  onDismiss,
}: PickerActionMenuProps) {
  return (
    <>
      <p className={PROMPT_CLASS}>What would you like to do?</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onSickDay} disabled={sickDayDisabled} className={CHIP_CLASS}>
          Sick day
        </button>
        <button type="button" onClick={onChangeItem} disabled={isPending} className={CHIP_CLASS}>
          Change an item
        </button>
        {showSwapMain && (
          <button type="button" onClick={onSwapMain} disabled={isPending} className={CHIP_CLASS}>
            Swap Main
          </button>
        )}
        <button type="button" onClick={onOverride} disabled={isPending} className={CHIP_CLASS}>
          This day is different…
        </button>
        {showPauseChild && (
          <button type="button" onClick={onPauseChild} disabled={isPending} className={CHIP_CLASS}>
            Pause one child
          </button>
        )}
        {showRegenDay && (
          <button
            type="button"
            onClick={() => { onRegenDay(day); }}
            disabled={isPending}
            className={CHIP_CLASS}
          >
            Ask Lumi to redo this day
          </button>
        )}
      </div>
      {error !== null && (
        <p role="alert" className={ERROR_CLASS}>
          {error}
        </p>
      )}
      <button type="button" onClick={onDismiss} className={BACK_LINK_CLASS}>
        Cancel
      </button>
    </>
  );
}

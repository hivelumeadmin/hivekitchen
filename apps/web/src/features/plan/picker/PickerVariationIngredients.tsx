import type { RefObject } from 'react';
import {
  ERROR_CLASS,
  INLINE_BACK_LINK_CLASS,
  PROMPT_CLASS,
  SUBMIT_CLASS,
  TEXT_INPUT_CLASS,
} from './picker-model.js';

interface PickerVariationIngredientsProps {
  pickerId: string;
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  error: string | null;
  isPending: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}

export function PickerVariationIngredients({
  pickerId,
  inputRef,
  value,
  error,
  isPending,
  onChange,
  onSubmit,
  onBack,
}: PickerVariationIngredientsProps) {
  return (
    <>
      <label htmlFor={`${pickerId}-ingredients`} className={PROMPT_CLASS}>
        What should it be instead?
      </label>
      <input
        ref={inputRef}
        id={`${pickerId}-ingredients`}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isPending) { onSubmit(); }
        }}
        placeholder="e.g. hummus, rice crackers, apple"
        aria-describedby={error !== null ? `${pickerId}-error` : undefined}
        className={TEXT_INPUT_CLASS}
      />
      {error !== null && (
        <p id={`${pickerId}-error`} role="alert" className={ERROR_CLASS}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={isPending || value.trim().length === 0}
          className={SUBMIT_CLASS}
        >
          {isPending ? 'Checking…' : 'Swap'}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={isPending}
          className={INLINE_BACK_LINK_CLASS}
        >
          Back
        </button>
      </div>
    </>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { Weekday } from '@hivekitchen/types';
import {
  DAY_LABEL,
  ERROR_CLASS,
  INLINE_BACK_LINK_CLASS,
  PROMPT_CLASS,
  SUBMIT_CLASS,
  TEXT_INPUT_CLASS,
} from './picker-model.js';

interface PickerProposeSwapProps {
  pickerId: string;
  day: Weekday;
  onProposeSwap: (day: Weekday, content: string) => Promise<string>;
  onSwapStarted: (proposalId: string) => void;
  onDismiss: () => void;
  onBack: () => void;
}

// Slice 5-S12 — conversational swap proposal. State is panel-local: the shell
// clears its shared error both when routing in and when routing out, so this
// flow's input and error never crossed the level boundary.
export function PickerProposeSwap({
  pickerId,
  day,
  onProposeSwap,
  onSwapStarted,
  onDismiss,
  onBack,
}: PickerProposeSwapProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isProposing, setIsProposing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Synchronous guard: `isProposing` is async state, so a same-tick Enter + click
  // (or double Enter) can both pass before the re-render lands. The ref blocks
  // the second dispatch immediately, preventing duplicate proposal turns.
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit() {
    if (value.trim().length === 0) return;
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsProposing(true);
    setError(null);
    try {
      const proposalId = await onProposeSwap(day, value.trim());
      onSwapStarted(proposalId);
      onDismiss();
    } catch {
      setError('Could not send. Please try again.');
    } finally {
      setIsProposing(false);
      isSubmittingRef.current = false;
    }
  }

  return (
    <>
      <p className="text-[11px] text-stone-400 uppercase tracking-wide">
        Continuing from {DAY_LABEL[day]}&rsquo;s dinner
      </p>
      <label htmlFor={`${pickerId}-propose`} className={PROMPT_CLASS}>
        What should Lumi swap it for?
      </label>
      <input
        ref={inputRef}
        id={`${pickerId}-propose`}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isProposing) { void handleSubmit(); }
        }}
        placeholder="e.g. something lighter, maybe a wrap"
        aria-describedby={error !== null ? `${pickerId}-propose-error` : undefined}
        className={TEXT_INPUT_CLASS}
      />
      {error !== null && (
        <p id={`${pickerId}-propose-error`} role="alert" className={ERROR_CLASS}>
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => { void handleSubmit(); }}
          disabled={isProposing || value.trim().length === 0}
          className={SUBMIT_CLASS}
        >
          {isProposing ? 'Sending…' : 'Ask Lumi'}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={isProposing}
          className={INLINE_BACK_LINK_CLASS}
        >
          Back
        </button>
      </div>
    </>
  );
}

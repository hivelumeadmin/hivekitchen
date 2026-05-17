import { useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export interface AllergyClearedBadgeProps {
  childName: string;
  allergen: string;
  auditUrl: string;
  isRechecking?: boolean;
}

// Story 3.10 — affirmative plan-level badge per (child, allergen) pair.
// Inline-disclosure pattern (no Radix): button trigger + sibling dialog,
// keyboard-dismissable, never destructive (safety-cleared-* tokens only).
export function AllergyClearedBadge({
  childName,
  allergen,
  auditUrl,
  isRechecking = false,
}: AllergyClearedBadgeProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const labelId = useId();

  function handleKeyDown(e: ReactKeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  const label = `Cleared for ${childName}'s ${allergen}`;
  const checkmarkClass = isRechecking
    ? 'bg-safety-cleared-200 ring-2 ring-foliage-300 motion-safe:animate-pulse'
    : 'bg-safety-cleared-200';

  return (
    <span className="relative inline-block">
      <button
        ref={triggerRef}
        id={labelId}
        type="button"
        aria-expanded={open}
        aria-controls={dialogId}
        aria-label={label}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        className="inline-flex items-center gap-1 rounded-full border border-safety-cleared-200 bg-safety-cleared-100 px-2 py-0.5 font-sans text-[13px] font-medium leading-none text-safety-cleared-800 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-cleared-400 focus-visible:ring-offset-1"
      >
        <span
          aria-hidden="true"
          className={`inline-flex h-3 w-3 items-center justify-center rounded-full ${checkmarkClass}`}
        >
          <svg
            width="8"
            height="8"
            viewBox="0 0 12 12"
            fill="currentColor"
            className="text-safety-cleared-800"
          >
            <path d="M10 3L5 8.5 2 5.5 1.5 6l3.5 3.5 5.5-6L10 3z" />
          </svg>
        </span>
        {label}
      </button>
      {open && (
        // The dialog catches Escape to close + restore focus to the trigger
        // (WAI-ARIA disclosure pattern). The same suppression Story 3.9
        // adopted for <article> applies here: keeping role="dialog" landmark
        // is intentional, and Escape-to-close is the canonical interaction.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          id={dialogId}
          role="dialog"
          aria-modal={false}
          aria-labelledby={labelId}
          onKeyDown={handleKeyDown}
          className="absolute z-30 mt-2 max-w-[320px] rounded-lg border border-border bg-surface p-3 shadow-sm font-sans text-sm leading-[1.5] text-fg-muted"
        >
          <p>
            We checked every ingredient against {childName}&apos;s {allergen} allergy.
            Nothing in today&apos;s lunch contains {allergen} or was made near them.
          </p>
          <a
            href={auditUrl}
            className="mt-2 inline-block font-medium text-safety-cleared-800 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-safety-cleared-400"
          >
            View audit
          </a>
        </div>
      )}
    </span>
  );
}

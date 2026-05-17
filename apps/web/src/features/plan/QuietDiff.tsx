import { useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

interface QuietDiffProps {
  summary: string | null;
  explanation?: string;
}

// Story 3.11 — low-emphasis rear-view banner above the Brief surface.
// Renders nothing when summary is null. The component is "dumb": it trusts
// that the API composer (Story 3.12+) never passes allergy/dietary mutations
// here — those escalate to AccountableError or ThreadTurn (loud, by design).
// See UX-DR19 silent-mutation carve-out.
export function QuietDiff({ summary, explanation }: QuietDiffProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();

  if (!summary) return null;

  function handleKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <div className="flex items-start gap-2 font-sans text-sm leading-[1.4] text-fg-muted">
      <p>{summary}</p>
      {explanation !== undefined && (
        <span className="relative mt-0.5 inline-block flex-shrink-0">
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={open}
            aria-controls={popoverId}
            aria-label="Why this change?"
            onClick={() => setOpen((v) => !v)}
            onKeyDown={handleKeyDown}
            className="rounded-sm font-sans text-sm leading-none text-fg-muted transition-colors hover:text-fg motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
          >
            ⋯
          </button>
          {open && (
            // The dialog catches Escape to close + restore focus to the trigger
            // (WAI-ARIA disclosure pattern; same as AllergyClearedBadge in
            // Story 3.10). The dialog content has no focusable children, so
            // focus stays on the trigger — this listener is a belt-and-braces
            // catch for keyboard events that bubble from inside the popover.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
            <div
              id={popoverId}
              role="dialog"
              aria-label="Why this change?"
              onKeyDown={handleKeyDown}
              className="absolute z-20 start-0 top-6 min-w-[240px] max-w-[300px] rounded-lg border border-border bg-surface p-3 font-sans text-[13px] leading-[1.5] text-fg-muted shadow-sm"
            >
              {explanation}
            </div>
          )}
        </span>
      )}
    </div>
  );
}

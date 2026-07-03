import { useId, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog } from './Dialog.js';

// Epic 13-s11 — the artifact host. The named non-anchor screens (day-detail,
// grocery list, evening check-in, plan history) leave the nav and are summoned
// as a wide sheet OVER the Brief anchor: their URL is kept (deep-links land on
// the Brief with this sheet open), but they are no longer tabs to hunt for.
//
// Composes the shared <Dialog> primitive so the artifact inherits the same a11y
// contract as LumiSheet — focus-trap, Escape, scrim-close, scroll-lock,
// prefers-reduced-motion, and focus-restore. Closing (Escape / scrim / the close
// affordance) navigates back to /app, and the Dialog restores focus to whatever
// summoned it (a Brief tile in-app, or the document on a cold deep-link). There
// is ONE code path for deep-link and in-app summon: both are just this URL.
export interface ArtifactSheetProps {
  // Accessible name for the dialog (labels the modal; the hosted screen keeps
  // its own visible heading, so this is a screen-reader label only).
  label: string;
  children: ReactNode;
}

export function ArtifactSheet({ label, children }: ArtifactSheetProps) {
  const navigate = useNavigate();
  const titleId = useId();

  function close() {
    void navigate('/app', { replace: true });
  }

  return (
    <Dialog
      open
      onClose={close}
      titleId={titleId}
      placement="center"
      scrimClassName="bg-stone-900/50"
      panelClassName="relative flex w-full max-w-5xl max-h-[92vh] flex-col overflow-y-auto rounded-2xl border border-border bg-bg shadow-xl animate-[hk-slide-in-sheet_150ms_ease-out] motion-reduce:animate-none"
    >
      <h2 id={titleId} className="sr-only">
        {label}
      </h2>
      <button
        type="button"
        onClick={close}
        aria-label={`Close ${label}`}
        className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-surface text-fg-muted shadow-sm transition-colors hover:text-fg motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-foliage"
      >
        <span aria-hidden="true">×</span>
      </button>
      {children}
    </Dialog>
  );
}

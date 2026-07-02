import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  titleId: string;
  descriptionId?: string;
  children: ReactNode;
  // Optional chrome overrides (Epic 13-s2) so the warm corner Lumi sheet can
  // reuse this dialog's focus-trap/escape/scrim/restore machinery while supplying
  // its own look + placement. Omitted everywhere else → unchanged centered modal.
  id?: string;
  panelClassName?: string;
  scrimClassName?: string;
  placement?: 'center' | 'bottom-right';
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  titleId,
  descriptionId,
  children,
  id,
  panelClassName,
  scrimClassName,
  placement = 'center',
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  // Stable ref so the keydown closure never captures a stale onClose identity.
  // Without this, any parent re-render while the dialog is open fires the effect
  // cleanup → setup cycle, overwriting previouslyFocused with an element inside
  // the dialog and breaking focus restoration on close.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const dialog = dialogRef.current;
    if (dialog === null) return;

    const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const first = focusables[0];
    if (first !== undefined) first.focus();
    else dialog.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialogEl = dialogRef.current;
      if (dialogEl === null) return;
      // Selector already excludes [disabled] and [tabindex="-1"]; do NOT filter
      // on offsetParent (jsdom returns null for it under no-layout, which would
      // collapse the trap list and let focus escape during tests).
      const list = Array.from(dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('aria-hidden'),
      );
      if (list.length === 0) {
        event.preventDefault();
        return;
      }
      const firstEl = list[0]!;
      const lastEl = list[list.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && active === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    const previous = previouslyFocused.current;
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      if (previous !== null && document.contains(previous)) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  const scrimClass = scrimClassName ?? 'bg-stone-900/60';
  const wrapperPlacement =
    placement === 'bottom-right'
      ? 'items-end justify-end p-4 sm:p-6'
      : 'items-center justify-center px-4';
  const panelClass =
    panelClassName ?? 'bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] flex flex-col p-6';

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-40 motion-reduce:transition-none ${scrimClass}`}
        aria-hidden="true"
        onClick={onClose}
      />
      <div className={`fixed inset-0 z-50 flex ${wrapperPlacement} pointer-events-none`}>
        <div
          ref={dialogRef}
          id={id}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          className={`${panelClass} pointer-events-auto outline-none`}
        >
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}

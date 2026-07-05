import { useEffect, useRef, useCallback } from 'react';
import { useLumiStore } from '@/stores/lumi.store.js';

// Epic 13-s3 — the whisper channel (valet rule 3). When a lumi.nudge arrives
// and proactiveNudges is true, the presence transitions to 'whisper' and this
// component surfaces a single quiet dismissible line above the dot.
//
// The outer container (role="status" aria-live="polite") is ALWAYS mounted so
// the live region is established before content changes — AT announces new
// nudge text as a live region update rather than a new element with pre-filled
// content (which most AT ignores). The container is visually hidden with
// sr-only when not whispering.
//
// Auto-dismisses after 10 s; the timer pauses on pointer-hover and focus-within
// so the user can read without pressure. "See why" opens the summoned sheet;
// "Dismiss" clears the nudge and recedes atomically. "Undo" is deferred to
// 13-s2.5 (requires a registered undoable server event).
export function LumiWhisper() {
  const presenceState = useLumiStore((s) => s.presenceState);
  const pendingNudge = useLumiStore((s) => s.pendingNudge);
  const isVisible = presenceState === 'whisper' && pendingNudge !== null;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      useLumiStore.getState().dismissNudge();
    }, 10_000);
  }, [clearTimer]);

  useEffect(() => {
    if (!isVisible) {
      clearTimer();
      return;
    }
    startTimer();
    return clearTimer;
  }, [isVisible, startTimer, clearTimer]);

  const body = pendingNudge?.body;
  const text = isVisible ? (body?.type === 'message' ? body.content : 'Lumi has an update') : '';

  function handleSeeWhy() {
    clearTimer();
    useLumiStore.getState().summon();
  }

  function handleDismiss() {
    clearTimer();
    useLumiStore.getState().dismissNudge();
    document.querySelector<HTMLElement>('[data-lumi-dot]')?.focus();
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- handlers only pause/resume the auto-dismiss timer (WCAG 2.2.1 timing adjustability); activation lives on the buttons inside
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      onMouseEnter={clearTimer}
      onMouseLeave={isVisible ? startTimer : undefined}
      onFocus={clearTimer}
      onBlur={(e) => {
        if (isVisible && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
          startTimer();
        }
      }}
      className={
        isVisible
          ? [
              'fixed bottom-20 right-6 z-50',
              'max-w-xs w-[calc(100vw-3rem)]',
              'bg-bg border border-border rounded-lg shadow-md',
              'px-3 py-2.5',
              'animate-[hk-slide-up-whisper_150ms_ease-out] motion-reduce:animate-none',
            ].join(' ')
          : 'sr-only'
      }
    >
      {isVisible && (
        <>
          <p className="text-sm text-fg leading-snug">{text}</p>
          <div className="flex gap-3 mt-1.5">
            <button
              type="button"
              onClick={handleSeeWhy}
              aria-label="See why Lumi sent this nudge"
              className="text-xs font-medium text-lumi-terracotta hover:text-lumi-terracotta-warmed transition-colors motion-reduce:transition-none"
            >
              See why
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss nudge"
              className="text-xs text-fg-muted hover:text-fg transition-colors motion-reduce:transition-none"
            >
              Dismiss
            </button>
          </div>
        </>
      )}
    </div>
  );
}

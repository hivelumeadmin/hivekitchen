import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HistoryView, type ChatTurn } from './HistoryView.js';

interface Readonly_EditConversationProps {
  /**
   * Short context label rendered at the top-left of the header strip
   * (e.g. "Refining — Collective Kitchen Identity").
   */
  readonly sectionLabel: string;
  /** Current-state preview rendered under the section label. */
  readonly summary: ReactNode;
  /** Lumi's opening prompt for this edit moment. */
  readonly prompt: string;
  /**
   * Chips slot rendered immediately after the prompt — used for current
   * state controls (e.g., "Tap to drop" chips for existing items).
   */
  readonly topChips?: ReactNode;
  /**
   * Optional prose slot — rendered between topChips and the suggestion
   * chips. Reserved for surfaces that need a longer free-form field.
   */
  readonly prose?: ReactNode;
  /**
   * Chips slot rendered immediately above the input bar — mirrors the
   * onboarding moments where suggestion / action chips live right above
   * the textarea.
   */
  readonly chips?: ReactNode;
  readonly draft: string;
  readonly onDraftChange: (next: string) => void;
  readonly draftPlaceholder?: string;
  /**
   * Messages already sent to Lumi in this session. Rolled into the History
   * view as parent chat turns. NOT rendered as an inline rail in focused
   * mode — sent messages are visible only via the history toggle, matching
   * the moments' chat behavior (once sent, the bubble lives in the thread).
   */
  readonly capturedNotes?: readonly string[];
  /**
   * Called when the user taps Send. Receives the trimmed typed text; the
   * parent owns building the composite payload (typed text + staged chip
   * diff + section context) and appending it to capturedNotes. Each Send
   * is a server-bound commit — no retraction.
   */
  readonly onSendNote?: (typedText: string) => void;
  /**
   * Optional gating override. When supplied, Send is enabled iff this is true.
   * When omitted, Send falls back to "typed text non-empty". Parents with
   * staged chip changes set this true even when the textarea is empty.
   */
  readonly canSend?: boolean;
  /**
   * Close handler. Wired to the single "I'm done" button at the bottom of
   * the panel. There is no separate Save — each Send already committed.
   */
  readonly onDone: () => void;
}

export type EditConversationProps = Readonly<Readonly_EditConversationProps>;

/**
 * Inline Lumi conversation surface used to edit a Kitchen Profile section
 * in-place. Mirrors the onboarding moments:
 *  - top header strip with section context + history toggle
 *  - centered Lumi orb + serif prompt (focused mode)
 *  - chip rails (current state + suggestions) sandwiching an optional prose
 *    slot, sitting directly above the input
 *  - auto-grow textarea with an amber Send button
 *  - single "I'm done" close button at the bottom
 *
 * Send semantics: every Send tap commits a composite (chip-diff + typed
 * text + section context) to the conversation thread, exactly like sending
 * a chat message. The bubble is visible only in the history toggle — no
 * inline rail, no retraction. There is no separate Save action.
 *
 * Section-specific wrappers (e.g. IdentityEditConversation) own the staged
 * change state and build the composite; this shell owns the chrome only.
 */
export function EditConversation({
  sectionLabel,
  summary,
  prompt,
  topChips,
  prose,
  chips,
  draft,
  onDraftChange,
  draftPlaceholder = 'Tell Lumi anything else…',
  capturedNotes = [],
  onSendNote,
  canSend,
  onDone,
}: EditConversationProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const [showHistory, setShowHistory] = useState(false);
  const [pulseSent, setPulseSent] = useState(false);

  // The conversation in this edit session — starts with Lumi's prompt, then
  // each user-sent message becomes a parent turn.
  const turns = useMemo<ChatTurn[]>(
    () => [
      { id: 'lumi-0', role: 'lumi', content: prompt },
      ...capturedNotes.map((note, idx) => ({
        id: `parent-${idx}`,
        role: 'parent' as const,
        content: note,
      })),
    ],
    [prompt, capturedNotes],
  );

  const sendEnabled = canSend ?? draft.trim().length > 0;
  function handleSendNote() {
    if (!sendEnabled) return;
    onSendNote?.(draft.trim());
    onDraftChange('');
    setPulseSent(true);
    window.setTimeout(() => setPulseSent(false), 600);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-amber/40 bg-surface shadow-lg">
      {/* Header strip — section context + history toggle */}
      <header className="flex items-start justify-between gap-4 border-b border-border/15 bg-amber/5 px-6 py-4 md:px-8">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="font-sans text-[10px] font-medium uppercase tracking-[0.2em] text-amber-warm">
            {sectionLabel}
          </p>
          <div>{summary}</div>
        </div>
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          title={showHistory ? 'Hide conversation history' : 'Show conversation history'}
          aria-pressed={showHistory}
          className={[
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors',
            showHistory
              ? 'border-amber/40 text-amber'
              : 'border-neutral-400/30 text-fg-muted hover:text-fg',
          ].join(' ')}
        >
          <IcoHistory className="h-[18px] w-[18px]" />
        </button>
      </header>

      {/* Body */}
      <div className="flex flex-col gap-5 px-6 py-8 md:px-10 md:py-10">
        {showHistory ? (
          <div className="mx-auto w-full max-w-2xl">
            <HistoryView turns={turns} />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber/20 bg-amber/10">
              <IcoWaveform className="h-6 w-6 animate-pulse text-amber" />
            </div>
            <p className="max-w-2xl font-serif text-xl leading-snug text-fg md:text-[22px]">
              {prompt}
            </p>
          </div>
        )}

        {/* Current-state chips (e.g., "Tap to drop") */}
        {topChips && (
          <div className="flex flex-col items-center gap-2">{topChips}</div>
        )}

        {prose}

        {/* Suggestion / action chips — directly above the input bar */}
        {chips && (
          <div className="flex flex-col items-center gap-2">{chips}</div>
        )}

        {/* Input bar — textarea + amber Send button, mirrors Moments 1–4 */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendNote();
          }}
          className="mx-auto w-full max-w-2xl"
        >
          <label htmlFor="edit-message" className="sr-only">
            Talk to Lumi about this
          </label>
          <div className="flex items-end gap-2 rounded-2xl border border-neutral-400/30 bg-surface-2/40 px-2 py-1.5 backdrop-blur-md focus-within:border-amber/50 transition-colors">
            <textarea
              ref={textareaRef}
              id="edit-message"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendNote();
                }
              }}
              rows={1}
              maxLength={400}
              placeholder={draftPlaceholder}
              style={{ maxHeight: '9.5rem' }}
              className="flex-1 resize-none overflow-y-auto bg-transparent px-4 py-2 font-sans text-[16px] leading-snug text-fg placeholder:text-fg-muted/40 focus:outline-none transition-[height] duration-150 ease-out"
            />
            <button
              type="submit"
              disabled={!sendEnabled}
              aria-label="Send message to Lumi"
              className={[
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber text-bg shadow-md transition-all hover:bg-amber-warm disabled:cursor-not-allowed disabled:opacity-50',
                pulseSent ? 'animate-pulse' : '',
              ].join(' ')}
            >
              <IcoSend className="h-5 w-5" />
            </button>
          </div>
        </form>

        {/* Close bar — single Done button. No Save: each Send already
            committed. */}
        <div className="mx-auto flex w-full max-w-2xl items-center justify-end pt-1">
          <button
            type="button"
            onClick={onDone}
            className="inline-flex items-center gap-2 rounded-full border border-neutral-400/30 px-5 py-2.5 font-sans text-sm font-medium text-fg-muted transition-colors hover:border-amber/50 hover:text-fg"
          >
            I'm done with my edit
          </button>
        </div>
      </div>
    </div>
  );
}

function IcoWaveform({ className }: { className: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 8.25v7.5m3-10.5v13.5M9 6.75v10.5m3-13.5v16.5m3-13.5v10.5m3-7.5v4.5"
      />
    </svg>
  );
}

function IcoSend({ className }: { className: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18"
      />
    </svg>
  );
}

function IcoHistory({ className }: { className: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

import type { ChatTurn } from '../data/conversation-history.js';

interface HistoryViewProps {
  /** All exchanged turns up to and including the latest Lumi turn. */
  readonly turns: readonly ChatTurn[];
  /**
   * When true, the most recent Lumi turn gets a soft amber accent to mark
   * it as the active question the parent is responding to.
   */
  readonly emphasizeLatest?: boolean;
}

/**
 * Renders the full onboarding conversation as a stack of chat bubbles —
 * Lumi turns left-aligned in surface tone (font-serif, italic-tone), parent
 * turns right-aligned in surface-2 tone (font-sans).
 *
 * Pattern lifted from the production `OnboardingText.tsx` history mode so the
 * mockup history feels like a sibling of the shipped onboarding surface.
 *
 * Renders inside the flex-1 conversation area, replacing the focused-mode
 * centered prose when the history toggle is on. The chip band + input bar
 * below remain visible so the parent can still respond.
 */
export function HistoryView({ turns, emphasizeLatest = true }: HistoryViewProps) {
  const lastLumiIndex = (() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i]!.role === 'lumi') return i;
    }
    return -1;
  })();

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 md:px-8 py-6 min-h-0">
      <div className="mx-auto w-full max-w-2xl">
        <ol className="flex flex-col gap-4" aria-label="Onboarding conversation history">
          {turns.map((turn, idx) => {
            const isLatestLumi = emphasizeLatest && idx === lastLumiIndex;
            return (
              <li
                key={turn.id}
                className={['flex', turn.role === 'lumi' ? 'justify-start' : 'justify-end'].join(' ')}
              >
                <div
                  className={[
                    'max-w-[85%] rounded-2xl px-4 py-3 text-base leading-relaxed',
                    turn.role === 'lumi'
                      ? isLatestLumi
                        ? 'bg-surface-2 font-serif text-fg rounded-tl-sm shadow-sm ring-1 ring-amber/30'
                        : 'bg-surface font-serif text-fg rounded-tl-sm'
                      : 'bg-surface-2 font-sans text-fg rounded-tr-sm',
                  ].join(' ')}
                  // Lumi content may contain &ldquo;/&rdquo; entities; render as plain text safely.
                  dangerouslySetInnerHTML={{ __html: turn.content }}
                />
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

export interface ChatTurn {
  readonly id: string;
  readonly role: 'lumi' | 'parent';
  readonly content: string;
}

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
 * Renders a Lumi conversation as a stack of chat bubbles — Lumi turns
 * left-aligned in surface tone (font-serif), parent turns right-aligned in
 * surface-2 tone (font-sans). Used by the Kitchen Profile in-place editor
 * (`EditConversation`) behind its history toggle.
 */
export function HistoryView({ turns, emphasizeLatest = true }: HistoryViewProps) {
  const lastLumiIndex = (() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i]!.role === 'lumi') return i;
    }
    return -1;
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6 md:px-8">
      <div className="mx-auto w-full max-w-2xl">
        <ol className="flex flex-col gap-4" aria-label="Conversation history">
          {turns.map((turn, idx) => {
            const isLatestLumi = emphasizeLatest && idx === lastLumiIndex;
            return (
              <li
                key={turn.id}
                className={['flex', turn.role === 'lumi' ? 'justify-start' : 'justify-end'].join(' ')}
              >
                <div
                  className={[
                    'max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-3 text-base leading-relaxed',
                    turn.role === 'lumi'
                      ? isLatestLumi
                        ? 'rounded-tl-sm bg-surface-2 font-serif text-fg shadow-sm ring-1 ring-[color-mix(in_srgb,var(--amber)_30%,transparent)]'
                        : 'rounded-tl-sm bg-surface font-serif text-fg'
                      : 'rounded-tr-sm bg-surface-2 font-sans text-fg',
                  ].join(' ')}
                >
                  {/* Render as an escaped text child — turn content is
                      parent/LLM-authored and must never be injected as HTML. */}
                  {turn.content}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

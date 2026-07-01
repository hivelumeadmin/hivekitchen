import type { ChipConfig } from '@hivekitchen/contracts';
import { formatUserEcho, type Turn } from './onboarding-conversation.js';
import { OnboardingChips } from './OnboardingChips.js';
import {
  StatusLine,
  WaveformGlyph,
  SendGlyph,
  momentSubtitle,
  inputPlaceholder,
} from './conversation-column-helpers.js';

const GAP_LABELS: Record<string, { label: string; moment: number }> = {
  m1_table: { label: "Who's at the table", moment: 1 },
  m2_safe: { label: 'What I need to keep safe', moment: 2 },
  m5_starting_line: { label: 'A starting line for Lumi', moment: 5 },
};

interface ConversationColumnProps {
  turns: Turn[];
  pending: boolean;
  isComplete: boolean;
  currentMomentKey: string | null;
  chipConfig: ChipConfig | null;
  chipSelections: string[];
  draft: string;
  error: string | null;
  finalizing: boolean;
  requiredSetComplete: boolean | null;
  missingRequiredSet: string[];
  coldStartMode: boolean;
  coldStartDishCount: number;
  isResume: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onToggleChip: (key: string) => void;
  onSkip: () => void;
  onOverrideFewer: () => void;
  onFinalize: () => void;
  onJumpToMoment: (key: string) => void;
  onOpenProfile: () => void;
}

// One calm conversation mode (13-s5 AC1): no focused/history toggle, no history
// modal — Lumi's current question, the parent's clean last echo, chips inline,
// one pill input. The summary/finalize gate is preserved unchanged (13-s6 owns
// the recognition-ending rebuild).
export function ConversationColumn({
  turns,
  pending,
  isComplete,
  currentMomentKey,
  chipConfig,
  chipSelections,
  draft,
  error,
  finalizing,
  requiredSetComplete,
  missingRequiredSet,
  coldStartMode,
  coldStartDishCount,
  isResume,
  onDraftChange,
  onSubmit,
  onToggleChip,
  onSkip,
  onOverrideFewer,
  onFinalize,
  onJumpToMoment,
  onOpenProfile,
}: ConversationColumnProps) {
  const lumiTurn = [...turns].reverse().find((t) => t.role === 'lumi');
  const lastUserTurn = [...turns].reverse().find((t) => t.role === 'user');
  const userTurnCount = turns.filter((t) => t.role === 'user').length;

  return (
    <section className="relative flex flex-1 flex-col bg-bg md:w-[45%] md:flex-none">
      <header className="flex shrink-0 items-center justify-between bg-bg/80 px-6 py-5 backdrop-blur-sm md:px-8">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-xl font-medium tracking-tight text-amber">HiveKitchen</h1>
          <span className="font-sans text-[11px] font-medium uppercase tracking-widest text-fg-muted">
            {momentSubtitle(currentMomentKey, isResume, userTurnCount)}
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenProfile}
          aria-label="Open your kitchen profile"
          className="flex items-center gap-2 rounded-full border border-border/50 px-4 py-2 font-sans text-sm font-medium text-fg-muted transition-colors hover:bg-surface md:hidden"
        >
          View Profile
        </button>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-8 md:px-8">
        {(pending && lumiTurn === undefined) ? null : (
          <div className="flex w-full max-w-xl flex-col items-center gap-6 text-center">
            {/* Parent's clean last echo (13-s5 AC2 — never the [Chips selected: …] sentinel) */}
            {lastUserTurn !== undefined && (
              <p className="max-w-md self-end rounded-2xl bg-surface-2 px-4 py-2 text-right font-sans text-sm text-fg-muted">
                {formatUserEcho(lastUserTurn.content)}
              </p>
            )}

            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber/20 bg-amber/10">
              <WaveformGlyph />
            </div>
            <p
              className="font-serif text-2xl leading-snug text-fg md:text-[28px]"
              aria-live="polite"
            >
              {lumiTurn?.content ?? ''}
            </p>

            {currentMomentKey === 'summary' && missingRequiredSet.length > 0 && (
              <div className="flex w-full max-w-xl flex-col gap-3">
                {missingRequiredSet.map((momentKey) => {
                  const info = GAP_LABELS[momentKey] ?? { label: momentKey, moment: 0 };
                  return (
                    <div
                      key={momentKey}
                      data-testid={`gap-callout-${momentKey}`}
                      className="flex flex-col gap-2 rounded-xl border border-amber-warm/50 bg-amber/5 px-4 py-3 text-left"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-sans text-sm font-medium text-amber-warm">
                          Still missing · {info.label}
                        </span>
                        {info.moment > 0 && (
                          <button
                            type="button"
                            onClick={() => onJumpToMoment(momentKey)}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-warm/40 px-3 py-1 font-sans text-[11px] text-amber-warm transition-colors hover:bg-amber-warm/10"
                          >
                            Back to Moment {info.moment}
                          </button>
                        )}
                      </div>
                      <p className="font-sans text-[12px] italic text-fg-muted">
                        Lumi needs this to build a safe, personalized plan.
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            <OnboardingChips
              chipConfig={chipConfig}
              selections={chipSelections}
              pending={pending}
              onToggle={onToggleChip}
              onSkip={onSkip}
            />
          </div>
        )}

        {pending && (
          <div className="flex items-center justify-center gap-1.5" aria-label="Lumi is thinking">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-2 w-2 animate-bounce rounded-full bg-fg-muted motion-reduce:animate-none"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
        )}
      </div>

      {error !== null && (
        <p className="shrink-0 px-6 py-2 font-sans text-sm text-red-400 md:px-8" role="alert">
          {error}
        </p>
      )}

      {currentMomentKey === 'summary' && (
        <div className="shrink-0 px-6 pb-1 pt-3 md:px-8">
          <div className="mx-auto flex max-w-2xl flex-col gap-2">
            <div
              data-testid="finalize-gate"
              className="flex items-center gap-3 rounded-2xl border border-border/30 bg-surface/50 px-4 py-3 shadow-lg backdrop-blur-md"
            >
              <p
                className={[
                  'flex-1 font-sans text-[13px] italic',
                  requiredSetComplete === true ? 'text-foliage' : 'text-amber-warm',
                ].join(' ')}
              >
                {missingRequiredSet.length > 0
                  ? 'A few things still need to be answered above.'
                  : requiredSetComplete === true
                    ? 'Ready when you are.'
                    : 'Reply above to pick up where you left off.'}
              </p>
              <button
                type="button"
                data-testid="finalize-button"
                onClick={onFinalize}
                disabled={finalizing || requiredSetComplete !== true}
                className={[
                  'inline-flex items-center gap-2 rounded-full px-5 py-2.5 font-sans text-sm font-medium transition-all',
                  finalizing || requiredSetComplete !== true
                    ? 'cursor-not-allowed bg-amber/20 text-amber-warm/60'
                    : 'bg-amber text-bg shadow-md hover:bg-amber-warm active:scale-[0.98]',
                ].join(' ')}
              >
                {finalizing ? 'Finalizing…' : 'Finalize'}
              </button>
            </div>
            <p className="text-center font-sans text-xs italic text-fg-muted">
              {missingRequiredSet.length > 0
                ? 'Complete the moments above to seal your kitchen.'
                : 'Finalize seals your kitchen and starts your first plan.'}
            </p>
          </div>
        </div>
      )}

      {/* Legacy completion CTA — pre-chaptered flow only (no moment_key). In the
          chaptered flow the summary finalize gate owns this. */}
      {isComplete && currentMomentKey === null && (
        <div className="flex shrink-0 flex-col items-center gap-2 px-6 pb-6 pt-2 md:px-8">
          <button
            type="button"
            onClick={onFinalize}
            disabled={finalizing}
            className="rounded-full bg-amber px-8 py-3 font-sans text-base text-bg transition-colors hover:bg-amber-warm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {finalizing ? 'Finishing…' : 'Finish onboarding'}
          </button>
          <p className="font-sans text-xs text-fg-muted">Lumi has everything needed.</p>
        </div>
      )}

      <form onSubmit={onSubmit} className="shrink-0 px-6 pb-10 pt-4 md:px-8">
        <label htmlFor="onboarding-message" className="sr-only">
          Your message to Lumi
        </label>
        <div className="flex items-center gap-2 rounded-2xl border border-border/20 bg-surface/50 px-2 py-1.5 shadow-lg backdrop-blur-md transition-colors focus-within:border-amber/50">
          <textarea
            id="onboarding-message"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={1}
            maxLength={4000}
            placeholder={inputPlaceholder(currentMomentKey, coldStartMode, chipConfig)}
            disabled={pending || isComplete}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSubmit(e as unknown as React.FormEvent);
              }
            }}
            className="flex-1 resize-none bg-transparent px-4 py-2 font-sans text-[17px] text-fg placeholder:text-fg-muted/40 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={
              pending || isComplete || (draft.trim().length === 0 && chipSelections.length === 0)
            }
            aria-label="Send"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber text-bg shadow-md transition-colors hover:bg-amber-warm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-bg border-t-transparent motion-reduce:animate-none" />
            ) : (
              <SendGlyph />
            )}
          </button>
        </div>
        <StatusLine
          currentMomentKey={currentMomentKey}
          coldStartMode={coldStartMode}
          coldStartDishCount={coldStartDishCount}
          chipSelections={chipSelections}
          draft={draft}
          onOverrideFewer={onOverrideFewer}
        />
      </form>
    </section>
  );
}


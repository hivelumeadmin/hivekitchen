import type { KitchenMap } from '@hivekitchen/types';
import { buildRecognitionProse } from './recognition-prose.js';

// Moment labels for the calm jump-back affordance (13-s6 — M3 joined the
// required set, so it can be the unanswered moment routed back to).
const GAP_LABELS: Record<string, { label: string; moment: number }> = {
  m1_table: { label: "Who's at the table", moment: 1 },
  m2_safe: { label: 'What I need to keep safe', moment: 2 },
  m3_taste: { label: 'How your family likes to eat', moment: 3 },
  m5_starting_line: { label: 'A starting line for Lumi', moment: 5 },
};

interface RecognitionEndingProps {
  kitchenMap: KitchenMap | null;
  requiredSetComplete: boolean | null;
  missingRequiredSet: string[];
  finalizing: boolean;
  onFinalize: () => void;
  onJumpToMoment: (key: string) => void;
}

// Epic 13-s6 (AC5/AC6) — the recognition ending REPLACES the finalize gate. Lumi
// plays back the kitchen she now understands (prose from the KitchenMap
// projection), rests in a quiet honey glow, and hands the parent to their first
// week. Finalize stays never-auto: the CTA is a deliberate tap wired to the
// unchanged onFinalize / requiredSetComplete logic.
export function RecognitionEnding({
  kitchenMap,
  requiredSetComplete,
  missingRequiredSet,
  finalizing,
  onFinalize,
  onJumpToMoment,
}: RecognitionEndingProps) {
  const segments = buildRecognitionProse(kitchenMap);
  const ready = requiredSetComplete === true;

  return (
    <div className="shrink-0 px-6 pb-8 pt-4 md:px-8">
      <div
        data-testid="recognition-ending"
        className="mx-auto flex max-w-xl flex-col items-center gap-5 rounded-3xl border border-honey-amber-200/40 bg-surface px-6 py-7 text-center animate-[hk-glow_1.4s_ease-out_forwards] motion-reduce:animate-none"
      >
        <h2 className="font-serif text-xl leading-snug text-fg md:text-2xl">
          {ready ? "Here's the kitchen I've come to know" : "Here's the kitchen so far"}
        </h2>

        {segments.length > 0 && (
          <div className="flex flex-col gap-2">
            {segments.map((seg) => (
              <p key={seg.key} className="font-sans text-[15px] leading-relaxed text-fg-muted">
                {seg.text}
              </p>
            ))}
          </div>
        )}

        {ready ? (
          <button
            type="button"
            data-testid="show-first-week-button"
            onClick={onFinalize}
            disabled={finalizing}
            className="inline-flex items-center gap-2 rounded-full bg-amber px-6 py-3 font-sans text-base font-medium text-bg shadow-md transition-all hover:bg-amber-warm active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {finalizing ? 'Opening your week…' : 'Show me my first week'}
          </button>
        ) : missingRequiredSet.length > 0 ? (
          <div className="flex w-full flex-col items-center gap-3">
            <p className="font-sans text-sm italic text-fg-muted">
              One more thing before your first week.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {missingRequiredSet.map((momentKey) => {
                const info = GAP_LABELS[momentKey] ?? { label: momentKey, moment: 0 };
                return (
                  <button
                    key={momentKey}
                    type="button"
                    data-testid={`gap-jump-${momentKey}`}
                    onClick={() => onJumpToMoment(momentKey)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-honey-amber-300/50 px-4 py-2 font-sans text-sm text-amber transition-colors hover:bg-honey-amber-50/40"
                  >
                    {info.moment > 0 ? `Back to Moment ${info.moment} · ${info.label}` : info.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="font-sans text-sm italic text-fg-muted">
            Reply above to pick up where you left off.
          </p>
        )}
      </div>
    </div>
  );
}

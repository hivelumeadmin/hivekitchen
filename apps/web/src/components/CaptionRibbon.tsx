interface CaptionRibbonProps {
  userTranscript: string;
  lumiCaption: string;
}

// Story 5-S5 — synchronized voice captions. A calm, secondary aid (warm-neutral
// surface, no chrome) shown while Lumi speaks. The aria-live region announces
// turns to screen readers; aria-atomic="false" lets each paragraph announce
// separately (correct for turn-based captions). No animation — static display
// satisfies the reduced-motion path (AC#8).
export function CaptionRibbon({ userTranscript, lumiCaption }: CaptionRibbonProps) {
  if (!userTranscript && !lumiCaption) return null;

  return (
    <div
      role="region"
      aria-label="Voice captions"
      aria-live="polite"
      aria-atomic="false"
      className="rounded-lg bg-surface-2 px-4 py-3 text-sm font-sans space-y-1.5 motion-reduce:transition-none"
    >
      {userTranscript && (
        <p className="text-fg-muted">
          <span className="font-medium text-fg">You: </span>
          {userTranscript}
        </p>
      )}
      {lumiCaption && (
        <p className="text-fg">
          <span className="font-medium text-honey-amber-600">Lumi: </span>
          {lumiCaption}
        </p>
      )}
    </div>
  );
}

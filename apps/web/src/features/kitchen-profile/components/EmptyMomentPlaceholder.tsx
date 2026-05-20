interface Readonly_EmptyMomentPlaceholderProps {
  readonly label: string;
  readonly note?: string;
  readonly ctaLabel?: string;
  readonly onCta?: () => void;
}

export type EmptyMomentPlaceholderProps = Readonly<Readonly_EmptyMomentPlaceholderProps>;

/**
 * Renders a soft amber-bordered card for a moment that the parent skipped or
 * never reached. The "Tell Lumi anytime" CTA is the standard affordance per
 * the 2026-05-19 sprint change proposal — visible memory should always offer
 * a way to fill the gap without re-running the onboarding flow.
 */
export function EmptyMomentPlaceholder({
  label,
  note,
  ctaLabel = 'Tell Lumi anytime',
  onCta,
}: EmptyMomentPlaceholderProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-warm/30 bg-amber/5 px-4 py-3">
      <span className="font-sans text-[12px] font-medium text-amber-warm">
        {label}
      </span>
      {note && (
        <p className="font-sans text-[12px] italic text-fg-muted">{note}</p>
      )}
      <button
        type="button"
        onClick={onCta}
        className="self-start font-sans text-[12px] text-amber-warm underline transition-colors hover:text-amber"
      >
        {ctaLabel}
      </button>
    </div>
  );
}

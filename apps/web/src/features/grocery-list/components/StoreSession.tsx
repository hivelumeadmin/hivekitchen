interface Readonly_StoreSessionProps {
  readonly title: string;
  readonly progressLabel: string;
  readonly progressText: string;
  readonly progressPercent: number;
  readonly primaryAction: string;
  readonly proTipLabel: string;
  readonly proTipBody: string;
  readonly onSelectStore?: () => void;
}

export type StoreSessionProps = Readonly<Readonly_StoreSessionProps>;

export function StoreSession({
  title,
  progressLabel,
  progressText,
  progressPercent,
  primaryAction,
  proTipLabel,
  proTipBody,
  onSelectStore,
}: StoreSessionProps) {
  return (
    <div className="sticky top-24 rounded border border-border bg-surface p-8">
      <h4 className="mb-6 font-serif text-2xl text-fg">{title}</h4>
      <div className="mb-8 space-y-6">
        <div className="flex items-center justify-between text-sm">
          <span className="text-fg-muted">{progressLabel}</span>
          <span className="font-bold text-fg">{progressText}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full bg-amber-warm"
            style={{ width: `${progressPercent}%` }}
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
        <div className="space-y-4 border-t border-border pt-6">
          <button
            type="button"
            onClick={onSelectStore}
            className="w-full rounded border border-safety-cleared py-4 font-bold text-safety-cleared transition-all hover:bg-safety-cleared hover:text-bg"
          >
            {primaryAction}
          </button>
        </div>
      </div>
      <div className="rounded border border-dashed border-border bg-surface-2 p-4">
        <p className="mb-2 text-xs italic text-lumi-terracotta">{proTipLabel}</p>
        <p className="text-xs leading-relaxed text-fg">{proTipBody}</p>
      </div>
    </div>
  );
}

interface Readonly_InspirationActionsProps {
  readonly loadMoreLabel: string;
  readonly notTheseLabel: string;
  readonly talkToLumiLabel: string;
  readonly onLoadMore?: () => void;
  readonly onTalkToLumi?: () => void;
}

export type InspirationActionsProps = Readonly<Readonly_InspirationActionsProps>;

export function InspirationActions({
  loadMoreLabel,
  notTheseLabel,
  talkToLumiLabel,
  onLoadMore,
  onTalkToLumi,
}: InspirationActionsProps) {
  return (
    <div className="mt-16 flex flex-wrap items-center justify-center gap-4">
      <button
        type="button"
        onClick={onLoadMore}
        className="rounded-xl border-2 border-lumi-terracotta px-8 py-4 text-[11px] font-medium uppercase tracking-widest text-fg transition-all hover:border-lumi-terracotta-warmed hover:bg-[color-mix(in_srgb,var(--lumi-terracotta-warmed)_10%,transparent)] active:scale-95"
      >
        {loadMoreLabel}
      </button>
      <button
        type="button"
        onClick={onTalkToLumi}
        className="group flex items-center gap-2 px-8 py-4 text-[11px] font-medium uppercase tracking-widest text-fg-muted transition-all hover:text-amber-warm"
      >
        {notTheseLabel}
        <span className="underline decoration-border underline-offset-4 group-hover:decoration-amber-warm">
          {talkToLumiLabel}
        </span>
      </button>
    </div>
  );
}

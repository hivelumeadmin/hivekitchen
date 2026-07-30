interface Readonly_MainGroupBadgeProps {
  readonly groupId: string;
  readonly note?: string;
}

export type MainGroupBadgeProps = Readonly<Readonly_MainGroupBadgeProps>;

export function MainGroupBadge({ groupId, note }: MainGroupBadgeProps) {
  return (
    <p className="inline-flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted">
      {/* Recognition channel (the Main group is a "you already know this one"
          signal), rendered with the theme-flipped honey scale — the previous
          bg-amber-warm/15 alpha modifier compiled to no background at all. */}
      <span className="inline-flex items-center rounded-full bg-honey-amber-100 px-2 py-0.5 font-medium text-honey-amber-800">
        {groupId}
      </span>
      {note !== undefined ? <span>· {note}</span> : null}
    </p>
  );
}

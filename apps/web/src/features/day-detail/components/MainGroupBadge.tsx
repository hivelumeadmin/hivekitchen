interface Readonly_MainGroupBadgeProps {
  readonly groupId: string;
  readonly note?: string;
}

export type MainGroupBadgeProps = Readonly<Readonly_MainGroupBadgeProps>;

export function MainGroupBadge({ groupId, note }: MainGroupBadgeProps) {
  return (
    <p className="inline-flex flex-wrap items-center gap-1.5 text-[11px] text-fg-muted">
      <span className="inline-flex items-center rounded-full bg-amber-warm/15 px-2 py-0.5 font-medium text-amber-warm">
        {groupId}
      </span>
      {note !== undefined ? <span>· {note}</span> : null}
    </p>
  );
}

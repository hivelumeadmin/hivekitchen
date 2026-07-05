interface Readonly_UserTurnProps {
  readonly time: string;
  readonly text: string;
}

export type UserTurnProps = Readonly<Readonly_UserTurnProps>;

export function UserTurn({ time, text }: UserTurnProps) {
  return (
    <div className="flex flex-col gap-2 border-l-2 border-border ps-6">
      <span className="text-[11px] font-medium uppercase tracking-widest text-fg-muted">
        {time}
      </span>
      <p className="text-[15px] leading-relaxed text-fg">{text}</p>
    </div>
  );
}

interface Readonly_OrDividerProps {
  readonly label: string;
}

export type OrDividerProps = Readonly<Readonly_OrDividerProps>;

export function OrDivider({ label }: OrDividerProps) {
  return (
    <div className="flex items-center gap-4">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-medium uppercase tracking-widest text-fg-muted">
        {label}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

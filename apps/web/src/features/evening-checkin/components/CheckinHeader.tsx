interface Readonly_CheckinHeaderProps {
  readonly title: string;
  readonly subtitle: string;
}

export type CheckinHeaderProps = Readonly<Readonly_CheckinHeaderProps>;

export function CheckinHeader({ title, subtitle }: CheckinHeaderProps) {
  return (
    <div className="mb-20">
      <h2 className="mb-2 font-serif text-[34px] leading-snug text-fg">{title}</h2>
      <p className="text-xs uppercase tracking-widest text-fg-muted">{subtitle}</p>
    </div>
  );
}

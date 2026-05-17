interface Readonly_InspirationHeaderProps {
  readonly title: string;
  readonly description: string;
  readonly statusLabel: string;
}

export type InspirationHeaderProps = Readonly<Readonly_InspirationHeaderProps>;

export function InspirationHeader({
  title,
  description,
  statusLabel,
}: InspirationHeaderProps) {
  return (
    <section className="mb-12">
      <h1 className="mb-2 font-serif text-[34px] leading-snug text-fg">{title}</h1>
      <p className="max-w-2xl text-fg-muted">{description}</p>
      <div className="mt-4 flex w-fit items-center gap-3 rounded-lg border border-safety-cleared/20 bg-safety-cleared/10 px-4 py-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-safety-cleared opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-safety-cleared" />
        </span>
        <span className="text-xs font-medium uppercase tracking-wider text-safety-cleared">
          {statusLabel}
        </span>
      </div>
    </section>
  );
}

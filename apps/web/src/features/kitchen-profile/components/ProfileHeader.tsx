interface Readonly_ProfileHeaderProps {
  readonly eyebrow: string;
  readonly headline: string;
  readonly description: string;
}

export type ProfileHeaderProps = Readonly<Readonly_ProfileHeaderProps>;

export function ProfileHeader({ eyebrow, headline, description }: ProfileHeaderProps) {
  return (
    <section className="mb-20 text-center">
      <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-amber-warm">
        {eyebrow}
      </p>
      <h1 className="mb-6 font-serif text-4xl leading-tight text-fg md:text-[56px]">
        {headline}
      </h1>
      <p className="mx-auto max-w-2xl text-lg leading-relaxed text-fg-muted">
        {description}
      </p>
    </section>
  );
}

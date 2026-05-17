interface Readonly_OnboardingHeroProps {
  readonly eyebrow: string;
  readonly headline: string;
  readonly subhead: string;
  readonly imageSrc: string;
  readonly imageAlt: string;
}

export type OnboardingHeroProps = Readonly<Readonly_OnboardingHeroProps>;

export function OnboardingHero({
  eyebrow,
  headline,
  subhead,
  imageSrc,
  imageAlt,
}: OnboardingHeroProps) {
  return (
    <section className="relative h-[35vh] min-h-[260px] w-full max-h-[400px] overflow-hidden">
      <img
        src={imageSrc}
        alt={imageAlt}
        className="absolute inset-0 h-full w-full object-cover object-[center_20%] brightness-[0.85] grayscale-[0.1]"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/70 to-transparent" />
      <div className="relative z-10 flex h-full items-center px-8 md:px-16 lg:px-24">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-amber-warm">
            {eyebrow}
          </p>
          <h1 className="font-serif text-4xl leading-tight tracking-tight text-fg md:text-5xl">
            {headline}
          </h1>
          <p className="max-w-xl font-serif text-2xl font-light italic leading-snug text-fg-muted md:text-[28px]">
            {subhead}
          </p>
        </div>
      </div>
    </section>
  );
}

import { SyncIcon } from '../../../components/icons.js';

interface Readonly_GroceryHeroProps {
  readonly eyebrow: string;
  readonly headline: string;
  readonly description: string;
  readonly imageSrc: string;
  readonly imageAlt: string;
}

export type GroceryHeroProps = Readonly<Readonly_GroceryHeroProps>;

export function GroceryHero({
  eyebrow,
  headline,
  description,
  imageSrc,
  imageAlt,
}: GroceryHeroProps) {
  return (
    <div className="mb-12 grid grid-cols-1 items-center gap-6 md:grid-cols-12">
      <div className="md:col-span-7">
        <div className="mb-4 flex items-center gap-2">
          <SyncIcon className="h-4 w-4 text-amber-warm" />
          <span className="text-xs uppercase tracking-widest text-fg-muted">{eyebrow}</span>
        </div>
        <h2 className="mb-4 font-serif text-[34px] leading-snug text-fg">{headline}</h2>
        <p className="max-w-xl text-[15px] leading-relaxed text-fg-muted">{description}</p>
      </div>
      <div className="overflow-hidden rounded border border-border md:col-span-5">
        <img
          src={imageSrc}
          alt={imageAlt}
          className="h-48 w-full object-cover md:h-64"
        />
      </div>
    </div>
  );
}

interface Readonly_LunchImageProps {
  readonly servingNote: string;
  readonly imageSrc?: string;
  readonly imageAlt?: string;
}

export type LunchImageProps = Readonly<Readonly_LunchImageProps>;

export function LunchImage({
  servingNote,
  imageSrc = '/images/day-detail-hero.jpg',
  imageAlt = 'Cumin chicken pita with carrot ribbons',
}: LunchImageProps) {
  return (
    <div className="space-y-4">
      <div className="aspect-[4/3] overflow-hidden rounded-lg border border-[color-mix(in_srgb,var(--border)_20%,transparent)] bg-surface-2">
        <img src={imageSrc} alt={imageAlt} className="h-full w-full object-cover" />
      </div>
      <p className="pe-2 text-right text-xs italic text-fg-muted">{servingNote}</p>
    </div>
  );
}

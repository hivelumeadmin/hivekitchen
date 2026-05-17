import { RailCard } from '../../../components/RailCard.js';
import type { Allergen } from '../data/mockData.js';

interface Readonly_AllergenScanCardProps {
  readonly allergens: readonly Allergen[];
}

export type AllergenScanCardProps = Readonly<Readonly_AllergenScanCardProps>;

export function AllergenScanCard({ allergens }: AllergenScanCardProps) {
  return (
    <RailCard eyebrow="Allergens checked">
      <div className="flex flex-wrap gap-2">
        {allergens.map((a) => (
          <AllergenChip key={a.label} allergen={a} />
        ))}
      </div>
    </RailCard>
  );
}

function AllergenChip({ allergen }: Readonly<{ readonly allergen: Allergen }>) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border/20 bg-surface-2 px-3 py-1.5 text-xs text-fg">
      {allergen.flagged ? (
        <span className="h-1.5 w-1.5 rounded-full bg-safety-red" aria-hidden />
      ) : null}
      {allergen.label}
    </span>
  );
}

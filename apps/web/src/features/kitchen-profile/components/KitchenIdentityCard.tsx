import {
  EditIcon,
  GlobeIcon,
  ShieldIcon,
  UtensilsIcon,
} from '../../../components/icons.js';
import { kitchenProfileMock } from '../data/mockData.js';

type PillarIcon = 'globe' | 'shield' | 'utensils';

interface Readonly_KitchenIdentityCardProps {
  readonly quote: string;
  readonly pillars: typeof kitchenProfileMock.identity.pillars;
  readonly refineLabel: string;
  readonly onRefine?: () => void;
}

export type KitchenIdentityCardProps = Readonly<Readonly_KitchenIdentityCardProps>;

export function KitchenIdentityCard({
  quote,
  pillars,
  refineLabel,
  onRefine,
}: KitchenIdentityCardProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/20 bg-surface p-8 md:p-12">
      <blockquote className="mb-10 font-serif text-2xl italic leading-relaxed text-sacred md:text-3xl">
        {quote}
      </blockquote>
      <div className="mb-8 grid grid-cols-1 gap-8 md:grid-cols-3">
        {pillars.map((p) => (
          <Pillar key={p.title} pillar={p} />
        ))}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onRefine}
          className="flex items-center gap-1 text-sm font-medium text-amber-warm hover:underline"
        >
          {refineLabel}
          <EditIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function Pillar({ pillar }: Readonly<{ readonly pillar: (typeof kitchenProfileMock.identity.pillars)[number] }>) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-amber-warm">
        <PillarIconGlyph kind={pillar.icon as PillarIcon} />
        <h3 className="text-sm font-bold uppercase tracking-wider">{pillar.title}</h3>
      </div>
      {'items' in pillar ? (
        <ul className="list-inside list-disc text-sm leading-relaxed text-fg-muted">
          {pillar.items.map((it) => (
            <li key={it}>{it}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-relaxed text-fg-muted">{pillar.body}</p>
      )}
    </div>
  );
}

function PillarIconGlyph({ kind }: Readonly<{ readonly kind: PillarIcon }>) {
  const className = 'h-5 w-5';
  if (kind === 'globe') return <GlobeIcon className={className} />;
  if (kind === 'shield') return <ShieldIcon className={className} />;
  return <UtensilsIcon className={className} />;
}

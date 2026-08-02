import type {
  ChildDotColor,
  ChildPerson,
  OptionalExtra,
  OptionalExtraKind,
} from '../day-view-model.js';

const dotClass: Record<ChildDotColor, string> = {
  foliage: 'bg-foliage',
  'lumi-terracotta': 'bg-lumi-terracotta',
  sacred: 'bg-sacred',
};

const kindLabel: Record<OptionalExtraKind, string> = {
  drink: 'Drink',
  extra_snack: 'Extra snack',
  protein_boost: 'Protein boost',
  sports_add: 'Sports-day add',
  sweet: 'Sweet treat',
  toddler_safe: 'Toddler-safe',
  allergy_substitute: 'Allergy substitute',
  custom: 'Optional extra',
};

interface Readonly_OptionalExtraBlockProps {
  readonly extra: OptionalExtra;
  readonly kids: readonly ChildPerson[];
}

export type OptionalExtraBlockProps = Readonly<Readonly_OptionalExtraBlockProps>;

export function OptionalExtraBlock({ extra, kids }: OptionalExtraBlockProps) {
  const includedKids = kids.filter(
    (k) => extra.perChildAssignment[k.id] === 'included',
  );
  return (
    <section className="space-y-3 border-t border-border pt-6">
      <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-fg-muted">
        Optional extra · {kindLabel[extra.kind]}
      </p>
      <p className="font-serif text-lg italic text-fg">{extra.title}</p>
      <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-fg-muted">
        <span className="text-[10px] uppercase tracking-wider">For</span>
        {includedKids.length === 0 ? (
          <span className="italic">No one this day</span>
        ) : (
          includedKids.map((k) => (
            <span
              key={k.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${dotClass[k.color]}`}
                aria-hidden
              />
              {k.name}
            </span>
          ))
        )}
      </div>
    </section>
  );
}

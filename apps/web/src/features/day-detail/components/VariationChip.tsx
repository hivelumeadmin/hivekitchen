import { useState } from 'react';
import type {
  ChildDotColor,
  ChildPerson,
  ChildVariation,
} from '../data/multiChildMockData.js';

const dotClass: Record<ChildDotColor, string> = {
  foliage: 'bg-foliage',
  'lumi-terracotta': 'bg-lumi-terracotta',
  sacred: 'bg-sacred',
};

interface Readonly_VariationChipProps {
  readonly kid: ChildPerson;
  readonly variation: ChildVariation;
}

export type VariationChipProps = Readonly<Readonly_VariationChipProps>;

function formatChipSummary(v: ChildVariation): string {
  const parts: string[] = [v.portionSize];
  if (v.texture !== 'normal') parts.push(v.texture);
  if (v.spiceLevel !== 'regular') parts.push(v.spiceLevel);
  if (v.addOns.length > 0) {
    const first = v.addOns[0]!;
    const more = v.addOns.length - 1;
    parts.push(more > 0 ? `+ ${first} (+${String(more)})` : `+ ${first}`);
  }
  return parts.join(' · ');
}

export function VariationChip({ kid, variation }: VariationChipProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={() => {
          setExpanded((v) => !v);
        }}
        aria-expanded={expanded}
        className="flex items-center gap-2 rounded-full border border-border/30 bg-surface px-3 py-1.5 text-xs text-fg transition-colors hover:border-amber-warm/40"
      >
        <span
          className={`h-2 w-2 rounded-full ${dotClass[kid.color]}`}
          aria-hidden
        />
        <span className="font-medium">{kid.name}</span>
        <span className="text-fg-muted">·</span>
        <span className="text-fg-muted">{formatChipSummary(variation)}</span>
        <span className="ml-1 text-fg-muted/60">{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded ? (
        <VariationExpandedCard kid={kid} variation={variation} />
      ) : null}
    </div>
  );
}

interface VariationExpandedCardProps {
  readonly kid: ChildPerson;
  readonly variation: ChildVariation;
}

function VariationExpandedCard({ kid, variation }: VariationExpandedCardProps) {
  const rows: ReadonlyArray<{ label: string; value: string }> = [
    { label: 'Portion', value: variation.portionSize },
    { label: 'Texture', value: variation.texture },
    { label: 'Spice', value: variation.spiceLevel },
    ...(variation.cuttingStyle !== undefined
      ? [{ label: 'Cut', value: variation.cuttingStyle }]
      : []),
    ...(variation.container !== undefined
      ? [{ label: 'Container', value: variation.container }]
      : []),
  ];

  return (
    <div className="mt-2 w-72 rounded-lg border border-border/30 bg-surface/60 p-3 text-xs text-fg-muted">
      <p className="mb-2 font-medium text-fg">{kid.name}&rsquo;s variation</p>
      <dl className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-3">
            <dt className="text-fg-muted/70">{r.label}</dt>
            <dd className="capitalize text-fg/90">{r.value}</dd>
          </div>
        ))}
        {variation.addOns.length > 0 ? (
          <div className="pt-1">
            <dt className="text-fg-muted/70">Add-ons</dt>
            <dd className="text-fg/90">{variation.addOns.join(', ')}</dd>
          </div>
        ) : null}
        {variation.removals.length > 0 ? (
          <div className="pt-1">
            <dt className="text-fg-muted/70">Remove</dt>
            <dd className="text-fg/90">{variation.removals.join(', ')}</dd>
          </div>
        ) : null}
      </dl>
      {variation.notes !== undefined ? (
        <p className="mt-2 italic text-fg-muted">{variation.notes}</p>
      ) : null}
    </div>
  );
}

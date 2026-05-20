import { EditIcon, GlobeIcon, UtensilsIcon } from '../../../components/icons.js';
import type { EnforcedChip } from '../data/mockData.js';
import {
  IdentityEditConversation,
  type IdentityEditValue,
} from './IdentityEditConversation.js';

interface Readonly_KitchenIdentityCardProps {
  readonly quote: string;
  readonly cultural: readonly EnforcedChip[];
  readonly sharedTastes: string;
  readonly refineLabel: string;
  /** Suggested additions surfaced in edit mode. */
  readonly suggestedAdditions?: readonly EnforcedChip[];
  /** Read mode vs edit mode. Read mode shows the refine CTA; edit mode swaps
   * the body for the inline IdentityEditConversation. */
  readonly isEditing?: boolean;
  readonly onRefine?: () => void;
  /**
   * Fired on each Send during the edit conversation. The parent applies
   * `nextValue` to its identity state and persists the composite (in
   * production, by posting to the Lumi conversation thread API).
   */
  readonly onSendComposite?: (composite: string, nextValue: IdentityEditValue) => void;
  /** Close the edit panel (user clicked "I'm done with my edit"). */
  readonly onDone?: () => void;
}

export type KitchenIdentityCardProps = Readonly<Readonly_KitchenIdentityCardProps>;

export function KitchenIdentityCard({
  quote,
  cultural,
  sharedTastes,
  refineLabel,
  suggestedAdditions = [],
  isEditing = false,
  onRefine,
  onSendComposite,
  onDone,
}: KitchenIdentityCardProps) {
  if (isEditing) {
    return (
      <IdentityEditConversation
        initial={{ cultural, sharedTastes }}
        suggestedAdditions={suggestedAdditions}
        onSendComposite={(composite, next) =>
          onSendComposite?.(composite, next)
        }
        onDone={() => onDone?.()}
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-border/20 bg-surface p-8 md:p-12">
      <blockquote className="mb-10 font-serif text-2xl italic leading-relaxed text-sacred md:text-3xl">
        {quote}
      </blockquote>
      <div className="mb-8 grid grid-cols-1 gap-8 md:grid-cols-2">
        <CulturalPillar items={cultural} />
        <SharedTastesPillar body={sharedTastes} />
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

function CulturalPillar({ items }: Readonly<{ readonly items: readonly EnforcedChip[] }>) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-amber-warm">
        <GlobeIcon className="h-5 w-5" />
        <h3 className="text-sm font-bold uppercase tracking-wider">
          Cultural &amp; religious
        </h3>
      </div>
      {items.length === 0 ? (
        <p className="text-sm italic text-fg-muted/70">Nothing locked in yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((c) => (
            <EnforcementChip key={c.key} chip={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function SharedTastesPillar({ body }: Readonly<{ readonly body: string }>) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-amber-warm">
        <UtensilsIcon className="h-5 w-5" />
        <h3 className="text-sm font-bold uppercase tracking-wider">Shared tastes</h3>
      </div>
      <p className="text-sm leading-relaxed text-fg-muted">{body}</p>
    </div>
  );
}

/**
 * Mirrors the chip treatment used in Moment 6's Kitchen Profile panel.
 *
 *  always  → foliage-bordered, "· rule" tail. Hard rule the planner respects.
 *  prefer  → soft foliage fill. Lumi leans this way but isn't bound.
 *  context → muted italic. Background flavor / occasional cuisine.
 */
function EnforcementChip({ chip }: Readonly<{ readonly chip: EnforcedChip }>) {
  if (chip.enforcement === 'always') {
    return (
      <span className="flex items-center gap-1.5 rounded-md border-2 border-foliage bg-foliage-soft px-2.5 py-1 font-sans text-xs font-medium text-fg">
        {chip.label}
        <span className="text-[10px] uppercase tracking-wide text-foliage">· rule</span>
      </span>
    );
  }
  if (chip.enforcement === 'prefer') {
    return (
      <span className="rounded-md border border-foliage/60 bg-foliage-soft/50 px-2.5 py-1 font-sans text-xs text-fg">
        {chip.label}
      </span>
    );
  }
  return (
    <span className="rounded-md bg-warm-neutral-100/60 px-2.5 py-1 font-sans text-xs italic text-fg-muted">
      {chip.label}
    </span>
  );
}

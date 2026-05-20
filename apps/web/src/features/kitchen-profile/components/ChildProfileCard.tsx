import { ShieldIcon } from '../../../components/icons.js';
import type { Allergen, ChildProfile } from '../data/mockData.js';
import {
  ChildEditConversation,
  type ChildEditValue,
} from './ChildEditConversation.js';
import { EmptyMomentPlaceholder } from './EmptyMomentPlaceholder.js';

interface Readonly_ChildProfileCardProps {
  readonly child: ChildProfile;
  readonly suggestedAllergens?: readonly Allergen[];
  readonly isEditing?: boolean;
  readonly onEdit?: () => void;
  readonly onSendComposite?: (composite: string, nextValue: ChildEditValue) => void;
  readonly onDone?: () => void;
}

export type ChildProfileCardProps = Readonly<Readonly_ChildProfileCardProps>;

export function ChildProfileCard({
  child,
  suggestedAllergens = [],
  isEditing = false,
  onEdit,
  onSendComposite,
  onDone,
}: ChildProfileCardProps) {
  if (isEditing) {
    return (
      <ChildEditConversation
        child={child}
        suggestedAllergens={suggestedAllergens}
        onSendComposite={(composite, next) => onSendComposite?.(composite, next)}
        onDone={() => onDone?.()}
      />
    );
  }
  return (
    <div className="relative overflow-hidden rounded-lg border border-border/20 bg-surface p-8">
      <div className="absolute bottom-0 left-0 top-0 w-1 bg-amber-warm/20" />
      <div className="flex flex-col gap-8 md:flex-row">
        <ChildAvatar initial={child.initial} />
        <div className="flex-1 min-w-0">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-serif text-3xl text-fg">
                {child.name}, {child.age}
              </h3>
              <span className="mt-2 inline-block rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-safety-cleared">
                {child.schoolBadge}
              </span>
            </div>
            <button
              type="button"
              onClick={onEdit}
              className="flex-shrink-0 text-sm font-medium text-amber-warm hover:underline"
            >
              Edit
            </button>
          </div>
          <div className="mb-4 flex flex-wrap gap-x-4 text-[11px] font-bold uppercase tracking-wider text-fg-muted/60">
            {child.meta.map((label, i) => (
              <span key={i} className="flex items-center gap-4">
                {i > 0 ? <span aria-hidden>•</span> : null}
                <span>{label}</span>
              </span>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-2">
            <SafetyAndBagColumn
              allergens={child.allergens}
              bagComposition={child.bagComposition}
              childName={child.name}
            />
            <LumiLearningColumn
              loves={child.loves}
              avoids={child.avoids}
              quote={child.lumiQuote}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChildAvatar({ initial }: Readonly<{ readonly initial: string }>) {
  return (
    <div className="flex-shrink-0">
      <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-border/20 bg-surface-2">
        <span className="font-serif text-4xl font-medium text-amber-warm">{initial}</span>
      </div>
    </div>
  );
}

function SafetyAndBagColumn({
  allergens,
  bagComposition,
  childName,
}: Readonly<{
  readonly allergens: readonly Allergen[];
  readonly bagComposition: string | null;
  readonly childName: string;
}>) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mb-3 text-xs font-bold uppercase tracking-wider text-safety-cleared">
          Allergens
        </p>
        {allergens.length === 0 ? (
          <p className="text-[13px] italic text-fg-muted">No known allergens.</p>
        ) : (
          <div className="space-y-2">
            {allergens.map((a) => (
              <AllergenRow key={a.name} allergen={a} />
            ))}
          </div>
        )}
      </div>
      <div>
        <p className="mb-3 text-xs font-bold uppercase tracking-wider text-amber-warm/80">
          Lunch bag
        </p>
        {bagComposition ? (
          <span className="inline-block rounded-md border border-foliage/60 bg-foliage-soft px-3 py-1.5 font-sans text-sm text-fg">
            {bagComposition}
          </span>
        ) : (
          <EmptyMomentPlaceholder
            label="Bag composition not set"
            note={`We never landed on the shape of ${childName}'s lunch bag.`}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Uniform allergen rendering — no severity tiers, no red alarm color.
 * Medical allergens get a small "medical" tag; non-medical (religious /
 * lifestyle) render the same shield + label without the tag.
 */
function AllergenRow({ allergen }: Readonly<{ readonly allergen: Allergen }>) {
  return (
    <div className="flex items-center gap-2 text-safety-cleared">
      <ShieldIcon className="h-[18px] w-[18px] flex-shrink-0" />
      <span className="text-[15px] font-medium">{allergen.name}</span>
      {allergen.medical && (
        <span className="text-[11px] uppercase tracking-wide text-fg-muted">· medical</span>
      )}
    </div>
  );
}

function LumiLearningColumn({
  loves,
  avoids,
  quote,
}: Readonly<{
  readonly loves: string;
  readonly avoids: string;
  readonly quote?: string;
}>) {
  return (
    <div>
      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-amber-warm">
        Lumi learning
      </p>
      <div className="space-y-3 text-fg-muted">
        <p className="text-sm">
          <span className="text-fg">Loves:</span> {loves}
        </p>
        <p className="text-sm">
          <span className="text-fg">Avoids:</span> {avoids}
        </p>
        {quote ? (
          <div className="mt-2 rounded-lg border border-amber-warm/20 bg-amber-warm/10 p-3">
            <p className="text-xs italic text-lumi-terracotta">{quote}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

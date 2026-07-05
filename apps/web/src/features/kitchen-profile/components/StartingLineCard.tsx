import { EditIcon } from '../../../components/icons.js';
import type { StartingLine } from '../data/mockData.js';
import { EmptyMomentPlaceholder } from './EmptyMomentPlaceholder.js';
import { StartingLineEditConversation } from './StartingLineEditConversation.js';

interface Readonly_StartingLineCardProps {
  readonly description: string;
  readonly line: StartingLine;
  readonly suggestedAdditions?: readonly string[];
  readonly isEditing?: boolean;
  readonly onEdit?: () => void;
  readonly onSendComposite?: (composite: string, nextValue: StartingLine) => void;
  readonly onDone?: () => void;
}

export type StartingLineCardProps = Readonly<Readonly_StartingLineCardProps>;

/**
 * "Lumi's starting line" — the 10 favorite lunches captured during Moment 5.
 * Renders count + chips for what was seeded; falls back to the empty-moment
 * placeholder if onboarding skipped past this with no items.
 */
export function StartingLineCard({
  description,
  line,
  suggestedAdditions = [],
  isEditing = false,
  onEdit,
  onSendComposite,
  onDone,
}: StartingLineCardProps) {
  if (isEditing) {
    return (
      <StartingLineEditConversation
        initial={line}
        suggestedAdditions={suggestedAdditions}
        onSendComposite={(composite, next) => onSendComposite?.(composite, next)}
        onDone={() => onDone?.()}
      />
    );
  }
  if (line.count === 0) {
    return (
      <EmptyMomentPlaceholder
        label="No starting line yet"
        note="Lumi will plan from a blank slate until you seed a few favorites."
      />
    );
  }

  const isComplete = line.count >= line.target;
  return (
    <div className="rounded-2xl border border-border/20 bg-surface p-8">
      <div className="mb-5 flex items-start justify-between gap-4">
        <p className="max-w-2xl text-sm leading-relaxed text-fg-muted">{description}</p>
        <button
          type="button"
          onClick={onEdit}
          className="flex flex-shrink-0 items-center gap-1 text-sm font-medium text-amber-warm hover:underline"
        >
          Edit
          <EditIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-5 flex items-baseline gap-2">
        <span
          className={[
            'font-serif text-3xl',
            isComplete ? 'text-foliage' : 'text-amber',
          ].join(' ')}
        >
          {line.count}
        </span>
        <span className="font-sans text-sm text-fg-muted">
          / {line.target} lunches
        </span>
        {!isComplete && line.count > 0 && (
          <span className="ms-2 font-sans text-[10px] uppercase tracking-wide text-fg-muted">
            · starting with fewer
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {line.items.map((item) => (
          <span
            key={item}
            className="rounded-md bg-warm-neutral-100/60 px-2.5 py-1 font-sans text-xs text-fg"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

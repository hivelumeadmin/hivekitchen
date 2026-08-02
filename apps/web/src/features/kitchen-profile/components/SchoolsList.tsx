import { ChevronRightIcon, EditIcon, PlusIcon } from '@hivekitchen/ui';
import {
  type School,
  SchoolsEditConversation,
} from './SchoolsEditConversation.js';

interface Readonly_SchoolsListProps {
  readonly schools: readonly School[];
  readonly addLabel: string;
  readonly isEditing?: boolean;
  readonly onSelect?: (name: string) => void;
  readonly onAdd?: () => void;
  readonly onEdit?: () => void;
  readonly onSendComposite?: (composite: string, nextValue: readonly School[]) => void;
  readonly onDone?: () => void;
}

export type SchoolsListProps = Readonly<Readonly_SchoolsListProps>;

export function SchoolsList({
  schools,
  addLabel,
  isEditing = false,
  onSelect,
  onAdd,
  onEdit,
  onSendComposite,
  onDone,
}: SchoolsListProps) {
  if (isEditing) {
    return (
      <SchoolsEditConversation
        initial={schools}
        onSendComposite={(composite, next) => onSendComposite?.(composite, next)}
        onDone={() => onDone?.()}
      />
    );
  }
  return (
    <>
      <div className="rounded-lg border border-[color-mix(in_srgb,var(--border)_20%,transparent)] bg-surface">
        {schools.map((school, i) => (
          <button
            key={school.name}
            type="button"
            onClick={() => onSelect?.(school.name)}
            className={`flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-surface-2 ${
              i < schools.length - 1 ? 'border-b border-[color-mix(in_srgb,var(--border)_10%,transparent)]' : ''
            }`}
          >
            <span className="font-serif text-xl text-fg">{school.name}</span>
            <ChevronRightIcon className="h-5 w-5 text-fg-muted" />
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onAdd}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-dashed border-[color-mix(in_srgb,var(--border)_30%,transparent)] py-4 text-fg-muted transition-all hover:border-[color-mix(in_srgb,var(--border)_50%,transparent)] hover:text-fg"
        >
          <PlusIcon className="h-5 w-5" />
          <span className="font-medium">{addLabel}</span>
        </button>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1 px-4 text-sm font-medium text-amber-warm hover:underline"
          >
            Edit
            <EditIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    </>
  );
}

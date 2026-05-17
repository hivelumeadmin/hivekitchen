import { ChevronRightIcon, PlusIcon } from '../../../components/icons.js';

interface Readonly_SchoolsListProps {
  readonly schools: readonly { readonly name: string }[];
  readonly addLabel: string;
  readonly onSelect?: (name: string) => void;
  readonly onAdd?: () => void;
}

export type SchoolsListProps = Readonly<Readonly_SchoolsListProps>;

export function SchoolsList({
  schools,
  addLabel,
  onSelect,
  onAdd,
}: SchoolsListProps) {
  return (
    <>
      <div className="rounded-lg border border-border/20 bg-surface">
        {schools.map((school, i) => (
          <button
            key={school.name}
            type="button"
            onClick={() => onSelect?.(school.name)}
            className={`flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-surface-2 ${
              i < schools.length - 1 ? 'border-b border-border/10' : ''
            }`}
          >
            <span className="font-serif text-xl text-fg">{school.name}</span>
            <ChevronRightIcon className="h-5 w-5 text-fg-muted" />
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border/30 py-4 text-fg-muted transition-all hover:border-border/50 hover:text-fg"
      >
        <PlusIcon className="h-5 w-5" />
        <span className="font-medium">{addLabel}</span>
      </button>
    </>
  );
}

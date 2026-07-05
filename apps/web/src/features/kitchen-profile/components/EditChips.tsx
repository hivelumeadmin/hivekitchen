// ─── Shared chip primitives for edit conversations ────────────────────────
//
// RemovableChip — a "current item" chip that the user can tap × to stage for
// removal. Tap again to undo. Used by Child / Starting line / Schools editors.
//
// AddableChip — a suggestion chip the user can tap to stage adding. Tap again
// to unstage. Used by Child / Starting line editors.
//
// Identity uses its own enforcement-aware chips inline because its visual
// treatment (rule / preference / context) is specific to that section.

interface Readonly_RemovableChipProps {
  readonly label: string;
  readonly stagedForRemoval: boolean;
  readonly badge?: string; // e.g. 'medical'
  readonly onToggle: () => void;
}

export function RemovableChip({
  label,
  stagedForRemoval,
  badge,
  onToggle,
}: Readonly<Readonly_RemovableChipProps>) {
  if (stagedForRemoval) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 rounded-md border border-dashed border-lumi-terracotta/60 bg-lumi-terracotta/5 px-2.5 py-1 font-sans text-xs text-fg-muted line-through transition-colors hover:bg-lumi-terracotta/10"
        aria-label={`Undo dropping ${label}`}
      >
        {label}
        <span className="text-[10px] uppercase tracking-wide text-lumi-terracotta">
          · dropping
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1.5 rounded-md border border-foliage/60 bg-foliage-soft/50 px-2.5 py-1 font-sans text-xs text-fg transition-opacity hover:opacity-80"
      aria-label={`Drop ${label}`}
    >
      {label}
      {badge && (
        <span className="text-[10px] uppercase tracking-wide text-fg-muted">
          · {badge}
        </span>
      )}
      <span className="ms-0.5 text-fg-muted/70" aria-hidden>
        ×
      </span>
    </button>
  );
}

interface Readonly_AddableChipProps {
  readonly label: string;
  readonly staged: boolean;
  readonly onToggle: () => void;
}

export function AddableChip({
  label,
  staged,
  onToggle,
}: Readonly<Readonly_AddableChipProps>) {
  if (staged) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 rounded-md border-2 border-foliage bg-foliage-soft px-2.5 py-1 font-sans text-xs font-medium text-fg transition-opacity hover:opacity-80"
        aria-label={`Don't add ${label}`}
      >
        {label}
        <span className="text-[10px] uppercase tracking-wide text-foliage">· adding</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1.5 rounded-md border border-dashed border-fg-muted/40 px-2.5 py-1 font-sans text-xs text-fg-muted transition-colors hover:border-amber/50 hover:text-fg"
      aria-label={`Add ${label}`}
    >
      <span className="text-amber-warm" aria-hidden>
        +
      </span>
      {label}
    </button>
  );
}

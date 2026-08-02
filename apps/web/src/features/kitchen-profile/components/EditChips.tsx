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
        className="flex items-center gap-1.5 rounded-md border border-dashed border-[color-mix(in_srgb,var(--lumi-terracotta)_60%,transparent)] bg-[color-mix(in_srgb,var(--lumi-terracotta)_5%,transparent)] px-2.5 py-1 font-sans text-xs text-fg-muted line-through transition-colors hover:bg-[color-mix(in_srgb,var(--lumi-terracotta)_10%,transparent)]"
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
      className="flex items-center gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--foliage)_60%,transparent)] bg-foliage-100 px-2.5 py-1 font-sans text-xs text-fg transition-opacity hover:opacity-80"
      aria-label={`Drop ${label}`}
    >
      {label}
      {badge && (
        <span className="text-[10px] uppercase tracking-wide text-fg-muted">
          · {badge}
        </span>
      )}
      <span className="ms-0.5 text-fg-muted" aria-hidden>
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
      className="flex items-center gap-1.5 rounded-md border border-dashed border-[color-mix(in_srgb,var(--fg-muted)_40%,transparent)] px-2.5 py-1 font-sans text-xs text-fg-muted transition-colors hover:border-[color-mix(in_srgb,var(--amber)_50%,transparent)] hover:text-fg"
      aria-label={`Add ${label}`}
    >
      <span className="text-amber-warm" aria-hidden>
        +
      </span>
      {label}
    </button>
  );
}

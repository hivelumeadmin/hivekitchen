interface Readonly_ScheduleDatePickerProps {
  readonly value: string | null;
  readonly disabled?: boolean;
  readonly onChange: (date: string | null) => void;
}

export type ScheduleDatePickerProps = Readonly<Readonly_ScheduleDatePickerProps>;

export function ScheduleDatePicker({
  value,
  disabled = false,
  onChange,
}: ScheduleDatePickerProps) {
  return (
    <div className="flex items-center gap-3 px-1 py-3">
      <label className="text-sm text-fg-muted" htmlFor="heart-note-schedule-date">
        Schedule for
      </label>
      <input
        id="heart-note-schedule-date"
        type="date"
        disabled={disabled}
        value={value ?? ''}
        min={isoToday()}
        onChange={(e) => onChange(e.target.value || null)}
        className="rounded border border-[color-mix(in_srgb,var(--border)_30%,transparent)] bg-surface px-3 py-1.5 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-honey disabled:cursor-not-allowed disabled:opacity-40"
      />
      {value !== null && !disabled ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-xs text-fg-muted underline underline-offset-2 hover:text-fg-muted"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

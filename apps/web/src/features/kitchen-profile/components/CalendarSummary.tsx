import { CalendarIcon } from '../../../components/icons.js';

interface Readonly_CalendarSummaryProps {
  readonly currentTerm: { readonly label: string; readonly value: string };
  readonly upcomingTrip: { readonly label: string; readonly value: string };
  readonly syncLabel: string;
  readonly onSync?: () => void;
}

export type CalendarSummaryProps = Readonly<Readonly_CalendarSummaryProps>;

export function CalendarSummary({
  currentTerm,
  upcomingTrip,
  syncLabel,
  onSync,
}: CalendarSummaryProps) {
  return (
    <div className="flex flex-col items-start justify-between gap-6 rounded-lg border border-border/20 bg-surface p-6 md:flex-row md:items-center">
      <div className="flex flex-wrap gap-8">
        <SummaryItem
          label={currentTerm.label}
          value={currentTerm.value}
          accent="muted"
        />
        <SummaryItem
          label={upcomingTrip.label}
          value={upcomingTrip.value}
          accent="terracotta"
        />
      </div>
      <button
        type="button"
        onClick={onSync}
        className="flex items-center gap-2 font-medium text-amber-warm hover:underline"
      >
        <CalendarIcon className="h-5 w-5" />
        <span>{syncLabel}</span>
      </button>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  accent,
}: Readonly<{
  readonly label: string;
  readonly value: string;
  readonly accent: 'muted' | 'terracotta';
}>) {
  const labelClass =
    accent === 'terracotta' ? 'text-lumi-terracotta' : 'text-fg-muted';
  return (
    <div>
      <p className={`mb-1 text-[10px] font-bold uppercase tracking-widest ${labelClass}`}>
        {label}
      </p>
      <p className="font-serif text-lg text-fg">{value}</p>
    </div>
  );
}

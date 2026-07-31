import { CalendarIcon, EditIcon } from '@hivekitchen/ui';
import {
  CalendarEditConversation,
  type CalendarValue,
} from './CalendarEditConversation.js';

interface Readonly_CalendarSummaryProps {
  readonly currentTerm: { readonly label: string; readonly value: string };
  readonly upcomingTrip: { readonly label: string; readonly value: string };
  readonly syncLabel: string;
  readonly isEditing?: boolean;
  readonly onSync?: () => void;
  readonly onEdit?: () => void;
  readonly onSendComposite?: (composite: string, nextValue: CalendarValue) => void;
  readonly onDone?: () => void;
}

export type CalendarSummaryProps = Readonly<Readonly_CalendarSummaryProps>;

export function CalendarSummary({
  currentTerm,
  upcomingTrip,
  syncLabel,
  isEditing = false,
  onSync,
  onEdit,
  onSendComposite,
  onDone,
}: CalendarSummaryProps) {
  if (isEditing) {
    return (
      <CalendarEditConversation
        initial={{ currentTerm, upcomingTrip }}
        onSendComposite={(composite, next) => onSendComposite?.(composite, next)}
        onDone={() => onDone?.()}
      />
    );
  }
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
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onSync}
          className="flex items-center gap-2 font-medium text-amber-warm hover:underline"
        >
          <CalendarIcon className="h-5 w-5" />
          <span>{syncLabel}</span>
        </button>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1 text-sm font-medium text-amber-warm hover:underline"
          >
            Edit
            <EditIcon className="h-4 w-4" />
          </button>
        )}
      </div>
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

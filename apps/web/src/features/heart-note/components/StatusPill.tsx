import type { HeartNoteStatus } from '@hivekitchen/contracts';

interface Readonly_StatusPillProps {
  readonly status: HeartNoteStatus;
  readonly scheduledFor: string | null;
  readonly deliveredAt: string | null;
}

export type StatusPillProps = Readonly<Readonly_StatusPillProps>;

const STATUS_LABEL: Record<HeartNoteStatus, string | null> = {
  draft: null,
  scheduled: null,
  delivered: 'Delivered',
  viewed: 'Viewed',
  rated: 'Rated',
  cancelled: 'Cancelled',
};

const STATUS_STYLE: Record<HeartNoteStatus, string> = {
  draft: '',
  scheduled: 'bg-honey/20 text-honey-dark border-honey/30',
  delivered: 'bg-safety-cleared/10 text-safety-cleared border-safety-cleared/30',
  viewed: 'bg-safety-cleared/10 text-safety-cleared border-safety-cleared/30',
  rated: 'bg-safety-cleared/10 text-safety-cleared border-safety-cleared/30',
  cancelled: 'bg-fg-muted/10 text-fg-muted border-fg-muted/20',
};

export function StatusPill({ status, scheduledFor, deliveredAt }: StatusPillProps) {
  if (status === 'draft') return null;

  let label: string;
  if (status === 'scheduled' && scheduledFor) {
    label = `Scheduled for ${formatShortDate(scheduledFor)}`;
  } else if (status === 'delivered' && deliveredAt) {
    label = `Delivered ${formatShortDate(deliveredAt.slice(0, 10))}`;
  } else {
    label = STATUS_LABEL[status] ?? status;
  }

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[12px] font-medium tracking-wide ${STATUS_STYLE[status]}`}
    >
      {label}
    </span>
  );
}

function formatShortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

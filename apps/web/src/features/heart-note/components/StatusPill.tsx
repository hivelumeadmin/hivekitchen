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
  scheduled: 'bg-honey-amber-100 text-honey-amber-800 border-honey-amber-300',
  delivered: 'bg-safety-cleared-100 text-safety-cleared-800 border-safety-cleared-300',
  viewed: 'bg-safety-cleared-100 text-safety-cleared-800 border-safety-cleared-300',
  rated: 'bg-safety-cleared-100 text-safety-cleared-800 border-safety-cleared-300',
  cancelled: 'bg-warm-neutral-50 text-fg-muted border-[color-mix(in_srgb,var(--fg-muted)_20%,transparent)]',
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

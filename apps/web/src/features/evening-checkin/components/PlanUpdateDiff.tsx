import { CheckCircleIcon, SyncAltIcon } from '@hivekitchen/ui';

interface Readonly_PlanUpdateDiffProps {
  readonly previous: string;
  readonly next: string;
  readonly status: string;
}

export type PlanUpdateDiffProps = Readonly<Readonly_PlanUpdateDiffProps>;

export function PlanUpdateDiff({ previous, next, status }: PlanUpdateDiffProps) {
  return (
    <div className="my-6 flex justify-center">
      <div className="flex items-center gap-3 rounded-full border border-dashed border-border bg-surface/50 px-6 py-3 text-xs">
        <SyncAltIcon className="h-4 w-4 text-foliage" />
        <span className="text-fg-muted">
          <span className="line-through opacity-50">{previous}</span>{' '}
          <span className="text-fg-muted">→</span>{' '}
          <span className="text-fg">{next}</span>
        </span>
        <span className="flex items-center gap-1 text-safety-cleared">
          <CheckCircleIcon className="h-3.5 w-3.5" />
          {status}
        </span>
      </div>
    </div>
  );
}

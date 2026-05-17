import { CheckIcon } from '../../../components/icons.js';
import type { lunchLinkMock } from '../data/mockData.js';

interface Readonly_LunchSummaryProps {
  readonly lunch: typeof lunchLinkMock.lunch;
}

export type LunchSummaryProps = Readonly<Readonly_LunchSummaryProps>;

export function LunchSummary({ lunch }: LunchSummaryProps) {
  return (
    <section>
      <div className="flex items-center gap-4 rounded-lg border border-border/5 bg-surface p-4">
        <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg">
          <img
            src={lunch.imageSrc}
            alt={lunch.imageAlt}
            className="h-full w-full object-cover"
          />
        </div>
        <div className="min-w-0 flex-grow">
          <span className="text-[11px] font-bold uppercase tracking-widest text-lumi-terracotta">
            {lunch.eyebrow}
          </span>
          <h2 className="mt-0.5 truncate font-serif text-lg leading-snug text-fg">
            {lunch.name}
          </h2>
          <p className="truncate text-xs text-fg-muted">{lunch.sub}</p>
        </div>
        <span className="flex flex-shrink-0 items-center gap-1 rounded-full border border-safety-cleared/30 bg-safety-cleared/20 px-2 py-1 text-[11px] text-safety-cleared">
          {lunch.safetyBadge}
          <CheckIcon className="h-3 w-3" />
        </span>
      </div>
    </section>
  );
}

import { LeafIcon, ShieldCheckIcon, StarIcon } from '../../../components/icons.js';
import type { WhyReason, WhyReasonIcon } from '../data/mockData.js';

interface Readonly_WhyThisWeekPanelProps {
  readonly reasons: readonly WhyReason[];
}

export type WhyThisWeekPanelProps = Readonly<Readonly_WhyThisWeekPanelProps>;

export function WhyThisWeekPanel({ reasons }: WhyThisWeekPanelProps) {
  return (
    <section className="rounded-lg border border-border bg-surface p-10">
      <h4 className="mb-8 text-xs uppercase tracking-[0.2em] text-fg-muted">Why this week</h4>
      <div className="grid grid-cols-1 gap-10 md:grid-cols-3">
        {reasons.map((r, i) => (
          <WhyReasonRow key={i} reason={r} />
        ))}
      </div>
    </section>
  );
}

function WhyReasonRow({ reason }: Readonly<{ readonly reason: WhyReason }>) {
  return (
    <div className="flex items-start gap-4">
      <ReasonIcon kind={reason.icon} />
      <p className="text-sm leading-relaxed text-fg">{reason.text}</p>
    </div>
  );
}

const iconColor: Record<WhyReasonIcon, string> = {
  star: 'text-amber-warm',
  'shield-check': 'text-safety-cleared',
  leaf: 'text-sacred',
};

function ReasonIcon({ kind }: Readonly<{ readonly kind: WhyReasonIcon }>) {
  const className = `h-6 w-6 shrink-0 ${iconColor[kind]}`;
  switch (kind) {
    case 'star':
      return <StarIcon className={className} />;
    case 'shield-check':
      return <ShieldCheckIcon className={className} />;
    case 'leaf':
      return <LeafIcon className={className} />;
  }
}

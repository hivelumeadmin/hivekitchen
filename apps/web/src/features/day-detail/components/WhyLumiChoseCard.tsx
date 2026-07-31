import {
  NutritionIcon,
  PackageIcon,
  StarFilledIcon,
} from '@hivekitchen/ui';
import { RailCard } from '@hivekitchen/ui';
import type { WhyReason, WhyReasonIcon } from '../data/mockData.js';

interface Readonly_WhyLumiChoseCardProps {
  readonly reasons: readonly WhyReason[];
}

export type WhyLumiChoseCardProps = Readonly<Readonly_WhyLumiChoseCardProps>;

export function WhyLumiChoseCard({ reasons }: WhyLumiChoseCardProps) {
  return (
    <RailCard accent="lumi-terracotta" eyebrow="Why Lumi chose this">
      <ul className="space-y-3 text-[13px] text-fg-muted">
        {reasons.map((r, i) => (
          <li key={i} className="flex items-start gap-3">
            <ReasonIcon kind={r.icon} />
            <span>{r.text}</span>
          </li>
        ))}
      </ul>
    </RailCard>
  );
}

function ReasonIcon({ kind }: Readonly<{ readonly kind: WhyReasonIcon }>) {
  const className = 'mt-0.5 h-4 w-4 shrink-0 text-lumi-terracotta';
  switch (kind) {
    case 'star':
      return <StarFilledIcon className={className} />;
    case 'package':
      return <PackageIcon className={className} />;
    case 'nutrition':
      return <NutritionIcon className={className} />;
  }
}

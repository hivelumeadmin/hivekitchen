import {
  AwardIcon,
  CheckCircleIcon,
  ShieldIcon,
  StarFilledIcon,
  SunIcon,
} from '../../../components/icons.js';
import type { BadgeColor, BadgeIcon, RecipeBadge as BadgeData } from '../data/mockData.js';

interface Readonly_RecipeBadgeProps {
  readonly badge: BadgeData;
}

export type RecipeBadgeProps = Readonly<Readonly_RecipeBadgeProps>;

const colorClass: Record<BadgeColor, string> = {
  sacred: 'bg-sacred/10 text-sacred border-sacred/20',
  'safety-cleared': 'bg-safety-cleared/10 text-safety-cleared border-safety-cleared/20',
  amber: 'bg-amber-warm/10 text-amber-warm border-amber-warm/20',
};

export function RecipeBadge({ badge }: RecipeBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-widest ${colorClass[badge.color]}`}
    >
      <BadgeIconGlyph kind={badge.icon} />
      {badge.label}
    </span>
  );
}

function BadgeIconGlyph({ kind }: Readonly<{ readonly kind: BadgeIcon }>) {
  const className = 'h-4 w-4';
  switch (kind) {
    case 'star':
      return <StarFilledIcon className={className} />;
    case 'check':
      return <CheckCircleIcon className={className} />;
    case 'shield':
      return <ShieldIcon className={className} />;
    case 'sun':
      return <SunIcon className={className} />;
    case 'award':
      return <AwardIcon className={className} />;
  }
}

import {
  AwardIcon,
  CheckCircleIcon,
  ShieldIcon,
  StarFilledIcon,
  SunIcon,
} from '@hivekitchen/ui';
import type { BadgeColor, BadgeIcon, RecipeBadge as BadgeData } from '../data/mockData.js';

interface Readonly_RecipeBadgeProps {
  readonly badge: BadgeData;
}

export type RecipeBadgeProps = Readonly<Readonly_RecipeBadgeProps>;

const colorClass: Record<BadgeColor, string> = {
  sacred: 'bg-sacred-100 text-sacred-800 border-sacred-300',
  'safety-cleared': 'bg-safety-cleared-100 text-safety-cleared-800 border-safety-cleared-300',
  amber: 'bg-honey-amber-100 text-honey-amber-800 border-honey-amber-300',
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

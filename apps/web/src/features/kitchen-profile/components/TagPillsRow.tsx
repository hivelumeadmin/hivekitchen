import {
  BanIcon,
  GlobeIcon,
  UtensilsIcon,
} from '../../../components/icons.js';
import type { TagPill, TagPillColor, TagPillIcon } from '../data/mockData.js';

interface Readonly_TagPillsRowProps {
  readonly pills: readonly TagPill[];
}

export type TagPillsRowProps = Readonly<Readonly_TagPillsRowProps>;

const colorClass: Record<TagPillColor, string> = {
  amber: 'text-amber-warm',
  'safety-cleared': 'text-safety-cleared',
  'lumi-terracotta': 'text-lumi-terracotta-warmed',
};

export function TagPillsRow({ pills }: TagPillsRowProps) {
  return (
    <div className="mt-8 flex flex-wrap gap-4 pt-4">
      {pills.map((pill, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-full border border-border/20 bg-surface px-4 py-2 shadow-sm"
        >
          <PillIcon kind={pill.icon} color={pill.color} />
          <span className="text-sm font-medium text-fg">{pill.label}</span>
        </div>
      ))}
    </div>
  );
}

function PillIcon({
  kind,
  color,
}: Readonly<{ readonly kind: TagPillIcon; readonly color: TagPillColor }>) {
  const className = `h-[18px] w-[18px] ${colorClass[color]}`;
  if (kind === 'utensils') return <UtensilsIcon className={className} />;
  if (kind === 'ban') return <BanIcon className={className} />;
  return <GlobeIcon className={className} />;
}

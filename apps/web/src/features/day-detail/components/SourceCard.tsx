import { MenuBookIcon, RailCard } from '@hivekitchen/ui';
import type { Source } from '../data/mockData.js';

interface Readonly_SourceCardProps {
  readonly source: Source;
}

export type SourceCardProps = Readonly<Readonly_SourceCardProps>;

export function SourceCard({ source }: SourceCardProps) {
  return (
    <RailCard variant="muted">
      <div className="mb-1 flex items-center gap-2">
        <MenuBookIcon className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">{source.bookTitle}</span>
      </div>
      <p className="text-[11px] uppercase tracking-wider">{source.category}</p>
    </RailCard>
  );
}

import type { ChildColor } from '../data/mockData.js';

interface Readonly_ChildChipProps {
  readonly name: string;
  readonly color: ChildColor;
}

export type ChildChipProps = Readonly<Readonly_ChildChipProps>;

const dotColor: Record<ChildColor, string> = {
  foliage: 'bg-foliage',
  'lumi-terracotta': 'bg-lumi-terracotta',
};

export function ChildChip({ name, color }: ChildChipProps) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-[11px] font-medium text-fg">
      <span className={`h-2 w-2 rounded-full ${dotColor[color]}`} aria-hidden />
      {name}
    </span>
  );
}

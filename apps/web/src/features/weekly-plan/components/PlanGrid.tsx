import type { PlanTile as PlanTileData } from '../data/mockData.js';
import { PlanTile } from './PlanTile.js';

interface Readonly_PlanGridProps {
  readonly tiles: readonly PlanTileData[];
}

export type PlanGridProps = Readonly<Readonly_PlanGridProps>;

export function PlanGrid({ tiles }: PlanGridProps) {
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-5">
      {tiles.map((tile) => (
        <PlanTile key={`${tile.day}-${tile.date}`} tile={tile} />
      ))}
    </section>
  );
}

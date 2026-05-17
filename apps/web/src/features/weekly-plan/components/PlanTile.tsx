import { PauseCircleIcon } from '../../../components/icons.js';
import type { PlanTile as PlanTileData } from '../data/mockData.js';
import { ChildChip } from './ChildChip.js';

interface Readonly_PlanTileProps {
  readonly tile: PlanTileData;
}

export type PlanTileProps = Readonly<Readonly_PlanTileProps>;

export function PlanTile({ tile }: PlanTileProps) {
  if (tile.variant === 'no-lunch') {
    return (
      <article className="flex h-full flex-col rounded-lg border border-border/50 bg-surface/40 p-6 opacity-60">
        <DayLabel day={tile.day} date={tile.date} muted />
        <div className="flex flex-grow flex-col items-center justify-center text-center">
          <PauseCircleIcon className="mb-3 h-9 w-9 text-fg-muted" />
          <h3 className="font-serif text-xl text-fg-muted">{tile.noLunchReason}</h3>
        </div>
      </article>
    );
  }

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface p-6 transition-all duration-300 hover:[border-left-width:2px] hover:border-l-amber-warm hover:[padding-left:calc(1.5rem-2px)]">
      {tile.variant === 'saved-waste' ? (
        <div className="absolute right-0 top-0 rounded-bl-lg border-b border-l border-border bg-amber-warm/20 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-warm">
          Saved Waste
        </div>
      ) : null}

      <DayLabel day={tile.day} date={tile.date} />

      <h3 className="mb-6 flex-grow font-serif text-2xl text-fg">{tile.dish}</h3>

      <div className="space-y-3">
        {tile.children && tile.children.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {tile.children.map((c) => (
              <ChildChip key={c.id} name={c.name} color={c.color} />
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          {tile.safetyCleared ? (
            <span className="text-[11px] font-bold uppercase tracking-wider text-safety-cleared">
              {tile.safetyCleared}
            </span>
          ) : null}
          {tile.leftoverHint ? (
            <span className="text-[11px] font-medium text-amber-warm">{tile.leftoverHint}</span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function DayLabel({
  day,
  date,
  muted = false,
}: Readonly<{ readonly day: string; readonly date: string; readonly muted?: boolean }>) {
  const dayClass = muted ? 'text-fg-muted/70' : 'text-fg-muted';
  return (
    <span className={`mb-4 text-xs uppercase tracking-wide ${dayClass}`}>
      {day} {date}
    </span>
  );
}


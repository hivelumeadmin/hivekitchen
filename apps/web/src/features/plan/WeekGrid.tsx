import type { PlanTileSummary } from '@hivekitchen/types';
import { PlanTile, type PlanTileState, type ChildInfo } from './PlanTile.js';
import { PackerChip } from './PackerChip.js';

// Story 14-s3 — render the week's ISO date as the row's quiet date line. The
// dates come from useBriefView's local-anchored week map, so parse as local too.
// Locale pinned to en-US (review P4): all surrounding copy is fixed English and
// unit tests assert the rendered text; a viewer-locale date would flake both.
function formatDayDate(iso: string): string {
  if (iso === '') return '';
  const parsed = new Date(`${iso}T00:00:00`);
  if (isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Story 14-s3 — the Main this day is built around. Used only to detect the
// carried-forward repeat that makes the 3-Main rhythm legible; derived from the
// tile summaries already in the view-model, no extra query.
function mainKey(summary: PlanTileSummary): string | null {
  const main = summary.items.find((i) => i.slot === 'main');
  return main?.recipe_id ?? null;
}

// Review P3 — "again" means CALENDAR-consecutive (AC4), not array-adjacent: the
// composer skips days with no tile items, so Mon(A)–[Wed absent]–Thu(A) must
// not mark Thursday as a repeat.
const DAY_ORDINAL: Record<PlanTileSummary['day'], number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

// Story 14-s3 — the week reads as an editorial itinerary: one full-width day row
// per day rather than a five-column tile grid. Pure presentation — the tileState
// machine, swap/reasoning intent, and the PackerChip per day are unchanged from
// the 14-s2 extraction; only the layout and the derived row affordances are new.
export function WeekGrid({
  tileSummaries,
  childColorMap,
  pendingProposal,
  swappingItemId,
  activeSwapDay,
  planReasoning,
  canSwap,
  weekDates,
  householdId,
  onWhyThis,
  onSummonForDay,
}: {
  tileSummaries: PlanTileSummary[];
  childColorMap: ReadonlyMap<string, ChildInfo>;
  pendingProposal: { id: string; day: PlanTileSummary['day'] } | null;
  swappingItemId: string | null;
  activeSwapDay: PlanTileSummary['day'] | null;
  planReasoning: string | null;
  canSwap: boolean;
  weekDates: Record<string, string>;
  householdId: string | null;
  onWhyThis: () => void;
  onSummonForDay: (summary: PlanTileSummary) => void;
}) {
  return (
    // The inter-row gap is deliberately wider than the row↔PackerChip gap below,
    // so each day reads as one group rather than as alternating bands.
    <div className="mb-8 flex flex-col gap-5" aria-label="Weekly plan">
      {tileSummaries.map((summary, index) => {
        const tileState: PlanTileState =
          summary.paused
            ? 'paused'
            : pendingProposal !== null && summary.day === pendingProposal.day
              ? 'proposal-pending'
              // Review P2 — guard the idle state: legacy pre-3.12 rows carry
              // plan_item_id: null (contract default), and swappingItemId is
              // null when no swap is in flight; null === null would render a
              // permanent aria-busy overlay.
              : swappingItemId !== null &&
                  summary.items.some((i) => i.plan_item_id === swappingItemId)
                ? 'swap-in-progress'
                : activeSwapDay === summary.day
                  ? 'pending-input'
                  : 'decided';

        const previous = index > 0 ? tileSummaries[index - 1] : undefined;
        const thisMain = mainKey(summary);
        const repeatsPreviousDay =
          thisMain !== null &&
          previous !== undefined &&
          mainKey(previous) === thisMain &&
          DAY_ORDINAL[summary.day] - DAY_ORDINAL[previous.day] === 1;

        return (
          <div key={summary.day} className="flex flex-col gap-1.5">
            <PlanTile
              summary={summary}
              state={tileState}
              childColorMap={childColorMap}
              childRatings={summary.child_ratings}
              dateLabel={formatDayDate(weekDates[summary.day] ?? '')}
              repeatsPreviousDay={repeatsPreviousDay}
              revealIndex={index}
              onWhyThis={planReasoning ? onWhyThis : undefined}
              onSwapIntent={
                canSwap && !summary.paused && swappingItemId === null
                  ? () => onSummonForDay(summary)
                  : undefined
              }
            />
            <PackerChip
              day={summary.day}
              date={weekDates[summary.day] ?? ''}
              householdId={householdId ?? ''}
            />
          </div>
        );
      })}
    </div>
  );
}

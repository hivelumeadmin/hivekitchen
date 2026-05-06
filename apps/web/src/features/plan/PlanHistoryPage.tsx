import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import type { PlanItemRow, PlanTileSummary } from '@hivekitchen/types';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { HkApiError } from '@/lib/fetch.js';
import { deriveWeekId, getCurrentWeekMonday } from '@/lib/derive-week-id.js';
import { FreshnessState } from './FreshnessState.js';
import { PlanTile } from './PlanTile.js';
import { SwapHistoryPopover } from './SwapHistoryPopover.js';
import { usePlanHistoryQuery } from './queries.js';

// Saturday is intentionally excluded: the history grid is 5 weekday tiles only.
// Any Saturday entries in swap_history are silently ignored here because no
// summary.day ever equals 'saturday'. See deferred-work.md (3-15) for context.
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;

// Story 3.15 — Adapter mirrors PlanPage's groupings, but we render the FINAL
// item set per day (replaced_by_plan_id IS NULL items only — the API already
// filters those). Days with no items still produce a tile so the week reads
// as a uniform grid.
function toPlanTileSummaries(items: ReadonlyArray<PlanItemRow>): PlanTileSummary[] {
  return WEEKDAYS.map((day) => {
    const dayItems = items.filter((it) => it.day === day);
    return {
      day,
      paused: dayItems.length > 0 && dayItems.every((it) => it.paused_at !== null),
      items: dayItems.map((it) => ({
        plan_item_id: it.id,
        child_id: it.child_id,
        slot: it.slot,
        ingredients: it.ingredients,
        ...(it.recipe_id !== null ? { recipe_id: it.recipe_id } : {}),
        ...(it.item_id !== null ? { item_id: it.item_id } : {}),
      })),
    };
  });
}

function formatWeekOf(weekOf: string): string {
  // weekOf is an ISO date (e.g. '2026-04-21'); render as 'Week of April 21, 2026'.
  // Pin to UTC midnight so a user's local timezone never shifts it back a day.
  return new Date(`${weekOf}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function PlanHistoryPage() {
  useScope('app-scope');
  useLumiContext({ surface: 'brief' });

  const { weekId } = useParams<{ weekId: string }>();
  const { data, isLoading, isError, error } = usePlanHistoryQuery(weekId);

  // Redirect to /app/plan when the historical URL points to the current week —
  // rendering a still-mutable plan in non-interactive past variant is misleading.
  // SubtleCrypto unavailable (insecure context) leaves the redirect off; the page
  // simply renders the plan in past variant, which is no worse than today's UX.
  const [shouldRedirectToCurrent, setShouldRedirectToCurrent] = useState(false);
  useEffect(() => {
    if (weekId === undefined || weekId === '') return;
    let cancelled = false;
    deriveWeekId(getCurrentWeekMonday())
      .then((currentWeekId) => {
        if (!cancelled && currentWeekId === weekId) setShouldRedirectToCurrent(true);
      })
      .catch(() => {
        // SubtleCrypto unavailable — skip the redirect check.
      });
    return () => {
      cancelled = true;
    };
  }, [weekId]);

  const summaries = useMemo(
    () => (data?.plan_items ? toPlanTileSummaries(data.plan_items) : []),
    [data?.plan_items],
  );

  if (shouldRedirectToCurrent) {
    return <Navigate to="/app/plan" replace />;
  }

  const isNotFound = isError && error instanceof HkApiError && error.status === 404;

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-2xl mx-auto flex flex-col gap-6">
      <div>
        <Link
          to="/app/plan"
          className="font-sans text-[13px] text-stone-500 underline underline-offset-2 hover:text-stone-700 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
        >
          Back to this week
        </Link>
      </div>

      {isLoading && <FreshnessState variant="loading" />}
      {isNotFound && (
        <p
          className="font-sans text-[15px] text-stone-500 text-center"
          role="status"
        >
          No plan was generated for this week.
        </p>
      )}
      {isError && !isNotFound && <FreshnessState variant="failed" />}

      {!isLoading && !isError && data !== undefined && data.plan !== null && (
        <>
          {data.week_of !== null && (
            <h1 className="font-serif text-[22px] leading-tight text-stone-800">
              Week of {formatWeekOf(data.week_of)}
            </h1>
          )}
          {data.plan_items.length === 0 ? (
            <p
              className="font-sans text-[15px] text-stone-500 text-center"
              role="status"
            >
              No items were recorded for this week.
            </p>
          ) : (
            <div
              className="grid grid-cols-2 md:grid-cols-5 gap-3"
              aria-label="Historical weekly plan"
            >
              {summaries.map((summary) => {
                const daySwaps = data.swap_history.filter((s) => s.day === summary.day);
                return (
                  <div key={summary.day} className="relative">
                    <PlanTile summary={summary} forceVariant="past" />
                    {daySwaps.length > 0 && <SwapHistoryPopover swaps={daySwaps} />}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </main>
  );
}

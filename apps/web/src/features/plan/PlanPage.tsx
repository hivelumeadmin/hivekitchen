import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import type { GetPlansResponse, PlanItemRow, PlanTileSummary } from '@hivekitchen/types';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { deriveWeekId, getMondayWeeksAgo } from '@/lib/derive-week-id.js';
import { PageHeader } from '@/components/PageHeader.js';
import { FreshnessState } from './FreshnessState.js';
import { PlanTile } from './PlanTile.js';
import { usePlanQuery } from './queries.js';

// Story 3.14 — FR21 enables the next-week tab on Friday afternoon. UTC for
// MVP (per Dev Notes); per-timezone enforcement is a future server-side move
// once the household timezone is threaded through this endpoint.
const FRIDAY_OPEN_HOUR_UTC = 16;

export function isNextWeekDraftAvailable(now: Date = new Date()): boolean {
  const day = now.getUTCDay(); // 0=Sun .. 6=Sat
  const hour = now.getUTCHours();
  if (day === 6 || day === 0) return true;        // Saturday or Sunday
  if (day === 5 && hour >= FRIDAY_OPEN_HOUR_UTC) return true; // Friday after 4pm UTC
  return false;
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;
type Weekday = (typeof WEEKDAYS)[number];

// Adapter: PlanItemRow[] (wire) → PlanTileSummary[] (PlanTile prop). Groups
// items by day, projects fields, derives `paused` from the items' paused_at.
// Days with no items still produce a tile so the week grid stays five-wide.
function toPlanTileSummaries(items: PlanItemRow[]): PlanTileSummary[] {
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

function PlanWeekContent({ data }: { data: GetPlansResponse }) {
  const summaries = useMemo(() => toPlanTileSummaries(data.plan_items), [data.plan_items]);
  return (
    <div className="flex flex-col gap-4" aria-label="Weekly plan">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {summaries.map((summary) => (
          <PlanTile key={summary.day} summary={summary} />
        ))}
      </div>
      {data.is_draft && (
        <p
          className="font-sans text-[13px] text-fg-muted text-center mt-2"
          role="note"
        >
          This is a draft — Lumi may refine it before Monday.
        </p>
      )}
    </div>
  );
}

export function PlanPage() {
  useScope('app-scope');
  useLumiContext({ surface: 'brief' });

  const [activeWeek, setActiveWeek] = useState<'current' | 'next'>('current');
  // Recomputed once per minute so a tab switch crossing the Friday 4pm
  // boundary doesn't require a page refresh.
  const [nextAvailable, setNextAvailable] = useState(() => isNextWeekDraftAvailable());
  useEffect(() => {
    const tick = () => setNextAvailable(isNextWeekDraftAvailable());
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (!nextAvailable && activeWeek === 'next') setActiveWeek('current');
  }, [nextAvailable, activeWeek]);

  const { data, isLoading, isError } = usePlanQuery(activeWeek);

  // Story 3.15 — derive a deep link to last week's historical plan view.
  // Async derivation keeps the SubtleCrypto call off the render path; weekId
  // is stable for a given Monday so we compute once per page mount.
  // SubtleCrypto requires a secure context; on http:// dev/preview origins the
  // link is silently omitted rather than surfacing a noisy error.
  const [lastWeekId, setLastWeekId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    deriveWeekId(getMondayWeeksAgo(1))
      .then((id) => {
        if (!cancelled) setLastWeekId(id);
      })
      .catch(() => {
        // SubtleCrypto unavailable (insecure context) — leave the link absent.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const eyebrow = activeWeek === 'next' ? "Next week's draft" : "This week's plan";
  const headline = activeWeek === 'next' ? 'Looking ahead' : 'Your week, ready';

  return (
    <main className="mx-auto w-full max-w-7xl flex-grow px-6 pt-12 pb-24">
      <PageHeader eyebrow={eyebrow} headlineSize="lg" className="mb-8">
        {headline}
      </PageHeader>

      <div role="tablist" aria-label="Week selector" className="mb-8 flex gap-2">
        <button
          type="button"
          role="tab"
          aria-selected={activeWeek === 'current'}
          onClick={() => setActiveWeek('current')}
          className="rounded-full px-4 py-1.5 font-sans text-sm font-medium transition-colors motion-reduce:transition-none aria-selected:bg-fg aria-selected:text-bg aria-[selected=false]:text-fg-muted aria-[selected=false]:hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-warm"
        >
          This week
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeWeek === 'next'}
          aria-disabled={!nextAvailable}
          disabled={!nextAvailable}
          onClick={() => {
            if (nextAvailable) setActiveWeek('next');
          }}
          className="rounded-full px-4 py-1.5 font-sans text-sm font-medium transition-colors motion-reduce:transition-none aria-selected:bg-fg aria-selected:text-bg aria-[selected=false]:text-fg-muted aria-[selected=false]:enabled:hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-warm"
        >
          Next week
        </button>
      </div>

      {isLoading && <FreshnessState variant="loading" />}

      {isError && <FreshnessState variant="failed" />}

      {!isLoading && !isError && data !== undefined && (
        <>
          {data.plan === null ? (
            <p
              className="mt-2 font-sans text-[13px] text-fg-muted"
              role="status"
              aria-live="polite"
            >
              {data.is_draft
                ? 'Lumi is drafting next week — about 30 seconds'
                : "Lumi is drafting this week's plan — about 30 seconds"}
            </p>
          ) : (
            <PlanWeekContent data={data} />
          )}
        </>
      )}

      {activeWeek === 'current' && lastWeekId !== null && (
        <div className="mt-8 flex justify-center">
          <Link
            to={`/app/plan/${lastWeekId}`}
            className="font-sans text-[13px] text-fg-muted underline underline-offset-2 hover:text-amber-warm transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-warm"
          >
            View last week
          </Link>
        </div>
      )}
    </main>
  );
}

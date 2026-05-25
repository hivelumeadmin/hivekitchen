import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useScope } from '@hivekitchen/ui';
import type {
  BriefStateRow,
  ClearedAllergyEntry,
  GetPlansResponse,
  PlanItemRow,
  PlanTileSummary,
} from '@hivekitchen/types';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { deriveWeekId, getMondayWeeksAgo } from '@/lib/derive-week-id.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { FreshnessState } from './FreshnessState.js';
import { PlanTile, type ChildDotColor, type ChildInfo } from './PlanTile.js';
import { BriefWhyPanel } from './BriefWhyPanel.js';
import { PlanActionSection } from './PlanActionSection.js';
import { PlanPageFooter } from './PlanPageFooter.js';
import { usePlanQuery } from './queries.js';
import { useBriefStateQuery } from './useBriefStateQuery.js';

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
      lunch_link_suppressed_children: [],
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

// Build a stable child → color map. Child order is determined by first
// appearance in planItems; child names are resolved from clearedAllergies
// (the only source that carries child_name alongside child_id).
const CHILD_COLORS: readonly ChildDotColor[] = ['foliage', 'lumi-terracotta'];

function buildChildColorMap(
  planItems: PlanItemRow[],
  clearedAllergies: ClearedAllergyEntry[],
): ReadonlyMap<string, ChildInfo> {
  const map = new Map<string, ChildInfo>();
  const order: string[] = [];
  for (const item of planItems) {
    if (!map.has(item.child_id)) {
      order.push(item.child_id);
      map.set(item.child_id, {
        name: '',
        color: CHILD_COLORS[Math.min(order.length - 1, CHILD_COLORS.length - 1)]!,
      });
    }
  }
  for (const entry of clearedAllergies) {
    const existing = map.get(entry.child_id);
    if (existing !== undefined) {
      map.set(entry.child_id, { ...existing, name: entry.child_name });
    }
  }
  return map;
}

// Format "Mon 11 May – Fri 15 May" from the ISO Monday date string.
function formatWeekRange(weekOf: string): string {
  const monday = new Date(weekOf + 'T00:00:00Z');
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  return `${fmt(monday)} – ${fmt(friday)}`;
}

function PlanWeekContent({
  data,
  childColorMap,
}: {
  data: GetPlansResponse;
  childColorMap: ReadonlyMap<string, ChildInfo>;
}) {
  const summaries = useMemo(() => toPlanTileSummaries(data.plan_items), [data.plan_items]);
  return (
    <div className="flex flex-col gap-4" aria-label="Weekly plan">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {summaries.map((summary) => (
          <PlanTile
            key={summary.day}
            summary={summary}
            childColorMap={childColorMap}
          />
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

  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);

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
  const { data: briefData } = useBriefStateQuery(householdId);
  const brief: BriefStateRow | null = briefData?.brief ?? null;

  // Build child color map once we have both plan items and allergy data.
  const childColorMap = useMemo(
    () =>
      buildChildColorMap(
        data?.plan_items ?? [],
        brief?.cleared_allergies ?? [],
      ),
    [data?.plan_items, brief?.cleared_allergies],
  );

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

  // Hero content — prefer live brief data, fall back to static copy.
  const headline =
    brief?.moment_headline ??
    (activeWeek === 'next' ? 'Looking ahead' : 'Your week, ready');
  const lumiNote = brief?.lumi_note ?? '';

  // Eyebrow — include date range when we have plan data.
  const weekDateRange =
    data?.week_of !== undefined ? formatWeekRange(data.week_of) : null;
  const eyebrowBase =
    activeWeek === 'next' ? "NEXT WEEK'S DRAFT" : "THIS WEEK'S BRIEF";
  const eyebrow =
    weekDateRange !== null ? `${eyebrowBase} · ${weekDateRange}` : eyebrowBase;

  return (
    <main className="mx-auto w-full max-w-7xl flex-grow px-8 pb-0">
      {/* Hero section */}
      <section className="py-16 mb-0">
        <p className="font-sans text-xs font-medium uppercase tracking-[0.15em] text-fg-muted mb-4">
          {eyebrow}
        </p>
        <h1 className="font-serif text-[56px] leading-[1.1] text-fg mb-6">
          {headline}
        </h1>
        {lumiNote !== '' && (
          <p className="font-sans text-base leading-relaxed text-fg-muted max-w-2xl">
            {lumiNote}
          </p>
        )}
      </section>

      {/* Week tabs */}
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

      {/* Plan grid */}
      {isLoading && <FreshnessState variant="loading" />}

      {isError && <FreshnessState variant="failed" />}

      {!isLoading && !isError && data !== undefined && (
        <>
          {data.plan === null ? (
            data.hard_fail != null && !data.is_draft ? (
              <FreshnessState variant="reworking" failedAt={data.hard_fail.failed_at} />
            ) : (
              <p
                className="mt-2 font-sans text-[13px] text-fg-muted"
                role="status"
                aria-live="polite"
              >
                {data.is_draft
                  ? 'Lumi is drafting next week — about 30 seconds'
                  : "Lumi is drafting this week's plan — about 30 seconds"}
              </p>
            )
          ) : (
            <PlanWeekContent data={data} childColorMap={childColorMap} />
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

      {/* Why This Week */}
      <div className="mt-16">
        <BriefWhyPanel brief={brief} />
      </div>

      {/* Actions */}
      <PlanActionSection />

      {/* Footer */}
      <PlanPageFooter />
    </main>
  );
}

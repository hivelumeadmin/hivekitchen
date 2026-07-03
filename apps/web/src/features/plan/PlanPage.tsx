import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useScope } from '@hivekitchen/ui';
import type {
  BriefStateRow,
  ClearedAllergyEntry,
  GetPlansResponse,
} from '@hivekitchen/types';
import { useLumiContext } from '@/hooks/useLumiContext.js';
import { deriveWeekId, getMondayWeeksAgo } from '@/lib/derive-week-id.js';
import { QueryKeys } from '@/lib/realtime/query-keys.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { useLumiStore, type PlanEditDay } from '@/stores/lumi.store.js';
import { FreshnessState } from './FreshnessState.js';
import { PlanTile, type ChildDotColor, type ChildInfo } from './PlanTile.js';
import { BriefWhyPanel } from './BriefWhyPanel.js';
import { PlanActionBar } from './PlanActionBar.js';
import { PlanPageFooter } from './PlanPageFooter.js';
import { usePlanQuery } from './queries.js';
import { useBriefStateQuery } from './useBriefStateQuery.js';
import { useConfirmVariantProposalMutation, usePlanEditMutation } from './mutations.js';
import { adaptPlansResponse } from './tree-adapter.js';

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

// Build a stable child → color map. Child order is determined by first
// appearance in plan variations; child names are resolved from clearedAllergies
// (the only source that carries child_name alongside child_id).
const CHILD_COLORS: readonly ChildDotColor[] = ['foliage', 'lumi-terracotta'];

// 13-s10 — plan tiles carry full weekdays; the plan-edit scope + classifier use
// short weekdays. Saturday has no plan-edit day (mon–fri only).
const FULL_TO_SHORT: Record<string, PlanEditDay> = {
  monday: 'mon',
  tuesday: 'tue',
  wednesday: 'wed',
  thursday: 'thu',
  friday: 'fri',
};
const SHORT_DAY_LABEL: Record<PlanEditDay, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
};

function buildChildColorMap(
  childIdOrder: readonly string[],
  clearedAllergies: ClearedAllergyEntry[],
): ReadonlyMap<string, ChildInfo> {
  const map = new Map<string, ChildInfo>();
  childIdOrder.forEach((childId, idx) => {
    map.set(childId, {
      name: '',
      color: CHILD_COLORS[Math.min(idx, CHILD_COLORS.length - 1)]!,
    });
  });
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
  const { summaries } = useMemo(() => adaptPlansResponse(data), [data]);
  const confirmVariant = useConfirmVariantProposalMutation();

  // Story 3.27 — index active proposals by plan_item_id so each tile finds its
  // own proposal without a second pass per render. VariantProposalSchema still
  // carries plan_item_id today; the tile summaries reuse the variation row id
  // as the per-(child, slot) item id (see tree-adapter.dayViewToPlanTileSummary)
  // so the lookup still resolves until the variant_proposal carve-out lands.
  const proposalsByItem = useMemo(() => {
    const out = new Map<
      string,
      NonNullable<GetPlansResponse['variant_proposals']>[number]
    >();
    for (const p of data.variant_proposals ?? []) {
      out.set(p.plan_item_id, p);
    }
    return out;
  }, [data.variant_proposals]);

  function findProposalForDay(summary: (typeof summaries)[number]) {
    for (const item of summary.items) {
      if (item.plan_item_id === null) continue;
      const p = proposalsByItem.get(item.plan_item_id);
      if (p !== undefined) return p;
    }
    return undefined;
  }

  const planId = data.plan?.id ?? null;
  const weekOf = data.week_of;

  // 13-s10 — the child roster + editable days the plan-edit clarify chips draw
  // from, captured here (where the plan data lives) so the sheet stays
  // self-contained. Names come from childColorMap (cleared-allergies source).
  const childRoster = useMemo(() => {
    const out: { id: string; name: string }[] = [];
    for (const [id, info] of childColorMap) {
      if (info.name) out.push({ id, name: info.name });
    }
    return out;
  }, [childColorMap]);
  const editableDays = useMemo(
    () =>
      summaries
        .filter((s) => !s.paused && FULL_TO_SHORT[s.day] !== undefined)
        .map((s) => FULL_TO_SHORT[s.day]!),
    [summaries],
  );

  // AC1 — tapping a day summons the sheet hydrated with that day's context.
  function summonForDay(summary: (typeof summaries)[number]) {
    if (planId === null) return;
    const short = FULL_TO_SHORT[summary.day];
    if (short === undefined) return;
    const dishes = [
      ...new Set(
        summary.items
          .map((i) => i.name)
          .filter((n): n is string => typeof n === 'string' && n.length > 0),
      ),
    ];
    useLumiStore.getState().setPlanEditScope({
      planId,
      weekOf,
      day: short,
      dayLabel: SHORT_DAY_LABEL[short],
      dishes,
      days: editableDays,
      children: childRoster,
    });
    useLumiStore.getState().summon('text');
  }

  return (
    <div className="flex flex-col gap-4" aria-label="Weekly plan">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {summaries.map((summary) => {
          const proposal = findProposalForDay(summary);
          return (
            <PlanTile
              key={summary.day}
              summary={summary}
              childColorMap={childColorMap}
              onSwapIntent={planId !== null ? () => summonForDay(summary) : undefined}
              variantProposal={proposal}
              onVariantChoice={
                proposal !== undefined && planId !== null
                  ? (proposalId, choice) =>
                      confirmVariant.mutate({
                        planId,
                        proposalId,
                        input: { choice },
                      })
                  : undefined
              }
            />
          );
        })}
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

  // Build child color map once we have both plan tree data and allergy data.
  const childIdOrder = useMemo(
    () => (data ? adaptPlansResponse(data).childIdOrder : []),
    [data],
  );
  // Story 3-DM-D1 — cleared_allergies now lives under brief.payload.
  const childColorMap = useMemo(
    () => buildChildColorMap(childIdOrder, brief?.payload?.cleared_allergies ?? []),
    [childIdOrder, brief?.payload?.cleared_allergies],
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

  // 13-s10 (Task 5, W1) — wire the StickyBar. "Confirm the week" is a zero-LLM
  // chip-bypass commit; "Talk to Lumi" summons the sheet with week-level scope.
  const queryClient = useQueryClient();
  const commitMutation = usePlanEditMutation();
  const planId = data?.plan?.id ?? null;
  const weekConfirmed = (data?.plan?.confirmed_at ?? null) !== null;

  function handleConfirmWeek() {
    if (planId === null) return;
    commitMutation.mutate(
      { planId, body: { intent: { intent: 'commit', confidence: 1 } } },
      {
        onSuccess: () => {
          // Stamp confirmed_at immediately so the button reflects "Confirmed"
          // without waiting for the background refetch (prevents flash-back).
          const confirmedAt = new Date().toISOString();
          queryClient.setQueryData<GetPlansResponse>(
            QueryKeys.planByWeek(activeWeek),
            (prev) =>
              prev?.plan ? { ...prev, plan: { ...prev.plan, confirmed_at: confirmedAt } } : prev,
          );
          // Also invalidate so a disconnected tab (no SSE plan.updated) converges.
          void queryClient.invalidateQueries({ queryKey: ['plan'] });
        },
      },
    );
  }

  function handleTalkToLumi() {
    if (planId !== null && data?.week_of !== undefined) {
      useLumiStore.getState().setPlanEditScope({ planId, weekOf: data.week_of });
    }
    useLumiStore.getState().summon('text');
  }

  return (
    <main className="mx-auto w-full max-w-7xl flex-grow px-8 pb-28">
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

      {/* Actions — fixed StickyBottomBar (out of flow); pb-28 on <main> clears it.
          Placed before the footer in DOM so keyboard tab order matches visual order. */}
      <PlanActionBar
        onConfirm={planId !== null ? handleConfirmWeek : undefined}
        onTalkToLumi={handleTalkToLumi}
        confirmed={weekConfirmed}
        confirming={commitMutation.isPending}
      />

      {/* Footer */}
      <PlanPageFooter />
    </main>
  );
}

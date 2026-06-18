import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ClearedAllergyEntry,
  PlanTileSummary,
  ProposeSwapResponse,
  Weekday,
} from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { PageHeader } from '@/components/PageHeader.js';
import { PendingChildRequests } from '@/features/child-requests/PendingChildRequests.js';
import { AllergyClearedBadge } from './AllergyClearedBadge.js';
import {
  AllergyUncertaintyBanner,
  type AllergyUncertaintyFlaggedItem,
} from './AllergyUncertaintyBanner.js';
import { BriefWhyPanel } from './BriefWhyPanel.js';
import { LumiCallout } from './LumiCallout.js';
import { DisambiguationPicker } from './DisambiguationPicker.js';
import { FreshnessState } from './FreshnessState.js';
import { PlanActionSection } from './PlanActionSection.js';
import { PlanTile, type PlanTileState, type ChildDotColor, type ChildInfo } from './PlanTile.js';
import { PackerChip } from './PackerChip.js';
import { PresenceIndicator } from '@/features/thread/PresenceIndicator.js';
import { useLumiStore } from '@/stores/lumi.store.js';
import { QuietDiff } from './QuietDiff.js';
import { usePlanQuery } from './queries.js';
import { QueryKeys } from '@/lib/realtime/query-keys.js';
import { useBriefStateQuery } from './useBriefStateQuery.js';
import {
  useGenerateOnDemandMutation,
  useRequestRegenerationMutation,
  useUpdateSovereigntyModeMutation,
} from './mutations.js';
import { PrimaryButton } from '@/components/PrimaryButton.js';
import { SparkleIcon } from '@/components/icons.js';
import { adaptPlansResponse, type DayTreeView } from './tree-adapter.js';

const CHILD_COLORS: readonly ChildDotColor[] = ['foliage', 'lumi-terracotta'];

function DevTriggerButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  async function handleClick() {
    setStatus('loading');
    try {
      await hkFetch('/v1/dev/trigger-plan-generation', { method: 'POST' });
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={status === 'loading' || status === 'done'}
      className="text-xs text-fg-muted underline underline-offset-2 disabled:opacity-50"
    >
      {status === 'loading' && 'Triggering…'}
      {status === 'done' && 'Job queued — refresh in a moment'}
      {status === 'error' && 'Failed — check API logs'}
      {status === 'idle' && '[dev] Generate plan now'}
    </button>
  );
}

// Story 3-S34 — on-demand ("compose now") trigger. Shown in the empty state so
// a parent with no plan yet can compose immediately instead of waiting for the
// Friday auto-generation. The server derives the window (rest-of-this-week vs
// next-week-full) from the household timezone; on success we poll the brief
// until the plan lands (this branch unmounts when brief !== null).
function ComposeMyPlanButton() {
  const queryClient = useQueryClient();
  const generate = useGenerateOnDemandMutation();
  const [isComposing, setIsComposing] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!isComposing) return;
    let attempts = 0;
    const id = setInterval(() => {
      attempts += 1;
      // After ~2 min (24 × 5 s) the background job has likely failed.
      // Surface an error and restore the button so the parent can retry.
      if (attempts >= 24) {
        clearInterval(id);
        setIsComposing(false);
        setHasError(true);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['brief'] });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
    }, 5000);
    return () => clearInterval(id);
  }, [isComposing, queryClient]);

  if (isComposing) {
    return (
      <p className="text-sm text-fg-muted text-center" role="status">
        Lumi is composing your plan… this can take a minute.
      </p>
    );
  }

  function handleClick() {
    setHasError(false);
    // Capture the key once so React Query retries reuse it — a fresh UUID per
    // retry would defeat deduplication and consume extra rate-limit slots.
    const idempotencyKey = crypto.randomUUID();
    generate.mutate(idempotencyKey, {
      onSuccess: () => {
        setIsComposing(true);
        void queryClient.invalidateQueries({ queryKey: ['brief'] });
        void queryClient.invalidateQueries({ queryKey: ['plan'] });
      },
      onError: () => setHasError(true),
    });
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <PrimaryButton
        onClick={handleClick}
        disabled={generate.isPending}
        icon={<SparkleIcon />}
        ariaLabel="Compose my plan now"
      >
        {generate.isPending ? 'Starting…' : 'Compose my plan'}
      </PrimaryButton>
      {hasError && (
        <p className="text-xs text-clay-600" role="alert">
          Couldn&rsquo;t start composing. Please try again.
        </p>
      )}
    </div>
  );
}

// Slice 5-S3 — map each weekday name to this week's ISO date (Mon-anchored) so
// PackerChip can PATCH the right /days/:date/packer. Computed once per mount.
function getWeekDates(): Record<string, string> {
  const today = new Date();
  const dow = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  const offsets: Record<string, number> = {
    monday: 0,
    tuesday: 1,
    wednesday: 2,
    thursday: 3,
    friday: 4,
    saturday: 5,
  };
  return Object.fromEntries(
    Object.entries(offsets).map(([day, offset]) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + offset);
      // Use local-date components to avoid UTC rollover for UTC+ users.
      const yyyy = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return [day, `${yyyy}-${mo}-${dd}`];
    }),
  );
}

function buildChildColorMap(
  clearedAllergies: ClearedAllergyEntry[],
): ReadonlyMap<string, ChildInfo> {
  const map = new Map<string, ChildInfo>();
  let idx = 0;
  for (const entry of clearedAllergies) {
    if (!map.has(entry.child_id)) {
      map.set(entry.child_id, {
        name: entry.child_name,
        color: CHILD_COLORS[idx % CHILD_COLORS.length]!,
      });
      idx++;
    }
  }
  return map;
}

export function BriefCanvas() {
  // AC #3 — dev-mode runtime assertion guards against accidental out-of-scope
  // renders. AppLayout already calls useScope('app-scope'); this is a
  // belt-and-suspenders check that fires once after mount.
  useEffect(() => {
    if (import.meta.env.DEV) {
      if (!document.documentElement.classList.contains('app-scope')) {
        console.error(
          '[BriefCanvas] Scope violation: must only render within .app-scope',
        );
      }
    }
  }, []);

  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
  const queryClient = useQueryClient();
  // Slice 5-S3 — this week's date per weekday, for the PackerChip below each tile.
  const weekDates = useMemo(() => getWeekDates(), []);
  const { data, isLoading, isError, isStale, isFetching, error } = useBriefStateQuery(householdId);
  // Story pre-4-s3 — the plan endpoint carries compound-uncertain flagged_items
  // when the hard-fail audit row signals AllergyUncertaintyBanner is needed.
  // Gated on householdId so the query doesn't fire pre-auth.
  const { data: planData, isLoading: isPlanLoading } = usePlanQuery('current', { enabled: householdId !== null });
  const flaggedItemsRaw = planData?.flagged_items ?? [];
  // Story 3-DM-C1 Phase 9b part 4 step 4 — DisambiguationPicker now takes a
  // DayTreeView (the canonical tree slice for the active day). The brief
  // surface continues to render tiles from brief_state.plan_tile_summaries
  // (composer-fed; carries recipe display data), but the picker dispatches
  // against the raw tree so it can resolve plan_slot_id / variation_id /
  // main_assignment_id correctly. dayViewsByDay maps weekday → DayTreeView.
  const dayViewsByDay = useMemo(() => {
    const out = new Map<DayTreeView['day'], DayTreeView>();
    if (planData === undefined) return out;
    for (const view of adaptPlansResponse(planData).dayViews) {
      out.set(view.day, view);
    }
    return out;
  }, [planData]);
  // Story 3.12 — picker / swap-in-progress UI state.
  const [activeSwapDay, setActiveSwapDay] = useState<PlanTileSummary['day'] | null>(null);
  const [swappingItemId, setSwappingItemId] = useState<string | null>(null);
  // Slice 5-S12 — tracks an in-flight conversational swap proposal; the matching
  // tile pulses (sacred-plum) until Lumi resolves it. The day is captured here
  // (not via onSwapStarted, which only carries the id) so the right tile pulses.
  const [pendingProposal, setPendingProposal] = useState<{
    id: string;
    day: PlanTileSummary['day'];
  } | null>(null);
  const lastProposalRef = useRef<{ id: string; day: PlanTileSummary['day'] } | null>(null);
  // Slice 5-S9 — "Why this?" inline reasoning panel. One panel per canvas
  // (reasoning is household-level, not tile-specific), local + dismissable.
  const [showReasoning, setShowReasoning] = useState(false);
  // Story 3.13 — regenerating state. Stays true from POST 202 until the brief's
  // plan_revision increments, indicating the BullMQ job committed a new plan.
  const [isRegenerating, setIsRegenerating] = useState(false);
  const lastPlanRevisionRef = useRef<number | null>(null);
  const regenerateMutation = useRequestRegenerationMutation();
  // Story 3.29 — toggle for the degraded inline note.
  const sovereigntyMutation = useUpdateSovereigntyModeMutation();
  const [sovereigntyError, setSovereigntyError] = useState(false);
  // Capture the tile element that opened the picker so dismiss can return
  // focus to it (WCAG 2.4.3 Focus Order). The ref persists across rerenders
  // and is cleared on dismiss to avoid stale focus targets.
  const swapTriggerRef = useRef<HTMLElement | null>(null);
  const dismissPicker = () => {
    setActiveSwapDay(null);
    const trigger = swapTriggerRef.current;
    swapTriggerRef.current = null;
    trigger?.focus();
  };

  const brief = data?.brief ?? null;
  // Story 3-DM-D1 — the brief's tile_summaries / cleared_allergies /
  // scaffolding_diff / plan_state now live under brief.payload. Guard: hkFetch
  // returns raw JSON without Zod parsing, so payload (or a sub-field) may be
  // absent on a pre-migration cached response — default each to prevent a crash.
  const payload = brief?.payload;
  const clearedAllergies = payload?.cleared_allergies ?? [];
  const tileSummaries = payload?.tile_summaries ?? [];
  const scaffoldingDiff = payload?.scaffolding_diff ?? null;
  const planState = payload?.plan_state ?? null;
  const planStateMessage = payload?.plan_state_message ?? null;
  // Slice 5-S8 — "I noticed" learning-moment callout (null below threshold).
  const learningMomentCallout = payload?.learning_moment_callout ?? null;
  // Slice 5-S9 — "Why this?" plan reasoning (null when no plan has set it).
  const planReasoning = payload?.plan_reasoning ?? null;
  // Reset the panel whenever reasoning changes identity (new plan committed or
  // reasoning cleared) so a stale showReasoning=true cannot auto-reopen the panel.
  useEffect(() => { setShowReasoning(false); }, [planReasoning]);
  const childColorMap = useMemo(
    () => buildChildColorMap(clearedAllergies),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(clearedAllergies)],
  );

  // Story pre-4-s3 — map flagged_items (child_id only) to banner shape
  // (childName + childId). Resolve from cleared_allergies; fall back to a
  // generic label so the banner is still informative when no prior plan has
  // cleared (first-ever hard-fail, brief is null).
  const flaggedItems = useMemo<readonly AllergyUncertaintyFlaggedItem[]>(() => {
    if (flaggedItemsRaw.length === 0) return [];
    const nameById = new Map<string, string>();
    for (const entry of clearedAllergies) {
      if (!nameById.has(entry.child_id)) nameById.set(entry.child_id, entry.child_name);
    }
    return flaggedItemsRaw.map((item: typeof flaggedItemsRaw[number]) => ({
      childId: item.child_id,
      childName: nameById.get(item.child_id) ?? 'your child',
      ingredient: item.ingredient,
      slot: item.slot,
      day: item.day,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(flaggedItemsRaw), JSON.stringify(clearedAllergies)]);
  // brief.plan_id is null on pre-migration rows; swap UI requires it.
  const planId = brief?.plan_id ?? null;
  const canSwap = planId !== null;
  // isError covers initial load failures (no data); error !== null also catches
  // background refetch failures where TanStack keeps the cached data but sets error.
  const hasFetchError = isError || error !== null;
  const freshnessVariant = hasFetchError
    ? 'failed'
    : isRegenerating
      ? 'loading'
      : isFetching && isStale
        ? 'stale'
        : 'fresh';

  // Story 3.13 — while regenerating, poll the brief every 5s. SSE plan.updated
  // is deferred to Story 5.2; this short-poll fills the gap.
  useEffect(() => {
    if (!isRegenerating) return;
    const interval = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ['brief'] });
    }, 5000);
    return () => clearInterval(interval);
  }, [isRegenerating, queryClient]);

  // Story 3.13 — detect plan_revision bump to stop polling. The first time the
  // brief loads, capture the baseline; any subsequent increase clears the flag.
  useEffect(() => {
    if (!brief) return;
    if (lastPlanRevisionRef.current === null) {
      lastPlanRevisionRef.current = brief.plan_revision;
      return;
    }
    if (brief.plan_revision > lastPlanRevisionRef.current) {
      lastPlanRevisionRef.current = brief.plan_revision;
      setIsRegenerating(false);
    }
  }, [brief]);

  function handleToggleAlternatingSovereignty() {
    if (!householdId || sovereigntyMutation.isPending) return;
    setSovereigntyError(false);
    sovereigntyMutation.mutate(
      { householdId, input: { sovereignty_mode: 'alternating' }, idempotencyKey: crypto.randomUUID() },
      {
        onSuccess: () => {
          if (brief) {
            lastPlanRevisionRef.current = brief.plan_revision;
          }
          setIsRegenerating(true);
        },
        onError: (err) => {
          console.error('sovereignty mode toggle failed', err);
          setSovereigntyError(true);
        },
      },
    );
  }

  function handleRegenerate(scope: 'week' | 'day', day?: string) {
    if (!planId || isRegenerating) return;
    regenerateMutation.mutate(
      { planId, scope, day },
      {
        onSuccess: () => {
          if (brief) {
            lastPlanRevisionRef.current = brief.plan_revision;
          }
          setIsRegenerating(true);
        },
        onError: (err) => {
          console.error('regeneration failed', err);
        },
      },
    );
  }

  // Slice 5-S12 — capture the parent's free-text swap intent as a proposal turn
  // in the family thread. Returns the proposal_id so the picker can fire
  // onSwapStarted; the day is stashed in lastProposalRef so onSwapStarted knows
  // this id is a proposal (pulse the tile) rather than a variation (spinner).
  async function handleProposeSwap(day: Weekday, content: string): Promise<string> {
    if (planId === null) throw new Error('No plan');
    const res = await hkFetch<ProposeSwapResponse>(
      `/v1/plans/${planId}/swap-proposals`,
      {
        method: 'POST',
        body: { day, content },
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      },
    );
    lastProposalRef.current = { id: res.proposal_id, day };
    return res.proposal_id;
  }

  // Story pre-4-s3 — banner-driven recovery. In hard-fail state planId is null
  // (no plan committed); fall back to invalidating plan + brief queries so the
  // UI picks up backend recovery on the next poll cycle.
  function handleBannerRetry() {
    if (planId) {
      handleRegenerate('week');
    } else {
      void queryClient.invalidateQueries({ queryKey: QueryKeys.planByWeek('current') });
      void queryClient.invalidateQueries({ queryKey: ['brief'] });
    }
  }

  if (isLoading && brief === null) {
    return (
      <main className="mx-auto w-full max-w-7xl flex-grow px-6 pt-12 pb-24">
        <div
          className="animate-pulse flex flex-col gap-6"
          aria-busy="true"
          aria-label="Loading plan"
        >
          <div className="h-3 w-1/3 bg-surface rounded" />
          <div className="h-12 w-2/3 bg-surface rounded" />
          <div className="h-5 w-1/2 bg-surface/60 rounded" />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-32 bg-surface rounded-lg" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  // Story pre-4-s3 — when brief is null because the first-ever plan hard-failed
  // with compound-uncertain ingredients, surface the banner instead of the
  // "preparing your first plan" empty state. flaggedItems guarantees the
  // hard-fail signal carries actionable recovery info.
  if (!isLoading && !isPlanLoading && brief === null && !isError && flaggedItems.length > 0) {
    return (
      <main className="mx-auto w-full max-w-7xl flex-grow px-6 pt-12 pb-24">
        <AllergyUncertaintyBanner
          flaggedItems={flaggedItems}
          onRetry={handleBannerRetry}
        />
      </main>
    );
  }

  if (!isLoading && brief === null && !isError) {
    return (
      <main className="mx-auto w-full max-w-7xl flex-grow flex items-center justify-center px-6 pt-12 pb-24">
        <div className="flex flex-col items-center gap-4">
          <p className="max-w-sm text-base text-fg-muted text-center">
            Lumi is preparing your first plan. Check back Sunday evening.
          </p>
          <ComposeMyPlanButton />
          {import.meta.env.DEV && <DevTriggerButton />}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl flex-grow px-6 pt-12 pb-24">
      {/* Story 5-S1 — multi-tab presence; self-hides when no partner is on Brief. */}
      <div className="mb-2 flex justify-end">
        <PresenceIndicator surface={{ kind: 'brief', id: householdId ?? '' }} />
      </div>
      {/* Story pre-4-s3 — compound-uncertain hard-fail surface; banner self-hides on empty. */}
      {flaggedItems.length > 0 && (
        <div className="mb-6">
          <AllergyUncertaintyBanner
            flaggedItems={flaggedItems}
            onRetry={handleBannerRetry}
          />
        </div>
      )}
      {brief !== null && (
        <>
          {clearedAllergies.length > 0 && (
            <div
              className="mb-6 flex flex-wrap gap-2"
              aria-label="Allergy clearances"
            >
              {clearedAllergies.map((entry) => (
                <AllergyClearedBadge
                  key={`${entry.child_id}-${entry.allergen}`}
                  childName={entry.child_name}
                  allergen={entry.allergen}
                  auditUrl={`/plans/by-week/${brief.household_id}/audit`}
                  isRechecking={isFetching && isStale}
                />
              ))}
            </div>
          )}

          {scaffoldingDiff !== null && (
            <div className="mb-6">
              <QuietDiff
                summary={scaffoldingDiff.summary}
                explanation={scaffoldingDiff.explanation}
              />
            </div>
          )}

          {planState === 'degraded' && planStateMessage !== null && planStateMessage !== '' && (
            <div
              className="mb-6 rounded-lg border border-foliage-200 bg-foliage-50 px-4 py-3 flex flex-col gap-2"
              role="region"
              aria-label="Cultural intersection notice"
            >
              <p className="font-sans text-[14px] text-foliage-800 leading-relaxed">
                {planStateMessage}
              </p>
              <button
                type="button"
                onClick={handleToggleAlternatingSovereignty}
                disabled={sovereigntyMutation.isPending || isRegenerating}
                className="self-start rounded-full border border-foliage-400 px-3 py-1 font-sans text-[13px] text-foliage-800 hover:bg-foliage-100 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foliage-400 disabled:opacity-50"
                aria-label="Switch to alternating sovereignty mode"
              >
                {sovereigntyMutation.isPending ? 'Switching…' : 'Try alternating'}
              </button>
              {sovereigntyError && (
                <p className="font-sans text-[12px] text-clay-600">
                  Something went wrong. Please try again.
                </p>
              )}
            </div>
          )}

          <PageHeader
            eyebrow="This week's brief"
            headlineSize="lg"
            description={brief.lumi_note !== '' ? brief.lumi_note : undefined}
            className="mb-12"
          >
            {brief.moment_headline !== '' ? brief.moment_headline : 'Your week, ready'}
          </PageHeader>

          {/* Slice 4-S15 — pending child "request a lunch" suggestions. Renders
              nothing when there are none. */}
          {householdId !== null && <PendingChildRequests householdId={householdId} />}

          <div
            className={`grid grid-cols-2 ${tileSummaries.length <= 5 ? 'md:grid-cols-5' : 'md:grid-cols-6'} gap-4 mb-8`}
            aria-label="Weekly plan"
          >
            {tileSummaries.map((summary) => {
              const tileState: PlanTileState =
                summary.paused
                  ? 'paused'
                  : pendingProposal !== null && summary.day === pendingProposal.day
                    ? 'proposal-pending'
                    : summary.items.some((i) => i.plan_item_id === swappingItemId)
                      ? 'swap-in-progress'
                      : activeSwapDay === summary.day
                        ? 'pending-input'
                        : 'decided';

              return (
                <div key={summary.day} className="flex flex-col gap-2">
                  <PlanTile
                    summary={summary}
                    state={tileState}
                    childColorMap={childColorMap}
                    childRatings={summary.child_ratings}
                    onWhyThis={planReasoning ? () => setShowReasoning(true) : undefined}
                    onSwapIntent={
                      canSwap && !summary.paused && swappingItemId === null
                        ? () => {
                            if (document.activeElement instanceof HTMLElement) {
                              swapTriggerRef.current = document.activeElement;
                            }
                            setActiveSwapDay(summary.day);
                          }
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

          {/* Slice 5-S9 — "Why this?" reasoning panel. Inline (no modal/drawer);
              household-level so all tiles share it. Dismissed by ✕ only. */}
          {showReasoning && planReasoning !== null && (
            <div className="mt-4 rounded-xl border border-honey-amber-200 bg-honey-amber-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="mb-1 text-xs font-medium text-honey-amber-700">Lumi&rsquo;s thinking</p>
                  <p className="font-serif text-sm leading-relaxed text-fg">{planReasoning}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowReasoning(false)}
                  aria-label="Close reasoning"
                  className="mt-0.5 shrink-0 text-xs text-honey-amber-500 hover:text-honey-amber-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-warm"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {activeSwapDay !== null && planId !== null && (() => {
            const activeDayView = dayViewsByDay.get(activeSwapDay);
            if (activeDayView === undefined) return null;
            const childNames: Record<string, string> = {};
            for (const entry of clearedAllergies) {
              if (!(entry.child_id in childNames)) {
                childNames[entry.child_id] = entry.child_name;
              }
            }
            return (
              <DisambiguationPicker
                planId={planId}
                day={activeSwapDay}
                dayView={activeDayView}
                clearedAllergens={clearedAllergies.map((e) => ({
                  child_id: e.child_id,
                  allergen: e.allergen,
                }))}
                childNames={childNames}
                onDismiss={dismissPicker}
                onProposeSwap={canSwap ? handleProposeSwap : undefined}
                onSwapStarted={(id) => {
                  // 5-S12 — a proposal flow returns a proposal_id (tracked in
                  // lastProposalRef). It pulses the matching tile but must NOT
                  // set swappingItemId, which would lock the rest of the canvas.
                  if (lastProposalRef.current?.id === id) {
                    setPendingProposal(lastProposalRef.current);
                    lastProposalRef.current = null;
                    swapTriggerRef.current = null;
                    setActiveSwapDay(null);
                    return;
                  }
                  setSwappingItemId(id);
                  swapTriggerRef.current = null;
                  setActiveSwapDay(null);
                }}
                onSwapSettled={() => setSwappingItemId(null)}
                onRegenDay={
                  canSwap && !isRegenerating
                    ? (day) => {
                        dismissPicker();
                        handleRegenerate('day', day);
                      }
                    : undefined
                }
              />
            );
          })()}

          {canSwap && !isRegenerating && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => handleRegenerate('week')}
                disabled={regenerateMutation.isPending}
                className="text-xs text-fg-muted hover:text-amber-warm underline underline-offset-2 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-warm disabled:opacity-50"
              >
                {regenerateMutation.isPending ? 'Queueing…' : 'Ask Lumi to try again'}
              </button>
            </div>
          )}

          {isRegenerating && (
            <p className="mt-4 text-center text-[13px] text-fg-muted">
              Lumi is rethinking this week&rsquo;s plan&hellip;
            </p>
          )}

          <div className="mt-4 mb-10">
            <FreshnessState
              variant={freshnessVariant}
              lastSyncedAt={brief.updated_at}
            />
          </div>

          {learningMomentCallout !== null && (
            <LumiCallout
              callout={learningMomentCallout}
              householdId={brief.household_id}
              onTellMore={() => useLumiStore.getState().openPanel()}
            />
          )}

          <BriefWhyPanel brief={brief} />

          <PlanActionSection
            onSwapDay={
              canSwap && tileSummaries.length > 0
                ? () => {
                    const firstUnpaused = tileSummaries.find((s) => !s.paused);
                    if (firstUnpaused) setActiveSwapDay(firstUnpaused.day);
                  }
                : undefined
            }
          />
        </>
      )}

      {hasFetchError && brief === null && (
        <div className="mt-12">
          <FreshnessState variant="failed" />
        </div>
      )}
    </main>
  );
}

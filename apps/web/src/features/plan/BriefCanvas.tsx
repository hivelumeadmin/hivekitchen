import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChildResponse, ClearedAllergyEntry, PlanTileSummary } from '@hivekitchen/types';
import { useAuthStore } from '@/stores/auth.store.js';
import { useComplianceStore } from '@/stores/compliance.store.js';
import { PageHeader } from '@/components/PageHeader.js';
import { AddChildForm } from '@/features/children/AddChildForm.js';
import { BagCompositionCard } from '@/features/children/BagCompositionCard.js';
import { AllergyClearedBadge } from './AllergyClearedBadge.js';
import {
  AllergyUncertaintyBanner,
  type AllergyUncertaintyFlaggedItem,
} from './AllergyUncertaintyBanner.js';
import { BriefWhyPanel } from './BriefWhyPanel.js';
import { DisambiguationPicker } from './DisambiguationPicker.js';
import { FreshnessState } from './FreshnessState.js';
import { PlanActionSection } from './PlanActionSection.js';
import { PlanTile, type PlanTileState, type ChildDotColor, type ChildInfo } from './PlanTile.js';
import { QuietDiff } from './QuietDiff.js';
import { usePlanQuery } from './queries.js';
import { QueryKeys } from '@/lib/realtime/query-keys.js';
import { useBriefStateQuery } from './useBriefStateQuery.js';
import {
  useRequestRegenerationMutation,
  useUpdateSovereigntyModeMutation,
} from './mutations.js';
import { adaptPlansResponse, type DayTreeView } from './tree-adapter.js';

const CHILD_COLORS: readonly ChildDotColor[] = ['foliage', 'lumi-terracotta'];

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
  const [showAddChild, setShowAddChild] = useState(false);
  const [addedChild, setAddedChild] = useState<ChildResponse | null>(null);
  const [savedChildren, setSavedChildren] = useState<ChildResponse[]>([]);
  // Story 3.12 — picker / swap-in-progress UI state.
  const [activeSwapDay, setActiveSwapDay] = useState<PlanTileSummary['day'] | null>(null);
  const [swappingItemId, setSwappingItemId] = useState<string | null>(null);
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
        {showAddChild && addedChild === null ? (
          <AddChildForm
            householdId={householdId ?? ''}
            onSuccess={(child) => setAddedChild(child)}
            onCancel={() => setShowAddChild(false)}
            onParentalNoticeRequired={() => {
              useComplianceStore.getState().setAcknowledgmentState(null, null);
            }}
          />
        ) : showAddChild && addedChild !== null ? (
          <BagCompositionCard
            childId={addedChild.id}
            childName={addedChild.name}
            onSaved={(savedChild) => {
              setSavedChildren((prev) => [...prev, savedChild]);
              setAddedChild(null);
              setShowAddChild(false);
            }}
            onSkip={() => {
              setSavedChildren((prev) => addedChild ? [...prev, addedChild] : prev);
              setAddedChild(null);
              setShowAddChild(false);
            }}
          />
        ) : (
          <div className="flex flex-col items-center gap-6">
            {savedChildren.length > 0 && (
              <ul className="w-full max-w-sm space-y-2">
                {savedChildren.map((child) => (
                  <li key={child.id} className="text-sm text-fg-muted">
                    {child.name} — {child.age_band}
                  </li>
                ))}
              </ul>
            )}
            <div className="text-center">
              <p className="max-w-sm text-base text-fg-muted">
                Lumi is preparing your first plan. Check back Sunday evening.
              </p>
              <button
                type="button"
                onClick={() => setShowAddChild(true)}
                className="mt-3 text-sm text-amber-warm underline underline-offset-2 hover:text-amber transition-colors motion-reduce:transition-none"
              >
                Add your first child
              </button>
            </div>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl flex-grow px-6 pt-12 pb-24">
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

          <div
            className={`grid grid-cols-2 ${tileSummaries.length <= 5 ? 'md:grid-cols-5' : 'md:grid-cols-6'} gap-4 mb-8`}
            aria-label="Weekly plan"
          >
            {tileSummaries.map((summary) => {
              const tileState: PlanTileState =
                summary.paused
                  ? 'paused'
                  : summary.items.some((i) => i.plan_item_id === swappingItemId)
                    ? 'swap-in-progress'
                    : activeSwapDay === summary.day
                      ? 'pending-input'
                      : 'decided';

              return (
                <PlanTile
                  key={summary.day}
                  summary={summary}
                  state={tileState}
                  childColorMap={childColorMap}
                  childRatings={summary.child_ratings}
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
              );
            })}
          </div>

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
                onSwapStarted={(variationId) => {
                  setSwappingItemId(variationId);
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

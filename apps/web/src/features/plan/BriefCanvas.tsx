import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChildResponse, PlanTileSummary } from '@hivekitchen/types';
import { useAuthStore } from '@/stores/auth.store.js';
import { useComplianceStore } from '@/stores/compliance.store.js';
import { PageHeader } from '@/components/PageHeader.js';
import { AddChildForm } from '@/features/children/AddChildForm.js';
import { BagCompositionCard } from '@/features/children/BagCompositionCard.js';
import { AllergyClearedBadge } from './AllergyClearedBadge.js';
import { DisambiguationPicker } from './DisambiguationPicker.js';
import { FreshnessState } from './FreshnessState.js';
import { PlanTile, type PlanTileState } from './PlanTile.js';
import { QuietDiff } from './QuietDiff.js';
import { useBriefStateQuery } from './useBriefStateQuery.js';
import { useRequestRegenerationMutation } from './mutations.js';

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
  // Guard: hkFetch returns raw JSON without Zod parsing; cleared_allergies may be
  // absent on a pre-migration cached response. Default to [] to prevent .length crash.
  const clearedAllergies = brief?.cleared_allergies ?? [];
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

          {brief.scaffolding_diff?.summary !== null && brief.scaffolding_diff?.summary !== undefined && (
            <div className="mb-6">
              <QuietDiff
                summary={brief.scaffolding_diff.summary}
                explanation={brief.scaffolding_diff.explanation}
              />
            </div>
          )}

          {brief.moment_headline !== '' ? (
            <PageHeader
              eyebrow="This week's brief"
              headlineSize="lg"
              description={brief.lumi_note}
              className="mb-12"
            >
              {brief.moment_headline}
            </PageHeader>
          ) : (
            <h1 className="sr-only">Weekly plan</h1>
          )}

          <div
            className={`grid grid-cols-2 ${brief.plan_tile_summaries.length <= 5 ? 'md:grid-cols-5' : 'md:grid-cols-6'} gap-4 mb-8`}
            aria-label="Weekly plan"
          >
            {brief.plan_tile_summaries.map((summary) => {
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
            const activeSummary = brief.plan_tile_summaries.find(
              (s) => s.day === activeSwapDay,
            );
            if (!activeSummary) return null;
            return (
              <DisambiguationPicker
                planId={planId}
                day={activeSwapDay}
                items={activeSummary.items}
                clearedAllergens={clearedAllergies.map((e) => ({
                  child_id: e.child_id,
                  allergen: e.allergen,
                }))}
                onDismiss={dismissPicker}
                onSwapStarted={(itemId) => {
                  setSwappingItemId(itemId);
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

          <div className="mt-6">
            <FreshnessState
              variant={freshnessVariant}
              lastSyncedAt={brief.updated_at}
            />
          </div>
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

import { useEffect, useState } from 'react';
import type { PlanTileSummary } from '@hivekitchen/types';
import { PageHeader } from '@/components/PageHeader.js';
import { PendingChildRequests } from '@/features/child-requests/PendingChildRequests.js';
import { PresenceIndicator } from '@/features/thread/PresenceIndicator.js';
import { useLumiStore } from '@/stores/lumi.store.js';
import { AllergyClearedBadge } from '@hivekitchen/ui';
import { AllergyUncertaintyBanner } from './AllergyUncertaintyBanner.js';
import { BriefWhyPanel } from './BriefWhyPanel.js';
import { LumiCallout } from './LumiCallout.js';
import { DisambiguationPicker } from './DisambiguationPicker.js';
import { FreshnessState } from '@hivekitchen/ui';
import { PlanActionBar } from './PlanActionBar.js';
import { QuietDiff } from './QuietDiff.js';
import { WeekGrid } from './WeekGrid.js';
import { FULL_TO_SHORT, SHORT_DAY_LABEL, type BriefView } from './useBriefView.js';
import type { WeekSwap } from './useWeekSwap.js';
import type { ComposeLifecycle } from './useComposeLifecycle.js';

// Story 14-s2 — the populated Brief canvas, extracted from BriefCanvas's path-4
// render. Receives the three hook objects from the composition root; owns only
// the canvas-local glue (freshnessVariant, the "Why this?" panel toggle,
// summonForDay / handleTalkToLumi). Story 14-s3 then elevated the hero (the
// freshness line closes it, after the Lumi note) and swapped the tile grid for
// the WeekGrid day-row itinerary.
export function BriefContent({
  householdId,
  view,
  swap,
  lifecycle,
}: {
  householdId: string | null;
  view: BriefView;
  swap: WeekSwap;
  lifecycle: ComposeLifecycle;
}) {
  const {
    brief,
    isFetching,
    isStale,
    hasFetchError,
    planData,
    weekDates,
    clearedAllergies,
    tileSummaries,
    scaffoldingDiff,
    planState,
    planStateMessage,
    learningMomentCallout,
    planReasoning,
    childColorMap,
    flaggedItems,
    planId,
    canSwap,
    weekConfirmed,
    childRoster,
    editableDays,
    dayViewsByDay,
  } = view;
  const {
    activeSwapDay,
    setActiveSwapDay,
    swappingItemId,
    pendingProposal,
    dismissPicker,
    handleProposeSwap,
    onSwapStarted,
    onSwapSettled,
  } = swap;
  const {
    isRegenerating,
    sovereigntyError,
    handleRegenerate,
    handleToggleAlternatingSovereignty,
    handleConfirmWeek,
    handleBannerRetry,
    confirming,
    regeneratePending,
    sovereigntyPending,
  } = lifecycle;

  // Slice 5-S9 — "Why this?" inline reasoning panel. One panel per canvas
  // (reasoning is household-level, not tile-specific), local + dismissable.
  const [showReasoning, setShowReasoning] = useState(false);
  // Reset the panel whenever reasoning changes identity (new plan committed or
  // reasoning cleared) so a stale showReasoning=true cannot auto-reopen the panel.
  useEffect(() => {
    setShowReasoning(false);
  }, [planReasoning]);

  const freshnessVariant = hasFetchError
    ? 'failed'
    : isRegenerating
      ? 'loading'
      : isFetching && isStale
        ? 'stale'
        : 'fresh';

  function handleTalkToLumi() {
    if (planId !== null && planData?.week_of !== undefined) {
      useLumiStore.getState().setPlanEditScope({ planId, weekOf: planData.week_of });
    }
    useLumiStore.getState().summon('text');
  }

  // 13-s10 (D1 review fix) — tile taps summon Lumi with day context, matching
  // PlanPage. childRoster + editableDays come from the view-model.
  function summonForDay(summary: PlanTileSummary) {
    if (planId === null || planData?.week_of === undefined) return;
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
      weekOf: planData.week_of,
      day: short,
      dayLabel: SHORT_DAY_LABEL[short],
      dishes,
      days: editableDays,
      children: childRoster,
    });
    useLumiStore.getState().summon('text');
  }

  return (
    <main className="mx-auto w-full max-w-7xl flex-grow px-6 pt-12 pb-28">
      {/* Story 5-S1 — multi-tab presence; self-hides when no partner is on Brief. */}
      <div className="mb-2 flex justify-end">
        <PresenceIndicator surface={{ kind: 'brief', id: householdId ?? '' }} />
      </div>
      {/* Story pre-4-s3 — compound-uncertain hard-fail surface; banner self-hides on empty. */}
      {flaggedItems.length > 0 && (
        <div className="mb-6">
          <AllergyUncertaintyBanner flaggedItems={flaggedItems} onRetry={handleBannerRetry} />
        </div>
      )}
      {brief !== null && (
        <>
          {clearedAllergies.length > 0 && (
            <div className="mb-6 flex flex-wrap gap-2" aria-label="Allergy clearances">
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
              <QuietDiff summary={scaffoldingDiff.summary} explanation={scaffoldingDiff.explanation} />
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
                disabled={sovereigntyPending || isRegenerating}
                className="self-start rounded-full border border-foliage-400 px-3 py-1 font-sans text-[13px] text-foliage-800 hover:bg-foliage-100 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foliage-400 disabled:opacity-50"
                aria-label="Switch to alternating sovereignty mode"
              >
                {sovereigntyPending ? 'Switching…' : 'Try alternating'}
              </button>
              {sovereigntyError && (
                <p className="font-sans text-[12px] text-clay-600">
                  Something went wrong. Please try again.
                </p>
              )}
            </div>
          )}

          <PageHeader eyebrow="This week's brief" headlineSize="lg" className="mb-6">
            {brief.moment_headline !== '' ? brief.moment_headline : 'Your week, ready'}
          </PageHeader>

          {/* Story 13-s4 — the lumi_note is the answer-in-Lumi's-voice with a
              woven-in visible-memory phrase. Terracotta "Lumi —" tag marks the
              voice channel (DESIGN.md LumiNote pattern); composer-templated, no
              chat turn. Renders nothing when the note is empty. */}
          {brief.lumi_note !== '' && (
            <p className="mb-2 max-w-2xl text-base leading-relaxed text-fg-muted">
              <span className="font-semibold text-lumi-terracotta">Lumi&nbsp;— </span>
              {brief.lumi_note}
            </p>
          )}

          {/* Story 14-s3 (AC2) — the freshness line closes the hero: the last
              thing the parent reads before the week itself is that what they are
              looking at is current. Silent when fresh (FreshnessState renders
              null), so a healthy week shows nothing here. */}
          <div className="mb-10">
            <FreshnessState variant={freshnessVariant} lastSyncedAt={brief.updated_at} />
          </div>

          {/* Slice 4-S15 — pending child "request a lunch" suggestions. Renders
              nothing when there are none. */}
          {householdId !== null && <PendingChildRequests householdId={householdId} />}

          <WeekGrid
            tileSummaries={tileSummaries}
            childColorMap={childColorMap}
            pendingProposal={pendingProposal}
            swappingItemId={swappingItemId}
            activeSwapDay={activeSwapDay}
            planReasoning={planReasoning}
            canSwap={canSwap}
            weekDates={weekDates}
            householdId={householdId}
            onWhyThis={() => setShowReasoning(true)}
            onSummonForDay={summonForDay}
          />

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
                onSwapStarted={onSwapStarted}
                onSwapSettled={onSwapSettled}
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
                disabled={regeneratePending}
                className="text-xs text-fg-muted hover:text-amber-warm underline underline-offset-2 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-warm disabled:opacity-50"
              >
                {regeneratePending ? 'Queueing…' : 'Ask Lumi to try again'}
              </button>
            </div>
          )}

          {isRegenerating && (
            <p className="mt-4 text-center text-[13px] text-fg-muted">
              Lumi is rethinking this week&rsquo;s plan&hellip;
            </p>
          )}

          {learningMomentCallout !== null && (
            <LumiCallout
              callout={learningMomentCallout}
              householdId={brief.household_id}
              onTellMore={() => useLumiStore.getState().summon()}
            />
          )}

          <BriefWhyPanel brief={brief} />

          <PlanActionBar
            onConfirm={planId !== null ? handleConfirmWeek : undefined}
            onTalkToLumi={handleTalkToLumi}
            confirmed={weekConfirmed}
            confirming={confirming}
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

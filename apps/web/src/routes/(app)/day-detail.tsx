import { useNavigate, useParams } from 'react-router-dom';
import { DetailHeader } from '@hivekitchen/ui';
import { useAuthStore } from '@/stores/auth.store.js';
import { useLumiStore } from '@/stores/lumi.store.js';
import {
  usePauseChildOnDayMutation,
  usePauseDayMutation,
} from '@/features/plan/mutations.js';
import { FULL_TO_SHORT, useBriefView } from '@/features/plan/useBriefView.js';
import { WallCardSwipeStack } from '@/features/day-detail/components/WallCardSwipeStack.js';
import { useDayView } from '@/features/day-detail/useDayView.js';
import type { DayPlan } from '@/features/day-detail/day-view-model.js';

const DAY_LABEL: Record<string, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
};

// Story 14-s4 — the shipped family-first day view. Replaces the mock-backed
// single-child spread: one shared Main per day, per-child variation chips, and
// a Prep/Finish activity toggle, all from live plan data. Day-detail leads with
// cooking (recipe + method); the why/source/nutrition cards are deliberately
// gone (day-detail-is-cooking-not-explanation).
export default function DayDetailRoute() {
  const { day } = useParams<{ day: string }>();
  const navigate = useNavigate();
  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
  const { week, isLoading, hasRecipeError, refetchRecipes, hasPlanError, retryPlan } =
    useDayView(householdId);
  const { planId, editableDays, childRoster, planData } = useBriefView(householdId);
  const pauseDay = usePauseDayMutation();
  const pauseChild = usePauseChildOnDayMutation();

  const currentLabel =
    day !== undefined && DAY_LABEL[day] !== undefined ? DAY_LABEL[day] : 'This week';

  function closeSheet() {
    void navigate('/app', { replace: true });
  }

  // Editing is summoned, never inline: the canvas hands the day's scope to Lumi
  // and recedes — the same path the Brief's day rows take.
  function summonSwap(target: DayPlan) {
    if (planId === null || planData?.week_of === undefined) return;
    const short = FULL_TO_SHORT[target.dayName];
    if (short === undefined) return;
    useLumiStore.getState().setPlanEditScope({
      planId,
      weekOf: planData.week_of,
      day: short,
      dayLabel: DAY_LABEL[target.dayName] ?? target.dayName,
      dishes: target.main.title !== '' ? [target.main.title] : [],
      days: editableDays,
      children: childRoster,
    });
    useLumiStore.getState().summon('text');
  }

  return (
    <>
      <DetailHeader contextLabel="This week" currentLabel={currentLabel} />
      <main className="mx-auto w-full max-w-7xl flex-grow px-6 pb-32 pt-10">
        {hasRecipeError && (
          <div
            role="alert"
            className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3"
          >
            <p className="font-sans text-[14px] text-fg">
              Lumi couldn&rsquo;t load the recipe for one of these days.
            </p>
            <button
              type="button"
              onClick={refetchRecipes}
              className="rounded-full border border-border px-3 py-1 font-sans text-[13px] text-fg-muted transition-colors motion-reduce:transition-none hover:border-lumi-terracotta-warmed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-warm"
            >
              Try again
            </button>
          </div>
        )}

        {(pauseDay.isError || pauseChild.isError) && (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-border bg-surface px-4 py-3"
          >
            <p className="font-sans text-[14px] text-fg">
              That pause didn&rsquo;t save — check your connection and try again.
            </p>
          </div>
        )}

        {isLoading && week === null ? (
          <p role="status" className="py-16 text-center text-[15px] text-fg-muted">
            Lumi is pulling up this week&rsquo;s cooking&hellip;
          </p>
        ) : hasPlanError && (week === null || week.days.length === 0) ? (
          // A failed plan fetch is NOT an empty week — say so, offer retry.
          <div role="alert" className="py-16 text-center">
            <p className="text-[15px] text-fg-muted">
              Lumi couldn&rsquo;t load this week&rsquo;s plan.
            </p>
            <button
              type="button"
              onClick={retryPlan}
              className="mt-4 rounded-full border border-border px-4 py-1.5 font-sans text-[13px] text-fg-muted transition-colors motion-reduce:transition-none hover:border-lumi-terracotta-warmed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-warm"
            >
              Try again
            </button>
          </div>
        ) : week === null || week.days.length === 0 ? (
          <p className="py-16 text-center text-[15px] text-fg-muted">
            There&rsquo;s nothing planned for this week yet.
          </p>
        ) : (
          <WallCardSwipeStack
            week={week}
            {...(day !== undefined ? { initialDay: day } : {})}
            actions={{
              onSwapMain: planId !== null ? summonSwap : undefined,
              onPauseDay:
                planId !== null
                  ? (target) => {
                      pauseDay.mutate({
                        planId,
                        day: target.dayName,
                        // No reason picker yet — 'other' is the only honest
                        // fixed value (the hint promises sick/snow/holiday and
                        // the data must not claim one it doesn't know).
                        reason: 'other',
                      });
                    }
                  : undefined,
              onPauseChild:
                planId !== null
                  ? (target, childId) => {
                      pauseChild.mutate({
                        planId,
                        day: target.dayName,
                        childId,
                      });
                    }
                  : undefined,
              onChangeMyMind: closeSheet,
              pausePending: pauseDay.isPending || pauseChild.isPending,
            }}
          />
        )}
      </main>
    </>
  );
}

import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth.store.js';
import { useBriefView } from './useBriefView.js';
import { useWeekSwap } from './useWeekSwap.js';
import { useComposeLifecycle } from './useComposeLifecycle.js';
import { BriefSkeleton } from './BriefSkeleton.js';
import { BriefHardFail } from './BriefHardFail.js';
import { BriefEmptyState } from './BriefEmptyState.js';
import { BriefContent } from './BriefContent.js';

// Story 14-s2 — the Brief composition root. All plumbing lives in the three hooks
// (14-s1); each render state lives in its own presentational component. This
// component only wires them together and dispatches to the right branch.
export function BriefCanvas() {
  // AC #3 — dev-mode runtime assertion guards against accidental out-of-scope
  // renders. AppLayout already calls useScope('app-scope'); this is a
  // belt-and-suspenders check that fires once after mount.
  useEffect(() => {
    if (import.meta.env.DEV) {
      if (!document.documentElement.classList.contains('app-scope')) {
        console.error('[BriefCanvas] Scope violation: must only render within .app-scope');
      }
    }
  }, []);

  const householdId = useAuthStore((s) => s.user?.current_household_id ?? null);
  const view = useBriefView(householdId);
  const swap = useWeekSwap(view.planId);
  const lifecycle = useComposeLifecycle({ householdId, planId: view.planId, brief: view.brief });

  if (view.isLoading && view.brief === null) {
    return <BriefSkeleton />;
  }

  // Story pre-4-s3 — first-ever plan hard-failed on compound-uncertain
  // ingredients: surface the banner instead of the "preparing your first plan"
  // empty state.
  //
  // Gate is `hardFail`, NOT `flaggedItems.length`. Only compound-uncertain
  // rejections carry flags; infrastructure-uncertain verdicts, `blocked`
  // verdicts and planner retry exhaustion hard-fail with none. Gating on flags
  // meant every one of those weeks silently rendered "Lumi is preparing your
  // first plan. Check back Sunday evening." forever. BriefHardFail carries its
  // own no-flags branch, so an empty array is a valid, handled input here.
  if (
    !view.isLoading &&
    !view.isPlanLoading &&
    view.brief === null &&
    !view.isError &&
    view.hardFail !== null
  ) {
    return <BriefHardFail flaggedItems={view.flaggedItems} onRetry={lifecycle.handleBannerRetry} />;
  }

  if (!view.isLoading && view.brief === null && !view.isError) {
    return <BriefEmptyState />;
  }

  // Populated canvas — also the fall-through for `brief === null && isError`
  // (renders presence + optional banner + a failed FreshnessState).
  return <BriefContent householdId={householdId} view={view} swap={swap} lifecycle={lifecycle} />;
}

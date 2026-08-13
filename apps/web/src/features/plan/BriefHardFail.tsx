import {
  AllergyUncertaintyBanner,
  type AllergyUncertaintyFlaggedItem,
} from './AllergyUncertaintyBanner.js';

// Story 14-s2 — the Brief's full-page hard-fail branch, extracted verbatim.
// Story pre-4-s3 — when brief is null because the first-ever plan hard-failed
// with compound-uncertain ingredients, surface the banner instead of the
// "preparing your first plan" empty state. flaggedItems guarantees the hard-fail
// signal carries actionable recovery info.
export function BriefHardFail({
  flaggedItems,
  onRetry,
}: {
  flaggedItems: readonly AllergyUncertaintyFlaggedItem[];
  onRetry: () => void;
}) {
  // A hard-fail without flags is the common case, not an edge case: only
  // compound-uncertain rejections carry them. AllergyUncertaintyBanner returns
  // null on an empty array, so rendering it unconditionally would produce a
  // blank page for those weeks — the same silent dead end this branch exists to
  // remove, just relocated. State the outcome plainly and keep the one action.
  //
  // Deliberately NOT AllergyUncertaintyBanner: its own header reserves that
  // component for compound-ingredient uncertainty and forbids promoting it to
  // the generic role. Its amber posture also reads as "awaiting your decision",
  // which is wrong here — nothing was scheduled. clay-600 is this surface's
  // established failure register (BriefContent, BriefEmptyState).
  if (flaggedItems.length === 0) {
    return (
      <main className="mx-auto w-full max-w-7xl flex-grow flex items-center justify-center px-6 pt-12 pb-24">
        <div className="flex flex-col items-center gap-4">
          <p className="max-w-sm text-center text-base text-fg-default" role="alert">
            Lumi couldn&rsquo;t build this week&rsquo;s plan.
          </p>
          <p className="max-w-sm text-center text-sm text-clay-600">
            Nothing was scheduled, so there&rsquo;s nothing to review yet.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full bg-honey-amber-600 px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey-amber-400 focus-visible:ring-offset-1"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl flex-grow px-6 pt-12 pb-24">
      <AllergyUncertaintyBanner flaggedItems={flaggedItems} onRetry={onRetry} />
    </main>
  );
}

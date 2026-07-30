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
  return (
    <main className="mx-auto w-full max-w-7xl flex-grow px-6 pt-12 pb-24">
      <AllergyUncertaintyBanner flaggedItems={flaggedItems} onRetry={onRetry} />
    </main>
  );
}

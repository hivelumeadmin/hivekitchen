// Story 3.24 — surfaces unresolved compound-ingredient uncertainty on the plan
// view. Renders only when the backend signals that all guardrail retries were
// exhausted on `reason: 'compound_ingredient_unverified'` rejections — at that
// point we cannot ship the plan as-is and the parent owns the resolution.
//
// Visual posture: amber/honey, not red. This is a safety flag awaiting a
// decision, not a hard failure. Mirrors the warm-neutral palette and inline
// disclosure pattern of AllergyClearedBadge so it reads as part of the same
// safety layer of the plan surface.
//
// Architectural note: this banner is the plan-view-specific manifestation of
// the `/errors/allergy-uncertainty` domain named in the architecture spec.
// A generic AccountableError surface will be authored in a later story; do not
// promote this component to that role.

export interface AllergyUncertaintyFlaggedItem {
  ingredient: string;
  slot: string;
  day: string;
  childName: string;
  childId: string;
}

export interface AllergyUncertaintyBannerProps {
  flaggedItems: readonly AllergyUncertaintyFlaggedItem[];
  onRetry: () => void;
  onSwapSlot?: (childId: string, day: string, slot: string) => void;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

export function AllergyUncertaintyBanner({
  flaggedItems,
  onRetry,
  onSwapSlot = undefined,
}: AllergyUncertaintyBannerProps) {
  if (flaggedItems.length === 0) return null;

  const headline =
    flaggedItems.length === 1
      ? 'Lumi needs your help with one ingredient'
      : `Lumi needs your help with ${String(flaggedItems.length)} ingredients`;

  return (
    <section
      role="status"
      aria-live="polite"
      className="rounded-2xl border border-honey-amber-200 bg-honey-amber-50 p-5 font-sans text-fg-default"
    >
      <h2 className="font-serif text-lg font-medium text-honey-amber-800">
        {headline}
      </h2>
      <p className="mt-2 text-sm leading-[1.5] text-honey-amber-700">
        Some items contain compound products — sauces, spice blends, or pastes —
        whose ingredients Lumi can&apos;t fully verify against your declared
        allergies. We won&apos;t ship the plan until you decide.
      </p>

      <ul className="mt-4 space-y-2">
        {flaggedItems.map((item, idx) => (
          <li
            key={`${item.childName}|${item.day}|${item.slot}|${item.ingredient}|${String(idx)}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-honey-amber-100 bg-surface px-3 py-2"
          >
            <div className="text-sm leading-[1.5]">
              <span className="font-medium text-fg-default">{item.ingredient}</span>
              <span className="text-fg-muted">
                {' — '}
                {item.childName}, {capitalize(item.day)} {item.slot}
              </span>
            </div>
            {onSwapSlot !== undefined && (
              <button
                type="button"
                onClick={() => { onSwapSlot(item.childId, item.day, item.slot); }}
                className="rounded-full border border-honey-amber-300 bg-honey-amber-100 px-3 py-1 text-xs font-medium text-honey-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey-amber-400 focus-visible:ring-offset-1"
              >
                Swap {capitalize(item.slot)}
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full bg-honey-amber-600 px-4 py-2 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey-amber-400 focus-visible:ring-offset-1"
        >
          Try again
        </button>
        {onSwapSlot !== undefined && (
          <span className="text-xs text-fg-muted">
            Or swap each item individually above.
          </span>
        )}
      </div>
    </section>
  );
}

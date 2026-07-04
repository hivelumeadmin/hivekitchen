import { useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PlanSwapSummaryTree } from '@hivekitchen/types';

export interface SwapHistoryPopoverProps {
  swaps: ReadonlyArray<PlanSwapSummaryTree>;
  // Optional child_id → display name map. When absent, falls back to a
  // stable per-popover label ("Child A", "Child B", …) so multi-child swaps
  // are still visually attributable even before a roster query is wired in.
  childLabels?: Readonly<Record<string, string>>;
}

// Story 3.15 — per-day swap audit affordance for the historical plan view.
// Story 3-DM-C1 Phase 9b part 4 step 4 — input shape migrated from the flat
// `PlanItemSwapSummary` (slot + previous_ingredients per row) to the canonical
// tree shape `PlanSwapSummaryTree` (kind/child/day/slot_kind/at). swap_history
// is empty by design until the audit-derived population slice lands; this
// component renders an empty list cleanly until then.
//
// Mirrors the AllergyClearedBadge inline-disclosure pattern (no Radix dep):
// button trigger + sibling region, Escape closes and restores focus to the
// trigger. role="region" (not "dialog") because the panel is non-modal — no
// focus trap, no scroll lock, no backdrop.
const KIND_LABEL: Record<PlanSwapSummaryTree['kind'], string> = {
  main_swap: 'Main swap',
  slot_recipe_swap: 'Slot recipe swap',
  variation_edit: 'Variation edit',
};

function formatAt(at: string): string {
  // Render '2026-05-19T13:00:00+00:00' as 'May 19'. Keep concise — the popover
  // is a glance, not an audit page.
  return new Date(at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function SwapHistoryPopover({ swaps, childLabels }: SwapHistoryPopoverProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const regionId = useId();
  const labelId = useId();

  function handleKeyDown(e: ReactKeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  // Group swaps by child_id so multi-child days render as labeled clusters.
  // Order is first-appearance to keep the display deterministic. child_id
  // may be null on plan-level main_swap events; those collapse into a
  // single "Family" bucket.
  const grouped = useMemo(() => {
    const order: Array<string | null> = [];
    const buckets = new Map<string | null, PlanSwapSummaryTree[]>();
    for (const swap of swaps) {
      const key = swap.child_id;
      let bucket = buckets.get(key);
      if (bucket === undefined) {
        bucket = [];
        buckets.set(key, bucket);
        order.push(key);
      }
      bucket.push(swap);
    }
    return order.map((childId, index) => ({
      childId,
      label:
        childId === null
          ? 'Family'
          : (childLabels?.[childId] ?? `Child ${String.fromCharCode(65 + index)}`),
      swaps: buckets.get(childId)!,
    }));
  }, [swaps, childLabels]);

  const count = swaps.length;
  const label = `${count} swap${count === 1 ? '' : 's'}`;
  const showChildHeadings = grouped.length > 1;

  return (
    <span className="absolute top-2 end-2 inline-block">
      <button
        ref={triggerRef}
        id={labelId}
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        aria-label={`View ${label} for this day`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        onKeyDown={handleKeyDown}
        className="font-sans text-[11px] text-stone-500 underline underline-offset-2 hover:text-stone-700 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400 cursor-pointer pointer-events-auto"
      >
        {label}
      </button>
      {open && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape-to-dismiss on the popover; role must stay "region" (tests/e2e query it)
        <div
          id={regionId}
          role="region"
          aria-labelledby={labelId}
          onKeyDown={handleKeyDown}
          className="absolute end-0 z-30 mt-2 w-64 rounded-lg border border-stone-200 bg-white p-3 shadow-sm font-sans text-[13px] text-stone-700 pointer-events-auto"
        >
          <p className="font-medium text-stone-800 mb-2">Swap history</p>
          <div className="flex flex-col gap-3">
            {grouped.map((group) => (
              <div key={group.childId ?? '__family__'} className="flex flex-col gap-2">
                {showChildHeadings && (
                  <p className="text-[12px] font-medium text-stone-600">{group.label}</p>
                )}
                <ul className="flex flex-col gap-2">
                  {group.swaps.map((swap, i) => (
                    <li
                      key={`${swap.kind}-${swap.at}-${i}`}
                      className="flex flex-col gap-0.5"
                    >
                      <span className="font-medium">{KIND_LABEL[swap.kind]}</span>
                      <span className="text-stone-500 text-[12px] break-words">
                        {swap.slot_kind !== null ? `${swap.slot_kind} · ` : ''}
                        {formatAt(swap.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

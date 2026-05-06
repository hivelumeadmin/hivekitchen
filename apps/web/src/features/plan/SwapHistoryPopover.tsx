import { useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PlanItemSwapSummary } from '@hivekitchen/types';

export interface SwapHistoryPopoverProps {
  swaps: ReadonlyArray<PlanItemSwapSummary>;
  // Optional child_id → display name map. When absent, falls back to a
  // stable per-popover label ("Child A", "Child B", …) so multi-child swaps
  // are still visually attributable even before a roster query is wired in.
  childLabels?: Readonly<Record<string, string>>;
}

// Story 3.15 — per-day swap audit affordance for the historical plan view.
// Mirrors the AllergyClearedBadge inline-disclosure pattern (no Radix dep):
// button trigger + sibling region, Escape closes and restores focus to the
// trigger. role="region" (not "dialog") because the panel is non-modal — no
// focus trap, no scroll lock, no backdrop.
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
  // Order is first-appearance to keep the display deterministic.
  const grouped = useMemo(() => {
    const order: string[] = [];
    const buckets = new Map<string, PlanItemSwapSummary[]>();
    for (const swap of swaps) {
      let bucket = buckets.get(swap.child_id);
      if (bucket === undefined) {
        bucket = [];
        buckets.set(swap.child_id, bucket);
        order.push(swap.child_id);
      }
      bucket.push(swap);
    }
    return order.map((childId, index) => ({
      childId,
      label: childLabels?.[childId] ?? `Child ${String.fromCharCode(65 + index)}`,
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
              <div key={group.childId} className="flex flex-col gap-2">
                {showChildHeadings && (
                  <p className="text-[12px] font-medium text-stone-600">{group.label}</p>
                )}
                <ul className="flex flex-col gap-2">
                  {group.swaps.map((swap, i) => (
                    <li
                      key={`${swap.slot}-${swap.replaced_at}-${i}`}
                      className="flex flex-col gap-0.5"
                    >
                      <span className="font-medium capitalize">{swap.slot}</span>
                      <span className="text-stone-500 text-[12px] break-words">
                        Was:{' '}
                        {swap.previous_ingredients.length === 0
                          ? '(none recorded)'
                          : swap.previous_ingredients.join(', ')}
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

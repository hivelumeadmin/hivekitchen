import { useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PlanTileSummary } from '@hivekitchen/types';
import { PresenceIndicator } from '../thread/PresenceIndicator.js';
import { TrustChip, type TrustChipVariant } from './TrustChip.js';

export type PlanTileState =
  | 'decided'
  | 'pending-input'
  | 'swap-in-progress'
  | 'locked'
  | 'mutability-frozen'
  | 'paused';   // Story 3.12: sick-day pause

export type PlanTileVariant = 'today' | 'upcoming' | 'past';

export interface PlanTileProps {
  summary: PlanTileSummary;
  state?: PlanTileState;
  partnerName?: string;
  trustChips?: ReadonlyArray<{ variant: TrustChipVariant; label: string }>;
  onSwapIntent?: () => void;
}

const DAY_LABELS: Record<PlanTileSummary['day'], string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
};

// Aligns with Date.getDay() so deriveVariant() can compare without remap.
const DAY_ORDER: Record<PlanTileSummary['day'], number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function deriveVariant(day: PlanTileSummary['day']): PlanTileVariant {
  const now = new Date();
  const todayJs = now.getDay();
  const dayOrd = DAY_ORDER[day];
  if (dayOrd === todayJs) return 'today';
  // On Sunday (todayJs = 0) every weekday slot is upcoming — the new week
  // hasn't started, no day in the plan is yet "past".
  if (todayJs !== 0 && dayOrd < todayJs) return 'past';
  return 'upcoming';
}

function deriveDishLine(summary: PlanTileSummary): string {
  // Recipe name lives in a future contract field; until then the dish line
  // is the unique ingredient list (capped at 3 + overflow).
  const all = [...new Set(summary.items.flatMap((item) => item.ingredients))];
  if (all.length === 0) return '';
  const preview = all.slice(0, 3).join(', ');
  return all.length > 3 ? `${preview} +${all.length - 3} more` : preview;
}

export function PlanTile({
  summary,
  state = 'decided',
  partnerName,
  trustChips,
  onSwapIntent,
}: PlanTileProps) {
  const variant = deriveVariant(summary.day);
  const tileRef = useRef<HTMLElement>(null);
  const [explainOpen, setExplainOpen] = useState(false);

  const isPast = variant === 'past';
  const isFrozen = state === 'mutability-frozen';
  const isLocked = state === 'locked';
  const isPaused = state === 'paused';
  const isInteractive = !isPast && !isFrozen && !isPaused && state !== 'swap-in-progress';
  const hasMorningTint = variant === 'today' && new Date().getHours() < 13;

  const dishLine = deriveDishLine(summary);

  function handleKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    if (!isInteractive) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSwapIntent?.();
      return;
    }
    if (e.key === 'Escape') {
      tileRef.current?.blur();
    }
  }

  // Border treatment by state.
  const borderClass =
    state === 'pending-input'
      ? 'border-2 border-dashed border-honey-amber-400'
      : 'border border-stone-200';

  const articleClasses = [
    'relative rounded-lg p-4 flex flex-col gap-1',
    borderClass,
    hasMorningTint && !isPaused ? 'bg-honey-amber-100' : 'bg-white',
    isPast || isPaused ? 'opacity-60 pointer-events-none' : '',
    isInteractive
      ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-1'
      : '',
  ]
    .filter((c) => c !== '')
    .join(' ');

  return (
    // The tile is a labeled action: tabIndex + onKeyDown invoke onSwapIntent.
    // The <article> landmark is preserved so screen readers and downstream
    // tests/e2e (BriefCanvas, 3-8 spec) can reach each day by role=article.
    // role="button" would replace the landmark role and break those queries.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <article
      ref={tileRef}
      aria-label={DAY_LABELS[summary.day]}
      tabIndex={isPast || isFrozen || isPaused ? -1 : 0}
      onClick={isInteractive ? () => onSwapIntent?.() : undefined}
      onKeyDown={handleKeyDown}
      className={articleClasses}
    >
      {isLocked && (
        <PresenceIndicator
          surface={{ kind: 'plan_tile', id: summary.day }}
          partnerName={partnerName}
          className="absolute top-2 end-2"
        />
      )}

      <h2 className="font-sans text-[13px] font-medium uppercase tracking-wide text-stone-500">
        {DAY_LABELS[summary.day]}
      </h2>

      {dishLine !== '' ? (
        <p className="font-sans text-[19px] font-semibold leading-[1.3] text-stone-900">
          {dishLine}
        </p>
      ) : (
        <p className="font-sans text-[15px] font-normal leading-[1.4] text-stone-400">
          Plan pending
        </p>
      )}

      {trustChips !== undefined && trustChips.length > 0 && (
        <div
          className="flex flex-wrap gap-1 mt-1"
          aria-label="Trust indicators"
        >
          {trustChips.map((chip) => (
            <TrustChip key={`${chip.variant}-${chip.label}`} variant={chip.variant} label={chip.label} />
          ))}
        </div>
      )}

      {isPaused && (
        <p
          className="mt-1 font-sans text-[12px] text-stone-400 italic"
          aria-label="Day paused — sick day"
        >
          Paused
        </p>
      )}

      {isFrozen && (
        <>
          <button
            type="button"
            aria-expanded={explainOpen}
            aria-controls={`plan-tile-frozen-${summary.day}`}
            onClick={() => setExplainOpen((open) => !open)}
            className="mt-1 self-start font-sans text-[12px] text-stone-500 underline underline-offset-2 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
          >
            Editing locked
          </button>
          {explainOpen && (
            <p
              id={`plan-tile-frozen-${summary.day}`}
              role="note"
              className="mt-1 rounded-md bg-stone-50 p-2 font-sans text-[14px] leading-[1.5] text-stone-700"
            >
              Editing is locked every Sunday while we finalise your grocery list. It
              reopens within 4 hours.
            </p>
          )}
        </>
      )}

      {state === 'swap-in-progress' && (
        <span
          aria-busy="true"
          aria-label="Swap in progress"
          className="absolute inset-0 rounded-lg bg-white/70 flex items-center justify-center"
        >
          <span className="h-4 w-4 rounded-full border-2 border-stone-300 border-t-stone-700 animate-spin" />
        </span>
      )}
    </article>
  );
}

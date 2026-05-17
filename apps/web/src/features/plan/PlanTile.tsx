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
  // Story 3.15 — historical plan view forces every tile into the past variant
  // regardless of day-of-week. Default behavior (deriveVariant) compares the
  // tile's day to today, which is wrong when rendering a prior week's plan.
  forceVariant?: PlanTileVariant;
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
  forceVariant,
}: PlanTileProps) {
  const variant = forceVariant ?? deriveVariant(summary.day);
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

  // Border treatment by state. v2.0 tokens — pending uses amber-warm dashed.
  const borderClass =
    state === 'pending-input'
      ? 'border-2 border-dashed border-amber-warm'
      : 'border border-border';

  const articleClasses = [
    'relative rounded-lg p-4 flex flex-col gap-1 transition-colors',
    borderClass,
    hasMorningTint && !isPaused ? 'bg-amber-warm/10' : 'bg-surface',
    isPast || isPaused ? 'opacity-60 pointer-events-none' : '',
    isInteractive
      ? 'cursor-pointer hover:border-amber-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-warm focus-visible:ring-offset-1'
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

      <h2 className="text-xs font-medium uppercase tracking-wider text-fg-muted">
        {DAY_LABELS[summary.day]}
      </h2>

      {dishLine !== '' ? (
        <p className="font-serif text-2xl leading-[1.25] text-fg">
          {dishLine}
        </p>
      ) : (
        <p className="text-[15px] leading-[1.4] text-fg-muted/60">
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
          className="mt-1 text-xs italic text-fg-muted/70"
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
            className="mt-1 self-start text-xs text-fg-muted underline underline-offset-2 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-warm"
          >
            Editing locked
          </button>
          {explainOpen && (
            <p
              id={`plan-tile-frozen-${summary.day}`}
              role="note"
              className="mt-1 rounded-md bg-surface-2 p-2 text-[14px] leading-[1.5] text-fg"
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
          className="absolute inset-0 rounded-lg bg-bg/70 flex items-center justify-center"
        >
          <span className="h-4 w-4 rounded-full border-2 border-border border-t-amber-warm animate-spin" />
        </span>
      )}
    </article>
  );
}

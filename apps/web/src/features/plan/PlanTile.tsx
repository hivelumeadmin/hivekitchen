import { useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PlanTileSummary } from '@hivekitchen/types';
import { PauseCircleIcon } from '@/components/icons.js';
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

export type ChildDotColor = 'foliage' | 'lumi-terracotta';
export interface ChildInfo {
  readonly name: string;
  readonly color: ChildDotColor;
}

export interface PlanTileProps {
  summary: PlanTileSummary;
  state?: PlanTileState;
  partnerName?: string;
  trustChips?: ReadonlyArray<{ variant: TrustChipVariant; label: string }>;
  childColorMap?: ReadonlyMap<string, ChildInfo>;
  onSwapIntent?: () => void;
  // Story 3.28 — pause/resume Lunch Link delivery for this day without altering
  // the underlying plan. The parent component resolves childId and date then
  // calls POST /v1/children/:childId/lunch-link-pause.
  onPauseLunchLink?: () => void;
  // Story 3.15 — historical plan view forces every tile into the past variant
  // regardless of day-of-week. Default behavior (deriveVariant) compares the
  // tile's day to today, which is wrong when rendering a prior week's plan.
  forceVariant?: PlanTileVariant;
}

function ChildChip({ name, color }: { name: string; color: ChildDotColor }) {
  const dotClass = color === 'foliage' ? 'bg-foliage' : 'bg-lumi-terracotta';
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-[11px] font-medium text-fg">
      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotClass}`} aria-hidden />
      {name}
    </span>
  );
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
  childColorMap,
  onSwapIntent,
  onPauseLunchLink,
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
    'group relative rounded-lg p-6 flex flex-col h-full transition-colors',
    borderClass,
    hasMorningTint && !isPaused ? 'bg-amber-warm/10' : 'bg-surface-2',
    isPaused ? 'opacity-60 pointer-events-none' : '',
    isPast ? 'opacity-60 pointer-events-none' : '',
    isInteractive
      ? 'cursor-pointer hover:[border-left-width:2px] hover:border-l-amber-warm hover:[padding-left:calc(1.5rem-2px)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-warm focus-visible:ring-offset-1'
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

      <h2 className="text-xs uppercase tracking-wider text-fg-muted mb-4">
        {DAY_LABELS[summary.day]}
      </h2>

      {dishLine !== '' ? (
        <p className="font-serif text-2xl leading-[1.25] text-fg mb-6 flex-grow">
          {dishLine}
        </p>
      ) : (
        <p className="text-[15px] leading-[1.4] text-fg-muted/60 mb-6 flex-grow">
          Plan pending
        </p>
      )}

      {childColorMap !== undefined && childColorMap.size > 0 && (() => {
        const chips = summary.items
          .map((item) => childColorMap.get(item.child_id))
          .filter((info): info is ChildInfo => info !== undefined && info.name !== '');
        const seen = new Set<string>();
        const unique = chips.filter((info) => {
          if (seen.has(info.name)) return false;
          seen.add(info.name);
          return true;
        });
        return unique.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {unique.map((info) => (
              <ChildChip key={info.name} name={info.name} color={info.color} />
            ))}
          </div>
        ) : null;
      })()}

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
          className="mt-1 flex items-center gap-2 text-xs italic text-fg-muted/70"
          aria-label="Day paused — sick day"
        >
          <PauseCircleIcon className="h-4 w-4 shrink-0" aria-hidden />
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

      {/* Story 3.28 — pause/resume Lunch Link delivery. Shown only for today/
          upcoming tiles when the parent provides the callback. Does not appear
          on past tiles or when state prevents interaction. */}
      {!isPast && onPauseLunchLink !== undefined && (
        <button
          type="button"
          onClick={onPauseLunchLink}
          className="mt-2 self-start text-xs text-fg-muted underline underline-offset-2 cursor-pointer hover:text-terracotta focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-warm"
        >
          {(summary.lunch_link_suppressed_children?.length ?? 0) > 0 ? 'Resume Lunch Link' : 'Pause Lunch Link'}
        </button>
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

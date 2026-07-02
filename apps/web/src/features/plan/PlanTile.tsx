import { useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PlanTileSummary, VariantProposal } from '@hivekitchen/types';
import { PauseCircleIcon } from '@/components/icons.js';
import { TrustChip, type TrustChipVariant } from './TrustChip.js';

export type PlanTileState =
  | 'decided'
  | 'pending-input'
  | 'swap-in-progress'
  | 'proposal-pending'   // Slice 5-S12: waiting for Lumi to resolve a swap proposal
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
  // Story 3.27 — Lumi-proposed preparation variant for one of this day's
  // items. When present (and the tile is interactive), the tile renders two
  // pills [Try the variant] [Keep the original] under the dish line. The
  // parent's choice is dispatched via onVariantChoice.
  variantProposal?: VariantProposal;
  onVariantChoice?: (proposalId: string, choice: 'try_variant' | 'keep_original') => void;
  // Story 4-S4 — keyed by child_id; only children who have rated appear here.
  childRatings?: Record<string, 'loved' | 'ok' | 'not-really'>;
  // Slice 5-S9 — "Why this?" reveals the household-level plan reasoning panel in
  // BriefCanvas. Rendered only when provided (parent passes it only when
  // payload.plan_reasoning is non-null).
  onWhyThis?: () => void;
}

const RATING_EMOJIS: Record<'loved' | 'ok' | 'not-really', string> = {
  loved: '😋',
  ok: '🙂',
  'not-really': '😕',
};

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
  // Recipe name lives in a future contract field; until then the dish line is
  // resolved item names (Story 3-S40 — snack-SKU names) followed by the unique
  // ingredient list (capped at 3 + overflow).
  const names = summary.items.flatMap((item) => (item.name != null ? [item.name] : []));
  const all = [...new Set([...names, ...summary.items.flatMap((item) => item.ingredients)])];
  if (all.length === 0) return '';
  const preview = all.slice(0, 3).join(', ');
  return all.length > 3 ? `${preview} +${all.length - 3} more` : preview;
}

// Story 13-s7 — progressive slot disclosure. On focus the flat dish line
// expands into per-slot rows so a parent can see (and later tweak) the Snack
// without touching the Main. Reuses deriveDishLine's dedup + cap-3 logic per
// slot. Slot order is fixed Main → Snack → Extra; slots with no name or
// ingredient are omitted.
type SlotKind = 'main' | 'snack' | 'extra';
const SLOT_ORDER: readonly SlotKind[] = ['main', 'snack', 'extra'];
const SLOT_LABELS: Record<SlotKind, string> = {
  main: 'Main',
  snack: 'Snack',
  extra: 'Extra',
};

interface SlotGroup {
  readonly slot: SlotKind;
  readonly label: string;
  readonly line: string;
}

function deriveSlotGroups(items: PlanTileSummary['items']): SlotGroup[] {
  const groups: SlotGroup[] = [];
  for (const slot of SLOT_ORDER) {
    const slotItems = items.filter((item) => item.slot === slot);
    if (slotItems.length === 0) continue;
    const tokens = [
      ...slotItems.flatMap((item) => (item.name !== undefined ? [item.name] : [])),
      ...slotItems.flatMap((item) => item.ingredients),
    ];
    const seen = new Set<string>();
    const all: string[] = [];
    for (const token of tokens) {
      if (!seen.has(token.toLowerCase())) {
        seen.add(token.toLowerCase());
        all.push(token);
      }
    }
    if (all.length === 0) continue;
    const preview = all.slice(0, 3).join(', ');
    const line = all.length > 3 ? `${preview} +${all.length - 3} more` : preview;
    groups.push({ slot, label: SLOT_LABELS[slot], line });
  }
  return groups;
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
  variantProposal,
  onVariantChoice,
  childRatings,
  onWhyThis,
}: PlanTileProps) {
  const variant = forceVariant ?? deriveVariant(summary.day);
  const tileRef = useRef<HTMLElement>(null);
  const isPointerFocusRef = useRef(false);
  const [explainOpen, setExplainOpen] = useState(false);
  // Story 13-s7 — slot breakdown is a focus-only disclosure. Conditional
  // rendering (not CSS-only) so keyboard focus reliably reveals it and tests
  // can assert presence/absence.
  const [expanded, setExpanded] = useState(false);

  const isPast = variant === 'past';
  const isFrozen = state === 'mutability-frozen';
  const isLocked = state === 'locked';
  const isPaused = state === 'paused';
  const isInteractive =
    !isPast && !isFrozen && !isPaused
    && state !== 'swap-in-progress'
    && state !== 'proposal-pending';
  const hasMorningTint = variant === 'today' && new Date().getHours() < 13;

  const dishLine = deriveDishLine(summary);
  const slotGroups = deriveSlotGroups(summary.items);

  function handleKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') {
      tileRef.current?.blur();
      return;
    }
    if (!isInteractive) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSwapIntent?.();
    }
  }

  // Story 3.27 — an active variant proposal puts the tile in the pending-input
  // visual state (dashed amber-warm border) so the parent's eye lands on the
  // single decision they need to make.
  const hasVariantProposal = variantProposal !== undefined;
  const effectiveState: PlanTileState =
    hasVariantProposal && state === 'decided' ? 'pending-input' : state;

  // Border treatment by state. v2.0 tokens — pending uses amber-warm dashed.
  const borderClass =
    effectiveState === 'pending-input'
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
      onPointerDown={() => { isPointerFocusRef.current = true; }}
      onFocus={isInteractive ? () => {
        if (!isPointerFocusRef.current) setExpanded(true);
        isPointerFocusRef.current = false;
      } : undefined}
      onBlur={(e) => {
        isPointerFocusRef.current = false;
        if (!tileRef.current?.contains(e.relatedTarget as Node)) setExpanded(false);
      }}
      className={articleClasses}
    >
      {/* Story 5-S1 — live presence is brief-only; plan_tile presence is deferred
          (see Dev Notes). This is the static lock-by-partner badge; it renders
          only when the parent supplies an explicit partnerName. */}
      {isLocked && partnerName && (
        <span
          role="status"
          aria-live="polite"
          className="absolute top-2 end-2 inline-flex items-center gap-1 font-sans text-[13px] text-warm-neutral-600"
        >
          <span
            aria-hidden="true"
            className="inline-block h-5 w-5 rounded-full bg-sacred-200"
          />
          <span>{partnerName} is editing</span>
        </span>
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

      {/* Story 13-s7 — focus-only slot breakdown. Only when there is more than
          one slot to show (a lone Main needs no redundant disclosure). */}
      {expanded && isInteractive && slotGroups.length > 1 && (
        <div className="-mt-4 mb-6 flex flex-col gap-1">
          {slotGroups.map(({ slot, label, line }) => (
            <div key={slot} className="flex items-baseline gap-2">
              <span className="w-10 flex-shrink-0 text-[10px] font-medium uppercase tracking-wider text-fg-muted/70">
                {label}
              </span>
              <span className="font-sans text-[13px] text-fg">{line}</span>
            </div>
          ))}
        </div>
      )}

      {/* Slice 5-S9 — "Why this?" ghost button. stopPropagation so it does not
          also trigger the tile's onSwapIntent click. Hidden while a swap is
          in flight (5-S12 AC8: interactive affordances disabled in the
          proposal-pending / swap-in-progress states). */}
      {onWhyThis !== undefined &&
        state !== 'proposal-pending' &&
        state !== 'swap-in-progress' && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onWhyThis();
          }}
          className="mb-3 self-start text-xs text-honey-amber-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-warm"
        >
          Why this?
        </button>
      )}

      {effectiveState === 'pending-input' && variantProposal !== undefined && (
        <div className="mt-2 mb-4 flex flex-col gap-2">
          <p className="font-sans text-[13px] leading-relaxed text-fg-muted">
            {variantProposal.variant_description}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onVariantChoice?.(variantProposal.id, 'try_variant');
              }}
              className="rounded-full border border-amber-warm bg-amber-warm/10 px-3 py-1 font-sans text-[13px] text-fg hover:bg-amber-warm/20 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-warm"
            >
              Try the variant
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onVariantChoice?.(variantProposal.id, 'keep_original');
              }}
              className="rounded-full border border-border px-3 py-1 font-sans text-[13px] text-fg-muted hover:bg-surface-2 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-warm"
            >
              Keep the original
            </button>
          </div>
        </div>
      )}

      {childColorMap !== undefined && childColorMap.size > 0 && (() => {
        const seen = new Set<string>();
        const uniqueItems = summary.items.filter((item) => {
          const info = childColorMap.get(item.child_id);
          if (info === undefined || info.name === '') return false;
          if (seen.has(item.child_id)) return false;
          seen.add(item.child_id);
          return true;
        });
        return uniqueItems.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {uniqueItems.map((item) => {
              const info = childColorMap.get(item.child_id)!;
              const rating = childRatings?.[item.child_id];
              return (
                <span key={item.child_id} className="inline-flex items-center gap-1.5">
                  <ChildChip name={info.name} color={info.color} />
                  {rating !== undefined && (
                    <span
                      aria-label={`Rated: ${rating}`}
                      className="text-[14px] leading-none"
                    >
                      {RATING_EMOJIS[rating]}
                    </span>
                  )}
                </span>
              );
            })}
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

      {/* Slice 5-S12 — sacred-plum pulse: Lumi is finding a swap. The pulse is
          suppressed for reduced-motion users (static dot) via the motion-reduce
          variant, which compiles to @media (prefers-reduced-motion: reduce). */}
      {state === 'proposal-pending' && (
        <span
          aria-label="Lumi is finding a swap"
          className="absolute top-3 end-3 inline-block h-1.5 w-1.5 rounded-full bg-sacred-500 [animation:hk-sacred-plum-pulse_1.6s_ease-in-out_infinite] motion-reduce:[animation:none]"
        />
      )}
    </article>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircleIcon } from '../../../components/icons.js';
import { PrimaryButton } from '../../../components/PrimaryButton.js';
import type {
  ChildPerson,
  CookingMode,
  DayPlan,
  WeekPlan,
} from '../day-view-model.js';
import { WallCardPage } from './WallCardPage.js';

// Story 14-s4 — the day-detail action vocabulary, wired to what the API can
// actually do today. Handlers are optional: an action with no handler renders
// disabled with an honest hint rather than pretending to persist.
interface WallCardActions {
  readonly onSwapMain?: (day: DayPlan) => void;
  readonly onPauseDay?: (day: DayPlan) => void;
  readonly onPauseChild?: (day: DayPlan, childId: string) => void;
  readonly onChangeMyMind?: () => void;
  readonly pausePending?: boolean;
}

interface Readonly_WallCardSwipeStackProps {
  readonly week: WeekPlan;
  readonly initialMode?: CookingMode;
  // Story 14-s4 — the day the sheet was opened for (`/app/day/:day`). An unknown
  // or absent value falls back to the first planned day.
  readonly initialDay?: string;
  readonly actions?: WallCardActions;
}

export type WallCardSwipeStackProps = Readonly<Readonly_WallCardSwipeStackProps>;

export function WallCardSwipeStack({
  week,
  initialMode = 'finish',
  initialDay,
  actions,
}: WallCardSwipeStackProps) {
  const [mode, setMode] = useState<CookingMode>(initialMode);
  const initialIndex = Math.max(
    0,
    week.days.findIndex((d) => d.dayName === initialDay),
  );
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const handle = () => {
      const w = el.clientWidth;
      if (w === 0) return;
      setActiveIndex(Math.round(el.scrollLeft / w));
    };
    el.addEventListener('scroll', handle, { passive: true });
    return () => {
      el.removeEventListener('scroll', handle);
    };
  }, []);

  // Jump (not animate) to the opened day on mount AND whenever the target day
  // changes without a remount (history back/forward between two /app/day/:day
  // URLs keeps this element mounted). No index-0 early-return: navigating back
  // to Monday must scroll home too. `behavior: auto` keeps it out of the
  // reduced-motion conversation entirely.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    setActiveIndex(initialIndex);
    el.scrollTo({ left: initialIndex * el.clientWidth, behavior: 'auto' });
  }, [initialIndex]);

  const pageCount = week.days.length;
  // Clamp: a plan refetch can shrink the week under an open sheet, leaving the
  // scroll-derived index past the end — dots/rollup/actions must all agree.
  const clampedIndex = Math.min(Math.max(activeIndex, 0), pageCount - 1);
  const activeDay = week.days[clampedIndex] ?? week.days[0]!;

  const scrollByPage = (direction: -1 | 1) => {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollBy({ left: direction * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-bg md:max-w-4xl lg:max-w-5xl">
      <header className="border-b border-border px-6 py-4 md:px-10">
        <ModeToggle mode={mode} onChange={setMode} />
      </header>

      <div className="relative">
        <div
          ref={scrollRef}
          className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth"
        >
          {week.days.map((day) => (
            <WallCardPage
              key={day.id}
              day={day}
              kids={week.children}
              mode={mode}
            />
          ))}
        </div>

        {clampedIndex > 0 ? (
          <button
            type="button"
            onClick={() => {
              scrollByPage(-1);
            }}
            aria-label="Previous day"
            className="absolute start-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-bg text-fg-muted shadow-sm backdrop-blur transition-colors hover:text-lumi-terracotta-warmed md:flex"
          >
            <span className="text-xl leading-none" aria-hidden>
              ‹
            </span>
          </button>
        ) : null}

        {clampedIndex < pageCount - 1 ? (
          <button
            type="button"
            onClick={() => {
              scrollByPage(1);
            }}
            aria-label="Next day"
            className="absolute end-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-bg text-fg-muted shadow-sm backdrop-blur transition-colors hover:text-lumi-terracotta-warmed md:flex"
          >
            <span className="text-xl leading-none" aria-hidden>
              ›
            </span>
          </button>
        ) : null}
      </div>

      <footer className="flex flex-col gap-4 border-t border-border px-6 py-5 md:px-10 md:py-6">
        {pageCount > 1 ? (
          <PaginationDots count={pageCount} activeIndex={clampedIndex} />
        ) : null}
        <DayRollup day={activeDay} mode={mode} />
        <ModeActionBar mode={mode} kids={week.children} day={activeDay} actions={actions} />
        {mode === 'finish' &&
        activeDay.prepInvestment !== undefined &&
        activeDay.prepInvestment.savedMinutes > 0 ? (
          <p className="text-center text-[11px] italic text-fg-muted">
            {activeDay.prepInvestment.label} saved you{' '}
            {String(activeDay.prepInvestment.savedMinutes)} min this morning.
          </p>
        ) : null}
      </footer>
    </div>
  );
}

interface ModeToggleProps {
  readonly mode: CookingMode;
  readonly onChange: (m: CookingMode) => void;
}

function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div
      className="inline-flex rounded-full border border-border bg-surface p-0.5"
      role="tablist"
      aria-label="Cooking mode"
    >
      <ModeButton
        active={mode === 'prep'}
        onClick={() => {
          onChange('prep');
        }}
      >
        Prep
      </ModeButton>
      <ModeButton
        active={mode === 'finish'}
        onClick={() => {
          onChange('finish');
        }}
      >
        Finish
      </ModeButton>
    </div>
  );
}

interface ModeButtonProps {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}

function ModeButton({ active, onClick, children }: ModeButtonProps) {
  const base =
    'rounded-full px-4 py-1.5 text-xs font-medium uppercase tracking-wider transition-colors';
  // Recognition state on the theme-flipped honey scale (same pairing as the
  // method step numbers): `bg-amber-warm text-bg` measured 2.37:1 — an AA
  // failure the review's axe pass caught once the amber-warm filter was gone.
  const activeCls = 'bg-honey-amber-100 text-honey-amber-800';
  const inactiveCls = 'text-fg-muted hover:text-lumi-terracotta-warmed';
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`${base} ${active ? activeCls : inactiveCls}`}
    >
      {children}
    </button>
  );
}

interface PaginationDotsProps {
  readonly count: number;
  readonly activeIndex: number;
}

function PaginationDots({ count, activeIndex }: PaginationDotsProps) {
  return (
    // role=group so the aria-label is permitted (a bare label on a role-less
    // div is prohibited ARIA and is dropped by screen readers).
    <div
      role="group"
      className="flex items-center justify-center gap-2"
      aria-label={`Day ${String(activeIndex + 1)} of ${String(count)}`}
    >
      {Array.from({ length: count }).map((_, i) => {
        const isActive = i === activeIndex;
        return (
          <span
            key={i}
            className={`h-1.5 w-1.5 rounded-full transition-colors ${isActive ? 'bg-amber-warm' : 'bg-border'}`}
            aria-hidden
          />
        );
      })}
    </div>
  );
}

interface DayRollupProps {
  readonly day: DayPlan;
  readonly mode: CookingMode;
}

function DayRollup({ day, mode }: DayRollupProps) {
  const minutes =
    mode === 'prep' ? day.main.prepMinutes : day.main.finishMinutes;
  const verb = mode === 'prep' ? 'to prep' : 'to pack';
  return (
    <p className="text-center text-[11px] font-medium uppercase tracking-[0.2em] text-fg-muted">
      {/* 0/null minutes means the mode has no work — "0 min" would imply a
          measured zero rather than nothing-to-do. */}
      {minutes > 0
        ? `Total ${verb}: ${String(minutes)} min`
        : `Nothing in ${mode === 'prep' ? 'Prep' : 'Finish'}`}
    </p>
  );
}

interface ModeActionBarProps {
  readonly mode: CookingMode;
  readonly kids: readonly ChildPerson[];
  readonly day: DayPlan;
  readonly actions?: WallCardActions;
}

function ModeActionBar({ mode, kids, day, actions }: ModeActionBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const primaryLabel = mode === 'prep' ? 'Done prepping' : 'Mark cooked';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Story 14-s4 — cooked/prepped signals have no persistence endpoint
            yet, so the primary action is present in the vocabulary but plainly
            inert. Shipping it as if it saved would be a lie. */}
        <PrimaryButton icon={<CheckCircleIcon />} disabled>
          {primaryLabel}
        </PrimaryButton>
        <button
          type="button"
          onClick={() => {
            setMoreOpen((v) => !v);
          }}
          aria-expanded={moreOpen}
          className="text-[11px] font-medium uppercase tracking-widest text-fg-muted transition-colors hover:text-lumi-terracotta-warmed"
        >
          More actions {moreOpen ? '▴' : '▾'}
        </button>
      </div>
      {moreOpen ? (
        <MoreActionsPanel mode={mode} kids={kids} day={day} actions={actions} />
      ) : null}
    </div>
  );
}

interface MoreActionsPanelProps {
  readonly mode: CookingMode;
  readonly kids: readonly ChildPerson[];
  readonly day: DayPlan;
  readonly actions?: WallCardActions;
}

function MoreActionsPanel({ mode, kids, day, actions }: MoreActionsPanelProps) {
  const pauseDisabledHint = day.paused ? 'This day is already paused' : undefined;
  // Children whose variation carries paused_at — "Pause for <kid>" must not
  // re-fire against an already-paused child.
  const pausedChildIds = new Set(
    day.variations.filter((v) => v.paused === true).map((v) => v.childId),
  );
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <ActionLink
        label="Swap this Main"
        hint="Lumi will propose alternatives"
        {...(actions?.onSwapMain !== undefined
          ? { onClick: () => { actions.onSwapMain?.(day); } }
          : {})}
      />
      {mode === 'prep' ? (
        <ActionLink
          label="Skip prep tonight"
          hint="Not available yet — prep signals aren't recorded"
        />
      ) : null}
      <ActionLink
        label="Pause this day"
        hint={pauseDisabledHint ?? 'Sick day, snow day, holiday — everyone skips'}
        {...(actions?.onPauseDay !== undefined && !day.paused && actions.pausePending !== true
          ? { onClick: () => { actions.onPauseDay?.(day); } }
          : {})}
      />
      {kids.map((k) => {
        const alreadyPaused = pausedChildIds.has(k.id);
        return (
          <ActionLink
            key={k.id}
            label={`Pause for ${k.name}`}
            hint={alreadyPaused ? `${k.name} is already paused this day` : 'One kid skips, others eat'}
            {...(actions?.onPauseChild !== undefined &&
            !day.paused &&
            !alreadyPaused &&
            actions.pausePending !== true
              ? { onClick: () => { actions.onPauseChild?.(day, k.id); } }
              : {})}
          />
        );
      })}
      <ActionLink
        label="Change my mind ↗"
        hint="Back to the canvas"
        {...(actions?.onChangeMyMind !== undefined
          ? { onClick: () => { actions.onChangeMyMind?.(); } }
          : {})}
      />
    </div>
  );
}

interface ActionLinkProps {
  readonly label: string;
  readonly hint: string;
  readonly onClick?: () => void;
}

// An action with no handler is disabled, not silently dead: the vocabulary
// stays visible (it is the locked day-detail action set) while the absence of
// a backend is stated rather than mimed.
function ActionLink({ label, hint, onClick }: ActionLinkProps) {
  const isEnabled = onClick !== undefined;
  return (
    <button
      type="button"
      disabled={!isEnabled}
      {...(isEnabled ? { onClick } : {})}
      className={`block w-full text-left transition-colors motion-reduce:transition-none ${
        isEnabled ? 'hover:text-lumi-terracotta-warmed' : 'cursor-not-allowed opacity-60'
      }`}
    >
      <span className="block text-sm font-medium text-fg">{label}</span>
      <span className="block text-xs text-fg-muted">{hint}</span>
    </button>
  );
}

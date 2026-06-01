import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircleIcon } from '../../../components/icons.js';
import { PrimaryButton } from '../../../components/PrimaryButton.js';
import type {
  ChildPerson,
  CookingMode,
  DayPlan,
  WeekPlan,
} from '../data/multiChildMockData.js';
import { WallCardPage } from './WallCardPage.js';

interface Readonly_WallCardSwipeStackProps {
  readonly week: WeekPlan;
  readonly initialMode?: CookingMode;
}

export type WallCardSwipeStackProps = Readonly<Readonly_WallCardSwipeStackProps>;

export function WallCardSwipeStack({
  week,
  initialMode = 'finish',
}: WallCardSwipeStackProps) {
  const [mode, setMode] = useState<CookingMode>(initialMode);
  const [activeIndex, setActiveIndex] = useState(0);
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

  const pageCount = week.days.length;
  const activeDay = week.days[activeIndex] ?? week.days[0]!;

  const scrollByPage = (direction: -1 | 1) => {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollBy({ left: direction * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border/30 bg-bg md:max-w-4xl lg:max-w-5xl">
      <header className="border-b border-border/20 px-6 py-4 md:px-10">
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

        {activeIndex > 0 ? (
          <button
            type="button"
            onClick={() => {
              scrollByPage(-1);
            }}
            aria-label="Previous day"
            className="absolute start-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border/30 bg-bg/90 text-fg-muted shadow-sm backdrop-blur transition-colors hover:text-amber-warm md:flex"
          >
            <span className="text-xl leading-none" aria-hidden>
              ‹
            </span>
          </button>
        ) : null}

        {activeIndex < pageCount - 1 ? (
          <button
            type="button"
            onClick={() => {
              scrollByPage(1);
            }}
            aria-label="Next day"
            className="absolute end-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border/30 bg-bg/90 text-fg-muted shadow-sm backdrop-blur transition-colors hover:text-amber-warm md:flex"
          >
            <span className="text-xl leading-none" aria-hidden>
              ›
            </span>
          </button>
        ) : null}
      </div>

      <footer className="flex flex-col gap-4 border-t border-border/20 px-6 py-5 md:px-10 md:py-6">
        {pageCount > 1 ? (
          <PaginationDots count={pageCount} activeIndex={activeIndex} />
        ) : null}
        <DayRollup day={activeDay} mode={mode} />
        <ModeActionBar mode={mode} kids={week.children} />
        {mode === 'finish' &&
        activeDay.prepInvestment !== undefined &&
        activeDay.prepInvestment.savedMinutes > 0 ? (
          <p className="text-center text-[11px] italic text-fg-muted/80">
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
      className="inline-flex rounded-full border border-border/30 bg-surface p-0.5"
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
  const activeCls = 'bg-amber-warm text-bg';
  const inactiveCls = 'text-fg-muted hover:text-amber-warm';
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
    <div
      className="flex items-center justify-center gap-2"
      aria-label={`Day ${String(activeIndex + 1)} of ${String(count)}`}
    >
      {Array.from({ length: count }).map((_, i) => {
        const isActive = i === activeIndex;
        return (
          <span
            key={i}
            className={`h-1.5 w-1.5 rounded-full transition-colors ${isActive ? 'bg-amber-warm' : 'bg-border/40'}`}
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
      Total {verb}: {String(minutes)} min
    </p>
  );
}

interface ModeActionBarProps {
  readonly mode: CookingMode;
  readonly kids: readonly ChildPerson[];
}

function ModeActionBar({ mode, kids }: ModeActionBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const primaryLabel = mode === 'prep' ? 'Done prepping' : 'Mark cooked';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PrimaryButton icon={<CheckCircleIcon />}>{primaryLabel}</PrimaryButton>
        <button
          type="button"
          onClick={() => {
            setMoreOpen((v) => !v);
          }}
          aria-expanded={moreOpen}
          className="text-[11px] font-medium uppercase tracking-widest text-fg-muted transition-colors hover:text-amber-warm"
        >
          More actions {moreOpen ? '▴' : '▾'}
        </button>
      </div>
      {moreOpen ? <MoreActionsPanel mode={mode} kids={kids} /> : null}
    </div>
  );
}

interface MoreActionsPanelProps {
  readonly mode: CookingMode;
  readonly kids: readonly ChildPerson[];
}

function MoreActionsPanel({ mode, kids }: MoreActionsPanelProps) {
  return (
    <div className="space-y-3 rounded-lg border border-border/20 bg-surface/40 p-4">
      <ActionLink
        label="Swap this Main"
        hint="Lumi will propose alternatives"
      />
      {mode === 'prep' ? (
        <ActionLink
          label="Skip prep tonight ↗"
          hint="Mark prep as not happening"
        />
      ) : null}
      <ActionLink
        label="Pause this day"
        hint="Sick day, snow day, holiday — everyone skips"
      />
      {kids.map((k) => (
        <ActionLink
          key={k.id}
          label={`Pause for ${k.name}`}
          hint="One kid skips, others eat"
        />
      ))}
      <ActionLink label="Change my mind ↗" hint="Back to the canvas" />
    </div>
  );
}

interface ActionLinkProps {
  readonly label: string;
  readonly hint: string;
}

function ActionLink({ label, hint }: ActionLinkProps) {
  return (
    <button
      type="button"
      className="block w-full text-left transition-colors hover:text-amber-warm"
    >
      <span className="block text-sm font-medium text-fg">{label}</span>
      <span className="block text-xs text-fg-muted">{hint}</span>
    </button>
  );
}

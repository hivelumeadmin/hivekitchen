import { useMemo, useState } from 'react';
import { HistoryView } from './components/HistoryView.js';
import {
  MOMENT_6_LUMI,
  PRIOR_HISTORY_MOMENT_6,
  type ChatTurn,
} from './data/conversation-history.js';

// ─── Inline SVG icons — match OnboardingText.tsx / Moment 5 pattern ────────

function IcoWaveform({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.25v7.5m3-10.5v13.5M9 6.75v10.5m3-13.5v16.5m3-13.5v10.5m3-7.5v4.5" />
    </svg>
  );
}
function IcoHistory({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
function IcoUsers({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  );
}
function IcoHome({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.5 1.5 0 012.122 0L22.28 12M4.5 9.75v10.125a1.125 1.125 0 001.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125a1.125 1.125 0 001.125-1.125V9.75" />
    </svg>
  );
}
function IcoShield({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  );
}
function IcoGlobe({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  );
}
function IcoLunchBag({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  );
}
function IcoSeed({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}
function IcoCheck({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}
function IcoBackArrow({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
  );
}

// ─── Captured profile — read-back contract from Moments 1–5 ────────────────

type Enforcement = 'always' | 'prefer' | 'context';
type ElevationState = 'pending' | 'confirmed' | 'downgraded';

interface ElevationChip {
  readonly id: string;
  readonly label: string;
  readonly basis: string; // verbatim parent quote that triggered the elevation
  readonly proposed: Extract<Enforcement, 'always'>;
}

interface CapturedProfile {
  householdName: string;
  children: Array<{ name: string; ageBand: string }>;
  allergens: Array<{ child: string; items: string[]; medical: boolean }>;
  taste: {
    cultural: Array<{ label: string; enforcement: Enforcement; elevationId?: string }>;
  };
  bag: { household: string | null };
  startingLine: { count: number; preview: string[]; overridden: boolean };
}

// ─── Demo scenarios ────────────────────────────────────────────────────────

type DemoScenario = 'pending' | 'confirmed' | 'downgraded' | 'gap' | 'finalized';

interface ScenarioConfig {
  readonly label: string;
  readonly desc: string;
}

const SCENARIOS: Record<DemoScenario, ScenarioConfig> = {
  pending: {
    label: 'Pending elevations',
    desc: 'Default arrival — Halal & Layla’s nut allergens both await confirm/downgrade; Finalize disabled',
  },
  confirmed: {
    label: 'Both confirmed',
    desc: 'Parent confirmed both elevations as hard rules; Finalize enabled',
  },
  downgraded: {
    label: 'One downgraded',
    desc: 'Halal downgraded to preference; nut allergens confirmed; Finalize enabled',
  },
  gap: {
    label: 'Required-set gap',
    desc: 'Bag composition missing — Finalize blocked; jump-back link visible',
  },
  finalized: {
    label: 'Finalized',
    desc: 'is_onboarded=true; celebratory state; redirect-to-app preview',
  },
};

// ─── Elevation chip catalog (proposed hard rules) ──────────────────────────

const ELEVATIONS: ElevationChip[] = [
  {
    id: 'halal',
    label: 'Halal',
    basis: 'You said: "We’re strictly Halal — that’s non-negotiable."',
    proposed: 'always',
  },
  {
    id: 'layla-nuts',
    label: 'Layla — peanut & tree nuts',
    basis: 'You said: "Medical, life-threatening."',
    proposed: 'always',
  },
];

const BASE_CAPTURED: CapturedProfile = {
  householdName: 'The Khan-Patel family kitchen',
  children: [
    { name: 'Layla', ageBand: '10–12' },
    { name: 'Adam', ageBand: '10–12' },
  ],
  allergens: [
    { child: 'Layla', items: ['Peanut', 'Tree nuts'], medical: true },
    { child: 'Adam', items: [], medical: false },
  ],
  taste: {
    cultural: [
      { label: 'Halal', enforcement: 'always', elevationId: 'halal' },
      { label: 'Punjabi', enforcement: 'prefer' },
    ],
  },
  bag: { household: 'Main + 2 sides' },
  startingLine: {
    count: 10,
    preview: [
      'Paratha roll',
      'Dal + rice (thermos)',
      'Wrap',
      'Pasta salad',
      'Hummus + pita',
      'Quesadilla',
    ],
    overridden: false,
  },
};

// ─── Page ──────────────────────────────────────────────────────────────────

export function Moment6Page() {
  const [scenario, setScenario] = useState<DemoScenario>('pending');
  const [elevationStates, setElevationStates] = useState<Record<string, ElevationState>>(
    initialElevationStates('pending'),
  );
  const [showHistory, setShowHistory] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const historyTurns: ChatTurn[] = [...PRIOR_HISTORY_MOMENT_6, MOMENT_6_LUMI];

  const captured: CapturedProfile = useMemo(() => {
    const next: CapturedProfile = {
      ...BASE_CAPTURED,
      taste: {
        ...BASE_CAPTURED.taste,
        cultural: BASE_CAPTURED.taste.cultural.map((c) => {
          if (!c.elevationId) return c;
          const state = elevationStates[c.elevationId];
          if (state === 'downgraded') return { ...c, enforcement: 'prefer' as const };
          return c;
        }),
      },
    };
    if (scenario === 'gap') {
      next.bag = { household: null };
    }
    return next;
  }, [elevationStates, scenario]);

  const allResolved = ELEVATIONS.every((e) => elevationStates[e.id] !== 'pending');
  const requiredSetComplete =
    !!captured.bag.household &&
    captured.children.length > 0 &&
    captured.startingLine.count >= 4;
  const gateMet = allResolved && requiredSetComplete && scenario !== 'finalized';

  function handleScenarioChange(next: DemoScenario) {
    setScenario(next);
    setElevationStates(initialElevationStates(next));
  }

  function handleConfirm(id: string) {
    setElevationStates((prev) => ({ ...prev, [id]: 'confirmed' }));
  }
  function handleDowngrade(id: string) {
    setElevationStates((prev) => ({ ...prev, [id]: 'downgraded' }));
  }
  function handleReopen(id: string) {
    setElevationStates((prev) => ({ ...prev, [id]: 'pending' }));
  }
  function handleFinalize() {
    if (!gateMet) return;
    setScenario('finalized');
  }

  const lumiProse =
    scenario === 'finalized'
      ? "Locked in. Welcome to your kitchen, Priya — I’ll start drafting next week now."
      : "Here’s what I heard. A couple of these I want to treat as hard rules — confirm each one, tweak what’s off, and I’ll lock the kitchen in.";

  return (
    <>
      <DemoToggle current={scenario} onChange={handleScenarioChange} />

      <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden">
        {/* LEFT: Conversation column */}
        <section className="relative flex flex-1 md:w-[60%] md:flex-none flex-col bg-bg">
          {/* Header */}
          <header className="shrink-0 flex items-center justify-between bg-bg/80 px-6 md:px-8 py-5 backdrop-blur-sm">
            <div className="flex flex-col gap-1">
              <h1 className="font-serif text-xl font-medium tracking-tight text-amber">
                HiveKitchen
              </h1>
              <span className="font-sans text-[11px] font-medium uppercase tracking-widest text-fg-muted">
                {scenario === 'finalized'
                  ? 'Kitchen locked in · Welcome'
                  : 'Summary · Lock in your kitchen'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                title={showHistory ? 'Collapse history' : 'Show conversation history'}
                className={[
                  'flex h-9 w-9 items-center justify-center rounded-full border transition-colors',
                  showHistory
                    ? 'border-amber/40 text-amber'
                    : 'border-neutral-400/30 text-fg-muted hover:text-fg',
                ].join(' ')}
              >
                <IcoHistory cls="h-[18px] w-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                aria-label="Open your kitchen profile"
                className="md:hidden flex items-center gap-2 rounded-full border border-neutral-400/30 px-4 py-2 font-sans text-sm font-medium text-fg-muted hover:bg-surface transition-colors"
              >
                View Profile
              </button>
            </div>
          </header>

          {showHistory ? (
            <HistoryView turns={historyTurns} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-start px-6 md:px-8 py-6 min-h-0 overflow-y-auto">
              <div className="flex flex-col items-center gap-5 text-center max-w-2xl w-full">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber/30 bg-amber/15">
                  <IcoWaveform cls="h-6 w-6 animate-pulse text-amber" />
                </div>
                <p className="font-serif text-2xl md:text-[28px] leading-snug text-fg">
                  {lumiProse}
                </p>

                {/* Elevation confirmation rail — chips below Lumi's turn */}
                {scenario !== 'finalized' && (
                  <div className="flex w-full flex-col gap-3 pt-1">
                    <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
                      Hard rules I’m about to lock in
                    </p>
                    <div className="flex flex-col gap-3">
                      {ELEVATIONS.map((e) => (
                        <ElevationCard
                          key={e.id}
                          chip={e}
                          state={elevationStates[e.id] ?? 'pending'}
                          onConfirm={() => handleConfirm(e.id)}
                          onDowngrade={() => handleDowngrade(e.id)}
                          onReopen={() => handleReopen(e.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Gap callout — required-set incomplete */}
                {scenario === 'gap' && !captured.bag.household && (
                  <GapCallout
                    label="Lunch bag composition"
                    moment={4}
                    note="We never landed on the shape of the bag. Jump back and pick it in a tap."
                  />
                )}

                {/* Finalized splash */}
                {scenario === 'finalized' && (
                  <div className="flex flex-col items-center gap-3 pt-3">
                    <div className="flex flex-wrap items-center justify-center gap-2 rounded-full border border-foliage/40 bg-foliage-soft px-4 py-2 font-sans text-sm text-fg">
                      <IcoCheck cls="h-4 w-4 text-foliage" />
                      <span>Kitchen sealed</span>
                    </div>
                    <p className="font-sans text-xs italic text-fg-muted">
                      Redirecting to your kitchen…
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Bottom action region — finalize gate (replaces input bar) */}
          <div className="shrink-0 px-6 md:px-8 pb-10 pt-3">
            <div className="mx-auto flex max-w-2xl flex-col gap-3">
              <div className="flex items-center gap-3 rounded-2xl border border-neutral-400/30 bg-surface/50 px-4 py-3 backdrop-blur-md shadow-lg">
                {scenario === 'finalized' ? (
                  <div className="flex flex-1 items-center justify-center font-sans text-sm text-foliage">
                    Welcome to your kitchen.
                  </div>
                ) : (
                  <>
                    <FinalizeStatus
                      allResolved={allResolved}
                      requiredSetComplete={requiredSetComplete}
                      bagMissing={!captured.bag.household}
                    />
                    <button
                      type="button"
                      onClick={handleFinalize}
                      disabled={!gateMet}
                      className={[
                        'inline-flex items-center gap-2 rounded-full px-5 py-2.5 font-sans text-sm font-medium transition-all',
                        gateMet
                          ? 'bg-amber text-bg shadow-md hover:bg-amber-warm active:scale-[0.98]'
                          : 'bg-amber/20 text-amber-warm/60 cursor-not-allowed',
                      ].join(' ')}
                    >
                      <IcoCheck cls="h-4 w-4" />
                      Finalize
                    </button>
                  </>
                )}
              </div>
              <GateLine
                scenario={scenario}
                allResolved={allResolved}
                requiredSetComplete={requiredSetComplete}
                bagMissing={!captured.bag.household}
              />
            </div>
          </div>
        </section>

        {/* RIGHT: Kitchen Profile — fully populated, all cards active */}
        <section
          className="relative hidden md:flex md:w-[40%] flex-col bg-surface overflow-hidden"
          aria-label="Your Kitchen Profile"
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-surface-2/30 to-transparent" />
          <div className="relative flex flex-1 flex-col overflow-hidden z-10">
            <KitchenProfilePanel
              captured={captured}
              elevationStates={elevationStates}
              finalized={scenario === 'finalized'}
            />
          </div>
        </section>
      </div>

      {/* Mobile profile drawer */}
      <div
        className={[
          'fixed inset-0 z-40 md:hidden transition-opacity duration-300',
          profileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
      >
        <div
          className="absolute inset-0 bg-black/60"
          onClick={() => setProfileOpen(false)}
          aria-hidden="true"
        />
        <div
          role="dialog"
          aria-label="Your Kitchen Profile"
          className={[
            'absolute bottom-0 left-0 right-0 flex flex-col rounded-t-2xl bg-bg overflow-hidden max-h-[85vh] transition-transform duration-300 ease-out',
            profileOpen ? 'translate-y-0' : 'translate-y-full',
          ].join(' ')}
        >
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="h-1 w-10 rounded-full bg-border" />
          </div>
          <div className="flex justify-end px-5 pb-1 shrink-0">
            <button
              type="button"
              onClick={() => setProfileOpen(false)}
              className="font-sans text-xs text-fg-muted hover:text-fg transition-colors"
            >
              Close
            </button>
          </div>
          <div className="flex flex-1 flex-col overflow-hidden">
            <KitchenProfilePanel
              captured={captured}
              elevationStates={elevationStates}
              finalized={scenario === 'finalized'}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function initialElevationStates(scenario: DemoScenario): Record<string, ElevationState> {
  switch (scenario) {
    case 'confirmed':
      return { halal: 'confirmed', 'layla-nuts': 'confirmed' };
    case 'downgraded':
      return { halal: 'downgraded', 'layla-nuts': 'confirmed' };
    case 'finalized':
      return { halal: 'confirmed', 'layla-nuts': 'confirmed' };
    case 'gap':
      return { halal: 'confirmed', 'layla-nuts': 'confirmed' };
    case 'pending':
    default:
      return { halal: 'pending', 'layla-nuts': 'pending' };
  }
}

// ─── Elevation card — per-chip confirm/downgrade ───────────────────────────

interface ElevationCardProps {
  readonly chip: ElevationChip;
  readonly state: ElevationState;
  readonly onConfirm: () => void;
  readonly onDowngrade: () => void;
  readonly onReopen: () => void;
}

function ElevationCard({ chip, state, onConfirm, onDowngrade, onReopen }: ElevationCardProps) {
  if (state === 'confirmed') {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border-2 border-foliage bg-foliage-soft px-4 py-3 text-left">
        <div className="flex flex-col gap-0.5">
          <span className="font-sans text-sm font-medium text-fg">
            {chip.label} · <span className="text-foliage">hard rule</span>
          </span>
          <span className="font-sans text-[11px] italic text-fg-muted">{chip.basis}</span>
        </div>
        <button
          type="button"
          onClick={onReopen}
          className="font-sans text-[11px] text-fg-muted underline hover:text-fg transition-colors"
        >
          Change
        </button>
      </div>
    );
  }
  if (state === 'downgraded') {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-foliage/40 bg-foliage-soft/40 px-4 py-3 text-left">
        <div className="flex flex-col gap-0.5">
          <span className="font-sans text-sm text-fg">
            {chip.label} · <span className="italic text-fg-muted">preference</span>
          </span>
          <span className="font-sans text-[11px] italic text-fg-muted">{chip.basis}</span>
        </div>
        <button
          type="button"
          onClick={onReopen}
          className="font-sans text-[11px] text-fg-muted underline hover:text-fg transition-colors"
        >
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber/40 bg-amber/5 px-4 py-3 text-left">
      <div className="flex flex-col gap-0.5">
        <span className="font-sans text-sm font-medium text-fg">{chip.label}</span>
        <span className="font-sans text-[11px] italic text-fg-muted">{chip.basis}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="inline-flex items-center gap-1.5 rounded-full bg-foliage px-3.5 py-1.5 font-sans text-xs font-medium text-bg hover:bg-foliage-soft hover:text-fg transition-colors"
        >
          <IcoCheck cls="h-3.5 w-3.5" />
          Confirm — hard rule
        </button>
        <button
          type="button"
          onClick={onDowngrade}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/40 px-3.5 py-1.5 font-sans text-xs text-fg-muted hover:text-fg hover:border-fg/30 transition-colors"
        >
          Just a preference
        </button>
      </div>
    </div>
  );
}

// ─── Gap callout — required-set incomplete ─────────────────────────────────

interface GapCalloutProps {
  readonly label: string;
  readonly moment: number;
  readonly note: string;
}

function GapCallout({ label, moment, note }: GapCalloutProps) {
  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border border-amber-warm/50 bg-amber/5 px-4 py-3 text-left">
      <div className="flex items-center justify-between gap-3">
        <span className="font-sans text-sm font-medium text-amber-warm">
          Still missing · {label}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-amber-warm/40 px-3 py-1 font-sans text-[11px] text-amber-warm hover:bg-amber-warm/10 transition-colors"
        >
          <IcoBackArrow cls="h-3 w-3" />
          Back to Moment {moment}
        </button>
      </div>
      <p className="font-sans text-[12px] italic text-fg-muted">{note}</p>
    </div>
  );
}

// ─── Finalize status line (left of CTA) ────────────────────────────────────

interface FinalizeStatusProps {
  readonly allResolved: boolean;
  readonly requiredSetComplete: boolean;
  readonly bagMissing: boolean;
}

function FinalizeStatus({ allResolved, requiredSetComplete, bagMissing }: FinalizeStatusProps) {
  if (!requiredSetComplete && bagMissing) {
    return (
      <p className="flex-1 font-sans text-[13px] italic text-amber-warm">
        Bag composition still open — jump back to Moment 4.
      </p>
    );
  }
  if (!allResolved) {
    return (
      <p className="flex-1 font-sans text-[13px] italic text-fg-muted">
        Confirm the hard rules above to seal the kitchen.
      </p>
    );
  }
  return (
    <p className="flex-1 font-sans text-[13px] italic text-foliage">
      Ready when you are.
    </p>
  );
}

// ─── Gate line — narrative status under the action bar ─────────────────────

interface GateLineProps {
  readonly scenario: DemoScenario;
  readonly allResolved: boolean;
  readonly requiredSetComplete: boolean;
  readonly bagMissing: boolean;
}

function GateLine({ scenario, allResolved, requiredSetComplete, bagMissing }: GateLineProps) {
  if (scenario === 'finalized') {
    return (
      <p className="text-center font-sans text-xs italic text-foliage">
        Kitchen finalized — Lumi is taking it from here.
      </p>
    );
  }
  if (!requiredSetComplete && bagMissing) {
    return (
      <p className="text-center font-sans text-xs italic text-amber-warm">
        Required — the bag shape is part of the kitchen. We’ll seal it once Moment 4 is in.
      </p>
    );
  }
  if (!allResolved) {
    return (
      <p className="text-center font-sans text-xs italic text-fg-muted">
        Each hard rule needs a yes-or-no before Lumi locks it in.
      </p>
    );
  }
  return (
    <p className="text-center font-sans text-xs italic text-fg-muted">
      Finalize seals your kitchen and starts your first plan.
    </p>
  );
}

// ─── Kitchen Profile panel — fully populated read-back ─────────────────────

interface KitchenProfilePanelProps {
  readonly captured: CapturedProfile;
  readonly elevationStates: Record<string, ElevationState>;
  readonly finalized: boolean;
}

function KitchenProfilePanel({ captured, elevationStates, finalized }: KitchenProfilePanelProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-7 pt-8 pb-5">
        <h2 className="font-serif text-[22px] font-normal leading-tight text-fg">
          Your Kitchen Profile
        </h2>
        <p
          className={[
            'mt-2 flex items-center gap-1.5 font-sans text-[11px]',
            finalized ? 'text-foliage' : 'text-amber',
          ].join(' ')}
        >
          <span
            className={[
              'h-1.5 w-1.5 rounded-full',
              finalized ? 'bg-foliage' : 'bg-amber animate-pulse',
            ].join(' ')}
          />
          {finalized ? 'Sealed' : 'Ready to seal'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4 flex flex-col gap-3">
        <ProfileCard icon={<IcoHome cls="h-4 w-4 shrink-0 text-amber-soft" />} title="Your kitchen">
          <p className="font-sans text-base italic text-fg">{captured.householdName}</p>
        </ProfileCard>

        <ProfileCard icon={<IcoUsers cls="h-4 w-4 shrink-0 text-amber-soft" />} title="Family">
          <div className="flex flex-wrap gap-2">
            {captured.children.map((child, i) => (
              <span
                key={i}
                className="flex items-center gap-1.5 rounded-full bg-foliage-soft px-3 py-1.5 font-sans text-xs font-medium text-fg"
              >
                <IcoUsers cls="h-3 w-3 shrink-0" />
                {child.name}
                {child.ageBand && ` (${child.ageBand})`}
              </span>
            ))}
          </div>
        </ProfileCard>

        <ProfileCard
          icon={<IcoShield cls="h-4 w-4 shrink-0 text-safety-cleared" />}
          title="Safety — allergens"
        >
          <div className="space-y-2.5">
            {captured.allergens.map((a) => (
              <div key={a.child} className="space-y-1.5">
                <p className="font-sans text-[10px] font-semibold uppercase tracking-widest text-fg-muted/55">
                  {a.child}
                </p>
                {a.items.length === 0 ? (
                  <p className="font-sans text-[12px] italic text-fg-muted">No known allergens</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {a.items.map((item) => {
                      const locked = elevationStates['layla-nuts'] === 'confirmed';
                      return (
                        <span
                          key={item}
                          className={[
                            'flex items-center gap-1 rounded-md px-2.5 py-1 font-sans text-xs',
                            locked
                              ? 'border-2 border-safety-cleared bg-safety-cleared-fill text-safety-cleared font-medium'
                              : 'bg-safety-cleared-fill text-safety-cleared',
                          ].join(' ')}
                        >
                          <IcoShield cls="h-3 w-3 shrink-0" />
                          {item}
                          {locked && (
                            <span className="text-[10px] uppercase tracking-wide">· rule</span>
                          )}
                        </span>
                      );
                    })}
                    {a.medical && (
                      <span className="font-sans text-[11px] italic text-fg-muted">
                        medical
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </ProfileCard>

        <ProfileCard
          icon={<IcoGlobe cls="h-4 w-4 shrink-0 text-amber-soft" />}
          title="Your kitchen’s taste"
        >
          <div>
            <p className="mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-widest text-fg-muted/55">
              Cultural & religious
            </p>
            <div className="flex flex-wrap gap-1.5">
              {captured.taste.cultural.map((c, i) => {
                const elevationState = c.elevationId ? elevationStates[c.elevationId] : undefined;
                const locked = elevationState === 'confirmed';
                return (
                  <span
                    key={i}
                    className={[
                      'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-sans text-xs',
                      c.enforcement === 'always'
                        ? locked
                          ? 'border-2 border-foliage bg-foliage-soft text-fg font-medium'
                          : 'border border-amber/50 bg-amber/15 text-fg italic'
                        : c.enforcement === 'prefer'
                          ? 'border border-foliage bg-foliage-soft/70 text-fg'
                          : 'bg-surface-2/50 text-fg-muted italic',
                    ].join(' ')}
                  >
                    {c.label}
                    {locked && (
                      <span className="text-[10px] uppercase tracking-wide text-foliage">
                        · rule
                      </span>
                    )}
                    {c.enforcement === 'always' && !locked && (
                      <span className="text-[10px] uppercase tracking-wide text-amber-warm">
                        · awaiting confirm
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        </ProfileCard>

        <ProfileCard
          icon={<IcoLunchBag cls="h-4 w-4 shrink-0 text-amber-soft" />}
          title="What goes in the bag"
          missing={!captured.bag.household}
          missingLabel="Bag composition not yet set"
        >
          {captured.bag.household && (
            <span className="inline-block rounded-md border border-foliage/60 bg-foliage-soft px-3 py-1.5 font-sans text-sm text-fg">
              {captured.bag.household}
            </span>
          )}
        </ProfileCard>

        <ProfileCard
          icon={<IcoSeed cls="h-4 w-4 shrink-0 text-amber-soft" />}
          title="Lumi’s starting line"
        >
          <div className="space-y-2.5">
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-2xl text-foliage">
                {captured.startingLine.count}
              </span>
              <span className="font-sans text-xs text-fg-muted">
                of 10{captured.startingLine.overridden ? ' · starting with fewer' : ''}
              </span>
            </div>
            {captured.startingLine.preview.length > 0 && (
              <div>
                <p className="mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-widest text-fg-muted/55">
                  Recent picks
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {captured.startingLine.preview.map((item) => (
                    <span
                      key={item}
                      className="rounded-md bg-surface-2/50 px-2.5 py-1 font-sans text-xs text-fg"
                    >
                      {item}
                    </span>
                  ))}
                  {captured.startingLine.count > captured.startingLine.preview.length && (
                    <span className="rounded-md px-2.5 py-1 font-sans text-xs italic text-fg-muted">
                      +{captured.startingLine.count - captured.startingLine.preview.length} more
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </ProfileCard>
      </div>

      <div className="shrink-0 px-7 pt-4 pb-7">
        <div className="flex items-center justify-between mb-3">
          <span className="font-sans text-[13px] text-fg-muted">
            {finalized ? 'Kitchen sealed' : 'All moments captured'}
          </span>
          <span
            className={[
              'font-serif text-base',
              finalized ? 'text-foliage' : 'text-amber',
            ].join(' ')}
          >
            {finalized ? '✓' : '100%'}
          </span>
        </div>
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className={[
              'h-full rounded-full transition-all duration-700 ease-out',
              finalized ? 'bg-foliage' : 'bg-amber',
            ].join(' ')}
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </div>
  );
}

interface ProfileCardProps {
  readonly icon?: React.ReactNode;
  readonly title?: string;
  readonly children?: React.ReactNode;
  readonly missing?: boolean;
  readonly missingLabel?: string;
}

function ProfileCard({ icon, title, children, missing, missingLabel }: ProfileCardProps) {
  if (missing) {
    return (
      <div className="rounded-xl p-5 bg-amber/5 border border-amber-warm/30">
        {title && (
          <div className="flex items-center gap-2 mb-2">
            {icon}
            <h3 className="font-serif text-base text-fg">{title}</h3>
          </div>
        )}
        <p className="font-sans text-[12px] italic text-amber-warm">{missingLabel}</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl p-5 bg-surface-2/60">
      {title && (
        <div className="flex items-center gap-2 mb-3">
          {icon}
          <h3 className="font-serif text-base text-fg">{title}</h3>
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Demo toggle ────────────────────────────────────────────────────────────

interface DemoToggleProps {
  readonly current: DemoScenario;
  readonly onChange: (next: DemoScenario) => void;
}

function DemoToggle({ current, onChange }: DemoToggleProps) {
  const scenarios = (Object.entries(SCENARIOS) as Array<[DemoScenario, ScenarioConfig]>).map(
    ([key, cfg]) => ({ key, label: cfg.label, desc: cfg.desc }),
  );

  return (
    <div className="border-b border-neutral-400/30 bg-surface/30 px-6 py-2.5">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-xs">
        <span className="font-sans uppercase tracking-[0.18em] text-memory-provenance-500">
          Mockup demo — elevation confirmation + finalize gate
        </span>
        <div className="flex flex-wrap gap-1">
          {scenarios.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onChange(s.key)}
              title={s.desc}
              className={[
                'rounded-md px-3 py-1 font-sans transition-colors',
                current === s.key
                  ? 'bg-foliage-soft text-fg border border-foliage/60'
                  : 'border border-border/30 text-fg-muted hover:text-fg hover:bg-warm-neutral-50',
              ].join(' ')}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

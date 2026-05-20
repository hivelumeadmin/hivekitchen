import { useEffect, useRef, useState } from 'react';
import { ChoiceChip } from './components/ChoiceChip.js';
import { type ChipOption } from './components/ChoiceChipGroup.js';
import { HintChip } from './components/HintChip.js';
import { HistoryView } from './components/HistoryView.js';
import { SkipChip } from './components/SkipChip.js';
import {
  MOMENT_3_LUMI,
  PRIOR_HISTORY_MOMENT_3,
  type ChatTurn,
} from './data/conversation-history.js';

// ─── Inline SVG icons — match OnboardingText.tsx pattern ───────────────────

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
function IcoSend({ cls }: { cls: string }) {
  return (
    <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
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

// ─── Demo scenarios — three patterns for the densest moment ───────────────

type DemoScenario = 'broad-hint' | 'elevation' | 'skip-visible';

const elevationOptions: ChipOption[] = [
  { key: 'always-respect', label: 'Always respect' },
  { key: 'prefer', label: 'Prefer when possible' },
  { key: 'just-context', label: 'Just for context' },
];

interface LumiState {
  prose: string;
  chipMode: 'hint' | 'action';
  hints?: string[];
  options?: ChipOption[];
  showSkip: boolean;
  placeholder: string;
  description: string; // for the demo toggle
  preFilledDraft?: string;
  preFilledChips?: string[];
}

const SCENARIOS: Record<DemoScenario, LumiState> = {
  // Scenario A — broad open question with hint chips. Primary Moment 3
  // entry. Captures identity + dietary + cuisine in ONE rich response.
  'broad-hint': {
    prose:
      "Now tell me how your kitchen tastes — what flavors live in your house? Anything I should lean into or stay clear of?",
    chipMode: 'hint',
    hints: [
      'Halal Punjabi household, mostly home-cooked Indian',
      'Italian heritage, kids love pasta — dairy-light for the youngest',
      'Hindu vegetarian — South Indian for me, Mexican for them',
    ],
    showSkip: true,
    placeholder: 'Tell me what your kitchen feels like — cultures, dietary habits, what you love…',
    description: 'Broad question + hints — captures identity, dietary, cuisine in one turn. Skip available.',
  },

  // Scenario B — inline elevation prompt. Fires when the parent has just
  // said something with strong-enforcement language ("strictly Halal").
  // The agent confirms the elevation level with action chips.
  elevation: {
    prose:
      "Got it — &ldquo;strictly Halal.&rdquo; Should I treat that as a hard rule I always respect, or more like a preference?",
    chipMode: 'action',
    options: elevationOptions,
    showSkip: false,
    placeholder: 'Tap one above, or add a note…',
    description: 'Inline elevation confirmation — action chips for the 3-level enforcement gradient.',
    preFilledChips: ['always-respect'],
  },

  // Scenario C — the skip-this-moment landing state. Parent might not
  // want to share cultural details right now. Skip is first-class.
  'skip-visible': {
    prose:
      "Want to tell me how your kitchen tastes? Cultures, dietary habits, anything you'd like me to know — or skip and tell me anytime.",
    chipMode: 'hint',
    hints: [
      "I'll come back to this later",
      "We're a Halal household, that's the main thing",
      "Mostly Italian, no strict rules",
    ],
    showSkip: true,
    placeholder: "Or describe in your own words…",
    description: 'Optional-moment framing — Skip chip first-class alongside hints.',
  },
};

interface CapturedProfile {
  householdName: string;
  children: Array<{ name: string; ageBand: string }>;
  allergens: { state: 'declared' | 'all-clear'; items: string[]; note?: string };
  taste: {
    state: 'capturing' | 'partial' | 'confirmed-hard';
    cultural: Array<{ label: string; enforcement?: 'always' | 'prefer' | 'context' }>;
    dietary: string[];
    cuisine: string[];
  };
}

const CAPTURED_PER_SCENARIO: Record<DemoScenario, CapturedProfile> = {
  'broad-hint': {
    householdName: 'The Khan-Patel family kitchen',
    children: [
      { name: 'Layla', ageBand: '10–12' },
      { name: 'Adam', ageBand: '10–12' },
    ],
    allergens: { state: 'declared', items: ['Peanut', 'Tree nuts'], note: 'Layla — medical' },
    taste: { state: 'capturing', cultural: [], dietary: [], cuisine: [] },
  },
  elevation: {
    householdName: 'The Khan-Patel family kitchen',
    children: [
      { name: 'Layla', ageBand: '10–12' },
      { name: 'Adam', ageBand: '10–12' },
    ],
    allergens: { state: 'declared', items: ['Peanut', 'Tree nuts'], note: 'Layla — medical' },
    taste: {
      state: 'partial',
      cultural: [
        { label: 'Halal', enforcement: 'always' },
        { label: 'Punjabi', enforcement: 'prefer' },
      ],
      dietary: [],
      cuisine: ['Indian'],
    },
  },
  'skip-visible': {
    householdName: 'The Khan-Patel family kitchen',
    children: [
      { name: 'Layla', ageBand: '10–12' },
      { name: 'Adam', ageBand: '10–12' },
    ],
    allergens: { state: 'declared', items: ['Peanut', 'Tree nuts'], note: 'Layla — medical' },
    taste: { state: 'capturing', cultural: [], dietary: [], cuisine: [] },
  },
};

export function Moment3Page() {
  const [scenario, setScenario] = useState<DemoScenario>('broad-hint');
  const [draft, setDraft] = useState('');
  const [selectedChips, setSelectedChips] = useState<string[]>(
    SCENARIOS['broad-hint'].preFilledChips ?? [],
  );
  const [skipped, setSkipped] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  // Auto-grow textarea — height tracks content up to a ~5-line cap.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const historyTurns: ChatTurn[] = [
    ...PRIOR_HISTORY_MOMENT_3,
    { ...MOMENT_3_LUMI, content: SCENARIOS[scenario].prose },
  ];

  const state = SCENARIOS[scenario];
  const captured = CAPTURED_PER_SCENARIO[scenario];

  const hasResponse =
    draft.trim().length > 0 || selectedChips.length > 0 || skipped;

  function handleScenarioChange(next: DemoScenario) {
    setScenario(next);
    setDraft(SCENARIOS[next].preFilledDraft ?? '');
    setSelectedChips(SCENARIOS[next].preFilledChips ?? []);
    setSkipped(false);
  }

  function handleChipTap(key: string) {
    if (state.chipMode === 'action') {
      setSelectedChips([key]); // single-select
      setSkipped(false);
    }
  }

  function handleSkip() {
    setSkipped((s) => !s);
    if (!skipped) {
      setSelectedChips([]);
      setDraft('');
    }
  }

  function handleSend() {
    setDraft('');
    setSelectedChips([]);
    setSkipped(false);
  }

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
                Moment 3 of 5 · How your kitchen tastes
                <span className="ml-2 text-fg-muted/60 normal-case tracking-normal">
                  (optional)
                </span>
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

          {/* Lumi area — focused mode OR full history bubbles */}
          {showHistory ? (
            <HistoryView turns={historyTurns} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-start overflow-y-auto px-6 md:px-8 py-8 min-h-0">
              <div className="flex flex-col items-center gap-6 text-center max-w-2xl w-full">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber/20 bg-amber/10">
                  <IcoWaveform cls="h-6 w-6 animate-pulse text-amber" />
                </div>
                <p
                  className="font-serif text-2xl md:text-[28px] leading-snug text-fg"
                  dangerouslySetInnerHTML={{ __html: state.prose }}
                />

                {/* Chips — in flow under the Lumi turn, above the input */}
                <div className="flex w-full flex-col items-center gap-3 pt-1">
                  {state.chipMode === 'hint' && state.hints && (
                    <>
                      <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
                        Something like
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {state.hints.map((hint, i) => (
                          <HintChip key={i} text={hint} />
                        ))}
                      </div>
                    </>
                  )}

                  {state.chipMode === 'action' && state.options && (
                    <>
                      <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
                        Tap one
                      </p>
                      <div
                        role="radiogroup"
                        aria-label="Enforcement level"
                        className="flex flex-wrap justify-center gap-2"
                      >
                        {state.options.map((opt) => (
                          <ChoiceChip
                            key={opt.key}
                            label={opt.label}
                            mode="single"
                            selected={selectedChips.includes(opt.key)}
                            onClick={() => handleChipTap(opt.key)}
                          />
                        ))}
                      </div>
                    </>
                  )}

                  {/* Skip chip — first-class on optional moments. Visually separated. */}
                  {state.showSkip && (
                    <div className="mt-1 flex items-center justify-center">
                      <SkipChip
                        onClick={handleSkip}
                        label={skipped ? 'Skipped — tap to undo' : 'Skip this moment'}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Input bar — disabled if skipped */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (hasResponse) handleSend();
            }}
            className="shrink-0 px-6 md:px-8 pb-10 pt-2"
          >
            <label htmlFor="onboarding-message" className="sr-only">
              Your message to Lumi
            </label>
            <div
              className={[
                'flex items-end gap-2 rounded-2xl border px-2 py-1.5 backdrop-blur-md transition-colors shadow-lg',
                skipped
                  ? 'border-neutral-400/20 bg-surface/30 opacity-50'
                  : 'border-neutral-400/30 bg-surface/50 focus-within:border-amber/50',
              ].join(' ')}
            >
              <textarea
                ref={textareaRef}
                id="onboarding-message"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${el.scrollHeight}px`;
                }}
                rows={1}
                maxLength={400}
                disabled={skipped}
                placeholder={skipped ? 'Moment skipped — Send to continue' : state.placeholder}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (hasResponse) handleSend();
                  }
                }}
                style={{ maxHeight: '9.5rem' }}
                className="flex-1 resize-none overflow-y-auto bg-transparent px-4 py-2 font-sans text-[17px] leading-snug text-fg placeholder:text-fg-muted/40 focus:outline-none disabled:cursor-not-allowed transition-[height] duration-150 ease-out"
              />
              <button
                type="submit"
                disabled={!hasResponse}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber text-bg shadow-md hover:bg-amber-warm disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                aria-label="Send"
              >
                <IcoSend cls="h-5 w-5" />
              </button>
            </div>
            {/* Status line */}
            {skipped ? (
              <p className="mt-2 text-center font-sans text-xs italic text-foliage">
                Skipping this moment — tap Send to move on. You can tell Lumi anytime later.
              </p>
            ) : selectedChips.length > 0 ? (
              <p className="mt-2 text-center font-sans text-xs italic text-foliage">
                {state.chipMode === 'action'
                  ? `${elevationOptions.find((o) => o.key === selectedChips[0])?.label} — confirmed`
                  : `${selectedChips.length} selection${selectedChips.length === 1 ? '' : 's'} will be sent with your message`}
              </p>
            ) : null}
          </form>
        </section>

        {/* RIGHT: Live Kitchen Profile */}
        <section
          className="relative hidden md:flex md:w-[40%] flex-col bg-surface overflow-hidden"
          aria-label="Your Kitchen Profile"
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-surface to-bg opacity-50" />
          <div className="relative flex flex-1 flex-col overflow-hidden z-10">
            <KitchenProfilePanel captured={captured} />
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
            <KitchenProfilePanel captured={captured} />
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Kitchen Profile panel — Moment 3 introduces the Taste section ────────

function KitchenProfilePanel({ captured }: { captured: CapturedProfile }) {
  const moment3Done =
    captured.taste.state === 'partial' || captured.taste.state === 'confirmed-hard';
  const completedMoments = 2 + (moment3Done ? 1 : 0);
  const progressPct = (completedMoments / 5) * 100;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-7 pt-8 pb-5">
        <h2 className="font-serif text-[22px] font-normal leading-tight text-fg">
          Your Kitchen Profile
        </h2>
        <p className="mt-2 flex items-center gap-1.5 font-sans text-[11px] text-amber">
          <span className="h-1.5 w-1.5 rounded-full bg-amber animate-pulse" />
          Building as we talk…
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4 flex flex-col gap-3">
        <ProfileCard icon={<IcoHome cls="h-4 w-4 shrink-0 text-amber-soft" />} title="Your kitchen" active waitingLabel="Kitchen name">
          <p className="font-sans text-base italic text-fg">{captured.householdName}</p>
        </ProfileCard>

        <ProfileCard icon={<IcoUsers cls="h-4 w-4 shrink-0 text-amber-soft" />} title="Family" active waitingLabel="Family members">
          <div className="flex flex-wrap gap-2">
            {captured.children.map((child, i) => (
              <span key={i} className="flex items-center gap-1.5 rounded-full bg-foliage-soft px-3 py-1.5 font-sans text-xs font-medium text-fg">
                <IcoUsers cls="h-3 w-3 shrink-0" />
                {child.name}
                {child.ageBand && ` (${child.ageBand})`}
              </span>
            ))}
          </div>
        </ProfileCard>

        <ProfileCard icon={<IcoShield cls="h-4 w-4 shrink-0 text-safety-cleared" />} title="Safety — allergens" active waitingLabel="Safety — allergens">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {captured.allergens.items.map((a) => (
                <span key={a} className="flex items-center gap-1 rounded-md bg-safety-cleared-fill px-2.5 py-1 font-sans text-xs text-safety-cleared">
                  <IcoShield cls="h-3 w-3 shrink-0" />
                  {a}
                </span>
              ))}
            </div>
            {captured.allergens.note && (
              <p className="font-sans text-[11px] italic text-fg-muted">{captured.allergens.note}</p>
            )}
          </div>
        </ProfileCard>

        {/* Taste — the Moment 3 section */}
        <ProfileCard
          icon={<IcoGlobe cls="h-4 w-4 shrink-0 text-amber-soft" />}
          title="Your kitchen's taste"
          active={captured.taste.state !== 'capturing'}
          waitingLabel="Your kitchen's taste"
        >
          {captured.taste.state === 'capturing' && (
            <p className="font-sans text-xs italic text-fg-muted">Waiting on your response…</p>
          )}
          {(captured.taste.state === 'partial' || captured.taste.state === 'confirmed-hard') && (
            <div className="space-y-3">
              {captured.taste.cultural.length > 0 && (
                <div>
                  <p className="mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-widest text-fg-muted/55">
                    Cultural & religious
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {captured.taste.cultural.map((c, i) => (
                      <span
                        key={i}
                        className={[
                          'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-sans text-xs',
                          c.enforcement === 'always'
                            ? 'border-2 border-foliage bg-foliage-soft text-fg font-medium'
                            : c.enforcement === 'prefer'
                              ? 'border border-foliage/60 bg-foliage-soft/50 text-fg'
                              : 'bg-warm-neutral-100/60 text-fg-muted italic',
                        ].join(' ')}
                      >
                        {c.label}
                        {c.enforcement === 'always' && (
                          <span className="text-[10px] uppercase tracking-wide text-foliage">
                            · rule
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {captured.taste.cuisine.length > 0 && (
                <div>
                  <p className="mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-widest text-fg-muted/55">
                    Cuisine
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {captured.taste.cuisine.map((c) => (
                      <span
                        key={c}
                        className="rounded-md bg-warm-neutral-100/60 px-2.5 py-1 font-sans text-xs text-fg"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </ProfileCard>

        <ProfileCard active={false} waitingLabel="What goes in the bag" />
        <ProfileCard active={false} waitingLabel="Lumi's starting line" />
      </div>

      <div className="shrink-0 px-7 pt-4 pb-7">
        <div className="flex items-center justify-between mb-3">
          <span className="font-sans text-[13px] text-fg-muted">
            Moment {completedMoments} of 5 complete
          </span>
          <span className="font-serif text-base text-amber">
            {Math.round(progressPct)}%
          </span>
        </div>
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-amber transition-all duration-700 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

interface ProfileCardProps {
  icon?: React.ReactNode;
  title?: string;
  active: boolean;
  waitingLabel: string;
  children?: React.ReactNode;
}

function ProfileCard({ icon, title, active, waitingLabel, children }: ProfileCardProps) {
  if (active) {
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
  return (
    <div className="rounded-xl p-4 flex items-center gap-3.5 bg-surface">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber/10">
        {icon ?? <IcoUsers cls="h-[15px] w-[15px] text-amber/50" />}
      </div>
      <div>
        <p className="font-sans text-sm font-medium text-fg/55">{waitingLabel}</p>
        <p className="font-sans text-[11px] mt-0.5 text-fg-muted/40">Still listening…</p>
      </div>
    </div>
  );
}

// ─── Demo toggle ────────────────────────────────────────────────────────────

interface DemoToggleProps {
  current: DemoScenario;
  onChange: (next: DemoScenario) => void;
}

function DemoToggle({ current, onChange }: DemoToggleProps) {
  const scenarios = (Object.entries(SCENARIOS) as Array<[DemoScenario, LumiState]>).map(
    ([key, cfg]) => ({ key, label: scenarioLabel(key), desc: cfg.description }),
  );

  return (
    <div className="border-b border-neutral-400/30 bg-surface/30 px-6 py-2.5">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-xs">
        <span className="font-sans uppercase tracking-[0.18em] text-memory-provenance-500">
          Mockup demo — three Moment 3 patterns
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

function scenarioLabel(key: DemoScenario): string {
  switch (key) {
    case 'broad-hint':
      return 'Broad question · HINTS + Skip';
    case 'elevation':
      return 'Inline elevation · ACTION chips';
    case 'skip-visible':
      return 'Skip-this-moment first-class';
  }
}

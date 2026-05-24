import { useEffect, useMemo, useRef, useState } from 'react';
import { HintChip } from '@/features/onboarding/components/HintChip.js';
import { SkipChip } from '@/features/onboarding/components/SkipChip.js';
import { HistoryView } from './components/HistoryView.js';
import type { ChatTurn } from './data/conversation-history.js';

// Mockup — Moment 3 (How your kitchen tastes) with cohort toggle.
//
// Mirrors the canonical Moment3Page broad-hint scenario. M3 is the
// optional moment — skip is first-class. Captures cultural priors,
// dietary, cuisine in one rich response. The elevation sub-flow
// (action chips for "Always respect / Prefer / Just for context") is
// intentionally OUT of scope here — that's a follow-up Lumi turn that
// fires after a parent uses strong-enforcement language. The personalized
// mockup focuses on the entry state.
//
// Hint chips are universal illustrative examples. The cohort variation
// is the captured profile state (M1+M2 already filled per cohort), the
// prior conversation history, and the typical draft response.

// ─── Inline SVG icons ──────────────────────────────────────────────────────

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

const LUMI_PROSE =
  "Now tell me how your kitchen tastes — what flavors live in your house? Anything I should lean into or stay clear of?";

const UNIVERSAL_HINTS = [
  'Halal Punjabi household, mostly home-cooked Indian',
  'Italian heritage, kids love pasta — dairy-light for the youngest',
  'Hindu vegetarian — South Indian for me, Mexican for them',
];

// ─── Cohort fixtures ──────────────────────────────────────────────────────

type CohortId = 'anglo' | 'somali';

interface CohortFixture {
  id: CohortId;
  label: string;
  desc: string;
  cohortClass: 'served-by-precedent' | 'to-validate · lowest-confidence';
  householdName: string;
  children: Array<{ name: string; ageBand: string }>;
  allergens: { state: 'declared' | 'all-clear'; items: string[]; note?: string };
  initialDraft: string;
  priorHistory: ChatTurn[];
}

const ANGLO_PRIOR: ChatTurn[] = [
  {
    id: 'a-m1-lumi',
    role: 'lumi',
    content:
      "Hi, welcome to your kitchen. Let&rsquo;s start with who&rsquo;s at the table — what should I call your household, and who are you creating lunches for?",
  },
  { id: 'a-m1-parent', role: 'parent', content: 'Miller family. Just my son Sam, he&rsquo;s eight, about to turn nine.' },
  {
    id: 'a-m2-lumi',
    role: 'lumi',
    content: 'Got it — Sam, eight. Anything I have to keep safe from? Any food allergies or sensitivities for him?',
  },
  { id: 'a-m2-parent', role: 'parent', content: 'No allergies — we&rsquo;re lucky there.' },
];

const SOMALI_PRIOR: ChatTurn[] = [
  {
    id: 's-m1-lumi',
    role: 'lumi',
    content:
      "Hi, welcome to your kitchen. Let&rsquo;s start with who&rsquo;s at the table — what should I call your household, and who are you creating lunches for?",
  },
  { id: 's-m1-parent', role: 'parent', content: 'Hassan family. Two kids — Amina, she&rsquo;s nine and a half, and Yusuf, six.' },
  {
    id: 's-m2-lumi',
    role: 'lumi',
    content: 'Got it — Amina and Yusuf. Any food allergies or sensitivities for either of them?',
  },
  {
    id: 's-m2-parent',
    role: 'parent',
    content: 'Yusuf has an egg allergy — it&rsquo;s medical, his throat closes. Amina is fine.',
  },
];

const COHORTS: Record<CohortId, CohortFixture> = {
  anglo: {
    id: 'anglo',
    label: 'Anglo · Mediterranean',
    desc: 'Served-by-precedent baseline. Soft cuisine identity, no hard rules.',
    cohortClass: 'served-by-precedent',
    householdName: 'The Miller family kitchen',
    children: [{ name: 'Sam', ageBand: '8–9' }],
    allergens: { state: 'all-clear', items: [] },
    initialDraft: 'Pretty straightforward — Anglo, some Mediterranean. Sandwiches, pasta, grilled chicken. Sam loves anything with cheese.',
    priorHistory: ANGLO_PRIOR,
  },
  somali: {
    id: 'somali',
    label: 'Somali · East African',
    desc: 'Lowest-confidence cohort with strong cultural rule (Halal — strictly).',
    cohortClass: 'to-validate · lowest-confidence',
    householdName: 'The Hassan family kitchen',
    children: [
      { name: 'Amina', ageBand: '9–10' },
      { name: 'Yusuf', ageBand: '6–7' },
    ],
    allergens: { state: 'declared', items: ['Egg'], note: 'Yusuf — medical' },
    initialDraft: "We&rsquo;re Somali. Halal of course. Cooking is mostly traditional — anjero, sambusas, basbaas, suugo on the bariis. Kids will eat plain rice or fruit on a slow day, but I want them eating what they grew up with.",
    priorHistory: SOMALI_PRIOR,
  },
};

const COHORT_ORDER: CohortId[] = ['anglo', 'somali'];

// ─── Per-cohort state ─────────────────────────────────────────────────────

interface CohortState {
  draft: string;
  skipped: boolean;
}

const initialState: Record<CohortId, CohortState> = {
  anglo: { draft: COHORTS.anglo.initialDraft, skipped: false },
  somali: { draft: COHORTS.somali.initialDraft, skipped: false },
};

// ─── Page ─────────────────────────────────────────────────────────────────

export function Moment3PersonalizedPage() {
  const [activeCohort, setActiveCohort] = useState<CohortId>('somali');
  const [cohortStates, setCohortStates] = useState<Record<CohortId, CohortState>>(initialState);
  const [showHistory, setShowHistory] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const cohort = COHORTS[activeCohort];
  const state = cohortStates[activeCohort];
  const draft = state.draft;

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, activeCohort]);

  const hasResponse = draft.trim().length > 0 || state.skipped;

  const historyTurns: ChatTurn[] = useMemo(
    () => [...cohort.priorHistory, { id: `${cohort.id}-m3-lumi`, role: 'lumi', content: LUMI_PROSE }],
    [cohort.priorHistory, cohort.id],
  );

  function updateCohortState(cohortId: CohortId, next: Partial<CohortState>) {
    setCohortStates((prev) => ({ ...prev, [cohortId]: { ...prev[cohortId], ...next } }));
  }

  function setDraft(next: string) {
    updateCohortState(activeCohort, { draft: next });
  }

  function handleSkipToggle() {
    if (state.skipped) {
      updateCohortState(activeCohort, { skipped: false });
    } else {
      updateCohortState(activeCohort, { skipped: true, draft: '' });
    }
  }

  function handleSend() {
    updateCohortState(activeCohort, { draft: '', skipped: false });
  }

  const placeholder = 'Tell me what your kitchen feels like — cultures, dietary habits, what you love…';

  return (
    <>
      <CohortToggle current={activeCohort} onChange={setActiveCohort} />

      <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden">
        <section className="relative flex flex-1 md:w-[60%] md:flex-none flex-col bg-bg">
          <header className="shrink-0 flex items-center justify-between bg-bg/80 px-6 md:px-8 py-5 backdrop-blur-sm">
            <div className="flex flex-col gap-1">
              <h1 className="font-serif text-xl font-medium tracking-tight text-amber">HiveKitchen</h1>
              <span className="font-sans text-[11px] font-medium uppercase tracking-widest text-fg-muted">
                Moment 3 of 5 · How your kitchen tastes
                <span className="ml-2 text-fg-muted/60 normal-case tracking-normal">(optional)</span>
                <span className="ml-2 text-fg">· personalized</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                title={showHistory ? 'Collapse history' : 'Show conversation history'}
                aria-pressed={showHistory}
                className={[
                  'flex h-9 w-9 items-center justify-center rounded-full border transition-colors',
                  showHistory ? 'border-amber/40 text-amber' : 'border-neutral-400/30 text-fg-muted hover:text-fg',
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
            <div className="flex flex-1 flex-col items-center justify-start overflow-y-auto px-6 md:px-8 py-8 min-h-0">
              <div className="flex flex-col items-center gap-6 text-center max-w-2xl w-full">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber/30 bg-amber/15">
                  <IcoWaveform cls="h-6 w-6 animate-pulse text-amber" />
                </div>
                <p className="font-serif text-2xl md:text-[28px] leading-snug text-fg">{LUMI_PROSE}</p>

                <div className="flex w-full flex-col items-center gap-3 pt-1">
                  <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
                    Something like
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {UNIVERSAL_HINTS.map((hint, i) => (
                      <HintChip key={i} text={hint} />
                    ))}
                  </div>
                  <div className="mt-2">
                    <SkipChip onClick={handleSkipToggle} label={state.skipped ? 'Skipped — tap to undo' : 'Skip — tell me later'} />
                  </div>
                </div>
              </div>
            </div>
          )}

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
            <div className="flex items-end gap-2 rounded-2xl border border-neutral-400/30 bg-surface/50 px-2 py-1.5 backdrop-blur-md focus-within:border-amber/50 transition-colors shadow-lg">
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
                placeholder={placeholder}
                disabled={state.skipped}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (hasResponse) handleSend();
                  }
                }}
                style={{ maxHeight: '9.5rem' }}
                className="flex-1 resize-none overflow-y-auto bg-transparent px-4 py-2 font-sans text-[17px] leading-snug text-fg placeholder:text-fg-muted/40 focus:outline-none disabled:opacity-50 transition-[height] duration-150 ease-out"
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
            {state.skipped ? (
              <p className="mt-2 text-center font-sans text-xs italic text-fg-muted">
                Skip — Lumi will ask again later when she has more context.
              </p>
            ) : !hasResponse ? (
              <p className="mt-2 text-center font-sans text-xs italic text-fg-muted">
                Optional — share what you&rsquo;d like, or skip and come back later.
              </p>
            ) : (
              <p className="mt-2 text-center font-sans text-xs italic text-foliage">
                Ready when you are — hit send and Lumi will pick up the cultures, dietary habits, and cuisines.
              </p>
            )}
          </form>
        </section>

        <section
          className="relative hidden md:flex md:w-[40%] flex-col bg-surface overflow-hidden"
          aria-label="Your Kitchen Profile"
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-surface-2/30 to-transparent" />
          <div className="relative flex flex-1 flex-col overflow-hidden z-10">
            <KitchenProfilePanel cohort={cohort} />
          </div>
        </section>
      </div>

      <div
        className={[
          'fixed inset-0 z-40 md:hidden transition-opacity duration-300',
          profileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
      >
        <div className="absolute inset-0 bg-black/60" onClick={() => setProfileOpen(false)} aria-hidden="true" />
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
            <KitchenProfilePanel cohort={cohort} />
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Kitchen Profile panel ────────────────────────────────────────────────

function KitchenProfilePanel({ cohort }: { cohort: CohortFixture }) {
  const completedMoments = 2; // M1 + M2 done at M3 entry
  const progressPct = (completedMoments / 5) * 100;
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-7 pt-8 pb-5">
        <h2 className="font-serif text-[22px] font-normal leading-tight text-fg">Your Kitchen Profile</h2>
        <p className="mt-2 flex items-center gap-1.5 font-sans text-[11px] text-amber">
          <span className="h-1.5 w-1.5 rounded-full bg-amber animate-pulse" />
          Building as we talk…
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4 flex flex-col gap-3">
        <ProfileCard active icon={<IcoHome cls="h-4 w-4 shrink-0 text-amber-soft" />} title="Your kitchen">
          <p className="font-sans text-base italic text-fg">{cohort.householdName}</p>
        </ProfileCard>

        <ProfileCard active icon={<IcoUsers cls="h-4 w-4 shrink-0 text-amber-soft" />} title="Family">
          <div className="flex flex-wrap gap-2">
            {cohort.children.map((child, i) => (
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

        <ProfileCard active icon={<IcoShield cls="h-4 w-4 shrink-0 text-safety-cleared" />} title="Safety — allergens">
          {cohort.allergens.state === 'all-clear' ? (
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-safety-cleared-fill px-2.5 py-1 font-sans text-xs text-safety-cleared">
                ✓ All clear
              </span>
              <span className="font-sans text-xs text-fg-muted">No known allergens</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {cohort.allergens.items.map((a) => (
                  <span
                    key={a}
                    className="flex items-center gap-1 rounded-md bg-safety-cleared-fill px-2.5 py-1 font-sans text-xs text-safety-cleared"
                  >
                    <IcoShield cls="h-3 w-3 shrink-0" />
                    {a}
                  </span>
                ))}
              </div>
              {cohort.allergens.note && (
                <p className="font-sans text-[11px] italic text-fg-muted">{cohort.allergens.note}</p>
              )}
            </div>
          )}
        </ProfileCard>

        {/* Taste — this moment (still capturing) */}
        <ProfileCard active={false} waitingLabel="Your kitchen's taste" icon={<IcoGlobe cls="h-[15px] w-[15px] text-amber/50" />} />
        <ProfileCard active={false} waitingLabel="What goes in the bag" />
        <ProfileCard active={false} waitingLabel="Lumi's starting line" />
      </div>

      <div className="shrink-0 px-7 pt-4 pb-7">
        <div className="flex items-center justify-between mb-3">
          <span className="font-sans text-[13px] text-fg-muted">Moment {completedMoments} of 5 complete</span>
          <span className="font-serif text-base text-amber">{Math.round(progressPct)}%</span>
        </div>
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-amber transition-all duration-700 ease-out" style={{ width: `${progressPct}%` }} />
        </div>
      </div>
    </div>
  );
}

interface ProfileCardProps {
  icon?: React.ReactNode;
  title?: string;
  active: boolean;
  waitingLabel?: string;
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
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber/15">
        {icon ?? <IcoUsers cls="h-[15px] w-[15px] text-amber/50" />}
      </div>
      <div>
        <p className="font-sans text-sm font-medium text-fg/55">{waitingLabel}</p>
        <p className="font-sans text-[11px] mt-0.5 text-fg-muted/40">Still listening…</p>
      </div>
    </div>
  );
}

function CohortToggle({ current, onChange }: { current: CohortId; onChange: (next: CohortId) => void }) {
  const active = COHORTS[current];
  return (
    <div className="border-b border-neutral-400/30 bg-surface/30 px-6 py-3">
      <div className="mx-auto flex max-w-7xl flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
            Pre-flight mockup · Moment 3 (how your kitchen tastes) · cohort toggle
          </span>
          <span className="font-serif text-sm text-fg">
            {active.label}
            <span className="ml-2 font-sans text-[11px] uppercase tracking-wide text-fg-muted">{active.cohortClass}</span>
          </span>
          <span className="font-sans text-[12px] text-fg-muted">{active.desc}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {COHORT_ORDER.map((id) => {
            const c = COHORTS[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => onChange(id)}
                title={c.desc}
                className={[
                  'rounded-md px-3 py-1.5 font-sans text-xs transition-colors',
                  current === id
                    ? 'bg-foliage-soft text-fg border border-foliage/60'
                    : 'border border-border/30 text-fg-muted hover:text-fg hover:bg-warm-neutral-50',
                ].join(' ')}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

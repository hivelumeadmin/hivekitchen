import { useEffect, useRef, useState } from 'react';
import { HintChip } from '@/features/onboarding/components/HintChip.js';
import { HistoryView } from './components/HistoryView.js';
import type { ChatTurn } from './data/conversation-history.js';

// Mockup — Moment 1 (Who's at the table) with cohort toggle.
//
// Mirrors the canonical Moment1Page broad-hint pattern. M1 is the entry
// point — there is no prior history. Hint chips show illustrative example
// responses (NOT clickable; pure cue). Parent answers via the textarea.
//
// Behavior matches Moment 2/3/4/5 personalized pages: cohort toggle at
// top, h-[calc(100vh-3.5rem)] container, two-column chat + profile,
// textarea is a generic chat input bound for /v1/onboarding/text/turn,
// send clears draft.

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

const LUMI_PROSE =
  "Hi, welcome to your kitchen. Let’s start with who’s at the table — what should I call your household, and who are you creating lunches for?";

// Universal hint examples — illustrative, not personalized. These are the
// production "Something like" hints intended to model the kind of answer
// Lumi can parse without prescribing what each cohort should say.
const UNIVERSAL_HINTS = [
  'Khan-Patel family kitchen — two kids, Layla 10 and Adam 12',
  'Sharma kitchen — three girls aged 5, 7, and 11',
  'Just my son Aarav, 8 years old',
];

// ─── Cohort fixtures ──────────────────────────────────────────────────────

type CohortId = 'anglo' | 'somali';

interface CohortFixture {
  id: CohortId;
  label: string;
  desc: string;
  cohortClass: 'served-by-precedent' | 'to-validate · lowest-confidence';
  // What the parent would TYPICALLY type at M1. Pre-fills the draft.
  initialDraft: string;
}

const COHORTS: Record<CohortId, CohortFixture> = {
  anglo: {
    id: 'anglo',
    label: 'Anglo · Mediterranean',
    desc: 'Served-by-precedent baseline. Single child.',
    cohortClass: 'served-by-precedent',
    initialDraft: 'Miller family. Just my son Sam, he’s eight, about to turn nine.',
  },
  somali: {
    id: 'somali',
    label: 'Somali · East African',
    desc: 'Two children with distinct names. Lowest-confidence cohort for Stage 1.',
    cohortClass: 'to-validate · lowest-confidence',
    initialDraft: 'Hassan family. Two kids — Amina, she’s nine and a half, and Yusuf, six.',
  },
};

const COHORT_ORDER: CohortId[] = ['anglo', 'somali'];

// ─── Per-cohort state ─────────────────────────────────────────────────────

interface CohortState {
  draft: string;
}

const initialState: Record<CohortId, CohortState> = {
  anglo: { draft: COHORTS.anglo.initialDraft },
  somali: { draft: COHORTS.somali.initialDraft },
};

// ─── Page ─────────────────────────────────────────────────────────────────

export function Moment1PersonalizedPage() {
  const [activeCohort, setActiveCohort] = useState<CohortId>('anglo');
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

  const hasResponse = draft.trim().length > 0;

  // M1 has no prior history — just the M1 Lumi turn itself.
  const historyTurns: ChatTurn[] = [
    { id: `${cohort.id}-m1-lumi`, role: 'lumi', content: LUMI_PROSE },
  ];

  function updateCohortState(cohortId: CohortId, next: Partial<CohortState>) {
    setCohortStates((prev) => ({ ...prev, [cohortId]: { ...prev[cohortId], ...next } }));
  }

  function setDraft(next: string) {
    updateCohortState(activeCohort, { draft: next });
  }

  function handleSend() {
    updateCohortState(activeCohort, { draft: '' });
  }

  const placeholder = 'Tell me about your family — names, ages, anything you want me to know…';

  return (
    <>
      <CohortToggle current={activeCohort} onChange={setActiveCohort} />

      <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden">
        {/* LEFT: Conversation column */}
        <section className="relative flex flex-1 md:w-[60%] md:flex-none flex-col bg-bg">
          <header className="shrink-0 flex items-center justify-between bg-bg/80 px-6 md:px-8 py-5 backdrop-blur-sm">
            <div className="flex flex-col gap-1">
              <h1 className="font-serif text-xl font-medium tracking-tight text-amber">HiveKitchen</h1>
              <span className="font-sans text-[11px] font-medium uppercase tracking-widest text-fg-muted">
                Moment 1 of 5 · Who&rsquo;s at the table · <span className="text-fg">personalized</span>
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
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber/20 bg-amber/10">
                  <IcoWaveform cls="h-6 w-6 animate-pulse text-amber" />
                </div>
                <p className="font-serif text-2xl md:text-[28px] leading-snug text-fg">{LUMI_PROSE}</p>

                <div className="flex w-full flex-col items-center gap-2 pt-1">
                  <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
                    Something like
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {UNIVERSAL_HINTS.map((hint, i) => (
                      <HintChip key={i} text={hint} />
                    ))}
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (hasResponse) handleSend();
                  }
                }}
                style={{ maxHeight: '9.5rem' }}
                className="flex-1 resize-none overflow-y-auto bg-transparent px-4 py-2 font-sans text-[17px] leading-snug text-fg placeholder:text-fg-muted/40 focus:outline-none transition-[height] duration-150 ease-out"
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
            {!hasResponse ? (
              <p className="mt-2 text-center font-sans text-xs italic text-amber/80">
                Required — tell me who&rsquo;s in your kitchen so I know who I&rsquo;m cooking for.
              </p>
            ) : (
              <p className="mt-2 text-center font-sans text-xs italic text-foliage">
                Ready when you are — hit send and I&rsquo;ll pick up the names, ages, and household feel.
              </p>
            )}
          </form>
        </section>

        {/* RIGHT: Kitchen Profile — mostly empty at M1 */}
        <section
          className="relative hidden md:flex md:w-[40%] flex-col bg-surface overflow-hidden"
          aria-label="Your Kitchen Profile"
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-surface to-bg opacity-50" />
          <div className="relative flex flex-1 flex-col overflow-hidden z-10">
            <KitchenProfilePanel />
          </div>
        </section>
      </div>

      {/* Mobile drawer */}
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
            <KitchenProfilePanel />
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Kitchen Profile panel — empty at M1 (still listening for everything) ──

function KitchenProfilePanel() {
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
        <ProfileCardWaiting icon={<IcoHome cls="h-[15px] w-[15px] text-amber/50" />} label="Kitchen name" />
        <ProfileCardWaiting icon={<IcoUsers cls="h-[15px] w-[15px] text-amber/50" />} label="Family members" />
        <ProfileCardWaiting label="Safety — allergens" />
        <ProfileCardWaiting label="Your kitchen's taste" />
        <ProfileCardWaiting label="What goes in the bag" />
        <ProfileCardWaiting label="Lumi's starting line" />
      </div>

      <div className="shrink-0 px-7 pt-4 pb-7">
        <div className="flex items-center justify-between mb-3">
          <span className="font-sans text-[13px] text-fg-muted">Moment 0 of 5 complete</span>
          <span className="font-serif text-base text-amber">0%</span>
        </div>
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-amber transition-all duration-700 ease-out" style={{ width: '0%' }} />
        </div>
      </div>
    </div>
  );
}

function ProfileCardWaiting({ icon, label }: { icon?: React.ReactNode; label: string }) {
  return (
    <div className="rounded-xl p-4 flex items-center gap-3.5 bg-surface">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber/10">
        {icon ?? <IcoUsers cls="h-[15px] w-[15px] text-amber/50" />}
      </div>
      <div>
        <p className="font-sans text-sm font-medium text-fg/55">{label}</p>
        <p className="font-sans text-[11px] mt-0.5 text-fg-muted/40">Still listening…</p>
      </div>
    </div>
  );
}

// ─── Cohort toggle ────────────────────────────────────────────────────────

function CohortToggle({ current, onChange }: { current: CohortId; onChange: (next: CohortId) => void }) {
  const active = COHORTS[current];
  return (
    <div className="border-b border-neutral-400/30 bg-surface/30 px-6 py-3">
      <div className="mx-auto flex max-w-7xl flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
            Pre-flight mockup · Moment 1 (who&rsquo;s at the table) · cohort toggle
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

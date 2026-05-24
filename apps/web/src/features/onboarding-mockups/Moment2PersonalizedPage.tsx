import { useEffect, useMemo, useRef, useState } from 'react';
import { ChoiceChip } from '@/features/onboarding/components/ChoiceChip.js';
import { type ChipOption } from '@/features/onboarding/components/ChoiceChipGroup.js';
import { HistoryView } from './components/HistoryView.js';
import type { ChatTurn } from './data/conversation-history.js';

// Mockup — Moment 2 (What I need to keep safe) with cohort toggle.
//
// Pre-flight for Epic 2.6 / 2.5-s6 onboarding — demonstrates the M2
// allergen capture flow personalized per cohort. Mirrors the existing
// `Moment2Page` shape (chip catalog, required-response gate, textarea +
// history toggle) but adds the cohort toggle so the captured profile
// and prior history switch between Miller (Anglo, no allergies) and
// Hassan (Somali, Yusuf has egg allergy).
//
// Allergen chips themselves are NOT personalized — the catalog is the
// fixed FALCPA top-9 + "No known allergens" entry point, same across
// every household. What varies per cohort is (a) the M1 captured state
// shown in the profile panel, (b) the prior conversation history, and
// (c) the typical response a parent would tap/type.
//
// Behavior matches the canonical moment-page pattern:
//   - h-[calc(100vh-3.5rem)] container, two-column chat + profile,
//     mobile drawer for profile
//   - Textarea is a generic chat input; chips + draft together are the
//     parent's response to this moment. handleSend clears both.
//   - "No known allergens" chip is mutually exclusive with specific
//     allergen selections
//   - History toggle shows the pre-recorded narrative leading up to M2

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

// ─── Allergen catalog (FALCPA top-9 + No known allergens) ──────────────────
// Universal across cohorts; this is medical vocabulary, not cuisine.

const allergenOptions: ChipOption[] = [
  { key: 'none', label: 'No known allergens' },
  { key: 'peanut', label: 'Peanut' },
  { key: 'tree-nuts', label: 'Tree nuts' },
  { key: 'dairy', label: 'Dairy' },
  { key: 'eggs', label: 'Eggs' },
  { key: 'soy', label: 'Soy' },
  { key: 'wheat', label: 'Wheat / gluten' },
  { key: 'fish', label: 'Fish' },
  { key: 'shellfish', label: 'Shellfish' },
  { key: 'sesame', label: 'Sesame' },
];

const LUMI_PROSE =
  "Anything I have to keep safe from? Any food allergies or sensitivities for the kids? Tap any that apply, type your own, or let me know if there are none.";

// ─── Cohort fixtures ──────────────────────────────────────────────────────

type CohortId = 'anglo' | 'somali';

interface CohortFixture {
  id: CohortId;
  label: string;
  desc: string;
  cohortClass: 'served-by-precedent' | 'to-validate · lowest-confidence';
  householdName: string;
  children: Array<{ name: string; ageBand: string }>;
  // The response the parent would actually give at M2 (pre-filled for demo).
  initialChips: string[];
  initialDraft: string;
  priorHistory: ChatTurn[];
}

// Anglo cohort history (Miller family) — leading up to Moment 2.
const ANGLO_PRIOR: ChatTurn[] = [
  {
    id: 'a-m1-lumi',
    role: 'lumi',
    content:
      "Hi, welcome to your kitchen. Let&rsquo;s start with who&rsquo;s at the table — what should I call your household, and who are you creating lunches for?",
  },
  {
    id: 'a-m1-parent',
    role: 'parent',
    content: 'Miller family. Just my son Sam, he&rsquo;s eight, about to turn nine.',
  },
];

// Somali cohort history (Hassan family) — leading up to Moment 2.
const SOMALI_PRIOR: ChatTurn[] = [
  {
    id: 's-m1-lumi',
    role: 'lumi',
    content:
      "Hi, welcome to your kitchen. Let&rsquo;s start with who&rsquo;s at the table — what should I call your household, and who are you creating lunches for?",
  },
  {
    id: 's-m1-parent',
    role: 'parent',
    content: 'Hassan family. Two kids — Amina, she&rsquo;s nine and a half, and Yusuf, six.',
  },
];

const COHORTS: Record<CohortId, CohortFixture> = {
  anglo: {
    id: 'anglo',
    label: 'Anglo · Mediterranean',
    desc: 'Served-by-precedent baseline. Single child, no allergens.',
    cohortClass: 'served-by-precedent',
    householdName: 'The Miller family kitchen',
    children: [{ name: 'Sam', ageBand: '8–9' }],
    initialChips: ['none'],
    initialDraft: '',
    priorHistory: ANGLO_PRIOR,
  },
  somali: {
    id: 'somali',
    label: 'Somali · East African',
    desc: 'Two children, sibling-specific medical allergen (Yusuf — egg).',
    cohortClass: 'to-validate · lowest-confidence',
    householdName: 'The Hassan family kitchen',
    children: [
      { name: 'Amina', ageBand: '9–10' },
      { name: 'Yusuf', ageBand: '6–7' },
    ],
    initialChips: ['eggs'],
    initialDraft: 'Yusuf has the egg allergy — medical, his throat closes. Amina is fine.',
    priorHistory: SOMALI_PRIOR,
  },
};

const COHORT_ORDER: CohortId[] = ['anglo', 'somali'];

// ─── Per-cohort state ─────────────────────────────────────────────────────

interface CohortState {
  selectedChips: string[];
  draft: string;
}

function initialStateForCohort(cohort: CohortFixture): CohortState {
  return { selectedChips: cohort.initialChips, draft: cohort.initialDraft };
}

const initialState: Record<CohortId, CohortState> = {
  anglo: initialStateForCohort(COHORTS.anglo),
  somali: initialStateForCohort(COHORTS.somali),
};

// ─── Page ─────────────────────────────────────────────────────────────────

export function Moment2PersonalizedPage() {
  const [activeCohort, setActiveCohort] = useState<CohortId>('somali');
  const [cohortStates, setCohortStates] = useState<Record<CohortId, CohortState>>(initialState);
  const [showHistory, setShowHistory] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const cohort = COHORTS[activeCohort];
  const state = cohortStates[activeCohort];
  const draft = state.draft;
  const selectedChips = state.selectedChips;

  // Auto-grow textarea — height tracks content up to a ~5-line cap.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, activeCohort]);

  // Required-response gate: chips OR text. M2 always requires explicit
  // parent action (per FR122 / safety wall).
  const hasResponse = selectedChips.length > 0 || draft.trim().length > 0;

  // History view = the M1 conversation + the M2 Lumi turn.
  const historyTurns: ChatTurn[] = useMemo(
    () => [
      ...cohort.priorHistory,
      { id: `${cohort.id}-m2-lumi`, role: 'lumi', content: LUMI_PROSE },
    ],
    [cohort.priorHistory, cohort.id],
  );

  function updateCohortState(cohortId: CohortId, next: Partial<CohortState>) {
    setCohortStates((prev) => ({ ...prev, [cohortId]: { ...prev[cohortId], ...next } }));
  }

  function setDraft(next: string) {
    updateCohortState(activeCohort, { draft: next });
  }

  function handleChipTap(key: string) {
    // "No known allergens" is mutually exclusive with everything else.
    if (key === 'none') {
      updateCohortState(activeCohort, {
        selectedChips: selectedChips.includes('none') ? [] : ['none'],
      });
      return;
    }
    const withoutNone = selectedChips.filter((k) => k !== 'none');
    const next = withoutNone.includes(key)
      ? withoutNone.filter((k) => k !== key)
      : [...withoutNone, key];
    updateCohortState(activeCohort, { selectedChips: next });
  }

  function handleSend() {
    updateCohortState(activeCohort, { selectedChips: [], draft: '' });
  }

  const placeholder = 'Add details — which child, severity, anything special I should know…';

  // Profile uses the M1 captured data + live M2 capture state.
  const m2State: 'capturing' | 'all-clear' | 'declared' =
    selectedChips.includes('none')
      ? 'all-clear'
      : selectedChips.length > 0
        ? 'declared'
        : 'capturing';

  const declaredAllergens = selectedChips
    .filter((k) => k !== 'none')
    .map((k) => allergenOptions.find((o) => o.key === k)?.label ?? k);

  return (
    <>
      <CohortToggle current={activeCohort} onChange={setActiveCohort} />

      <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden">
        {/* LEFT: Conversation column */}
        <section className="relative flex flex-1 md:w-[60%] md:flex-none flex-col bg-bg">
          {/* Header */}
          <header className="shrink-0 flex items-center justify-between bg-bg/80 px-6 md:px-8 py-5 backdrop-blur-sm">
            <div className="flex flex-col gap-1">
              <h1 className="font-serif text-xl font-medium tracking-tight text-amber">HiveKitchen</h1>
              <span className="font-sans text-[11px] font-medium uppercase tracking-widest text-fg-muted">
                Moment 2 of 5 · What I need to keep safe · <span className="text-fg">personalized</span>
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

          {/* Lumi area — focused mode OR history */}
          {showHistory ? (
            <HistoryView turns={historyTurns} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-start overflow-y-auto px-6 md:px-8 py-8 min-h-0">
              <div className="flex flex-col items-center gap-6 text-center max-w-2xl w-full">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber/30 bg-amber/15">
                  <IcoWaveform cls="h-6 w-6 animate-pulse text-amber" />
                </div>
                <p className="font-serif text-2xl md:text-[28px] leading-snug text-fg">{LUMI_PROSE}</p>

                {/* Allergen chips */}
                <div className="flex w-full flex-col items-center gap-2 pt-1">
                  <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
                    Tap any that apply
                  </p>
                  <div role="group" aria-label="Allergens" className="flex flex-wrap justify-center gap-2">
                    {allergenOptions.map((opt) => (
                      <ChoiceChip
                        key={opt.key}
                        label={opt.label}
                        mode="multi"
                        selected={selectedChips.includes(opt.key)}
                        onClick={() => handleChipTap(opt.key)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Input bar — same shape as Moment 2/3/4/5. */}
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
                Required — tap an allergen, describe in your own words, or pick &ldquo;No known allergens&rdquo;.
              </p>
            ) : selectedChips.includes('none') ? (
              <p className="mt-2 text-center font-sans text-xs italic text-foliage">
                No known allergens — confirmed
              </p>
            ) : selectedChips.length > 0 ? (
              <p className="mt-2 text-center font-sans text-xs italic text-foliage">
                {selectedChips.length === 1
                  ? '1 selection will be sent with your message'
                  : `${selectedChips.length} selections will be sent with your message`}
              </p>
            ) : null}
          </form>
        </section>

        {/* RIGHT: Kitchen Profile */}
        <section
          className="relative hidden md:flex md:w-[40%] flex-col bg-surface overflow-hidden"
          aria-label="Your Kitchen Profile"
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-surface-2/30 to-transparent" />
          <div className="relative flex flex-1 flex-col overflow-hidden z-10">
            <KitchenProfilePanel
              cohort={cohort}
              m2State={m2State}
              declaredAllergens={declaredAllergens}
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
            <KitchenProfilePanel cohort={cohort} m2State={m2State} declaredAllergens={declaredAllergens} />
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Kitchen Profile panel ────────────────────────────────────────────────

interface KitchenProfilePanelProps {
  cohort: CohortFixture;
  m2State: 'capturing' | 'all-clear' | 'declared';
  declaredAllergens: string[];
}

function KitchenProfilePanel({ cohort, m2State, declaredAllergens }: KitchenProfilePanelProps) {
  const moment2Done = m2State === 'all-clear' || m2State === 'declared';
  const completedMoments = 1 + (moment2Done ? 1 : 0);
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
        <ProfileCard active icon={<IcoHome cls="h-4 w-4 shrink-0 text-amber-soft" />} title="Your kitchen" waitingLabel="Kitchen name">
          <p className="font-sans text-base italic text-fg">{cohort.householdName}</p>
        </ProfileCard>

        <ProfileCard active icon={<IcoUsers cls="h-4 w-4 shrink-0 text-amber-soft" />} title="Family" waitingLabel="Family members">
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

        <ProfileCard
          active={moment2Done || declaredAllergens.length > 0}
          icon={<IcoShield cls="h-4 w-4 shrink-0 text-safety-cleared" />}
          title="Safety — allergens"
          waitingLabel="Safety — allergens"
        >
          {m2State === 'all-clear' && (
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-safety-cleared-fill px-2.5 py-1 font-sans text-xs text-safety-cleared">
                ✓ All clear
              </span>
              <span className="font-sans text-xs text-fg-muted">No known allergens</span>
            </div>
          )}
          {m2State === 'declared' && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {declaredAllergens.map((a) => (
                  <span
                    key={a}
                    className="flex items-center gap-1 rounded-md bg-safety-cleared-fill px-2.5 py-1 font-sans text-xs text-safety-cleared"
                  >
                    <IcoShield cls="h-3 w-3 shrink-0" />
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}
          {m2State === 'capturing' && (
            <p className="font-sans text-xs italic text-fg-muted">Waiting on your response…</p>
          )}
        </ProfileCard>

        <ProfileCard active={false} waitingLabel="Your kitchen's taste" />
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

// ─── Cohort toggle ────────────────────────────────────────────────────────

interface CohortToggleProps {
  current: CohortId;
  onChange: (next: CohortId) => void;
}

function CohortToggle({ current, onChange }: CohortToggleProps) {
  const active = COHORTS[current];
  return (
    <div className="border-b border-neutral-400/30 bg-surface/30 px-6 py-3">
      <div className="mx-auto flex max-w-7xl flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
            Pre-flight mockup · Moment 2 (allergens) · cohort toggle
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

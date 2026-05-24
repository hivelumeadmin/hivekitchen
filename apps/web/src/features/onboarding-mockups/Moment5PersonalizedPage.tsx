import { useEffect, useMemo, useRef, useState } from 'react';
import { ChoiceChip } from '@/features/onboarding/components/ChoiceChip.js';
import { HistoryView } from './components/HistoryView.js';
import type { ChatTurn } from './data/conversation-history.js';

// Mockup — Moment 5 personalized chip card with cohort toggle.
//
// Pre-flight for Epic 2.6-s4 (M5 chip card personalization + wire-format flip).
// Mirrors the existing Moment 2 / 3 / 4 dev route patterns exactly:
//   - h-[calc(100vh-3.5rem)] container (fixed; chip area scrolls)
//   - Two-column chat + Kitchen Profile (mobile: drawer)
//   - History toggle swaps focused-mode for chat bubble HistoryView
//   - History is the pre-recorded narrative leading up to this moment;
//     it is NOT accumulated from textarea sends in the mockup
//   - Textarea is a generic chat-turn input. Chips + draft text together
//     are the parent's response to THIS moment. Send clears both.
//     Production: the combined turn POSTs to /v1/onboarding/text/turn,
//     agent processes server-side, agent decides tool calls (e.g.,
//     recipe.declare), SSE pushes results.
//   - No client-side text→chip mapping. Chips are the rendered output of
//     Stage 1 + chip-tap state, period.
//   - Required-response gate matches Moment 5 production: count >= 10
//     OR override + count >= 4
//
// Two cohort fixtures show the design's range: Anglo (served-by-precedent
// baseline) and Somali (lowest-confidence to-validate cohort). Somali
// pre-seeds one `parent_added` chip representing prior turns from earlier
// in the conversation that introduced it — visualizing that provenance
// state without conflating it with the active textarea.
//
// Out of scope here: the cold-start fallback path (separate mockup for
// 2.6-s6). Both cohorts in this mockup render successful Stage 1 chip output.
//
// CULTURAL-ADVISOR REVIEW REQUIRED for production: the Somali cohort chip
// content is internal pre-flight design; accuracy + representation must
// be verified before this pattern surfaces in real onboarding.

// ─── Inline SVG icons (match OnboardingText.tsx pattern) ──────────────────

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

// ─── Cohort fixtures ──────────────────────────────────────────────────────

type CohortId = 'anglo' | 'somali';
type Provenance = 'inferred' | 'declared' | 'parent_added';

interface ChipFixture {
  key: string;
  label: string;
  provenance: Provenance;
}

interface CohortFixture {
  id: CohortId;
  label: string;
  desc: string;
  cohortClass: 'served-by-precedent' | 'to-validate · lowest-confidence';
  householdName: string;
  children: Array<{ name: string; ageBand: string }>;
  allergens: { items: string[]; note?: string };
  taste: { cultural: Array<{ label: string; enforcement: 'always' | 'prefer' | 'context' }> };
  bag: { household: string };
  chips: ChipFixture[];
  priorHistory: ChatTurn[];
  lumiTurn: ChatTurn;
}

// Anglo cohort history (Miller family) — leading up to Moment 5.
const ANGLO_PRIOR: ChatTurn[] = [
  {
    id: 'a-m1-lumi',
    role: 'lumi',
    content:
      "Hi, welcome to your kitchen. Let's start with who's at the table — what should I call your household, and who are you creating lunches for?",
  },
  {
    id: 'a-m1-parent',
    role: 'parent',
    content: 'Miller family. Just my son Sam, he&rsquo;s eight, about to turn nine.',
  },
  {
    id: 'a-m2-lumi',
    role: 'lumi',
    content: 'Got it — Sam, eight. Anything I have to keep safe from? Any food allergies or sensitivities for him?',
  },
  { id: 'a-m2-parent', role: 'parent', content: 'No allergies — we&rsquo;re lucky there.' },
  {
    id: 'a-m3-lumi',
    role: 'lumi',
    content:
      'Now tell me how your kitchen tastes — what flavors live in your house? Anything I should lean into or stay clear of?',
  },
  {
    id: 'a-m3-parent',
    role: 'parent',
    content:
      'Pretty straightforward — Anglo, some Mediterranean. Sandwiches, pasta, grilled chicken. Sam likes anything with cheese.',
  },
  {
    id: 'a-m4-lumi',
    role: 'lumi',
    content: 'And how does lunch travel for Sam? One main plus a side, or something different?',
  },
  { id: 'a-m4-parent', role: 'parent', content: 'Main + one side. Usually a piece of fruit and a small treat.' },
];

const ANGLO_LUMI_TURN: ChatTurn = {
  id: 'a-m5-lumi',
  role: 'lumi',
  content:
    "Last one — give me a starting line. Ten lunches you&rsquo;d happily pack tomorrow. Tap from the list, or type your own. Lumi will mix it up from here.",
};

// Somali cohort history (Hassan family) — leading up to Moment 5.
const SOMALI_PRIOR: ChatTurn[] = [
  {
    id: 's-m1-lumi',
    role: 'lumi',
    content:
      "Hi, welcome to your kitchen. Let's start with who's at the table — what should I call your household, and who are you creating lunches for?",
  },
  {
    id: 's-m1-parent',
    role: 'parent',
    content: 'Hassan family. Two kids — Amina, she&rsquo;s nine and a half, and Yusuf, six.',
  },
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
  {
    id: 's-m3-lumi',
    role: 'lumi',
    content:
      'Tell me how your kitchen tastes — what flavors live in your house? Anything I should lean into or stay clear of?',
  },
  {
    id: 's-m3-parent',
    role: 'parent',
    content:
      'We&rsquo;re Somali. Halal of course. Cooking is mostly traditional — anjero, sambusas, basbaas, suugo on the bariis. The kids will eat plain rice or fruit on a slow day, but I want them eating what they grew up with.',
  },
  {
    id: 's-m3-lumi-followup',
    role: 'lumi',
    content: 'Got it — &ldquo;strictly Halal.&rdquo; Should I treat that as a hard rule I always respect, or more like a preference?',
  },
  { id: 's-m3-parent-followup', role: 'parent', content: 'Always respect — Halal is non-negotiable.' },
  { id: 's-m4-lumi', role: 'lumi', content: 'How does lunch travel for Amina and Yusuf?' },
  {
    id: 's-m4-parent',
    role: 'parent',
    content: 'Same for both — main + one side. They take a thermos for the warm dishes.',
  },
];

const SOMALI_LUMI_TURN: ChatTurn = {
  id: 's-m5-lumi',
  role: 'lumi',
  content:
    "Last one — give me a starting line. Ten lunches you&rsquo;d happily pack tomorrow. Tap from the list, or type your own. Lumi will mix it up from here.",
};

const COHORTS: Record<CohortId, CohortFixture> = {
  anglo: {
    id: 'anglo',
    label: 'Anglo · Mediterranean',
    desc: 'Served-by-precedent baseline. LLM saturation strong; minimal cultural constraint.',
    cohortClass: 'served-by-precedent',
    householdName: 'The Miller family kitchen',
    children: [{ name: 'Sam', ageBand: '8–9' }],
    allergens: { items: [], note: 'None declared' },
    taste: {
      cultural: [
        { label: 'Anglo', enforcement: 'context' },
        { label: 'Mediterranean', enforcement: 'prefer' },
      ],
    },
    bag: { household: 'Main + 1 side' },
    priorHistory: ANGLO_PRIOR,
    lumiTurn: ANGLO_LUMI_TURN,
    chips: [
      { key: 'turkey-sandwich', label: 'Turkey sandwich', provenance: 'inferred' },
      { key: 'veg-wrap', label: 'Veg wrap', provenance: 'inferred' },
      { key: 'pasta-salad', label: 'Pasta salad', provenance: 'inferred' },
      { key: 'hummus-pita', label: 'Hummus + pita', provenance: 'inferred' },
      { key: 'quesadilla', label: 'Quesadilla', provenance: 'inferred' },
      { key: 'rice-bowl', label: 'Rice bowl', provenance: 'inferred' },
      { key: 'bagel-spread', label: 'Bagel + cream cheese', provenance: 'inferred' },
      { key: 'pizza-slice', label: 'Pizza slice', provenance: 'inferred' },
      { key: 'bento-box', label: 'Bento box', provenance: 'inferred' },
      { key: 'mac-cheese', label: 'Mac & cheese', provenance: 'inferred' },
      { key: 'caprese-skewers', label: 'Caprese skewers', provenance: 'inferred' },
      { key: 'tuna-melt', label: 'Tuna melt', provenance: 'inferred' },
      { key: 'falafel-pita', label: 'Falafel + pita', provenance: 'inferred' },
      { key: 'chicken-tenders', label: 'Chicken tenders + rice', provenance: 'inferred' },
      { key: 'tomato-soup', label: 'Tomato soup thermos', provenance: 'inferred' },
      { key: 'turkey-rollups', label: 'Turkey roll-ups', provenance: 'inferred' },
      { key: 'pesto-pasta', label: 'Pesto pasta', provenance: 'inferred' },
      { key: 'fruit-kabob', label: 'Fruit kabob', provenance: 'inferred' },
    ],
  },
  somali: {
    // CULTURAL-ADVISOR REVIEW REQUIRED before any production use of this content.
    id: 'somali',
    label: 'Somali · East African',
    desc: 'Lowest-confidence to-validate cohort. Demonstrates Stage 1 succeeding at the edge of the bet.',
    cohortClass: 'to-validate · lowest-confidence',
    householdName: 'The Hassan family kitchen',
    children: [
      { name: 'Amina', ageBand: '9–10' },
      { name: 'Yusuf', ageBand: '6–7' },
    ],
    allergens: { items: ['Egg'], note: 'Yusuf — medical' },
    taste: {
      cultural: [
        { label: 'Halal', enforcement: 'always' },
        { label: 'Somali', enforcement: 'prefer' },
        { label: 'East African', enforcement: 'context' },
      ],
    },
    bag: { household: 'Main + 1 side' },
    priorHistory: SOMALI_PRIOR,
    lumiTurn: SOMALI_LUMI_TURN,
    chips: [
      { key: 'anjero-suqaar', label: 'Anjero + suqaar', provenance: 'inferred' },
      { key: 'bariis-iskukaris', label: 'Bariis iskukaris', provenance: 'inferred' },
      { key: 'sambusa', label: 'Sambusa (beef)', provenance: 'inferred' },
      { key: 'ful-medames', label: 'Ful medames thermos', provenance: 'inferred' },
      { key: 'canjeero-rolls', label: 'Canjeero rolls', provenance: 'inferred' },
      { key: 'qudaar-rice', label: 'Qudaar (veg stew) + rice', provenance: 'inferred' },
      { key: 'maraq-thermos', label: 'Maraq broth thermos', provenance: 'inferred' },
      { key: 'malawah', label: 'Malawah + honey', provenance: 'inferred' },
      { key: 'suqaar-wrap', label: 'Suqaar wrap', provenance: 'inferred' },
      { key: 'basbaas-chicken', label: 'Basbaas chicken + rice', provenance: 'inferred' },
      { key: 'cambabuur', label: 'Cambabuur (spiced flatbread)', provenance: 'inferred' },
      { key: 'shorbat-lentil', label: 'Shorbat lentil thermos', provenance: 'inferred' },
      { key: 'baasto-iyo-suugo', label: 'Baasto iyo suugo', provenance: 'inferred' },
      { key: 'hilib-shiilan', label: 'Hilib shiilan + rice', provenance: 'inferred' },
      { key: 'veg-wrap', label: 'Veg wrap', provenance: 'inferred' },
      { key: 'rice-bowl', label: 'Rice bowl', provenance: 'inferred' },
      { key: 'fruit-kabob', label: 'Fruit kabob', provenance: 'inferred' },
      // Seeded parent_added — represents an earlier turn during M5 where
      // the parent typed "Date bread + halib", the agent called
      // recipe.declare(provenance='parent_added'), and the catalog re-
      // rendered. The mockup pre-includes this state to demonstrate the
      // parent_added provenance visually.
      { key: 'datebread-halib', label: 'Date bread + halib', provenance: 'parent_added' },
    ],
  },
};

const TARGET_COUNT = 10;
const COHORT_ORDER: CohortId[] = ['anglo', 'somali'];

// ─── Per-cohort state ─────────────────────────────────────────────────────

interface CohortState {
  selectedChips: string[];
  draft: string;
  override: boolean;
}

// Somali cohort starts with the parent_added 'datebread-halib' chip already
// selected — represents the prior turn that introduced it being committed.
const initialState: Record<CohortId, CohortState> = {
  anglo: { selectedChips: [], draft: '', override: false },
  somali: { selectedChips: ['datebread-halib'], draft: '', override: false },
};

// ─── Page ─────────────────────────────────────────────────────────────────

export function Moment5PersonalizedPage() {
  const [activeCohort, setActiveCohort] = useState<CohortId>('anglo');
  const [cohortStates, setCohortStates] = useState<Record<CohortId, CohortState>>(initialState);
  const [showHistory, setShowHistory] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const cohort = COHORTS[activeCohort];
  const state = cohortStates[activeCohort];
  const draft = state.draft;

  // Auto-grow textarea — height tracks content up to a ~5-line cap.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, activeCohort]);

  // Tapping an inferred chip flips its provenance to 'declared' for the
  // provenance breakdown read-out (mirrors production wire-format: chip-tap
  // is a parent declaration). The chip catalog itself is fixed per cohort —
  // typed text NEVER mutates it; chips are the rendered output of Stage 1
  // + chip-tap state. Any production-time parent_added additions arrive
  // via SSE from the agent's tool calls, not from client-side string-to-chip.
  const renderedChips: ChipFixture[] = useMemo(
    () =>
      cohort.chips.map((c) =>
        state.selectedChips.includes(c.key) && c.provenance === 'inferred'
          ? { ...c, provenance: 'declared' as const }
          : c,
      ),
    [cohort.chips, state.selectedChips],
  );

  const totalCount = state.selectedChips.length;
  const gateMet = totalCount >= TARGET_COUNT || (state.override && totalCount >= 4);
  const remaining = Math.max(0, TARGET_COUNT - totalCount);

  // History view shows the pre-recorded narrative leading up to (and
  // including) M5's Lumi turn. It is NOT accumulated from textarea sends
  // in this mockup — the existing moment 1-6 pages don't accumulate
  // either; the history is the conversation snapshot at this moment.
  const historyTurns: ChatTurn[] = useMemo(
    () => [...cohort.priorHistory, cohort.lumiTurn],
    [cohort.priorHistory, cohort.lumiTurn],
  );

  function updateCohortState(cohortId: CohortId, next: Partial<CohortState>) {
    setCohortStates((prev) => ({ ...prev, [cohortId]: { ...prev[cohortId], ...next } }));
  }

  function setDraft(next: string) {
    updateCohortState(activeCohort, { draft: next });
  }

  function handleChipTap(key: string) {
    const selected = state.selectedChips.includes(key)
      ? state.selectedChips.filter((k) => k !== key)
      : [...state.selectedChips, key];
    updateCohortState(activeCohort, { selectedChips: selected });
  }

  /**
   * Send the parent's response for THIS moment.
   *
   * In production, this POSTs the response (selected chip keys + typed
   * text together) to /v1/onboarding/text/turn. The agent processes the
   * turn server-side, decides which tools to call (recipe.declare, etc.),
   * advances to the next moment, and emits SSE events. The client re-
   * renders from SSE-pushed state.
   *
   * In the mockup (matching Moment 2 / 3 / 4 / 5 handleSend pattern),
   * send just clears the parent's draft + chip selections for the
   * active cohort. The chip catalog is never mutated from the textarea;
   * the textarea is generic chat input, not a chip-create affordance.
   */
  function handleSend() {
    updateCohortState(activeCohort, { selectedChips: [], draft: '', override: false });
  }

  const placeholder = 'Add details — anything I should know that the chips don’t cover…';

  const startingLinePreview = useMemo(() => {
    return state.selectedChips
      .map((k) => renderedChips.find((c) => c.key === k)?.label ?? k)
      .slice(0, 6);
  }, [state.selectedChips, renderedChips]);

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
                Moment 5 of 5 · A starting line for Lumi · <span className="text-fg">personalized</span>
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
            <div className="flex flex-1 flex-col items-center justify-start overflow-y-auto px-6 md:px-8 py-6 min-h-0">
              <div className="flex flex-col items-center gap-5 text-center max-w-2xl w-full">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber/20 bg-amber/10">
                  <IcoWaveform cls="h-6 w-6 animate-pulse text-amber" />
                </div>
                <p
                  className="font-serif text-2xl md:text-[28px] leading-snug text-fg"
                  dangerouslySetInnerHTML={{ __html: cohort.lumiTurn.content }}
                />

                <CountIndicator count={totalCount} target={TARGET_COUNT} override={state.override} />

                <div className="flex w-full flex-col items-center gap-2 pt-1">
                  <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
                    Tap any that fit
                  </p>
                  <div role="group" aria-label="Personalized lunch catalog" className="flex flex-wrap justify-center gap-2">
                    {renderedChips.map((opt) => (
                      <ChipWithProvenance
                        key={opt.key}
                        chip={opt}
                        selected={state.selectedChips.includes(opt.key)}
                        onTap={() => handleChipTap(opt.key)}
                      />
                    ))}
                  </div>
                </div>

                <ProvenanceBreakdown chips={renderedChips} />
              </div>
            </div>
          )}

          {/* Input bar — same shape as Moment 2/3/4/5. Chips + optional
              typed text together are the parent's response to this moment.
              Send fires when the count gate is met (>=10 OR override+>=4).
              In production the turn POSTs to /v1/onboarding/text/turn;
              here send just clears the response state. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (gateMet) handleSend();
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
                    if (gateMet) handleSend();
                  }
                }}
                style={{ maxHeight: '9.5rem' }}
                className="flex-1 resize-none overflow-y-auto bg-transparent px-4 py-2 font-sans text-[17px] leading-snug text-fg placeholder:text-fg-muted/40 focus:outline-none transition-[height] duration-150 ease-out"
              />
              <button
                type="submit"
                disabled={!gateMet}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber text-bg shadow-md hover:bg-amber-warm disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                aria-label="Send"
              >
                <IcoSend cls="h-5 w-5" />
              </button>
            </div>

            <GateLine
              totalCount={totalCount}
              remaining={remaining}
              gateMet={gateMet}
              override={state.override}
              onToggleOverride={() => updateCohortState(activeCohort, { override: !state.override })}
            />
          </form>
        </section>

        {/* RIGHT: Kitchen Profile */}
        <section
          className="relative hidden md:flex md:w-[40%] flex-col bg-surface overflow-hidden"
          aria-label="Your Kitchen Profile"
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-surface to-bg opacity-50" />
          <div className="relative flex flex-1 flex-col overflow-hidden z-10">
            <KitchenProfilePanel
              cohort={cohort}
              startingLine={{
                count: totalCount,
                preview: startingLinePreview,
                overridden: state.override && totalCount < TARGET_COUNT,
              }}
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
            <KitchenProfilePanel
              cohort={cohort}
              startingLine={{
                count: totalCount,
                preview: startingLinePreview,
                overridden: state.override && totalCount < TARGET_COUNT,
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}

// ─── ChipWithProvenance — visual accent for parent_added ──────────────────

interface ChipWithProvenanceProps {
  chip: ChipFixture;
  selected: boolean;
  onTap: () => void;
}

function ChipWithProvenance({ chip, selected, onTap }: ChipWithProvenanceProps) {
  // Parent_added chips show a leading "+" badge in amber to mark them as
  // the parent's free-text contribution.
  if (chip.provenance === 'parent_added') {
    return (
      <span className="inline-flex items-center">
        <ChoiceChip
          label={chip.label}
          mode="multi"
          selected={selected}
          onClick={onTap}
          icon={<span className="text-amber font-bold leading-none">＋</span>}
        />
      </span>
    );
  }
  return <ChoiceChip label={chip.label} mode="multi" selected={selected} onClick={onTap} />;
}

// ─── Count indicator ──────────────────────────────────────────────────────

function CountIndicator({ count, target, override }: { count: number; target: number; override: boolean }) {
  const pct = Math.min(100, (count / target) * 100);
  const isComplete = count >= target;
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-2">
      <div className="flex items-baseline gap-1">
        <span className={['font-serif text-3xl', isComplete ? 'text-foliage' : 'text-amber'].join(' ')}>{count}</span>
        <span className="font-sans text-base text-fg-muted">/ {target} lunches</span>
        {override && count < target && (
          <span className="ml-2 font-sans text-[10px] uppercase tracking-wide text-fg-muted">· starting with fewer</span>
        )}
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-warm-neutral-100/40">
        <div
          className={['h-full rounded-full transition-all duration-500 ease-out', isComplete ? 'bg-foliage' : 'bg-amber'].join(' ')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Gate line ────────────────────────────────────────────────────────────

interface GateLineProps {
  totalCount: number;
  remaining: number;
  gateMet: boolean;
  override: boolean;
  onToggleOverride: () => void;
}

function GateLine({ totalCount, remaining, gateMet, override, onToggleOverride }: GateLineProps) {
  if (totalCount === 0) {
    return (
      <p className="mt-2 text-center font-sans text-xs italic text-amber/80">
        Required — tap lunches you&rsquo;d happily pack, or type your own. Aim for ten.
      </p>
    );
  }
  if (gateMet && totalCount >= 10) {
    return (
      <p className="mt-2 text-center font-sans text-xs italic text-foliage">
        Ten lunches captured — Lumi has enough to start.
      </p>
    );
  }
  if (gateMet && override) {
    return (
      <p className="mt-2 text-center font-sans text-xs italic text-foliage">
        Starting with {totalCount} — Lumi will learn the rest as she goes.{' '}
        <button type="button" onClick={onToggleOverride} className="underline hover:text-fg">
          Add more after all
        </button>
      </p>
    );
  }
  if (totalCount >= 4) {
    return (
      <p className="mt-2 text-center font-sans text-xs italic text-fg-muted">
        {remaining} more for the full starting line.{' '}
        <button type="button" onClick={onToggleOverride} className="text-amber underline hover:text-amber-warm">
          Or start with fewer
        </button>
      </p>
    );
  }
  return (
    <p className="mt-2 text-center font-sans text-xs italic text-fg-muted">
      {remaining} more for the full starting line.
    </p>
  );
}

// ─── Provenance breakdown ─────────────────────────────────────────────────

function ProvenanceBreakdown({ chips }: { chips: ChipFixture[] }) {
  const declared = chips.filter((c) => c.provenance === 'declared').length;
  const inferred = chips.filter((c) => c.provenance === 'inferred').length;
  const parentAdded = chips.filter((c) => c.provenance === 'parent_added').length;
  return (
    <div className="mt-2 w-full max-w-md border-t border-border/30 pt-3">
      <p className="mb-1.5 font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
        Catalog provenance (internal, not user-visible)
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-sans text-[11px] text-fg-muted">
        <span>
          <span className="font-medium text-fg">{inferred}</span> inferred (Stage 1)
        </span>
        <span>
          <span className="font-medium text-fg">{declared}</span> declared (chip tap)
        </span>
        <span>
          <span className="font-medium text-fg">{parentAdded}</span> parent_added (free-text)
        </span>
      </div>
    </div>
  );
}

// ─── Kitchen Profile panel ────────────────────────────────────────────────

interface KitchenProfilePanelProps {
  cohort: CohortFixture;
  startingLine: { count: number; preview: string[]; overridden: boolean };
}

function KitchenProfilePanel({ cohort, startingLine }: KitchenProfilePanelProps) {
  const moment5Done = startingLine.count >= 10 || startingLine.overridden;
  const completedMoments = 4 + (moment5Done ? 1 : 0);
  const progressPct = (completedMoments / 5) * 100;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-7 pt-8 pb-5">
        <h2 className="font-serif text-[22px] font-normal leading-tight text-fg">Your Kitchen Profile</h2>
        <p className="mt-2 flex items-center gap-1.5 font-sans text-[11px] text-amber">
          <span className="h-1.5 w-1.5 rounded-full bg-amber animate-pulse" />
          Almost there…
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4 flex flex-col gap-3">
        <ProfileCard icon={<IcoHome cls="h-4 w-4 shrink-0 text-amber-soft" />} title="Your kitchen">
          <p className="font-sans text-base italic text-fg">{cohort.householdName}</p>
        </ProfileCard>

        <ProfileCard icon={<IcoUsers cls="h-4 w-4 shrink-0 text-amber-soft" />} title="Family">
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

        <ProfileCard icon={<IcoShield cls="h-4 w-4 shrink-0 text-safety-cleared" />} title="Safety — allergens">
          <div className="space-y-2">
            {cohort.allergens.items.length > 0 ? (
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
            ) : (
              <p className="font-sans text-xs italic text-fg-muted">No allergens declared</p>
            )}
            {cohort.allergens.note && cohort.allergens.items.length > 0 && (
              <p className="font-sans text-[11px] italic text-fg-muted">{cohort.allergens.note}</p>
            )}
          </div>
        </ProfileCard>

        <ProfileCard icon={<IcoGlobe cls="h-4 w-4 shrink-0 text-amber-soft" />} title="Your kitchen's taste">
          <div>
            <p className="mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-widest text-fg-muted/55">
              Cultural & religious
            </p>
            <div className="flex flex-wrap gap-1.5">
              {cohort.taste.cultural.map((c, i) => (
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
                    <span className="text-[10px] uppercase tracking-wide text-foliage">· rule</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        </ProfileCard>

        <ProfileCard icon={<IcoLunchBag cls="h-4 w-4 shrink-0 text-amber-soft" />} title="What goes in the bag">
          <span className="inline-block rounded-md border border-foliage/60 bg-foliage-soft px-3 py-1.5 font-sans text-sm text-fg">
            {cohort.bag.household}
          </span>
        </ProfileCard>

        <ProfileCard icon={<IcoSeed cls="h-4 w-4 shrink-0 text-amber-soft" />} title="Lumi's starting line">
          <div className="space-y-2.5">
            <div className="flex items-baseline gap-2">
              <span className={['font-serif text-2xl', moment5Done ? 'text-foliage' : 'text-amber'].join(' ')}>
                {startingLine.count}
              </span>
              <span className="font-sans text-xs text-fg-muted">
                of {TARGET_COUNT}
                {startingLine.overridden ? ' · starting with fewer' : ''}
              </span>
            </div>
            {startingLine.preview.length > 0 && (
              <div>
                <p className="mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-widest text-fg-muted/55">
                  Recent picks
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {startingLine.preview.map((item) => (
                    <span key={item} className="rounded-md bg-warm-neutral-100/60 px-2.5 py-1 font-sans text-xs text-fg">
                      {item}
                    </span>
                  ))}
                  {startingLine.count > startingLine.preview.length && (
                    <span className="rounded-md px-2.5 py-1 font-sans text-xs italic text-fg-muted">
                      +{startingLine.count - startingLine.preview.length} more
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
          <span className="font-sans text-[13px] text-fg-muted">Moment {completedMoments} of 5 complete</span>
          <span className="font-serif text-base text-amber">{Math.round(progressPct)}%</span>
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
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}

function ProfileCard({ icon, title, children }: ProfileCardProps) {
  return (
    <div className="rounded-xl p-5 bg-surface-2/60">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="font-serif text-base text-fg">{title}</h3>
      </div>
      {children}
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
            Pre-flight mockup · Epic 2.6 slice 2.6-s4 · cohort toggle
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

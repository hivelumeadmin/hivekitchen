import { useEffect, useMemo, useRef, useState } from 'react';
import { ChoiceChip } from '@/features/onboarding/components/ChoiceChip.js';
import { type ChipOption } from '@/features/onboarding/components/ChoiceChipGroup.js';
import { HistoryView } from './components/HistoryView.js';
import {
  MOMENT_5_LUMI,
  PRIOR_HISTORY_MOMENT_5,
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

// ─── Lunch item catalog — culturally contextual (Halal Punjabi household) ─

const lunchOptions: ChipOption[] = [
  // South Asian
  { key: 'paratha-roll', label: 'Paratha roll' },
  { key: 'dal-rice-thermos', label: 'Dal + rice (thermos)' },
  { key: 'idli', label: 'Idli + chutney' },
  { key: 'dosa', label: 'Dosa roll' },
  { key: 'khichdi', label: 'Khichdi thermos' },
  { key: 'biryani', label: 'Biryani (thermos)' },
  // Global / Western
  { key: 'sandwich', label: 'Sandwich' },
  { key: 'wrap', label: 'Wrap' },
  { key: 'pasta-salad', label: 'Pasta salad' },
  { key: 'rice-bowl', label: 'Rice bowl' },
  { key: 'quesadilla', label: 'Quesadilla' },
  { key: 'hummus-pita', label: 'Hummus + pita' },
  { key: 'noodle-box', label: 'Noodle box' },
  { key: 'pizza-slice', label: 'Pizza slice' },
  { key: 'sushi-roll', label: 'Sushi roll' },
  // Snack-leaning composers
  { key: 'bagel-spread', label: 'Bagel + spread' },
  { key: 'bento-box', label: 'Bento box' },
  { key: 'tortilla-pinwheels', label: 'Tortilla pinwheels' },
];

const TARGET_COUNT = 10;

// ─── Demo scenarios ────────────────────────────────────────────────────────

type DemoScenario = 'empty' | 'in-progress' | 'complete' | 'override-fewer';

interface ScenarioConfig {
  label: string;
  desc: string;
  selectedChips: string[];
  customItems: string[]; // typed freetype items already added
}

const SCENARIOS: Record<DemoScenario, ScenarioConfig> = {
  empty: {
    label: 'Empty — 0 of 10',
    desc: 'No items yet; Send disabled; gate hint visible',
    selectedChips: [],
    customItems: [],
  },
  'in-progress': {
    label: 'In progress — 6 of 10',
    desc: 'Some chips + custom items; "start with fewer" override visible',
    selectedChips: ['paratha-roll', 'dal-rice-thermos', 'wrap', 'pasta-salad', 'hummus-pita'],
    customItems: ['Chicken kebab + naan'],
  },
  complete: {
    label: 'Complete — 10 of 10',
    desc: 'Target reached; Send enabled with celebratory confirmation',
    selectedChips: [
      'paratha-roll',
      'dal-rice-thermos',
      'wrap',
      'pasta-salad',
      'hummus-pita',
      'quesadilla',
      'rice-bowl',
      'noodle-box',
      'bagel-spread',
    ],
    customItems: ['Chicken kebab + naan'],
  },
  'override-fewer': {
    label: 'Override — start with fewer',
    desc: '4 items selected, parent invoked the "start with fewer" override',
    selectedChips: ['paratha-roll', 'dal-rice-thermos', 'wrap'],
    customItems: ['Chicken kebab + naan'],
  },
};

interface CapturedProfile {
  householdName: string;
  children: Array<{ name: string; ageBand: string }>;
  allergens: { items: string[]; note?: string };
  taste: { cultural: Array<{ label: string; enforcement: 'always' | 'prefer' | 'context' }> };
  bag: { household: string };
  startingLine: { count: number; preview: string[]; overridden: boolean };
}

export function Moment5Page() {
  const [scenario, setScenario] = useState<DemoScenario>('in-progress');
  const [selectedChips, setSelectedChips] = useState<string[]>(SCENARIOS['in-progress'].selectedChips);
  const [customItems, setCustomItems] = useState<string[]>(SCENARIOS['in-progress'].customItems);
  const [draft, setDraft] = useState('');
  const [override, setOverride] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  // Auto-grow textarea — resize to fit content on every change, capped at
  // ~5 lines (after which the internal scrollbar takes over).
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const historyTurns: ChatTurn[] = [...PRIOR_HISTORY_MOMENT_5, MOMENT_5_LUMI];

  const totalCount = selectedChips.length + customItems.length;

  const captured: CapturedProfile = useMemo(() => {
    const allItems = [
      ...selectedChips.map((k) => lunchOptions.find((o) => o.key === k)?.label ?? k),
      ...customItems,
    ];
    return {
      householdName: 'The Khan-Patel family kitchen',
      children: [
        { name: 'Layla', ageBand: '10–12' },
        { name: 'Adam', ageBand: '10–12' },
      ],
      allergens: { items: ['Peanut', 'Tree nuts'], note: 'Layla — medical' },
      taste: {
        cultural: [
          { label: 'Halal', enforcement: 'always' },
          { label: 'Punjabi', enforcement: 'prefer' },
        ],
      },
      bag: { household: 'Main + 2 sides' },
      startingLine: {
        count: totalCount,
        preview: allItems.slice(0, 6),
        overridden: override && totalCount < TARGET_COUNT,
      },
    };
  }, [selectedChips, customItems, totalCount, override]);

  const lumiProse =
    "Last one — give me a starting line. Ten lunches you'd happily pack tomorrow. Tap from the list, or type your own. Lumi will mix it up from here.";

  const placeholder =
    customItems.length > 0
      ? "Add another, or hit return to keep going…"
      : "Type any lunch — yours or theirs…";

  const gateMet = totalCount >= TARGET_COUNT || (override && totalCount >= 4);
  const remaining = Math.max(0, TARGET_COUNT - totalCount);

  function handleScenarioChange(next: DemoScenario) {
    setScenario(next);
    setSelectedChips(SCENARIOS[next].selectedChips);
    setCustomItems(SCENARIOS[next].customItems);
    setDraft('');
    setOverride(next === 'override-fewer');
  }

  function handleChipTap(key: string) {
    setSelectedChips((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function handleAddCustom() {
    const text = draft.trim();
    if (text.length === 0) return;
    setCustomItems((prev) => [...prev, text]);
    setDraft('');
  }

  function handleRemoveCustom(idx: number) {
    setCustomItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSend() {
    // Mockup — keep state to preserve the demo
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
                Moment 5 of 5 · A starting line for Lumi
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

          {/* Lumi area — focused mode (orb + prose + count + customs + chip catalog) OR full history */}
          {showHistory ? (
            <HistoryView turns={historyTurns} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-start overflow-y-auto px-6 md:px-8 py-6 min-h-0">
              <div className="flex flex-col items-center gap-5 text-center max-w-2xl w-full">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber/20 bg-amber/10">
                  <IcoWaveform cls="h-6 w-6 animate-pulse text-amber" />
                </div>
                <p className="font-serif text-2xl md:text-[28px] leading-snug text-fg">
                  {lumiProse}
                </p>

                {/* Count indicator — the big magic-ten counter */}
                <CountIndicator count={totalCount} target={TARGET_COUNT} override={override} />

                {/* Custom items pill rail */}
                {customItems.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {customItems.map((item, idx) => (
                      <span
                        key={idx}
                        className="flex items-center gap-1 rounded-md border border-foliage bg-foliage-soft px-2.5 py-1 font-sans text-xs text-fg"
                      >
                        {item}
                        <button
                          type="button"
                          onClick={() => handleRemoveCustom(idx)}
                          className="text-fg-muted hover:text-fg"
                          aria-label={`Remove ${item}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Choice chips — multi-select catalog, in flow under the Lumi turn */}
                <div className="flex w-full flex-col items-center gap-2 pt-1">
                  <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
                    Tap any that fit
                  </p>
                  <div
                    role="group"
                    aria-label="Lunch item catalog"
                    className="flex flex-wrap justify-center gap-2"
                  >
                    {lunchOptions.map((opt) => (
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

          {/* Input bar — add-custom semantics */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim().length > 0) {
                handleAddCustom();
              } else if (gateMet) {
                handleSend();
              }
            }}
            className="shrink-0 px-6 md:px-8 pb-10 pt-2"
          >
            <label htmlFor="onboarding-message" className="sr-only">
              Add a lunch item
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
                    if (draft.trim().length > 0) {
                      handleAddCustom();
                    } else if (gateMet) {
                      handleSend();
                    }
                  }
                }}
                style={{ maxHeight: '9.5rem' }}
                className="flex-1 resize-none overflow-y-auto bg-transparent px-4 py-2 font-sans text-[17px] leading-snug text-fg placeholder:text-fg-muted/40 focus:outline-none transition-[height] duration-150 ease-out"
              />
              {draft.trim().length > 0 ? (
                <button
                  type="button"
                  onClick={handleAddCustom}
                  className="rounded-full bg-foliage px-4 py-2 font-sans text-sm font-medium text-bg hover:bg-foliage-soft hover:text-fg transition-colors"
                  aria-label="Add this item"
                >
                  Add
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!gateMet}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber text-bg shadow-md hover:bg-amber-warm disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                  aria-label="Send"
                >
                  <IcoSend cls="h-5 w-5" />
                </button>
              )}
            </div>

            {/* Status / gate / override line */}
            <GateLine
              totalCount={totalCount}
              remaining={remaining}
              gateMet={gateMet}
              override={override}
              onToggleOverride={() => setOverride((v) => !v)}
            />
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

// ─── Count indicator — the magic-ten counter ───────────────────────────────

interface CountIndicatorProps {
  count: number;
  target: number;
  override: boolean;
}

function CountIndicator({ count, target, override }: CountIndicatorProps) {
  const pct = Math.min(100, (count / target) * 100);
  const isComplete = count >= target;

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-2">
      <div className="flex items-baseline gap-1">
        <span
          className={[
            'font-serif text-3xl',
            isComplete ? 'text-foliage' : 'text-amber',
          ].join(' ')}
        >
          {count}
        </span>
        <span className="font-sans text-base text-fg-muted">/ {target} lunches</span>
        {override && count < target && (
          <span className="ml-2 font-sans text-[10px] uppercase tracking-wide text-fg-muted">
            · starting with fewer
          </span>
        )}
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-warm-neutral-100/40">
        <div
          className={[
            'h-full rounded-full transition-all duration-500 ease-out',
            isComplete ? 'bg-foliage' : 'bg-amber',
          ].join(' ')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Gate line — adapts to count + override state ──────────────────────────

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
        <button
          type="button"
          onClick={onToggleOverride}
          className="underline hover:text-fg"
        >
          Add more after all
        </button>
      </p>
    );
  }

  // Mid-state — count below 10, override available if count ≥ 4
  if (totalCount >= 4) {
    return (
      <p className="mt-2 text-center font-sans text-xs italic text-fg-muted">
        {remaining} more for the full starting line.{' '}
        <button
          type="button"
          onClick={onToggleOverride}
          className="text-amber underline hover:text-amber-warm"
        >
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

// ─── Kitchen Profile panel — Moment 5 fills "Lumi's starting line" ────────

function KitchenProfilePanel({ captured }: { captured: CapturedProfile }) {
  const moment5Done = captured.startingLine.count >= 10 || captured.startingLine.overridden;
  const completedMoments = 4 + (moment5Done ? 1 : 0);
  const progressPct = (completedMoments / 5) * 100;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-7 pt-8 pb-5">
        <h2 className="font-serif text-[22px] font-normal leading-tight text-fg">
          Your Kitchen Profile
        </h2>
        <p className="mt-2 flex items-center gap-1.5 font-sans text-[11px] text-amber">
          <span className="h-1.5 w-1.5 rounded-full bg-amber animate-pulse" />
          Almost there…
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

        <ProfileCard icon={<IcoGlobe cls="h-4 w-4 shrink-0 text-amber-soft" />} title="Your kitchen's taste" active waitingLabel="Your kitchen's taste">
          <div>
            <p className="mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-widest text-fg-muted/55">Cultural & religious</p>
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
                    <span className="text-[10px] uppercase tracking-wide text-foliage">· rule</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        </ProfileCard>

        <ProfileCard icon={<IcoLunchBag cls="h-4 w-4 shrink-0 text-amber-soft" />} title="What goes in the bag" active waitingLabel="What goes in the bag">
          <span className="inline-block rounded-md border border-foliage/60 bg-foliage-soft px-3 py-1.5 font-sans text-sm text-fg">
            {captured.bag.household}
          </span>
        </ProfileCard>

        {/* Starting line — this moment */}
        <ProfileCard
          icon={<IcoSeed cls="h-4 w-4 shrink-0 text-amber-soft" />}
          title="Lumi's starting line"
          active={captured.startingLine.count > 0}
          waitingLabel="Lumi's starting line"
        >
          <div className="space-y-2.5">
            <div className="flex items-baseline gap-2">
              <span
                className={[
                  'font-serif text-2xl',
                  moment5Done ? 'text-foliage' : 'text-amber',
                ].join(' ')}
              >
                {captured.startingLine.count}
              </span>
              <span className="font-sans text-xs text-fg-muted">
                of {TARGET_COUNT}{captured.startingLine.overridden ? ' · starting with fewer' : ''}
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
                      className="rounded-md bg-warm-neutral-100/60 px-2.5 py-1 font-sans text-xs text-fg"
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
  const scenarios = (Object.entries(SCENARIOS) as Array<[DemoScenario, ScenarioConfig]>).map(
    ([key, cfg]) => ({ key, label: cfg.label, desc: cfg.desc }),
  );

  return (
    <div className="border-b border-neutral-400/30 bg-surface/30 px-6 py-2.5">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 text-xs">
        <span className="font-sans uppercase tracking-[0.18em] text-memory-provenance-500">
          Mockup demo — count gate + override states
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

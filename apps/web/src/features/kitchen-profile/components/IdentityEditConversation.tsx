import { useMemo, useState } from 'react';
import type { EnforcedChip } from '../data/mockData.js';
import { EditConversation } from './EditConversation.js';

export interface IdentityEditValue {
  readonly cultural: readonly EnforcedChip[];
  readonly sharedTastes: string;
}

interface Readonly_IdentityEditConversationProps {
  readonly initial: IdentityEditValue;
  readonly suggestedAdditions: readonly EnforcedChip[];
  /**
   * Fired on every Send tap. Mirrors what the production backend does:
   *  - `composite` is the user-text payload that would post to the Lumi
   *    conversation thread API (chip diff rendered as natural-language +
   *    typed message + section context).
   *  - `nextValue` is the immediate structured state Lumi's interpretation
   *    would have produced from the chip diff. The parent applies this to
   *    its own identity state so the Kitchen Profile reflects the change
   *    instantly — no separate Save step.
   */
  readonly onSendComposite: (composite: string, nextValue: IdentityEditValue) => void;
  /** Close handler — user clicked "I'm done with my edit". */
  readonly onDone: () => void;
  /**
   * Story 7-S15 — Lumi's reply after the shared-tastes note is interpreted.
   * Rendered as a calm one-liner above the input once it arrives.
   */
  readonly lumiResponse?: string | null;
  /**
   * Story 7-S15 — inline error when one or more cultural chip-state writes
   * failed. Rendered as a role=alert line so partial failures aren't swallowed.
   */
  readonly editError?: string | null;
}

export type IdentityEditConversationProps = Readonly<Readonly_IdentityEditConversationProps>;

const SECTION_CONTEXT = 'Collective Kitchen Identity';

/**
 * Renders chip selections + typed text into a single user-text payload that
 * mirrors what the backend would send to Lumi: a chat message from the user
 * that includes the screen/section context, the structured tap selections
 * spelled out as natural language, and the user's free-text message.
 *
 * Example output:
 *
 *   [Context: Collective Kitchen Identity]
 *
 *   [Selections]
 *   • drop Italian nights
 *   • add Gujarati (as prefer)
 *
 *   [Message]
 *   We keep heat mild for the kids
 */
function buildIdentityComposite(input: {
  readonly cultural: readonly EnforcedChip[];
  readonly removedKeys: ReadonlySet<string>;
  readonly addedItems: readonly EnforcedChip[];
  readonly typedText: string;
}): string {
  const { cultural, removedKeys, addedItems, typedText } = input;
  const lines: string[] = [`[Context: ${SECTION_CONTEXT}]`];

  const removed = cultural.filter((c) => removedKeys.has(c.key));
  if (removed.length > 0 || addedItems.length > 0) {
    lines.push('', '[Selections]');
    for (const c of removed) {
      lines.push(`• drop ${c.label}`);
    }
    for (const a of addedItems) {
      lines.push(`• add ${a.label} (as ${a.enforcement})`);
    }
  }

  const trimmed = typedText.trim();
  if (trimmed.length > 0) {
    lines.push('', '[Message]');
    lines.push(trimmed);
  }

  return lines.join('\n');
}

/**
 * Seeds the EditConversation shell for the "Collective Kitchen Identity"
 * section. Owns staged chip changes, typed draft, and conversation history.
 *
 * Send semantics (matches production):
 *  - Each Send builds a composite (section context + chip diff rendered as
 *    text + typed message) and fires onSendComposite with both the textual
 *    payload AND the structured nextValue.
 *  - The parent applies nextValue to identity immediately — no Save step.
 *  - Local chip-diff state resets so the visual chip list reflects the new
 *    "current" state on the next render. Each Send is a clean commit.
 *  - Sent composites accumulate in capturedNotes for the history toggle.
 */
export function IdentityEditConversation({
  initial,
  suggestedAdditions,
  onSendComposite,
  onDone,
  lumiResponse = null,
  editError = null,
}: IdentityEditConversationProps) {
  const [removedKeys, setRemovedKeys] = useState<ReadonlySet<string>>(new Set());
  const [addedItems, setAddedItems] = useState<readonly EnforcedChip[]>([]);
  const [freeText, setFreeText] = useState('');
  const [capturedNotes, setCapturedNotes] = useState<readonly string[]>([]);

  // Items already in the kitchen shouldn't appear as "Add something" suggestions.
  const availableSuggestions = useMemo(
    () => suggestedAdditions.filter(
      (s) => !initial.cultural.some((c) => c.key === s.key),
    ),
    [suggestedAdditions, initial.cultural],
  );

  const summary = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-1.5">
        {initial.cultural.map((c) => (
          <SummaryChip key={c.key} chip={c} />
        ))}
      </div>
    ),
    [initial.cultural],
  );

  function toggleRemoval(key: string) {
    setRemovedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function stageAddition(chip: EnforcedChip) {
    setAddedItems((prev) => {
      if (prev.some((p) => p.key === chip.key)) {
        return prev.filter((p) => p.key !== chip.key);
      }
      return [...prev, chip];
    });
  }

  const hasChipDiff = removedKeys.size > 0 || addedItems.length > 0;
  const canSend = freeText.trim().length > 0 || hasChipDiff;

  function handleSend(typedText: string) {
    const composite = buildIdentityComposite({
      cultural: initial.cultural,
      removedKeys,
      addedItems,
      typedText,
    });
    const nextValue: IdentityEditValue = {
      cultural: [
        ...initial.cultural.filter((c) => !removedKeys.has(c.key)),
        ...addedItems,
      ],
      // Shared tastes prose updates flow through the typed message — Lumi
      // interprets the note and rewrites prose server-side. The mockup
      // leaves the local value unchanged.
      sharedTastes: initial.sharedTastes,
    };
    onSendComposite(composite, nextValue);
    // Clean transaction: chip diff was committed to nextValue, reset local
    // staging so the next chip taps stage fresh changes.
    setRemovedKeys(new Set());
    setAddedItems([]);
    setCapturedNotes((prev) => [...prev, composite]);
  }

  return (
    <EditConversation
      sectionLabel="Refining — Collective Kitchen Identity"
      summary={summary}
      prompt="What should I change about your kitchen's taste? Tap to drop, suggest something new, or tell me anything else."
      onDone={onDone}
      draft={freeText}
      onDraftChange={setFreeText}
      draftPlaceholder='e.g. "Make Punjabi a hard rule" or "We keep heat mild for the kids"'
      capturedNotes={capturedNotes}
      canSend={canSend}
      onSendNote={handleSend}
      prose={
        editError !== null && editError.length > 0 ? (
          <p
            role="alert"
            className="mx-auto max-w-2xl text-center font-sans text-sm text-safety-red"
          >
            {editError}
          </p>
        ) : lumiResponse !== null && lumiResponse.length > 0 ? (
          <p className="mx-auto max-w-2xl text-center font-serif text-base italic leading-relaxed text-amber-warm">
            {lumiResponse}
          </p>
        ) : undefined
      }
      topChips={
        <div className="flex w-full flex-col items-center gap-2">
          <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
            In your kitchen now — tap to drop
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {initial.cultural.map((c) => {
              const staged = removedKeys.has(c.key);
              return (
                <CurrentChip
                  key={c.key}
                  chip={c}
                  stagedForRemoval={staged}
                  onToggle={() => toggleRemoval(c.key)}
                />
              );
            })}
          </div>
        </div>
      }
      chips={
        availableSuggestions.length > 0 ? (
          <div className="flex w-full flex-col items-center gap-2">
            <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
              Add something
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {availableSuggestions.map((s) => {
                const staged = addedItems.some((a) => a.key === s.key);
                return (
                  <AddChip
                    key={s.key}
                    chip={s}
                    staged={staged}
                    onToggle={() => stageAddition(s)}
                  />
                );
              })}
            </div>
          </div>
        ) : null
      }
    />
  );
}

// ─── Inline chip primitives ────────────────────────────────────────────────

function SummaryChip({ chip }: { chip: EnforcedChip }) {
  if (chip.enforcement === 'always') {
    return (
      <span className="flex items-center gap-1 rounded-md border border-[color-mix(in_srgb,var(--foliage)_60%,transparent)] bg-foliage-soft px-2 py-0.5 font-sans text-[11px] font-medium text-fg">
        {chip.label}
        <span className="text-[9px] uppercase tracking-wide text-foliage">· rule</span>
      </span>
    );
  }
  if (chip.enforcement === 'prefer') {
    return (
      <span className="rounded-md border border-[color-mix(in_srgb,var(--foliage)_40%,transparent)] bg-foliage-100 px-2 py-0.5 font-sans text-[11px] text-fg">
        {chip.label}
      </span>
    );
  }
  return (
    <span className="rounded-md bg-[color-mix(in_srgb,var(--fg-muted)_10%,transparent)] px-2 py-0.5 font-sans text-[11px] italic text-fg-muted">
      {chip.label}
    </span>
  );
}

interface CurrentChipProps {
  readonly chip: EnforcedChip;
  readonly stagedForRemoval: boolean;
  readonly onToggle: () => void;
}

function CurrentChip({ chip, stagedForRemoval, onToggle }: CurrentChipProps) {
  if (stagedForRemoval) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 rounded-md border border-dashed border-[color-mix(in_srgb,var(--lumi-terracotta)_60%,transparent)] bg-[color-mix(in_srgb,var(--lumi-terracotta)_5%,transparent)] px-2.5 py-1 font-sans text-xs text-fg-muted line-through transition-colors hover:bg-[color-mix(in_srgb,var(--lumi-terracotta)_10%,transparent)]"
        aria-label={`Undo dropping ${chip.label}`}
      >
        {chip.label}
        <span className="text-[10px] uppercase tracking-wide text-lumi-terracotta">
          · dropping
        </span>
      </button>
    );
  }
  if (chip.enforcement === 'always') {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 rounded-md border-2 border-foliage bg-foliage-soft px-2.5 py-1 font-sans text-xs font-medium text-fg transition-opacity hover:opacity-80"
        aria-label={`Drop ${chip.label}`}
      >
        {chip.label}
        <span className="text-[10px] uppercase tracking-wide text-foliage">· rule</span>
        <span className="ms-0.5 text-fg-muted" aria-hidden>
          ×
        </span>
      </button>
    );
  }
  if (chip.enforcement === 'prefer') {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--foliage)_60%,transparent)] bg-foliage-100 px-2.5 py-1 font-sans text-xs text-fg transition-opacity hover:opacity-80"
        aria-label={`Drop ${chip.label}`}
      >
        {chip.label}
        <span className="ms-0.5 text-fg-muted" aria-hidden>
          ×
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1.5 rounded-md bg-[color-mix(in_srgb,var(--fg-muted)_10%,transparent)] px-2.5 py-1 font-sans text-xs italic text-fg-muted transition-opacity hover:opacity-80"
      aria-label={`Drop ${chip.label}`}
    >
      {chip.label}
      <span className="ms-0.5 text-fg-muted not-italic" aria-hidden>
        ×
      </span>
    </button>
  );
}

interface AddChipProps {
  readonly chip: EnforcedChip;
  readonly staged: boolean;
  readonly onToggle: () => void;
}

function AddChip({ chip, staged, onToggle }: AddChipProps) {
  if (staged) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 rounded-md border-2 border-foliage bg-foliage-soft px-2.5 py-1 font-sans text-xs font-medium text-fg transition-opacity hover:opacity-80"
        aria-label={`Don't add ${chip.label}`}
      >
        {chip.label}
        <span className="text-[10px] uppercase tracking-wide text-foliage">· adding</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1.5 rounded-md border border-dashed border-[color-mix(in_srgb,var(--fg-muted)_40%,transparent)] px-2.5 py-1 font-sans text-xs text-fg-muted transition-colors hover:border-[color-mix(in_srgb,var(--amber)_50%,transparent)] hover:text-fg"
      aria-label={`Add ${chip.label}`}
    >
      <span className="text-amber-warm" aria-hidden>
        +
      </span>
      {chip.label}
    </button>
  );
}

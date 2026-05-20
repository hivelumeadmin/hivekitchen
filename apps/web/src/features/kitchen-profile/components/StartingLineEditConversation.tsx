import { useMemo, useState } from 'react';
import type { StartingLine } from '../data/mockData.js';
import { AddableChip, RemovableChip } from './EditChips.js';
import { EditConversation } from './EditConversation.js';

interface Readonly_StartingLineEditConversationProps {
  readonly initial: StartingLine;
  readonly suggestedAdditions: readonly string[];
  readonly onSendComposite: (composite: string, nextValue: StartingLine) => void;
  readonly onDone: () => void;
}

export type StartingLineEditConversationProps =
  Readonly<Readonly_StartingLineEditConversationProps>;

function buildStartingLineComposite(input: {
  readonly removed: readonly string[];
  readonly added: readonly string[];
  readonly typedText: string;
}): string {
  const { removed, added, typedText } = input;
  const lines: string[] = ["[Context: Lumi's starting line]"];

  if (removed.length > 0 || added.length > 0) {
    lines.push('', '[Selections]');
    for (const r of removed) lines.push(`• drop: ${r}`);
    for (const a of added) lines.push(`• add: ${a}`);
  }

  const trimmed = typedText.trim();
  if (trimmed.length > 0) {
    lines.push('', '[Message]');
    lines.push(trimmed);
  }

  return lines.join('\n');
}

export function StartingLineEditConversation({
  initial,
  suggestedAdditions,
  onSendComposite,
  onDone,
}: StartingLineEditConversationProps) {
  const [removedItems, setRemovedItems] = useState<ReadonlySet<string>>(new Set());
  const [addedItems, setAddedItems] = useState<readonly string[]>([]);
  const [freeText, setFreeText] = useState('');
  const [capturedNotes, setCapturedNotes] = useState<readonly string[]>([]);

  const availableSuggestions = useMemo(
    () =>
      suggestedAdditions.filter(
        (s) => !initial.items.includes(s) && !addedItems.includes(s),
      ),
    [suggestedAdditions, initial.items, addedItems],
  );

  const summary = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-serif text-[14px] text-foliage">
          {initial.count}
        </span>
        <span className="font-sans text-[11px] text-fg-muted">
          / {initial.target} lunches
        </span>
        <span className="font-sans text-[11px] text-fg-muted">
          · {initial.items.slice(0, 3).join(', ')}
          {initial.items.length > 3 && `, +${initial.items.length - 3} more`}
        </span>
      </div>
    ),
    [initial],
  );

  function toggleRemoval(label: string) {
    setRemovedItems((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function stageAddition(label: string) {
    setAddedItems((prev) =>
      prev.includes(label) ? prev.filter((p) => p !== label) : [...prev, label],
    );
  }

  const removedList = useMemo(
    () => initial.items.filter((i) => removedItems.has(i)),
    [initial.items, removedItems],
  );
  const hasChipDiff = removedList.length > 0 || addedItems.length > 0;
  const canSend = freeText.trim().length > 0 || hasChipDiff;

  function handleSend(typedText: string) {
    const composite = buildStartingLineComposite({
      removed: removedList,
      added: addedItems,
      typedText,
    });
    const nextItems = [
      ...initial.items.filter((i) => !removedItems.has(i)),
      ...addedItems,
    ];
    onSendComposite(composite, {
      count: nextItems.length,
      target: initial.target,
      items: nextItems,
    });
    setRemovedItems(new Set());
    setAddedItems([]);
    setCapturedNotes((prev) => [...prev, composite]);
  }

  return (
    <EditConversation
      sectionLabel="Refining — Lumi's starting line"
      summary={summary}
      prompt="Which lunches should I drop or add? Tap to mark, suggest something new, or type a custom lunch."
      onDone={onDone}
      draft={freeText}
      onDraftChange={setFreeText}
      draftPlaceholder={'e.g. "Add chicken tikka wrap" or "Drop noodles for now"'}
      capturedNotes={capturedNotes}
      canSend={canSend}
      onSendNote={handleSend}
      topChips={
        <div className="flex w-full flex-col items-center gap-2">
          <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
            Your starting line — tap to drop
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {initial.items.map((label) => (
              <RemovableChip
                key={label}
                label={label}
                stagedForRemoval={removedItems.has(label)}
                onToggle={() => toggleRemoval(label)}
              />
            ))}
          </div>
        </div>
      }
      chips={
        availableSuggestions.length > 0 ? (
          <div className="flex w-full flex-col items-center gap-2">
            <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
              Lumi's suggestions
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {availableSuggestions.map((label) => (
                <AddableChip
                  key={label}
                  label={label}
                  staged={addedItems.includes(label)}
                  onToggle={() => stageAddition(label)}
                />
              ))}
            </div>
          </div>
        ) : null
      }
    />
  );
}

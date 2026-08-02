import { useMemo, useState } from 'react';
import { ShieldIcon } from '@hivekitchen/ui';
import type { Allergen, ChildProfile } from '../data/mockData.js';
import { AddableChip, RemovableChip } from './EditChips.js';
import { EditConversation } from './EditConversation.js';

export interface ChildEditValue {
  readonly allergens: readonly Allergen[];
  readonly bagComposition: string | null;
  readonly loves: string;
  readonly avoids: string;
  readonly lumiQuote?: string;
}

interface Readonly_ChildEditConversationProps {
  readonly child: ChildProfile;
  /** Common allergen suggestions surfaced as addable chips. */
  readonly suggestedAllergens: readonly Allergen[];
  readonly onSendComposite: (composite: string, nextValue: ChildEditValue) => void;
  readonly onDone: () => void;
}

export type ChildEditConversationProps = Readonly<Readonly_ChildEditConversationProps>;

function buildChildComposite(input: {
  readonly childName: string;
  readonly childAge: number;
  readonly currentAllergens: readonly Allergen[];
  readonly removedKeys: ReadonlySet<string>;
  readonly addedItems: readonly Allergen[];
  readonly typedText: string;
}): string {
  const { childName, childAge, currentAllergens, removedKeys, addedItems, typedText } = input;
  const lines: string[] = [`[Context: Child profile — ${childName} (age ${childAge})]`];

  const removed = currentAllergens.filter((a) => removedKeys.has(a.name));
  if (removed.length > 0 || addedItems.length > 0) {
    lines.push('', '[Selections]');
    for (const a of removed) {
      lines.push(`• drop allergen: ${a.name}`);
    }
    for (const a of addedItems) {
      lines.push(`• add allergen: ${a.name}${a.medical ? ' (medical)' : ''}`);
    }
  }

  const trimmed = typedText.trim();
  if (trimmed.length > 0) {
    lines.push('', '[Message]');
    lines.push(trimmed);
  }

  return lines.join('\n');
}

export function ChildEditConversation({
  child,
  suggestedAllergens,
  onSendComposite,
  onDone,
}: ChildEditConversationProps) {
  const [removedKeys, setRemovedKeys] = useState<ReadonlySet<string>>(new Set());
  const [addedItems, setAddedItems] = useState<readonly Allergen[]>([]);
  const [freeText, setFreeText] = useState('');
  const [capturedNotes, setCapturedNotes] = useState<readonly string[]>([]);

  const availableSuggestions = useMemo(
    () =>
      suggestedAllergens.filter(
        (s) => !child.allergens.some((a) => a.name === s.name),
      ),
    [suggestedAllergens, child.allergens],
  );

  const summary = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-sans text-[12px] font-medium text-fg">
          {child.name}, {child.age}
        </span>
        <span className="font-sans text-[11px] text-fg-muted">
          {child.allergens.length === 0
            ? 'no known allergens'
            : child.allergens.map((a) => a.name).join(', ')}
        </span>
        {child.bagComposition && (
          <span className="font-sans text-[11px] text-fg-muted">
            · {child.bagComposition}
          </span>
        )}
      </div>
    ),
    [child],
  );

  function toggleRemoval(name: string) {
    setRemovedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function stageAddition(a: Allergen) {
    setAddedItems((prev) => {
      if (prev.some((p) => p.name === a.name)) {
        return prev.filter((p) => p.name !== a.name);
      }
      return [...prev, a];
    });
  }

  const hasChipDiff = removedKeys.size > 0 || addedItems.length > 0;
  const canSend = freeText.trim().length > 0 || hasChipDiff;

  function handleSend(typedText: string) {
    const composite = buildChildComposite({
      childName: child.name,
      childAge: child.age,
      currentAllergens: child.allergens,
      removedKeys,
      addedItems,
      typedText,
    });
    const nextAllergens: Allergen[] = [
      ...child.allergens.filter((a) => !removedKeys.has(a.name)),
      ...addedItems,
    ];
    onSendComposite(composite, {
      allergens: nextAllergens,
      bagComposition: child.bagComposition,
      loves: child.loves,
      avoids: child.avoids,
      lumiQuote: child.lumiQuote,
    });
    setRemovedKeys(new Set());
    setAddedItems([]);
    setCapturedNotes((prev) => [...prev, composite]);
  }

  return (
    <EditConversation
      sectionLabel={`Refining — ${child.name}'s profile`}
      summary={summary}
      prompt={`What should I change for ${child.name}? Tap an allergen to drop, add a common one, or tell me anything else (bag, loves, avoids, school notes).`}
      onDone={onDone}
      draft={freeText}
      onDraftChange={setFreeText}
      draftPlaceholder={`e.g. "Change ${child.name}'s bag to main + 1 side" or "${child.name} loves mango now"`}
      capturedNotes={capturedNotes}
      canSend={canSend}
      onSendNote={handleSend}
      topChips={
        <div className="flex w-full flex-col items-center gap-2">
          <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
            {child.allergens.length === 0
              ? `${child.name} has no allergens noted`
              : 'Allergens — tap to drop'}
          </p>
          {child.allergens.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {child.allergens.map((a) => (
                <RemovableChip
                  key={a.name}
                  label={a.name}
                  badge={a.medical ? 'medical' : undefined}
                  stagedForRemoval={removedKeys.has(a.name)}
                  onToggle={() => toggleRemoval(a.name)}
                />
              ))}
            </div>
          )}
        </div>
      }
      chips={
        availableSuggestions.length > 0 ? (
          <div className="flex w-full flex-col items-center gap-2">
            <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
              Add an allergen
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {availableSuggestions.map((s) => (
                <AddableChip
                  key={s.name}
                  label={s.name}
                  staged={addedItems.some((a) => a.name === s.name)}
                  onToggle={() => stageAddition(s)}
                />
              ))}
            </div>
            <p className="font-sans text-[10px] italic text-fg-muted">
              <ShieldIcon className="-mt-0.5 me-1 inline h-3 w-3" />
              Type &quot;medical&quot; alongside an allergen to flag it.
            </p>
          </div>
        ) : null
      }
    />
  );
}

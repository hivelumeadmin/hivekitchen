import { useMemo, useState } from 'react';
import { RemovableChip } from './EditChips.js';
import { EditConversation } from './EditConversation.js';

export interface School {
  readonly name: string;
}

interface Readonly_SchoolsEditConversationProps {
  readonly initial: readonly School[];
  readonly onSendComposite: (composite: string, nextValue: readonly School[]) => void;
  readonly onDone: () => void;
}

export type SchoolsEditConversationProps = Readonly<Readonly_SchoolsEditConversationProps>;

function buildSchoolsComposite(input: {
  readonly removed: readonly string[];
  readonly typedText: string;
}): string {
  const { removed, typedText } = input;
  const lines: string[] = ['[Context: Schools]'];

  if (removed.length > 0) {
    lines.push('', '[Selections]');
    for (const r of removed) lines.push(`• drop: ${r}`);
  }

  const trimmed = typedText.trim();
  if (trimmed.length > 0) {
    lines.push('', '[Message]');
    lines.push(trimmed);
  }

  return lines.join('\n');
}

export function SchoolsEditConversation({
  initial,
  onSendComposite,
  onDone,
}: SchoolsEditConversationProps) {
  const [removedNames, setRemovedNames] = useState<ReadonlySet<string>>(new Set());
  const [freeText, setFreeText] = useState('');
  const [capturedNotes, setCapturedNotes] = useState<readonly string[]>([]);

  const summary = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {initial.length === 0 ? (
          <span className="font-sans text-[11px] italic text-fg-muted">
            no schools added
          </span>
        ) : (
          initial.map((s, i) => (
            <span key={s.name} className="font-sans text-[11px] text-fg-muted">
              {i > 0 && <span className="me-2">·</span>}
              {s.name}
            </span>
          ))
        )}
      </div>
    ),
    [initial],
  );

  function toggleRemoval(name: string) {
    setRemovedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const removedList = useMemo(
    () => initial.filter((s) => removedNames.has(s.name)).map((s) => s.name),
    [initial, removedNames],
  );
  const hasChipDiff = removedList.length > 0;
  const canSend = freeText.trim().length > 0 || hasChipDiff;

  function handleSend(typedText: string) {
    const composite = buildSchoolsComposite({
      removed: removedList,
      typedText,
    });
    const nextSchools = initial.filter((s) => !removedNames.has(s.name));
    // For the mockup, school additions arrive via typed message. In production
    // the agent would parse the message and append the school server-side.
    onSendComposite(composite, nextSchools);
    setRemovedNames(new Set());
    setCapturedNotes((prev) => [...prev, composite]);
  }

  return (
    <EditConversation
      sectionLabel="Refining — Schools"
      summary={summary}
      prompt="Which schools should I update? Tap to drop one, or tell me about a new school (and any nut-free / hot-food policies)."
      onDone={onDone}
      draft={freeText}
      onDraftChange={setFreeText}
      draftPlaceholder={
        'e.g. "Add Westfield Primary, nut-free policy" or "Brookmere is term-only"'
      }
      capturedNotes={capturedNotes}
      canSend={canSend}
      onSendNote={handleSend}
      topChips={
        initial.length > 0 ? (
          <div className="flex w-full flex-col items-center gap-2">
            <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
              Your schools — tap to drop
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {initial.map((s) => (
                <RemovableChip
                  key={s.name}
                  label={s.name}
                  stagedForRemoval={removedNames.has(s.name)}
                  onToggle={() => toggleRemoval(s.name)}
                />
              ))}
            </div>
          </div>
        ) : null
      }
    />
  );
}

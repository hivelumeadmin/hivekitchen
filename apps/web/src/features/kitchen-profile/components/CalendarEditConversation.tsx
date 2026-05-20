import { useState } from 'react';
import { EditConversation } from './EditConversation.js';

export interface CalendarValue {
  readonly currentTerm: { readonly label: string; readonly value: string };
  readonly upcomingTrip: { readonly label: string; readonly value: string };
}

interface Readonly_CalendarEditConversationProps {
  readonly initial: CalendarValue;
  readonly onSendComposite: (composite: string, nextValue: CalendarValue) => void;
  readonly onDone: () => void;
}

export type CalendarEditConversationProps =
  Readonly<Readonly_CalendarEditConversationProps>;

/**
 * Calendar is a chat-only edit — no chip rails. Dates and term ranges don't
 * fit the tap-to-drop / tap-to-add pattern, so the user types changes and
 * Lumi interprets them server-side. The mockup keeps the structured state
 * unchanged on Send (no chip diff to apply) and just routes the composite
 * to the parent for logging / API dispatch.
 */
export function CalendarEditConversation({
  initial,
  onSendComposite,
  onDone,
}: CalendarEditConversationProps) {
  const [freeText, setFreeText] = useState('');
  const [capturedNotes, setCapturedNotes] = useState<readonly string[]>([]);

  const summary = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="font-sans text-[11px] text-fg-muted">
        {initial.currentTerm.value}
      </span>
      <span className="font-sans text-[11px] text-lumi-terracotta">
        · {initial.upcomingTrip.value}
      </span>
    </div>
  );

  const canSend = freeText.trim().length > 0;

  function handleSend(typedText: string) {
    const composite =
      `[Context: Calendar]\n\n[Message]\n${typedText.trim()}`;
    // No structured chip diff to apply locally — Lumi handles the date / term
    // interpretation server-side. Pass initial through unchanged.
    onSendComposite(composite, initial);
    setCapturedNotes((prev) => [...prev, composite]);
  }

  return (
    <EditConversation
      sectionLabel="Refining — Calendar"
      summary={summary}
      prompt="What's changing on your calendar? Term dates, an upcoming trip, anything Lumi should know."
      onDone={onDone}
      draft={freeText}
      onDraftChange={setFreeText}
      draftPlaceholder={
        'e.g. "Trip moved to Tue 21 May" or "Term ends Friday 19 July"'
      }
      capturedNotes={capturedNotes}
      canSend={canSend}
      onSendNote={handleSend}
    />
  );
}

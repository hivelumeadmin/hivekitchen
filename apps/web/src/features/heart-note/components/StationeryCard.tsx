import { useEffect, useState } from 'react';
import { AlertTriangleIcon, CheckCircleIcon, ClockIcon } from '../../../components/icons.js';

interface Envelope {
  readonly toLabel: string;
  readonly deliveryTime: string;
  readonly scheduled: boolean;
}

interface Readonly_StationeryCardProps {
  readonly envelope: Envelope;
  readonly draftText: string;
  readonly placeholder: string;
  readonly charCap: number;
  readonly savedHint: string;
  readonly saveError?: boolean;
  // Slice 4-S1 — parent listens for text changes to drive debounced autosave.
  // Card keeps its own controlled state so the textarea stays responsive even
  // when the parent's autosave call is in flight.
  readonly onTextChange?: (text: string) => void;
}

export type StationeryCardProps = Readonly<Readonly_StationeryCardProps>;

export function StationeryCard(props: StationeryCardProps) {
  const [text, setText] = useState(props.draftText);
  // When the parent loads a draft after mount (async fetch), seed the
  // textarea once the draftText arrives. Subsequent typing is owned by the
  // card's local state — we don't fight the user mid-keystroke.
  useEffect(() => {
    setText(props.draftText);
    // Intentionally re-syncing only when the external draftText changes.
  }, [props.draftText]);
  const charCount = text.length;

  return (
    <div className="overflow-hidden rounded-xl border border-border/30 bg-surface">
      <StationeryHeader envelope={props.envelope} />
      <div className="relative p-8">
        <textarea
          value={text}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            props.onTextChange?.(next);
          }}
          placeholder={props.placeholder}
          maxLength={props.charCap}
          dir="auto"
          className="min-h-[360px] w-full resize-none border-none bg-transparent font-serif text-[22px] italic leading-relaxed text-fg/90 placeholder:text-fg/20 focus:outline-none focus:ring-0"
          aria-label="Heart Note"
        />
      </div>
      <StationeryFooter
        charCount={charCount}
        charCap={props.charCap}
        savedHint={props.savedHint}
        saveError={props.saveError ?? false}
      />
    </div>
  );
}

function StationeryHeader({ envelope }: Readonly<{ readonly envelope: Envelope }>) {
  return (
    <div className="flex items-center justify-between border-b border-border/10 px-8 py-4">
      <span className="text-xs font-medium tracking-wider text-fg-muted/70">
        TO <span className="text-sacred">{envelope.toLabel.toUpperCase()}</span> · DELIVERED{' '}
        {envelope.deliveryTime}
      </span>
      {envelope.scheduled ? (
        <div className="flex items-center gap-1.5 text-safety-cleared">
          <ClockIcon className="h-3.5 w-3.5" />
          <span className="text-[11px] uppercase">Scheduled</span>
        </div>
      ) : null}
    </div>
  );
}

function StationeryFooter({
  charCount,
  charCap,
  savedHint,
  saveError,
}: Readonly<{
  readonly charCount: number;
  readonly charCap: number;
  readonly savedHint: string;
  readonly saveError: boolean;
}>) {
  return (
    <div className="flex items-center justify-between border-t border-border/10 bg-bg/30 px-8 py-5">
      <span className="text-[13px] text-fg-muted/60">
        {charCount} / {charCap} characters
      </span>
      {savedHint ? (
        <div
          className={`flex items-center gap-2 ${saveError ? 'text-safety-red' : 'text-safety-cleared'}`}
        >
          {saveError ? (
            <AlertTriangleIcon className="h-[18px] w-[18px]" />
          ) : (
            <CheckCircleIcon className="h-[18px] w-[18px]" />
          )}
          <span className="text-[13px]">{savedHint}</span>
        </div>
      ) : null}
    </div>
  );
}

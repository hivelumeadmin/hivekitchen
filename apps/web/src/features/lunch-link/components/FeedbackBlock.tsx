import { useState } from 'react';
import type { Rating, RatingOption } from '../data/mockData.js';

interface Readonly_FeedbackBlockProps {
  readonly question: string;
  readonly options: readonly RatingOption[];
  readonly hint: string;
  readonly onRate?: (rating: Rating) => void;
  // Slice 4-S4: pre-selected rating from the server (child already submitted;
  // show locked state on reload).
  readonly lockedRating?: Rating;
}

export type FeedbackBlockProps = Readonly<Readonly_FeedbackBlockProps>;

/**
 * Three emoji rating buttons with 72px tap targets (per DESIGN.md §3
 * `.child-scope` rule). Single-tap interaction — once the child picks,
 * the choice is recorded and the others fade.
 */
export function FeedbackBlock({
  question,
  options,
  hint,
  onRate,
  lockedRating,
}: FeedbackBlockProps) {
  const [selected, setSelected] = useState<Rating | null>(lockedRating ?? null);

  const handleRate = (rating: Rating) => {
    if (selected !== null) return; // already rated — lock
    setSelected(rating);
    onRate?.(rating);
  };

  return (
    <section className="space-y-6 pt-4 text-center">
      <h3 className="font-serif text-[22px] text-fg">{question}</h3>
      <div className="flex justify-center gap-6">
        {options.map((option) => (
          <RatingButton
            key={option.id}
            option={option}
            selected={selected === option.id}
            faded={selected !== null && selected !== option.id}
            onPick={() => handleRate(option.id)}
          />
        ))}
      </div>
      <p className="text-xs italic text-fg-muted/70">{hint}</p>
    </section>
  );
}

function RatingButton({
  option,
  selected,
  faded,
  onPick,
}: Readonly<{
  readonly option: RatingOption;
  readonly selected: boolean;
  readonly faded: boolean;
  readonly onPick: () => void;
}>) {
  const circleClass = selected
    ? 'border-lumi-terracotta shadow-[0_0_20px_rgba(180,106,78,0.25)]'
    : 'border-border/10 group-hover:border-lumi-terracotta/50 group-hover:shadow-[0_0_20px_rgba(180,106,78,0.15)]';
  const labelClass = selected
    ? 'text-lumi-terracotta'
    : 'text-fg-muted group-hover:text-lumi-terracotta';
  const groupClass = faded ? 'opacity-40 transition-opacity' : '';
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      aria-label={option.label}
      className={`group flex flex-col items-center gap-3 transition-transform duration-200 active:scale-95 ${groupClass}`}
    >
      <div
        className={`flex h-[72px] w-[72px] items-center justify-center rounded-full border bg-surface text-[32px] transition-all ${circleClass}`}
      >
        {option.emoji}
      </div>
      <span className={`text-[13px] font-medium transition-colors ${labelClass}`}>
        {option.label}
      </span>
    </button>
  );
}

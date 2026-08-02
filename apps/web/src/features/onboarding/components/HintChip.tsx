/**
 * Hint chip — non-selectable illustrative example of a response shape.
 *
 * Used with broad Lumi questions to help the parent compose a rich answer
 * in their own words. The chip is NOT a button — it's a visual example
 * sitting in the "what you might say" affordance space. No hover, no
 * cursor:pointer, no selection state, no payload.
 *
 * Italic serif font echoes Lumi's voice — these are *examples of what the
 * parent might say*, presented as if Lumi is gently suggesting the shape.
 *
 * See `chip-taxonomy-three-types` memory for the full taxonomy.
 */
interface HintChipProps {
  text: string;
}

export function HintChip({ text }: HintChipProps) {
  return (
    <span
      className={
        'inline-block rounded-md bg-warm-neutral-100 px-3 py-1.5 ' +
        'font-serif text-sm italic text-fg-muted'
      }
    >
      &ldquo;{text}&rdquo;
    </span>
  );
}

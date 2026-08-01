import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ChoiceChipMode = 'single' | 'multi';
type ChoiceChipVariant = 'choice' | 'skip';

interface ChoiceChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  selected: boolean;
  mode: ChoiceChipMode;
  variant?: ChoiceChipVariant;
  icon?: ReactNode;
}

/**
 * Interactive conversational choice chip.
 *
 * Selected state uses the `foliage` channel (confirmation) per Menon's call
 * during the Sally retrofit pass on 2026-05-19. Honors `docs/DESIGN.md` §1
 * Honey rule (honey-amber NEVER used for routine interactive state).
 *
 * Mode controls ARIA semantics only:
 *  - 'single' → role='radio' (single-select group)
 *  - 'multi'  → role='checkbox' (multi-select group)
 */
export function ChoiceChip({
  label,
  selected,
  mode,
  variant = 'choice',
  icon,
  disabled,
  ...buttonProps
}: ChoiceChipProps) {
  const isSkip = variant === 'skip';

  const base =
    'inline-flex items-center gap-2 rounded-md border px-4 py-2 ' +
    'font-sans text-sm transition-colors duration-fast ' +
    'focus-visible:outline focus-visible:outline-focus-indicator ' +
    'focus-visible:outline-offset-focus-indicator focus-visible:outline-focus-indicator';

  const stateClass = (() => {
    if (disabled) {
      // opacity-* is a real utility (it is not a colour alpha), so unlike the
      // previous border/bg/text alpha modifiers it actually renders. Without it
      // the disabled chip differed from the resting chip by one surface step.
      return 'cursor-not-allowed border-border bg-surface text-fg-muted opacity-60';
    }
    if (isSkip) {
      // Skip chip — outlined only, never fills. One-shot action, not a content choice.
      // Uses warm-neutral palette (not foliage) so it doesn't collide visually with
      // selected ChoiceChips, which DO use foliage. Reads as "step past this moment".
      return 'border-dashed border-warm-neutral-400 bg-bg text-fg-muted ' +
        'hover:border-warm-neutral-500 hover:text-fg';
    }
    if (selected) {
      // Foliage = confirmation channel. Calmer than honey/amber, on-doctrine.
      return 'border-foliage bg-foliage-soft text-fg hover:bg-foliage-soft';
    }
    return 'border-border bg-bg text-fg hover:border-foliage hover:bg-warm-neutral-50';
  })();

  return (
    <button
      type="button"
      role={mode === 'single' ? 'radio' : 'checkbox'}
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      className={`${base} ${stateClass}`}
      {...buttonProps}
    >
      {icon && <span aria-hidden>{icon}</span>}
      <span>{label}</span>
      {selected && !isSkip && (
        <span aria-hidden className="text-foliage">
          ✓
        </span>
      )}
    </button>
  );
}

import { ChoiceChip } from './ChoiceChip.js';

interface SkipChipProps {
  label?: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Skip-this-moment affordance. First-class on every good-to-have moment.
 *
 * Visually distinct from selected ChoiceChips (which use the foliage fill).
 * SkipChip uses a dashed warm-neutral outline so it reads as "step past this"
 * rather than "I chose this option."
 */
export function SkipChip({ label = 'Skip this moment', onClick, disabled }: SkipChipProps) {
  return (
    <ChoiceChip
      label={label}
      mode="single"
      variant="skip"
      selected={false}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

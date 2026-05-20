import { ChoiceChip, type ChoiceChipMode } from './ChoiceChip.js';

export interface ChipOption {
  key: string;
  label: string;
}

interface ChoiceChipGroupProps {
  options: ChipOption[];
  selected: string[];
  onChange: (selectedKeys: string[]) => void;
  mode: ChoiceChipMode;
  ariaLabel: string;
  disabled?: boolean;
}

export function ChoiceChipGroup({
  options,
  selected,
  onChange,
  mode,
  ariaLabel,
  disabled,
}: ChoiceChipGroupProps) {
  function toggle(key: string) {
    if (mode === 'single') {
      onChange([key]);
      return;
    }
    if (selected.includes(key)) {
      onChange(selected.filter((k) => k !== key));
    } else {
      onChange([...selected, key]);
    }
  }

  return (
    <div
      role={mode === 'single' ? 'radiogroup' : 'group'}
      aria-label={ariaLabel}
      className="flex flex-wrap gap-2"
    >
      {options.map((option) => (
        <ChoiceChip
          key={option.key}
          label={option.label}
          mode={mode}
          selected={selected.includes(option.key)}
          disabled={disabled}
          onClick={() => toggle(option.key)}
        />
      ))}
    </div>
  );
}

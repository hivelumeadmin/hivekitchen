export type TrustChipVariant =
  | 'cultural-template'
  | 'allergy-cleared'
  | 'pantry-fresh'
  | 'memory-provenance'
  | 'lumi-proposed';

interface TrustChipProps {
  variant: TrustChipVariant;
  label: string;
}

// Token classes resolve via apps/web/tailwind.config.ts → @hivekitchen/design-system
// tokenPresets. `sacred`, `safety-cleared`, `foliage`, `memory-provenance`,
// `lumi-terracotta` are the registered color groups (see design-system/src/tokens).
const VARIANT_CLASSES: Record<TrustChipVariant, string> = {
  'cultural-template': 'bg-sacred-100 text-sacred-800 border-sacred-200',
  'allergy-cleared':
    'bg-safety-cleared-100 text-safety-cleared-800 border-safety-cleared-200',
  'pantry-fresh': 'bg-foliage-100 text-foliage-800 border-foliage-200',
  'memory-provenance':
    'bg-memory-provenance-100 text-memory-provenance-800 border-memory-provenance-200',
  'lumi-proposed':
    'bg-lumi-terracotta-100 text-lumi-terracotta-800 border-lumi-terracotta-200',
};

function Checkmark() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M10 3L5 8.5 2 5.5 1.5 6l3.5 3.5 5.5-6L10 3z" />
    </svg>
  );
}

export function TrustChip({ variant, label }: TrustChipProps) {
  return (
    <span
      role="note"
      aria-label={label}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-sans text-[13px] font-medium leading-none ${VARIANT_CLASSES[variant]}`}
    >
      <Checkmark />
      {label}
    </span>
  );
}

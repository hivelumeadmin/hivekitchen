import type { ChipConfig } from '@hivekitchen/contracts';
import { ChoiceChip } from './components/ChoiceChip.js';
import { HintChip } from './components/HintChip.js';
import { SkipChip } from './components/SkipChip.js';

interface OnboardingChipsProps {
  chipConfig: ChipConfig | null;
  selections: string[];
  pending: boolean;
  onToggle: (key: string) => void;
  onSkip: () => void;
}

// Deterministic chips from the 2.7 backend, rendered inline below Lumi's turn
// (memory chip-taxonomy-three-types): hint = illustrative, action = single-select,
// choice = multi-select. Selection/exclusivity logic lives in the conversation
// hook; this component is presentation + the M5 parent-added provenance badge.
export function OnboardingChips({
  chipConfig,
  selections,
  pending,
  onToggle,
  onSkip,
}: OnboardingChipsProps) {
  if (chipConfig === null) return null;

  const hasHints = chipConfig.mode === 'hint' && (chipConfig.hints?.length ?? 0) > 0;
  const hasOptions =
    (chipConfig.mode === 'action' || chipConfig.mode === 'choice') &&
    (chipConfig.options?.length ?? 0) > 0;
  const hasSkip = Boolean(chipConfig.skip_label);
  if (!hasHints && !hasOptions && !hasSkip) return null;

  return (
    <div className="flex w-full flex-col items-center gap-2 pt-1">
      {hasHints && chipConfig.hints && (
        <>
          <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
            Something like
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {chipConfig.hints.map((hint) => (
              <HintChip key={hint} text={hint} />
            ))}
          </div>
        </>
      )}

      {hasOptions && chipConfig.options && (
        <>
          <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-memory-provenance-500">
            {chipConfig.mode === 'action' ? 'Tap one' : 'Tap any that apply'}
          </p>
          <div
            role={chipConfig.mode === 'action' ? 'radiogroup' : 'group'}
            aria-label="Suggested replies"
            className="flex flex-wrap justify-center gap-2"
          >
            {chipConfig.options.map((opt) => (
              <ChoiceChip
                key={opt.key}
                label={opt.label}
                mode={chipConfig.mode === 'action' ? 'single' : 'multi'}
                selected={selections.includes(opt.key)}
                icon={
                  opt.provenance === 'parent_added' ? (
                    <span
                      data-testid="chip-parent-added-badge"
                      className="font-bold leading-none text-amber"
                    >
                      ＋
                    </span>
                  ) : undefined
                }
                onClick={() => onToggle(opt.key)}
              />
            ))}
          </div>
        </>
      )}

      {hasSkip && (
        <div className="pt-1">
          <SkipChip label={chipConfig.skip_label} disabled={pending} onClick={onSkip} />
        </div>
      )}
    </div>
  );
}

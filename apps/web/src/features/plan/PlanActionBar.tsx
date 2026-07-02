import { CheckCircleIcon, RefreshIcon } from '@/components/icons.js';
import { PrimaryButton } from '@/components/PrimaryButton.js';
import { SecondaryButton } from '@/components/SecondaryButton.js';
import { StickyBottomBar } from '@/components/StickyBottomBar.js';
import { TalkToLumiButton } from '@/components/TalkToLumiButton.js';

interface Readonly_PlanActionBarProps {
  readonly onConfirm?: () => void;
  readonly onTalkToLumi?: () => void;
  /** When provided, the "Swap a day" secondary action is rendered. */
  readonly onSwapDay?: () => void;
}

export type PlanActionBarProps = Readonly<Readonly_PlanActionBarProps>;

/**
 * The finished-planner action surface — the locked `StickyBottomBar` pattern
 * (DESIGN.md §StickyBottomBar): primary "Confirm the week" on the left,
 * "Talk to Lumi" pinned to the right. Replaces the divergent in-flow
 * PlanActionSection. `role="region"` name "Plan actions" keeps the surface
 * addressable to assistive tech and the 13-s1 regression baseline.
 */
export function PlanActionBar({ onConfirm, onTalkToLumi, onSwapDay }: PlanActionBarProps) {
  return (
    <StickyBottomBar ariaLabel="Plan actions">
      <div className="flex flex-wrap items-center gap-4">
        <PrimaryButton onClick={onConfirm} icon={<CheckCircleIcon />}>
          Confirm the week
        </PrimaryButton>
        {onSwapDay !== undefined && (
          <SecondaryButton onClick={onSwapDay} icon={<RefreshIcon />}>
            Swap a day
          </SecondaryButton>
        )}
      </div>
      <TalkToLumiButton onClick={onTalkToLumi} />
    </StickyBottomBar>
  );
}

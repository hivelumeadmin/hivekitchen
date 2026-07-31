import { CheckCircleIcon, RefreshIcon, PrimaryButton, SecondaryButton, StickyBottomBar, TalkToLumiButton } from '@hivekitchen/ui';

interface Readonly_PlanActionBarProps {
  readonly onConfirm?: () => void;
  readonly onTalkToLumi?: () => void;
  /** When provided, the "Swap a day" secondary action is rendered. */
  readonly onSwapDay?: () => void;
  /** 13-s10 — the week is confirmed: the primary reflects the done state. */
  readonly confirmed?: boolean;
  /** 13-s10 — a confirm is in flight (disables the primary). */
  readonly confirming?: boolean;
}

export type PlanActionBarProps = Readonly<Readonly_PlanActionBarProps>;

/**
 * The finished-planner action surface — the locked `StickyBottomBar` pattern
 * (DESIGN.md §StickyBottomBar): primary "Confirm the week" on the left,
 * "Talk to Lumi" pinned to the right. Replaces the divergent in-flow
 * PlanActionSection. `role="region"` name "Plan actions" keeps the surface
 * addressable to assistive tech and the 13-s1 regression baseline.
 */
export function PlanActionBar({
  onConfirm,
  onTalkToLumi,
  onSwapDay,
  confirmed = false,
  confirming = false,
}: PlanActionBarProps) {
  return (
    <StickyBottomBar ariaLabel="Plan actions">
      <div className="flex flex-wrap items-center gap-4">
        <PrimaryButton
          onClick={confirmed ? undefined : onConfirm}
          disabled={confirmed || confirming}
          icon={<CheckCircleIcon />}
        >
          {confirmed ? 'Confirmed' : confirming ? 'Confirming…' : 'Confirm the week'}
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

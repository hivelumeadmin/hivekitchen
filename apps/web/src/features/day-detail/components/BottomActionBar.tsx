import {
  CalendarIcon,
  CheckCircleIcon,
  RefreshIcon,
} from '@hivekitchen/ui';
import { PrimaryButton } from '@hivekitchen/ui';
import { SecondaryButton } from '@hivekitchen/ui';
import { StickyBottomBar } from '@hivekitchen/ui';
import { TalkToLumiButton } from '@hivekitchen/ui';

interface Readonly_BottomActionBarProps {
  readonly footerHint: string;
  readonly onKeep?: () => void;
  readonly onSwap?: () => void;
  readonly onPause?: () => void;
  readonly onTalkToLumi?: () => void;
}

export type BottomActionBarProps = Readonly<Readonly_BottomActionBarProps>;

export function BottomActionBar({
  footerHint,
  onKeep,
  onSwap,
  onPause,
  onTalkToLumi,
}: BottomActionBarProps) {
  return (
    <StickyBottomBar>
      <div className="flex flex-wrap items-center gap-4">
        <PrimaryButton onClick={onKeep} icon={<CheckCircleIcon />}>
          Keep this lunch
        </PrimaryButton>
        <SecondaryButton onClick={onSwap} icon={<RefreshIcon />}>
          Swap to something else
        </SecondaryButton>
        <SecondaryButton onClick={onPause} icon={<CalendarIcon />}>
          Pause Tuesday
        </SecondaryButton>
      </div>
      <TalkToLumiButton hint={footerHint} onClick={onTalkToLumi} />
    </StickyBottomBar>
  );
}

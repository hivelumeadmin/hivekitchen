import {
  CalendarIcon,
  CheckCircleIcon,
  RefreshIcon,
} from '../../../components/icons.js';
import { PrimaryButton } from '../../../components/PrimaryButton.js';
import { SecondaryButton } from '../../../components/SecondaryButton.js';
import { StickyBottomBar } from '../../../components/StickyBottomBar.js';
import { TalkToLumiButton } from '../../../components/TalkToLumiButton.js';

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

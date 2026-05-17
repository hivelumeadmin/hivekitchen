import { CheckCircleIcon, RefreshIcon } from '../../../components/icons.js';
import { PrimaryButton } from '../../../components/PrimaryButton.js';
import { SecondaryButton } from '../../../components/SecondaryButton.js';
import { StickyBottomBar } from '../../../components/StickyBottomBar.js';
import { TalkToLumiButton } from '../../../components/TalkToLumiButton.js';

interface Readonly_ActionRowProps {
  readonly onConfirm?: () => void;
  readonly onTalkToLumi?: () => void;
  readonly onSwapDay?: () => void;
}

export type ActionRowProps = Readonly<Readonly_ActionRowProps>;

export function ActionRow({ onConfirm, onTalkToLumi, onSwapDay }: ActionRowProps) {
  return (
    <StickyBottomBar>
      <div className="flex flex-wrap items-center gap-4">
        <PrimaryButton onClick={onConfirm} icon={<CheckCircleIcon />}>
          Confirm the week
        </PrimaryButton>
        <SecondaryButton onClick={onSwapDay} icon={<RefreshIcon />}>
          Swap a day
        </SecondaryButton>
      </div>
      <TalkToLumiButton onClick={onTalkToLumi} />
    </StickyBottomBar>
  );
}

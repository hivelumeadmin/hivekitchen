import { ArrowRightIcon, SendIcon } from '../../../components/icons.js';
import { PrimaryButton } from '../../../components/PrimaryButton.js';
import { SecondaryButton } from '../../../components/SecondaryButton.js';
import { StickyBottomBar } from '../../../components/StickyBottomBar.js';
import { TalkToLumiButton } from '../../../components/TalkToLumiButton.js';

interface Readonly_HeartNoteActionsProps {
  readonly onSave?: () => void;
  readonly onSkip?: () => void;
  readonly onTalkToLumi?: () => void;
}

export type HeartNoteActionsProps = Readonly<Readonly_HeartNoteActionsProps>;

export function HeartNoteActions({ onSave, onSkip, onTalkToLumi }: HeartNoteActionsProps) {
  return (
    <StickyBottomBar>
      <div className="flex flex-wrap items-center gap-4">
        <PrimaryButton onClick={onSave} icon={<SendIcon />}>
          Save the note
        </PrimaryButton>
        <SecondaryButton onClick={onSkip} icon={<ArrowRightIcon />}>
          Skip today
        </SecondaryButton>
      </div>
      <TalkToLumiButton onClick={onTalkToLumi} />
    </StickyBottomBar>
  );
}

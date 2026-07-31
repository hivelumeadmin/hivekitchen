import { ArrowRightIcon, SendIcon, PrimaryButton, SecondaryButton, StickyBottomBar, TalkToLumiButton } from '@hivekitchen/ui';

interface Readonly_HeartNoteActionsProps {
  readonly onSave?: () => void;
  readonly onSkip?: () => void;
  readonly onTalkToLumi?: () => void;
  readonly onCopyLink?: () => void;
  readonly copyState?: 'idle' | 'copying' | 'copied';
  readonly isSaving?: boolean;
}

export type HeartNoteActionsProps = Readonly<Readonly_HeartNoteActionsProps>;

export function HeartNoteActions({
  onSave,
  onSkip,
  onTalkToLumi,
  onCopyLink,
  copyState = 'idle',
  isSaving = false,
}: HeartNoteActionsProps) {
  return (
    <StickyBottomBar>
      <div className="flex flex-wrap items-center gap-4">
        <PrimaryButton onClick={onSave} icon={<SendIcon />}>
          Save the note
        </PrimaryButton>
        <SecondaryButton onClick={onSkip} icon={<ArrowRightIcon />}>
          Skip today
        </SecondaryButton>
        {onCopyLink && (
          <button
            type="button"
            onClick={onCopyLink}
            disabled={copyState === 'copying' || isSaving}
            className="text-sm text-fg-muted underline underline-offset-2 disabled:opacity-50"
          >
            {copyState === 'copied' ? 'Copied!' : 'Copy lunch link'}
          </button>
        )}
      </div>
      <TalkToLumiButton onClick={onTalkToLumi} />
    </StickyBottomBar>
  );
}

import { useState } from 'react';
import {
  CalendarIcon,
  ImageIcon,
  MicIcon,
} from '@hivekitchen/ui';

interface Readonly_MessageComposerProps {
  readonly placeholder: string;
  readonly charCap: number;
  readonly onAttachImage?: () => void;
  readonly onAttachDate?: () => void;
  readonly onVoice?: () => void;
}

export type MessageComposerProps = Readonly<Readonly_MessageComposerProps>;

/**
 * Fixed-bottom composer for the Evening Check-in surface. Distinct from
 * `<StickyBottomBar>` — that's for action buttons; this is a text-entry
 * surface with attachment shortcuts and a voice button.
 *
 * Pages mounting this MUST add bottom padding (e.g. `pb-40`) so content
 * isn't hidden behind the composer.
 */
export function MessageComposer({
  placeholder,
  charCap,
  onAttachImage,
  onAttachDate,
  onVoice,
}: MessageComposerProps) {
  const [text, setText] = useState('');
  return (
    <div className="fixed bottom-0 left-0 z-40 w-full border-t border-[color-mix(in_srgb,var(--border)_30%,transparent)] bg-[color-mix(in_srgb,var(--surface)_95%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex max-w-3xl items-end gap-3 p-4">
        <div className="flex flex-grow flex-col rounded-2xl border border-border bg-surface-2 p-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            maxLength={charCap}
            className="h-12 min-h-[48px] w-full resize-none border-none bg-transparent p-3 text-fg placeholder:text-fg-muted focus:outline-none focus:ring-0"
            aria-label="Message"
          />
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onAttachImage}
                aria-label="Attach image"
                className="text-fg-muted transition-colors hover:text-lumi-terracotta"
              >
                <ImageIcon className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={onAttachDate}
                aria-label="Attach date"
                className="text-fg-muted transition-colors hover:text-lumi-terracotta"
              >
                <CalendarIcon className="h-5 w-5" />
              </button>
            </div>
            <span className="text-xs text-fg-muted">
              {text.length} / {charCap}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onVoice}
          aria-label="Hold to speak"
          className="group flex h-14 w-14 items-center justify-center rounded-full bg-sacred text-white shadow-lg transition-transform active:scale-90"
        >
          <MicIcon className="h-6 w-6 transition-transform group-hover:scale-110" />
        </button>
      </div>
    </div>
  );
}

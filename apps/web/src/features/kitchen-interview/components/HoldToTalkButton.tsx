import { MicIcon } from '../../../components/icons.js';

interface Readonly_HoldToTalkButtonProps {
  readonly label: string;
  readonly onPointerDown?: () => void;
  readonly onPointerUp?: () => void;
}

export type HoldToTalkButtonProps = Readonly<Readonly_HoldToTalkButtonProps>;

/**
 * Floating "Hold to talk" microphone control. NOT a `<StickyBottomBar>` —
 * this is an active voice-capture affordance, not a navigation CTA, so it
 * renders as a centered pill that floats above content with a soft shadow.
 *
 * Use `onPointerDown` / `onPointerUp` to wire actual press-and-hold capture
 * (touch and mouse, plus pointer cancel for fail-safe release).
 */
export function HoldToTalkButton({
  label,
  onPointerDown,
  onPointerUp,
}: HoldToTalkButtonProps) {
  return (
    <div className="pointer-events-none fixed bottom-24 left-0 z-40 flex w-full justify-center px-4">
      <button
        type="button"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="group pointer-events-auto flex min-h-[56px] items-center gap-3 rounded-full border border-lumi-terracotta bg-surface px-6 py-4 text-fg shadow-[0_4px_24px_rgba(0,0,0,0.4)] transition-all hover:-translate-y-px hover:border-lumi-terracotta-warmed focus:outline-none focus-visible:ring-2 focus-visible:ring-lumi-terracotta-warmed"
      >
        <MicIcon className="h-5 w-5 text-lumi-terracotta transition-colors group-hover:text-lumi-terracotta-warmed" />
        <span className="text-[11px] font-bold uppercase tracking-widest">{label}</span>
      </button>
    </div>
  );
}

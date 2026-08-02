import { WaveformIcon } from './icons.js';

interface Readonly_TalkToLumiButtonProps {
  /** Optional one-line hint shown beneath the button (e.g. last-rating note). */
  readonly hint?: string;
  readonly onClick?: () => void;
}

export type TalkToLumiButtonProps = Readonly<Readonly_TalkToLumiButtonProps>;

/**
 * Canonical "Talk to Lumi" action.
 *
 * Always: WaveformIcon + the label "Talk to Lumi" in lumi-terracotta with
 * uppercase tracking-widest. Placed at the right edge of the action surface
 * so users learn its location — a single, consistent affordance for any Lumi
 * interaction across the app.
 *
 * Honors the design rule documented in `docs/DESIGN.md` §7. The label and
 * icon are fixed (no overrides) to prevent drift; if a screen needs a
 * differently-named action, do not reach for this primitive.
 */
export function TalkToLumiButton({ hint, onClick }: TalkToLumiButtonProps) {
  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={onClick}
        className="group flex items-center gap-2 text-lumi-terracotta transition-colors hover:text-lumi-terracotta-warmed"
      >
        <WaveformIcon className="h-[18px] w-[18px]" />
        <span className="text-[11px] font-bold uppercase tracking-widest">Talk to Lumi</span>
      </button>
      {hint ? <p className="text-xs italic text-fg-muted">{hint}</p> : null}
    </div>
  );
}

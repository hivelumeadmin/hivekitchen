import { SparkleIcon } from './icons.js';

interface Readonly_LumiFABProps {
  readonly onClick?: () => void;
  readonly ariaLabel?: string;
  /** Show a small amber notification dot on the top-right corner of the FAB. */
  readonly notification?: boolean;
}

export type LumiFABProps = Readonly<Readonly_LumiFABProps>;

/**
 * Persistent floating Lumi affordance — anchored bottom-right of the page,
 * always lumi-terracotta. Different surface than `<TalkToLumiButton>`
 * (which is the in-action-bar variant); this one is for screens that don't
 * have a sticky action bar but still need a Lumi entry point.
 *
 * Honors the design rule documented in `.stitch/DESIGN.md` §7 — Lumi
 * affordances always use lumi-terracotta with hover transitioning to
 * lumi-terracotta-warmed.
 */
export function LumiFAB({
  onClick,
  ariaLabel = 'Talk to Lumi',
  notification = false,
}: LumiFABProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="group fixed bottom-8 right-8 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-lumi-terracotta text-bg shadow-lg transition-all hover:bg-lumi-terracotta-warmed active:scale-95"
    >
      <SparkleIcon className="h-6 w-6 transition-transform group-hover:rotate-12" />
      {notification ? (
        <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-bg bg-amber-warm" />
      ) : null}
    </button>
  );
}

import { ChevronLeftIcon } from './icons.js';

interface Readonly_DetailHeaderProps {
  readonly contextLabel: string;
  readonly currentLabel: string;
  readonly onBack?: () => void;
}

export type DetailHeaderProps = Readonly<Readonly_DetailHeaderProps>;

export function DetailHeader({ contextLabel, currentLabel, onBack }: DetailHeaderProps) {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border bg-bg">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-8 py-4">
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="text-fg-muted transition-transform duration-200 hover:text-amber-warm active:scale-95"
          >
            <ChevronLeftIcon className="h-6 w-6" />
          </button>
          <div className="flex items-center gap-2 text-[13px] font-medium tracking-wide text-fg-muted">
            <span className="cursor-pointer transition-colors hover:text-amber-warm">
              {contextLabel}
            </span>
            <span className="text-border">/</span>
            <span className="font-medium text-fg">{currentLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <LumiPulse />
          <div
            aria-label="User profile"
            className="h-10 w-10 overflow-hidden rounded-full border border-border/30 bg-surface"
          />
        </div>
      </div>
    </nav>
  );
}

function LumiPulse() {
  return (
    <div className="relative flex h-2.5 w-2.5 items-center justify-center" aria-hidden>
      <div className="absolute h-full w-full animate-pulse rounded-full bg-amber-warm blur-[2px]" />
      <div className="h-full w-full rounded-full bg-amber-warm" />
    </div>
  );
}


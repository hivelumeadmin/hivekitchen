import { WaveformIcon } from '@/components/icons.js';

export interface PlanActionSectionProps {
  onConfirm?: () => void;
  onTalkToLumi?: () => void;
  onSwapDay?: () => void;
}

export function PlanActionSection({
  onConfirm,
  onTalkToLumi,
  onSwapDay,
}: PlanActionSectionProps) {
  return (
    <section
      aria-label="Plan actions"
      className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 py-10 mb-8"
    >
      {/* Left group: confirm + speak */}
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={onConfirm}
          className="bg-amber-warm hover:bg-honey-accent text-bg font-bold px-10 py-4 rounded-xl transition-all duration-200 active:scale-95 font-sans text-sm"
        >
          Confirm the week
        </button>
        <button
          type="button"
          onClick={onTalkToLumi}
          className="flex items-center gap-3 text-fg-muted hover:text-fg transition-colors font-sans text-sm font-bold"
        >
          <WaveformIcon className="h-5 w-5" />
          Speak to Lumi
        </button>
      </div>

      {/* Right: swap a day */}
      <button
        type="button"
        onClick={onSwapDay}
        className="font-sans text-sm text-fg-muted hover:text-amber-warm transition-colors border-b border-fg-muted/30 pb-1"
      >
        Swap a day
      </button>
    </section>
  );
}

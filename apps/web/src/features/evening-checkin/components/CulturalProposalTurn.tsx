import { SparkleIcon } from '../../../components/icons.js';

interface Readonly_CulturalProposalTurnProps {
  readonly label: string;
  readonly heartNote: string;
  readonly primaryLabel: string;
  readonly secondaryLabel: string;
  readonly onPrimary?: () => void;
  readonly onSecondary?: () => void;
}

export type CulturalProposalTurnProps = Readonly<Readonly_CulturalProposalTurnProps>;

export function CulturalProposalTurn({
  label,
  heartNote,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
}: CulturalProposalTurnProps) {
  return (
    <div className="flex flex-col gap-4 border-l-2 border-sacred ps-6">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-widest text-sacred">
          {label}
        </span>
        <SparkleIcon className="h-3.5 w-3.5 text-sacred" />
      </div>
      <div className="rounded-xl border border-sacred/30 bg-sacred/10 p-6">
        <p className="mb-6 font-serif text-[26px] italic leading-snug text-fg">
          {heartNote}
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onPrimary}
            className="rounded-full border border-sacred px-6 py-2 text-[11px] font-medium uppercase tracking-widest text-sacred transition-all hover:bg-sacred hover:text-white active:scale-95"
          >
            {primaryLabel}
          </button>
          <button
            type="button"
            onClick={onSecondary}
            className="rounded-full border border-border px-6 py-2 text-[11px] font-medium uppercase tracking-widest text-fg-muted transition-all hover:bg-surface-2 active:scale-95"
          >
            {secondaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

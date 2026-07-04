import { TimerIcon } from '../../../components/icons.js';
import type { MessagePart, Proposal } from '../data/mockData.js';

interface Readonly_LumiTurnProps {
  readonly time: string;
  readonly message: readonly MessagePart[];
  readonly proposal: Proposal;
}

export type LumiTurnProps = Readonly<Readonly_LumiTurnProps>;

export function LumiTurn({ time, message, proposal }: LumiTurnProps) {
  return (
    <div className="flex flex-col gap-3 border-l-2 border-lumi-terracotta ps-6">
      <span className="text-[11px] font-medium uppercase tracking-widest text-lumi-terracotta">
        {time}
      </span>
      <div className="rounded-xl border border-border bg-surface p-6">
        <p className="mb-4 text-[15px] leading-relaxed text-fg">
          {message.map((p, i) =>
            p.highlight ? (
              <span key={i} className="text-lumi-terracotta">
                {p.text}
              </span>
            ) : (
              <span key={i}>{p.text}</span>
            ),
          )}
        </p>
        <ProposalCard proposal={proposal} />
      </div>
    </div>
  );
}

function ProposalCard({ proposal }: Readonly<{ readonly proposal: Proposal }>) {
  return (
    <div className="flex items-center gap-4">
      <img
        src={proposal.imageSrc}
        alt={proposal.imageAlt}
        className="h-16 w-16 rounded-lg border border-border object-cover"
      />
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] font-medium uppercase tracking-widest text-fg-muted">
          {proposal.label}
        </span>
        <span className="text-[15px] font-semibold text-fg">{proposal.name}</span>
        <span className="flex items-center gap-1 text-xs text-foliage">
          <TimerIcon className="h-3.5 w-3.5" />
          {proposal.prepMinutes} min prep
        </span>
      </div>
    </div>
  );
}

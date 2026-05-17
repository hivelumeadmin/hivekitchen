import type { Turn } from '../data/mockData.js';
import { CulturalProposalTurn } from './CulturalProposalTurn.js';
import { LumiTurn } from './LumiTurn.js';
import { PlanUpdateDiff } from './PlanUpdateDiff.js';
import { UserTurn } from './UserTurn.js';

interface Readonly_ConversationThreadProps {
  readonly turns: readonly Turn[];
}

export type ConversationThreadProps = Readonly<Readonly_ConversationThreadProps>;

export function ConversationThread({ turns }: ConversationThreadProps) {
  return (
    <div className="space-y-10">
      {turns.map((turn, i) => {
        switch (turn.kind) {
          case 'user':
            return <UserTurn key={i} time={turn.time} text={turn.text} />;
          case 'lumi':
            return (
              <LumiTurn
                key={i}
                time={turn.time}
                message={turn.message}
                proposal={turn.proposal}
              />
            );
          case 'diff':
            return (
              <PlanUpdateDiff
                key={i}
                previous={turn.previous}
                next={turn.next}
                status={turn.status}
              />
            );
          case 'cultural':
            return (
              <CulturalProposalTurn
                key={i}
                label={turn.label}
                heartNote={turn.heartNote}
                primaryLabel={turn.primaryLabel}
                secondaryLabel={turn.secondaryLabel}
              />
            );
        }
      })}
    </div>
  );
}

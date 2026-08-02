import { RailCard } from '@hivekitchen/ui';

interface ChildReaction {
  readonly emoji: string;
  readonly text: string;
  readonly date: string;
}

interface Readonly_ReactionCardProps {
  readonly reaction: ChildReaction;
}

export type ReactionCardProps = Readonly<Readonly_ReactionCardProps>;

export function ReactionCard({ reaction }: ReactionCardProps) {
  return (
    <RailCard eyebrow="Yesterday's reaction">
      <div className="flex items-center gap-4">
        <span className="text-3xl" aria-hidden>
          {reaction.emoji}
        </span>
        <div>
          <p className="text-[15px] text-fg">{reaction.text}</p>
          <p className="text-xs text-fg-muted">{reaction.date}</p>
        </div>
      </div>
    </RailCard>
  );
}

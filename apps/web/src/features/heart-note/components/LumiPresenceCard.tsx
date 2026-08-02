import { RailCard } from '@hivekitchen/ui';

interface Readonly_LumiPresenceCardProps {
  readonly childName: string;
  readonly suggestion: string;
}

export type LumiPresenceCardProps = Readonly<Readonly_LumiPresenceCardProps>;

export function LumiPresenceCard({ childName, suggestion }: LumiPresenceCardProps) {
  return (
    <RailCard
      variant="tinted"
      accent="lumi-terracotta"
      eyebrow={
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-lumi-terracotta" aria-hidden />
          Lumi Presence
        </span>
      }
    >
      <p className="text-sm italic text-fg-muted">
        “<span className="text-sacred">{childName}</span> {suggestion}”
      </p>
    </RailCard>
  );
}

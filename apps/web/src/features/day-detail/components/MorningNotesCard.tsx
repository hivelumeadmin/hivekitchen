import { LightbulbIcon } from '@hivekitchen/ui';

interface Readonly_MorningNotesCardProps {
  readonly note: string;
}

export type MorningNotesCardProps = Readonly<Readonly_MorningNotesCardProps>;

export function MorningNotesCard({ note }: MorningNotesCardProps) {
  return (
    <section className="rounded-lg border border-border/20 bg-surface p-8">
      <div className="mb-4 flex items-center gap-3">
        <LightbulbIcon className="h-5 w-5 text-amber-warm" />
        <h2 className="font-serif text-2xl text-fg">Notes for the morning</h2>
      </div>
      <p className="leading-relaxed text-fg-muted">{note}</p>
    </section>
  );
}

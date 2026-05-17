interface Readonly_HeartNoteCardProps {
  readonly body: string;
  readonly from: string;
}

export type HeartNoteCardProps = Readonly<Readonly_HeartNoteCardProps>;

/**
 * Renders a Heart Note **delivered to the child unmodified** (per DESIGN.md §3
 * `.child-scope` rule). The body text is the exact prose written by the
 * grandparent/parent — never abbreviated, never auto-summarized, never
 * translated.
 */
export function HeartNoteCard({ body, from }: HeartNoteCardProps) {
  return (
    <section className="relative">
      <div className="flex min-h-[200px] flex-col justify-between rounded-lg border border-border/10 bg-surface-2 p-8 shadow-inner">
        <p className="text-center font-serif text-[20px] italic leading-relaxed text-fg">
          {body}
        </p>
        <div className="mt-4 text-right">
          <span className="font-serif text-base italic text-sacred opacity-90">{from}</span>
        </div>
      </div>
      <div className="absolute -bottom-2 -right-2 h-4 w-4 rounded-full bg-sacred/30 blur-xl" />
    </section>
  );
}

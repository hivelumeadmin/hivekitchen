interface Readonly_MumNoteSalutationProps {
  readonly title: string;
  readonly date: string;
}

export type MumNoteSalutationProps = Readonly<Readonly_MumNoteSalutationProps>;

export function MumNoteSalutation({ title, date }: MumNoteSalutationProps) {
  return (
    <section className="space-y-2 text-center">
      <h1 className="font-serif text-[28px] leading-tight text-sacred">{title}</h1>
      <p className="text-xs font-medium uppercase tracking-widest text-fg-muted">{date}</p>
    </section>
  );
}

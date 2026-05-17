interface Readonly_InterviewHeaderProps {
  readonly title: string;
  readonly subtitle: string;
}

export type InterviewHeaderProps = Readonly<Readonly_InterviewHeaderProps>;

export function InterviewHeader({ title, subtitle }: InterviewHeaderProps) {
  return (
    <div className="mb-12 text-center">
      <h1 className="mb-4 font-serif text-[40px] leading-tight text-fg">{title}</h1>
      <p className="mx-auto max-w-md text-[15px] text-fg-muted">{subtitle}</p>
    </div>
  );
}

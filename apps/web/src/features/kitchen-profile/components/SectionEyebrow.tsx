interface Readonly_SectionEyebrowProps {
  readonly children: React.ReactNode;
}

export type SectionEyebrowProps = Readonly<Readonly_SectionEyebrowProps>;

export function SectionEyebrow({ children }: SectionEyebrowProps) {
  return (
    <h2 className="mb-8 text-[11px] font-bold uppercase tracking-[0.2em] text-fg-muted">
      {children}
    </h2>
  );
}

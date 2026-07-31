export type RailCardAccent = 'sacred' | 'lumi-terracotta';
export type RailCardVariant = 'bordered' | 'tinted' | 'muted';

interface Readonly_RailCardProps {
  /** Small uppercase label above the body. Accepts rich children for inline accents. */
  readonly eyebrow?: React.ReactNode;
  /**
   * Visual treatment.
   *  - `bordered` (default): surface bg + hairline border. With `accent`, a 4px left edge.
   *  - `tinted`: tinted surface (uses the accent color at 10% opacity). Requires `accent`.
   *  - `muted`: smaller padding, muted text, used for footnote-style cards.
   */
  readonly variant?: RailCardVariant;
  /** Channel accent. Toggles left-border colour (bordered) or tint colour (tinted). */
  readonly accent?: RailCardAccent;
  readonly children: React.ReactNode;
  readonly className?: string;
}

export type RailCardProps = Readonly<Readonly_RailCardProps>;

const accentBorderClass: Record<RailCardAccent, string> = {
  sacred: 'border-l-4 border-sacred',
  'lumi-terracotta': 'border-l-4 border-lumi-terracotta',
};

const accentTintClass: Record<RailCardAccent, string> = {
  sacred: 'border border-sacred/20 bg-sacred/10',
  'lumi-terracotta': 'border border-lumi-terracotta/20 bg-lumi-terracotta/10',
};

const accentEyebrowClass: Record<RailCardAccent, string> = {
  sacred: 'text-sacred',
  'lumi-terracotta': 'text-lumi-terracotta-warmed',
};

export function RailCard({
  eyebrow,
  variant = 'bordered',
  accent,
  children,
  className = '',
}: RailCardProps) {
  const chrome = chromeClass(variant, accent);
  const eyebrowColor = accent ? accentEyebrowClass[accent] : 'text-fg';
  const eyebrowText =
    variant === 'muted' ? 'text-[11px] tracking-wider' : 'text-[11px] tracking-widest';

  return (
    <section className={`rounded-lg ${chrome} ${className}`.trim()}>
      {eyebrow ? (
        <h3 className={`mb-4 font-medium uppercase ${eyebrowText} ${eyebrowColor}`}>
          {eyebrow}
        </h3>
      ) : null}
      {children}
    </section>
  );
}

function chromeClass(variant: RailCardVariant, accent?: RailCardAccent): string {
  if (variant === 'tinted' && accent) {
    return `${accentTintClass[accent]} p-6`;
  }
  if (variant === 'muted') {
    return 'border border-border/10 bg-bg/50 p-4 text-fg-muted/60';
  }
  // bordered (default)
  const accentBorder = accent ? accentBorderClass[accent] : 'border border-border/10';
  return `${accentBorder} bg-surface p-6`;
}

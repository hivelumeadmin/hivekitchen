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
  sacred: 'border border-sacred-300 bg-sacred-100',
  'lumi-terracotta': 'border border-lumi-terracotta-300 bg-lumi-terracotta-100',
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
    return 'border border-[color-mix(in_srgb,var(--border)_10%,transparent)] bg-[color-mix(in_srgb,var(--bg)_50%,transparent)] p-4 text-fg-muted';
  }
  // bordered (default)
  const accentBorder = accent ? accentBorderClass[accent] : 'border border-[color-mix(in_srgb,var(--border)_10%,transparent)]';
  return `${accentBorder} bg-surface p-6`;
}

type PageHeaderSize = 'sm' | 'md' | 'lg';
type EyebrowTone = 'muted' | 'sacred';

interface Readonly_PageHeaderProps {
  readonly eyebrow: string;
  readonly eyebrowTone?: EyebrowTone;
  readonly headlineSize?: PageHeaderSize;
  readonly headlineItalic?: boolean;
  /** Headline content. Compose inline accents directly, e.g. `A few words for <span className="text-sacred">Layla</span>`. */
  readonly children: React.ReactNode;
  readonly description?: string;
  readonly className?: string;
}

export type PageHeaderProps = Readonly<Readonly_PageHeaderProps>;

const eyebrowClass: Record<EyebrowTone, string> = {
  muted: 'text-fg-muted',
  sacred: 'font-semibold text-sacred',
};

const headlineClass: Record<PageHeaderSize, string> = {
  // 40px — Heart Note Composer
  sm: 'text-[40px] leading-tight',
  // 48px — Day Detail
  md: 'text-5xl leading-tight',
  // 56px — Weekly Plan / Brief
  lg: 'text-[56px] leading-[1.1]',
};

export function PageHeader({
  eyebrow,
  eyebrowTone = 'muted',
  headlineSize = 'lg',
  headlineItalic = false,
  children,
  description,
  className = '',
}: PageHeaderProps) {
  const containerClass = `mb-12 max-w-4xl ${className}`.trim();
  const italicClass = headlineItalic ? 'italic' : '';
  return (
    <header className={containerClass}>
      <p
        className={`mb-4 text-xs uppercase tracking-[0.2em] ${eyebrowClass[eyebrowTone]}`}
      >
        {eyebrow}
      </p>
      <h1
        className={`mb-6 font-serif text-fg ${headlineClass[headlineSize]} ${italicClass}`.trim()}
      >
        {children}
      </h1>
      {description ? (
        <p className="max-w-2xl text-base leading-relaxed text-fg-muted">{description}</p>
      ) : null}
    </header>
  );
}

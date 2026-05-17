import {
  ArticleIcon,
  PlayCircleIcon,
  WaveformIcon,
} from '../../../components/icons.js';

export type MediaMode = 'video' | 'audio' | 'text';

interface Readonly_MediaTabsProps {
  readonly active: MediaMode;
  readonly onChange: (mode: MediaMode) => void;
}

export type MediaTabsProps = Readonly<Readonly_MediaTabsProps>;

const tabs: ReadonlyArray<{ readonly mode: MediaMode; readonly label: string }> = [
  { mode: 'video', label: 'Watch Video' },
  { mode: 'audio', label: 'Listen to Lumi' },
  { mode: 'text', label: 'Read Text' },
] as const;

export function MediaTabs({ active, onChange }: MediaTabsProps) {
  return (
    <div className="relative z-30 w-full border-b border-border/20 bg-bg">
      <div className="mx-auto flex max-w-[720px]">
        {tabs.map((tab) => (
          <MediaTabButton
            key={tab.mode}
            mode={tab.mode}
            label={tab.label}
            active={active === tab.mode}
            onClick={() => onChange(tab.mode)}
          />
        ))}
      </div>
    </div>
  );
}

function MediaTabButton({
  mode,
  label,
  active,
  onClick,
}: Readonly<{
  readonly mode: MediaMode;
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}>) {
  const stateClass = active
    ? 'border-amber-warm text-amber-warm bg-amber-warm/5'
    : 'border-transparent text-fg-muted hover:bg-surface/50 hover:text-fg';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 border-b-2 py-5 text-sm tracking-wide transition-all duration-300 ${stateClass}`}
    >
      <TabIcon mode={mode} />
      {label}
    </button>
  );
}

function TabIcon({ mode }: Readonly<{ readonly mode: MediaMode }>) {
  const className = 'h-5 w-5';
  switch (mode) {
    case 'video':
      return <PlayCircleIcon className={className} />;
    case 'audio':
      return <WaveformIcon className={className} />;
    case 'text':
      return <ArticleIcon className={className} />;
  }
}

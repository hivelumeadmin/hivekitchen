import { GoogleLogoIcon } from '../../../components/icons.js';

interface Readonly_GoogleButtonProps {
  readonly label: string;
  readonly onClick?: () => void;
}

export type GoogleButtonProps = Readonly<Readonly_GoogleButtonProps>;

export function GoogleButton({ label, onClick }: GoogleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-h-[56px] items-center justify-center gap-3 rounded-lg border border-border bg-surface px-8 text-[11px] font-medium uppercase tracking-widest text-fg transition-colors hover:border-fg-muted"
    >
      <GoogleLogoIcon className="h-5 w-5" />
      <span>{label}</span>
    </button>
  );
}

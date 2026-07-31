import { AppleLogoIcon } from '@hivekitchen/ui';

interface Readonly_AppleButtonProps {
  readonly label: string;
  readonly onClick?: () => void;
}

export type AppleButtonProps = Readonly<Readonly_AppleButtonProps>;

export function AppleButton({ label, onClick }: AppleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-h-[56px] items-center justify-center gap-3 rounded-lg border border-border bg-surface px-8 text-[11px] font-medium uppercase tracking-widest text-fg transition-colors hover:border-fg-muted"
    >
      <AppleLogoIcon className="h-5 w-5" />
      <span>{label}</span>
    </button>
  );
}

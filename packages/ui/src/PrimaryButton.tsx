import * as React from 'react';

type PrimaryButtonSize = 'default' | 'lg';

interface Readonly_PrimaryButtonProps {
  readonly children: React.ReactNode;
  readonly onClick?: () => void;
  readonly type?: 'button' | 'submit' | 'reset';
  readonly disabled?: boolean;
  /** Leading icon. Required for visual consistency across all action surfaces. */
  readonly icon: React.ReactElement<{ className?: string }>;
  /**
   * Size variant.
   *  - `default` — `px-8 py-3` (compact, for `<StickyBottomBar>` action surfaces)
   *  - `lg` — `w-full min-h-[56px]` (chunky, for form CTAs like "Enter Kitchen")
   */
  readonly size?: PrimaryButtonSize;
  readonly className?: string;
  readonly ariaLabel?: string;
}

export type PrimaryButtonProps = Readonly<Readonly_PrimaryButtonProps>;

const sizeClass: Record<PrimaryButtonSize, string> = {
  default: 'px-8 py-3 font-bold',
  lg: 'w-full min-h-[56px] px-8 font-medium uppercase tracking-widest',
};

/**
 * Canonical primary call-to-action.
 *
 * Always: filled `amber-warm` with `text-bg`, darker `amber` on hover,
 * subtle scale-down on press. Always has a leading icon (auto-sized to
 * `h-5 w-5`).
 *
 * Honors the design rule documented in `docs/DESIGN.md` §7 — primary CTAs
 * never use sacred-plum, lumi-terracotta, or honey-accent (each is reserved
 * for other channels).
 */
export function PrimaryButton({
  children,
  onClick,
  type = 'button',
  disabled,
  icon,
  size = 'default',
  className = '',
  ariaLabel,
}: PrimaryButtonProps) {
  const sizedIcon = React.cloneElement(icon, {
    className: `${icon.props.className ?? ''} h-5 w-5`.trim(),
  });
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-amber-warm text-bg transition-all duration-200 hover:bg-amber active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${sizeClass[size]} ${className}`.trim()}
    >
      {sizedIcon}
      <span>{children}</span>
    </button>
  );
}

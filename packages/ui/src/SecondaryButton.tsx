import * as React from 'react';

interface Readonly_SecondaryButtonProps {
  readonly children: React.ReactNode;
  readonly onClick?: () => void;
  readonly type?: 'button' | 'submit' | 'reset';
  readonly disabled?: boolean;
  /** Leading icon. Required for visual consistency across all action surfaces. */
  readonly icon: React.ReactElement<{ className?: string }>;
  readonly className?: string;
  readonly ariaLabel?: string;
}

export type SecondaryButtonProps = Readonly<Readonly_SecondaryButtonProps>;

/**
 * Canonical secondary action. Ghost / text-only button used alongside the
 * `<PrimaryButton>` in action surfaces — Skip, Swap, Pause, etc.
 *
 * Always: leading icon (auto-sized to `h-5 w-5`) + label, `text-[13px]
 * font-medium`, `text-fg-muted` resolving to `text-amber-warm` on hover.
 * Standard padding `px-4 py-3` on every surface.
 *
 * Honors the design rule documented in `docs/DESIGN.md` §7 — secondary
 * actions never compete visually with the primary CTA (no fill, muted text).
 */
export function SecondaryButton({
  children,
  onClick,
  type = 'button',
  disabled,
  icon,
  className = '',
  ariaLabel,
}: SecondaryButtonProps) {
  const sizedIcon = React.cloneElement(icon, {
    className: `${icon.props.className ?? ''} h-5 w-5`.trim(),
  });
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-2 px-4 py-3 text-[13px] font-medium text-fg-muted transition-colors hover:text-amber-warm disabled:cursor-not-allowed disabled:opacity-50 ${className}`.trim()}
    >
      {sizedIcon}
      <span>{children}</span>
    </button>
  );
}

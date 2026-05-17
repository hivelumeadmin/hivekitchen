interface Readonly_SecondaryCtaButtonProps {
  readonly children: React.ReactNode;
  readonly onClick?: () => void;
}

export type SecondaryCtaButtonProps = Readonly<Readonly_SecondaryCtaButtonProps>;

/**
 * Login-specific outlined ghost button — same large footprint as the
 * `<PrimaryButton size="lg">` form CTA but with no fill, used for
 * "Create Account" beneath the primary "Enter Kitchen" action.
 *
 * Not promoted to a shared primitive yet because this is currently the
 * only call site. If a second outlined-large button appears, extract to
 * `apps/web/src/components/`.
 */
export function SecondaryCtaButton({ children, onClick }: SecondaryCtaButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full min-h-[44px] rounded-lg border border-border bg-transparent px-8 text-[11px] font-medium uppercase tracking-widest text-fg transition-colors hover:border-fg-muted"
    >
      {children}
    </button>
  );
}

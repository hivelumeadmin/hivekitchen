interface Readonly_StickyBottomBarProps {
  readonly children: React.ReactNode;
  /**
   * When set, the fixed bar exposes `role="region"` with this accessible
   * name so screen readers (and e2e queries) can address the action surface.
   * Omitted → plain container, unchanged for existing consumers.
   */
  readonly ariaLabel?: string;
}

export type StickyBottomBarProps = Readonly<Readonly_StickyBottomBarProps>;

/**
 * Generic sticky bottom action bar shell. Position-fixed, full-width,
 * backdrop-blurred, centers content in a max-w-7xl container with
 * responsive flex layout.
 *
 * Pages that mount this MUST add bottom padding (e.g. pb-28 / pb-32)
 * to their main content so it isn't hidden behind the bar.
 */
export function StickyBottomBar({ children, ariaLabel }: StickyBottomBarProps) {
  return (
    <div
      role={ariaLabel !== undefined ? 'region' : undefined}
      aria-label={ariaLabel}
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/20 bg-bg px-8 py-6 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 md:flex-row">
        {children}
      </div>
    </div>
  );
}

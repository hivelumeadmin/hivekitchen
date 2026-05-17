interface Readonly_StickyBottomBarProps {
  readonly children: React.ReactNode;
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
export function StickyBottomBar({ children }: StickyBottomBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/20 bg-bg/80 px-8 py-6 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 md:flex-row">
        {children}
      </div>
    </div>
  );
}

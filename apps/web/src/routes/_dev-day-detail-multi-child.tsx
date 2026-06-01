import { AppFooter } from '../components/AppFooter.js';
import {
  ChevronLeftIcon,
  MoonIcon,
  SunIcon,
} from '../components/icons.js';
import { PageHeader } from '../components/PageHeader.js';
import { WallCardSwipeStack } from '../features/day-detail/components/WallCardSwipeStack.js';
import { exampleWeek } from '../features/day-detail/data/multiChildMockData.js';
import { useThemeStore } from '../stores/theme.store.js';

export function DevDayDetailMultiChildPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <MockHeader />
      <main className="mx-auto w-full max-w-5xl flex-grow space-y-12 px-6 pb-24 pt-12">
        <PageHeader
          eyebrow="Family-first · 2026-05-29 · responsive · theme-aware"
          eyebrowTone="muted"
          headlineSize="md"
          headlineItalic
          description="Day-detail rebuilt under the family-first model: ONE Main per day shared across kids, with per-child Variations as chips below. The week demonstrates the 3-Mains-with-2-day-repeats pattern (M1 Mon+Tue, M2 Wed+Thu, M3 Fri-flex). On phone — single column, wrapped variation chips, full vertical stack. On iPad and desktop — editorial two-column spread (ingredients on the left, method on the right) with chevron navigation and breathing typography. Theme toggle in the header switches between light and dark mode (preference persists across the app via the shared theme store)."
        >
          Day-detail ·{' '}
          <span className="text-amber-warm">family-first</span>
        </PageHeader>

        <WallCardSwipeStack week={exampleWeek} />
      </main>
      <AppFooter />
    </div>
  );
}

function MockHeader() {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const isDark = theme === 'dark';

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-4 md:px-10">
        <div className="flex items-center gap-4">
          <button
            type="button"
            aria-label="Back to weekly plan"
            className="rounded-full p-1.5 text-fg-muted transition-colors hover:text-amber-warm"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <div className="flex items-baseline gap-3">
            <span className="font-serif text-base italic text-fg">
              HiveKitchen
            </span>
            <span className="text-border">/</span>
            <span className="text-[12px] font-medium uppercase tracking-[0.18em] text-fg-muted">
              Week of 12 May
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={
              isDark ? 'Switch to light mode' : 'Switch to dark mode'
            }
            aria-pressed={isDark}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/40 bg-surface text-fg-muted transition-colors hover:border-amber-warm/40 hover:text-amber-warm"
          >
            {isDark ? (
              <SunIcon className="h-4 w-4" />
            ) : (
              <MoonIcon className="h-4 w-4" />
            )}
          </button>
          <div
            aria-label="User profile"
            className="h-9 w-9 overflow-hidden rounded-full border border-border/30 bg-surface"
          />
        </div>
      </div>
    </nav>
  );
}

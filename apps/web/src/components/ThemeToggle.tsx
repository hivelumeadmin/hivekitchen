import { useThemeStore } from '../stores/theme.store.js';
import { MoonIcon, SunIcon } from '@hivekitchen/ui';

/**
 * Switches between dark and light themes. The selection persists to
 * `localStorage` (key: `hivekitchen.theme`). First-time visitors get the
 * theme matching their OS `prefers-color-scheme` preference; this can be
 * overridden any time by tapping the toggle.
 */
export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggleTheme);
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={isDark}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="text-fg-muted transition-colors hover:text-amber-warm"
    >
      {isDark ? (
        <SunIcon className="h-[22px] w-[22px]" />
      ) : (
        <MoonIcon className="h-[22px] w-[22px]" />
      )}
    </button>
  );
}

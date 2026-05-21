import { BellIcon, UserCircleIcon } from './icons.js';
import { ThemeToggle } from './ThemeToggle.js';

export function AppHeader() {
  return (
    <header className="border-b border-neutral-400/30 bg-bg">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="font-serif text-3xl italic text-amber-warm">HiveKitchen</span>
        </div>
        <div className="flex items-center gap-6 text-fg-muted">
          <ThemeToggle />
          <button
            type="button"
            aria-label="Notifications"
            className="transition-colors hover:text-amber-warm"
          >
            <BellIcon className="h-[22px] w-[22px]" />
          </button>
          <button
            type="button"
            aria-label="User Profile"
            className="transition-colors hover:text-amber-warm"
          >
            <UserCircleIcon className="h-[22px] w-[22px]" />
          </button>
        </div>
      </div>
    </header>
  );
}

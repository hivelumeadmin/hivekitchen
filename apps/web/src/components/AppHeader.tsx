import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellIcon, UserCircleIcon } from './icons.js';
import { ThemeToggle } from './ThemeToggle.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { useClickOutside } from '@/hooks/useClickOutside.js';

export function AppHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  useClickOutside(menuRef, () => setMenuOpen(false));

  async function handleSignOut() {
    setMenuOpen(false);
    await logout();
    void navigate('/auth/login', { replace: true });
  }

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
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-label="User menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="transition-colors hover:text-amber-warm"
            >
              <UserCircleIcon className="h-[22px] w-[22px]" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-2 min-w-[180px] rounded-lg border border-neutral-400/30 bg-bg py-1 shadow-md">
                {user?.email && (
                  <p className="truncate border-b border-neutral-400/20 px-4 py-2 text-xs text-fg-muted">
                    {user.email}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="w-full px-4 py-2 text-left text-sm transition-colors hover:bg-neutral-400/10"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

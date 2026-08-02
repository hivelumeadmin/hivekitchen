import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellIcon, MenuIcon, UserCircleIcon } from '@hivekitchen/ui';
import { ThemeToggle } from './ThemeToggle.js';
import { useAuthStore } from '@/stores/auth.store.js';
import { useClickOutside } from '@/hooks/useClickOutside.js';

export interface AppHeaderProps {
  onMenuToggle?: () => void;
}

export function AppHeader({ onMenuToggle }: AppHeaderProps) {
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

  // Epic 13-s11 — Settings + Account left the collapsed 4-anchor sidebar; they
  // live here as utility chrome, the same idiom as Sign out.
  function goTo(path: string) {
    setMenuOpen(false);
    void navigate(path);
  }

  return (
    <header className="border-b border-neutral-400/30 bg-bg">
      <div className="flex w-full items-center justify-between px-4 py-4 md:px-6">
        <div className="flex items-center gap-3">
          {/* Hamburger — mobile only (sidebar handles desktop nav) */}
          {onMenuToggle && (
            <button
              type="button"
              aria-label="Open navigation menu"
              onClick={onMenuToggle}
              className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg lg:hidden"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
          )}
          {/* Brand — hidden on lg+ where the sidebar shows it */}
          <span className="font-serif text-3xl italic text-amber-warm lg:hidden">
            HiveKitchen
          </span>
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
                  onClick={() => goTo('/app/household/settings')}
                  className="w-full px-4 py-2 text-left text-sm transition-colors hover:bg-surface-2"
                >
                  Settings
                </button>
                <button
                  type="button"
                  onClick={() => goTo('/account')}
                  className="w-full px-4 py-2 text-left text-sm transition-colors hover:bg-surface-2"
                >
                  Account
                </button>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  className="w-full border-t border-neutral-400/20 px-4 py-2 text-left text-sm transition-colors hover:bg-surface-2"
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

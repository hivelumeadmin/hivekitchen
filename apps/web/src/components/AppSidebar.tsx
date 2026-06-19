import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  ArticleIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MailIcon,
  SettingsIcon,
  ShoppingBasketIcon,
  UtensilsIcon,
  UserCircleIcon,
  XIcon,
} from './icons.js';

const COLLAPSED_KEY = 'hk_sidebar_collapsed';

const NAV_ITEMS = [
  { label: 'Plan', href: '/app', Icon: CalendarIcon, end: true },
  { label: 'Grocery List', href: '/app/grocery-list', Icon: ShoppingBasketIcon, end: false },
  { label: 'Kitchen Profile', href: '/app/kitchen-profile', Icon: UtensilsIcon, end: false },
  { label: 'Memory', href: '/app/memory', Icon: ArticleIcon, end: false },
  { label: 'Heart Notes', href: '/app/heart-notes', Icon: MailIcon, end: false },
] as const;

const BOTTOM_ITEMS = [
  { label: 'Settings', href: '/app/household/settings', Icon: SettingsIcon, end: false },
  { label: 'Account', href: '/account', Icon: UserCircleIcon, end: false },
] as const;

function navItemClass(isActive: boolean) {
  return [
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
    isActive
      ? 'border-l-2 border-amber-warm bg-surface-2 pl-[10px] text-amber-warm'
      : 'border-l-2 border-transparent text-fg-muted hover:bg-surface-2 hover:text-fg',
  ].join(' ');
}

interface SidebarNavProps {
  collapsed: boolean;
  onNavClick?: () => void;
}

function SidebarNav({ collapsed, onNavClick }: SidebarNavProps) {
  return (
    <>
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5" aria-label="Main navigation">
        {NAV_ITEMS.map(({ label, href, Icon, end }) => (
          <NavLink
            key={href}
            to={href}
            end={end}
            onClick={onNavClick}
            className={({ isActive }) => navItemClass(isActive)}
            title={collapsed ? label : undefined}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-neutral-400/30 p-2 space-y-0.5">
        {BOTTOM_ITEMS.map(({ label, href, Icon, end }) => (
          <NavLink
            key={href}
            to={href}
            end={end}
            onClick={onNavClick}
            className={({ isActive }) => navItemClass(isActive)}
            title={collapsed ? label : undefined}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </div>
    </>
  );
}

export interface AppSidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function AppSidebar({ mobileOpen, onMobileClose }: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === 'true'; }
    catch { return false; }
  });

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSED_KEY, String(next)); } catch { /* storage unavailable */ }
  }

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────── */}
      <aside
        className={[
          'hidden lg:flex lg:flex-col lg:shrink-0 lg:sticky lg:top-0 lg:h-screen',
          'border-r border-neutral-400/30 bg-surface transition-[width] duration-200 ease-in-out',
          collapsed ? 'lg:w-16' : 'lg:w-60',
        ].join(' ')}
        aria-label="Sidebar"
      >
        {/* Header row: brand + collapse toggle */}
        <div className="flex h-[65px] items-center justify-between border-b border-neutral-400/30 px-3">
          {!collapsed && (
            <span className="font-serif text-xl italic text-amber-warm select-none">
              HiveKitchen
            </span>
          )}
          <button
            type="button"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={toggleCollapsed}
            className={[
              'flex h-7 w-7 items-center justify-center rounded-md text-fg-muted',
              'transition-colors hover:bg-surface-2 hover:text-fg',
              collapsed ? 'mx-auto' : 'ml-auto',
            ].join(' ')}
          >
            {collapsed
              ? <ChevronRightIcon className="h-4 w-4" />
              : <ChevronLeftIcon className="h-4 w-4" />}
          </button>
        </div>

        <SidebarNav collapsed={collapsed} />
      </aside>

      {/* ── Mobile drawer overlay ────────────────────────────── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            aria-hidden="true"
            onClick={onMobileClose}
          />

          {/* Drawer panel */}
          <aside
            className="relative z-50 flex w-64 flex-col border-r border-neutral-400/30 bg-surface"
            aria-label="Sidebar"
          >
            <div className="flex h-[65px] items-center justify-between border-b border-neutral-400/30 px-3">
              <span className="font-serif text-xl italic text-amber-warm select-none">
                HiveKitchen
              </span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={onMobileClose}
                className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <SidebarNav collapsed={false} onNavClick={onMobileClose} />
          </aside>
        </div>
      )}
    </>
  );
}

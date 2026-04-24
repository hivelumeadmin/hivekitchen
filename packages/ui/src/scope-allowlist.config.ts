// SYNC: Keep in sync with scope-allowlist.eslint.js (ESLint plain-JS mirror).
// The TypeScript file is the source of truth; the JS twin exists only because
// ESLint runs in Node.js without a TS loader and cannot consume this file directly.

export type ScopeClass = 'app-scope' | 'child-scope' | 'grandparent-scope' | 'ops-scope';

export interface ScopeRestrictions {
  forbiddenComponents: string[];
}

export const scopeAllowlist: Record<ScopeClass, ScopeRestrictions> = {
  'app-scope': {
    forbiddenComponents: [],
  },
  'child-scope': {
    forbiddenComponents: [
      'Command',
      'CommandDialog',
      'CommandPalette',
      'AlertDialog',
      'AlertDialogContent',
      'AlertDialogTrigger',
      'Toast',
      'Toaster',
      'NavigationMenu',
      'NavigationMenuList',
      'NavigationMenuTrigger',
      'MobileNavAnchor',
      'Sidebar',
      'SidebarProvider',
      'Sheet',
      'SheetContent',
    ],
  },
  'grandparent-scope': {
    forbiddenComponents: [
      'Command',
      'CommandDialog',
      'CommandPalette',
      'MobileNavAnchor',
    ],
  },
  'ops-scope': {
    forbiddenComponents: [],
  },
};

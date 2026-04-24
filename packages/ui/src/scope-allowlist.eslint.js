// SYNC: Keep in sync with scope-allowlist.config.ts (the TypeScript source of truth).
// This plain-JS mirror exists only for ESLint consumption — ESLint runs in
// Node.js without a TypeScript loader and cannot import the .ts file directly.

export const scopeAllowlist = {
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

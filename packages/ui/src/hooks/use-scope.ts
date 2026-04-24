import { useLayoutEffect } from 'react';
import type { ScopeClass } from '../scope-allowlist.config.js';

const ALL_SCOPES: readonly ScopeClass[] = [
  'app-scope',
  'child-scope',
  'grandparent-scope',
  'ops-scope',
];

export function useScope(scope: ScopeClass): void {
  useLayoutEffect(() => {
    const html = document.documentElement;
    for (const other of ALL_SCOPES) {
      if (other !== scope) html.classList.remove(other);
    }
    html.classList.add(scope);
  }, [scope]);
}

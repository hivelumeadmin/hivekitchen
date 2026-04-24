import { useLayoutEffect } from 'react';
import type { ScopeClass } from '../scope-allowlist.config.js';

export function useScopeGuard(expectedScope: ScopeClass): void {
  useLayoutEffect(() => {
    if (import.meta.env.DEV) {
      if (!document.documentElement.classList.contains(expectedScope)) {
        console.error(
          `useScopeGuard: expected .${expectedScope} on <html>. ` +
            `Current classes: "${document.documentElement.className}". ` +
            `See packages/design-system/SCOPE_CHARTER.md.`,
        );
      }
    }
  }, [expectedScope]);
}

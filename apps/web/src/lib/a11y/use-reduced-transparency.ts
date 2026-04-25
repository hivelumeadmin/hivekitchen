import { useState, useEffect } from 'react';

const QUERY = '(prefers-reduced-transparency: reduce)';

export function useReducedTransparency(): boolean {
  const [prefersReducedTransparency, setPrefersReducedTransparency] = useState<boolean>(
    () => window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => {
      setPrefersReducedTransparency(e.matches);
    };
    mql.addEventListener('change', handler);
    return () => {
      mql.removeEventListener('change', handler);
    };
  }, []);

  return prefersReducedTransparency;
}

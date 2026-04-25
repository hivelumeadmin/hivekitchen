// apps/web/src/providers/query-provider.tsx
import { lazy, Suspense, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createSseBridge } from '@/lib/realtime/index.js';
import type { SseBridge } from '@/lib/realtime/index.js';

// Dynamic import keeps @tanstack/react-query-devtools out of the production
// bundle — Vite tree-shakes the unused import in builds where DEV is false.
const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-query-devtools').then((m) => ({ default: m.ReactQueryDevtools })),
    )
  : null;

// Singleton QueryClient — created once for the app lifetime.
// Not in useState (avoids recreation on HMR) and not in module scope (avoids leaking between tests).
// Pattern from TanStack Query v5 docs for Vite SPAs.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,         // 30s — avoids refetch storms on tab focus
      gcTime: 5 * 60_000,        // 5min — garbage collect unused query data
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
    },
    mutations: {
      // Safety-classified mutations have retry: 0 — set per-mutation, not globally.
    },
  },
});

// Expose for E2E perf timing tests — tree-shaken by Vite when VITE_E2E is absent.
if (import.meta.env.VITE_E2E === 'true') {
  (window as unknown as Record<string, unknown>).__hivekitchen_qc = queryClient;
}

interface QueryProviderProps {
  children: React.ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  const bridgeRef = useRef<SseBridge | null>(null);

  useEffect(() => {
    const bridge = createSseBridge(queryClient);
    bridgeRef.current = bridge;
    bridge.connect();

    return () => {
      bridge.disconnect();
      bridgeRef.current = null;
    };
  }, []); // Empty deps — connect once on mount, disconnect on unmount.

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {ReactQueryDevtools !== null && (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      )}
    </QueryClientProvider>
  );
}

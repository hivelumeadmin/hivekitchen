// apps/web/src/providers/query-provider.tsx
import { useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createSseBridge } from '@/lib/realtime/index.js';
import type { SseBridge } from '@/lib/realtime/index.js';

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
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}

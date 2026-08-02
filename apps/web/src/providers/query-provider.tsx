// apps/web/src/providers/query-provider.tsx
import { lazy, Suspense, useEffect, useRef } from 'react';
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createSseBridge } from '@/lib/realtime/index.js';
import type { SseBridge } from '@/lib/realtime/index.js';
import { useAuthStore } from '@/stores/auth.store.js';

// Dynamic import keeps @tanstack/react-query-devtools out of the production
// bundle — Vite tree-shakes the unused import in builds where DEV is false.
const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-query-devtools').then((m) => ({ default: m.ReactQueryDevtools })),
    )
  : null;

// React Query notifies observers through notifyManager, whose default scheduler
// is setTimeout(cb, 0) — a macrotask. That breaks controlled inputs backed by
// the cache: an optimistic write made inside a change handler lands AFTER React
// finishes the discrete click dispatch and restores the DOM node to its last
// committed prop, so a checkbox visibly snaps back for a frame before the
// re-render catches up. Flushing synchronously restores the behaviour a plain
// setState had. Batching is unaffected — notifyManager.batch() still coalesces;
// only the flush timing changes.
notifyManager.setScheduler((flush) => flush());

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

    // Story 13-s2.5 — the bridge is now the single SSE owner (proactive nudges
    // folded in). The connection embeds the access token in its URL, so a login
    // or refresh must reconnect to pick up the new token; otherwise a cold login
    // would wait for the next error/backoff cycle before nudges surface. connect()
    // closes the old EventSource and opens a fresh one — still one per tab.
    let prevToken = useAuthStore.getState().accessToken;
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (state.accessToken !== prevToken) {
        const wasSignedIn = prevToken !== null;
        prevToken = state.accessToken;
        // Drop every cached response on sign-out. Without this a same-user
        // re-login inside gcTime renders the previous session's cached data
        // instead of the loading state, and a different user could briefly be
        // served the last one's entries.
        if (wasSignedIn && state.accessToken === null) queryClient.clear();
        bridge.connect();
      }
    });

    return () => {
      unsubscribe();
      bridge.disconnect();
      bridgeRef.current = null;
    };
  }, []); // Empty deps — connect once on mount; reconnect only on token change.

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

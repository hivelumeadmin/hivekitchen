import { useEffect } from 'react';
import { LumiThreadTurnsResponseSchema } from '@hivekitchen/contracts';
import type { LumiContextSignal } from '@hivekitchen/types';
import { hkFetch } from '@/lib/fetch.js';
import { useLumiStore } from '@/stores/lumi.store.js';

// Registers the current route's surface context with the global Lumi store and
// pre-hydrates the surface thread (if known) before the panel is opened. The
// in-flight fetch is cancelled on unmount via AbortController so a stale
// hydration cannot land turns under a route the user has already left.
export function useLumiContext(signal: LumiContextSignal): void {
  const { surface } = signal;

  useEffect(() => {
    // Read isHydrating BEFORE setContext — setContext unconditionally resets it to
    // false, which would defeat the double-hydration guard if read afterwards.
    const { isHydrating } = useLumiStore.getState();
    useLumiStore.getState().setContext(signal);

    const { threadIds } = useLumiStore.getState();
    const threadId = threadIds[surface];
    if (threadId === undefined || isHydrating) return;

    const controller = new AbortController();
    useLumiStore.setState({ isHydrating: true });

    void (async () => {
      try {
        const raw = await hkFetch<unknown>(`/v1/lumi/threads/${threadId}/turns`, {
          method: 'GET',
          signal: controller.signal,
        });
        const parsed = LumiThreadTurnsResponseSchema.parse(raw);
        useLumiStore.getState().hydrateThread(surface, threadId, parsed.turns);
      } catch (err) {
        useLumiStore.setState({ isHydrating: false });
        if (controller.signal.aborted) return;
        console.warn('useLumiContext: thread hydration failed', err);
      }
    })();

    return () => controller.abort();
  }, [surface]);
}

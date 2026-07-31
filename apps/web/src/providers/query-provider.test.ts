import { describe, it, expect } from 'vitest';
import { notifyManager } from '@tanstack/react-query';

// Story 14-s6 review — guards the notifyManager scheduler override installed by
// providers/query-provider.tsx. React Query's default scheduler is
// setTimeout(cb, 0), which lands the re-render for an optimistic cache write
// AFTER React has restored a controlled input to its committed prop — the input
// visibly snaps back for a frame and any assertion taken right after the click
// reads the old value. A future provider refactor that drops the override would
// silently reintroduce that race.
//
// The probe targets notifyManager.batchCalls, which is how useBaseQuery and
// useMutation subscribe — that is the layer the scheduler actually governs.
// (queryCache.subscribe listeners fire synchronously either way, so probing
// those would pass with the default scheduler too and prove nothing.)
describe('query-provider notifyManager scheduler', () => {
  it('flushes observer notifications synchronously', async () => {
    await import('./query-provider.js');

    let notified = false;
    notifyManager.batchCalls(() => {
      notified = true;
    })();

    // No await, no timer flush. Under the default setTimeout(0) scheduler this
    // is still false here — verified with a negative control.
    expect(notified).toBe(true);
  });
});

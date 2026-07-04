import { test, expect } from '@playwright/test';

// UX-DR60: target 600ms, hard ceiling 1000ms.
const SSE_HARD_CEILING_MS = 1000;
// Minimal valid plan.updated event — satisfies InvalidationEvent schema.
const WEEK_ID = '00000000-0000-4000-8000-000000000001';

test.describe('SSE invalidation → queryClient latency (UX-DR60)', () => {
  test('plan.updated processed within hard ceiling', async ({ page }) => {
    // Stub EventSource with a fake that never connects and never errors.
    //
    // Why a full fake instead of intercepting the real constructor + mocking
    // /v1/events: the 13-s2.5 SSE bridge removes its listeners and reconnects
    // with backoff whenever the EventSource errors. A route.fulfill'ed
    // text/event-stream body ends immediately, so the real EventSource fires
    // `error` milliseconds after opening — every captured instance is already
    // dead (listeners detached) by the time the test dispatches on it. The
    // fake stays in CONNECTING forever, so the bridge's listeners remain
    // attached to a single stable instance we can dispatch through.
    await page.addInitScript(() => {
      class FakeEventSource extends EventTarget {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSED = 2;
        url: string;
        readyState = 0; // CONNECTING forever — never opens, never errors.
        withCredentials = false;
        onopen: ((e: Event) => void) | null = null;
        onmessage: ((e: MessageEvent) => void) | null = null;
        onerror: ((e: Event) => void) | null = null;
        constructor(url: string | URL) {
          super();
          this.url = String(url);
          (window as unknown as Record<string, unknown>).__capturedES = this;
        }
        close() {
          this.readyState = 2;
        }
      }
      (window as unknown as Record<string, unknown>).__capturedES = null;
      (window as unknown as Record<string, unknown>).EventSource =
        FakeEventSource as unknown as typeof EventSource;
    });

    await page.goto('/');

    // Wait for QueryProvider to mount: queryClient exposed (VITE_E2E=true build)
    // and EventSource created by bridge.connect() inside useEffect.
    await page.waitForFunction(
      () =>
        !!(window as unknown as Record<string, unknown>).__hivekitchen_qc &&
        !!(window as unknown as Record<string, unknown>).__capturedES,
      { timeout: 5000 },
    );

    const elapsedMs = await page.evaluate(
      ({ weekId }) => {
        return new Promise<number>((resolve, reject) => {
          const timeoutId = setTimeout(
            () => reject(new Error('Query cache did not update within 4s after SSE dispatch')),
            4000,
          );

          const qc = (
            window as unknown as Record<
              string,
              {
                setQueryData: (key: unknown[], data: unknown) => void;
                getQueryCache: () => {
                  subscribe: (
                    fn: (event?: { type?: string; query?: { queryKey?: unknown } }) => void,
                  ) => () => void;
                };
              }
            >
          ).__hivekitchen_qc;

          const es = (window as unknown as Record<string, EventSource>).__capturedES;

          // Seed the plan query BEFORE subscribing: invalidateQueries emits
          // cache notifications only for queries that exist in the cache — an
          // empty cache produces no 'updated' event and the test would time out.
          qc.setQueryData(['plan', weekId], { seeded: true });

          // Subscribe before dispatch so the listener is registered before the
          // event fires. Only resolve for an 'updated' notification on the
          // specific plan query this test invalidates — guards against
          // background cache churn (or the seed itself) triggering a false pass.
          const unsub = qc.getQueryCache().subscribe((event) => {
            if (event?.type !== 'updated') return;
            const keyStr = JSON.stringify(event?.query?.queryKey ?? []);
            if (!keyStr.includes(weekId)) return;
            clearTimeout(timeoutId);
            unsub();
            resolve(performance.now() - start);
          });

          // Start timer immediately before dispatch: elapsed = dispatch →
          // handleMessage → invalidateQueries → cache notification (AC 5).
          const start = performance.now();
          es.dispatchEvent(
            new MessageEvent('message', {
              data: JSON.stringify({
                type: 'plan.updated',
                week_id: weekId,
                guardrail_verdict: { verdict: 'cleared' },
              }),
            }),
          );
        });
      },
      { weekId: WEEK_ID },
    );

    // 600ms is the UX-DR60 target; 1000ms is the hard ceiling.
    expect(
      elapsedMs,
      `SSE bridge dispatch → query cache latency: ${elapsedMs.toFixed(1)}ms ` +
        `(target ≤600ms, hard ceiling ≤${SSE_HARD_CEILING_MS}ms per UX-DR60)`,
    ).toBeLessThan(SSE_HARD_CEILING_MS);
  });
});

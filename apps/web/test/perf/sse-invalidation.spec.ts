import { test, expect } from '@playwright/test';

// UX-DR60: target 600ms, hard ceiling 1000ms.
const SSE_HARD_CEILING_MS = 1000;
// Minimal valid plan.updated event — satisfies InvalidationEvent schema.
const WEEK_ID = '00000000-0000-4000-8000-000000000001';

test.describe('SSE invalidation → queryClient latency (UX-DR60)', () => {
  test('plan.updated processed within hard ceiling', async ({ page }) => {
    // Intercept EventSource constructor before app scripts load — captures the
    // instance the bridge creates in openConnection() so we can dispatch events.
    await page.addInitScript(() => {
      const OrigES = window.EventSource;
      (window as unknown as Record<string, unknown>).__capturedES = null;

      class TrackingES extends (
        OrigES as unknown as new (url: string | URL, config?: EventSourceInit) => EventSource
      ) {
        constructor(url: string | URL, config?: EventSourceInit) {
          super(url, config);
          (window as unknown as Record<string, unknown>).__capturedES = this;
        }
      }

      (window as unknown as Record<string, unknown>).EventSource = TrackingES;
    });

    // Mock /v1/events* — prevents network error, keeps EventSource alive for the test.
    // The SSE bridge will get 200 OK and wait; we inject the event manually below.
    await page.route('**/v1/events**', (route) =>
      route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        body: ':ok\n\n',
      }),
    );

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
                getQueryCache: () => {
                  subscribe: (
                    fn: (event?: { query?: { queryKey?: unknown } }) => void,
                  ) => () => void;
                };
              }
            >
          ).__hivekitchen_qc;

          const es = (window as unknown as Record<string, EventSource>).__capturedES;

          // Subscribe before dispatch so the listener is registered before the
          // event fires. Only resolve for the specific plan query this test
          // invalidates — guards against background cache churn triggering a
          // false pass.
          const unsub = qc.getQueryCache().subscribe((event) => {
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

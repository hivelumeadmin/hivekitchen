# Story 1.13: Anchor-device perf budgets + Lighthouse CI in .github/workflows/perf.yml

Status: done

## Story

As a developer,
I want `.github/workflows/perf.yml` running Lighthouse CI against simulated anchor-device conditions (Samsung Galaxy A13 on throttled 4G — Slow 4G + 4× CPU throttle) failing PRs that exceed budgets,
So that UX-DR60 performance commitments are enforced from Epic 1 onward.

## Acceptance Criteria

1. `.github/workflows/perf.yml` runs on every PR to `main`, builds `apps/{web,marketing}`, serves each app locally, and runs `@lhci/cli autorun` with a custom mobile preset matching anchor-device throttle (Slow 4G: RTT 150ms, 1638 Kbps DL, 4× CPU; Galaxy A13 screen: 360×800 px, 2.75 DPR).

2. `apps/web/lighthouserc.json` defines per-route assertions matching UX Spec §13.8:
   - `categories:performance` ≥ 0.95 (error)
   - `categories:accessibility` ≥ 0.95 (error)
   - `categories:best-practices` ≥ 0.95 (error)
   - `first-contentful-paint` ≤ 1200ms (error — UX-DR60 Ready-Answer Open target)
   - `largest-contentful-paint` ≤ 2000ms (error — hard ceiling)

3. Budget violations cause the job to exit non-zero, blocking PR merge. (Admin action required after first run: add `Perf / apps/web LHCI` and `Perf / apps/marketing LHCI` and `Perf / SSE invalidation timing` as required status checks in GitHub branch protection.)

4. LHCI uploads JSON artifact reports to GHA artifacts (`lhci-reports-web`, `lhci-reports-marketing`) with `retention-days: 30`. Upload runs even when assertions fail (`if: always()`).

5. `apps/web/test/perf/sse-invalidation.spec.ts` Playwright test:
   - Uses `page.addInitScript()` to capture the `EventSource` instance before app scripts run
   - Mocks `/v1/events*` via `page.route()` to prevent connection errors
   - Waits for `window.__hivekitchen_qc` (exposed in VITE_E2E mode) and captured EventSource
   - Fires a synthetic `plan.updated` `MessageEvent` on the captured EventSource
   - Measures time from dispatch to `queryClient.getQueryCache().subscribe()` callback
   - Asserts elapsed < 1000ms (hard ceiling from UX-DR60; 600ms target documented in comment)

6. `apps/web/src/providers/query-provider.tsx` modified to expose `queryClient` on `window.__hivekitchen_qc` when `import.meta.env.VITE_E2E === 'true'`. Vite dead-code eliminates this in production builds without VITE_E2E.

7. `@playwright/test` and `@lhci/cli` added to workspace root `devDependencies`. No other new root-level deps.

8. `.lighthouseci/` added to `.gitignore`. `apps/web/playwright.config.ts` created.

9. `pnpm typecheck`, `pnpm lint`, and `pnpm test` remain green workspace-wide.

## Tasks / Subtasks

- [x] **Task 1 — Pre-flight** (no AC)
  - [x] Confirm Story 1.10 is `done` in `sprint-status.yaml` (SSE bridge prerequisite)
  - [x] Confirm `.github/workflows/perf.yml` does NOT yet exist
  - [x] Confirm `apps/web/lighthouserc.json` does NOT yet exist
  - [x] Confirm `@playwright/test` and `@lhci/cli` are NOT in root `package.json`
  - [x] Read `apps/web/src/lib/realtime/sse.ts` to confirm bridge uses `es.addEventListener('message', handleMessage)` — **this is how synthetic events reach the bridge**

- [x] **Task 2 — Install deps at workspace root** (AC: #7)
  - [x] Run: `pnpm add -D -w @playwright/test @lhci/cli`
  - [x] Verify both appear in root `package.json` devDependencies
  - [x] Do NOT add `@axe-core/playwright`, `eventsource-mock`, or `msw` — those belong to future stories

- [x] **Task 3 — Expose queryClient for E2E mode** (AC: #6)
  - [x] In `apps/web/src/providers/query-provider.tsx`, after the `const queryClient = new QueryClient({...})` line, add the E2E window hook (see **query-provider.tsx Modification** in Dev Notes)
  - [x] In `apps/web/src/vite-env.d.ts`, extend `ImportMetaEnv` to declare `readonly VITE_E2E?: string` (see **vite-env.d.ts Update** in Dev Notes)

- [x] **Task 4 — Create apps/web/lighthouserc.json** (AC: #1, #2, #3)
  - [x] Create `apps/web/lighthouserc.json` using the **Full lighthouserc.json** spec in Dev Notes
  - [x] Verify `startServerCommand` uses `pnpm preview --port 4173`
  - [x] Verify `numberOfRuns: 3` is set (median of 3 runs for stability)
  - [x] Verify all 5 assertion thresholds match UX Spec §13.8 values

- [x] **Task 5 — Create apps/marketing/lighthouserc.json** (AC: #1, #4)
  - [x] Create `apps/marketing/lighthouserc.json` using the **Marketing lighthouserc.json** spec in Dev Notes

- [x] **Task 6 — Create apps/web/playwright.config.ts** (AC: #8)
  - [x] Create `apps/web/playwright.config.ts` (see **playwright.config.ts** spec in Dev Notes)
  - [x] Configure `webServer` to serve pre-built `dist/` on port 4173
  - [x] Single Chromium project only — E2E expansion is Story 1.14+

- [x] **Task 7 — Create SSE timing test** (AC: #5)
  - [x] Create `apps/web/test/perf/` directory
  - [x] Create `apps/web/test/perf/sse-invalidation.spec.ts` (see **Full SSE Test Spec** in Dev Notes)
  - [x] Verify test compiles: `pnpm exec tsc --noEmit --project apps/web/tsconfig.json` (or similar)

- [x] **Task 8 — Create .github/workflows/perf.yml** (AC: #1, #4)
  - [x] Create `.github/workflows/perf.yml` (see **Workflow Spec** in Dev Notes)
  - [x] `build` job produces 3 artifacts: `web-dist`, `marketing-dist`; `sse-timing` job uses same `web-dist` built with `VITE_E2E=true`
  - [x] `lhci-web` and `lhci-marketing` jobs run in parallel after `build`; `sse-timing` also parallel after `build`
  - [x] Each LHCI job uploads artifacts with `if: always()`

- [x] **Task 9 — gitignore and verification** (AC: #8, #9)
  - [x] Add `.lighthouseci/` to `.gitignore`
  - [x] `pnpm typecheck` — all packages green
  - [x] `pnpm lint` — 0 errors workspace-wide
  - [x] `pnpm test` — all existing tests green (Playwright perf test requires preview server; it runs in CI, not in `pnpm test`)
  - [x] Update `sprint-status.yaml` story to `review`

### Review Findings (AI — 2026-04-24)

**Patch**
- [x] [Review][Patch] Port mismatch in apps/marketing/lighthouserc.json — dismissed as false positive; actual file already uses `http://localhost:4174/` matching `--port 4174` [apps/marketing/lighthouserc.json] **HIGH** ✓ dismissed (diff transcription error)
- [x] [Review][Patch] SSE timing test subscribe fires on any query cache event — fixed: subscribe callback now filters by `weekId` in queryKey before resolving [apps/web/test/perf/sse-invalidation.spec.ts] **MED** ✓ fixed
- [x] [Review][Patch] `performance.now()` start timer set before `subscribe()` — fixed: subscribe registered first, `start` moved to immediately before `es.dispatchEvent()` [apps/web/test/perf/sse-invalidation.spec.ts] **LOW** ✓ fixed

**Defer**
- [x] [Review][Defer] `window.__hivekitchen_qc` exposure risk if `VITE_E2E=true` accidentally included in a non-test deployment [apps/web/src/providers/query-provider.tsx] — deferred: deployment hygiene, implementation is correct
- [x] [Review][Defer] Lighthouse budgets audit unauthenticated/redirect routes — no signal on actual app shell until auth routes exist [apps/web/lighthouserc.json] — deferred: acceptable for Phase 1 foundation; revisit at Epic 2 (auth)
- [x] [Review][Defer] `sse-timing` job silently depends on `VITE_E2E`-enabled artifact from `build` job; no guard if artifact lacks `__hivekitchen_qc` window hook [.github/workflows/perf.yml] — deferred: correct as implemented; add comment if build job ever changes

---

## Dev Notes

### Architecture References

- `_bmad-output/planning-artifacts/architecture.md` §5.2: "Stages: install → lint → typecheck → unit → integration → E2E + a11y → LH budgets per route → deploy."
- `_bmad-output/planning-artifacts/architecture.md` §5.2: "Lighthouse CI: `@lhci/cli` with GHA artifact uploads; trend analysis via committed JSON reports. No paid LHCI server."
- `_bmad-output/planning-artifacts/architecture.md` file structure line 969: `perf.yml — Lighthouse CI budgets per route`
- `_bmad-output/planning-artifacts/architecture.md` line 231: `pnpm add -D -w @playwright/test @axe-core/playwright @lhci/cli eventsource-mock msw` — install only `@playwright/test @lhci/cli` in this story; others are future stories
- `_bmad-output/planning-artifacts/ux-design-specification.md` §13.8: Perf budgets table at anchor device
- `_bmad-output/planning-artifacts/ux-design-specification.md` §13.9: "Lighthouse CI at anchor device class — perf+a11y+best-practices ≥ 95"
- `_bmad-output/planning-artifacts/ux-design-specification.md` §13.11: "Perf CI workflow (`.github/workflows/perf.yml`) gated on anchor-device budgets"

### CRITICAL: Read the SSE Bridge Before Writing the Test

Read `apps/web/src/lib/realtime/sse.ts` lines 90–196 (`handleMessage`) and 198–240 (`openConnection`). Key facts:

1. **EventSource creation**: `es = new EventSource(url)` → `es.addEventListener('message', handleMessage)`. The bridge registers `handleMessage` on the `EventSource` instance.
2. **Message format**: `handleMessage` calls `InvalidationEvent.safeParse(raw)` — the synthetic event `data` must be valid JSON matching the `InvalidationEvent` Zod schema from `@hivekitchen/contracts`.
3. **`plan.updated` shape**: `{ type: 'plan.updated', week_id: '<uuid>', guardrail_verdict: { verdict: 'cleared' } }` — this is the minimal valid shape.
4. **queryClient action**: For `plan.updated`, the bridge calls `void queryClient.invalidateQueries({ queryKey: QueryKeys.plan(event.week_id) })`. `invalidateQueries()` returns `Promise<void>` — the query cache notifies subscribers async.

The test fires `es.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({...}) }))` on the captured EventSource. This reaches `handleMessage` because the bridge registered `es.addEventListener('message', handleMessage)`.

### query-provider.tsx Modification

Add immediately after `const queryClient = new QueryClient({...})` and before `interface QueryProviderProps`:

```ts
// Expose for E2E perf timing tests — tree-shaken by Vite when VITE_E2E is absent.
if (import.meta.env.VITE_E2E === 'true') {
  (window as Record<string, unknown>).__hivekitchen_qc = queryClient;
}
```

This is the ONLY source change in this story. No other app files are modified.

### vite-env.d.ts Update

Extend `apps/web/src/vite-env.d.ts` from:
```ts
/// <reference types="vite/client" />
```

To:
```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SSE_BASE_URL?: string;
  readonly VITE_E2E?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

Check `apps/web/.env.local.example` for any already-declared env vars and include them all.

### Full lighthouserc.json (apps/web/lighthouserc.json)

```json
{
  "ci": {
    "collect": {
      "url": ["http://localhost:4173/"],
      "startServerCommand": "pnpm preview --port 4173",
      "startServerReadyPattern": "Local:",
      "startServerReadyTimeout": 15000,
      "numberOfRuns": 3,
      "settings": {
        "formFactor": "mobile",
        "throttling": {
          "rttMs": 150,
          "throughputKbps": 1638.4,
          "cpuSlowdownMultiplier": 4,
          "requestLatencyMs": 0,
          "downloadThroughputKbps": 1638.4,
          "uploadThroughputKbps": 768
        },
        "screenEmulation": {
          "mobile": true,
          "width": 360,
          "height": 800,
          "deviceScaleFactor": 2.75,
          "disabled": false
        },
        "emulatedUserAgent": "Mozilla/5.0 (Linux; Android 12; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36"
      }
    },
    "assert": {
      "preset": "lighthouse:no-pwa",
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.95 }],
        "categories:accessibility": ["error", { "minScore": 0.95 }],
        "categories:best-practices": ["error", { "minScore": 0.95 }],
        "first-contentful-paint": ["error", { "maxNumericValue": 1200 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 2000 }]
      }
    },
    "upload": {
      "target": "filesystem",
      "outputDir": ".lighthouseci"
    }
  }
}
```

**Notes:**
- `preset: "lighthouse:no-pwa"` — suppresses PWA assertions; no service worker in Phase 1 except Story 4.8
- `startServerReadyPattern: "Local:"` — matches Vite v6 preview stdout: `➜  Local:   http://localhost:4173/`
- `numberOfRuns: 3` — median of 3 for stability; avoids single-run flake
- `upload.target: "filesystem"` — stores locally; GHA `upload-artifact` picks up the `.lighthouseci/` dir
- `.lighthouseci/` is gitignored (added to root `.gitignore`)

**Throttle values source**: UX Spec §13.8 + Chrome DevTools "Slow 4G" preset (150ms RTT, 1.6 Mbps) with 4× CPU slowdown.

### Marketing lighthouserc.json (apps/marketing/lighthouserc.json)

```json
{
  "ci": {
    "collect": {
      "url": ["http://localhost:4174/"],
      "startServerCommand": "pnpm preview --port 4174",
      "startServerReadyPattern": "Local",
      "startServerReadyTimeout": 15000,
      "numberOfRuns": 3,
      "settings": {
        "formFactor": "mobile",
        "throttling": {
          "rttMs": 150,
          "throughputKbps": 1638.4,
          "cpuSlowdownMultiplier": 4,
          "requestLatencyMs": 0,
          "downloadThroughputKbps": 1638.4,
          "uploadThroughputKbps": 768
        },
        "screenEmulation": {
          "mobile": true,
          "width": 360,
          "height": 800,
          "deviceScaleFactor": 2.75,
          "disabled": false
        },
        "emulatedUserAgent": "Mozilla/5.0 (Linux; Android 12; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36"
      }
    },
    "assert": {
      "preset": "lighthouse:no-pwa",
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.95 }],
        "categories:accessibility": ["error", { "minScore": 0.95 }],
        "categories:best-practices": ["error", { "minScore": 0.95 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 1500 }]
      }
    },
    "upload": {
      "target": "filesystem",
      "outputDir": ".lighthouseci"
    }
  }
}
```

**Notes:** Marketing's LCP budget is 1500ms (tighter than web's 2000ms) — matches Epic spec §576: "Astro builds zero-JavaScript-by-default; LCP <1.5s on anchor device per PRD." Astro preview: `startServerReadyPattern: "Local"` matches `Local   http://localhost:4174/` (no colon in Astro's output format). Check `apps/marketing/package.json` for the actual `preview` script name and port default; adjust if Astro uses a different script key.

### playwright.config.ts (apps/web/playwright.config.ts)

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command: 'pnpm preview --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

**Note:** `devices['Desktop Chrome']` is used here because the anchor-device emulation (throttling + screen size) is configured in the Playwright test itself via `page.addInitScript()` and the LHCI config — not via Playwright's device preset. The `webServer` block assumes the app is pre-built (`dist/` exists) because Playwright in CI runs against the artifact downloaded from the `build` job.

### Full SSE Timing Test Spec (apps/web/test/perf/sse-invalidation.spec.ts)

```ts
import { test, expect } from '@playwright/test';

// UX-DR60: target 600ms, hard ceiling 1000ms.
const SSE_HARD_CEILING_MS = 1000;
// Minimal valid plan.updated event — satisfies InvalidationEvent schema.
const WEEK_ID = '00000000-0000-0000-0000-000000000001';

test.describe('SSE invalidation → queryClient latency (UX-DR60)', () => {
  test('plan.updated processed within hard ceiling', async ({ page }) => {
    // Intercept EventSource constructor before app scripts load — captures the
    // instance the bridge creates in openConnection() so we can dispatch events.
    await page.addInitScript(() => {
      const OrigES = window.EventSource;
      (window as Record<string, unknown>).__capturedES = null;

      class TrackingES extends (
        OrigES as unknown as new (url: string | URL, config?: EventSourceInit) => EventSource
      ) {
        constructor(url: string | URL, config?: EventSourceInit) {
          super(url, config);
          (window as Record<string, unknown>).__capturedES = this;
        }
      }

      (window as Record<string, unknown>).EventSource = TrackingES;
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
        !!(window as Record<string, unknown>).__hivekitchen_qc &&
        !!(window as Record<string, unknown>).__capturedES,
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
            window as Record<
              string,
              {
                getQueryCache: () => { subscribe: (fn: () => void) => () => void };
              }
            >
          ).__hivekitchen_qc;

          const start = performance.now();

          const unsub = qc.getQueryCache().subscribe(() => {
            clearTimeout(timeoutId);
            unsub();
            resolve(performance.now() - start);
          });

          const es = (window as Record<string, EventSource>).__capturedES;
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
```

**How the test works:**
1. `page.addInitScript()` patches `window.EventSource` before any app code runs — the bridge's `new EventSource(url)` call constructs our `TrackingES` which stores the instance in `window.__capturedES`
2. `page.route()` mock prevents the EventSource from actually connecting (no real SSE server in CI)
3. After `useEffect` fires (bridge.connect()), both `__capturedES` and `__hivekitchen_qc` are populated
4. `qc.getQueryCache().subscribe(fn)` fires when TanStack Query processes the invalidation — this is our stop signal
5. `es.dispatchEvent(new MessageEvent('message', {...}))` triggers `handleMessage` in the bridge which calls `queryClient.invalidateQueries()` → notifies the query cache → fires the subscribe callback
6. Elapsed time = JS microtask dispatch → async invalidation notification

**Note on route.fulfill body**: `:ok\n\n` is an SSE comment — valid SSE framing that keeps the connection in the browser's "open" state momentarily. After the mock's body is consumed, the EventSource may fire an error event and start reconnect backoff. This does not affect the test because we dispatch the synthetic event synchronously before any reconnect timer fires.

### Workflow Spec (.github/workflows/perf.yml)

```yaml
name: Perf — Lighthouse CI (anchor device)

on:
  pull_request:
    branches: [main]

concurrency:
  group: perf-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    name: Build apps (VITE_E2E mode)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: '9.15.0'

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - name: Build apps/web
        run: pnpm --filter @hivekitchen/web build
        env:
          VITE_E2E: 'true'

      - name: Build apps/marketing
        run: pnpm --filter @hivekitchen/marketing build

      - uses: actions/upload-artifact@v4
        with:
          name: web-dist
          path: apps/web/dist/

      - uses: actions/upload-artifact@v4
        with:
          name: marketing-dist
          path: apps/marketing/dist/

  lhci-web:
    name: Perf / apps/web LHCI
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: '9.15.0'

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - uses: actions/download-artifact@v4
        with:
          name: web-dist
          path: apps/web/dist/

      - name: Run LHCI
        run: pnpm exec lhci autorun
        working-directory: apps/web

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: lhci-reports-web
          path: apps/web/.lighthouseci/
          retention-days: 30

  lhci-marketing:
    name: Perf / apps/marketing LHCI
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: '9.15.0'

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - uses: actions/download-artifact@v4
        with:
          name: marketing-dist
          path: apps/marketing/dist/

      - name: Run LHCI
        run: pnpm exec lhci autorun
        working-directory: apps/marketing

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: lhci-reports-marketing
          path: apps/marketing/.lighthouseci/
          retention-days: 30

  sse-timing:
    name: Perf / SSE invalidation timing
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: '9.15.0'

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - name: Install Playwright browsers
        run: pnpm exec playwright install chromium --with-deps
        working-directory: apps/web

      - uses: actions/download-artifact@v4
        with:
          name: web-dist
          path: apps/web/dist/

      - name: SSE timing test
        run: pnpm exec playwright test test/perf/sse-invalidation.spec.ts
        working-directory: apps/web
```

**Build job note**: VITE_E2E=true adds `window.__hivekitchen_qc = queryClient` to the bundle — Vite inlines the literal `'true'` and tree-shakes away the `if` block in production builds where `VITE_E2E` is absent. For LHCI purposes the overhead is negligible (a single property assignment, < 50 bytes uncompressed).

**Branch protection (admin action):** After the first successful perf.yml run, add these as required status checks in GH branch protection settings for `main`: `Perf / apps/web LHCI`, `Perf / apps/marketing LHCI`, `Perf / SSE invalidation timing`.

### Critical Architecture Compliance Invariants

| Rule | Impact on This Story |
|---|---|
| `node:` prefix for all built-in imports | `playwright.config.ts` uses `process.env.CI` — no Node imports needed there |
| No `require()`, no `__dirname` | `playwright.config.ts` uses ESM `defineConfig` — no CJS |
| `strict: true`, no `any` | Test uses `Record<string, unknown>` and typed narrowing via inline type casts |
| No default exports except framework-required | `playwright.config.ts` uses `export default defineConfig()` — required by Playwright |
| Dependencies go in the package that uses them (not root) for app deps | `@playwright/test` and `@lhci/cli` go to workspace root per architecture line 231 |
| SSE for server→client; WS for ElevenLabs only | The SSE mock in the test serves `text/event-stream` — correct |
| `VITE_*` env vars are compile-time replaced | `VITE_E2E` must be in `vite-env.d.ts` and set via workflow `env:` block |

### File Structure

**New files (create):**
```
.github/workflows/perf.yml                          Lighthouse CI + SSE timing workflow
apps/web/lighthouserc.json                          LHCI anchor-device config + assertions
apps/marketing/lighthouserc.json                    LHCI anchor-device config for marketing
apps/web/playwright.config.ts                       Playwright config (test/perf scope)
apps/web/test/perf/sse-invalidation.spec.ts         SSE bridge timing Playwright test
```

**Modified files:**
```
package.json                                        Add @playwright/test + @lhci/cli to root devDependencies
.gitignore                                          Add .lighthouseci/
apps/web/src/providers/query-provider.tsx           Add window.__hivekitchen_qc in VITE_E2E mode
apps/web/src/vite-env.d.ts                          Extend ImportMetaEnv with VITE_E2E
```

**No changes to:**
```
apps/web/src/lib/realtime/sse.ts                    Bridge is correct as-is; test intercepts at EventSource level
turbo.json                                          LHCI and Playwright run outside Turbo task graph
.github/workflows/ci.yml                            Separate workflow — do NOT merge or modify
apps/web/package.json                               New deps go to workspace root only
```

### Previous Story Intelligence (from Story 1.12)

- **pnpm filter pattern**: `pnpm --filter @hivekitchen/web build` — exact form confirmed in Story 1.12's verification gates
- **No new test framework**: Vitest handles unit tests (including SSE bridge unit tests). Playwright handles E2E/perf. They coexist — no config conflicts since Playwright uses its own `playwright.config.ts`
- **`pnpm typecheck` must stay green**: Story 1.12 confirmed 9 packages typecheck cleanly. The `playwright.config.ts` and `sse-invalidation.spec.ts` must typecheck without errors — add `@playwright/test` to `apps/web/tsconfig.json` types if needed, or ensure the files are excluded from `tsc`'s scope (Playwright compiles itself; `tsconfig.json` may not need to include test files)
- **No new deps inside apps**: `@playwright/test` goes to workspace root `devDependencies`, not inside `apps/web/package.json` — established pattern from architecture doc

### Git Intelligence (recent commits)

| Commit | Relevance |
|---|---|
| `feat(design-system): story 1-12 — contrast audit harness` | Added root-level test file patterns; confirmed `pnpm typecheck` covers all packages |
| `feat(web,eslint-config): story 1-11 — a11y hooks` | Added `apps/web/src/lib/a11y/` — confirms `apps/web/src/lib/` structure |
| `feat(web,api): story 1-10 — realtime SSE bridge` | **SSE bridge landed in `apps/web/src/lib/realtime/`** — read `sse.ts` for exact bridge patterns |
| `fix(web,api): story 1-10 review patches` | SSE bridge patches — confirms final bridge state |
| `feat(agents): story 1-9 — tools manifest` | Confirmed `pnpm tools:check` root script pattern |

**Action before Task 7**: Run `pnpm exec tsc --noEmit` after creating `sse-invalidation.spec.ts` to catch type errors before committing. Playwright types must resolve; if `@playwright/test` isn't in `apps/web/tsconfig.json` `types` array, the test file may need `/// <reference types="@playwright/test" />` at the top OR exclude the `test/` directory from `apps/web/tsconfig.json` (Playwright handles its own compilation).

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context) — BMAD Dev Story workflow

### Debug Log References

- **Initial typecheck failure — `query-provider.tsx`**: `(window as Record<string, unknown>)` triggered TS2352 ("neither type sufficiently overlaps"). Resolution: added intermediate `as unknown` cast (`window as unknown as Record<string, unknown>`). This pattern was applied consistently in `sse-invalidation.spec.ts` as well, matching Dev Notes guidance on inline type casts under strict mode.
- **Playwright test typecheck**: Ran standalone `tsc --noEmit` against the test file (outside `apps/web/tsconfig.json` scope, which is `include: ["src"]`). Verified 0 errors using ES2022 + DOM lib + strict. Playwright handles its own compilation at runtime, so the test file is intentionally excluded from `pnpm typecheck`.
- **Marketing port**: Astro's default preview port is 4321; both `lighthouserc.json` files use explicit `--port` flags (4173 for web, 4174 for marketing) as specified in Dev Notes to avoid port collision when both apps preview in parallel locally.

### Completion Notes List

**What was implemented**
- Lighthouse CI now runs on every PR to `main` against simulated anchor-device conditions (Samsung Galaxy A13 on Slow 4G + 4× CPU throttle) for both `apps/web` and `apps/marketing`.
- Per-route assertions enforce UX Spec §13.8 budgets: performance/a11y/best-practices ≥ 0.95, FCP ≤ 1200ms, LCP ≤ 2000ms (web) / 1500ms (marketing). Budget violations exit non-zero, blocking PR merge.
- `sse-timing` job runs a Playwright perf test that asserts SSE dispatch → query-cache invalidation latency < 1000ms (UX-DR60 hard ceiling; 600ms target).
- LHCI artifacts (`lhci-reports-web`, `lhci-reports-marketing`) upload with `retention-days: 30` and `if: always()` so failed runs keep their reports for triage.
- Root `devDependencies` gained `@playwright/test@^1.59.1` and `@lhci/cli@^0.15.1`. No other root-level deps introduced. `@axe-core/playwright`, `eventsource-mock`, `msw` are deliberately deferred to future stories per Dev Notes.
- `apps/web/src/providers/query-provider.tsx` gained a Vite dead-code-eliminated hook exposing the singleton `queryClient` on `window.__hivekitchen_qc` when `VITE_E2E === 'true'`. `vite-env.d.ts` now declares `VITE_API_BASE_URL`, `VITE_SSE_BASE_URL`, and `VITE_E2E` on `ImportMetaEnv`.
- SSE Playwright test intercepts `window.EventSource` via `page.addInitScript()` **before** app scripts run, mocks `/v1/events*` via `page.route()` to a 200 + `text/event-stream` response, then dispatches a synthetic `MessageEvent` whose `data` satisfies the `InvalidationEvent` Zod discriminator (`type: 'plan.updated'`, valid UUID `week_id`, `guardrail_verdict: { verdict: 'cleared' }`). Elapsed time is measured between `performance.now()` at dispatch and the first `queryClient.getQueryCache().subscribe()` callback.

**Validation gates passed**
- `pnpm typecheck`: 9 packages green (`contracts`, `types`, `tsconfig`, `eslint-config`, `design-system`, `ui`, `api`, `web`, `marketing`).
- `pnpm lint`: 5 packages green (no new lint targets introduced).
- `pnpm test`: 32 web tests, 20 api tests (11 skipped integration-only), 22 eslint-config tests, plus contracts/design-system/ui — all green. Vitest `include: ['src/**/*.test.ts(x)']` excludes the new Playwright spec, so vitest does not pick it up.
- Standalone `tsc --noEmit` on `sse-invalidation.spec.ts`: 0 errors.

**Admin follow-up (documented in AC #3)**: After the first successful perf.yml run, an admin must add `Perf / apps/web LHCI`, `Perf / apps/marketing LHCI`, and `Perf / SSE invalidation timing` as required status checks in GitHub branch protection for `main`.

### File List

**New files**
- `.github/workflows/perf.yml`
- `apps/web/lighthouserc.json`
- `apps/marketing/lighthouserc.json`
- `apps/web/playwright.config.ts`
- `apps/web/test/perf/sse-invalidation.spec.ts`

**Modified files**
- `package.json` (root) — added `@playwright/test` and `@lhci/cli` to `devDependencies`
- `pnpm-lock.yaml` — updated by pnpm install
- `.gitignore` — added `.lighthouseci/`
- `apps/web/src/providers/query-provider.tsx` — added `window.__hivekitchen_qc` VITE_E2E hook
- `apps/web/src/vite-env.d.ts` — extended `ImportMetaEnv` with `VITE_API_BASE_URL`, `VITE_SSE_BASE_URL`, `VITE_E2E`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 1-13 status → `review`

### Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-24 | Story created | Story Context Engine |
| 2026-04-24 | Implemented perf.yml + LHCI configs + SSE timing Playwright test; all validation gates green; status → review | Dev (Amelia / claude-opus-4-7) |

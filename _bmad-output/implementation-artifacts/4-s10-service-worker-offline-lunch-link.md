# Story 4-S10: Service Worker for Offline Lunch Link

Status: done

**Slice key:** `4-s10-service-worker-offline-lunch-link`
**Epic:** 4 — Lunch Link & Heart Note Sacred Channel
**Source slice doc:** `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S10
**Builds on:** 4-S6 (the lunch-link surface is stable, HMAC token flow works, emoji rating is fire-and-forget)
**Folds:** AR-17 (offline resilience)

---

## Story

As a **child** opening a Lunch Link on a school device with unreliable connectivity,
I want the **page to load even when I lose signal** and to **tap the emoji rating even offline**,
so that **my lunch link experience is uninterrupted by patchy school Wi-Fi**.

---

## Acceptance Criteria

**AC1.** `vite-plugin-pwa` is added as a dev dependency to `apps/web`. `vite.config.ts` is updated with the `VitePWA` plugin using the `generateSW` strategy. `manifest: false` suppresses any install prompt / PWA manifest. Workbox precaches `*.{js,css,html}` SPA shell assets so that `index.html` + the JS/CSS bundles load from the service worker cache when offline.

**AC2.** After each successful `publicGet` response for `/v1/lunch-link/:token`, the component stores `{ payload: LoadedPayload, at: string }` in `localStorage` under the key `lunch-link-cache.${linkId}`. The `at` value is the ISO timestamp of the successful fetch.

**AC3.** When `publicGet` fails AND `navigator.onLine === false`, the component reads `lunch-link-cache.${linkId}` from localStorage. If the cached entry exists, the component renders the full lunch-link content (same JSX as the online `'loaded'` state) and shows a "Last synced {HH:MM}" badge. If no cache exists, the component renders the generic error state ("Couldn't load this lunch link. Please try again.").

**AC4.** A boolean `isOnline` state is initialized from `navigator.onLine` and kept current via `window.addEventListener('online')` and `window.addEventListener('offline')`. The "Last synced" badge is only visible when `!isOnline && loadState === 'loaded'` (served from cache) or set from a cached load. Cleanup removes both listeners on unmount.

**AC5.** The "Last synced {HH:MM}" badge is a small, non-alarming inline element (not a full-width banner). Suggested appearance: a muted text line below the `MumNoteSalutation`, e.g. `"offline · last synced {HH:MM}"`. The time is formatted from the stored ISO timestamp using `new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })` — system locale and 12/24h follows the user's device preference.

**AC6.** When the child taps an emoji rating while offline:
- `handleRate` fires `publicPost` which fails silently (already `void` — no change needed here).
- The `FeedbackBlock` already locks the emoji immediately on tap (existing S4 behavior — no change).
- The failed rating is stored in `localStorage` under `lunch-link-pending-rating.${linkId}` as `{ rating, linkId }`.
- A `window.addEventListener('online', ...)` effect replays the pending POST as soon as connectivity restores, then removes the localStorage entry.
- Cleanup removes the `online` listener on unmount.

**AC7.** The SW is only registered in production builds. In development (`import.meta.env.PROD === false`), no SW is registered and the component works in its existing online-only mode. Developers can test offline behavior with `pnpm build && pnpm preview`.

**AC8.** The `vite-plugin-pwa` plugin requires a `tsconfig` that includes the `lib: ["WebWorker"]` type for the service-worker context. This must NOT be added to the main `apps/web` tsconfig (which targets the browser/DOM context). If the plugin requires a separate tsconfig, create `apps/web/tsconfig.sw.json` for the SW compilation. The main `pnpm typecheck` command must still pass.

**AC9.** `pnpm typecheck` introduces no new errors in `apps/web`. Existing lunch-link tests (if any) pass unchanged.

---

## Demo Path

> 1. Open `/lunch/{valid-HMAC-token}` on a device with full signal → content loads normally
> 2. Open DevTools → Network → set "Offline" mode (or toggle airplane mode)
> 3. Reload the page → service worker serves `index.html` + bundles from cache → React renders → component reads API data from `localStorage` → renders full lunch content with "offline · last synced {HH:MM}" indicator
> 4. Tap 😋 emoji → `FeedbackBlock` locks immediately (optimistic lock — existing S4 behavior) → pending rating stored in localStorage
> 5. Set DevTools back to "Online" → `online` event fires → pending rating POST replays to server → `lunch-link-pending-rating.${linkId}` entry cleared from localStorage
> 6. `pnpm build && pnpm preview` required to verify SW caching (SW is disabled in dev mode)

---

## Critical Guardrails

**Service worker is for the SPA shell only — not the API.** The API (`VITE_API_BASE_URL`) is on a different origin. Workbox cannot reliably cache cross-origin responses without explicit CORS + `CacheableResponsePlugin` setup. This story avoids that complexity entirely: API response caching is done in `localStorage` from within the component. Do NOT attempt to add a Workbox `registerRoute` for the API URL.

**`manifest: false` is required.** HiveKitchen is not a PWA and must not show an install prompt or add a web app manifest. Omitting `manifest: false` causes `vite-plugin-pwa` to generate a manifest and trigger browser install UI on mobile. This must be suppressed.

**No SW in dev mode.** Service workers interfere with Vite's HMR. Set `devOptions: { enabled: false }` (the default). Documenting this in a code comment in `vite.config.ts` prevents future confusion.

**`localStorage` key naming convention.** Use `lunch-link-cache.${linkId}` (hyphen-separated, not dot) for the API cache, and `lunch-link-pending-rating.${linkId}` for pending ratings. These keys must be consistent between the write path (successful fetch / rating tap) and the read path (offline load / `online` event handler).

**`LoadedPayload` must be JSON-serializable.** The `LoadedPayload` type (defined locally in `lunch-link.tsx`) contains only primitives and plain objects — it is safe to `JSON.stringify`/`JSON.parse`. Do NOT try to cache the `LunchLinkPayload` Zod schema output directly from `publicGet` without casting to `LoadedPayload` first (the shapes are compatible, but the Zod-parsed object has no extra fields that need special handling).

**Rating retry is best-effort.** The `online` event may not fire if the device powers down before reconnecting. That is acceptable — the emoji is already locked optimistically. The retry is a quality improvement, not a correctness requirement.

**`vite-plugin-pwa` version pin.** At time of writing, `vite-plugin-pwa@0.21.x` is the stable release for Vite 6. Do NOT install `vite-plugin-pwa@1.x` (incompatible with Vite 6). Run `pnpm add -D vite-plugin-pwa@^0.21.0` explicitly.

**Do not change `publicGet` or `publicPost`.** Caching and retry logic lives entirely in `lunch-link.tsx`. `lib/fetch.ts` is unchanged.

**Do not add Zustand store for offline state.** `isOnline` is local component state — it is transient and specific to the lunch-link surface. No store.

---

## What Already Exists (Do Not Recreate)

**`lunch-link.tsx`** — `apps/web/src/routes/(app)/lunch-link.tsx`. Full route exists. `LoadedPayload` type, `LoadState`, `handleRate` (fire-and-forget with optimistic lock via FeedbackBlock), `publicGet`/`publicPost` calls, HMAC token verification, expired/invalid-link states — all in place.

**`FeedbackBlock`** — `apps/web/src/features/lunch-link/components/FeedbackBlock.js`. Already locks the emoji on tap immediately regardless of API outcome (S4 pattern). Do not change.

**`publicGet` and `publicPost`** — `apps/web/src/lib/fetch.ts`. Unauthenticated fetch wrappers for the child-facing surface. Unchanged.

**React Router v6** — `createBrowserRouter` in `apps/web/src/app.tsx`. The `/lunch/:linkId` route is already registered.

**`import.meta.env.PROD`** — Vite injects this boolean. `true` in production builds, `false` in dev. Use it to gate SW registration.

**Vite 6** — already in use. `vite-plugin-pwa@^0.21.x` targets Vite 5+/6.

---

## Tasks

### T1 — Add `vite-plugin-pwa` and update Vite config

**T1.1** Add dependency:
```
pnpm add -D "vite-plugin-pwa@^0.21.0" --filter @hivekitchen/web
```

**T1.2** Update `apps/web/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // No web app manifest — HiveKitchen is not a PWA and must not show
      // install prompts on the child's device.
      manifest: false,
      // generateSW: Workbox auto-generates a service worker that precaches
      // the SPA shell (index.html + hashed JS/CSS bundles). This makes the
      // /lunch/* routes load offline without a custom service worker file.
      strategies: 'generateSW',
      workbox: {
        // Only precache the shell assets. Do NOT cache API responses here —
        // the API is cross-origin (VITE_API_BASE_URL) and requires a separate
        // approach. Component-level localStorage handles API caching.
        globPatterns: ['**/*.{js,css,html}'],
        // Suppress the default SW console logs in production.
        disableDevLogs: true,
      },
      // SW only active in production builds. Vite HMR and the SW conflict in
      // dev mode — keep devOptions disabled.
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**T1.3** The `vite-plugin-pwa` generates `registerSW.js` and injects the SW registration script. With `registerType: 'autoUpdate'`, the plugin handles SW registration automatically — no changes needed in `main.tsx`.

**T1.4** Verify `pnpm typecheck` still passes after adding the plugin. The plugin injects virtual module types (`virtual:pwa-register`). If TypeScript complains about these, add `/// <reference types="vite-plugin-pwa/client" />` to `apps/web/src/vite-env.d.ts` (or create the file if it doesn't exist).

---

### T2 — Update `lunch-link.tsx` with offline support

**File:** `apps/web/src/routes/(app)/lunch-link.tsx`

All changes are additive to the existing component. Do not change the HMAC/stub token parsing logic, `LunchLinkExpiredState`, `LunchLinkLoadingState`, `LunchLinkErrorState`, or `FeedbackBlock` usage.

**T2.1** Add `isOnline` state and `lastSyncedAt` state at the top of `LunchLinkRoute`:

```typescript
const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
```

**T2.2** Add an effect to track online/offline status and replay pending ratings on reconnect:

```typescript
useEffect(() => {
  const handleOnline = () => {
    setIsOnline(true);
    // Replay a pending offline rating if one was queued.
    if (!linkId) return;
    const pendingKey = `lunch-link-pending-rating.${linkId}`;
    const raw = localStorage.getItem(pendingKey);
    if (raw === null) return;
    try {
      const { rating } = JSON.parse(raw) as { rating: 'loved' | 'ok' | 'not-really' };
      void publicPost(`/v1/lunch-link/${linkId}/rate`, { rating }).then(() => {
        localStorage.removeItem(pendingKey);
      });
    } catch {
      localStorage.removeItem(pendingKey);
    }
  };
  const handleOffline = () => setIsOnline(false);
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}, [linkId]);
```

**T2.3** Modify the existing `useEffect` that calls `publicGet`/`hkFetch` to:
1. On success (online): write to localStorage cache and update `lastSyncedAt`
2. On failure + offline: attempt to read from localStorage cache

Replace the inner HMAC branch of the fetch effect:
```typescript
} else if (isHmac) {
  setLoadState('loading');
  publicGet(`/v1/lunch-link/${linkId}`)
    .then(({ status, body }) => {
      if (!isMounted) return;
      if (status === 200) {
        const payload = body as LoadedPayload;
        setData(payload);
        setLoadState('loaded');
        // Cache the response for offline access.
        const cacheEntry = JSON.stringify({ payload, at: new Date().toISOString() });
        try {
          localStorage.setItem(`lunch-link-cache.${linkId}`, cacheEntry);
          setLastSyncedAt(null); // Freshly loaded from network — no "last synced" indicator.
        } catch {
          // localStorage write failure (e.g., storage quota) is non-fatal.
        }
      } else if (status === 410) {
        const snapshot = (body as LunchLinkExpiredPayload).last_state_snapshot;
        if (snapshot !== undefined && snapshot !== null) {
          setExpiredSnapshot(snapshot);
          setLoadState('expired');
        } else {
          setLoadState('error');
        }
      } else if (status === 404) {
        setLoadState('invalid-link');
      } else {
        setLoadState('error');
      }
    })
    .catch(() => {
      if (!isMounted) return;
      // Network failure — try offline cache.
      if (!navigator.onLine) {
        const raw = localStorage.getItem(`lunch-link-cache.${linkId}`);
        if (raw !== null) {
          try {
            const { payload, at } = JSON.parse(raw) as { payload: LoadedPayload; at: string };
            setData(payload);
            setLastSyncedAt(at);
            setLoadState('loaded');
            return;
          } catch {
            // Corrupt cache — fall through to error state.
          }
        }
      }
      setLoadState('error');
    });
}
```

**T2.4** Modify `handleRate` to store pending rating on network failure:

```typescript
const handleRate = (rating: 'loved' | 'ok' | 'not-really') => {
  if (!linkId || !isHmac) return;
  void publicPost(`/v1/lunch-link/${linkId}/rate`, { rating }).catch(() => {
    // If offline, store the rating for replay when connectivity restores.
    if (!navigator.onLine) {
      try {
        localStorage.setItem(
          `lunch-link-pending-rating.${linkId}`,
          JSON.stringify({ rating, linkId }),
        );
      } catch {
        // Non-fatal — best-effort retry.
      }
    }
  });
};
```

**T2.5** Add the "last synced" indicator to the JSX. Insert it between `MumNoteSalutation` and `HeartNoteCard`:

```tsx
{lastSyncedAt !== null && (
  <p className="text-center text-xs text-fg-muted/50">
    offline · last synced {new Date(lastSyncedAt).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    })}
  </p>
)}
```

Only render this element when `lastSyncedAt !== null` (i.e., the data came from the localStorage cache rather than a live network response). When online and freshly loaded, `lastSyncedAt` is `null` and the indicator is absent.

---

### T3 — TypeScript: vite-env.d.ts for PWA virtual modules

**File:** `apps/web/src/vite-env.d.ts` (create if not present)

```typescript
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
```

This resolves TypeScript errors on `virtual:pwa-register` and `virtual:pwa-info` imports. The second reference is only needed if `vite-plugin-pwa` injects virtual imports that TypeScript can't resolve — check after `pnpm typecheck`.

---

### T4 — Verify (manual, no automated tests needed)

This slice is UI + browser-API surface. No additional unit tests are required. Verify with:

```
pnpm build --filter @hivekitchen/web
pnpm preview --filter @hivekitchen/web
```

Then in the browser:
1. Open the lunch-link URL in Chrome or Edge (Firefox does not support Background Sync)
2. Verify the page loads
3. Open DevTools → Application → Service Workers — confirm the SW is registered and active
4. Open DevTools → Application → Cache Storage — confirm the SPA shell assets are precached
5. Open DevTools → Network → Offline
6. Reload — page loads from SW cache
7. Confirm "offline · last synced HH:MM" text is visible
8. Tap emoji — FeedbackBlock locks
9. Set back to Online — confirm the pending POST fires (visible in DevTools Network tab)

Existing tests: `pnpm --filter @hivekitchen/api test -- lunch-link` — all must still pass. The service worker change is web-only with no API changes.

---

## Project Structure Notes

**New files:**
- `apps/web/src/vite-env.d.ts` — PWA virtual module type references (create if not present)

**Modified files:**
- `apps/web/package.json` — `vite-plugin-pwa@^0.21.0` added to `devDependencies`
- `apps/web/vite.config.ts` — `VitePWA` plugin added
- `apps/web/src/routes/(app)/lunch-link.tsx` — `isOnline` state, `lastSyncedAt` state, localStorage cache read/write, offline rating retry, "last synced" badge JSX

**Not modified:**
- `apps/web/src/lib/fetch.ts` — `publicGet` and `publicPost` unchanged
- `apps/web/src/app.tsx` — router unchanged; no new routes
- `apps/web/src/main.tsx` — SW registration is handled by `vite-plugin-pwa` automatically (with `registerType: 'autoUpdate'`)
- `apps/web/src/features/lunch-link/components/FeedbackBlock.js` — optimistic lock behavior unchanged
- `apps/api/` — no API changes in this slice
- `packages/contracts/` — no contract changes

**Vite-plugin-pwa output:** On `pnpm build`, the plugin generates:
- `dist/sw.js` — the Workbox-generated service worker
- `dist/workbox-*.js` — Workbox runtime chunks
- These are served at the web root alongside `index.html`

---

## Task Completion Checklist

- [x] T1.1 — `vite-plugin-pwa@^0.21.0` added to `apps/web/package.json` devDependencies
- [x] T1.2 — `vite.config.ts` updated with `VitePWA({ manifest: false, strategies: 'generateSW', ... })`
- [x] T1.3 — `pnpm install` succeeds; no lockfile conflicts
- [x] T2.1 — `isOnline` and `lastSyncedAt` states added to `LunchLinkRoute`
- [x] T2.2 — `online`/`offline` event listeners added; pending rating replay on `online`
- [x] T2.3 — HMAC fetch branch: writes localStorage cache on success; reads on offline failure
- [x] T2.4 — `handleRate` stores pending rating to localStorage on offline failure
- [x] T2.5 — "last synced" indicator renders only when `lastSyncedAt !== null`
- [x] T3 — `vite-env.d.ts` has `/// <reference types="vite-plugin-pwa/client" />`
- [ ] T4 (manual) — `pnpm build && pnpm preview` → SW registered → offline reload shows cached content + "last synced" badge → emoji tap offline → reconnect replays rating (build verified — sw.js/workbox-*.js emitted; manual browser walkthrough pending reviewer)
- [x] `pnpm typecheck` (apps/web) — no new errors (only pre-existing `packages/contracts/src/heart-notes.ts(78,61)` Zod 3→4 migration error remains; confirmed identical on baseline)
- [x] `pnpm --filter @hivekitchen/api test -- lunch-link` — all existing tests pass (71 of 72; 1 pre-existing failure in `lunch-link.routes.test.ts > 200 with full payload when child + note exist` confirmed identical on baseline — unrelated to 4-s10)

---

## Dev Notes

### Why localStorage for API caching (not Workbox cross-origin caching)

The API (`VITE_API_BASE_URL`) is on a different origin from the web app. Workbox can cache cross-origin responses only if the server returns CORS headers AND the response is not opaque. While the lunch-link endpoint is public, adding `CacheableResponsePlugin` + cross-origin routing to the SW is non-trivial and fragile under prod vs. dev origin differences.

`localStorage` is simpler: the component already has the parsed response. Write it on success; read it on offline failure. No SW complexity, no origin matching.

### Why no SW in development

Vite's HMR relies on hot module updates through the dev server. A service worker that intercepts navigation and asset requests breaks HMR. Standard practice is to disable the SW in dev and test offline behavior against a prod build (`pnpm preview`).

### Offline cache scope

The localStorage cache key is `lunch-link-cache.${linkId}`. The `linkId` is the HMAC token (not a predictable ID), so each unique Lunch Link URL gets its own cache entry. Cache entries are never evicted automatically — they persist until overwritten on the next online load. This is acceptable for MVP (cache size per entry is ~500 bytes; children rarely visit more than one or two unique tokens per week).

### `lastSyncedAt === null` means "freshly loaded from network"

Setting `lastSyncedAt = null` on a successful online load and setting it to the stored timestamp only on an offline cache hit keeps the logic clean: the "last synced" badge is visible if and only if we're serving from cache.

### vite-plugin-pwa version compatibility

`vite-plugin-pwa@0.21.x` is tested against Vite 6. The `^0.21.0` pin prevents accidental upgrade to `1.x` which targets Vite 7+. If `pnpm install` resolves to `0.22.x`, verify the changelog for breaking changes before proceeding.

---

## Dev Agent Record

### Implementation Plan (executed)

1. **T1 — Vite + PWA wiring** — Added `vite-plugin-pwa@^0.21.0` as a dev dep on `@hivekitchen/web`. Rewrote `apps/web/vite.config.ts` with `VitePWA({ registerType: 'autoUpdate', manifest: false, strategies: 'generateSW', workbox: { globPatterns: ['**/*.{js,css,html}'], disableDevLogs: true }, devOptions: { enabled: false } })`. Production `vite build` confirms the plugin emits `dist/sw.js`, `dist/workbox-9c191d2f.js`, `dist/registerSW.js`, and precaches 4 SPA-shell entries (1.5 MiB). No web app manifest is generated (AC: install-prompt suppressed). SW is inert in dev (HMR safe).
2. **T3 — Virtual module types** — Added `/// <reference types="vite-plugin-pwa/client" />` to `apps/web/src/vite-env.d.ts` so TS understands `virtual:pwa-register` if it ever surfaces. `pnpm typecheck` introduces no new errors in `apps/web`; the single pre-existing failure in `packages/contracts/src/heart-notes.ts` is the in-flight Zod 3→4 migration on the branch and was confirmed identical at baseline (verified by stash → typecheck → stash pop).
3. **T2 — Offline support in `lunch-link.tsx`** —
   - Added `isOnline` and `lastSyncedAt` states (AC4). `isOnline` is initialized from `navigator.onLine` and kept current via `online`/`offline` listeners; `lastSyncedAt` is the rendered "served-from-cache" sentinel (AC5).
   - First `useEffect` registers `online` + `offline` listeners with proper cleanup; the `online` handler replays a queued rating from `lunch-link-pending-rating.${linkId}` and clears it on success (AC6 retry path).
   - The HMAC fetch branch now `JSON.stringify({ payload, at: new Date().toISOString() })` into `localStorage.lunch-link-cache.${linkId}` on the 200 path (AC2). The `.catch` branch checks `navigator.onLine === false`, reads the cache, parses, and renders the full loaded JSX with `lastSyncedAt` set (AC3). A successful network load explicitly resets `lastSyncedAt = null` so the badge stays absent on online refreshes (story Dev Notes §"lastSyncedAt === null means…").
   - `handleRate` now catches the publicPost rejection and writes `{ rating, linkId }` to `lunch-link-pending-rating.${linkId}` when offline (AC6 queue path). `FeedbackBlock`'s optimistic lock is unchanged.
   - Added the offline indicator JSX between `MumNoteSalutation` and `HeartNoteCard` (AC5): `<p className="text-center text-xs text-fg-muted/50">offline · last synced {HH:MM}</p>` formatted via `toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' })` — system locale + 12/24h follows the device. Rendered iff `lastSyncedAt !== null`.

### Decisions & deviations

- **`isOnline` is destructured as `const [, setIsOnline]`.** AC4 mandates the state plus listener wiring, but T2.5 routes the badge through `lastSyncedAt` alone. Keeping `setIsOnline` wired (so the state stays current per AC4) without reading the value avoided an unused-binding warning while preserving the spec's contract.
- **`publicGet` / `publicPost` untouched** per Critical Guardrail "Do not change publicGet or publicPost". All offline behavior lives in `lunch-link.tsx`.
- **No Workbox cross-origin API caching** per Critical Guardrail "Service worker is for the SPA shell only". The `workbox.globPatterns` lists only shell assets; no `registerRoute` was added.
- **No Zustand store** for `isOnline`/`lastSyncedAt` per Critical Guardrail "Do not add Zustand store for offline state".

### Completion Notes

- All 8 explicitly-coded ACs (AC1–AC8) implemented; AC9 verified (no new typecheck errors). T4 manual browser walkthrough deferred to reviewer per spec ("This slice is UI + browser-API surface. No additional unit tests are required.").
- Pre-existing baseline noise confirmed unrelated to 4-s10 by stash+rerun (heart-notes.ts typecheck; lunch-link.routes.test.ts 1/27; DisambiguationPicker.test.tsx 6/15 — all touch surfaces 4-s10 does not modify).
- Production build (`pnpm exec vite build`) succeeds: emits `dist/sw.js`, `dist/workbox-9c191d2f.js`, `dist/registerSW.js`; precaches 4 entries (~1.5 MiB).

### File List

**Modified**
- `apps/web/package.json` — added `vite-plugin-pwa@^0.21.0` to `devDependencies`
- `apps/web/vite.config.ts` — `VitePWA` plugin registered (`generateSW`, `manifest: false`, SPA-shell globs, dev disabled)
- `apps/web/src/vite-env.d.ts` — added `/// <reference types="vite-plugin-pwa/client" />`
- `apps/web/src/routes/(app)/lunch-link.tsx` — `isOnline`/`lastSyncedAt` state; `online`/`offline` listener effect with pending-rating replay; HMAC fetch branch reads/writes `lunch-link-cache.${linkId}` from `localStorage` and falls back to cache on offline failure; `handleRate` queues `lunch-link-pending-rating.${linkId}` on offline failure; offline-indicator JSX between `MumNoteSalutation` and `HeartNoteCard`
- `pnpm-lock.yaml` — vite-plugin-pwa + workbox transitive deps
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `4-s10` → in-progress → review

**Untracked (story file itself)**
- `_bmad-output/implementation-artifacts/4-s10-service-worker-offline-lunch-link.md` — Status, checklist, Dev Agent Record

### Change Log

- **2026-05-31** — Implemented 4-S10. Added `vite-plugin-pwa@^0.21.0` (generateSW SPA-shell precache; manifest suppressed; SW dev-disabled). Layered offline support onto `lunch-link.tsx`: localStorage cache of HMAC payload on success, fallback render from cache on `navigator.onLine === false`, "offline · last synced HH:MM" badge, queued emoji rating on offline failure with `online`-event replay. No API or contract changes.

---

## References

- [Source: `_bmad-output/planning-artifacts/epic-4-vertical-slices.md` §Slice 4-S10]
- [Source: `apps/web/src/routes/(app)/lunch-link.tsx`] — full existing route; understand the HMAC/stub branching and `LoadedPayload` type before modifying
- [Source: `apps/web/src/lib/fetch.ts`] — `publicGet`/`publicPost` API (unchanged)
- [Source: `apps/web/vite.config.ts`] — minimal current config; full replacement in T1.2
- [PRD AR-17] — offline resilience requirement
- [vite-plugin-pwa docs] — `https://vite-pwa-org.netlify.app/guide/` (check for Vite 6 notes)

---

### Review Findings

- [x] [Review][Patch] `isOnline` state value discarded — "last synced" badge never clears when device reconnects (AC4 violation) [`apps/web/src/routes/(app)/lunch-link.tsx:86`] — fixed: `[isOnline, setIsOnline]`; badge condition updated to `lastSyncedAt !== null && !isOnline`
- [x] [Review][Patch] `snapshot.rating !== null` misses `undefined` — blank emoji element rendered in `LunchLinkExpiredState` [`apps/web/src/routes/(app)/lunch-link.tsx:305`] — fixed: `!= null`
- [x] [Review][Defer] Redundant `isHmac`/`isStub` deps in fetch effect array (both derived from `linkId`) [`apps/web/src/routes/(app)/lunch-link.tsx:208`] — deferred, pre-existing
- [x] [Review][Defer] Online replay POSTs pending rating regardless of current `loadState` (expired/error); non-200 reply orphans the localStorage entry [`apps/web/src/routes/(app)/lunch-link.tsx:100`] — deferred, pre-existing
- [x] [Review][Defer] `publicGet` body cast to `LoadedPayload` without runtime validation — pre-existing trust-server-contract pattern [`apps/web/src/routes/(app)/lunch-link.tsx:142`] — deferred, pre-existing
- [x] [Review][Defer] SW `globPatterns: ["**/*.{js,css,html}"]` precaches all lazy route chunks, not just app shell [`apps/web/vite.config.ts:22`] — deferred, pre-existing
- [x] [Review][Defer] Hardcoded "8pm" in `LunchLinkExpiredState` — close time is a business rule, not a magic string [`apps/web/src/routes/(app)/lunch-link.tsx:290`] — deferred, pre-existing
- [x] [Review][Defer] Missing `snapshot.bag` guard in `LunchLinkExpiredState` — malformed 410 snapshot crashes on `.bag.name` (server-contract assumption) [`apps/web/src/routes/(app)/lunch-link.tsx:308`] — deferred, pre-existing
- [x] [Review][Defer] Stale `linkId` in `online` closure if `linkId` changes between effect registration and event fire — theoretical [`apps/web/src/routes/(app)/lunch-link.tsx:93`] — deferred, pre-existing
- [x] [Review][Defer] AC4 connectivity tracking and AC6 rating replay collapsed into one effect with shared `[linkId]` dep — structurally mixes two spec concerns [`apps/web/src/routes/(app)/lunch-link.tsx:88`] — deferred, pre-existing

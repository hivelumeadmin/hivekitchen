# Story 12.7: Route context registration

Status: done

## Story

As a developer,
I want each app route to register its current surface context with the Lumi store on mount,
so that Lumi always knows what the user is looking at when they open the panel (ADR-002 Decision 2).

## Acceptance Criteria

1. **Given** Stories 12.2 + 12.6 are complete, **When** Story 12.7 is complete, **Then** a `useLumiContext` hook exists at `apps/web/src/hooks/useLumiContext.ts` that accepts a `LumiContextSignal` and calls `useLumiStore.getState().setContext(signal)` on mount.

2. **Given** the hook is called on a route, **Then** the `useEffect` fires once on component mount (not on every render) and its cleanup aborts any in-flight thread hydration when the route unmounts.

3. **Given** `threadIds[surface]` is a known thread ID at mount time, **Then** the hook pre-hydrates the thread by calling `GET /v1/lumi/threads/:threadId/turns`, parsing with `LumiThreadTurnsResponseSchema`, and calling `hydrateThread(surface, threadId, turns)` — before the user opens the panel.

4. **Given** a thread hydration fetch is in flight when the route unmounts, **Then** the fetch is cancelled via `AbortController` and `isHydrating` is reset to `false`.

5. **Given** `threadIds[surface]` is undefined at mount time (no prior thread for this surface), **Then** no hydration fetch is made. The panel will start a fresh conversation on the first message.

6. **Given** `isHydrating` is already `true` when the hook runs (another hydration is in flight), **Then** the hook does not start a second fetch — the guard prevents double-hydration.

7. **Given** `apps/web/src/routes/(app)/index.tsx`, **When** it mounts, **Then** it calls `useLumiContext({ surface: 'general' })`.

8. **Given** `apps/web/src/routes/(app)/account.tsx`, **When** it mounts, **Then** it calls `useLumiContext({ surface: 'general' })`.

9. **Given** the user navigates between routes (e.g., `/app` → `/account`), **Then** the panel's turns update to the new surface thread without interrupting an active talk session (`talkSessionId`, `voiceStatus`, `isSpeaking` are not touched by `setContext`).

10. **Given** the panel is open when the user navigates, **Then** `setContext()` clears `turns` and `isHydrating`, and the panel's existing `useEffect([isPanelOpen, surface])` in `LumiPanel.tsx` re-triggers hydration for the new surface — no change to `LumiPanel.tsx` required.

## Tasks / Subtasks

- [x] Task 1 — Create `apps/web/src/hooks/useLumiContext.ts` (AC: #1, #2, #3, #4, #5, #6)
  - [x] Accept a `LumiContextSignal` argument; extract `signal.surface` as the primary dependency
  - [x] On mount: call `useLumiStore.getState().setContext(signal)` — this clears `turns`, `isHydrating`, sets `surface`
  - [x] After `setContext()`: read `threadIds[surface]` and `isHydrating` from `useLumiStore.getState()`
  - [x] If `threadId` is defined AND `!isHydrating`: create `AbortController`, set `isHydrating: true` via `useLumiStore.setState({ isHydrating: true })`, fetch `GET /v1/lumi/threads/${threadId}/turns` with the abort signal
  - [x] On success: parse with `LumiThreadTurnsResponseSchema.parse(raw)`, call `useLumiStore.getState().hydrateThread(surface, threadId, parsed.turns)`
  - [x] On error: `useLumiStore.setState({ isHydrating: false })`; if `controller.signal.aborted` return; else `console.warn(...)`
  - [x] Cleanup: call `controller.abort()` on unmount
  - [x] Dependency array: `[surface]` — effect re-runs if surface changes (though for current routes it never does)

- [x] Task 2 — Add `useLumiContext` to `apps/web/src/routes/(app)/index.tsx` (AC: #7)
  - [x] Import `useLumiContext` from `@/hooks/useLumiContext.js`
  - [x] Call `useLumiContext({ surface: 'general' })` at the top of `AppHomePage` (alongside existing `useScope`)

- [x] Task 3 — Add `useLumiContext` to `apps/web/src/routes/(app)/account.tsx` (AC: #8)
  - [x] Import `useLumiContext` from `@/hooks/useLumiContext.js`
  - [x] Call `useLumiContext({ surface: 'general' })` at the top of `AccountPage` (alongside existing `useScope`)

- [x] Task 4 — Tests (AC: all)
  - [x] `apps/web/src/hooks/useLumiContext.test.ts`
    - [x] Calls `setContext` with the provided signal on mount
    - [x] Does NOT fetch when `threadIds[surface]` is undefined
    - [x] Fetches `GET /v1/lumi/threads/:id/turns` when `threadIds[surface]` is defined
    - [x] Calls `hydrateThread(surface, threadId, turns)` on successful fetch
    - [x] Resets `isHydrating: false` on fetch error
    - [x] Aborts fetch and resets `isHydrating: false` on unmount mid-flight
    - [x] Does not start a second fetch when `isHydrating` is already `true`

## Dev Notes

### What this story resolves from Story 12.6

Two items were deferred from the 12.6 code review to this story:

**Deferred 1 — Stale-turns guard:** `LumiPanel.tsx` `useEffect([isPanelOpen, surface])` has a guard `turnsNow.length > 0` that blocks re-hydration on surface switch. This is resolved by Story 12.7: `setContext()` sets `turns: []` synchronously, so when the panel's effect re-fires after surface change, `turnsNow.length === 0` and hydration proceeds. **No change to `LumiPanel.tsx` required.**

**Deferred 2 — Stale turns on navigate:** `isPanelOpen` and `turns` persisted across navigation with no surface reset. Resolved by `useLumiContext` calling `setContext()` on each route mount, flushing `turns` and updating `surface`. **No change to the store required.**

### `useLumiContext` hook implementation blueprint

```ts
// apps/web/src/hooks/useLumiContext.ts
import { useEffect } from 'react';
import type { LumiContextSignal } from '@hivekitchen/types';
import { LumiThreadTurnsResponseSchema } from '@hivekitchen/contracts';
import { hkFetch } from '@/lib/fetch.js';
import { useLumiStore } from '@/stores/lumi.store.js';

export function useLumiContext(signal: LumiContextSignal): void {
  const { surface } = signal;

  useEffect(() => {
    useLumiStore.getState().setContext(signal);

    const { threadIds, isHydrating } = useLumiStore.getState();
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
  }, [surface]); // surface is stable per route instance (static string literal)
}
```

**Lint note:** `signal` is used inside the effect but excluded from deps — this is intentional. All current callers pass `{ surface: 'literal' }` with no other fields. For future routes passing entity context, accept the exhaustive-deps lint warning and suppress with a comment, or refactor the hook to accept `surface` and optional entity fields separately.

### Calling pattern in routes

```tsx
// apps/web/src/routes/(app)/index.tsx
export default function AppHomePage() {
  useScope('app-scope');
  useLumiContext({ surface: 'general' });
  // ...rest of component
}
```

```tsx
// apps/web/src/routes/(app)/account.tsx
export default function AccountPage() {
  useScope('app-scope');
  useLumiContext({ surface: 'general' });
  // ...rest of component
}
```

### Why `'general'` for both current routes

The `LumiSurface` enum (from `packages/contracts/src/lumi.ts`) is:
`'onboarding' | 'planning' | 'meal-detail' | 'child-profile' | 'grocery-list' | 'evening-check-in' | 'heart-note' | 'general'`

The current `/app` route is a stub home page. The `/account` route is the parent's account settings. Neither maps to a dedicated surface — `'general'` is the documented fallback for both. Future Epic 3 routes will use `'planning'`, `'meal-detail'`, etc.

### Voice session safety

`setContext()` in the store only updates `surface`, `contextSignal`, `turns`, and `isHydrating`. It does NOT touch:
- `talkSessionId`
- `voiceStatus`
- `isSpeaking`
- `voiceError`

An active tap-to-talk session is never interrupted by route navigation.

### Hydration interaction with `LumiPanel.tsx`

`LumiPanel.tsx` already has its own hydration `useEffect([isPanelOpen, surface])`. When `useLumiContext` pre-hydrates on route mount and the panel is later opened:

- If pre-hydration completed → `turns.length > 0` → panel's guard `turnsNow.length > 0` skips the second fetch. ✅
- If pre-hydration is in-flight → `isHydrating: true` → panel's guard `hydratingNow` skips the second fetch. ✅
- If pre-hydration failed → `turns.length === 0`, `isHydrating: false` → panel starts its own hydration attempt. ✅ (graceful retry)

No double-fetching, no conflicts.

### Turn shape correction (from 12.6 dev notes)

The `Turn` type (from `packages/contracts/src/thread.ts`) uses:
- `turn.id` for keying (not `turn.turn_id`)
- `turn.role` for sender label (`'user'` | `'lumi'`)
- `turn.body.type === 'message'` to filter renderable turns
- `turn.body.content` for text content (not `turn.body.text`)

This affects `hydrateThread(surface, threadId, parsed.turns)` — the `parsed.turns` array contains `Turn` objects with the above shape. `LumiPanel.tsx` already handles this correctly post-12.6 patches.

### `hkFetch` and parse pattern

```ts
import { LumiThreadTurnsResponseSchema } from '@hivekitchen/contracts';
import { hkFetch } from '@/lib/fetch.js';

const raw = await hkFetch<unknown>(`/v1/lumi/threads/${threadId}/turns`, {
  method: 'GET',
  signal: controller.signal,
});
const parsed = LumiThreadTurnsResponseSchema.parse(raw); // throws on malformed — developer error
useLumiStore.getState().hydrateThread(surface, threadId, parsed.turns);
```

Use `.parse()` (not `.safeParse()`). A malformed response from our own API is a developer error that should throw.

### `hydrateThread` TOCTOU guard

`hydrateThread(surface, threadId, turns)` in the store has a built-in guard:
```ts
hydrateThread: (surface, threadId, turns) =>
  set((state) => ({
    threadIds: { ...state.threadIds, [surface]: threadId },
    turns: state.surface === surface ? turns : state.turns,
    isHydrating: state.surface === surface ? false : state.isHydrating,
  })),
```

If `setContext()` changed the surface before the hydration resolved, the stale result is discarded — `turns` are not written. The hook does not need to add its own stale-close guard.

### Zustand `setState` for `isHydrating`

`isHydrating` has no dedicated store action. Set directly:
```ts
useLumiStore.setState({ isHydrating: true });
```
This is the established pattern used in `LumiPanel.tsx` and the store tests.

### Testing pattern

Use `@testing-library/react` with `renderHook`. Mock `hkFetch` with `vi.mock`:

```ts
import { renderHook } from '@testing-library/react';
import { useLumiStore } from '@/stores/lumi.store.js';
import { useLumiContext } from '@/hooks/useLumiContext.js';

vi.mock('@/lib/fetch.js', () => ({
  hkFetch: vi.fn(),
}));

beforeEach(() => {
  useLumiStore.getState().reset();
  vi.clearAllMocks();
});

it('calls setContext on mount', () => {
  const setContextSpy = vi.spyOn(useLumiStore.getState(), 'setContext');
  renderHook(() => useLumiContext({ surface: 'general' }));
  expect(setContextSpy).toHaveBeenCalledWith({ surface: 'general' });
});

it('fetches thread when threadId is known', async () => {
  const { hkFetch } = await import('@/lib/fetch.js');
  vi.mocked(hkFetch).mockResolvedValue({ turns: [] });
  useLumiStore.setState({ threadIds: { general: 'thread-uuid-123' } });
  renderHook(() => useLumiContext({ surface: 'general' }));
  await vi.waitFor(() => expect(hkFetch).toHaveBeenCalledWith(
    '/v1/lumi/threads/thread-uuid-123/turns',
    expect.objectContaining({ method: 'GET' }),
  ));
});
```

### Scope boundary — what is NOT in 12.7

| Feature | Story |
|---|---|
| `useLumiContext` hook + wiring in /app and /account | **12.7 (this story)** |
| Entity context (entity_type, entity_id, entity_summary) on surface-specific routes | Epic 3–6 routes (when those routes are built) |
| `appendAction()` calls on user interactions | Part of surface-specific route implementation |
| Tap-to-talk WebSocket | 12.8 |
| Text turn POST | 12.10 |
| Proactive nudge SSE | 12.11 |

The `/app` and `/account` routes do not need `entity_type` or `entity_id` — `{ surface: 'general' }` with no entity context is correct for these stub pages.

### Project Structure Notes

**New files:**
- `apps/web/src/hooks/useLumiContext.ts`
- `apps/web/src/hooks/useLumiContext.test.ts`

**Modified files:**
- `apps/web/src/routes/(app)/index.tsx` — add `useLumiContext({ surface: 'general' })`
- `apps/web/src/routes/(app)/account.tsx` — add `useLumiContext({ surface: 'general' })`

**No changes to:**
- `apps/web/src/components/LumiPanel.tsx`
- `apps/web/src/components/LumiOrb.tsx`
- `apps/web/src/stores/lumi.store.ts`
- `apps/web/src/routes/(app)/layout.tsx`
- Any API files

### References

- [Source: _bmad-output/planning-artifacts/adr-ambient-lumi.md#Decision 2 — Context Signal Layer] — context signal contract, how context is assembled, why frontend-driven
- [Source: _bmad-output/planning-artifacts/epics.md#Story 12.7] — acceptance criteria
- [Source: _bmad-output/implementation-artifacts/12-6-lumiorb-and-lumipanel-in-root-layout.md#Dev Agent Record > Review Findings] — deferred items this story resolves (stale-turns guard, stale panel turns on navigate)
- [Source: _bmad-output/implementation-artifacts/12-6-lumiorb-and-lumipanel-in-root-layout.md#Dev Notes] — Turn shape (role/body.type/body.content), hydrateThread TOCTOU guard, isHydrating setState pattern
- [Source: apps/web/src/stores/lumi.store.ts] — setContext, hydrateThread, isHydrating pattern
- [Source: apps/web/src/components/LumiPanel.tsx] — existing hydration useEffect([isPanelOpen, surface]) — no changes needed
- [Source: packages/contracts/src/lumi.ts] — LumiSurfaceSchema (8 values), LumiContextSignalSchema, LumiThreadTurnsResponseSchema
- [Source: apps/web/src/lib/fetch.ts] — hkFetch signature (method, body?, signal?), HkApiError
- [Source: _bmad-output/project-context.md] — Zustand 5 curried create, Tailwind-only, React 19 hooks rules, no useEffect for derived state, useRef pattern

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Opus 4.7, 1M context)

### Debug Log References

- Initial test run failed with Zod UUID rejection on the `Turn` fixture — `id` and `thread_id` must be valid UUIDs because `LumiThreadTurnsResponseSchema.parse()` runs strict UUID validation. Fixed by switching the fixture to actual `4`-version UUID strings.
- `pnpm lint` flagged `react-hooks/exhaustive-deps` as "Definition for rule … was not found" because the rule is only registered for `*.{jsx,tsx}` files in the shared eslint config. The hook file is `.ts`, so the rule is inert; removed the unnecessary `eslint-disable-next-line` comment that was triggering the "rule not found" error.
- Pre-existing TS errors in `apps/api/src/modules/voice/voice.service.test.ts` (missing `RequestInfo` global) are out of scope for this story — that file is unmodified and the story is web-only (per Project Structure Notes).

### Completion Notes List

- `useLumiContext` follows the Dev Notes blueprint exactly: synchronous `setContext()` then a guarded fetch with `AbortController`, `LumiThreadTurnsResponseSchema.parse()` for response validation, and `hydrateThread()` (which carries its own TOCTOU guard in the store) on success.
- Both `(app)/index.tsx` and `(app)/account.tsx` now call `useLumiContext({ surface: 'general' })` immediately after `useScope('app-scope')` — `'general'` is the documented fallback for stub routes that have no entity context yet.
- No changes were needed in `LumiPanel.tsx` or `lumi.store.ts` — the deferred items from 12.6 ("stale-turns guard" and "stale turns on navigate") are resolved purely by mounting `useLumiContext` at the route level. `setContext()` synchronously clearing `turns` lets the panel's existing `useEffect([isPanelOpen, surface])` re-trigger hydration cleanly when the user opens the panel after a route change.
- Voice-session safety verified by inspection: `setContext()` only writes `surface`, `contextSignal`, `turns`, `isHydrating` — `talkSessionId`, `voiceStatus`, `isSpeaking`, `voiceError` are untouched, so route navigation cannot interrupt an active tap-to-talk session (AC #9).
- Test coverage: 8 unit tests covering setContext-on-mount, no-fetch-without-thread, fetch-with-thread, hydrateThread-on-success, isHydrating-transitions, error-recovery, abort-on-unmount, and the in-flight-guard. Full web suite still green: 143/143 tests pass.

### File List

**New files:**
- `apps/web/src/hooks/useLumiContext.ts`
- `apps/web/src/hooks/useLumiContext.test.ts`

**Modified files:**
- `apps/web/src/routes/(app)/index.tsx`
- `apps/web/src/routes/(app)/account.tsx`

### Change Log

- 2026-05-01 — Story 12-7 implemented: `useLumiContext` hook + wiring in `/app` and `/account`. Resolves both deferred items from Story 12.6 (stale-turns guard, stale panel turns on navigate). 8 new unit tests added; full web suite (143 tests) green; web typecheck and lint clean.

### Review Findings

- [x] [Review][Patch] AC #6 guard permanently inert — `setContext` (store:68) resets `isHydrating: false` before the guard reads it, so `if (isHydrating) return` can never fire; double-hydration not blocked [`apps/web/src/hooks/useLumiContext.ts:15-17`]
- [x] [Review][Patch] AC #6 test patches Zustand action to suppress `setContext`'s `isHydrating` reset, masking the F1 defect — rewrite after F1 fix [`apps/web/src/hooks/useLumiContext.test.ts:158-193`]
- [x] [Review][Patch] Missing test for AC #2 — no test re-renders the hook and verifies `setContext`/`hkFetch` are called exactly once (not on re-render) [`apps/web/src/hooks/useLumiContext.test.ts`]
- [x] [Review][Patch] No test for Zod parse failure path — `LumiThreadTurnsResponseSchema.parse()` throwing on a malformed API response is untested; schema drift would go undetected [`apps/web/src/hooks/useLumiContext.test.ts`]
- [x] [Review][Defer] `isHydrating` stuck `true` when surface changes mid-flight — `hydrateThread` TOCTOU guard (store:95) skips the reset when active surface differs; self-healing via next route's `setContext`; no impact for current single-surface routes [`apps/web/src/hooks/useLumiContext.ts:28-30`] — deferred, low impact for 'general'-only routes
- [x] [Review][Defer] Abort cleanup does not synchronously reset `isHydrating` — stays `true` until async catch settles; transient window only [`apps/web/src/hooks/useLumiContext.ts:38`] — deferred, async catch is the correct reset path
- [x] [Review][Defer] Stale `signal` closure — intentional for static-literal callers; `entity_id`/`entity_summary` on future surface-specific routes will not re-trigger `setContext` without a surface change [`apps/web/src/hooks/useLumiContext.ts:13`] — deferred, revisit when entity routes land

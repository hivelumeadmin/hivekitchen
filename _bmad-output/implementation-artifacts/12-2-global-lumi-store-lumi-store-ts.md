# Story 12.2: Global Lumi store (lumi.store.ts)

Status: done

## Story

As a developer,
I want a single Zustand store managing all Lumi state across the app,
So that every surface reads from one source of truth instead of scattered component-local state (ADR-002 Decision 5).

## Architecture Overview

### Store Shape

`apps/web/src/stores/lumi.store.ts` replaces `voice.store.ts` as the single Lumi state container. It manages:

- **Context**: current surface + full context signal (set by each route on mount)
- **Threads**: a map of `threadId` per surface (lazy — populated on first interaction or panel open)
- **Turns**: the currently displayed turns in the panel (for the active surface)
- **Talk session**: ElevenLabs session state (short-lived, tap-to-talk lifecycle)
- **UI**: panel open/closed, panel mode (text vs voice)
- **Proactive**: pending nudge waiting for the user to open the panel

```typescript
// apps/web/src/stores/lumi.store.ts

import { create } from 'zustand';
import type { LumiSurface, LumiContextSignal, Turn } from '@hivekitchen/types';

interface LumiState {
  // Context
  surface: LumiSurface;
  contextSignal: LumiContextSignal | null;

  // Thread per surface — lazy, populated on first interaction or on panel open
  threadIds: Partial<Record<LumiSurface, string>>;
  turns: Turn[];
  isHydrating: boolean;

  // Talk session (ElevenLabs — short-lived, per tap-to-talk)
  talkSessionId: string | null;
  voiceStatus: 'idle' | 'connecting' | 'active' | 'ended' | 'error';
  isSpeaking: boolean;
  voiceError: string | null;

  // UI
  isPanelOpen: boolean;
  panelMode: 'text' | 'voice';

  // Proactive
  pendingNudge: Turn | null;
}

interface LumiActions {
  setContext: (signal: LumiContextSignal) => void;
  appendAction: (description: string) => void;
  openPanel: (mode?: 'text' | 'voice') => void;
  closePanel: () => void;
  hydrateThread: (threadId: string, turns: Turn[]) => void;
  appendTurn: (turn: Turn) => void;
  setTalkSession: (sessionId: string) => void;
  setVoiceStatus: (status: LumiState['voiceStatus']) => void;
  setVoiceError: (msg: string | null) => void;
  endTalkSession: () => void;
  setNudge: (turn: Turn | null) => void;
  reset: () => void;
}
```

### Surface Switching Behaviour

When `setContext(signal)` is called (by a route on mount):
1. `surface` and `contextSignal` are updated.
2. `turns` is cleared — the panel will show turns for the new surface.
3. If `threadIds[signal.surface]` is known, the caller is responsible for triggering hydration (Story 12.7 wires this). The store itself does not fetch.
4. `panelMode`, `isPanelOpen`, `pendingNudge` are preserved across surface switches — panel stays open if it was open.
5. An active talk session is NOT interrupted. It continues against the thread it was started on.

### `appendAction` Behaviour

Appends a description to `contextSignal.recent_actions`, capping the array at 5 items (FIFO eviction). No-op if `contextSignal` is null.

### `hydrateThread`

Called after `GET /v1/lumi/threads/:threadId/turns` resolves. Sets `threadIds[surface]` and replaces `turns` with the fetched turns. Sets `isHydrating: false`.

### `appendTurn`

Appends a single turn to the `turns` array. Used during active voice or text sessions for live UI updates — the server is persisting in parallel, this is the fast path for display. Does NOT update `threadIds`.

### `endTalkSession`

Resets `talkSessionId: null`, `voiceStatus: 'idle'`, `isSpeaking: false`, `voiceError: null`. Does NOT change `isPanelOpen`.

### voice.store.ts Deletion

`apps/web/src/stores/voice.store.ts` is deleted. Two files currently import from it:

1. `apps/web/src/features/onboarding/OnboardingVoice.tsx` — imports `setStatus`, `setError`, `setIsSpeaking`, `clearError` from `useVoiceStore`
2. `apps/web/src/routes/(app)/onboarding.tsx` — imports `voiceStatus`, `voiceError`, `clearError` from `useVoiceStore`

Per ADR-002 Decision 5: **the onboarding components continue using component-local state.** They are self-contained onboarding flows that do not need the global Lumi store. Migrate both files to local `useState` replacing the store usage. `lumi.store.ts` backs the ambient panel only.

### OnboardingVoice.tsx Migration

Current usage in `OnboardingVoice.tsx`:
- `setStatus('connecting' | 'active' | 'ended' | 'error')` → replace with local `useState<'idle' | 'connecting' | 'active' | 'ended' | 'error'>('idle')`
- `setError(msg)` → local `setVoiceError`
- `setIsSpeaking(v)` → local `setIsSpeaking`
- `clearError()` → local `setVoiceError(null)` + `setStatus('idle')`

### onboarding.tsx Migration

Current usage in `onboarding.tsx`:
- `voiceStatus` → read from props/context passed down from OnboardingVoice, or duplicate local state
- `voiceError` → same
- `clearError()` → same

Examine the actual data flow between `onboarding.tsx` and `OnboardingVoice.tsx` and choose the minimal refactor — either lift the state into `onboarding.tsx` and pass as props, or have each component own its state independently.

## Acceptance Criteria

1. **Given** Story 12.1 is complete, **When** Story 12.2 is complete, **Then** `apps/web/src/stores/lumi.store.ts` exists and exports `useLumiStore` with all state fields and action functions specified in ADR-002 Decision 5.

2. **Given** `lumi.store.ts` is created, **Then** the store uses Zustand 5 curried `create<LumiState & LumiActions>()(set => ...)` signature matching the convention in `voice.store.ts`.

3. **Given** `voice.store.ts` is deleted, **When** `pnpm typecheck` runs, **Then** zero errors — all former `useVoiceStore` imports in `OnboardingVoice.tsx` and `onboarding.tsx` have been migrated to component-local state.

4. **Given** `setContext({ surface, ... })` is called with a new surface, **Then** `surface` and `contextSignal` update; `turns` is cleared; active talk session state (`talkSessionId`, `voiceStatus`) is preserved.

5. **Given** `appendAction(description)` is called when `contextSignal` is non-null, **Then** description is appended to `contextSignal.recent_actions`; if the array exceeds 5 items, the oldest item is evicted.

6. **Given** `hydrateThread(threadId, turns)` is called, **Then** `threadIds[surface]` is set to the provided `threadId`; `turns` is replaced with the provided turns; `isHydrating` becomes `false`.

7. **Given** `pnpm --filter @hivekitchen/web test` runs, **Then** all existing onboarding tests still pass (migration did not break onboarding voice/text flows).

## Tasks / Subtasks

- [x] Task 1 — Create `apps/web/src/stores/lumi.store.ts` (AC: #1, #2)
  - [x] Define `LumiState` and `LumiActions` interfaces
  - [x] Import `LumiSurface`, `LumiContextSignal`, `Turn` from `@hivekitchen/types`
  - [x] Implement `setContext`: update surface + contextSignal, clear turns
  - [x] Implement `appendAction`: append to `contextSignal.recent_actions`, cap at 5, no-op if contextSignal null
  - [x] Implement `openPanel` / `closePanel`
  - [x] Implement `hydrateThread`: update threadIds[surface], replace turns, set isHydrating false
  - [x] Implement `appendTurn`: append turn to turns array
  - [x] Implement `setTalkSession`: set talkSessionId, voiceStatus='connecting' → caller transitions to 'active'
  - [x] Implement `setVoiceStatus` / `setVoiceError`
  - [x] Implement `endTalkSession`: reset talkSessionId, voiceStatus='idle', isSpeaking=false, voiceError=null
  - [x] Implement `setNudge`
  - [x] Implement `reset`: reset all state to initial values
  - [x] Use Zustand 5 `create<LumiState & LumiActions>()(set => ...)` curried signature

- [x] Task 2 — Migrate `OnboardingVoice.tsx` away from `useVoiceStore` (AC: #3)
  - [x] Read `apps/web/src/features/onboarding/OnboardingVoice.tsx` to understand current store usage
  - [x] Replace `useVoiceStore` import with local `useState` for voice status, isSpeaking, error
  - [x] Verify component still compiles and tests pass

- [x] Task 3 — Migrate `onboarding.tsx` away from `useVoiceStore` (AC: #3)
  - [x] Read `apps/web/src/routes/(app)/onboarding.tsx` to understand current store usage
  - [x] Replace `useVoiceStore` import with appropriate local state or props from OnboardingVoice
  - [x] Verify component still compiles and tests pass

- [x] Task 4 — Delete `voice.store.ts` (AC: #3)
  - [x] Confirm no remaining imports of `useVoiceStore` anywhere in `apps/web`
  - [x] Delete `apps/web/src/stores/voice.store.ts`

- [x] Task 5 — Typecheck and test (AC: #3, #7)
  - [x] `pnpm --filter @hivekitchen/web typecheck` — zero errors (monorepo-wide `pnpm typecheck` surfaced 3 pre-existing `RequestInfo` errors in `apps/api/src/modules/voice/voice.service.test.ts` confirmed present on `main` before this story; out of scope)
  - [x] `pnpm --filter @hivekitchen/web test` — 106 passing across 14 files (was 97 / 13 files; +9 new lumi store unit tests covering AC #4 #5 #6 + edge cases)

## Dev Notes

### Zustand 5 create signature
This codebase uses Zustand 5. The correct pattern is the curried form:
```typescript
export const useLumiStore = create<LumiState & LumiActions>()((set) => ({
  ...INITIAL_STATE,
  // actions
}));
```
Do NOT use the non-curried `create<T>(set => ...)` form (Zustand 4 pattern). [Source: apps/web/src/stores/voice.store.ts — existing reference]

### Initial surface value
Use `'general'` as the initial `surface` value — this is the home/fallback surface from the `LumiSurfaceSchema` enum.

### appendAction immutability
`contextSignal` is a plain object in the store. To update `recent_actions`, create a new `contextSignal` object (spread) with a new `recent_actions` array. Do not mutate the existing signal.

```typescript
appendAction: (description) =>
  set((state) => {
    if (!state.contextSignal) return {};
    const prev = state.contextSignal.recent_actions ?? [];
    const next = [...prev, description].slice(-5);
    return { contextSignal: { ...state.contextSignal, recent_actions: next } };
  }),
```

### hydrateThread surface scoping
`hydrateThread` must record the thread ID under the current `surface`:
```typescript
hydrateThread: (threadId, turns) =>
  set((state) => ({
    threadIds: { ...state.threadIds, [state.surface]: threadId },
    turns,
    isHydrating: false,
  })),
```

### OnboardingVoice.tsx: minimal migration
The goal is to REMOVE the store dependency, not to redesign the component. Keep the same state shape, just move it to `useState`. The onboarding flow is a dedicated screen and does not need the global store.

### onboarding.tsx: examine data flow before deciding
Read both files before deciding how to handle the `voiceStatus`/`voiceError` in `onboarding.tsx`. If these are passed up via a callback or context, mirror that. If they were only needed to display an error banner, local state in `onboarding.tsx` reading from a callback is fine.

### No new lumi store tests required in this story
The store logic is straightforward and tested indirectly through the component tests. Unit tests for the store itself are optional. Focus test effort on verifying onboarding components still work after the migration.

### Project Structure Notes

- New file: `apps/web/src/stores/lumi.store.ts`
- Deleted: `apps/web/src/stores/voice.store.ts`
- Modified: `apps/web/src/features/onboarding/OnboardingVoice.tsx` — remove useVoiceStore
- Modified: `apps/web/src/routes/(app)/onboarding.tsx` — remove useVoiceStore

### References

- [Source: _bmad-output/planning-artifacts/adr-ambient-lumi.md#Decision 5 — Global Lumi Store]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 12.2]
- [Source: apps/web/src/stores/voice.store.ts — Zustand 5 pattern to mirror]
- [Source: apps/web/src/features/onboarding/OnboardingVoice.tsx — useVoiceStore consumer]
- [Source: apps/web/src/routes/(app)/onboarding.tsx — useVoiceStore consumer]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context) via `/bmad-dev-story` workflow on 2026-04-30.

### Debug Log References

- `pnpm --filter @hivekitchen/web typecheck` → clean.
- `pnpm --filter @hivekitchen/web test` → 14 files / 106 tests passing.
- `pnpm typecheck` (monorepo) → 3 pre-existing `RequestInfo` errors in `apps/api/src/modules/voice/voice.service.test.ts`. Verified on stash of `main` before changes were applied — unrelated to Story 12.2 scope (web-only).

### Completion Notes List

- Implemented `apps/web/src/stores/lumi.store.ts` per ADR-002 Decision 5 with the exact `LumiState` / `LumiActions` shape from the story spec. Initial `surface = 'general'`, panel closed, panel mode `'text'`, voice status `'idle'`. `INITIAL_STATE` is a single source of truth reused by `reset`.
- `setContext` clears `turns` (so the panel re-renders against the new surface) but preserves `talkSessionId` / `voiceStatus` / `isPanelOpen` / `panelMode` / `pendingNudge` — talk sessions started on a previous surface continue running uninterrupted.
- `appendAction` is null-safe (no-op if `contextSignal` is null) and immutable (spreads `contextSignal` and `recent_actions` rather than mutating). FIFO eviction implemented via `[...prev, description].slice(-5)`.
- `setVoiceError` mirrors the prior `voice.store.setError` semantics: passing a message flips status to `'error'`; passing `null` resets status to `'idle'`. `setVoiceStatus` does NOT clobber `voiceError` (carried-over invariant from the deleted store).
- `setTalkSession` clears any prior `voiceError` so a stale error from a previous failed attempt doesn't bleed into a fresh session.
- Migrated `OnboardingVoice.tsx`: removed all four `useVoiceStore` selectors and the status-mirroring `useEffect`. The component already gets `status` / `errorMessage` directly from `useVoiceSession`; cross-tree visibility into the error state is now expressed via a new optional `onError?: (message: string) => void` prop. This is a strictly local refactor — the onboarding flow is self-contained and does not need the global Lumi store (per ADR-002 Decision 5).
- Migrated `onboarding.tsx`: replaced the three `useVoiceStore` selectors with a single `useState<string | null>` for `voiceError`, fed by the new `onError` prop on `<OnboardingVoice>`. The fallback "Continue with text instead" branch now triggers on `voiceError !== null` (was `voiceStatus === 'error' && voiceError`); these conditions were synchronized in the prior store, so the new check is equivalent. `clearError()` becomes `setVoiceError(null)`.
- Deleted `apps/web/src/stores/voice.store.ts`. Grep confirmed zero remaining `useVoiceStore` / `voice.store` references after migration.
- Updated `apps/web/src/features/onboarding/OnboardingVoice.test.tsx`: removed the `vi.mock('@/stores/voice.store.js', ...)` block (would now fail at module resolution), updated `setHookState` to capture the hook's `onError` callback so two new tests can exercise the prop wiring (forward to `onError`, no throw when omitted). Existing 11 tests preserved, total 13.
- Added `apps/web/src/stores/lumi.store.test.ts`: 9 unit tests covering AC #4 (setContext clears turns + preserves talk session), AC #5 (appendAction FIFO + null-safe), AC #6 (hydrateThread surface scoping + isHydrating flip), plus regressions for defaults, appendTurn, endTalkSession panel preservation, setVoiceError status flip, and openPanel mode preservation. Story dev notes flagged store tests as optional — added because project-context.md explicitly endorses direct state-transition tests for Zustand stores ("Web stores: Zustand stores are plain functions; test state transitions directly, no React needed").

### File List

- Added: `apps/web/src/stores/lumi.store.ts`
- Added: `apps/web/src/stores/lumi.store.test.ts`
- Modified: `apps/web/src/features/onboarding/OnboardingVoice.tsx`
- Modified: `apps/web/src/features/onboarding/OnboardingVoice.test.tsx`
- Modified: `apps/web/src/routes/(app)/onboarding.tsx`
- Deleted: `apps/web/src/stores/voice.store.ts`

## Change Log

| Date       | Description                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-04-30 | Story 12.2 implemented: added `lumi.store.ts` with full ADR-002 Decision 5 surface; migrated onboarding to component-local state; deleted `voice.store.ts`. 106 tests passing (was 97). Ready for review.                |

### Review Findings

- [x] [Review][Decision] `hydrateThread` TOCTOU — resolved: added `surface: LumiSurface` parameter; implementation uses caller-supplied surface as key and guards turns/isHydrating updates with `state.surface === surface` check. TOCTOU regression test added. [`apps/web/src/stores/lumi.store.ts:87-95`, `apps/web/src/stores/lumi.store.test.ts`]

- [x] [Review][Patch] `setContext` does not reset `isHydrating: false` — fixed: added `isHydrating: false` to `setContext`'s state update; AC #4 test updated to assert the reset. [`apps/web/src/stores/lumi.store.ts:63-69`]

- [x] [Review][Defer] `isSpeaking` has no setter action — the field exists in state and resets in `endTalkSession`, but no `setIsSpeaking` action is present; the field can never be set to `true`. Story 12.8 (tap-to-talk) is the expected owner. [`apps/web/src/stores/lumi.store.ts`] — deferred, forward dependency on Story 12.8

- [x] [Review][Defer] Async callbacks from `useVoiceSession` may fire after `OnboardingVoice` unmounts — `callbacksRef` persists across renders; a queued `onError` could invoke `setVoiceError` on the parent after the user has navigated away from onboarding. [`apps/web/src/hooks/useVoiceSession.ts`] — deferred, hook internals concern; acceptable under current sequential WebSocket lifecycle

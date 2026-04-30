# Story 12.2: Global Lumi store (lumi.store.ts)

Status: ready-for-dev

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

- [ ] Task 1 — Create `apps/web/src/stores/lumi.store.ts` (AC: #1, #2)
  - [ ] Define `LumiState` and `LumiActions` interfaces
  - [ ] Import `LumiSurface`, `LumiContextSignal`, `Turn` from `@hivekitchen/types`
  - [ ] Implement `setContext`: update surface + contextSignal, clear turns
  - [ ] Implement `appendAction`: append to `contextSignal.recent_actions`, cap at 5, no-op if contextSignal null
  - [ ] Implement `openPanel` / `closePanel`
  - [ ] Implement `hydrateThread`: update threadIds[surface], replace turns, set isHydrating false
  - [ ] Implement `appendTurn`: append turn to turns array
  - [ ] Implement `setTalkSession`: set talkSessionId, voiceStatus='connecting' → caller transitions to 'active'
  - [ ] Implement `setVoiceStatus` / `setVoiceError`
  - [ ] Implement `endTalkSession`: reset talkSessionId, voiceStatus='idle', isSpeaking=false, voiceError=null
  - [ ] Implement `setNudge`
  - [ ] Implement `reset`: reset all state to initial values
  - [ ] Use Zustand 5 `create<LumiState & LumiActions>()(set => ...)` curried signature

- [ ] Task 2 — Migrate `OnboardingVoice.tsx` away from `useVoiceStore` (AC: #3)
  - [ ] Read `apps/web/src/features/onboarding/OnboardingVoice.tsx` to understand current store usage
  - [ ] Replace `useVoiceStore` import with local `useState` for voice status, isSpeaking, error
  - [ ] Verify component still compiles and tests pass

- [ ] Task 3 — Migrate `onboarding.tsx` away from `useVoiceStore` (AC: #3)
  - [ ] Read `apps/web/src/routes/(app)/onboarding.tsx` to understand current store usage
  - [ ] Replace `useVoiceStore` import with appropriate local state or props from OnboardingVoice
  - [ ] Verify component still compiles and tests pass

- [ ] Task 4 — Delete `voice.store.ts` (AC: #3)
  - [ ] Confirm no remaining imports of `useVoiceStore` anywhere in `apps/web`
  - [ ] Delete `apps/web/src/stores/voice.store.ts`

- [ ] Task 5 — Typecheck and test (AC: #3, #7)
  - [ ] `pnpm typecheck` — zero errors
  - [ ] `pnpm --filter @hivekitchen/web test` — all passing

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

_to be filled on implementation_

### Debug Log References

### Completion Notes List

### File List

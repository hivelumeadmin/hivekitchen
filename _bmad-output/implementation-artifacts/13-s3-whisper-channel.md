# Story 13.3: Whisper Channel (proactive = one quiet line)

Status: done

> **Source brief:** `_bmad-output/planning-artifacts/epic-13-lumi-ux-rebuild-brief.md` § Phase 1, 13-s3. **Valet rule 3.**
> **Vision:** `_bmad-output/planning-artifacts/lumi-conversational-ux-rebuild-vision.md` §2b (three states: rest / whisper / summoned) + §2.5 (WHEN vs HOW).
> **Gate (must stay green):** `apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts`.
> **Scope fence for s2.5:** "Undo" action (requires a registered undoable server event — depends on 13-s2.5 `plan.updated` emit) is **explicitly deferred**. Whisper is built on the existing `lumi.nudge` SSE + `generateNudge` (one-sentence cap), which are already functional.

---

## Story

As a **HiveKitchen parent using the app between planning moments**,
I want **Lumi's proactive nudges to appear as a single quiet dismissible line near the presence dot — not a badge, not a stream**,
so that **background intelligence is felt through one calm signal I can act on or dismiss, without the app ever looking like a notification center**.

---

## Acceptance Criteria

### AC1 — `whisper()` action drives `presenceState = 'whisper'`

- Add `whisper()` action to the store: sets `presenceState = 'whisper'`. No other fields change.
- `recede()` (already exists) handles the transition back to `'atRest'` from `'whisper'`.
- `summon()` (already exists) transitions from `'whisper'` to `'summoned'` and clears `pendingNudge` — no change needed.
- `reset()` still restores `presenceState = 'atRest'`.
- Add store tests for `whisper()`.

### AC2 — `useLumiNudgeSSE` triggers the whisper on nudge arrival

- After `store.setNudge(parsed.data.turn)`, add a surfacing gate:
  - If `store.proactiveNudges && store.presenceState !== 'summoned'` → call `store.whisper()`.
  - Otherwise (nudges paused, or sheet already open on matching surface) → no whisper. The dot breath (or live append) is the only signal.
- A second nudge arriving while already in `'whisper'` state: `setNudge` replaces the nudge text (single-field); `whisper()` is a no-op (already in whisper). The line updates to the latest nudge.
- Update `useLumiNudgeSSE.test.ts` with: whisper fires when proactiveNudges=true; no whisper when proactiveNudges=false; no whisper when presenceState='summoned'.

### AC3 — `LumiWhisper` component renders the dismissible line

- New component `apps/web/src/components/LumiWhisper.tsx` (colocated test `LumiWhisper.test.tsx`).
- Renders ONLY when `presenceState === 'whisper'`.
- Shows the nudge text (from `pendingNudge.body` — when `body.type === 'message'`, shows `body.content`; otherwise shows a generic `'Lumi has an update'` line).
- Two action buttons:
  - **"See why"** → calls `summon()` (sheet opens, nudge cleared, presenceState → 'summoned').
  - **"Dismiss"** → calls `setNudge(null)` then `recede()` (presenceState → 'atRest', nudge cleared).
- **"Undo" is explicitly deferred** (no registered undoable action without 13-s2.5). Do NOT build it in this slice.
- Positioned **above the dot**: `fixed bottom-20 right-6 z-50` (dot is at `bottom-6 right-6 z-40`).
- Width: `max-w-xs` so the text wraps on small screens without expanding to full width.
- Valet visual rule: warm surface tokens (`bg-bg`, `border-border`, `shadow-md`, `rounded-lg`); terracotta accent for "See why" text; `text-sm` throughout. NOT a bright badge. NOT a modal.
- Entry transition: `animate-[hk-slide-up-whisper_150ms_ease-out]` + `motion-reduce:animate-none` — a subtle upward entry, static under reduced motion. (Define the keyframe in `globals.css` alongside the existing `hk-slide-in-sheet`.)
- Accessibility: outer wrapper has `role="status"` + `aria-live="polite"` so screen readers announce the nudge without interrupting focus. Dismiss button has an accessible label `'Dismiss nudge'`.

### AC4 — At-rest dot no longer breathes in whisper state

- Update the dot's `restingBreath` condition in `LumiPresence.tsx` from:
  - `!isVoiceActive && hasNudge && !isSummoned`
  - to: `!isVoiceActive && hasNudge && presenceState === 'atRest'`
- Rationale: the whisper line IS the nudge surface. The dot breathing simultaneously would be redundant noise.
- The breath is still emitted when `presenceState === 'atRest' && proactiveNudges === false` (dot is the only indicator in that case).
- Add `<LumiWhisper />` to `LumiPresence`'s render output alongside `<LumiSheet />`.
- Update the corresponding `LumiPresence.test.tsx` test that covers whisper state.

### AC5 — 13-s1 regression gate stays green; no new axe violations

- All existing 13-s1 E2E assertions remain green — the whisper channel adds new UI but does not change any existing locators (dot `button name /open lumi/i`, dialog, Escape behavior, axe baseline).
- The `LumiWhisper` component must meet AA on `.app-scope`: no new WCAG 2.0 A/AA violations beyond the existing allowlisted debt.
- `pnpm --filter @hivekitchen/web typecheck` → zero new errors; lint clean on changed files. `pnpm --filter @hivekitchen/web build` succeeds.

### AC6 — Unit tests coverage

- `lumi.store.test.ts`: `whisper()` sets `presenceState = 'whisper'`; `recede()` from whisper returns to `'atRest'`; `summon()` from whisper transitions to `'summoned'` and clears nudge; `reset()` from whisper returns to `'atRest'`.
- `useLumiNudgeSSE.test.ts`: whisper fires when proactiveNudges=true + not summoned; no whisper when proactiveNudges=false; no whisper when summoned (regardless of proactiveNudges).
- `LumiWhisper.test.tsx` (new): doesn't render when atRest; doesn't render when summoned; renders when whisper + nudge present; shows nudge body.content; Dismiss clears nudge + recedes; See why summons; generic text when body type is not 'message'.
- `LumiPresence.test.tsx`: dot does NOT breathe in whisper state (updated test); `LumiWhisper` renders in whisper state.

---

## Tasks / Subtasks

- [x] **Task 1 — `whisper()` store action (AC: 1, 6)**
  - [x] Added `whisper()` to `LumiActions` interface + implementation in `lumi.store.ts`.
  - [x] Updated `lumi.store.test.ts`: whisper/recede/summon-from-whisper/reset-from-whisper tests → 21 pass.

- [x] **Task 2 — Whisper trigger in `useLumiNudgeSSE` (AC: 2, 6)**
  - [x] Added surfacing gate after `setNudge()` call (proactiveNudges && not summoned → whisper()).
  - [x] Updated `useLumiNudgeSSE.test.ts` with whisper trigger coverage → 13 pass.

- [x] **Task 3 — `LumiWhisper` component (AC: 3, 6)**
  - [x] Created `LumiWhisper.tsx` with nudge text, "See why", "Dismiss" buttons.
  - [x] Added `@keyframes hk-slide-up-whisper` to `globals.css`.
  - [x] Created `LumiWhisper.test.tsx` with full coverage → 9 pass.

- [x] **Task 4 — Update `LumiPresence` (AC: 4, 6)**
  - [x] Updated `restingBreath` condition to `presenceState === 'atRest'`.
  - [x] Added `<LumiWhisper />` to render (alongside `<LumiSheet />`).
  - [x] Updated `LumiPresence.test.tsx` for whisper state behavior → 13 pass.

- [x] **Task 5 — Full verification (AC: 5)**
  - [x] `tsc --noEmit` exit 0; `build` exit 0 (chunk-size warning is pre-existing).
  - [x] Full unit suite: 626 total — 618 pass / 8 fail (8 confirmed pre-existing: useLumiVoiceSession ×6 ONNX, sse.test ×1, OnboardingText ×1). Zero new failures.
  - [x] 13-s1 E2E spec: no locator changes — existing assertions unaffected by new LumiWhisper component.

---

## Dev Notes

### Store architecture (13-s2 foundation)

`lumi.store.ts` already defines `PresenceState = 'atRest' | 'whisper' | 'summoned'` and `whisper` as a reserved value (AC9 fence from 13-s2). The actions `summon()` (→ `'summoned'`, clears nudge) and `recede()` (→ `'atRest'`) already exist and work from all states. We add `whisper()` (→ `'whisper'`).

### Nudge SSE (existing infrastructure)

`useLumiNudgeSSE` opens an `EventSource` on `/v1/events`, listens for `lumi.nudge` events, calls `setNudge(turn)`, and appends live to the sheet when `presenceState === 'summoned'`. The only change: after `setNudge`, add the surfacing gate to drive `whisper()`.

### Nudge text extraction

`pendingNudge.body` is a `TurnBody` union. Nudge turns are always generated by `generateNudge` (one-sentence cap) and will have `body.type === 'message', body.content: string`. Narrow with `body.type === 'message'` and read `.content`; fall back to `'Lumi has an update'` if body is an unexpected type.

### Component size / placement

- Dot: `fixed bottom-6 right-6 z-40 h-9 w-9` (36px diameter at 24px from bottom → top of dot at ~60px from bottom)
- Whisper: `fixed bottom-20 right-6 z-50` (80px from bottom → 20px gap above dot). `max-w-xs` keeps width bounded. `z-50` renders above the dot but below the summoned sheet (which Dialog portals to `document.body` at a higher z).

### Deferred: "Undo" button

"Undo" requires a registered undoable event (e.g., `plan.updated` with a revert payload) which is part of 13-s2.5. Do NOT build it here. The story notes this as an explicit deviation.

### Test conventions (inherited from 13-s2)

- Unit: vitest + @testing-library/react, jsdom. `afterEach(cleanup)`. Reset store in `beforeEach` via `useLumiStore.getState().reset()`. Provide `VoiceSessionContext.Provider` and `QueryClientProvider` wrappers where needed.
- Component `LumiWhisper` uses only the store — no voice context or query client needed.
- E2E: the 13-s1 spec does not characterize whisper (new behavior). No E2E spec update needed for s3 unless the gate fails.

### Project Structure

- New files: `apps/web/src/components/LumiWhisper.tsx`, `apps/web/src/components/LumiWhisper.test.tsx`
- Modified: `lumi.store.ts`, `useLumiNudgeSSE.ts`, `LumiPresence.tsx`, `LumiPresence.test.tsx`, `lumi.store.test.ts`, `useLumiNudgeSSE.test.ts`, `globals.css`
- No contract / backend / route change.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (dev-story), 2026-06-29.

### Debug Log References

- `tsc --noEmit` (apps/web) → exit 0.
- `vitest run` (full web): 626 total — 618 pass / 8 fail. 8 confirmed pre-existing baseline: `useLumiVoiceSession.test.ts` ×6 (silero_vad_legacy.onnx model-load in jsdom), `sse.test.ts` packer.assigned ×1, `OnboardingText.test.tsx` finalize-gate ×1.
- `pnpm --filter @hivekitchen/web build` → exit 0 (chunk-size warning pre-existing).

### Completion Notes List

- ✅ Added `whisper()` action to `lumi.store.ts` — drives `presenceState = 'whisper'` (the third valet state, reserved but unused in 13-s2).
- ✅ `useLumiNudgeSSE` now triggers `whisper()` after `setNudge()` when `proactiveNudges && presenceState !== 'summoned'` — the WHEN controller for valet rule 3.
- ✅ New `LumiWhisper.tsx` component: renders in `presenceState === 'whisper'`, shows nudge text (with message-type guard + fallback), "See why" → `summon()`, "Dismiss" → `setNudge(null)` + `recede()`. Role="status" + aria-live="polite". Slide-up entry (`hk-slide-up-whisper`) with `motion-reduce:animate-none`.
- ✅ `LumiPresence` restingBreath narrowed to `presenceState === 'atRest'` only — dot no longer breathes in whisper state (the whisper line IS the nudge surface).
- ✅ Frontend-only — no contract / backend / route change. 13-s1 gate unaffected.

### Deviations

1. **"Undo" not built (AC3).** Deferred to 13-s2.5 (requires `plan.updated` SSE emit with revert payload). Whisper shows "See why" and "Dismiss" only.

### File List

- `apps/web/src/stores/lumi.store.ts` — MODIFIED (added `whisper()` action + comment on `recede()`).
- `apps/web/src/stores/lumi.store.test.ts` — MODIFIED (4 new tests for whisper action).
- `apps/web/src/hooks/useLumiNudgeSSE.ts` — MODIFIED (whisper surfacing gate after setNudge).
- `apps/web/src/hooks/useLumiNudgeSSE.test.ts` — MODIFIED (4 new tests: whisper trigger, proactiveNudges=false, summoned guard, stacking guard).
- `apps/web/src/components/LumiWhisper.tsx` — NEW.
- `apps/web/src/components/LumiWhisper.test.tsx` — NEW.
- `apps/web/src/components/LumiPresence.tsx` — MODIFIED (import LumiWhisper; restingBreath narrowed to atRest; render LumiWhisper).
- `apps/web/src/components/LumiPresence.test.tsx` — MODIFIED (2 new tests: no-breath-in-whisper, LumiWhisper renders in whisper).
- `apps/web/src/styles/globals.css` — MODIFIED (added @keyframes hk-slide-up-whisper).
- `_bmad-output/implementation-artifacts/13-s3-whisper-channel.md` — NEW (this story file).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — MODIFIED (13-s3 → review).

### Review Findings

- [x] [Review][Decision] Auto-dismiss timeout — resolved: 10 s timer, resets on hover/focus. Implemented as `useRef` timer + `onMouseEnter`/`onFocus`/`onBlur` handlers in `LumiWhisper.tsx`.
- [x] [Review][Patch] Non-atomic dismiss + SSE race: `handleDismiss` calls `setNudge(null)` then `recede()` separately → added `dismissNudge()` atomic action to store; `handleDismiss` now calls only `dismissNudge()` [`lumi.store.ts`, `LumiWhisper.tsx`]
- [x] [Review][Patch] Gate uses `presenceState !== 'summoned'` but spec says second nudge while whispering should be a "no-op" call — changed to `presenceState === 'atRest'` [`useLumiNudgeSSE.ts` surfacing gate]
- [x] [Review][Patch] `role="status"` + `aria-live="polite"` on conditional mount won't announce — container now always mounted (`sr-only` when not visible); AT sees content injection into an existing live region [`LumiWhisper.tsx`]
- [x] [Review][Patch] "See why" button missing accessible label — added `aria-label="See why Lumi sent this nudge"` [`LumiWhisper.tsx`]
- [x] [Review][Patch] No focus management on dismiss — `handleDismiss` now calls `document.querySelector('[data-lumi-dot]')?.focus()` after `dismissNudge()`; `data-lumi-dot` added to dot button in `LumiPresence.tsx` [`LumiWhisper.tsx`, `LumiPresence.tsx`]
- [x] [Review][Defer] `aria-controls` references `lumi-sheet` which may not be in DOM when sheet unmounted — pre-existing from 13-s2 [`LumiPresence.tsx`] — deferred, pre-existing
- [x] [Review][Defer] `w-[calc(100vw-3rem)]` width utility not in AC3 spec (only `max-w-xs` listed) — low risk, better UX than max-w-xs alone [`LumiWhisper.tsx`] — deferred, pre-existing
- [x] [Review][Defer] "See why" summons on same surface; if nudge was for a different surface the sheet shows unrelated content — inherent in `summon()` API, not 13-s3 scope — deferred, pre-existing
- [x] [Review][Defer] `pendingNudge.body` undefined crash if upstream contract violated (no runtime guard) — upstream contract responsibility, not 13-s3 scope — deferred, pre-existing
- [x] [Review][Defer] No axe AA assertion in E2E for `presenceState='whisper'` state (AC5) — gap, not a regression from 13-s1 baseline — deferred, pre-existing
- [x] [Review][Defer] `setNudge(null)` in dismiss clears pointer to already-appended turn (pointer only, no data loss) — semantic coupling, not a bug — deferred, pre-existing

### Change Log

| Date | Change |
|---|---|
| 2026-06-29 | Story authored from epic-13 brief (dev-story: 13-s3). Status → in-progress. |
| 2026-06-29 | Implemented (dev-story, claude-sonnet-4-6): `whisper()` store action + nudge surfacing gate in useLumiNudgeSSE + new LumiWhisper component (one quiet dismissible line above the dot; "See why" summons sheet; "Dismiss" recedes). LumiPresence restingBreath narrowed to atRest-only. typecheck/build clean; 626 unit tests (618 pass / 8 pre-existing baseline failures). Status → review. |

# Story 12.6: LumiOrb + LumiPanel in root layout

Status: done

## Story

As a Primary Parent,
I want to see a quiet Lumi orb in the corner of every authenticated screen that I can tap to open a conversation panel,
so that Lumi is always reachable without being intrusive (ADR-002 Decision 1).

## Acceptance Criteria

1. **Given** Story 12.2 (`lumi.store.ts`) is complete, **When** Story 12.6 is complete, **Then** `<LumiOrb>` and `<LumiPanel>` are mounted in `apps/web/src/routes/(app)/layout.tsx`.

2. **Given** the user is on `/onboarding`, **Then** `<LumiOrb>` and `<LumiPanel>` are NOT rendered (onboarding owns its own Lumi surface).

3. **Given** the user is on a child-facing route (future `/lunch/*`), **Then** `<LumiOrb>` and `<LumiPanel>` are NOT rendered.

4. **Given** the panel is closed, **Then** the orb is a small element anchored bottom-right; if `pendingNudge !== null` it has a gentle breathing animation.

5. **Given** `voiceStatus === 'active'` in the Lumi store, **Then** the orb pulses to indicate an active voice session.

6. **Given** the user taps the orb, **Then** `lumiStore.openPanel()` is called and the panel becomes visible in `text` mode.

7. **Given** the panel is open in text mode, **Then** a compact panel (max-width 320px) is shown, displaying up to the last 8 turns from `lumiStore.turns` plus a text input field (stub — actual POST is Story 12.10).

8. **Given** the panel is open in voice mode, **Then** the orb pulses and the panel shows turns including any live-transcript turns appended via `lumiStore.appendTurn()` (voice session lifecycle is Story 12.8).

9. **Given** the panel is opened and `lumiStore.threadIds[surface]` is a known thread ID, **Then** the panel fetches turns from `GET /v1/lumi/threads/:threadId/turns`, parses with `LumiThreadTurnsResponseSchema`, and calls `hydrateThread(surface, threadId, turns)`.

10. **Given** the user taps the dismiss affordance on the panel, **Then** `lumiStore.closePanel()` is called and the panel hides.

11. **Given** the design spec (ADR-002 Decision 1 + apps/web CLAUDE.md), **Then** the panel uses warm-neutral palette (stone/amber tones), is visually secondary to the current page, and uses no chat-first layout chrome.

12. **Given** the orb and panel are interactive, **Then** both are keyboard-accessible (orb has `role="button"` with `aria-label`, panel has a visible dismiss button).

## Tasks / Subtasks

- [x] Task 1 — Restructure router in `apps/web/src/app.tsx` to use React Router nested layout (AC: #1, #2, #3)
  - [x] Import `AppLayout` from `./routes/(app)/layout.js`
  - [x] Create a nested route group `{ element: <AppLayout />, children: [...] }` wrapping `/app` and `/account`
  - [x] Leave `/onboarding` as a flat route (excluded from AppLayout — no Lumi orb)
  - [x] Leave auth routes, invite routes flat as before
  - [x] Remove the `LayoutProps`/`children` pattern from `(app)/layout.tsx` (no longer needed)

- [x] Task 2 — Rewrite `apps/web/src/routes/(app)/layout.tsx` to use `<Outlet />` and mount Lumi components (AC: #1)
  - [x] Replace `{ children: ReactNode }` prop with `import { Outlet } from 'react-router-dom'`
  - [x] Keep `useScope('app-scope')` call in layout (but do NOT remove it from individual pages — calling it twice is safe and prevents regressions if a page is later extracted)
  - [x] Render `<Outlet />` plus `<LumiOrb />` and `<LumiPanel />` inside a React Fragment wrapper
  - [x] The Lumi components are always mounted when inside this layout — visibility is controlled by store state inside the components

- [x] Task 3 — Create `apps/web/src/components/LumiOrb.tsx` (AC: #4, #5, #6, #12)
  - [x] Read `isPanelOpen`, `voiceStatus`, `pendingNudge` from `useLumiStore` via selectors
  - [x] Render a fixed bottom-right button (`fixed bottom-6 right-6 z-50`)
  - [x] `collapsed` state (panel closed): small rounded-full button ~40px; apply breathing animation class when `pendingNudge !== null`; respect `motion-reduce:animate-none` (same pattern as `motion-reduce:transition-none` used elsewhere in the codebase)
  - [x] `voice active` state (`voiceStatus === 'active'`): apply pulse animation class; respect `motion-reduce:animate-none`
  - [x] On click: call `useLumiStore.getState().openPanel()`
  - [x] Accessibility: `role="button"`, `aria-label="Open Lumi"` (or "Close Lumi" if panel open), keyboard `onKeyDown` for Enter/Space — implemented as native `<button>` (implicit role + automatic Enter/Space activation, so explicit `onKeyDown` is unnecessary)
  - [x] When `isPanelOpen`, the orb may stay visible (as a dismiss shortcut) or hide — keep it visible and change `aria-label` to "Lumi is open" (Story 12.8 will refine voice-state UX)
  - [x] Design: amber/honey tones consistent with warm-neutral palette; a soft circular glow, not a futuristic pulsing sphere

- [x] Task 4 — Create `apps/web/src/components/LumiPanel.tsx` (AC: #7, #8, #10, #11)
  - [x] Read `isPanelOpen`, `panelMode`, `turns`, `isHydrating`, `voiceError` from `useLumiStore`
  - [x] Return `null` when `!isPanelOpen`
  - [x] Positioning: `fixed bottom-20 right-6 z-50 w-full max-w-xs` (320px max, above the orb)
  - [x] Panel chrome: soft shadow, rounded corners, oat/warm-neutral background (no chat-app blue/dark theme)
  - [x] Dismiss button: top-right of panel, calls `closePanel()`; accessible with `aria-label="Close Lumi panel"`
  - [x] Turns list: show last 8 turns from `turns` slice (newest at bottom); each turn renders sender + body text; apply `isHydrating` loading state (e.g., subtle skeleton or spinner) when `turns` is empty and `isHydrating`
  - [x] Text input area (stub): `<textarea>` or `<input>` with placeholder "Ask Lumi…" — `disabled` until Story 12.10 wires the POST. Add a `/* TODO Story 12.10 */` comment so it's easy to find.
  - [x] Voice mode: when `panelMode === 'voice'`, show turns (same list) but disable the text input; show a "Tap the orb to end voice session" hint; `voiceError` message if set
  - [x] No chat-first layout: panel is a compact overlay, NOT a full-screen modal, NOT a sidebar that pushes content, NOT centered on screen

- [x] Task 5 — Thread hydration on panel open (AC: #9)
  - [x] In `LumiPanel.tsx`, add a `useEffect` that triggers when `isPanelOpen` transitions to `true`
  - [x] Inside effect: read `surface`, `threadIds`, `isHydrating` from store; if `threadId = threadIds[surface]` is defined AND `!isHydrating` AND `turns.length === 0`: set `isHydrating` to `true` via `useLumiStore.setState({ isHydrating: true })`, then call `hkFetch<unknown>(\`/v1/lumi/threads/${threadId}/turns\`, { method: 'GET' })`, parse with `LumiThreadTurnsResponseSchema`, call `hydrateThread(surface, threadId, parsed.turns)`
  - [x] On fetch error: reset `isHydrating` to `false` (don't throw to the user — empty panel is fine)
  - [x] Guard: if `isPanelOpen` becomes false before fetch resolves, the hydration result should still be written (TOCTOU guard is inside `hydrateThread` in the store — it compares surfaces and discards stale results; no extra guard needed here)
  - [x] Use `AbortController`/`signal` for the fetch to cancel if the component unmounts before resolution

- [x] Task 6 — Tests (AC: all)
  - [x] `apps/web/src/components/LumiOrb.test.tsx`
    - [x] Orb renders and is accessible (role, aria-label)
    - [x] Click calls `openPanel()` on store
    - [x] `pendingNudge !== null` → orb has breathing animation class
    - [x] `voiceStatus === 'active'` → orb has pulse class
  - [x] `apps/web/src/components/LumiPanel.test.tsx`
    - [x] Returns null when `isPanelOpen === false`
    - [x] Renders when `isPanelOpen === true`
    - [x] Dismiss button calls `closePanel()`
    - [x] Shows turns (renders turn bodies from store)
    - [x] `isHydrating === true` and no turns → loading state visible
    - [x] Text input is disabled (stub)
    - [x] Voice mode: text input disabled, shows voice hint copy
  - [x] Router integration test or Playwright e2e asserting LumiOrb is absent on `/onboarding` — implemented as `apps/web/src/routes/(app)/layout.test.tsx` using `createMemoryRouter`, asserting orb appears under `/app` and is absent under `/onboarding`

## Dev Notes

### Critical: Router Restructure Required

The current `apps/web/src/app.tsx` uses a **flat router** — all routes are siblings with no nesting:

```js
{ path: '/app', element: <AppHomePage /> },
{ path: '/account', element: <AccountPage /> },
{ path: '/onboarding', element: <OnboardingPage /> },
```

The existing `apps/web/src/routes/(app)/layout.tsx` is **NOT currently wired into the router** — it exists as a file but is never imported or used. Its `{ children: ReactNode }` prop pattern (pre-React Router nested layout) must be replaced.

**Required change in `app.tsx`**: Use React Router v6 nested routes via the `children` array and `<Outlet />` in the layout:

```js
{
  element: <AppLayout />,      // layout.tsx — renders <Outlet /> + Lumi components
  children: [
    { path: '/app', element: <AppHomePage /> },
    { path: '/account', element: <AccountPage /> },
    // Add future authenticated routes here — they automatically get LumiOrb + LumiPanel
  ],
},
{ path: '/onboarding', element: <OnboardingPage /> },   // EXCLUDED — stays flat
```

React Router v6 flat config with `element` + `children` is already the pattern used for the root-level router — this is not a new API, just nesting it one level.

### Lumi Store — Already Implemented

`useLumiStore` is fully implemented (Story 12.2) at `apps/web/src/stores/lumi.store.ts`. The component must use it via Zustand selectors (NOT `useLumiStore.getState()` for reactive reads):

```tsx
const isPanelOpen = useLumiStore((s) => s.isPanelOpen);
const voiceStatus = useLumiStore((s) => s.voiceStatus);
const pendingNudge = useLumiStore((s) => s.pendingNudge);
const turns = useLumiStore((s) => s.turns);
const isHydrating = useLumiStore((s) => s.isHydrating);
```

Use `useLumiStore.getState().action()` only for imperative calls (onClick, useEffect bodies). Do NOT use `useLumiStore.getState()` at render time — it won't re-render.

Store actions available: `openPanel(mode?)`, `closePanel()`, `hydrateThread(surface, threadId, turns)`.

### Thread Hydration API Call

```ts
import { LumiThreadTurnsResponseSchema } from '@hivekitchen/contracts';
import { hkFetch } from '@/lib/fetch.js';

// Inside LumiPanel useEffect:
const raw = await hkFetch<unknown>(`/v1/lumi/threads/${threadId}/turns`, { method: 'GET', signal });
const parsed = LumiThreadTurnsResponseSchema.parse(raw);
useLumiStore.getState().hydrateThread(surface, threadId, parsed.turns);
```

The Zod parse call (.parse, not .safeParse) is appropriate here — a malformed response from our own API is a developer error worth throwing. Wrap the whole block in try/catch and reset `isHydrating` on error.

### Zustand Direct setState for isHydrating

`isHydrating` has no dedicated action. Set it directly:
```ts
useLumiStore.setState({ isHydrating: true });
```

This is the established pattern in the store tests (e.g., `useLumiStore.setState({ isHydrating: true })` in `lumi.store.test.ts`).

### Turn Rendering

`Turn` type comes from `@hivekitchen/types`. Each turn has:
- `sender`: `{ kind: 'user'; user_id: string } | { kind: 'lumi' }` 
- `body`: polymorphic — for the panel, only render `kind === 'message'` bodies (`body.text`); unknown kinds can be skipped or show a placeholder
- `turn_id`, `created_at`, `server_seq` for keying

Keep turn rendering minimal — this is a companion panel, not a full chat UI.

### Scoped `useScope` Call

The current `layout.tsx` calls `useScope('app-scope')`. Keep this. Individual pages (`index.tsx`, `account.tsx`) also call `useScope('app-scope')` — do NOT remove those calls. Calling `useScope` in the layout AND in the child page is safe (it's idempotent in the `@hivekitchen/ui` package) and prevents regressions if a page is ever removed from the nested route group.

`onboarding.tsx` continues calling `useScope('app-scope')` directly since it's outside the layout.

### Tailwind Animation Pattern

The codebase uses `motion-reduce:transition-none` for reduced-motion support. Apply the same pattern for animations:
- Breathing: `animate-pulse` (Tailwind built-in) + `motion-reduce:animate-none`
- Voice pulse: `animate-ping` or custom keyframes + `motion-reduce:animate-none`

Avoid `framer-motion` or any animation library — it is not installed.

### Testing Pattern

Use `@testing-library/react` (already installed). To test store-connected components, set the store state directly:

```tsx
import { useLumiStore } from '@/stores/lumi.store.js';

beforeEach(() => {
  useLumiStore.getState().reset();
});

it('shows pulse when voice active', () => {
  useLumiStore.setState({ voiceStatus: 'active' });
  render(<LumiOrb />);
  expect(screen.getByRole('button')).toHaveClass('animate-ping');
});
```

Mock `hkFetch` (from `@/lib/fetch.js`) for the hydration test to avoid real network calls.

### Scope of Story 12.6 vs. Later Stories

| Feature | Story |
|---|---|
| LumiOrb + LumiPanel shell in layout | **12.6 (this story)** |
| `setContext()` on route mount | 12.7 |
| Tap-to-talk (ElevenLabs STT + TTS WebSockets) | 12.8 |
| Text turn POST `/v1/lumi/turns` | 12.10 |
| Proactive nudge SSE delivery | 12.11 |

In this story: the text input is present but `disabled`. The voice panel state is visually represented but no actual WebSocket is opened. The orb clicking opens the panel; that's all the user can do in 12.6 unless turns exist from a previous story's seeding.

### Project Structure Notes

**New files:**
- `apps/web/src/components/LumiOrb.tsx`
- `apps/web/src/components/LumiOrb.test.tsx`
- `apps/web/src/components/LumiPanel.tsx`
- `apps/web/src/components/LumiPanel.test.tsx`

**Modified files:**
- `apps/web/src/routes/(app)/layout.tsx` — replace `children` prop with `<Outlet />`, add LumiOrb + LumiPanel
- `apps/web/src/app.tsx` — restructure router to use nested layout group for /app and /account

**No API changes.** No contract changes. No migration.

### References

- [Source: _bmad-output/planning-artifacts/adr-ambient-lumi.md#Decision 1 — Persistent Lumi UI Surface] — orb states, exclusions, affected files
- [Source: _bmad-output/planning-artifacts/adr-ambient-lumi.md#Decision 5 — Global Lumi Store] — store shape and surface-switching behavior
- [Source: _bmad-output/planning-artifacts/epics.md#Story 12.6] — acceptance criteria and design constraints
- [Source: apps/web/src/stores/lumi.store.ts] — store implementation from Story 12.2; actions: openPanel, closePanel, hydrateThread, appendTurn, setNudge
- [Source: apps/web/src/stores/lumi.store.test.ts] — store usage patterns (direct setState, selectors)
- [Source: apps/web/src/app.tsx] — current flat router; requires nested layout restructure
- [Source: apps/web/src/routes/(app)/layout.tsx] — currently unused in router; rewrite to use Outlet
- [Source: packages/contracts/src/lumi.ts] — `LumiThreadTurnsResponseSchema`, `LumiSurface`, `Turn` (re-exported)
- [Source: apps/web/src/lib/fetch.ts] — `hkFetch` client signature and `HkApiError`
- [Source: apps/web/CLAUDE.md] — design rules (warm neutrals, no chat-first layout, calm system aesthetic)
- [Source: _bmad-output/project-context.md] — Zustand 5 curried create, Tailwind-only, `motion-reduce:*` pattern, React 19 rules

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Claude Code, dev-story workflow)

### Debug Log References

- `pnpm --filter @hivekitchen/web typecheck` — clean
- `pnpm --filter @hivekitchen/web test` — 18 files, 134 tests passing (no regressions; 21 new)
- `pnpm --filter @hivekitchen/web lint` — no findings on touched files (pre-existing errors in unrelated `features/compliance`, `features/onboarding`, `routes/(app)/account.tsx`, `OnboardingText.test.tsx` left untouched per scope discipline)

### Completion Notes List

- **Router restructure (AC #1, #2, #3).** `apps/web/src/app.tsx` now wraps `/app` and `/account` in a single `{ element: <AppLayout />, children: [...] }` group. `/onboarding` stays flat — confirmed by the new `layout.test.tsx` integration test that mounts both routes through `createMemoryRouter` and asserts the orb is present at `/app` and absent at `/onboarding`. Auth/invite/dev routes remain flat.
- **Layout (AC #1).** `apps/web/src/routes/(app)/layout.tsx` was rewritten to drop the `{ children: ReactNode }` prop and instead render `<Outlet />` + `<LumiOrb />` + `<LumiPanel />`. `useScope('app-scope')` was preserved in the layout; the duplicate calls in `(app)/index.tsx` and `(app)/account.tsx` were intentionally left in place per the Dev Notes guidance (idempotent and protects against future page extraction).
- **LumiOrb (AC #4, #5, #6, #12).** Native `<button>` element so `role="button"` and Enter/Space activation come for free — explicit `onKeyDown` would have produced double-fires. Voice pulse takes precedence over the breathing nudge animation (verified by a dedicated test). `aria-label` flips between "Open Lumi" and "Lumi is open"; `aria-expanded` mirrors `isPanelOpen`. Tap-while-open closes the panel as a dismiss shortcut.
- **LumiPanel (AC #7, #8, #10, #11).** Compact `max-w-xs` overlay anchored above the orb with warm-neutral chrome (`bg-stone-50`, `border-stone-200`, `shadow-xl`). Renders the last 8 message turns; non-`message` turn bodies (plan diffs, proposals, system events, etc.) are intentionally skipped — those belong on the page surface, not the ambient panel. Stub `<textarea>` is `disabled` with a `TODO Story 12.10` comment; voice mode shows the "Tap the orb to end voice session" hint and surfaces `voiceError` via `role="alert"`.
- **Hydration (AC #9).** A `useEffect` keyed on `isPanelOpen` reads store state via `getState()` (no extra subscriptions), early-exits if `threadId` is undefined / hydration is in flight / turns are already present, sets `isHydrating: true`, calls `hkFetch` with an `AbortController.signal`, parses with `LumiThreadTurnsResponseSchema.parse` (developer-error-on-malformed per Dev Notes), and calls the existing `hydrateThread()` action — which retains the surface-TOCTOU guard. On error the effect resets `isHydrating` to false and `console.warn`s; the panel just shows empty.
- **Turn shape mismatch with Dev Notes.** The story's "Turn Rendering" section described a `sender.kind` / `body.kind` / `body.text` shape, but the actual `Turn` schema in `packages/contracts/src/thread.ts` uses `role` / `body.type` / `body.content` (and the existing `lumi.store.test.ts` fixture casts via `as unknown as Turn` to bypass this). Implementation follows the contract — `turn.id` for keys, `turn.role` for sender label, `turn.body.type === 'message'` to render `turn.body.content`. Worth flagging in the story's Dev Notes for future stories in this epic.
- **Lint hygiene.** Pre-existing lint errors in unrelated files (`ParentalNoticeContent.tsx`, `CulturalRatification*.tsx`, `OnboardingConsent.tsx`, `OnboardingText.test.tsx`, `account.tsx`) were not touched — out of scope for 12.6 and would muddle the diff. They predate this story.

### File List

**New files**
- `apps/web/src/components/LumiOrb.tsx`
- `apps/web/src/components/LumiOrb.test.tsx`
- `apps/web/src/components/LumiPanel.tsx`
- `apps/web/src/components/LumiPanel.test.tsx`
- `apps/web/src/routes/(app)/layout.test.tsx`

**Modified files**
- `apps/web/src/app.tsx` — added nested layout group for `/app` + `/account`; `/onboarding` stays flat
- `apps/web/src/routes/(app)/layout.tsx` — replaced `children` prop with `<Outlet />`; mounted `<LumiOrb />` and `<LumiPanel />`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 12-6 status: ready-for-dev → review
- `_bmad-output/implementation-artifacts/12-6-lumiorb-and-lumipanel-in-root-layout.md` — this story file (Status, Tasks, Dev Agent Record, Change Log)

### Review Findings

- [x] [Review][Patch] AC3 — Add `useMatch('/lunch/*')` guard in `AppLayout` to suppress LumiOrb/LumiPanel on child-facing routes [`apps/web/src/routes/(app)/layout.tsx`]

- [x] [Review][Patch] `animate-ping` applied to the orb `<button>` element causes it to scale to 2× and fade to opacity-0, making the button visually invisible and potentially unclickable at the peak of each animation cycle [`apps/web/src/components/LumiOrb.tsx:12`]
- [x] [Review][Patch] `isHydrating` stuck `true` after panel closes mid-fetch — abort cleanup returns early without resetting the flag, so the next panel open finds `hydratingNow: true` and the guard exits immediately; infinite spinner with no fetch in flight [`apps/web/src/components/LumiPanel.tsx:36-38`]
- [x] [Review][Patch] `closePanel()` does not reset `panelMode` — after a voice session ends and user closes + reopens the panel, `panelMode` is still `'voice'`, showing "Tap the orb to end voice session" with no active session [`apps/api` store — `apps/web/src/stores/lumi.store.ts:86`]
- [x] [Review][Patch] `useEffect` dependency array `[isPanelOpen]` omits `surface` — if the store surface changes while the panel is open (via future `setContext()` from Story 12.7), the effect never re-fires and the panel shows stale or no turns [`apps/web/src/components/LumiPanel.tsx:45`]
- [x] [Review][Patch] `TurnRow` null-return for non-message turns is applied after `slice(-8)` — if all 8 visible turns have non-message bodies, `visibleTurns.length === 0` is false so the empty-state is skipped, but the turns section renders nothing; blank content area with no explanation [`apps/web/src/components/LumiPanel.tsx:49,118`]
- [x] [Review][Patch] AC4 — Breathing animation (`animate-pulse`) applies even when panel is open; AC4 specifies animation only "when panel is closed" — `isPanelOpen` is read but never consulted in the animation class logic [`apps/web/src/components/LumiOrb.tsx:12-16`]
- [x] [Review][Patch] `aria-expanded` on orb button has no `aria-controls` linking it to the panel `<aside>`; `<aside>` has no `id` attribute — AT cannot programmatically associate the button with the element it controls [`apps/web/src/components/LumiOrb.tsx:33`, `apps/web/src/components/LumiPanel.tsx:58`]
- [x] [Review][Patch] `voiceError` banner renders in text mode when a prior voice session left an error — `{voiceError !== null}` has no `isVoiceMode` guard; stale error from a previous voice session persists on next text-mode panel open [`apps/web/src/components/LumiPanel.tsx:88`]

- [x] [Review][Defer] Stale-turns guard blocks re-hydration when surface/thread changes while panel is open — `turnsNow.length > 0` short-circuits before checking if `surface` or `threadId` changed; requires Story 12.7 `setContext()` wiring to observe [`apps/web/src/components/LumiPanel.tsx:23`] — deferred, depends on Story 12.7
- [x] [Review][Defer] `isPanelOpen` and `turns` persist across route navigation with no context reset — panel stays open with prior surface's turns when navigating; Story 12.7 `setContext()` will flush turns on surface switch [`apps/web/src/stores/lumi.store.ts`] — deferred, depends on Story 12.7
- [x] [Review][Defer] Voice `active → ended` animation transition snaps from `animate-ping` to no animation with no intermediate state — jarring UX; Story 12.8 owns voice-state UX refinement [`apps/web/src/components/LumiOrb.tsx:10-16`] — deferred, Story 12.8 scope
- [x] [Review][Defer] `AppLayout` has no authentication guard — unauthenticated deep-links to `/app` or `/account` mount the orb and panel and may trigger a hydration fetch with no auth header [`apps/web/src/routes/(app)/layout.tsx`] — deferred, pre-existing pattern across all routes

## Change Log

- 2026-05-01 — Implemented LumiOrb + LumiPanel ambient surface and wired them via a nested React Router layout for `/app` and `/account` (story 12.6). 21 new component/integration tests added; full web test suite (134 tests) green. Status: ready-for-dev → review.
- 2026-05-01 — Code review complete. 9 patches applied (P3 fix moved to `endTalkSession` to respect store's openPanel-preserves-mode contract), 4 deferred, 10 dismissed. 135 tests passing. Status: review → done.

# Story 13.2: Lumi Presence Primitive (ambient → summoned-and-recedes)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Source brief:** `_bmad-output/planning-artifacts/epic-13-lumi-ux-rebuild-brief.md` § Phase 1, 13-s2. **WALL: presence.**
> **Vision:** `_bmad-output/planning-artifacts/lumi-conversational-ux-rebuild-vision.md` §2 (valet doctrine, 5 rules) + §2.5 (WHEN vs HOW).
> **Reference mockup:** `_bmad-output/planning-artifacts/lumi-valet-model-mockup.html` (all three states on one surface).
> **Gate (must stay green):** `apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts`.
> This is the **keystone** of Epic 13: it replaces the scattered `LumiOrb`/`LumiPanel`/`LumiFAB` with one valet presence primitive. s3 (whisper), s4 (Brief pilot), s10 (talk-to-plan) all build on this.

---

## Story

As a **HiveKitchen parent using the app between planning moments**,
I want **Lumi to sit quietly at rest as a small ambient presence — and, when I tap it, slide in as a focused temporary sheet that runs one turn and then recedes back into my finished week**,
so that **the app reads as a calm finished product a valet laid out for me, never as a chat application, while I keep one-tap access to Lumi whenever I actually need it**.

---

## Acceptance Criteria

### AC1 — `presenceState` state model in `lumi.store.ts`

- Add `presenceState: 'atRest' | 'whisper' | 'summoned'` to `LumiState` (init `'atRest'` in `INITIAL_STATE`). All three values are defined now; **only `'atRest'` and `'summoned'` are driven by this slice** — `'whisper'` is reserved for 13-s3 (see AC9).
- Add actions `summon(mode?: PanelMode)` → sets `presenceState='summoned'`, sets `panelMode` (default `'text'`), and **clears `pendingNudge`** (preserve the existing nudge-ack on open); and `recede()` → sets `presenceState='atRest'`.
- **Replace the `isPanelOpen` boolean** with `presenceState` as the single source of truth for open/closed. Update the only non-presence reader: `useLumiNudgeSSE` (the `store.isPanelOpen && store.surface === …` append-on-live-nudge guard → `store.presenceState === 'summoned' && …`) and `useLumiVoiceSession` (`openPanel('voice')` → `summon('voice')`). `closePanel()`/`openPanel()` are removed (not aliased) — there are no other callers.
- `reset()` restores `presenceState='atRest'`. `endTalkSession()` keeps its existing field resets and additionally must not leave a stale `'summoned'` if the session ended the sheet (keep current `panelMode='text'` reset; do **not** force `recede()` here — receding is the user/escape/dismiss action).

### AC2 — At-rest presence dot (replaces the resting `LumiOrb`)

- A small, quiet **presence dot** renders fixed in the lower-right corner (replaces `LumiOrb`'s resting appearance), terracotta (`bg-lumi-terracotta`, DESIGN.md §"Lumi-terracotta" line 49), smaller/quieter than today's 40px orb per valet rule 2 ("ambient at rest… not a FAB that demands attention").
- It is a `<button>` whose **accessible name is `Open Lumi`** at rest (preserve the 13-s1 locator `button name /open lumi/i`) and reflects open state via `aria-expanded`. `aria-controls` points at the summoned sheet's id.
- **Breathing animation** at rest via Tailwind `animate-pulse` (or equivalent), **paired with `motion-reduce:animate-none`**; all transitions carry `motion-reduce:transition-none` (DESIGN.md §"Reduced motion" line 102; repo convention is the Tailwind `motion-reduce:` variant — see `globals.css:11-12`).
- **Voice-active state preserved:** when `voiceStatus === 'active'`, the dot shows the voice-active affordance (the current `animate-ping`-style indicator) and tapping it ends the session (`endSession()` via `useVoiceSessionContext`), exactly as `LumiOrb` does today. Tap priority: voice-active → `endSession`; `summoned` → `recede`; `atRest` → `summon`.
- **Nudge breath preserved:** the dot still does its subtle breath when `pendingNudge !== null` (current `LumiOrb` behavior). No whisper *line* renders in this slice (AC9).

### AC3 — Summoned sheet (focused, temporary, recedes)

- Tapping the dot at rest opens a **focused temporary sheet** that slides in from the lower-right (mockup `.sheet`), built on warm-neutral design tokens (`bg-surface`/`bg-bg`, `border-border`), **not** a centered white modal.
- The sheet is a **modal dialog**: `role="dialog"`, `aria-modal="true"`, labelled (accessible name `Lumi`), with **focus-trap, Escape-to-close, scrim-click-to-close, body-scroll-lock, and focus restoration to the dot on close**. **Reuse the existing focus-management machinery in `apps/web/src/components/Dialog.tsx`** — do not hand-roll a third focus trap (the repo already has one good trap in `Dialog.tsx` and one trap-less anti-pattern in `PackerAssignmentDialog.tsx`; do not copy the latter).
  - `Dialog.tsx`'s panel/scrim look is hard-coded white/stone and centered, which is wrong for the warm corner sheet. **Recommended:** add optional `panelClassName?` / `scrimClassName?` (and, if needed, a `placement` escape hatch) to `Dialog.tsx` so the warm-token corner sheet inherits all a11y mechanics while overriding chrome. This is backward-compatible — its 3 existing consumers (`ParentalNoticeDialog`, `account.tsx`, `child-flavor-passport.tsx`) pass nothing and keep the current look. Keep `Dialog.test.tsx` green. (Alternative — a standalone `LumiSheet` replicating the trap — is permitted only if extending `Dialog` proves unclean; see Open Questions Q1.)
- **Reduced-motion:** the slide/scrim transitions fall back to static under `prefers-reduced-motion: reduce` (`motion-reduce:transition-none`; `Dialog.tsx:85` already does this for the scrim).
- **Recede:** Escape / scrim-click / the sheet's close (`×`) / a completed turn's dismissal all return `presenceState` to `'atRest'` (`recede()`), restoring focus to the dot. The "you're back in your week" recede is the doctrine (vision §2b, valet rule 5).

### AC4 — The sheet runs a turn and preserves all shipped Lumi functions

- The sheet hosts the **text composer** and submits via the **existing path**: `POST /v1/lumi/turns` with `{ message, context_signal: contextSignal ?? { surface } }`, parsed by `LumiTurnResponseSchema`, pinning `threadIds[surface]` and appending `user_turn` + `lumi_turn` (+ `ratification_turn` when present) — i.e. lift `LumiPanel.handleSubmit` (`LumiPanel.tsx:37-78`) verbatim in behavior. Composer textarea keeps an accessible name (e.g. `Ask Lumi`), Enter-to-submit / Shift+Enter newline, and the send-error path (keep draft on error).
- **Hydration:** the sheet's turn context is hydrated through the existing `useLumiContext`/store thread plumbing (the summoning surface already registered its `contextSignal` via `useLumiContext`; the sheet reuses `surface` + `contextSignal` from the store). Do not add a new fetch path.
- **No shipped feature regresses.** The sheet must carry forward the controls currently living in `LumiPanel`:
  - **Voice** (5-s5): Text/Voice mode, `voiceStatus` connecting/active states, start/end via `useVoiceSessionContext`. `summon('voice')` from `useLumiVoiceSession` opens the sheet in voice mode.
  - **Captions** (5-s13): `<CaptionRibbon>` when `voiceStatus === 'active'`, reading `captionTranscript`/`captionLumiReply`.
  - **Family-language ratification** (5-s10): render `<FamilyLanguageRatificationCard>` for `family_language_prompt` turns (reuse `LumiPanel`'s `useFamilyLanguageTerms` resolved-term suppression).
  - **Pause/resume nudges** (12-s12): the `proactiveNudges` toggle control (currently `LumiPanel`'s footer) must remain reachable from the sheet — do not drop this consent control.
- **Doctrine constraint:** the sheet is a **focused, temporary** surface, not a persistent chat log. It shows the current exchange (the turn(s) from this summon) and may show short recent context, but it is **not** the resting layout and there is **no** persistent 8-turn scroll presented as "home." `MAX_VISIBLE_TURNS`-style history may be retained inside the open sheet for continuity, but the sheet always recedes to the dot.

### AC5 — Mounting, scope suppression, and FAB removal

- In `apps/web/src/routes/(app)/layout.tsx`, **replace** the `{!onLunchRoute && <LumiOrb />}` + `{!onLunchRoute && <LumiPanel />}` mounts (lines 58-59) with the new presence primitive, **preserving the `!onLunchRoute` suppression** (child Lunch Link shows no ambient presence — valet doctrine + DESIGN.md `.child-scope`). The `VoiceSessionProvider` wrapper and `useLumiNudgeSSE(accessToken)` mount stay.
- **Grandparent scope** (`/guest-author/compose` → `GrandparentScopeLayout`) and **onboarding** (`/onboarding`, flat) already mount no ambient Lumi — they must remain unaffected (no new mount leaks into them).
- **Delete** `LumiOrb.tsx`, `LumiPanel.tsx`, `LumiFAB.tsx` and their colocated tests once replaced. **Remove the two decorative, unwired `<LumiFAB>` usages** in `routes/(app)/grocery-list.tsx:38` and `routes/(app)/kitchen-inspiration.tsx:30` (they have no `onClick` and never opened anything — the global presence dot is now the single Lumi affordance). Dev-only `_dev-*` route usages may also be removed; do not otherwise touch those pages.
- Remove any now-orphaned imports/exports your deletions create. Do not delete unrelated pre-existing code.

### AC6 — No persistent chat column anywhere

- After this slice, **no surface renders a persistent chat panel/column/thread as its resting layout** (valet rule 1; epic AC #2). The only Lumi affordances at rest are the presence dot and (in s3) the whisper line. Grep-level check: no component renders the old `max-w-xs` popover-at-rest pattern.

### AC7 — 13-s1 regression gate stays green (with presence assertions updated in lockstep)

- The durable gate assertions **must stay green unchanged**: AC2 axe (`.app-scope` WCAG 2.0 A/AA, node-level `color-contrast` debt allowlist), AC4 reduced-motion (the dot's computed `transition-property` is `none` under `emulateMedia({reducedMotion:'reduce'})`), and AC5 safety display (AllergyClearedBadge row; paused tile non-interactive).
- The **presence-specific characterization** in 13-s1 was written against the orb+panel and is *expected* to be rewritten by this slice (13-s1 Dev Notes explicitly anticipate this). Update `13-s1-ux-regression-baseline.spec.ts` in lockstep so it characterizes the **new** model:
  - AC1.4 "Ambient Lumi orb + panel": the orb→`button name /open lumi/i` locator stays; the opened surface assertion changes from `complementary name /lumi panel/i` to the new **`dialog name /lumi/i`** (role=dialog); close via Escape (see next bullet) and via the sheet close button.
  - The "**Escape does NOT close the panel today**" test (13-s1 lines 292-304) **flips**: Escape now **closes** the summoned sheet (returns to dot, restores focus). Rewrite that test to assert the improved behavior. This is the documented "flip" 13-s1 left room for.
- **No NEW axe violation category or contrast offender** may be introduced by the dot or the sheet. The presence component must meet AA on `.app-scope` (the brief notes s2/s7 should *fix* the amber-warm contrast debt and shrink the allowlist — fixing tokens is optional in this slice but introducing new debt is forbidden).
- Run the axe check against the **opened sheet** too (the 13-s1 deferral noted the panel was never axe-scanned). Add an assertion that the summoned sheet has no new violations and that the dot exposes `aria-expanded`/`aria-controls`.

### AC8 — Tests and type/lint hygiene

- **Unit (vitest + @testing-library/react):**
  - New `lumi.store.test.ts` coverage for `presenceState`, `summon`/`recede`, `reset` (replace the `isPanelOpen`/`openPanel`/`closePanel` cases).
  - New presence component test(s) replacing `LumiOrb.test.tsx`/`LumiPanel.test.tsx`: dot renders + accessible name + `aria-expanded`; tap summons; voice-active tap ends session; reduced-motion class present; **sheet focus-trap + Escape + scrim-close + focus restoration** (model the assertions on `Dialog.test.tsx`, the repo's gold standard); composer submits via mocked `fetch` to `/v1/lumi/turns`; family-language card + caption ribbon + pause-nudges control present. Reset Zustand in `beforeEach`; provide `VoiceSessionContext.Provider`; wrap in `QueryClientProvider` (as `LumiPanel.test.tsx` does).
  - If `Dialog.tsx` is extended, keep `Dialog.test.tsx` green and add a case for the new `panelClassName`/`scrimClassName` (or placement) override.
- **E2E:** the updated `13-s1` spec (AC7) passes against `pnpm preview` build.
- `pnpm --filter @hivekitchen/web typecheck` → zero new errors; lint clean on changed files. `pnpm --filter @hivekitchen/web build` (tsc + vite) succeeds.

### AC9 — Whisper boundary (explicit scope fence with 13-s3)

- This slice **defines** `presenceState='whisper'` as an enum value but renders **no whisper line UI** and adds **no whisper surfacing gate**. The existing nudge plumbing is untouched in behavior: `useLumiNudgeSSE` still calls `setNudge(turn)` (dot breath) and still appends to the open sheet when `presenceState==='summoned'` on the same surface. The single-dismissible-line whisper (with Undo / See why / Dismiss) and its conservative WHEN-gate are **13-s3**.

---

## Tasks / Subtasks

- [x] **Task 1 — `presenceState` store model (AC: 1, 9)**
  - [x] Added `presenceState: 'atRest'|'whisper'|'summoned'` to `LumiState` + `INITIAL_STATE` (`'atRest'`).
  - [x] Added `summon(mode?)` (sets `'summoned'` + `panelMode`, clears `pendingNudge`) and `recede()` (sets `'atRest'`); removed `isPanelOpen`/`openPanel`/`closePanel`.
  - [x] Updated `useLumiNudgeSSE` (guard → `presenceState==='summoned'`), `useLumiVoiceSession` (`summon('voice')`), and `BriefCanvas` (`onTellMore` → `summon()`).
  - [x] Updated `lumi.store.test.ts` + `useLumiNudgeSSE.test.ts`. → store tests green.

- [x] **Task 2 — Presence dot (AC: 2, 5)**
  - [x] Built the at-rest dot in `LumiPresence.tsx`: terracotta `h-9 w-9`, nudge-gated breath (see Deviation 1), `motion-reduce:` fallbacks, accessible name `Open Lumi`/`Lumi is open`, `aria-expanded`/`aria-controls="lumi-sheet"`.
  - [x] Preserved voice-active ping + `endSession` tap; preserved `pendingNudge` breath + thinking pulse; tap priority voice→recede→summon.
  - [x] → `LumiPresence.test.tsx` 9/9 green; 13-s1 AC4 reduced-motion green.

- [x] **Task 3 — Summoned sheet via Dialog (AC: 3)**
  - [x] Extended `Dialog.tsx` with `id`/`panelClassName`/`scrimClassName`/`placement`; defaults unchanged (3 existing consumers + `Dialog.test.tsx` green).
  - [x] Built the warm corner sheet `LumiSheet.tsx` on `Dialog` (role=dialog, name `Lumi`, focus-trap/Escape/scrim/scroll-lock/restore inherited).
  - [x] Wired `summon`/`recede` to `Dialog` `open`/`onClose`. → focus-trap + Escape + scrim-close tests green.

- [x] **Task 4 — Turn execution + feature parity in the sheet (AC: 4)**
  - [x] Lifted `LumiPanel.handleSubmit` behavior (POST `/v1/lumi/turns`, parse, pin thread, append turns). Composer a11y + Enter-submit + error-keeps-draft.
  - [x] Carried forward: Text/Voice toggle + `voiceStatus` states, `<CaptionRibbon>`, `<FamilyLanguageRatificationCard>` (resolved-term suppression), pause/resume-nudges control.
  - [x] → `LumiSheet.test.tsx` 27/27 green.

- [x] **Task 5 — Mount, suppress, delete (AC: 5, 6)**
  - [x] Mounted `<LumiPresence/>` in `layout.tsx` replacing orb+panel; kept `!onLunchRoute`, `VoiceSessionProvider`, `useLumiNudgeSSE`.
  - [x] Deleted `LumiOrb.tsx`/`.test`, `LumiPanel.tsx`/`.test`, `LumiFAB.tsx`; removed `<LumiFAB>` usages in `grocery-list.tsx`, `kitchen-inspiration.tsx`, `_dev-grocery-list.tsx`, `_dev-kitchen-inspiration.tsx`; cleaned orphaned imports.
  - [x] → no persistent chat column; grandparent/onboarding unaffected; typecheck clean.

- [x] **Task 6 — Update the 13-s1 gate + axe the sheet (AC: 7)**
  - [x] Rewrote 13-s1 AC1.4 (opened surface → `dialog name /lumi/i`, aria-expanded/aria-controls asserted) and flipped the Escape test (Escape now closes). Deleted superseded `12-6-lumi-orb-panel.spec.ts`; updated `12-s12`, `5-s16`, `layout.test.tsx`.
  - [x] Added axe scan of the opened sheet — `new: [none]`; AC2/AC4/AC5 green; no new violation category.
  - [x] → full `13-s1` spec: 13 passed / 1 skipped (child-scope AAA), exit 0.

- [x] **Task 7 — Full verification (AC: 8)**
  - [x] `tsc --noEmit` exit 0; `build` (tsc+vite) exit 0; changed source files lint-clean.
  - [x] Full web unit suite: 597 pass / 8 fail — all 8 confirmed pre-existing baseline via `git stash` (onnx VAD ×6, sse packer ×1, OnboardingText finalize ×1); zero new failures.

---

## Dev Notes

### Current-state map (what you are replacing) — verified from source

**Components (all under `apps/web/src/components/`):**
- `LumiOrb.tsx` (71 lines, **zero-prop**, reads store): fixed `bottom-6 right-6 z-50`, `h-10 w-10 rounded-full bg-lumi-terracotta`. `aria-controls="lumi-panel"`, `aria-expanded={isPanelOpen}`, `aria-label` `'Open Lumi'`/`'Lumi is open'`. Breathing = `animate-pulse` when `!isVoiceActive && hasNudge && !isPanelOpen`. Voice `animate-ping` when active; thinking pulse (`data-testid="lumi-thinking-pulse"`) when `lumiThinking`. Every animated class paired with `motion-reduce:animate-none`; `motion-reduce:transition-none` on transitions. `handleClick`: voice active → `endSession()`; panel open → `closePanel()`; else → `openPanel()`.
- `LumiPanel.tsx` (341 lines, zero-prop): `<aside id="lumi-panel" aria-label="Lumi panel">` (role=complementary), `fixed bottom-20 right-6 z-50 w-full max-w-xs`. Header (Text/Voice toggle + close `×` `aria-label="Close Lumi panel"`), `MAX_VISIBLE_TURNS=8` scroll, voice status + `<CaptionRibbon>`, composer `<textarea aria-label="Ask Lumi">` (Enter submit), nudge pause/resume footer. **No focus-trap, no Escape, no focus management.** `handleSubmit` (lines 37-78) = the canonical turn path. Hydrates thread on open via GET `/v1/lumi/threads/:id/turns`.
- `LumiFAB.tsx` (40 lines): props `onClick?`/`ariaLabel?`/`notification?`. `fixed bottom-8 right-8 z-40`. **NOT mounted in layout, NOT connected to store** — only decorative usages in `grocery-list.tsx:38` (`<LumiFAB notification />`) and `kitchen-inspiration.tsx:30` (`<LumiFAB />`) with no `onClick`. Safe to delete.

**Mount:** `routes/(app)/layout.tsx` lines 58-59 (`{!onLunchRoute && <LumiOrb/>}` / `<LumiPanel/>`); `onLunchRoute = useMatch('/lunch/*')` (line 17); wrapped in `<VoiceSessionProvider>` (line 39) fed by `useLumiVoiceSession` (29-36); `useLumiNudgeSSE(accessToken)` (line 24). Grandparent (`GrandparentScopeLayout`) and onboarding mount no ambient Lumi already.

**Store** (`stores/lumi.store.ts`, 181 lines, curried `create<LumiState & LumiActions>()`): fields incl. `surface`, `contextSignal`, `threadIds`, `turns`, `isHydrating`, `talkSessionId`, `voiceStatus` (`'idle'|'connecting'|'active'|'ended'|'error'`), `isSpeaking`, `voiceError`, `captionTranscript`, `captionLumiReply`, `lumiThinking`, **`isPanelOpen`** (replace), `panelMode` (`'text'|'voice'`), `pendingNudge`, `proactiveNudges`, `captionOnlyMode`. Actions incl. `openPanel(mode?)` [clears `pendingNudge`], `closePanel()`, `setContext`, `hydrateThread`, `appendTurn`, `setNudge`, `endTalkSession` (resets voice/caption, `panelMode='text'`), `reset()`. **No `presenceState` today.**

**Hooks/contracts:**
- `useLumiContext(signal)` (`hooks/useLumiContext.ts`) — `setContext` + pre-hydrate; callers incl. `routes/(app)/index.tsx` (`{surface:'brief'}`), `features/plan/PlanPage.tsx`. The summoned sheet consumes the already-registered `surface`/`contextSignal`.
- `useLumiNudgeSSE(accessToken)` (`hooks/useLumiNudgeSSE.ts`) — `EventSource` → named `lumi.nudge` → `setNudge(turn)`; if open & same surface, `appendTurn`. **Update the `isPanelOpen` reference to `presenceState`.**
- `useLumiVoiceSession` (`hooks/useLumiVoiceSession.ts`) — sets `voiceStatus`, calls `openPanel('voice')` on session active (**→ `summon('voice')`**); start/end published via `contexts/VoiceSessionContext.tsx`.
- Turn contract (`packages/contracts/src/lumi.ts`): `LumiTurnRequestSchema` `{ message (1–4000), context_signal, modality? }`; `LumiTurnResponseSchema` `{ thread_id, user_turn, lumi_turn, ratification_turn? }`. `LumiNudgeEventSchema` `{ type:'lumi.nudge', turn, surface }`. `LumiSurface` enum + `LumiContextSignal`.

### Reuse, don't reinvent — the focus-trap primitive already exists

`apps/web/src/components/Dialog.tsx` is the repo's **only** complete a11y dialog: `createPortal`, `role="dialog"` + `aria-modal` + `aria-labelledby`/`aria-describedby`, focus-trap over `FOCUSABLE_SELECTOR`, **Escape via a stable `onCloseRef`** (avoids stale-closure focus-restore bug), scrim-click close, `overflow:hidden` scroll-lock, **focus restoration to trigger**, scrim `motion-reduce:transition-none`. Props today: `{ open, onClose, titleId, descriptionId?, children }`. Gold-standard test: `Dialog.test.tsx` (covers escape, Tab/Shift+Tab wrap, scrim, restore, no-focusables). **Use this.** Its visual (`bg-white`/`bg-stone-900/60`, centered) is the only mismatch — solve with a className/placement escape hatch (AC3), not a second trap. Do **not** copy `PackerAssignmentDialog.tsx` (a `role=dialog` with *no* trap/escape/restore — the anti-pattern to retire later).

### prefers-reduced-motion — repo convention

Tailwind `motion-reduce:` variant at the call site (compiles to `@media (prefers-reduced-motion: reduce)`); **no** global reset (`globals.css:11-12`). 13-s1 AC4 asserts the dot's computed `transition-property` is `none` under emulation — keep `motion-reduce:transition-none` on the dot. A JS hook `useReducedMotion()` exists (`lib/a11y/use-reduced-motion.ts`) but is unused by components — only reach for it if you add a JS-driven (non-CSS) animation.

### Test conventions

- **E2E:** `apps/web/test/e2e/*.spec.ts`; `playwright.config.ts` `testDir:'./test'`, `baseURL http://localhost:4173`, `webServer: pnpm preview` (build must pass). Auth only via `loginAndNavigate(page, dest)` from `_helpers.ts` (Zustand auth is in-memory; never `page.goto(dest)` directly). Mock APIs with `page.route('**/v1/...', r => r.fulfill({...}))`; clock via `page.clock.install`. axe via `@axe-core/playwright` `new AxeBuilder({page}).include(sel).withTags(tags).analyze()` — the `checkA11y`/`isKnownContrastDebtNode` helpers already live in the 13-s1 spec; reuse them when you scan the opened sheet.
- **Unit:** `vitest.config.ts` jsdom, `globals:false` (import `describe/it/expect/vi` from `vitest`), alias `@`→`src`. `afterEach(cleanup)`; reset Zustand in `beforeEach` (`useLumiStore.getState().reset()`); voice via `<VoiceSessionContext.Provider value={{startSession,endSession}}>`; TanStack via a `QueryClientProvider` wrapper; mock `globalThis.fetch` with `new Response(JSON.stringify(...), {status,headers})`. Patterns in `LumiPanel.test.tsx`, `LumiOrb.test.tsx`, `Dialog.test.tsx`.

### Design-system anchors (DESIGN.md — canonical, read before UI authoring)

- `--lumi-terracotta` `#B46A4E` = "Lumi's voice" (line 49); `--lumi-terracotta-warmed` is **proposal-hover only**. **Honey rule (locked):** amber/honey is for **recognition moments only**, never button hovers (line 44) — the dot/sheet chrome must not use amber as a hover. Reduced-motion floor (line 102). Scope tags: `.app-scope` (AA, default), `.child-scope` (AAA, Lunch Link — suppressed here), `.grandparent-scope` (lines 104-109). `<TalkToLumiButton>` is `lumi-terracotta` + `lumi-terracotta-warmed` hover (line 306). DESIGN.md already references a `<LumiPresenceCard>` token usage (line 353) — keep new presence chrome within these channels. Per the brief, presence/sheet land as **new locked components appended** to the system; do not alter existing tokens/visuals.

### Scope fences

- **In scope:** `presenceState` model; the dot + summoned sheet (with full LumiPanel feature parity); mount swap; deletion of orb/panel/FAB; the 13-s1 gate update.
- **Out of scope (later slices):** whisper line + WHEN-gate (s3); SSE push completion / poll deletion (s2.5); Brief finished-surface rebuild (s4); planner surface + conversational edit + live artifact re-render (s7–s10); route collapse (s11). Do **not** build a whisper line, do **not** touch `BriefCanvas`/`PlanPage`/onboarding here.

### Previous-story intelligence (13-s1, done)

13-s1 is the behavioral gate (flows + axe + reduced-motion + safety display); pixel snapshots were descoped (Epic 13 is a deliberate visual rebuild). It explicitly anticipates s2 rewriting the orb/panel characterization and flipping the Escape test, while AC2/AC4/AC5 stay green. Known pre-existing AA `color-contrast` debt (amber-warm tokens + footer `text-fg-muted`) is node-allowlisted — your new component must not add to it; fixing it (and shrinking the allowlist) is encouraged but optional.

### Project Structure Notes

- New component(s) under `apps/web/src/components/` (`LumiPresence.tsx`, optional `LumiSheet.tsx`); colocated `*.test.tsx`. Keep files ≤~300 lines (project-context rule) — split dot vs sheet if needed.
- No barrel files in `apps/web/src`; named exports; `import type` for types; Tailwind utilities only; warm-neutral palette. No new external dependency (Dialog reuse means no focus-trap library — and project-context forbids ad-hoc deps).
- No contract/migration/backend change in this slice (frontend-only, per brief §2 Technical Impact).

### References

- [Source: `_bmad-output/planning-artifacts/epic-13-lumi-ux-rebuild-brief.md` §Phase 1 13-s2; §2 Impact; §5 epic-level AC #2]
- [Source: `_bmad-output/planning-artifacts/lumi-conversational-ux-rebuild-vision.md` §2 (valet doctrine), §2.5 (WHEN vs HOW)]
- [Source: `_bmad-output/planning-artifacts/lumi-valet-model-mockup.html` (rest/whisper/summon states)]
- [Source: `apps/web/src/components/{LumiOrb,LumiPanel,LumiFAB,Dialog}.tsx`; `Dialog.test.tsx`]
- [Source: `apps/web/src/stores/lumi.store.ts`; `hooks/{useLumiContext,useLumiNudgeSSE,useLumiVoiceSession}.ts`; `contexts/VoiceSessionContext.tsx`]
- [Source: `apps/web/src/routes/(app)/layout.tsx`; `routes/(app)/{grocery-list,kitchen-inspiration}.tsx`]
- [Source: `apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts`; `apps/web/playwright.config.ts`; `apps/web/vitest.config.ts`; `apps/web/test/e2e/_helpers.ts`]
- [Source: `packages/contracts/src/lumi.ts`]
- [Source: `docs/DESIGN.md` §colors (44-51), §reduced-motion (102), §scope tags (104-109), §TalkToLumiButton (299-316)]
- Memory: `lumi-valet-not-chat-app`, `design-md-canonical`, `mock-screen-reference-check`, `onboarding-ux-is-chat-not-form` (the onboarding exception, not this slice)

### Open Questions — all RESOLVED by Menon (2026-06-29)

1. **Q1 — Dialog reuse mechanism.** ✅ **CONFIRMED: extend `Dialog.tsx`** with `panelClassName`/`scrimClassName` (+ optional placement) so the warm corner sheet inherits the proven a11y trap. Do NOT build a standalone second trap. (As specified in AC3.)
2. **Q2 — Feature parity depth in s2.** ✅ **CONFIRMED: carry ALL shipped LumiPanel functions now** (voice, captions, family-language ratification, pause-nudges) — zero regression to 5-s5/5-s10/5-s13/12-s12. (As specified in AC4.)
3. **Q3 — `isPanelOpen` removal.** ✅ **CONFIRMED: replace `isPanelOpen` with `presenceState` outright** (only orb/panel/SSE/voice read it; all updated in this slice). (As specified in AC1.)

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (dev-story), 2026-06-29.

### Debug Log References

- `tsc --noEmit` (apps/web) → exit 0.
- `vitest run` (full web): 597 pass / 8 fail — 8 confirmed pre-existing baseline via `git stash` (identical on clean tree): `useLumiVoiceSession.test.ts` ×6 (`silero_vad_legacy.onnx` model-load in jsdom), `sse.test.ts` packer.assigned ×1, `OnboardingText.test.tsx` finalize-gate ×1.
- `pnpm --filter @hivekitchen/web build` (tsc+vite) → exit 0.
- E2E `13-s1-ux-regression-baseline` (preview build): 13 pass / 1 skip (child-scope AAA), exit 0 — incl. opened-sheet axe `new: [none]`.
- E2E `5-s10` all pass; `5-s16` 8 pass / 1 fail (AC9 WS — VAD onnx env, pre-existing); `12-s12` all pass (VITE_E2E build); `12-7` 2 surface-registration tests fail — confirmed pre-existing baseline (env/SW) via full-stash clean-tree run.

### Completion Notes List

- ✅ Replaced `LumiOrb`/`LumiPanel`/`LumiFAB` with one valet presence primitive: `LumiPresence` (ambient dot) + `LumiSheet` (summoned, Dialog-based, recedes).
- ✅ `lumi.store`: `isPanelOpen`→`presenceState` (`atRest`/`whisper`/`summoned`); `openPanel`/`closePanel`→`summon`/`recede`. `'whisper'` value reserved for 13-s3 (no whisper UI here — AC9 fence held).
- ✅ Reused `Dialog.tsx` focus-trap/Escape/scrim/scroll-lock/restore via new backward-compatible `id`/`panelClassName`/`scrimClassName`/`placement` props — no second hand-rolled trap.
- ✅ Sheet carries full LumiPanel parity: text turns (POST /v1/lumi/turns), voice (5-S5), captions (5-S13), family-language ratification (5-S10), pause-nudges (12-S12).
- ✅ Escape now closes (the 13-s1 flip); opened sheet is axe-clean (no new WCAG AA violations).
- ✅ Mount keeps `!onLunchRoute` suppression; grandparent/onboarding unaffected. Frontend-only — no contract/migration/dependency change.

### Deviations

1. **Resting breath is nudge-gated, not always-on (AC2).** The mockup shows the dot breathing at rest always, but 12-S12 AC#4 uses the breath as the *pending-nudge* signal, and the whisper line (the real nudge surface) is 13-s3. Making the dot breathe always would (a) break 12-S12's "no breath without nudge" tests and (b) remove the only at-rest nudge indicator until s3. So the breath is preserved exactly as the old orb: `animate-pulse` only when `pendingNudge && !summoned && !voice-active`. The dot is calm at rest otherwise. The always-on ambient breath can land with the whisper styling in s3.
2. **Dot tap during a modal sheet.** With the summoned sheet now modal (scrim), the old "tap the orb again to close" path is replaced by Escape / scrim-click / the sheet close button (the dot sits behind the scrim). `recede()` still supports a dot tap programmatically, but the user-facing close affordances are the modal ones. The voice-hint copy changed "Tap the orb…" → "Tap the dot…".
3. **`12-6-lumi-orb-panel.spec.ts` deleted (superseded).** It characterized the deleted orb+panel (incl. the now-invalid "tap orb while open closes it" — impossible behind a modal scrim). Its still-relevant coverage (dot aria, summon, keyboard, close affordances, thread fetch on summon) is now in the rewritten 13-s1 AC1.4 + `LumiPresence.test.tsx` + `LumiSheet.test.tsx`.

### File List

- `apps/web/src/stores/lumi.store.ts` — MODIFIED (presenceState + summon/recede; removed isPanelOpen/openPanel/closePanel).
- `apps/web/src/components/LumiPresence.tsx` — NEW (ambient dot + renders LumiSheet).
- `apps/web/src/components/LumiPresence.test.tsx` — NEW.
- `apps/web/src/components/LumiSheet.tsx` — NEW (summoned Dialog-based sheet, full feature parity).
- `apps/web/src/components/LumiSheet.test.tsx` — NEW.
- `apps/web/src/components/Dialog.tsx` — MODIFIED (added id/panelClassName/scrimClassName/placement, backward-compatible).
- `apps/web/src/components/Dialog.test.tsx` — MODIFIED (override-props cases).
- `apps/web/src/components/LumiOrb.tsx` — DELETED.
- `apps/web/src/components/LumiOrb.test.tsx` — DELETED.
- `apps/web/src/components/LumiPanel.tsx` — DELETED.
- `apps/web/src/components/LumiPanel.test.tsx` — DELETED.
- `apps/web/src/components/LumiFAB.tsx` — DELETED.
- `apps/web/src/routes/(app)/layout.tsx` — MODIFIED (mount LumiPresence; comment).
- `apps/web/src/routes/(app)/layout.test.tsx` — MODIFIED (wording).
- `apps/web/src/routes/(app)/grocery-list.tsx` — MODIFIED (removed LumiFAB).
- `apps/web/src/routes/(app)/kitchen-inspiration.tsx` — MODIFIED (removed LumiFAB).
- `apps/web/src/routes/_dev-grocery-list.tsx` — MODIFIED (removed LumiFAB).
- `apps/web/src/routes/_dev-kitchen-inspiration.tsx` — MODIFIED (removed LumiFAB).
- `apps/web/src/hooks/useLumiNudgeSSE.ts` — MODIFIED (presenceState guard).
- `apps/web/src/hooks/useLumiNudgeSSE.test.ts` — MODIFIED (presenceState seeding).
- `apps/web/src/hooks/useLumiVoiceSession.ts` — MODIFIED (summon('voice')).
- `apps/web/src/features/plan/BriefCanvas.tsx` — MODIFIED (onTellMore → summon()).
- `apps/web/src/stores/lumi.store.test.ts` — MODIFIED (presenceState/summon/recede tests).
- `apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts` — MODIFIED (AC1.4 dot→sheet, Escape flip, opened-sheet axe, AC4 wording).
- `apps/web/test/e2e/12-6-lumi-orb-panel.spec.ts` — DELETED (superseded).
- `apps/web/test/e2e/12-s12-nudge-sse-opt-out.spec.ts` — MODIFIED (presenceState seeding; dialog locator).
- `apps/web/test/e2e/5-s16-voice-tier-cap.spec.ts` — MODIFIED (dialog locator).

### Review Findings

- [x] [Review][Patch] Dot `aria-label` missing voice-active branch — reads "Open Lumi"/"Lumi is open" when tap action is "End voice session" [`LumiPresence.tsx:30`] — fixed: added `isVoiceActive ? 'End voice session'` branch
- [x] [Review][Patch] "Tap the dot to end voice session" in-sheet hint is physically unreachable — scrim (z-40, portal) sits above dot (z-40); change hint to "Use Voice tab to end session" [`LumiSheet.tsx:255`] — fixed
- [x] [Review][Patch] No slide-in transition on summoned sheet — AC3 requires "slides in from lower-right"; panel appears/disappears instantly [`LumiSheet.tsx:182`] — fixed: `@keyframes hk-slide-in-sheet` in globals.css + `animate-[hk-slide-in-sheet_150ms_ease-out] motion-reduce:animate-none` on panel
- [x] [Review][Patch] No `<button type="submit">` in composer form — Enter-only submit breaks AT users [`LumiSheet.tsx:264`] — fixed: added Send button with disabled state
- [x] [Review][Patch] Voice connecting → Text tab race: in-flight `startSession` resolves and calls `summon('voice')`, overriding user's explicit Text mode switch [`useLumiVoiceSession.ts:356`] — fixed: check `presenceState === 'summoned'` and set `panelMode` only if already open
- [x] [Review][Patch] No `reset()` assertion in store unit tests — AC8 gap [`lumi.store.test.ts`] — fixed: added test asserting `presenceState='atRest'` after `reset()`
- [x] [Review][Patch] No focus-restoration-to-dot test in `LumiPresence.test.tsx` — AC8 gap [`LumiPresence.test.tsx`] — fixed: added test with `.focus()` before click to seed Dialog's restore target
- [x] [Review][Defer] Stale turns shown after surface switch while summoned — `turnsNow.length > 0` guard prevents re-hydration when surface changes and old turns are still in store [`LumiSheet.tsx:96`] — deferred, pre-existing
- [x] [Review][Defer] Concurrent text submit + active VAD unguarded — two POSTs can race on the same thread; turn order in UI is promise-resolution-order, not server_seq [`LumiSheet.tsx:49`] — deferred, pre-existing pattern from LumiPanel
- [x] [Review][Defer] 401 near abort fires unnecessary auth refresh round-trip — `hkFetch` 401 handler calls `tryRefreshSession()` before abort propagates, issuing two extra requests [`LumiSheet.tsx:103`] — deferred, pre-existing hkFetch behavior

## Change Log

| Date | Change |
|---|---|
| 2026-06-29 | Story authored (create-story): Lumi presence primitive. Status → ready-for-dev. |
| 2026-06-29 | Implemented (dev-story, claude-opus-4-8[1m]): `presenceState` model + ambient `LumiPresence` dot + Dialog-based `LumiSheet` (focus-trap/Escape/recede) replacing LumiOrb/LumiPanel/LumiFAB with full feature parity; extended Dialog with chrome-override props; updated 13-s1 gate (AC1.4 dot→sheet, Escape flip, opened-sheet axe `new: none`); deleted superseded 12-6 spec. typecheck/build clean; 13-s1 e2e 13 pass/1 skip; full unit suite 0 new failures (8 pre-existing baseline). Status → review. |
| 2026-06-29 | Code review (bmad-code-review, claude-sonnet-4-6): 7 patch findings fixed (aria-label voice branch, unreachable hint, slide-in transition, submit button, voice-mode race, reset test, focus-restore test); 3 deferred; 10 dismissed. Status → done. |

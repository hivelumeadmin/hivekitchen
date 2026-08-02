# Story 14.6: Kill the remaining god components (account / picker / store)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **HiveKitchen frontend developer**,
I want **the last three tangled files — `account.tsx`, `DisambiguationPicker.tsx`, `lumi.store.ts` — decomposed to match the three-layer discipline (presentation / interaction / data) the rest of Epic 14 established**,
so that **every remaining surface reads server truth through React Query, the valet's presence FSM stands alone and testable, and no file in the plan/account/lumi paths exceeds ~300 lines**.

## Context & Why

- **Build plan:** `valet-canvas-build-plan.md` Slice 6 · **Design:** `valet-canvas-frontend-design.md` §5 (picker/store), §8 (account), §12-D (pre-resolved: SPLIT lumi.store — the presence FSM is load-bearing and mirrors the backend controller).
- S6 is **independent** in the dependency graph ("slot it wherever there's slack") and is **three independent sub-tasks that ship separately** — 3 commits minimum, each gate-passing on its own; revert must be possible per sub-task.
- This is a **pure refactor slice**: zero visual change, zero contract change, zero new endpoints. The proof of parity is unedited tests wherever possible (the 14-s1/14-s2 pattern).

**Reconciliations against the build plan (codebase reality, verified 2026-07-31):**

1. **Counts:** `account.tsx` = 876 lines exactly, **33** useState (plan said ~35), exactly 12 raw network calls (11 `hkFetch` + 1 `hkFetchBlob`), zero React Query. `DisambiguationPicker.tsx` = 663 exactly. `lumi.store.ts` = 242 (plan said 240).
2. **The picker's op list in the plan is stale.** Plan says sub-panels "swapMain / updateVariation / swapSlotRecipe / propose-swap / regen-day". Reality: the picker **never calls** `useSwapMainMutation`/`useSwapSlotRecipeMutation` directly — "Swap Main" IS the conversational propose-swap L3 (5-S12, delegates to `onProposeSwap`), regen-day is a one-tap delegate (no panel), and the picker ALSO contains sick-day pause, pause-one-child, and the l2→l4 slot-override flow the plan doesn't mention. **Split by the real seven levels** (`PickerLevel` union, lines 38–45), not the plan's five names.
3. **The picker is already on React Query** for its own mutations (`useUpdateVariationMutation`, `usePauseDayMutation`, `usePauseChildOnDayMutation` from `features/plan/mutations.ts`). The one raw `hkFetch` in the swap path lives in `useWeekSwap.ts:38` (propose-swap POST) — that's **D-14S1-1**, absorbed here.
4. **Presence-FSM unit tests partially exist already**: `stores/lumi.store.test.ts` (312 lines, 27 its) covers atRest↔summoned↔whisper transitions, dismissNudge atomicity, planEditScope arm/clear, endTalkSession leaving presence alone. The genuine gap: **no atRest→whisper trigger-condition tests** — the `proactiveNudges`/not-already-summoned gating lives in `lib/realtime/sse.ts:308–314`, untested.
5. **`account.tsx` hydrates three external stores from its load effect** (lines 101–148): `useLumiStore` (`setProactiveNudges`, `setCaptionOnlyMode`), `useComplianceStore` (`setAcknowledgmentState`), plus `useAuthStore.updateUser` writeback in `handleSave`. The React Query conversion must relocate these side effects deliberately (see Task 1) — this is the riskiest seam of the slice.

**PRECONDITION — review-status collisions:** stories **5-s15** (voice-transcript retention — its UI lives inside `account.tsx`) and **12-s10** (tap-to-talk voice — touches the lumi.store voice slice; `isSpeaking` is dead until its 12.8 fold) are both sitting in `review` status. Run their code reviews (or get an explicit "carry as-is" ruling from Menon) BEFORE starting sub-tasks 1 and 3 — review patches landing after this refactor would conflict across the exact files being decomposed. Sub-task 2 (picker) has no such collision and can start immediately.

## Acceptance Criteria

1. **`account.tsx` becomes a thin `AccountPage` shell (~≤150 lines) composing concern panels.** Every read goes through a React Query hook; every write through a `useMutation`. Zero raw `hkFetch`/`hkFetchBlob` calls remain in any account file (the blob download uses a mutation wrapping `hkFetchBlob`); all manual `loading/error/saving` flag triplets and the `didLoad` ref are deleted. Panels map to the existing `<section>` boundaries: Profile (incl. email/password), Notifications, Accessibility, VoiceData, FamilyLanguage, Privacy, AllergyLog, DataExport, DeleteAccount — grouped into files ≤ ~300 lines each under `routes/(app)/account/` (or `features/account/` — pick one, note it); the route registration in `app.tsx` still points at a single default export.
2. **Store hydration side effects survive the conversion with identical observable behavior**: the `users/me` query's success path (not a render effect) hydrates `useLumiStore.setProactiveNudges`/`setCaptionOnlyMode` and `useComplianceStore.setAcknowledgmentState`; `handleSave`'s `useAuthStore.updateUser` writeback stays. The `useQuery(['me'])` replacement of `didLoad` must still re-fetch after re-login (query cache cleared on logout — verify `hkFetch` 401/logout flow clears or invalidates it). New query keys registered in `lib/realtime/query-keys.ts` (`QueryKeys.me()` or equivalent — none exists today).
3. **`DisambiguationPicker.tsx` becomes a picker shell + per-level sub-panels**, split by the real `PickerLevel` union: L1 action menu, l2-select-variation, l3-variation-ingredients, l2-select-slot-override (→ l4-override via existing `<OverridePicker>`), l2-select-pause-child, l3-propose-swap. Shell owns level routing, focus effect, Escape handling, and the inline-error region; each sub-panel is independently renderable/testable. Shell + each sub-panel ≤ ~300 lines. Intent handlers that mutate directly (sick-day, pause-child-selected, regen delegate) stay in the shell or move to the owning sub-panel — no logic duplicated.
4. **Absorbed picker/swap deferred items:** (a) **D-14S1-1** — propose-swap's raw `hkFetch` in `useWeekSwap.ts:38` becomes a `useProposeSwapMutation` in `features/plan/mutations.ts` following the existing idempotency-key pattern; (b) **D-14S1-4** — the dead `swapTriggerRef` (only ever assigned `null`; `dismissPicker`'s `trigger?.focus()` is a permanent no-op) is either wired to the real trigger element (restoring focus per WCAG 2.4.3) or deleted with the no-op — wiring is preferred, deletion acceptable with a note; (c) the picker gets `key={activeSwapDay}` at its render site in `BriefContent.tsx` (or equivalent state reset) so day-to-day retargeting no longer carries stale `level`/`proposalInput`/`error` (deferred-work.md:304).
5. **`lumi.store.ts` splits into `presence` / `thread` / `voice` slices** (Zustand slice pattern, curried `create<Shape>()()`) while **preserving the flat state shape and every action signature** — consumers using bare `useLumiStore.setState({...})` (`useLumiContext.ts:25,36`, `useLumiVoiceSession.ts:207,213,236`) and all field selectors keep working unchanged (zero consumer edits is the parity proof; if a consumer edit is unavoidable, justify it in the Dev Record). Cross-slice atomics stay atomic — single `set()` for: `setContext` (presence reset + planEditScope clear + turns/isHydrating wipe), `dismissNudge` (nudge + presenceState + planEditScope), `summon` (presenceState + panelMode + pendingNudge clear), `endTalkSession` (voice fields + `panelMode: 'text'`, presenceState untouched), `reset()` (full INITIAL_STATE).
6. **Presence FSM test gap closed:** new unit tests for the atRest→whisper trigger conditions — nudge dispatch whispers only when `proactiveNudges` is true AND `presenceState !== 'summoned'` (the `sse.ts:308–314` gating; test at the store boundary or extract the gate into the presence slice so it's testable without SSE). Existing 27 lumi.store tests pass **unedited** apart from import-path changes if the file moves.
7. **All existing tests pass with markup stability**: the 21 account unit tests (`account.test.tsx` 10, `account-deletion.test.tsx` 7, `account-export.test.tsx` 4) keep passing — they render the page whole with mocked `hkFetch`, so mocks may need to become React Query harness mocks (mechanical, no assertion weakening); `DisambiguationPicker.test.tsx` (~28 its), `useWeekSwap.test.ts`, `mutations.test.ts`, `OverridePicker.test.tsx`, `BriefCanvas.test.tsx` pass — spec edits only where the D-14S1-1/D-14S1-4/key-reset absorptions changed real behavior, called out individually in the Dev Record.
8. **Full E2E green, 13-s1 baseline untouched.** Affected spec families: account (`2-4`, `2-4b`, `2-5`, `5-s13` — asserts the STORE receives `captionOnlyMode: true`, `5-s15`, `7-s10`, `7-s11`, `4-s17`), picker (`3-12`, `3-13`, `3-19`, `3-22`, `13-s10`), lumi (`12-s12`, `12-s8`, `13-s11`, `12-7`). `13-s1-ux-regression-baseline.spec.ts` passes UNEDITED; axe allowlist frozen; LHCI ratchet holds.
9. **Standard gates per sub-task commit:** typecheck, lint (note: `.ts` hooks still escape react-hooks lint — D-14S1-2; don't rely on lint to catch hook-order bugs in new `.ts` hooks), knip clean (no orphaned exports from the splits), full E2E with `VITE_E2E=true` build from `apps/web`, PR < 500 lines per sub-task where possible.

## Tasks / Subtasks

- [x] **Task 0 — Preconditions** (AC: none)
  - [x] Verify 5-s15 and 12-s10 review status: **RULING (Menon, 2026-07-31): "All three, carry as-is"** — proceed with all 3 sub-tasks; 5-s15 / 12-s10 review patches will be rebased onto the refactored files when those reviews land.
  - [x] `git status` clean (14-s5 review patches committed df89a04); continuing on the epic branch `refactor/valet-canvas-s5-ui-library` per working state.
- [x] **Task 1 — `account.tsx` → React Query + concern panels** (AC: 1, 2, 7, 8, 9) — own commit
  - [x] Added `QueryKeys.me(userId)` / `voiceTranscripts(userId)` / `kitchenMap(householdId)`; `useMeQuery` + `useVoiceTranscriptsQuery` + `useHouseholdNameQuery` in `features/account/queries.ts`; 9 mutations in `features/account/mutations.ts` with optimistic-cache + rollback on the four toggles. **NO `Idempotency-Key` added** — the account endpoints never carried it and both unit and E2E specs assert the exact `{method, body}` init object; adding a header would have been a wire + assertion break, not parity.
  - [x] Store hydration lives in the `me` queryFn (see Completion Notes deviation #1 — React Query v5 removed `useQuery.onSuccess`; the queryFn is the true success path and matches the old `didLoad`-guarded semantics exactly). D-5S13-CR1 NOT fixed — parity only.
  - [x] Split into 10 panels along the existing `<section>` boundaries; `account.tsx` 876 → **75 lines**, 33 useState → **0**, 12 raw fetches → **0**; god-effect + `didLoad` + all loading/error/saving triplets deleted.
  - [x] 3 unit files wrapped in `QueryClientProvider` (harness-only); one lockstep assertion made async (see Completion Notes).
- [x] **Task 2 — `DisambiguationPicker` → shell + sub-panels** (AC: 3, 4, 7, 8, 9) — own commit; no precondition, can go first
  - [x] 7 sub-panels under `features/plan/picker/` + `picker-model.ts` (level union, tree walkers, allergen heuristic, date math, shared class strings). Shell keeps routing/focus/Escape/shared-error. **Shell is 320 lines, ~55 of which are the props contract + module doc** — over the ~300 guideline; splitting further would have meant moving `handleVariationSubmit` out, which owns the *shared* error whose cross-level persistence is a live deferred item (deferred-work.md:955). Flagged rather than silently changed.
  - [x] D-14S1-1: `useProposeSwapMutation` added to `features/plan/mutations.ts`; `useWeekSwap` consumes it — zero raw `hkFetch` left in the hook.
  - [x] D-14S1-4: `swapTriggerRef` **wired** (preferred option) — opening the picker captures the focused element, so Escape/Cancel restores focus instead of dropping it to `<body>`. 2 new regression tests.
  - [x] `key={activeSwapDay}` added at the `BriefContent.tsx` render site.
  - [x] `DisambiguationPicker.test.tsx` (~28 its) passes **UNEDITED** — the parity proof. `useWeekSwap.test.ts` needed a `QueryClientProvider` wrapper (harness-only; assertions unchanged) because the proposal channel is now a mutation.
- [x] **Task 3 — `lumi.store.ts` → presence/thread/voice slices** (AC: 5, 6, 7, 8, 9) — own commit
  - [x] Split into `stores/lumi/{presence,thread,voice}.slice.ts` + `types.ts`; `lumi.store.ts` (242 → 29 lines) composes them and keeps `reset()` global. Flat shape and every action signature preserved — **zero consumer edits**, bare `setState({...})` call sites untouched. Cross-slice atomics stay single-`set()` and are commented where they live (`setContext` in thread writes presence; `endTalkSession` in voice writes `panelMode`).
  - [x] `tryWhisper()` extracted into the presence slice; `sse.ts handleNudge` calls it. 5 new gate tests. **AC-text correction:** the AC said the gate is `presenceState !== 'summoned'`; the shipped code is `=== 'atRest'`, which also suppresses a re-whisper while a line is already showing. Implemented the code's semantics (canon) and tested both cases.
  - [x] Existing store tests **unedited** — `git diff --numstat` on the file reports 51 added / **0 deleted**.
- [ ] **Task 4 — Gates per commit** (AC: 8, 9): typecheck, lint, knip, affected unit suites, full E2E (`VITE_E2E=true`), 13-s1 unedited, axe allowlist frozen, LHCI sanity, PR-size check per sub-task.

### Review Findings

<!-- bmad-code-review 2026-07-31 · 3 adversarial layers (Blind/Edge/Auditor) over df89a04..4180f47 (4,358 diff lines, 37 files) · 40 raw findings → 1 decision + 15 patches + 6 deferred + 4 dismissed. -->

- [x] [Review][Decision] **RESOLVED (Menon, 2026-07-31): option (a) — keep + harden.** Global `notifyManager.setScheduler((flush) => flush())` — all three layers flagged it.** Correct fix for a real bug (see Completion Notes (b)), but it mutates a library singleton at module scope, app-wide and irreversibly. Edge Hunter supplied a concrete hazard: `sse.ts handleMessage 'plan.updated'` issues two `invalidateQueries` calls outside any `batch()`, so subscribers now re-render synchronously *between* them and briefly observe torn state (plan invalidated, `['brief']` not yet). Auditor: no `deferred-work.md` entry, no test asserts the scheduler is installed, and no unit harness exercises it (the specs build their own `QueryClient`). Options: (a) keep + ledger entry + regression test + wrap the sse double-invalidate in `notifyManager.batch()`, (b) revert to default scheduler and hold optimistic values in panel state instead, (c) keep as-is. [`apps/web/src/providers/query-provider.tsx`] (blind+edge+auditor)
- [x] [Review][Patch] Voice-retention rollback is a silent no-op — `onMutate` writes the cache unconditionally but `setQueryData` bails on `undefined`, so when the fail-open transcripts query has no data a failed PATCH leaves the panel reading `immediate_delete` while the server is `standard`; use `removeQueries` when `previous === undefined` [`features/account/mutations.ts:171-183`] (edge, HIGH)
- [x] [Review][Patch] Critical side effects live in `mutate()`-scoped callbacks, which React Query drops when the observer unmounts (`mutationObserver` `hasListeners()` guard) — account deletion can complete server-side without ever calling `logout()`, leaving a live token for a deleted household; move to `useMutation` options. Same class: `DataExportPanel` 401 redirect, `PasswordPanel` cooldown-ref reset, picker `onSwapSettled`/`onDismiss` [`DeleteAccountPanel.tsx:42-57`, `DataExportPanel.tsx`, `PasswordPanel.tsx`, `DisambiguationPicker.tsx`] (blind+edge, HIGH)
- [x] [Review][Patch] Concurrent account mutations interleave — each snapshots and restores the WHOLE `UserProfile` under one key with no `scope`, so a slow failing toggle reverts a fast successful one (and can un-set the one-way family-language ratchet); serialize the four profile mutations with `scope: { id: … }` [`features/account/mutations.ts`] (blind+edge)
- [x] [Review][Patch] `useUpdateProfileMutation.onSuccess` writes the full PATCH response over the cache, clobbering in-flight optimistic toggles (pre-split these were separate state) [`features/account/mutations.ts:38-46`] (edge)
- [x] [Review][Patch] Accessibility rollback leaves the lumi store diverged — `setCaptionOnlyMode` is called unconditionally in `onMutate` but the restore is nested inside `if (previous !== undefined)`, so a failed PATCH with no cached profile suppresses TTS indefinitely while the UI says audio is on [`features/account/mutations.ts:128-143`] (edge)
- [x] [Review][Patch] Focus restoration can target a detached node — no `isConnected` guard, and retargeting the picker to another day captures a button inside the picker that `key={activeSwapDay}` immediately destroys; both paths drop focus to `<body>`, the exact WCAG 2.4.3 failure the change fixes [`features/plan/useWeekSwap.ts:31-45`] (blind+edge)
- [x] [Review][Patch] `l3-propose-swap` renders an empty picker with no exit when `onProposeSwap` flips to undefined mid-flow (a `plan.updated` that clears `canSwap`); fall back to `l1` rather than to blank [`DisambiguationPicker.tsx:341`] (blind+edge)
- [x] [Review][Patch] No logout cache clear — same-user re-login inside the 5-min `gcTime` renders the previous session's cached profile instead of the loading state (old code always showed it); clear from the existing auth subscription in `query-provider.tsx` [`providers/query-provider.tsx`, `stores/auth.store.ts`] (auditor, AC2)
- [x] [Review][Patch] The `captures no trigger when the picker is opened with nothing focused` test asserts only `activeSwapDay === null` — it never inspects focus and would pass with the capture logic deleted [`features/plan/useWeekSwap.test.ts`] (blind+auditor)
- [x] [Review][Patch] `mutations.ts` header comment claims "none of these carry an Idempotency-Key: the account endpoints are plain idempotent PATCHes" — the file defines four POSTs including account delete and data export [`features/account/mutations.ts:15-16`] (blind)
- [x] [Review][Patch] `QueryKeys.voiceTranscripts` doc says the list "is invalidated by the retention-mode mutation" — `useVoiceRetentionMutation` has no `onSuccess` and no `invalidateQueries` [`lib/realtime/query-keys.ts`] (blind)
- [x] [Review][Patch] `useVoiceTranscriptsQuery` ships an unused `options.enabled` param, and disagrees with its sibling `useHouseholdNameQuery` which takes `enabled` positionally [`features/account/queries.ts`] (blind)
- [x] [Review][Patch] Dev Record metrics understated — measured with `wc -l`: `account.tsx` **82** (recorded 75), `DisambiguationPicker.tsx` **346** (recorded 320, so 15% over the ~300 guideline not 7%), `mutations.ts` **224** (the "every new file ≤206" claim is false) [this story file] (auditor, verified)
- [x] [Review][Patch] Undeclared behaviour change — `proposalInput` was shell state and survived a Back→L1→Swap Main round trip; it is now panel-local and the typed text is lost. The panel comment justifies only the *error* being panel-local. Declare it or restore it [`picker/PickerProposeSwap.tsx:32`] (auditor)
- [x] [Review][Patch] Story bookkeeping — Task 4 still unchecked, story `Status:` and `sprint-status.yaml` both still read `ready-for-dev` despite four landed commits [this story file, `sprint-status.yaml`] (auditor)
- [x] [Review][Defer] PATCH responses replace the whole profile with no Zod parse — a partial body (missing `auth_providers`/`notification_prefs`/`role`) white-screens the route where pre-split it degraded one section. `hkFetch` never parses anywhere in the repo, so this is a repo-wide pattern, not a slice defect [`features/account/mutations.ts`] — deferred, pre-existing pattern (edge)
- [x] [Review][Defer] Query-key derivation is triplicated with differing null conditions (`queries.ts`, `useMeKey()`, `account.tsx`); when `accessToken` is null but `userId` is not, query and mutations address different cache entries. Unreachable today (the redirect fires first) but one exported helper should own it [`features/account/`] — deferred, cleanup (blind)
- [x] [Review][Defer] `ProfilePanel` seeds form fields from `useState` initializers and never re-syncs on refetch; near-unreachable with `staleTime: Infinity` + nothing invalidating `['me']`, but a stale draft could be submitted if that ever changes [`features/account/ProfilePanel.tsx`] — deferred, latent (blind)
- [x] [Review][Defer] `setActiveSwapDay` lost its stable `useState`-setter identity (now a fresh closure per render, no `useCallback`); Edge confirmed exactly one non-memoized call site, so impact is nil today [`features/plan/useWeekSwap.ts`] — deferred, no live impact (blind)
- [x] [Review][Defer] Per-panel `error` `useState` survived the "delete the manual triplets" instruction — the loading/saving halves are gone, the error half remains (each needs distinct copy) [`features/account/*Panel.tsx`] — deferred, intentional (auditor)
- [x] [Review][Defer] Per-commit churn exceeds the <500-line PR guideline on two of three sub-tasks (`b2726fc` +1169/−837, `320736c` +752/−433) — deferred, guideline is "where possible" (auditor)

**Dismissed (4):** Tailwind class strings moved into `picker-model.ts` would silently vanish — **disproved**: the glob is `./src/**/*.{ts,tsx}` and the compiled CSS is byte-identical to the 14-s5 baseline (MD5 `12EE3805…`), every picker class present in escaped form. · `account.tsx` hangs forever when a token exists without `user.id` — **unreachable**: `tryRefreshSession` calls `setSession(token, user)` atomically with `id` from the JWT `sub` claim (`lib/fetch.ts:65-72`). · The `account-deletion` `waitFor` relaxation — already disclosed in the Dev Record, payload assertion intact. · `useVoiceRetentionMutation` "permanently empty list" — matches pre-refactor behaviour (the old code also cleared local state and never refetched).

## Dev Notes

- **Exemplars (do not reinvent):** `features/plan/queries.ts` (`usePlanQuery` — key factory + abort signal + staleTime), `features/plan/mutations.ts` (`useSwapMainMutation` — full optimistic with SSE-reconcile no-refetch; `useUpdateVariationMutation` — simpler refetch-on-success), `features/plan/useBriefStateQuery.ts` (null-guarded key). Zustand: curried `create<Shape>()(set => ...)` per apps/web CLAUDE.md; look at how `usePlanProgressStore` is shaped if slice-pattern reference is needed.
- **account.tsx map (verified):** god-effect 101–148; handlers 150–405 (10 mutation-shaped); render sections 440–873 with clean `<section>` boundaries per concern; role-gating: AllergyLog = primary/secondary parent, DataExport + Delete = primary_parent only — gating must not move during the split.
- **Picker structure (verified):** `PickerLevel` union lines 38–45; tree walkers `collectVariations`/`distinctChildIds` 138–160 (pure — extract to a shared module or keep in shell); `isAllergenAffecting` heuristic 78–90 drives the non-optimistic fork in `handleVariationSubmit` (287–333, 422 → allergy copy) — preserve exactly; `deriveOverrideDate` local-time math 92–126.
- **lumi.store consumers (field-level map in recon — key ones):** `LumiConversation.tsx` touches all three slices; `sse.ts` uses `getState()` reads + `setNudge`/`whisper`; `layout.tsx` caption setters; bare `setState` call sites listed in AC5. `isSpeaking` has no setter (dead until 12.8/12-s10) — leave it.
- **Testing standards:** no DOM-snapshot tests (house rule); component tests via Testing Library with the established harness mocks; E2E specs live in `apps/web/test/e2e/`; suspect SPEC drift before flakiness (locked memory); full-suite baseline entering this slice: **425 pass / 13 skip / 0 fail**.
- **Don'ts:** no visual/markup redesign (parity slice); no new endpoints/contracts; no fixing of listed-but-unabsorbed deferred items (D-5S13-CR2/3/5/6, D-5S15-2, picker validation/a11y items, D-13S11-CR3 turns-flash, D4 nudge defaults) — they stay deferred unless Menon rules otherwise; don't grow the axe allowlist; don't introduce duplicate `@hivekitchen/ui` import statements (14-s5 review cleaned these — merge specifiers into one import per module).

### Previous Story Intelligence (14-s5 + Epic 14 pattern)

- **Parity-proof discipline works:** 14-s1/s2/s5 shipped refactors proven by UNEDITED test suites — hold that bar; every spec edit is a flag, not a convenience.
- **14-s5 review learnings that bite here:** (a) `consistent-type-imports` forbids inline `typeof import('x')` annotations — use top-level `import type * as X from 'x'`; (b) repo lint does NOT enforce `import/no-duplicates` — self-police; (c) `.ts` hook files escape react-hooks lint entirely (D-14S1-2) — hook-order bugs in new `.ts` hooks will NOT be caught by lint, review them manually; (d) Tailwind `/alpha` modifiers are dead on ALL semantic tokens — if you touch any classes, use solid scale steps.
- **14-s4 learning:** `as unknown as` double-casts hide contract drift (D-14S4-CR1 was exactly this) — no force-casts at the new query/view boundaries; type them properly.
- **Fresh-context recommendation:** run dev-story for this slice in a fresh window; this story file is self-sufficient.

### Project Structure Notes

- Panels location decision left to dev (route-local `routes/(app)/account/` vs `features/account/`) — either is consistent; feature-scoped modules own their hooks per apps/web CLAUDE.md, but account is a route-only surface (zero component consumers — verified). State the choice in the Dev Record.
- `DisambiguationPicker` sub-panels stay inside `features/plan/` (they are plan-feature interaction surfaces, not shared primitives — do NOT promote anything to `packages/ui`).
- Store slices: keep `stores/lumi.store.ts` as the composition point (public import path unchanged) with slice files beside it (`stores/lumi/presence.slice.ts` etc.) or in-file — public API stability is the requirement, file layout is dev's call.
- Read `_bmad-output/project-context.md` before implementing (CLAUDE.md rule).

### References

- [Source: _bmad-output/planning-artifacts/valet-canvas-build-plan.md#Slice-6]
- [Source: _bmad-output/planning-artifacts/valet-canvas-frontend-design.md#5, #8, #12-D]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — D-14S1-1, D-14S1-4, picker items :304/:930-:975, lumi items :349/:1029/:1045/:1091, account items D-5S13-CR1..6, D-5S15-2]
- [Source: apps/web/src/features/plan/{queries.ts,mutations.ts,useBriefStateQuery.ts,useWeekSwap.ts}]
- [Source: apps/web/src/lib/realtime/{query-keys.ts,sse.ts}]

## Dev Agent Record

### Agent Model Used

claude-opus-5 (1M context) — dev-story, 2026-07-31

### Debug Log References

- `git diff --numstat apps/web/src/stores/lumi.store.test.ts` → `51  0` (additions only — the 27 pre-existing store tests are provably unedited).
- Picker parity proof: `DisambiguationPicker.test.tsx` ~28 its pass with zero edits to the file.
- Account E2E family run pre-commit: 53/53 with the specs unedited.

### Completion Notes List

**Scope ruling.** Menon ruled "all three, carry as-is" on the Task-0 precondition — 5-s15 and 12-s10 stay in `review` and their patches will be rebased onto the refactored files.

**Three commits, one per sub-task**, each gate-passing on its own: `b2726fc` (account), `320736c` (picker), plus the store commit.

**Deviation 1 — store hydration lives in the `me` queryFn, not a "success path" callback (AC2).** AC2 was written assuming `useQuery` still had `onSuccess`; React Query v5 removed it. The two honest options were a `useEffect` on `data` (fires on cache reads too) or the queryFn itself. The queryFn was chosen because it fires *exactly* when server truth lands — behaviourally identical to the old `didLoad`-guarded fetch, which also hydrated only on a real response. Proven by the unedited 5-S13 E2E specs that assert the lumi store receives `captionOnlyMode`.

**Deviation 2 — no `Idempotency-Key` on the account mutations.** The story's Task-1 text suggested adding it "where the API accepts it". These endpoints never carried the header, and both unit and E2E specs assert the exact `{ method, body }` init object. Adding it would have been a wire change plus a spec break dressed up as parity, so it was deliberately not added.

**Deviation 3 — picker shell is 346 lines, over the ~300 guideline (AC3).** ~55 of those are the props contract and the module doc, leaving ~290 of real code. The remaining candidate for extraction was `handleVariationSubmit`, which owns the *shared* error whose cross-level persistence is a live deferred item (deferred-work.md:955); moving it would have silently changed that behaviour. Flagged rather than fixed.

**Deviation 4 — AC6's gate condition was mis-stated.** The AC said "whispers only when `proactiveNudges` && `presenceState !== 'summoned'`". The shipped `sse.ts` gate is `=== 'atRest'`, which additionally suppresses a re-whisper while a whisper line is already showing. Code is canon; `tryWhisper()` implements `=== 'atRest'` and both cases are now tested.

**Two regressions caught by the E2E gate — the second one is the important one.**

*(a) Over-eager refetch.* `useMeQuery` started on `staleTime: 0` to mimic fetch-on-every-mount, but that also leaves the query permanently stale, so a window-focus refetch could re-read the mock profile and clobber an optimistic toggle. The old code fetched once per mount and never again; `staleTime: Infinity` + `refetchOnMount: 'always'` reproduces exactly that. Applied to `useMeQuery` and `useVoiceTranscriptsQuery`.

*(b) Controlled inputs snapped back for a frame — a real responsiveness regression.* Symptom: `locator.check: Clicking the checkbox did not change its state`, and it **moved between runs** (2-5 on one run, 12-s12:178 on the next, :253+:283 in isolation) — the signature of a race, not a fixed break. The Playwright artifact settled it: at failure time the page snapshot showed the box as `[checked] [disabled]`, i.e. the click *had* landed and the optimistic write *had* applied — just too late for the assertion.

Root cause is **not** in this story's code. React Query notifies observers through `notifyManager`, whose default scheduler is `setTimeout(cb, 0)` — a macrotask. `onMutate` runs synchronously and writes the cache synchronously, but the resulting re-render is deferred past the end of React's discrete click dispatch, where `restoreStateIfNeeded()` resets the DOM node to its last *committed* prop. So every controlled input backed by the query cache visibly reverted for a frame. The pre-refactor code used a plain `useState`, which React flushes before that restore — hence no snap-back, ever.

Fix: `notifyManager.setScheduler((flush) => flush())` in `providers/query-provider.tsx` (one line, at the same module scope as the singleton client). Batching is unaffected — `notifyManager.batch()` still coalesces; only flush timing changes.

Worth flagging for review: this is a pre-existing latent hazard that this story merely *exposed*, and the repo already carries a workaround for it — `3-16-school-policy-update-propagation.spec.ts:139` has the comment "use .click() not .check() because the checked state is server-driven". The sibling toggle specs that were passing were passing on race margin, not correctness. Verified with `--repeat-each=3` across the toggle specs: 84/84.

**Three deferred items absorbed** (AC4): D-14S1-1 (raw `hkFetch` → `useProposeSwapMutation`), D-14S1-4 (dead `swapTriggerRef` — **wired**, the preferred option, restoring focus on dismiss per WCAG 2.4.3), and the picker's stale-state-on-retarget gap (`key={activeSwapDay}`).

**Not fixed, deliberately** (still deferred): D-5S13-CR1..6, D-5S15-2, the picker validation/a11y items, D-13S11-CR3 turns-flash, D4 nudge defaults, D-14S1-2 (`.ts` hooks escape react-hooks lint — note the new `.ts` slice files inherit this gap).

**Metrics** (measured with `wc -l`; earlier figures in this record were taken with PowerShell's `Measure-Object -Line`, which undercounts — corrected during review). `account.tsx` 876 → **82** lines, 33 `useState` → 0, 12 raw fetches → 0. `DisambiguationPicker.tsx` 663 → **346** + 7 panels (largest 128). `lumi.store.ts` 242 → **29** + 3 slices. Largest new file: `features/account/mutations.ts` at **224**. All new files are under the ~300 guideline; the picker shell at 346 is the one file over it (see Deviation 3, which is 15% over, not the 7% originally stated).

### File List

**New — `apps/web/src/features/account/`**
- `queries.ts`, `mutations.ts`
- `ProfilePanel.tsx`, `PasswordPanel.tsx`, `NotificationsPanel.tsx`, `AccessibilityPanel.tsx`, `VoiceDataPanel.tsx`, `FamilyLanguagePanel.tsx`, `PrivacyPanel.tsx`, `AllergyLogPanel.tsx`, `DataExportPanel.tsx`, `DeleteAccountPanel.tsx`

**New — `apps/web/src/features/plan/picker/`**
- `picker-model.ts`, `PickerActionMenu.tsx`, `PickerSelectVariation.tsx`, `PickerSelectSlotOverride.tsx`, `PickerSelectPauseChild.tsx`, `PickerOverridePanel.tsx`, `PickerVariationIngredients.tsx`, `PickerProposeSwap.tsx`

**New — `apps/web/src/stores/lumi/`**
- `types.ts`, `presence.slice.ts`, `thread.slice.ts`, `voice.slice.ts`

**Modified**
- `apps/web/src/routes/(app)/account.tsx` — 876 → 75-line shell
- `apps/web/src/features/plan/DisambiguationPicker.tsx` — 663 → 320-line shell
- `apps/web/src/features/plan/useWeekSwap.ts` — consumes the proposal mutation; `swapTriggerRef` wired
- `apps/web/src/features/plan/mutations.ts` — `useProposeSwapMutation` added
- `apps/web/src/features/plan/BriefContent.tsx` — `key={activeSwapDay}` on the picker
- `apps/web/src/stores/lumi.store.ts` — 242 → 29-line composition root
- `apps/web/src/lib/realtime/sse.ts` — `handleNudge` calls `tryWhisper()`
- `apps/web/src/lib/realtime/query-keys.ts` — `me` / `voiceTranscripts` / `kitchenMap`
- `apps/web/src/providers/query-provider.tsx` — `notifyManager.setScheduler` (synchronous flush; see Completion Notes regression (b))

**Tests (harness-only edits + additions)**
- `apps/web/src/routes/(app)/{account,account-export,account-deletion}.test.tsx` — `QueryClientProvider` wrapper; one assertion in the deletion spec wrapped in `waitFor`
- `apps/web/src/features/plan/useWeekSwap.test.ts` — provider wrapper + 2 new focus-restoration tests
- `apps/web/src/stores/lumi.store.test.ts` — 5 new `tryWhisper()` gate tests (additions only)

**Sprint tracking**
- `_bmad-output/implementation-artifacts/sprint-status.yaml`, `14-s6-kill-remaining-god-components.md`

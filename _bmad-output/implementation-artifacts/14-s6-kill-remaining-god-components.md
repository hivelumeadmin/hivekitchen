# Story 14.6: Kill the remaining god components (account / picker / store)

Status: ready-for-dev

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
- [ ] **Task 2 — `DisambiguationPicker` → shell + sub-panels** (AC: 3, 4, 7, 8, 9) — own commit; no precondition, can go first
  - [ ] Extract sub-panels per the seven-level union; shell keeps routing/focus/Escape/error region.
  - [ ] D-14S1-1: `useProposeSwapMutation` in `mutations.ts`; `useWeekSwap.ts` consumes it (its 83 lines shrink; keep its test).
  - [ ] D-14S1-4: wire `swapTriggerRef` to the real trigger (preferred) or delete the no-op.
  - [ ] `key={activeSwapDay}` at the `BriefContent.tsx:262` render site.
  - [ ] Split `DisambiguationPicker.test.tsx` alongside if it aids clarity — but assertion set stays intact.
- [ ] **Task 3 — `lumi.store.ts` → presence/thread/voice slices** (AC: 5, 6, 7, 8, 9) — own commit
  - [ ] Slice split preserving flat shape + atomic cross-slice sets (AC5 list). Keep `reset()` global.
  - [ ] Presence whisper-gate tests (AC6). Consider extracting the sse.ts gate condition into the presence slice (`tryWhisper(nudge)`) so it's unit-testable — if extracted, `sse.ts` calls it and its own behavior is unchanged.
  - [ ] Existing 27 store tests unedited (import paths aside).
- [ ] **Task 4 — Gates per commit** (AC: 8, 9): typecheck, lint, knip, affected unit suites, full E2E (`VITE_E2E=true`), 13-s1 unedited, axe allowlist frozen, LHCI sanity, PR-size check per sub-task.

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

### Debug Log References

### Completion Notes List

### File List

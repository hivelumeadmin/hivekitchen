# Story 14.2: Extract the Brief render branches (BriefCanvas → thin composition root)

Status: done

## Story

As a **HiveKitchen web engineer**,
I want **the four render states of `BriefCanvas` extracted into dedicated presentational components so `BriefCanvas` becomes a thin composition root that only calls the hooks and dispatches to a branch**,
so that **the populated canvas and week grid can be elevated in isolation in S3 — and this slice proves it by leaving the E2E behaviour byte-for-byte identical**.

## Context & Why

S1 (`14-s1`, done) pulled all plumbing out of `BriefCanvas` into `useBriefView`/`useWeekSwap`/`useComposeLifecycle`. The component body is now plumbing-free but still ~415 lines because it holds four render branches (loading skeleton, hard-fail banner, empty state, and the large populated canvas) inline, plus the in-file `ComposeMyPlanButton`/`DevTriggerButton`.

This is **Slice 2 (S2)** of the valet-canvas rebuild: extract those branches so `BriefCanvas` is a pure dispatcher. Still a **pure refactor** — success is the *absence* of change (the Epic-13 baseline passes unedited).

- **Source design:** `valet-canvas-frontend-design.md` §4.2 (decomposition table), §11 (S2).
- **Build plan:** `valet-canvas-build-plan.md` — Slice 2.
- **Predecessor:** `14-s1-extract-brief-data-hooks.md` (hooks + `BriefView` type; the E2E-from-`apps/web` learning).

## Acceptance Criteria

1. **Presentational components exist** under `apps/web/src/features/plan/`:
   - `BriefSkeleton.tsx` — the loading skeleton `<main>` (no props).
   - `BriefHardFail.tsx` — the full-page hard-fail banner (props: `flaggedItems`, `onRetry`).
   - `BriefEmptyState.tsx` — the "preparing your first plan" state, **containing** the moved `ComposeMyPlanButton` and `DevTriggerButton` (no props).
   - `WeekGrid.tsx` — the weekday tile grid (the `tileState` machine + `PlanTile` + `PackerChip`).
   - `BriefContent.tsx` — the populated-brief canvas (the whole `brief !== null` path, incl. `PresenceIndicator`, inline banner, rails, picker, action bar, final error). Props: `householdId`, `view`, `swap`, `lifecycle`.
2. **`BriefCanvas` is a thin composition root**: the `BriefCanvas()` function is just the scope-assertion effect, `householdId`, the three hook calls, and a four-way branch dispatch. **No in-file sub-components**, no render-state atoms, no JSX beyond the four component returns.
3. **Zero behaviour change**: branch conditions and rendered output are identical; `BriefCanvas.test.tsx` passes **unedited**; the Epic-13 `13-s1-ux-regression-baseline.spec.ts` passes unedited (same known-baseline profile).
4. **`WeekGrid` renders the tile grid identically** — same `tileState` derivation (paused / proposal-pending / swap-in-progress / pending-input / decided), same `PlanTile`/`PackerChip` props, same `onWhyThis`/`onSwapIntent` gating.
5. **The three hooks expose named return types** (`BriefView` exists from S1; add `WeekSwap` and `ComposeLifecycle` via `ReturnType<typeof …>`) so `BriefContent`'s props are typed without re-derivation.
6. **DoD gate:** `pnpm typecheck` + `pnpm lint` (changed files) + `knip` clean; `BriefCanvas.test.tsx` + full `features/plan` suite green; E2E `13-s1` baseline unedited (run from `apps/web`). Frontend-only; no contract/api/migration/dependency change. No new server state in Zustand. No restyle (that's S3).

## Tasks / Subtasks

- [ ] Add `export type WeekSwap = ReturnType<typeof useWeekSwap>` and `export type ComposeLifecycle = ReturnType<typeof useComposeLifecycle>` (AC5).
- [ ] Create `WeekGrid.tsx` — lift the tile grid verbatim; props for the tile-state inputs + `onWhyThis`/`onSummonForDay` callbacks (AC1, AC4).
- [ ] Create `BriefSkeleton.tsx`, `BriefHardFail.tsx`, `BriefEmptyState.tsx` (move `ComposeMyPlanButton`/`DevTriggerButton` into the latter) (AC1).
- [ ] Create `BriefContent.tsx` — the populated canvas; compute `freshnessVariant`/`showReasoning`/`summonForDay`/`handleTalkToLumi` internally; render `WeekGrid` (AC1).
- [ ] Rewrite `BriefCanvas.tsx` → thin dispatcher (AC2, AC3).
- [ ] Verify (AC3, AC6): typecheck, `BriefCanvas.test.tsx` unedited, plan suite, lint, knip, E2E `13-s1`.

### Review Findings

_Code review 2026-07-30 (bmad-code-review — 3-layer adversarial: Blind Hunter / Edge Case Hunter / Acceptance Auditor). Zero real defects; zero patches. The extraction was independently verified branch-guard-identical, tileState/prop-gating verbatim, and state-lifetime equivalent._

- [x] [Review][Defer] `BriefContent.tsx` is 314 lines, over the ~300-line guideline [apps/web/src/features/plan/BriefContent.tsx] — deferred; it is the verbatim path-4 extraction and S3's restyle is the planned split
- [x] [Review][Defer] Lateral feature imports (`features/child-requests`, `features/thread`) carried into `BriefContent` [apps/web/src/features/plan/BriefContent.tsx] — deferred, pre-existing debt moved verbatim from the old BriefCanvas; revisit in S3/S5

Dismissed (3): (1) Blind Hunter's `showReasoning`-resets-on-branch-flip — false positive; Edge Case Hunter proved every transition that resets in new also reset in old (`brief`→null ⇒ `planReasoning`→null ⇒ the old reset effect fired). (2) `<main>` node replaced not reconciled across branch switches — informational, no constructible user-visible difference. (3) Comment reflow/trim in moved code — cosmetic, zero rendered impact; the byte-identical requirement applies to branch conditions, which are intact.

E2E gate: `13-s1` baseline ran green (13 pass / 1 skip, **unedited**) against this exact code state during implementation; no patches were applied in review, so the gate stands.

## Dev Notes

- **Branch conditions must stay byte-identical.** The four guards (in order): `isLoading && brief===null` → skeleton; `!isLoading && !isPlanLoading && brief===null && !isError && flaggedItems.length>0` → hard-fail; `!isLoading && brief===null && !isError` → empty; else → `BriefContent`. `BriefContent` must preserve the path-4 subtlety that `brief===null && isError` falls through to it (renders `PresenceIndicator` + optional banner + final `FreshnessState variant="failed"`).
- **Glue moves with the canvas.** `freshnessVariant`, `showReasoning` + its reset effect, `summonForDay`, `handleTalkToLumi` are path-4-only → they live in `BriefContent`. Moving them there is behaviour-identical (they were unused in paths 1–3).
- **Pass hook objects as props** to `BriefContent` (`view`/`swap`/`lifecycle`) — pragmatic for a refactor; typed via the S1/S5 `ReturnType` exports.
- **Hooks stay at the root, unconditional** (`useComposeLifecycle.handleBannerRetry` is needed by the hard-fail branch, so all three are called in `BriefCanvas` before any early return).
- **AC7-exempt in-file components move, not vanish:** `ComposeMyPlanButton`/`DevTriggerButton` (with their `hkFetch`/`useGenerateOnDemandMutation` usage) relocate into `BriefEmptyState` — same "not in the BriefCanvas body" spirit.
- **Verification = absence of change.** As in S1, the proof is `BriefCanvas.test.tsx` (33 tests) passing unedited and the `13-s1` baseline green. Run E2E from `apps/web` (`pnpm --filter @hivekitchen/web test:e2e`) — a repo-root run has no `baseURL` and fails every login with "invalid URL" (S1 learning).

### References

- [Source: valet-canvas-frontend-design.md#4.2]
- [Source: valet-canvas-build-plan.md#Slice 2]
- [Source: apps/web/src/features/plan/BriefCanvas.tsx] (post-S1)
- [Source: apps/web/src/features/plan/useBriefView.ts] (`BriefView` type)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m]

### Debug Log References

- `pnpm --filter @hivekitchen/web typecheck` → clean.
- `vitest run src/features/plan` → 22 files / **241 pass** (incl. `BriefCanvas.test.tsx` 33 **unedited**).
- `eslint` on all 8 changed/new files → clean; `pnpm deadcode:check` (knip) → clean.
- E2E (from `apps/web`, `VITE_E2E=true pnpm build` + `playwright test 13-s1-ux-regression-baseline`) → **13 pass / 1 skip / 0 fail, unedited** (same baseline profile as S1).

### Completion Notes List

- **Pure refactor, zero behaviour change.** `BriefCanvas` is now a ~55-line composition root: scope effect + `householdId` + three hook calls + a four-way branch dispatch. No in-file sub-components, no render state.
- **Extracted components** (all `apps/web/src/features/plan/`): `BriefSkeleton` (loading), `BriefHardFail` (props `flaggedItems`/`onRetry`), `BriefEmptyState` (moved `ComposeMyPlanButton` + `DevTriggerButton` into it), `WeekGrid` (tile grid + `tileState` machine), `BriefContent` (the whole populated-brief `<main>`; owns the canvas-local glue `freshnessVariant`/`showReasoning`/`summonForDay`/`handleTalkToLumi`).
- **Branch conditions preserved byte-for-byte**, including the path-4 fall-through for `brief===null && isError` (now inside `BriefContent`: presence + optional banner + failed `FreshnessState`).
- **AC5**: added `export type WeekSwap`/`ComposeLifecycle` (ReturnType) so `BriefContent`'s props type cleanly; `BriefView` from S1 reused.
- Hooks stay unconditional at the root (`handleBannerRetry` is needed by the hard-fail branch). No new server state in Zustand. Frontend-only; no contract/api/migration/dependency change. No restyle (S3).
- Verification-as-absence-of-change: `BriefCanvas.test.tsx` (33) and the `13-s1` baseline both pass **unedited**.

### File List

- `apps/web/src/features/plan/BriefSkeleton.tsx` (new)
- `apps/web/src/features/plan/BriefHardFail.tsx` (new)
- `apps/web/src/features/plan/BriefEmptyState.tsx` (new — carries moved ComposeMyPlanButton + DevTriggerButton)
- `apps/web/src/features/plan/WeekGrid.tsx` (new)
- `apps/web/src/features/plan/BriefContent.tsx` (new)
- `apps/web/src/features/plan/BriefCanvas.tsx` (modified → thin dispatcher, ~55 lines)
- `apps/web/src/features/plan/useWeekSwap.ts` (modified — `WeekSwap` type export)
- `apps/web/src/features/plan/useComposeLifecycle.ts` (modified — `ComposeLifecycle` type export)

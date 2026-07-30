# HiveKitchen — Valet Canvas Build Plan (6 Slices)

> **Status:** Draft for review · **Author:** Claude (architecture pass) · **Date:** 2026-07-29
> **Implements:** `valet-canvas-frontend-design.md` (§11 migration sequence)
> **Visual acceptance targets:**
> - Brief canvas mockup — https://claude.ai/code/artifact/158568a2-7bd6-4c0f-99fa-42723432a2b6
> - Onboarding Kitchen-Map mockup — https://claude.ai/code/artifact/5c0e0689-c306-41cd-a724-cdab95f351de
>
> **Doctrine:** strangler, not big-bang. Slices 1–2 are risk-free refactors that unlock everything.
> The visible "wow" (slice 3) only happens *after* the god component is decomposed. Each slice ships
> alone behind the standard gate.

---

## Dependency graph

```
S1 ─▶ S2 ─▶ S3 ─▶ S5
              │
S4 (after S2) ┘        S6 (independent, any time)
```

- **S1 → S2 → S3** are sequential: each unlocks the next (you cannot elevate what isn't decomposed).
- **S4** (day view) needs only the plan-tree query, which exists today; start it any time after S2.
- **S5** (component library) wants the component set stable, so it follows S3.
- **S6** (account / picker / store cleanups) is independent — slot it wherever there's slack.

---

## Definition of Done (every slice)

Non-negotiable gate before any PR merges to `main`:

- `pnpm typecheck` and `pnpm lint` pass (strict TS, `consistent-type-imports`).
- **Full local E2E suite green** with `VITE_E2E=true` build — this is the gate again post SW-bypass fix. (Suspect spec drift before flakiness.)
- `knip` dead-code gate passes (the quality job) — no orphaned exports/files left by the move.
- LHCI thresholds hold on the anchor device (Galaxy A13 / 4G) — the Brief renders < 2s; treat thresholds as the truthful ratchet, don't loosen them.
- PR < 500 changed lines where possible; mechanical moves split from behavior changes.
- Conventional commit + `feat/…` / `refactor/…` branch; contract changes (if any) touch `contracts` + `web` + `api` together.
- Accessibility floor: WCAG 2.2 AA app-wide, AAA in `.child-scope` and for all safety copy; `prefers-reduced-motion` honored.

---

## Slice 1 — Extract the Brief data hooks (no visual change)

**Goal:** Pull all data-fetching, cache-mutation, and week-math out of `BriefCanvas` into three
hooks, with zero change to what renders.

**Why first:** `BriefCanvas.tsx` (822 lines) fuses presentation to plumbing; nothing downstream is safe
until the plumbing is behind hooks. This slice is pure motion — the safest possible start.

**Scope**
- New `features/plan/useBriefView.ts` — owns the dual-source reconciliation (`useBriefStateQuery` +
  `usePlanQuery` + `adaptPlansResponse`), week-date math (`getWeekDates`), `buildChildColorMap`,
  `childRoster`, `editableDays`, flagged-item name resolution → returns one `BriefViewModel`.
- New `features/plan/useWeekSwap.ts` — the swap state machine (activeSwapDay, swappingItemId,
  pendingProposal + refs, focus restoration, `onSwapStarted` proposal-vs-variation branch).
- New `features/plan/useComposeLifecycle.ts` — compose / regenerate / sovereignty async, the
  `plan_revision` ref tracking crossed with `usePlanProgressStore`.
- `BriefCanvas.tsx` shrinks to consume the three hooks; markup unchanged this slice.

**Out of scope:** any visual/markup change, the render-branch extraction (S2), the view-model moving
server-side (that's the §12-A decision — see note).

**Success criteria**
- `BriefCanvas.tsx` no longer contains fetch calls, `setQueryData`, or date math.
- Each hook has a unit test (view-model shape from fixtures; swap transitions; lifecycle revision bumps).
- Full E2E plan-review suite passes **unchanged** (no spec edits needed = proof of behavior parity).

**Risk / rollback:** low. Pure refactor; revert is a single-commit undo. Watch for the dual-source
pre-migration guards — preserve them verbatim.

**Size:** M · **Decision touch:** §12-A (view-model source) — *this slice keeps it client-side; server
composer move is a later, separate contract change. Confirm before assuming.*

---

## Slice 2 — Extract the render branches (canvas becomes thin)

**Goal:** Move the four render states out of the god component so `BriefCanvas` becomes a ~120-line
composition root.

**Scope**
- New presentational components: `<BriefSkeleton>` (mimics final layout so the reveal settles),
  `<BriefHardFail>` (the `AllergyUncertaintyBanner` full-page branch), `<BriefEmptyState>` (first-plan,
  absorbing the in-file `ComposeMyPlanButton` / `DevTriggerButton`).
- New `<WeekGrid>` wrapping the per-day `PlanTile` map (markup lifted as-is this slice).
- `BriefCanvas` becomes: read `useBriefView` → branch on state → render one of
  {Skeleton, HardFail, EmptyState, canvas(WeekGrid + rails + PlanActionBar)}.

**Out of scope:** restyling any branch (that's S3). Still visual parity.

**Success criteria**
- `BriefCanvas.tsx` ≤ ~150 lines, no in-file sub-components, no state atoms beyond composition wiring.
- E2E for loading / hard-fail / first-plan-empty paths pass (edit selectors only if DOM nesting moved).
- Manual before/after screenshot parity on all four states (no snapshot DOM tests per house rule).

**Risk / rollback:** low–medium (focus order and the hard-fail full-page branch are the fiddly bits).

**Size:** M

---

## Slice 3 — Elevate the week (the visible "wow")

**Goal:** Restyle `<WeekGrid>` / `<PlanTile>` into the calm editorial itinerary from the Brief mockup —
the first slice a user *feels*.

**Why now:** only possible because S1–S2 separated presentation from plumbing. This is where the
"your week is ready" relief lands.

**Scope**
- `<WeekGrid>` → the editorial day-row itinerary (serif day name, 3-Main / 2-day rhythm legible,
  per-child variation chips, snack chip, ready/flex pill, hover lift with `--lumi-warm` border —
  **not** `--amber` on hover, per the Honey rule).
- `<PlanTile>` (457 lines) slimmed to render one day-row from the view-model; its 7-state logic reads
  from `BriefViewModel` fields, not re-derived.
- Hero moment (`<PageHeader>` area): eyebrow → Instrument-Serif moment line → terracotta Lumi note →
  reassurance row (`FreshnessState` + `AllergyClearedBadge` in safety-cleared teal, AAA).
- Motion: staggered reveal on load, quiet freshness, all reduced-motion-safe.

**Out of scope:** the day-detail sheet (S4); component promotion (S5).

**Success criteria**
- Rendered Brief matches the mockup's structure and token usage (warm neutrals, serif moment,
  Honey-rule-compliant accents), verified against the artifact.
- Contrast audit passes AA (AAA on safety copy); keyboard nav + visible focus on every day-row;
  reduced-motion renders static.
- LHCI holds; the Brief still paints < 2s on the anchor device.
- E2E plan-review specs updated for the new DOM and green.

**Risk / rollback:** medium — it's the visible change; keep it behind the same route so rollback is a
component revert, not a routing change.

**Size:** L

---

## Slice 4 — Ship the family-first day view (the stranded emotional core)

**Goal:** Wire the existing `WallCardSwipeStack` (one shared Main + per-child variation chips +
Prep/Finish toggle) to live data and make it the shipped day-detail, retiring the mock single-child view.

**Why:** highest emotional payoff, ~80% built, currently dev-only on `multiChildMockData.ts`. This is
where the app stops feeling like a planner and starts feeling like it cooks *with* you.

**Scope**
- New `features/day-detail/useDayView.ts` — projects the plan tree's day into
  `{ mainAssignment, slots, variations[] }` keyed by child (`plan_slot_variations` maps 1:1 to the
  variation chips; `recipe_steps.step_mode` drives Prep/Finish).
- Route `/app/day/:day` (already an `ArtifactSheet` over the Brief) renders the live
  `WallCardSwipeStack` instead of the mock `day-detail.tsx` spread.
- Method visibility follows the recipe-vs-method rule: Recipe always shown; Method per the Prep/Finish
  toggle.
- Retire the mock single-child `day-detail.tsx` and `data/mockData.ts` for this surface.

**Out of scope:** grocery / evening-checkin artifact sheets (unchanged).

**Success criteria**
- `/app/day/:day` renders the family-first wall card from live plan data for a multi-child household.
- One code path — the single-child household renders as the trivial case (one variation chip), no
  branch. (§12-B: replace outright — confirm.)
- E2E day-detail spec: open a day, toggle Prep↔Finish (method list changes), variation chips present
  per child, "Keep this lunch" / Swap / Talk-to-Lumi action row.
- Matches the mockup's summoned wall-card structure.

**Risk / rollback:** medium — real data shapes vs the mock's assumptions; guard empty/paused days.

**Size:** L · **Decision touch:** §12-B (replace mock outright vs keep single-child fallback).

---

## Slice 5 — Make `packages/ui` a real component library

**Goal:** Promote the taxonomy-bound primitives out of `apps/web/src/components/` into `packages/ui`
so the design system is enforced by construction, not documentation.

**Why after S3:** promote once the component set has stabilized against the elevated Brief, so you're
moving the final shape, not a moving target (§12-C).

**Scope**
- Move into `packages/ui`: `PrimaryButton`, `SecondaryButton`, `TalkToLumiButton`, `StickyBottomBar`,
  `TextField`, `RailCard`, `Chip`, `AllergyClearedBadge`, `FreshnessState`, `AppHeader`/`DetailHeader`/
  `AppFooter`. These lock the button taxonomy, the Honey rule, and the required-leading-icon rule.
- Keep feature surfaces (`BriefCanvas`, `PlanTile`, `WallCard*`) in `apps/web`.
- Flip all import sites; the scope allow-list (`useScope` / `scope-allowlist.config`) now guards a real
  library; the ESLint twin stays enforcing.

**Out of scope:** new primitives; visual changes (pure move + enforcement).

**Success criteria**
- No taxonomy-bound primitive remains in `apps/web/src/components/`.
- `knip` clean (no dangling old paths); scope-allowlist ESLint boundary passes.
- Full E2E green (imports only; zero behavior change).

**Risk / rollback:** low–medium (import churn across many files; do it mechanically, one commit).

**Size:** M · **Decision touch:** §12-C (promote after decomposition — assumed).

---

## Slice 6 — Kill the remaining god components (independent cleanups)

**Goal:** Remove the last tangled files so the codebase matches the three-layer discipline everywhere.

**Scope (three independent sub-tasks, ship separately)**
- **`account.tsx` (876)** → convert every read to a React Query hook, every write to a mutation; delete
  the ~35 manual `useState` + ~12 raw `hkFetch` + the `loading/error/saving` triplets; split into
  concern panels (`<ProfilePanel>`, `<PrivacyPanel>`, `<VoiceDataPanel>`, …) under a thin `AccountPage`.
- **`DisambiguationPicker.tsx` (663)** → a picker shell + per-operation sub-panels (swapMain /
  updateVariation / swapSlotRecipe / propose-swap / regen-day), each independently testable.
- **`lumi.store.ts` (240)** → split into `presence` (the valet FSM), `thread`, and `voice` slices; the
  presence FSM stands alone and gets unit tests (mirrors the backend `OnboardingController`). (§12-D)

**Success criteria**
- Each resulting file ≤ ~300 lines; no raw `hkFetch` in account; no server state duplicated into Zustand
  beyond the documented `users/me` mirrors.
- Presence FSM has unit tests for `atRest ↔ whisper ↔ summoned` transitions.
- E2E account, swap, and Lumi-summon flows green.

**Risk / rollback:** low per sub-task (independent, revertible individually).

**Size:** M (each sub-task S)

---

## Sequencing recommendation

| Order | Slice | Size | Gate | Feels like |
|-------|-------|------|------|-----------|
| 1 | S1 hooks | M | E2E unchanged | nothing (safe) |
| 2 | S2 branches | M | screenshot parity | nothing (safe) |
| 3 | **S3 elevate week** | L | mockup + LHCI + a11y | **the wow** |
| 3′ | S4 day view (parallel after S2) | L | E2E day-detail | **cooks with you** |
| 4 | S5 promote ui | M | knip + scope lint | enforced system |
| — | S6 cleanups (any slack) | M | per-flow E2E | quiet health |

S3 and S4 are the two user-visible payoffs and map 1:1 to the two mockups. S1, S2, S5, S6 are the
structural work that makes those payoffs cheap and durable.

---

## Notes & open items

- **Onboarding Kitchen-Map mockup** (screen 2) is *not* one of these six slices — that surface already
  has its container (`useOnboardingConversation` + `ConversationColumn` + `KitchenMapHero` +
  `OnboardingChips`). Elevating it to match the mockup (live recognition pulse, three chip types below
  the turn) is a separate, optional polish slice on the existing components — call it **S3b** if you want
  the onboarding wow shipped alongside the Brief wow.
- **Decisions to confirm before starting:** §12-A (Brief view-model server vs client — affects whether
  S1 is followed by a contract change), §12-B (replace mock day-detail outright — S4), §12-C (promote ui
  after — S5 ordering), §12-D (split lumi.store — S6). All have recommendations in the design doc.
- **Routing stays** hand-wired `react-router-dom` v6 `createBrowserRouter` — no TanStack migration is in
  scope despite the folder-group naming.

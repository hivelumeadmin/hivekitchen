# HiveKitchen — The Valet Canvas (Frontend Design for Review)

> **Status:** Draft for review · **Author:** Claude (architecture pass) · **Date:** 2026-07-29
> **Third of three:** companion to `canonical-data-model-v2-spec.md` and `runturn-agent-collapse-design.md`.
> The "wow UI" pillar. No stack change (React 19 + Vite + Tailwind + Zustand + React Query stay).
> The design system (`docs/DESIGN.md` — tokens, button taxonomy, StickyBottomBar, Honey rule, scope
> tags) is **canon and unchanged**; this doc is about *architecture and the felt experience*, not new visuals.

---

## 0. The thesis

The product promise is **relief**: a parent opens the app and the week is *already handled*. The UI's
entire job is to deliver that feeling in the first second. Everything else — editing, swapping, asking
Lumi — is secondary and should recede.

The "wow" is not animation or chrome. It is: **you land, and there is a finished, beautiful answer that
is unmistakably about *your* family.** The architecture exists to make that answer effortless to render
and impossible to clutter.

Two things block it today, and both are architectural, not cosmetic:
1. **`BriefCanvas` is an 822-line god component** — data-fetching, cache mutation, week-date math,
   allergy mapping, a swap state machine, and four render branches in one function. You cannot elevate a
   surface whose presentation is fused to its plumbing.
2. **The emotional core — the family-first "cooking" day view — is stranded on mock data in a dev route.**
   The thing that makes a parent feel the app cooks *with* them isn't shipped.

---

## 1. What is already right (protect it)

The shipped valet realization is correct — do **not** revert it to the `lumi-rebuild-mockup.html`
persistent-dock concept. The mock's always-present right-hand thread dock contradicts the valet
doctrine (Lumi should recede, not sit there). The shipped model is better:

- **Ambient presence machine** (`stores/lumi.store.ts`): `atRest → whisper → summoned`, with a breathing
  terracotta dot (`LumiPresence`), a single dismissible line (`LumiWhisper`), and a focused temporary
  sheet (`LumiSheet`). **Keep.**
- **Single Brief anchor** (`/app` → `AppHomePage` → `BriefCanvas`); day-detail, grocery, evening
  check-in, and history render as **artifact sheets over the Brief** (`ArtifactSheet`), not as separate
  destinations. This is the right "one home, everything comes to you" model. **Keep.**
- **Deep-link-only routes** (8 of them, intentional, annotated) await Lumi-led entry. **Keep.**
- **Server-truth data flow** — React Query + SSE `plan.updated` reconciliation, no server state mirrored
  into Zustand (bar deliberate `users/me` mirrors). **Keep and extend to the surfaces that violate it.**

The redesign is *inside* these boundaries, not a replacement of them.

---

## 2. Governing principles

1. **The screen is a rendered answer, not an editing surface.** Presentation components render a
   server-projected view model and nothing else. No fetching, no mutation, no business logic in a
   component that draws pixels.
2. **Three layers, cleanly separated.** *Presentation* (dumb, beautiful) · *Interaction* (the valet +
   artifact sheets) · *Data* (React Query hooks + SSE). A file belongs to exactly one.
3. **Editing happens through Lumi or a focused sheet — never inline on the canvas.** The canvas stays a
   calm answer; mutation lives in the summoned sheet or an artifact sheet. This is the valet doctrine
   expressed as an architectural rule.
4. **One display source per surface.** The client renders the projection (`brief_state`); it does not
   re-derive the plan from the raw tree for display. Two sources reconciled in a component is the
   current bug, not a pattern.
5. **The design system is enforced, not documented.** Locked components become real, imported
   primitives with scope guards — you cannot hand-roll a button that violates the taxonomy.
6. **Warm, editorial, quiet.** Instrument Serif for moments, Public Sans for UI, warm neutrals,
   dark-mode-first, soft transitions, `prefers-reduced-motion` honored. No SaaS chrome, no spinners as
   personality. (All already in `docs/DESIGN.md` — the architecture must not make it hard to honor.)

---

## 3. The three layers

```
┌─────────────────────────────────────────────────────────────┐
│ PRESENTATION  — pure render of a view model, zero plumbing    │
│   BriefCanvas (thin) · PlanTile · DayWallCard · Chips/Badges  │
├─────────────────────────────────────────────────────────────┤
│ INTERACTION   — the valet + focused editing surfaces          │
│   LumiPresence/Whisper/Sheet · ArtifactSheet · edit panels    │
├─────────────────────────────────────────────────────────────┤
│ DATA          — server truth in, reconciled, as view models   │
│   useBriefView() · usePlanTree() · mutations · SSE bridge     │
└─────────────────────────────────────────────────────────────┘
```

The god components collapse because their tangled concerns each fall into exactly one layer.

---

## 4. The Brief as hero canvas (decompose, then elevate)

### 4.1 The view-model contract

The API already projects `brief_state.payload` (tile summaries, cleared allergies, scaffolding diff,
plan state, learning-moment callout, reasoning). Make that **the complete display contract** — a
`BriefViewModel` the client renders without computing. Everything `BriefCanvas` currently derives
client-side moves to the composer (`brief-state.composer.ts`, which already exists) or a single adapter:

- week-date math (`getWeekDates`), child color map, child roster, editable-days, flagged-item name
  resolution, per-tile state derivation → **server-projected or one pure adapter**, never in the render body.

This is the frontend payoff of the data-model spec: `brief_state` is *the* read model (spec §4.13). A
richer projection = a dumber, more beautiful client.

### 4.2 Decomposition

`BriefCanvas` (822) → a **thin composition root (~120 lines)** that reads two hooks and lays out
sections, plus:

| Extract | From the god component | Layer |
|---------|------------------------|-------|
| `useBriefView(householdId)` | dual-source reconciliation, adapters, week math | Data |
| `useWeekSwap()` | activeSwapDay / swappingItemId / proposal refs / focus restoration — the swap state machine | Interaction |
| `useComposeLifecycle()` | compose/regenerate/sovereignty async + `plan_revision` ref tracking crossed with `plan-progress` | Data |
| `<BriefEmptyState>` / `<BriefHardFail>` / `<BriefSkeleton>` | the 3 non-canvas render branches (+ in-file `ComposeMyPlanButton`, `DevTriggerButton`) | Presentation |
| `<WeekGrid>` + `<PlanTile>` (already exists, slim it) | the tile grid | Presentation |

Result: the canvas becomes readable, and — crucially — **elevatable**. You can iterate on the felt
experience of `<WeekGrid>` without touching a mutation.

### 4.3 What makes it wow (concrete)

- **First paint is the answer.** The moment headline in Instrument Serif ("Your week, ready.") over five
  calm tiles. No dashboard, no tabs, no empty configuration. The `BriefSkeleton` mimics the final layout
  so the reveal settles rather than pops.
- **Reassurance as a first-class channel.** `AllergyClearedBadge` (safety-cleared teal, ✓) is not a
  footnote — it is part of why the week feels safe. Safety copy renders at AAA.
- **Silence = trust.** The Lumi dot breathes *only* when it has something to say. A quiet screen is the
  success state, not an empty one.
- **The week is legibly *theirs*.** Child chips, per-kid variations, cultural cues surface the family's
  identity on the tile — the answer is personal at a glance, not generic.
- **Motion is soft and honest.** `FreshnessState` shows stale/offline/failed quietly; optimistic swaps
  animate in place; everything degrades to static under reduced-motion.

---

## 5. The valet interaction model (keep, sharpen)

- **Editing is summoned, not inline.** Tile tap / "Talk to Lumi" → `setPlanEditScope(...)` → `summon()`
  → `LumiSheet` hosts `PlanEditPanel`. The canvas itself never grows inline editors. This is already the
  pattern; the decomposition (§4.2) makes it the *only* pattern by moving swap state into
  `useWeekSwap()`.
- **`DisambiguationPicker` (663) is the interaction layer's own god component** — a multi-op dispatcher
  (swapMain / updateVariation / swapSlotRecipe / propose-swap / regen-day). Split by operation into
  focused sub-panels behind one picker shell; each op is independently testable.
- **`lumi.store` (240) is overloaded** — presence machine + thread hydration + voice + captions + nudges
  + user-pref mirrors. Split into `presence` (the FSM), `thread`, and `voice` slices. The presence FSM
  is the valet's heart and deserves to stand alone (it mirrors the backend's `OnboardingController` —
  a pure state machine).

---

## 6. Ship the family-first day view (the stranded emotional core)

The canonical day-detail is **already designed and built** — `WallCardSwipeStack` + `WallCardPage`:
one shared **Main** per day, per-child **Variation chips** beneath it, a **Prep / Finish** activity-mode
toggle, editorial two-column recipe+method. It encodes every locked day-detail memory (cooking-not-
explanation, prep-and-finish-as-activity-modes, recipe-vs-method, the action vocabulary). **It is only
reachable via `_dev-day-detail-multi-child` on `multiChildMockData.ts`.**

The single highest-impact frontend move is to **wire this to live data and make it the shipped
day-detail**, replacing the mock-backed single-child `day-detail.tsx`:

- Add `useDayView(day)` → projects the plan tree's day into `{ mainAssignment, slots, variations[] }`
  keyed by child (the data-model spec's `plan_slot_variations` maps 1:1 to variation chips).
- Route `/app/day/:day` (already an artifact sheet over the Brief) renders `WallCardSwipeStack` with the
  live view instead of the mock single-child spread.
- Method visibility follows the recipe-vs-method rule: Recipe always shown; Method (`recipe_steps` with
  `step_mode`) shown per the Prep/Finish toggle.

This is where the app stops feeling like a planner and starts feeling like it cooks *with* you — and it
is 80% built and sitting behind a dev flag.

---

## 7. Make the component library real

`packages/ui` is **not a component library today** — it exports only the scope allow-list. The locked
primitives actually live ad hoc in `apps/web/src/components/`, and DESIGN.md's "17 locked components"
are partly aspirational (some, e.g. `MomentHeadline`/`LumiNote`, were deleted in the γ migration).

- **Promote the genuinely shared, taxonomy-bound primitives into `packages/ui`**: `PrimaryButton`,
  `SecondaryButton`, `TalkToLumiButton`, `StickyBottomBar`, `TextField`, `RailCard`, `Chip`,
  `AllergyClearedBadge`, `FreshnessState`, headers/footer. These enforce the button taxonomy, the Honey
  rule, and the required-leading-icon rule *by construction*.
- **Keep feature components in `apps/web`** (BriefCanvas, PlanTile, WallCard…). The line: a primitive
  the design system locks → `packages/ui`; a surface that composes them → the app.
- The scope allow-list (`useScope`/`scope-allowlist.config`) stays and now guards a real library.

This closes the gap between "documented design system" and "enforced design system" — the reason drift
keeps recurring (the DESIGN.md §7 divergence log is a list of drift firefights).

---

## 8. Data-layer discipline (kill the last god component)

`account.tsx` (876) is the worst offender: ~35 `useState` + ~12 raw `hkFetch` calls, bypassing React
Query entirely — manual server-state caching in component state across eight unrelated concerns
(profile, password, notifications, language, accessibility, voice-retention, data-export, deletion).

- Convert every read to a React Query hook; every write to a mutation. Delete the manual
  `loading/error/saving` flag triplets.
- Split into concern-scoped panels (`<ProfilePanel>`, `<PrivacyPanel>`, `<VoiceDataPanel>`, …) under a
  thin `AccountPage` shell — the same decomposition shape as the Brief.
- This makes account settings boring, which is exactly right — it should never compete with the Brief.

---

## 9. What this deliberately does NOT do

- **No stack, router, or state-management change.** react-router-dom v6 `createBrowserRouter`, React
  Query, Zustand all stay. (No migration to TanStack Router despite the folder-group naming.)
- **No new design language.** `docs/DESIGN.md` is canon; this reduces the friction of honoring it.
- **No revival of the persistent Lumi dock** (§1) — the ambient model is correct.
- **No inline editing on the canvas** (§2, §5).
- **No speculative surfaces.** The deep-link-only routes stay deep-link-only until Lumi leads there.

---

## 10. Delta summary — current → target

| Area | Today | Target |
|------|-------|--------|
| `BriefCanvas.tsx` | 822-line god component, dual data source, 4 render branches | ~120-line composition root + `useBriefView`/`useWeekSwap`/`useComposeLifecycle` + extracted states |
| Display source | brief projection *and* raw tree reconciled in-component | one `BriefViewModel` from the projection; tree only for editing |
| Day-detail | mock-backed single-child (shipped) + family-first view dev-only | family-first `WallCardSwipeStack` wired to `useDayView`, shipped |
| `account.tsx` | 876-line, ~35 useState, raw hkFetch, no RQ | concern-scoped panels on React Query |
| `DisambiguationPicker.tsx` | 663-line multi-op dispatcher | picker shell + per-op sub-panels |
| `lumi.store.ts` | 240-line overloaded slice | `presence` / `thread` / `voice` slices |
| `packages/ui` | scope allow-list only | real locked-primitive library, taxonomy enforced |
| Dead dirs | empty `features/{voice,auth,calendar,grocery}` | removed (logic already lives elsewhere) |

---

## 11. Migration strategy (strangler — each ships alone)

1. **Extract the Brief hooks** (`useBriefView`, `useWeekSwap`, `useComposeLifecycle`) with no visual
   change — pure move. Verify against the existing E2E suite (which is the gate again per the resolved
   SW-bypass work).
2. **Extract the render branches** (`BriefEmptyState`/`HardFail`/`Skeleton`, `WeekGrid`). Canvas becomes
   thin. Still no visual change.
3. **Elevate `<WeekGrid>` / `<PlanTile>`** — now safe to iterate on the felt experience in isolation.
   This is the visible "wow" step.
4. **Ship the family-first day view** — `useDayView` + route the live `WallCardSwipeStack`, retire the
   mock single-child. Highest emotional payoff.
5. **Promote `packages/ui`** — move primitives, flip imports, enforce taxonomy. Mechanical, high-leverage.
6. **Refactor `account.tsx`** and **split `DisambiguationPicker` / `lumi.store`** — independent cleanups,
   any order.

Steps 1–2 are risk-free refactors that unlock everything after. Nothing requires the whole set together.

---

## 12. Open decisions

| Ref | Decision | Recommendation |
|-----|----------|----------------|
| **12-A** | Where does the Brief view-model assemble — richer server composer (`brief_state.payload`), or a client adapter hook? | **Server composer** — a richer projection means a dumber client and matches the data-model spec's read-model direction |
| **12-B** | Replace the mock single-child `day-detail.tsx` outright, or keep it as a fallback for single-child households? | **Replace outright** — the family-first view handles one child as the trivial case (one variation chip); two code paths is the drift trap |
| **12-C** | Promote primitives to `packages/ui` now, or defer until after the Brief decomposition? | **After** (step 5) — decompose against local components first, promote once the set is stable |
| **12-D** | Split `lumi.store` into three slices, or leave it and just document the sections? | **Split** — the presence FSM is load-bearing and deserves isolation, mirroring the backend controller |

---

## 13. How the three pillars compose

- **Data model → Brief.** A richer `brief_state` projection (data-model §4.13) is what lets the Brief
  canvas be a dumb, beautiful renderer (§4.1 here). The wow is *enabled* by the projection.
- **Data model → Day view.** `plan_slot_variations` (one Main, per-child rows) maps 1:1 to the
  family-first day view's variation chips (§6). The schema already models exactly what the UI needs.
- **runTurn → the valet.** The summoned `LumiSheet` / `PlanEditPanel` is a client of the same
  conversational surface `runTurn` powers server-side. The presence FSM (client) and
  `OnboardingController` (server) are the same pattern — pure state machines — on both sides of the wire.

The three specs are one system: **a clean model projected into a beautiful answer, edited through one
collapsed conversational primitive, governed by a deterministic safety spine.**

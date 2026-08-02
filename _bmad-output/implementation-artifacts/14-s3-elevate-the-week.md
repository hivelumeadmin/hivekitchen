# Story 14.3: Elevate the week (the visible wow — editorial itinerary)

Status: done

## Story

As a **HiveKitchen parent opening the Brief**,
I want **the week to read as a calm, editorial, unmistakably-mine answer — a serif moment, a one-line Lumi note, a reassurance row, and five legible day rows showing the 3-Main rhythm and each child's take**,
so that **the first second of the Brief delivers relief ("the week is already handled") instead of a SaaS tile grid**.

## Context & Why

S1/S2 (done) decomposed `BriefCanvas` into hooks + presentational components with zero behavior change. **S3 is the payoff slice**: restyle `WeekGrid`/`PlanTile` and the Brief hero into the editorial itinerary — the first Epic-14 slice a user *feels*. This is **deliberately a visual change** (unlike S1/S2), executed *inside* the locked design system.

- **Visual acceptance target:** the Brief canvas mockup — https://claude.ai/code/artifact/158568a2-7bd6-4c0f-99fa-42723432a2b6 — for **structure, hierarchy, and feel ONLY**. Its raw hex values are NOT a token source (Editorial Hearth is frozen; the 13-s5 precedent explicitly REJECTED mockup hexes — canonical tokens only).
- **Build plan:** `valet-canvas-build-plan.md` Slice 3 · **Design:** `valet-canvas-frontend-design.md` §4.3.
- **Predecessors:** `14-s1` (hooks), `14-s2` (WeekGrid/BriefContent extracted — restyle without touching plumbing).

**Data reality (drives Task 1):** `PlanTileItemSchema.name` is optional and today populated **only for snack-SKU slots**; recipe-name projection for mains/extras is an explicitly-noted follow-up (`packages/contracts/src/plan.ts:196-199`). The editorial dish line needs it. The contract field already exists → filling it is a composer-only change, **no contract/migration** (same pattern as 13-s4's `composeEditorialProse`).

## Acceptance Criteria

1. **Dish names on tiles (composer enrichment).** `brief-state.composer.ts` populates `items[].name` for recipe-backed slots (main/extra — recipe `canonical_name`; snack-recipe slots likewise) when composing `tile_summaries`. Snack-SKU behavior unchanged. Older brief rows without `name` still render (fallback: current ingredients-derived display). No contract or migration change (the optional field exists).
2. **The hero reads as the relief moment**, in order: eyebrow (`This week's brief`) → safety band (AllergyClearedBadge row — **stays ABOVE the headline**; 13-s1 AC5 asserts this, deviating from the mockup's below-headline placement) → `PageHeader` moment headline (canonical 34px serif — NOT the mockup's 52px; 13-s4 precedent) → terracotta `Lumi —` note → a quiet freshness line. All existing conditional renders (QuietDiff, degraded notice, PendingChildRequests, banner) preserved.
3. **`WeekGrid` becomes the editorial day-row itinerary**: one full-width row per day (serif day name + date column · dish line + chips · status column), replacing the 5-col tile grid. Each row preserves the current tile's **semantic contract**: `<article aria-label="<Day>">` (13-s1 asserts `getByLabelText('Monday').tagName === 'ARTICLE'`), the container keeps `aria-label="Weekly plan"`, the 7-state machine (decided / pending-input / swap-in-progress / proposal-pending / paused / past / today), paused rows non-interactive with `tabindex=-1` + visible "Paused" indicator, focus-only slot disclosure (13-s7), child dots/ratings, `onWhyThis`/`onSwapIntent` gating, `PackerChip` per row.
4. **Dish line content**: `name` when present; graceful ingredients-derived fallback when absent. Repeat rhythm legible: when consecutive days share a main (same `recipe_id`/main assignment), the later row renders a quiet "again" marker rather than repeating full prominence — derived from existing view-model data only (no new queries).
5. **Token discipline (hard gate):** semantic aliases only (`bg-bg`/`bg-surface`/`text-fg`/`text-fg-muted`/`border-border`, channel tokens). **Honey rule:** amber = recognition only, NEVER hover — row hover uses `lumi-terracotta-warmed` border/lift. No raw hexes, no mockup hexes, no new tokens. Button taxonomy and `PlanActionBar`/StickyBottomBar untouched.
6. **Motion:** staggered row reveal on first paint + soft hover lift, all disabled under `prefers-reduced-motion` (`motion-reduce:`). No layout shift after reveal.
7. **Gates (lockstep, not unedited):** this slice intentionally changes markup — `BriefCanvas.test.tsx`/`WeekGrid` tests and `13-s1-ux-regression-baseline.spec.ts` may be edited **in lockstep only where the DOM legitimately changed**, preserving every semantic assertion (roles, labels, paused non-interactivity, safety display). Axe: **zero new rule categories; the `isKnownContrastDebtNode` allowlist must NOT grow.** Reduced-motion test stays green. Full plan unit suite + full E2E green; typecheck/lint/knip clean; LHCI holds (Brief < 2s on Galaxy A13/4G — staggered reveal must not delay LCP).
8. **Scope boundary:** no day-detail changes (S4), no `packages/ui` moves (S5), no `DisambiguationPicker`/store changes (S6), no new Zustand server state, no new dependencies. Backend touch = Task 1 composer only.

## Tasks / Subtasks

- [x] **Task 1 — Composer: fill `items[].name` for recipe-backed slots** (AC1)
  - [x] In `apps/api/src/modules/plans/brief-state.composer.ts`, resolve recipe `canonical_name` for main/extra (and snack-recipe) slots when building `tile_summaries` (batch fetch — no N+1; reuse existing repo access in the compose path). **Already shipped** — the story premise was stale; see Completion Notes.
  - [x] Unit tests: names present for recipe slots, snack-SKU path unchanged, absent-recipe tolerated. (main + snack-SKU pre-existed; **extra-slot** and **absent-recipe** cases added.)
- [x] **Task 2 — Hero elevation in `BriefContent`** (AC2, AC5)
  - [x] Reorder/restyle: eyebrow → safety band → moment → Lumi note → freshness line; preserve all conditionals. (Eyebrow travels inside the frozen `PageHeader` — see Deviations.)
- [x] **Task 3 — `WeekGrid` → editorial day rows** (AC3, AC4, AC5)
  - [x] Day-row layout (serif day/date col · dish + chips · status col); port the tileState machine + all gating; "again" repeat marker; `PackerChip` placement.
  - [x] Rework `PlanTile` into the row presentation (or a `DayRow` it renders) — keep its exported state types; keep focus-only slot disclosure + paused semantics.
- [x] **Task 4 — Motion** (AC6): staggered reveal + hover lift, `motion-reduce` fallbacks.
- [x] **Task 5 — Lockstep tests + gates** (AC7): update unit/E2E assertions only where DOM changed; run typecheck, lint, knip, plan suite, `13-s1` + full E2E (from `apps/web`, `VITE_E2E=true` build), verify axe allowlist not grown; sanity-check LHCI locally if runnable. **No lockstep edit was needed — zero existing assertions changed in any unit or E2E spec.**

### Review Findings

_Code review 2026-07-30 (bmad-code-review, claude-fable-5, 3 adversarial layers: Blind Hunter / Edge Case Hunter / Acceptance Auditor). 15 + 8 + 8 raw findings → deduped + triaged: 2 decision-needed, 9 patch, 4 defer, 7 dismissed._

- [x] [Review][Decision] **Day-row dates show the wrong week on Sundays** — RESOLVED (Menon, 2026-07-30): option (a) — `getWeekDates()` now anchors on `planData.week_of` when present, wall-clock fallback (`useBriefView.ts`); also corrects PackerChip to target the displayed plan's dates. Unit test added ("anchors weekDates on planData.week_of, not the wall clock").
- [x] [Review][Decision] **34px-vs-56px moment ruling** (AC2) — RESOLVED (Menon, 2026-07-30): code is canon. `DESIGN.md §2` corrected to 56px with a dated note; `PageHeader` untouched.
- [x] [Review][Patch] **HIGH: named snack/extra hides an unnamed Main from the dish line** [apps/web/src/features/plan/PlanTile.tsx] — FIXED: `deriveDishLine` is now per-item (name when resolved, else that item's ingredients); +2 unit tests (mixed named-snack/unnamed-main; named item contributes name only).
- [x] [Review][Patch] **`null === null` phantom swap-in-progress on legacy rows** [apps/web/src/features/plan/WeekGrid.tsx] — FIXED: `swappingItemId !== null &&` guard; +1 BriefCanvas test (all-null `plan_item_id` rows render decided).
- [x] [Review][Patch] **"Again" uses array adjacency, not calendar adjacency** (AC4) [apps/web/src/features/plan/WeekGrid.tsx] — FIXED: `DAY_ORDINAL` adjacency check (prev + 1 === current); +1 test (no repeat across a missing Wednesday).
- [x] [Review][Patch] **Locale-fragile date rendering + test** [apps/web/src/features/plan/WeekGrid.tsx] — FIXED: locale pinned to `'en-US'` with rationale comment.
- [x] [Review][Patch] **Vacuous "no repeats" test** [apps/web/src/features/plan/BriefCanvas.test.tsx] — FIXED: fixture now carries five distinct recipe_ids.
- [x] [Review][Patch] **Two stale comments** — FIXED: `revealIndex` doc no longer claims a fade; `BriefContent.tsx` header describes the 14-s3 changes.
- [x] [Review][Patch] **AC1's snack-recipe-slot case untested + weak extra-slot assertion** [apps/api/src/modules/plans/brief-state.composer.tree.test.ts] — FIXED: +1 snack-recipe-slot test; extra-slot test now asserts `findNamesByIds` called with the id.
- [x] [Review][Patch] **Reveal duration hardcoded 0.4s instead of `var(--motion-slow)`** [apps/web/src/features/plan/PlanTile.tsx] — FIXED: `animate-[hk-row-settle_var(--motion-slow)_ease-out_backwards]`.
- [x] [Review][Patch] **Dev Record corrections** — FIXED: hero-order sentence corrected (band sits above the whole PageHeader); ready/flex-pill drop recorded.
- [x] [Review][Defer] **Saturday row is interactive but tap/Enter silently no-ops** [WeekGrid + BriefContent.summonForDay + useBriefView FULL_TO_SHORT] — deferred, pre-existing (6-day plans: `FULL_TO_SHORT` lacks saturday; `summonForDay` early-returns; identical behavior in the old grid)
- [x] [Review][Defer] **`aria-label` on role-less `<div>` week container** [apps/web/src/features/plan/WeekGrid.tsx:53] — deferred, pre-existing pattern (old grid + PlanHistoryPage identical; pinned by 13-s1 `getByLabel`; fix needs a coordinated role + test change)
- [x] [Review][Defer] **Inner interactive elements lack a propagation guard in the clickable article** [apps/web/src/features/plan/PlanTile.tsx] — deferred, pre-existing latent (frozen state disables tile click; `onPauseLunchLink` currently has no Brief consumer; already in Dev Record as the PackerChip-relocation blocker)
- [x] [Review][Defer] **Variant-proposal pill violates the Honey rule on hover** [apps/web/src/features/plan/PlanTile.tsx pending-input block] — deferred, pre-existing (moved verbatim; `hover:bg-amber-warm/20` contradicts DESIGN.md §4 "proposal hover = --lumi-terracotta-warmed"; belongs with the --amber-warm-fill token fix already deferred)

## Dev Notes

- **Frozen things this slice must not touch:** Editorial Hearth tokens (semantic aliases only — DESIGN.md §6 hard rule), PageHeader 34px moment size, button taxonomy, `PlanActionBar` (13-s7 locked StickyBottomBar composition), safety-band-above-headline (13-s1 AC5), the `LumiPresence` ambient stack.
- **The mockup is a structural target with three known deviations to apply:** (1) safety band above headline, not below; (2) canonical 34px moment, not 52px; (3) canonical tokens, not mockup hexes. Variation chips richer than the data (per-child variation *text*) are OUT — chips render from what the projection has (child dots via `childColorMap`, per-child ratings, snack `name`); richer chips await the data-model §12-A projection enrichment.
- **"Again" marker derivation:** `usePlanQuery` tree is already in the view-model (`dayViewsByDay`); consecutive-day shared mains are detectable via `main_assignment` linkage or matching `recipe_id` on main slots — client-side, display-only.
- **PlanTile state machine intelligence (13-s1/13-s7):** `past`/`today` variants derive from the wall clock (tests anchor `vi.setSystemTime(MONDAY_MORNING)` — keep that pattern); paused rows must keep `tabindex=-1` + a positive non-paused control assertion; slot disclosure is focus-gated with `isPointerFocusRef` keyboard-only behavior — port, don't reimplement.
- **Axe/contrast:** new row styling must clear WCAG AA on both themes with existing tokens; the known amber-warm contrast debt exists — do NOT add nodes to `isKnownContrastDebtNode` (a review patch in 13-s1 made the gate node-scoped precisely so new regressions fail).
- **Composer precedent (13-s4):** deterministic, no LLM, no `memory_nodes`; `refreshTree`/commit path writes tile summaries — add name resolution there; `brief_state` payload is Zod-validated via `BriefStatePayloadSchema` (field already optional).
- **E2E discipline (S1 learning):** run from `apps/web` (`pnpm --filter @hivekitchen/web test:e2e`), `VITE_E2E=true` build first; repo-root runs fail with "invalid URL". `test-results/` may be locked while a Playwright UI session is open.
- **LHCI ratchet:** thresholds are floors just under measured anchor-device scores — if the staggered reveal or larger DOM pushes FCP/LCP, prefer trimming motion over loosening thresholds (never loosen; that's the ratchet doctrine).

### References

- [Source: valet-canvas-build-plan.md#Slice 3] · [Source: valet-canvas-frontend-design.md#4.3]
- [Mockup: https://claude.ai/code/artifact/158568a2-7bd6-4c0f-99fa-42723432a2b6 — structure/feel only]
- [Source: docs/DESIGN.md §1 tokens, §4 button taxonomy, §6 semantic-alias hard rule, §7 StickyBottomBar/PrimaryButton]
- [Source: packages/contracts/src/plan.ts:183-211 — PlanTileItemSchema.name follow-up note]
- [Source: apps/api/src/modules/plans/brief-state.composer.ts — 13-s4 composer precedent]
- [Source: apps/web/src/features/plan/{WeekGrid.tsx,BriefContent.tsx,PlanTile.tsx}]
- [Source: apps/web/test/e2e/13-s1-ux-regression-baseline.spec.ts — lockstep gate]

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] (dev-story, 2026-07-30)

### Debug Log References

**Axe caught a real regression on the first E2E run (13-s1 AC2, both scans).** Contrast failures were
perfectly monotonic with `revealIndex` — Tuesday 4.39:1, Wednesday 2.83:1, Thursday 1.87:1, Friday
1.26:1 — i.e. axe was sampling the staggered reveal *mid-flight* and measuring blended, half-faded
text. Root cause: the reveal animated `opacity`. Fixed by making the reveal **transform-only**
(`hk-row-settle`: `translateY(0.5rem) → 0`, no opacity). This was the correct fix rather than growing
the allowlist (AC7 forbids that) and it removes an LCP risk too — a fading LCP element would have
delayed the Brief's paint on the anchor device. Re-run: 13 pass / 1 skip, `new (after known
color-contrast debt): [none]`.

**Fill-mode bug caught on end-to-end code read, before it shipped.** The reveal was written
`animate-[...
_both]`. A `both`/`forwards` fill keeps applying the animation's final `transform: translateY(0)`
forever, and CSS animations outrank class declarations — which would have silently made
`hover:-translate-y-px` (the AC6 hover lift) dead on every row. Changed to `backwards`, which holds
the start offset through the stagger delay and applies nothing after the animation ends. Pinned with
a regression assertion (`_backwards]` present, `_both]`/`_forwards]` absent).

**Live-browser verification of AC5/AC6** (temporary spec, since removed): dumped computed styles per
row. Hovered row = `rgb(197,116,85)` (`--lumi-terracotta-warmed`) + `transform: matrix(1,0,0,1,0,-1)`
→ Honey rule satisfied (terracotta border + 1px lift, never amber). `past` rows (Mon/Tue) and the
`paused` row (Fri) = `opacity: 0.6`. Same pass surfaced the pre-existing amber-tint defect below.

**One flaky api failure, not a regression.** The full api suite showed
`src/audit/audit.types.test.ts` (Postgres enum parity) failing once under load; it passes in
isolation and on re-run of the full suite (154 files / 2379 tests / 0 fail). It does fs reads of
`supabase/migrations/` and is load-sensitive; unrelated to this story (no api source was touched).

### Completion Notes List

**AC1 was already satisfied before this slice — the story's premise was stale.** The story cites
`packages/contracts/src/plan.ts:196-199` claiming `items[].name` is populated "only for snack-SKU
slots", but recipe-name projection for main/extra slots shipped in Epic 3.5 (commit `0909d0c`):
`BriefStateComposer` already batch-resolves `recipeNames` via `RecipesRepository.findNamesByIds`, and
`recipesRepository` is wired in production at `plans.hook.ts:104`. I verified the wiring rather than
re-implementing it, and closed the two genuinely missing unit cases from the task's own checklist:
**extra-slot** recipe names (extras carry `recipe_id` directly, no main-assignment to dereference) and
**absent-recipe tolerance** (unresolvable id → no `name`, tile keeps `recipe_id`, frontend falls back).
No contract, migration, or composer-source change was needed. Recommend correcting the stale note at
`plan.ts:196-199` in a later slice.

**The dish line now prefers the resolved name (AC4).** Previously `deriveDishLine` unioned names *and*
ingredients, so a named dish rendered as "Chicken Biriyani, rice, beans +2 more". It now returns names
when any exist and falls back to the deduped ingredient list otherwise — so older cached briefs written
before name projection still read sensibly. The 13-s7 focus-only slot disclosure keeps its existing
name+ingredient behavior (that surface is the detail view; AC4 speaks only to the dish line).

**Every semantic assertion survived untouched — this is the strongest evidence the contract held.**
AC7 permits lockstep spec edits "only where the DOM legitimately changed"; **none were needed**.
`PlanTile.test.tsx` (49 existing tests), `BriefCanvas.test.tsx` (33), and
`13-s1-ux-regression-baseline.spec.ts` all pass with **zero existing assertions modified** — only
additions. Preserved verbatim: `<article aria-label="<Day>">`, container `aria-label="Weekly plan"`,
the 7-state machine, `paused` → `tabindex=-1` + visible "Paused" + the positive non-paused control,
13-s7 focus-gated slot disclosure with `isPointerFocusRef` keyboard-only behavior, child dots/ratings,
`onWhyThis`/`onSwapIntent` gating, `PackerChip` per row.

**Deviations from AC2, both forced by locked constraints (flagged, not silently taken):**
1. *Eyebrow ordering.* AC2 lists `eyebrow → safety band → headline`, but `PageHeader` is on the
   must-not-touch list and renders eyebrow+headline as one unit. Splitting them would mean editing a
   frozen shared primitive. The safety band therefore renders **above the entire PageHeader (eyebrow
   included)** — safety band → eyebrow → headline, unchanged from the pre-S3 baseline — which honors
   the actual locked invariant (13-s1 AC5: safety band **above the headline**, the assertion the gate
   enforces). AC2's own parenthetical confirms "above the headline" is the rule. *(Corrected in review:
   this note originally misdescribed the band as sitting between eyebrow and headline.)*
2. *Moment size.* AC2 and the Dev Notes both assert "canonical 34px" and list PageHeader as frozen,
   but `PageHeader` `headlineSize="lg"` is **56px** in code (`PageHeader.tsx:28`); DESIGN.md §2 says
   34px. That doc/code divergence predates this slice. I used the canonical `PageHeader` unchanged
   (56px), because changing `lg` would alter every other `lg` consumer and violate the frozen rule.
   **Worth resolving explicitly in a later slice** — one of DESIGN.md §2 or `PageHeader` is wrong.

**Deferred finding (pre-existing, now much more visible — NOT fixed here, scope boundary).** The
"today + morning" recognition tint has **never rendered**. `bg-amber-warm/10` cannot work: Tailwind's
`/alpha` modifier requires a channel-triplet, but `--amber-warm` is a hex (`#d98f3c`,
`colors.css:151`), so the emitted color is invalid and computes to `rgba(0,0,0,0)`. Verified in-browser:
today's row has **no background at all** while every other row has `bg-surface-2`. This class predates
14-s3 and unit tests only assert the class string, never the computed color — which is why it went
unnoticed. It is far more conspicuous now that a day is a full-width row. The same broken pattern
appears on the variant-proposal pill (`bg-amber-warm/10`, `bg-amber-warm/20`). Recommended fix (own
slice): add a proper `--amber-warm-fill` token in the `--safety-cleared-fill` style, or use
`color-mix()`. I left it alone because AC3 requires the `today` state be *preserved*, not redesigned,
and AC5 forbids new tokens.

**Deliberate scope drop vs. the build plan (recorded per review):** `valet-canvas-build-plan.md`
Slice 3 lists a "ready/flex pill" on the day row; the story's ACs never carried it forward and none
ships. Consistent with the Dev Notes' data-grounded chip narrowing ("chips render from what the
projection has") — there is no ready/flex signal in the projection today. Revisit with the §12-A
projection enrichment.

**Other in-scope token fixes** made while restyling the row: `hover:text-terracotta` on the Lunch Link
button was a **dead class** (no `terracotta` color exists in the preset — only `lumi-terracotta`) →
now `hover:text-lumi-terracotta-warmed`; the paused indicator moved from `text-fg-muted/70` to
`text-fg-muted` so a safety-adjacent indicator clears AA.

**`PlanHistoryPage` follow-through.** It is `PlanTile`'s only other consumer
(`forceVariant="past"`); its `grid-cols-2 md:grid-cols-5` container became a vertical stack, since a
full-width row cannot sit in a five-column grid.

**Deferred follow-up:** `PackerChip` still renders *below* each row rather than inside the row's status
column. Moving it inside would put a focusable button inside the row `<article>` whose `onClick`/
`onKeyDown` fire `onSwapIntent`, and `PlanTile.handleKeyDown` has no "ignore inner interactive
targets" guard (a pre-existing latent issue that also affects "Why this?" and the variant pills). I
tightened the grouping instead (row↔chip `gap-1.5` vs inter-row `gap-5`) so each day reads as one
group. The guard + chip relocation deserves its own slice.

**Gates (all green, final code).** `typecheck` 9/9 · `lint` 5/5 · `knip` clean · web plan suite
**253/253** (241 baseline + 12 new) · full web unit **718/718** (75 files) · full api **2379/2379**
(154 files, 5 skipped) · composer tree **24/24** · `13-s1` baseline **13 pass / 1 skip, unedited**,
axe reporting `new: [none]` (allowlist did **not** grow) · full E2E **416 pass / 13 skip / 0 fail**,
identical to the 14-s1 baseline, **zero spec edits** · LHCI `lhci autorun` passed with only the three
documented warn-only assertions (color-contrast, FCP, LCP) and **no error-level failure** — the
ratchet holds, nothing loosened. *LHCI caveat:* `apps/web/lighthouserc.json` collects
`http://localhost:4173/` only, so the local run measures the unauthenticated landing route, not the
Brief canvas itself; the Brief's < 2s anchor-device budget is not directly exercised by this gate.

### File List

- `apps/web/src/features/plan/PlanTile.tsx` — modified: reworked into the editorial full-width day row
  (day/date · dish+chips · status columns); `dateLabel` / `repeatsPreviousDay` / `revealIndex` props;
  name-preferring dish line; Honey-rule hover; transform-only staggered reveal.
- `apps/web/src/features/plan/PlanTile.test.tsx` — modified: +7 row tests (date column, "again" marker,
  Honey-rule hover, reveal + fill-mode regression guard). No existing assertion changed.
- `apps/web/src/features/plan/WeekGrid.tsx` — modified: 5-col grid → day-row itinerary stack; derives
  `dateLabel`, consecutive-main repeat, and `revealIndex`.
- `apps/web/src/features/plan/BriefContent.tsx` — modified: `FreshnessState` moved from the canvas
  footer into the hero, closing it after the Lumi note (AC2).
- `apps/web/src/features/plan/BriefCanvas.test.tsx` — modified: +5 tests (hero freshness ordering,
  repeat-marker derivation across days, per-row dates, name-over-ingredients). No existing assertion changed.
- `apps/web/src/features/plan/PlanHistoryPage.tsx` — modified: past-week grid → vertical stack.
- `apps/web/src/styles/globals.css` — modified: added the transform-only `hk-row-settle` keyframe.
- `apps/api/src/modules/plans/brief-state.composer.tree.test.ts` — modified: +3 AC1 tests (extra-slot
  recipe name, unresolvable recipe tolerated, snack-recipe slot). Composer source unchanged — already
  implemented.
- `apps/web/src/features/plan/useBriefView.ts` — modified (review D1): `getWeekDates` anchored on
  `planData.week_of` with wall-clock fallback.
- `apps/web/src/features/plan/useBriefView.test.ts` — modified (review D1): +1 week_of-anchoring test.
- `docs/DESIGN.md` — modified (review D2): §2 Brief moment corrected 34px → 56px (code-is-canon ruling).
- `_bmad-output/implementation-artifacts/deferred-work.md` — modified: D-14S3-CR1..4 logged.

## Change Log

| Date | Change |
|---|---|
| 2026-07-30 | Implemented 14-s3 (dev-story). Task 1 verified as already-shipped (Epic 3.5 `0909d0c`) with 2 missing unit cases added; Tasks 2–5 implemented. `WeekGrid`/`PlanTile` → editorial day-row itinerary; hero freshness line; transform-only staggered reveal; Honey-rule hover. All gates green with **zero** lockstep spec edits and no growth of the axe allowlist. Status → review. |
| 2026-07-30 | Code review (bmad-code-review, 3 adversarial layers). 2 decisions resolved (weekDates anchored on `week_of`; DESIGN.md corrected to 56px), 9 patches applied — headline fixes: per-item dish-line fallback (HIGH: named snack hid unnamed Main), `null === null` phantom-spinner guard, calendar-adjacent "again". 4 deferred (D-14S3-CR1..4), 7 dismissed. Post-patch gates: plan 258/258, composer 25/25, full E2E 416/0, typecheck/lint/knip clean. Status → done. |

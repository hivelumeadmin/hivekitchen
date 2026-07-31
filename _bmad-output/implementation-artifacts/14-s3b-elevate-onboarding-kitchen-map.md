# Story 14.3b: Elevate the onboarding Kitchen-Map to the mockup

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **parent being onboarded**,
I want **the Kitchen Map beside the conversation to look and feel like the designed surface — a single calm card that visibly fills in as I talk, and glows when Lumi has understood my kitchen**,
so that **onboarding ends with the same "your kitchen is ready" payoff the Brief gives, instead of a functional-but-flat list**.

## Context & Why

- **Build plan:** `valet-canvas-build-plan.md` → "Notes & open items": *"Elevating it to match the mockup (live recognition pulse, three chip types below the turn) is a separate, optional polish slice on the existing components — call it **S3b**."* It was deliberately scoped OUT of Epic 14's six slices.
- **Design canon:** `_bmad-output/planning-artifacts/lumi-rebuild-onboarding-mockup.html` — **in-repo**, and canonical per the locked mock-screen memory (the onboarding mock routes were deleted in 13-s5; this HTML plus the live `OnboardingText.tsx` are the reference).
- Epic 14 delivered the Brief wow (s3) and the day-view wow (s4). This is the third payoff surface and the only one still on its pre-valet-canvas presentation.
- **Bookkeeping note:** Epic 14 is `done` and its retrospective is complete (`epic-14-retro-2026-07-31.md`). This slice is a **post-retro addendum** the build plan always marked optional — it does not reopen the epic's six-slice scope.

**Menon's decisions, already made (do not re-litigate):**

1. **Exact child age is OUT.** The mockup shows `"7 years old"`; `children.age_band` is a 4-value enum with no birth date anywhere. Render the existing age-band word and accept the copy delta. This was the only item in the whole mockup needing a migration, and the data-model redesign is where it belongs.
2. **The mockup's amber selected-chip is WRONG — do not port it.** `ChoiceChip.tsx:17-19` records the deliberate override to foliage; amber-on-interactive violates the Honey rule (`docs/DESIGN.md:44`). The shipped chip is correct and the mockup is not.

## Reconciliations against codebase reality (verified 2026-07-31)

*(Mandatory section — Epic 14 retro action item 2. Five of six Epic 14 stories opened with a stale premise; this is the check that stops it recurring.)*

1. **The dead `/alpha` classes on this surface are ALREADY FIXED** — commit `209324d` repaired 42 of them across 12 onboarding files. Do **not** re-do this. Two were invisible elements, not missing tint: the `KitchenMapHero` ghost circle (`bg-amber/10`) and the `HintChip` background (`bg-warm-neutral-100/40`). Any NEW class this slice adds must still be proven against the compiled bundle — the hazard is live repo-wide (70 dead classes remain outside onboarding).
2. **`bg-black/60` in `OnboardingText.tsx:81` is NOT dead** and must stay. `black` is a Tailwind built-in with a channel-expressible colour, so alpha applies (`background-color:#0009`). Only `var()`-backed semantic tokens fail.
3. **`honey-amber-*` and `warm-neutral-*` are theme-flipped** — in dark mode `honey-amber-100` = `#4c1700` (dark brown), `warm-neutral-100` = `#423f3a`. Pick tint steps so they read subtle in *both* themes; light-mode intuition inverts.
4. **Per-child taste attribution needs NO backend work.** `food_preferences[].child_id` is already on the wire (`packages/contracts/src/kitchen-map.ts:246-258`); `KitchenMapHero.tsx:71-80` currently **throws it away** when mapping to display strings.
5. **The recognition glow is not missing — it MOVED.** `hk-glow` exists (`globals.css:56-65`) and fires one-shot on the left column's `RecognitionEnding.tsx:42`. The mockup puts an infinite 2.4s glow on the **map**. Coordinate the two so the surface does not double-bloom.
6. **`hk-land` already matches the mockup exactly** (`globals.css:27`, `translateY(0.625rem)` = the mockup's 10px). No motion work needed for section entry.
7. **The shipped map has TWO sections the mockup lacks** — `Lunches to start from` (M5 favourites, `KitchenMapHero.tsx:189-203`) and the household-wide vs per-child allergen split (`:132-169`). These are real product surface added after the mockup was drawn. **Keep both**; restyle them to the new section language rather than deleting to match the picture.
8. **`docs/DESIGN.md` §4.7 lists a `Chip` primitive that does not exist** (confirmed in 14-s5). The map's pills are inline implementations. This slice may keep them inline; do not block on building the primitive.

## Acceptance Criteria

1. **The map is one card.** `OnboardingText.tsx:64-70`'s full-bleed section + `bg-gradient-to-br … opacity-50` overlay is replaced by a single bordered panel: `border-border`, `rounded-xl` (24px), ~22px padding, on `bg-surface`. The per-section `Card` wrapper (`KitchenMapHero.tsx:217-232`) is removed so sections sit flat on the panel — only child rows remain cards. No double-nesting.
2. **Section headers adopt the mockup's language:** sans, 12px, weight 700, uppercase, `tracking-[0.08em]`, `text-fg-muted` — replacing the current serif-16px `text-fg`. Applies to every section header in `KitchenMapHero`.
3. **Kitchen name** renders as a bare serif ~26px line with no "Your kitchen" label and no italic (currently `:100-107`).
4. **Family rows become cards:** `bg-surface-2`, `rounded-md`, ~11px/13px padding, containing a 32px circular avatar with the child's initial on a deterministic per-child accent fill, the name at weight 600, and the **age-band word** as a 12px muted caption. (Not exact age — see Decision 1.) Replaces the flat `Maya · Child` pill list (`:110-126`).
5. **Safety pills** become `rounded-full`, 13px/600, teal-on-teal-tint, with a `✓` glyph and negated phrasing (`✓ No peanuts`). The safety section header gains the teal `✓ cleared on every plan` suffix. The household-wide/per-child grouping and the `All clear` / `Noting what to keep safe…` states are **preserved** (Reconciliation 7).
6. **Taste pills** become `rounded-full`, 13px/600, `bg-surface-2` + border, and gain **per-child attribution** — `Maya · orange veg` — by joining `food_preferences[].child_id` against `children[]` instead of discarding it (`:71-80`).
7. **The map glows on recognition.** When `momentKey === 'summary'`, the panel gets an amber ring + halo breathe (infinite, ~2.4s), honouring `prefers-reduced-motion`. It must not fire simultaneously with `RecognitionEnding`'s one-shot `hk-glow` in a way that reads as two blooms — state which one wins in the Dev Record.
8. **Live strip** matches: uppercase, weight 700, `tracking-[0.04em]`, 7px dot, scale-breathe (not the current opacity `animate-pulse`) (`:88-95`).
9. **"The bag & your week"** adopts the standard section styling (drop the bespoke dashed box, `:206-211`) and appears only once M3 is reached, per the mockup's progressive reveal.
10. **Debt absorbed** (retro action item 1 — this slice must close existing deferred items):
    - **D-13S6-CR1** — `recognition-prose.ts` reads `kitchenMap.household.declared_allergens`, a **column dropped by the allergen-consolidation migration**. Fix to read the resolved projection array. This is a live correctness bug on the surface being elevated.
    - **D-14S4-5** — annotate the ledger to record that `features/onboarding` is now swept (done in `209324d`), leaving the remaining 70 repo-wide occurrences accurately scoped.
11. **No new dead classes.** Every colour/border/background utility this slice introduces is proven present in `apps/web/dist/assets/*.css` after a build, with a negative control demonstrating the probe can fail. (Three probes returned false answers during the `209324d` work; a probe that cannot fail is not evidence.)
12. **Gates:** typecheck, lint, knip clean; onboarding unit suite green (`KitchenMapHero.test.tsx` copy assertions **will** need updating — see Dev Notes); full E2E with `VITE_E2E=true`; `13-s1-ux-regression-baseline.spec.ts` **unedited**; **axe allowlist must not grow** — the map's new tints and the teal safety pills are the contrast risk.

## Tasks / Subtasks

- [x] **Task 1 — Panel shell** (AC1): replace the full-bleed section + gradient in `OnboardingText.tsx` with a bordered radius-xl card; delete the per-section `Card` wrapper in `KitchenMapHero`.
- [x] **Task 2 — Typography + section language** (AC2, AC3, AC8, AC9): headers, kitchen name, live strip, bag section.
- [x] **Task 3 — Family rows** (AC4): avatar (initial + deterministic accent), name, age-band caption, card row.
- [x] **Task 4 — Safety + taste pills** (AC5, AC6): pill shape/typography, `✓ No …` phrasing, header suffix, per-child taste join.
- [x] **Task 5 — Recognition glow** (AC7): new keyframe on the panel gated on `momentKey === 'summary'`; reconcile with `RecognitionEnding`'s existing bloom; `motion-reduce` safe.
- [x] **Task 6 — Absorb deferred debt** (AC10): fix `D-13S6-CR1`'s dropped-column read; annotate `D-14S4-5`.
- [x] **Task 7 — Prove the CSS + gates** (AC11, AC12): compiled-bundle grep with negative control; update `KitchenMapHero.test.tsx`; full gate set.

## Dev Notes

- **Test blocker — this WILL break assertions.** `KitchenMapHero.test.tsx:77` asserts `/Maya · Child/`; splitting the family row into avatar + name + age caption changes that string. Lines 43, 54, 101, 111, 116, 143, 158-159 pin other copy. These are **legitimate lockstep edits** (the markup genuinely changed) — but state each one in the Dev Record and do not weaken an assertion to make it pass.
- **Contrast is the axe risk.** The teal safety pill (mockup `rgba(95,168,160,.12)` fill, `.32` border) maps to `safety-cleared` + `safety-cleared-fill`; there is **no token for the .32 border step** — pick a solid step and verify contrast rather than inventing a token. Safety copy is held to AAA.
- **Data already in the projection but unused** (do NOT wire without a product decision): `children[].bag_composition`, `bag_composition_pattern`, `school_policies`, `rules[]`, `dietary[]`, `memory.nodes[]`, `cultural.active/suggested[]`, `caregivers[]`. Filling "The bag & your week" from these contradicts the mockup's deliberate "no interview wall" framing — out of scope.
- **Chip taxonomy is correct as shipped** — hint/action/choice all route properly (`OnboardingChips.tsx:27-31`). The mockup's dashed hint chip vs the shipped serif-italic voice is a live divergence; check the chip-taxonomy memory before changing the voice. Shipped extras (`Tap one` / `Tap any that apply` eyebrows, `SkipChip`, `parent_added ＋` badge) are product surface — keep.
- **Progress strip** (mockup `.prog`, a 4px amber bar) is left-column chrome and is **out of scope** for this slice — note it if you want a follow-up.
- Read `_bmad-output/project-context.md` before implementing (CLAUDE.md rule) and `docs/DESIGN.md` before any UI authoring (locked memory).

### Project Structure Notes

- All work is in `apps/web/src/features/onboarding/` — `KitchenMapHero.tsx` (258 lines), `OnboardingText.tsx`, plus `RecognitionEnding.tsx` for the glow reconciliation. No new files expected; if the avatar or pill grows past a few lines, extract within the feature directory rather than promoting to `packages/ui` (these are feature surfaces, not locked primitives).
- `D-13S6-CR1`'s fix is in `recognition-prose.ts` (same feature).
- Frontend-only: **no contract, no migration, no API change.**

### References

- [Source: `_bmad-output/planning-artifacts/lumi-rebuild-onboarding-mockup.html`] — panel markup L122-137, CSS L75-96, fill logic L199-217
- [Source: `_bmad-output/planning-artifacts/valet-canvas-build-plan.md`#Notes-and-open-items] — the S3b carve-out
- [Source: `docs/DESIGN.md`#4] — Honey rule (§44), locked components (§113-133)
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md`] — D-13S6-CR1, D-14S4-5
- [Source: commit `209324d`] — the dead-`/alpha` repair already applied to this surface

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Agent Model Used

claude-opus-5 (1M context) — dev-story, 2026-07-31

### Debug Log References

- Compiled-CSS proof run with a two-way sanity control (finds a known-present class, misses a fabricated one) before trusting any result. All 16 introduced utilities + both new keyframes PRESENT in `index-B0VxCU25.css`.
- Contrast computed from `packages/design-system/tokens/colors.css` per theme rather than eyeballed — this is what caught the avatar and hover-text problems below.

### Completion Notes List

**AC10 first bullet is VOID — D-13S6-CR1 was a false positive, and no code was changed for it.** Its claim was that `recognition-prose.ts` reads a dropped column and is "a silent no-op". The *column* was dropped; the **projection field was not**. `kitchen-map.repository.ts:330` queries `household_allergens WHERE child_id IS NULL` and `:400` assigns it to `household.declared_allergens`; the contract still defines it (`kitchen-map.ts:46`). Removing that read — as the item proposed — would have dropped household-wide allergens from the recognition prose. Closed in the ledger as a verified false positive. **The Reconciliations discipline caught this in the first story that carries the section.**

**Replacement absorption: D-14S3-CR4** (a genuine 2-for-1). `PlanTile.tsx:366`'s variant-proposal pill carried `bg-amber-warm/10` + `hover:bg-amber-warm/20` — dead `/alpha` classes *and* a Honey-rule violation. Now a transparent `lumi-terracotta` outline that fills `lumi-terracotta-warmed` on hover per DESIGN.md §141. Closes the deferred item and removes two dead classes. D-14S4-5 annotated with the remaining ~68.

**Deviation 1 — avatar accent is a BORDER, not a fill (AC4 said "accent fill").** Measured contrast: no single text colour clears AA on all four accent fills across both themes — `honey-amber-300` needs dark text (8.14:1) while `lumi-terracotta`'s best dark-theme option is 3.84:1. Ringing a neutral `surface-3` keeps the per-child hue and puts the initial at **9.47:1 light / 11.42:1 dark**. Per-child identity preserved; AA guaranteed.

**Deviation 2 — proposal-pill hover text stays `fg`.** DESIGN.md §141 prescribes `--warm-neutral-950/900`; **`warm-neutral-950` does not exist** (the scale is 50–900 — another doc-vs-code drift), and `900` measures **4.25:1** on the warmed fill in light theme, under AA. `fg` measures 5.34 / 5.19. Doc should be corrected to drop the 950.

**Deviation 3 — allergen labels keep their vocabulary casing.** The mockup shows lower-case "No peanuts"; lower-casing the projection's canonical labels would mangle deliberately-capitalised vocab entries, so pills render `✓ No Peanut`.

**Two glows, deliberately different beats (AC7).** `hk-glow` stays a one-shot bloom on the left-column `RecognitionEnding` card; the new `hk-map-glow` is the map panel's continuous 2.4s ring+halo. They never share an element, so there is no double-bloom — the card announces, the map keeps glowing.

**Fixed a flaky test I wrote in 14-s6.** `query-provider.test.ts` failed once under full-suite load (5039ms for one test) then passed on re-run; stashing this story's changes proved the suite green, so it was load-sensitivity in the probe, not a regression. Its `await import()` inside the test body made it timing-dependent; now a hoisted static import. Re-verified with both controls — still fails without the scheduler override.

**Lockstep test edits (4, all because markup genuinely changed — none weakened):** `Maya · Child` → separate name/age/initial assertions; two safety pills → `✓ No <Allergen>`; the always-on bag assertion split into a two-state progressive-reveal test (asserting both absent-before and present-after).

### File List

**Modified**
- `apps/web/src/features/onboarding/KitchenMapHero.tsx` — panel sections, avatar rows, pills, per-child taste attribution, map glow
- `apps/web/src/features/onboarding/OnboardingText.tsx` — full-bleed section + gradient overlay → plain `bg-bg` host (the card now lives in the hero)
- `apps/web/src/styles/globals.css` — `hk-map-glow`, `hk-breathe` keyframes
- `apps/web/src/features/plan/PlanTile.tsx` — D-14S3-CR4 absorption
- `apps/web/src/features/onboarding/KitchenMapHero.test.tsx` — 4 lockstep edits + 1 new test
- `apps/web/src/providers/query-provider.test.ts` — de-flaked (static import)
- `_bmad-output/implementation-artifacts/deferred-work.md` — D-13S6-CR1 closed (false positive), D-14S3-CR4 closed, D-14S4-5 annotated

## Change Log


| Date | Change |
| --- | --- |
| 2026-07-31 | Story authored (create-story, claude-fable-5). Post-retro addendum slice from the valet-canvas build plan's S3b carve-out. Two Menon decisions pre-resolved (exact age OUT, amber chip NOT ported). Reconciliations verified against the codebase the same day, including that the surface's dead `/alpha` classes were already repaired in `209324d`. Absorbs D-13S6-CR1 + annotates D-14S4-5 per the Epic 14 retro's debt-budget rule. |

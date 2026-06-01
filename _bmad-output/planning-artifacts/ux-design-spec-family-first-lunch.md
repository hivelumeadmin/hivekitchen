---
status: draft
date: 2026-05-28
project_name: HiveKitchen
user_name: Menon
scope: |
  The Day-detail Wall Card and Weekly Plan Canvas re-architected under the family-first
  lunch-planning model. One Main per day shared across kids; per-child Variations as
  the primary divergence affordance; 3-Mains-with-2-day-repeats as the default weekly
  pattern; 3-slot weighted structure (Main > Snack > Optional Extra).
supersedes:
  - ux-design-spec-day-detail-unclog.archived-2026-05-28.md
inputDocuments:
  - _bmad-output/planning-artifacts/ux-design-specification.md  # canonical product-level UX spec (complete 2026-04-22)
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/product-brief-2026-04-18.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-design-spec-day-detail-unclog.archived-2026-05-28.md  # archived precursor; preserved for reasoning history
  - _bmad-output/brainstorming/brainstorming-session-2026-05-27-1957.md
  - _bmad-output/project-context.md
  - docs/DESIGN.md
  - apps/web/src/routes/_dev-day-detail-multi-child.tsx
  - apps/web/src/features/day-detail/components/*  # WallCardPage, WallCardSwipeStack, VariationChip, OptionalExtraBlock, MainGroupBadge
  - apps/web/src/features/day-detail/data/multiChildMockData.ts
  - apps/web/src/features/plan/BriefCanvas.tsx
projectMemories:
  - family-first-main-then-variations
  - three-main-weekly-pattern
  - three-slot-weighted-structure
  - shared-recipe-default
  - parent-confidence-prevents-cafeteria
  - cooking-time-budgets
  - prep-and-finish-are-activity-modes
  - recipe-vs-method-distinction
  - day-detail-is-cooking-not-explanation
  - degraded-modes-are-user-actions
---

# UX Design Specification — Family-First Lunch Planning

**Author:** Menon (with Sally facilitating)
**Date:** 2026-05-28
**Status:** Draft — supersedes the archived `ux-design-spec-day-detail-unclog.archived-2026-05-28.md` under the family-first product-architecture course correction.

## Executive Summary

### Project Vision

Lunch planning in HiveKitchen is **family-first**. The parent is preparing ONE coordinated weekly lunch plan for the household, not a separate workflow per child. Each day has one Main lunch shared across the kids by default; per-child differences are encoded as small Variations on that shared Main. Truly different Mains across kids is the rare allergen/restriction exception, not a normal mode.

This spec covers two coupled surfaces under that frame:

1. **The Day-detail Wall Card** — the page a cook opens when they need to make or pack a specific day's lunch. Composed of one Main hero + per-child Variation chips + Snack + Optional Extra. Paginated day-to-day across the school week.
2. **The Weekly Plan Canvas** — the home for the week's lunch plan. Shows the 5 school days as tiles, with the 2-day-repeat pattern (M1 spans Mon+Tue, M2 spans Wed+Thu, M3 = Friday flex) visually grouped. Drag-drop swap between days for the "fluid weekly scaffold" promise from the PRD.

This spec inherits — and does not restate — the canonical product-level UX vision (`ux-design-specification.md`, complete 2026-04-22): system-led UI, ready-answer Brief, silent plan mutation with quiet diff, *beats PB&J on Tuesday* minimum-value bar, ambient Lumi presence. The Family-First spec operates inside that frame and refines it for the cooking surfaces.

**Load-bearing claim:** the day-detail experience must be the calm typographic surface a tired parent looks at — at 6am or 9pm — that makes them think *"yes, I can absolutely do this for the whole family,"* so they don't reach for the PB&J shortcut or the cafeteria capitulation. The family-first cognitive frame is what makes that claim true at scale; it removes the per-child-cooking workflow that creates planning fatigue.

### Target Users

Inherits the canonical product-level personas (Priya, Mike/Devon, partner, grandparent, internal-ops Sam). For this spec, five *moment-states* of the same person matter most, plus one *win-back* persona.

1. **The 9pm-prep cook** — calm-but-tired evening state, executing the Main's make-ahead steps the night before. Mostly solo.
2. **The 6am-finish cook** — rushed-but-narrow morning state. Phone propped on counter. Almost always solo. Reading per-child Variation chips to know which kid gets what.
3. **The Sunday-batch cook** — weekend-leisure state. May prep across multiple days. Tablet or laptop on the counter.
4. **The Sunday-open planner** — opens the weekly plan canvas around 8–10pm Sunday to review the next week's plan. Uses drag-drop swap to bend the week around scheduling conflicts.
5. **The Partner-Handoff cook** — same physical environment as the 6am cook but walks in cold. Did not compose this week's plan. No memory of which kid prefers what. The Wall Card must serve them by surfacing per-child Variations explicitly.

Plus one target user the design must **win back**:

6. **The Cafeteria-Defaulter** — currently chooses school cafeteria 2–4 days a week. The family-first model is the conversion lever: when a parent realizes they don't have to cook 3 different lunches, the activation barrier drops. Hypothesis-driven persona; will be refined once beta data exists.

### Load-Bearing Principles

Six principles distilled from the brainstorm, the focus group, the party-mode review, and the 2026-05-28 family-first course correction. These are binding for the rest of the spec.

1. **Family-first, variation-second.** One Main per day shared across kids by default. Per-child differences are Variations (small adjustments), not separate Mains. ([[family-first-main-then-variations]])
2. **3 Mains per week with 2-day repeats.** Default planner output: M1 used Mon+Tue (small day-to-day variation), M2 Wed+Thu (variation), M3 Fri-flex. Override always available. ([[three-main-weekly-pattern]])
3. **3-slot weighted structure.** Main (anchor) > Snack (complementary) > Optional Extra (flexible — NOT just dessert). ([[three-slot-weighted-structure]])
4. **Recipe always shown; method earns disclosure.** The Main is the identity; the method is the instruction. Method is conditionally shown by self-declared familiarity. ([[recipe-vs-method-distinction]])
5. **Two activity modes per Main.** Prep and Finish are user-driven activities, not clock-bound states. Mode toggle filters the method by `step.mode` tag. ([[prep-and-finish-are-activity-modes]])
6. **Honest, soft time budgets.** Finish ≤15 min, Total ≤40 min as soft planner targets. Calm surfacing of actual time; no warning on overage. ([[cooking-time-budgets]])

## The Family-First Cognitive Frame

This is the load-bearing principle that distinguishes the current spec from its archived precursor.

**The earlier "Wall Card paginated by unique recipes" direction got this wrong.** It treated split-day (different Mains per kid) as a normal mode worth full UI symmetry with shared-day. That framing inverted the actual household economy — most families cook ONE Main for everyone and adjust per-kid, because cooking three different mains for three kids is a small kind of madness most weekday mornings. The product must guide parents toward family-first, not enable per-child-cooking workflows.

**The corrected frame:**

- The parent is preparing **one coordinated family lunch plan with smart variations**, not multiple independent lunches.
- Each day has **one Main** that is the anchor of the entire lunch experience. The Main drives everything downstream: snack suggestions, optional extras, portion adjustments, prep guidance, weekly planning, grocery planning, and child-specific Variations.
- The **Variation primitive** encodes per-child differences as small adjustments to the shared Main: `{ portionSize, texture, spiceLevel, cuttingStyle, container, addOns, removals, notes }`. Same Main, three Variations.
- **Truly different Mains across kids** is the rare exception — allergen forks, severe dietary restrictions, school-rule conflicts. When this happens, the UI treats it as an exception worth visible emphasis (a "fully divergent — separate preparation" affordance), NOT as a normal mode.
- **Variations are auto-derived from child profile** by Lumi: `age_band` → portion + texture; `spice_tolerance` → spice level; `allergens` → forced removals; `container_type` → cutting/packing style; `activity_level` → optional-extra add-ons. The parent doesn't manually fork — Lumi proposes, parent adjusts.

The downstream consequence: the Wall Card surfaces one Main hero + per-child Variation chips beneath, NOT N paginated recipe pages. The Weekly Canvas shows the 5 school days with 2-day-repeat groupings visible. The planner targets 3 Mains per week as the default output shape.

## Key Design Challenges

Ten load-bearing challenges, specific to this spec.

1. **The cooking moment is hostile to phones.** Water, flour, oil, time-pressure, dim light. Touch interactions are unreliable. Penguin-page typography + no photos + minimal touch targets are the response. *(memory: [[parent-confidence-prevents-cafeteria]])*

2. **One Main per day cognitive frame.** Co-presenting multiple Mains per day inverts the family-first model and creates cognitive load. The Wall Card surfaces ONE Main per day with Variation chips beneath. The rare allergen-fork case becomes a visible exception block, not a normal mode. *(memory: [[family-first-main-then-variations]])*

3. **Self-declared familiarity must be simple, binary.** Known/not-known per Main per household. No behavioral inference. Method default state derives from this flag. *(memory: [[recipe-vs-method-distinction]])*

4. **The 2-day-repeat pattern must be visible on the canvas.** Mon+Tue tiles sharing M1 need a subtle visual connector or shared label. The Wed+Thu pair too. Friday stands alone. The pattern is the planner's signature — make it legible. *(memory: [[three-main-weekly-pattern]])*

5. **Beats PB&J on Tuesday — dual soft targets.** Finish-time target ≤15 min (the actual PB&J substitute test on a weeknight). Total-time target ≤40 min (Sunday-planner sanity check, prep + finish summed). Both are soft — Lumi prefers within-target plans but does not reject over-target plans. *(memory: [[cooking-time-budgets]])*

6. **Tap→conversation handoff without modal interrupt.** Canvas tile-tap navigates to day-detail. Drag-drop swap moves day plans. No DisambiguationPicker, no "what would you like to do?" prompt. *(canonical Challenge 12 inheritance)*

7. **Allergen-bearing Mains break Wall Card uniformity.** When a Main is allergen-bearing for one kid (or all), the Variation chip and the Main hero MUST inherit the *guardrail-cleared* affordance from the canonical spec — a visible "we triple-checked this" element. Calm-typographic uniformity yields where safety requires friction. *(canonical Challenge 7 inheritance)*

8. **Re-guardrail contract on drag-drop swap.** Post-swap render is blocked until the guardrail verdict returns. Intermediate state shows the affirmative-badge spinner. Per-Main re-evaluation runs against each child in the household. *(canonical Journey 5 inheritance)*

9. **Variation chip information density.** Each chip must convey portion + texture + spice + key add-on within a 1-line glance read. Tap-to-expand reveals the full per-child variation card (cutting style, container, removals, notes). The chip strip is horizontal-scroll, not multi-row.

10. **Calm time-budget surfacing.** The dual budget is a soft target for Lumi, not a hard constraint. The Brief renders the daily rollup time honestly — no warning state, no color shift, no Lumi morning-of nudge when over-target. Repeated weekly overages may surface as a calm Sunday-batch suggestion, never as a per-day interrupt. *(memory: [[cooking-time-budgets]])*

## Design Opportunities

Six opportunities, all compounding with product-level moves.

1. **Variation chips as glance affordance.** A single horizontal-scroll row of small chips ("Aarav · small · soft · mild"; "Mira · regular"; "Kabir · large · +1 egg") gives the cook the per-child variation in 1–2 second scan. Tap-to-expand reveals detail. This is the primary novel UX primitive of this spec.

2. **2-day-repeat visual grouping on the canvas.** Subtle connector between Mon+Tue tiles and Wed+Thu tiles. Inline `M1 · same as Tuesday` hint on day-detail. Lumi's planner signature made legible — and reinforces the parent's sense that the system is reducing their planning effort, not multiplying it.

3. **Mode toggle (Prep | Finish) as generalizable primitive.** Filters method by `step.mode` tag. Defaults time-aware (Finish pre-noon, Prep post-5pm). May extend to grocery list, evening check-in, and other surfaces in future epics.

4. **Optional Extra as a flexible slot** — drink, protein boost, sports-day add, allergy substitute, toddler-safe item, sweet treat. The flexibility itself is the differentiator from category competitors who model the third slot only as dessert.

5. **Calm typographic surface as differentiator.** Photo-heavy recipe apps (Mealime, Paprika, Allrecipes) compete on visual richness. HiveKitchen competes on cognitive restraint. The Wall Card's Penguin-page treatment is part of the ambient-Lumi promise at the design-primitive level.

6. **Canvas drag-drop as the "fluid weekly scaffold" promise made real.** Drag-drop swap between days with 5-second undo toast. The PRD claims plans are scaffolds, not contracts. The gesture is the embodiment.

## Core User Experience

### Defining Experience

**The Partner-Handoff cook's first day-card open at 6:14am Wednesday.**

Of every interaction this spec covers, one decides whether the spec succeeds or fails: the moment a partner-handoff cook walks in cold, having not composed this week's plan, opens the day-detail surface, and either *proceeds to cook* or *defaults to substitute*. If we nail this single first-open moment, every other surface follows.

**The four-things-in-1-2-seconds contract:** within 1–2 seconds of first paint, the cook can identify:
1. What is today's Main (dish title)
2. Who eats it and how each kid's variation differs (attribution + variation chips)
3. Roughly how long it will take (meta line: time budget + main-group hint)
4. Whether they already know how to make it (familiarity indicator)

Variation chips are the critical addition: the cold partner doesn't need to mentally reconcile "what does Aarav prefer." The chip says it: *"Aarav · small · soft · mild · -nuts."*

### User Mental Model

The Partner-Handoff cook brings a *"show me what to make for the family today"* mental model, not a *"let me figure out per-child lunches"* model. Three mental-model anchors:

1. **The parent expects a coordinated family plan, not parallel per-child plans.** They are walking into the kitchen to cook ONE Main. Lumi's job is to surface that Main + Variations succinctly, not present three independent recipe pages.
2. **The parent expects the answer at glance distance.** Phone is propped 2–3 feet away on the counter. Anything below the first viewport must be secondary.
3. **The parent expects autonomy on time + substitution judgment.** If the recipe takes 18 minutes and they have 12, they decide. The app does not.

### Success Criteria

Five binding acceptance criteria.

1. **Page paints in <500ms perceived time** from tile-tap on the canvas to first meaningful render of the day card.
2. **Within 1–2 seconds of first paint**, the cook can identify the Main, the per-child Variations (via chips), the time budget, and the familiarity state.
3. **Variation chips are legible at glance distance** (2–3 feet from a counter-propped phone) without expansion.
4. **No active gesture is required to reach cooking-relevant content.** Mode is time-aware-defaulted; familiarity defaults from per-Main persistent flag; method shows/hides accordingly.
5. **The cook does not navigate away to find missing context.** Allergen verification, dietary fit, and per-child preference are all on the day card.

### Novel vs Established Patterns

**Established (Step 5 inspiration analysis from the archived precursor still holds):** paginated single-content-unit pages (NYT Cooking + Apple Books), gestural direct manipulation (Things 3, Linear), mode-based filtering (iA Writer Focus Mode), Penguin Classics typography, StickyBottomBar action verbs.

**Novel:**
- **The Variation chip primitive** — single-line per-child adjustment summary with tap-to-expand. No competitor in the recipe-app space currently surfaces per-child variation as a compact glance affordance.
- **The Main-group badge** — `M1 · same as Tuesday` inline hint that surfaces Lumi's 2-day-repeat planning signature on the day card itself. Makes the planner's intelligence felt without requiring the parent to consciously parse it.
- **3-slot weighted hierarchy with Optional Extra as flexible** — Main as hero, Snack as secondary, Optional Extra as genuinely-optional flexible block. Most apps treat the third slot as fixed (dessert / snack-2) or omit it; this spec uses it as a flexible accommodation slot.

### Experience Mechanics

#### Wall Card First-Open (the defining mechanic)

**Initiation.** Parent taps a day tile on the BriefCanvas. Tile shows momentary `:active` state. Route transitions slide-in from trailing edge (250ms ease-out).

**Interaction.** On first paint:
- DayHeader shows day name + date (e.g., *"Monday · 12 May"*).
- MainGroupBadge shows `M1` + an inline note (e.g., *"same as Tuesday"*) when the day shares its Main with another day.
- Main hero block: eyebrow ("Main meal"), dish title (large serif italic), attribution + portions ("For Aarav, Mira & Kabir · × 3"), meta line ("~5 min to pack · Familiar recipe").
- Variations strip: horizontal-scroll row of `VariationChip`s, one per kid (e.g., *"Aarav · small · soft · mild"*). Tap to expand the full per-child variation card with cutting style, container, add-ons, removals, notes.
- Ingredients block ("You'll need") always shown.
- Method block ("How to make it"): collapsed if `familiarityKnown`, expanded otherwise. Method steps filter by active mode (Prep / Finish) via `step.mode` tag.
- Snack section beneath: snack dish title + ingredients + optional per-child light variation notes.
- Optional Extra block beneath, only rendered when set: kind label + dish title + per-child included/excluded chips.

**Feedback.** Meta line is the primary confidence affordance. Cook reads it once and forms a judgment.

**Completion.** Cook taps `[✓ Mark cooked]` (Finish mode) or `[✓ Done prepping]` (Prep mode). Action confirms in-place. Route returns to the canvas.

#### Day-to-Day Pagination

Swiping horizontally within the WallCardSwipeStack navigates between **days** (Mon → Tue → Wed → Thu → Fri), not between unique recipes within a day. Pagination dots represent the 5 school days; active dot tracks scroll position. This honors the "one Main per day" cognitive frame — each page IS one day's complete plan.

#### Canvas Drag-Drop Swap (Sister Mechanic)

Drag-drop semantics inherit from the archived precursor (Things 3 + Linear pattern):
- Hover (desktop) reveals a `DragHandle` at top-start of the tile after ~150ms.
- Long-press (touch) for 350ms enters lift state (scale-up to 1.02, elevated shadow, slight rotation, haptic feedback).
- Lifted tile follows pointer/finger. Adjacent tiles part to indicate drop zones. Paused days block drop.
- Drop completes with both tiles gliding to new positions via 400ms ease-in-out.
- `UndoToast` appears at bottom edge for 5 seconds.
- Post-swap guardrail re-evaluation runs against each child for each day's Main. AllergyClearedBadge shows spinner state until clearance returns. Pre-swap badges are NOT shown stale.

If a swap moves a day OUT of its 2-day-repeat group, the MainGroupBadge on that day visually updates (e.g., M1 → standalone or M1 → "now only on Monday").

#### Day-Level Actions (Swap Main, Pause, Skip)

The Wall Card's action bar exposes the day-level verb set required for real cooking-time decisions. Earlier rounds of this spec dropped most of these verbs during simplification; they are restored here as load-bearing affordances. Saved to memory as [[day-detail-action-vocabulary]].

**Action bar shape:**
- **Primary verb (left)** — `[✓ Mark cooked]` (Finish mode) or `[✓ Done prepping]` (Prep mode). The primary completion action for the current mode.
- **"More actions ▾" disclosure (right)** — single text affordance that expands a panel below the action bar with the full secondary verb set.

**Secondary verb set (in the "More actions" panel):**

1. **Swap this Main** — replaces the day's Main with a different recipe entirely. Opens a Lumi conversation panel proposing 2–3 alternatives ("How about a paratha roll instead?" / "I have a tofu wrap I think Kabir would like."). The parent picks or types a custom request. This verb is **distinct from the canvas drag-drop swap** (which swaps day-to-day *dates*, not Main-to-Main content). Backend: regenerates the day's plan_items in place via the orchestrator; brief_state re-projects; allergen re-clears against each child before render.

2. **Skip prep tonight ↗** *(Prep mode only)* — marks prep as not happening for this day. Finish mode the next morning surfaces *"no prep was done — all steps are morning-of"* honestly. Backend: sets a `prep_skipped_at` marker on the day; the planner / brief_state adapts the Finish mode method filter to show all steps (since none were pre-done).

3. **Pause this day** — full-day pause for sick day, snow day, holiday. Affects ALL plan_items for the day across all kids. Lunch Link delivery (Epic 4) reads `paused_at` to skip. The day tile on the canvas shows a paused indicator. Backend: sets `paused_at` on every plan_item for the day. *(Column already exists from Story 3.12.)*

4. **Pause for [kid name]** *(one entry per kid in the household)* — per-child pause. That kid's lunch is paused; the Main + Variations for other kids continue. Their Variation chip on the day card shows a paused indicator; their attribution removes from the Main's portion count. Backend: sets `paused_at` on plan_items WHERE `child_id = [kid_id] AND day = [day]`. *(This was deferred in the archived spec; family-first model makes it trivially natural since Variations are first-class.)*

5. **Change my mind ↗** — returns to the canvas without committing any cooking state change. Non-destructive escape hatch.

**UX semantics:**
- Tapping "More actions ▾" expands the panel inline below the action bar; no modal, no overlay.
- Each verb line is a single-line label + small italic hint explaining what it does.
- The panel collapses on a re-tap of "More actions ▴".
- Pause verbs (day-level and per-kid) write immediately on tap with a 5-second `UndoToast` (same pattern as canvas drag-drop swap).
- Swap-this-Main opens a Lumi conversation panel; it does NOT commit until the parent picks an alternative.

**Backend coverage for this verb set:**
- `plan_items.paused_at` exists (Story 3.12) and supports both full-day and per-child pause; no schema change needed.
- Swap-this-Main needs an orchestrator endpoint that takes `(plan_id, day, current_main_recipe_id)` and proposes 2–3 alternatives within the household's allergen/preference profile.
- Skip-prep-tonight needs either a new column or a JSONB field on the day_plan; flagged for Epic 3 solutioning.
- Re-guardrail contract (Challenge 8) applies to swap-this-Main: post-commit render is blocked until guardrail clears for each child.

## Desired Emotional Response

### Primary Emotional Goals

Four primary emotional goals, ranked by load-bearing weight. Each compounds with the family-first frame.

1. **Calm competence for the family cook.** The parent opens the day card and feels equipped to cook ONE Main with confidence-building Variation chips telling them exactly how to adjust per kid. Not multiple competing recipes; not per-child workflows; one coordinated plan they can execute.
2. **Earned autonomy.** App provides information; parent makes judgments. Over-budget time is shown calmly. Substitutions are silent. Absence of prep is silent. The doctrine of "honor judgment, never grade" holds throughout.
3. **Trustworthy safety.** At the allergen-bearing-Main moment, calm reads as casual. The Wall Card's uniformity yields to a visible *"we checked this for each kid"* affordance. Variation chips for allergen-affected kids show their `removals` explicitly.
4. **Gestural confidence on the canvas.** Drag-drop swap and 2-day-repeat visual grouping make the parent feel they are *commanding* the week, not negotiating with a tool. The PRD promise of "plans are scaffolds, not contracts" delivered as felt experience.

### Emotional Journey Mapping

The five moment-states each carry a distinct emotional arc. Critically, the family-first frame REDUCES emotional load across all of them by removing the per-child-cooking workflow that was creating fatigue.

- **Priya, Monday 9pm** (9pm-prep cook): *intentional → focused → done.* Knows it's M1 prep night. Mode is Prep. Cooks the dal + rice with batch-prep variation in mind for Tuesday too.
- **Priya, Tuesday 6am** (6am-finish cook): *brief → unhurried → packed.* Mode auto-defaults to Finish. Wall Card shows M1 again with a small "paneer added for Mira & Kabir" Variation note. She packs 5 minutes, done.
- **Devon, Wednesday 6:14am** (Partner-Handoff cook): *orientation → recognition → "I've got this."* Walks in cold. Variation chips tell him Aarav gets bite-sized rounds, Mira regular paneer paratha, Kabir egg + extra side. No mental reconstruction of plan history.
- **Mike, Sunday 9:14pm** (Sunday-open planner): *notice → gesture → glide → confidence.* Sees Tuesday has activities; drags Tuesday onto Friday. Tiles glide; undo toast appears. M-group affordances update silently. He closes the app feeling the week is his.
- **Any cook, week 4 with familiar M1**: *open → recognize → quiet pride.* Method auto-collapsed by familiarity. Variations remembered from the per-child profile. Just packing.

### Emotional Design Principles

Four binding emotional principles for the rest of the spec.

1. **Honor judgment, never grade.** Information is provided; opinions are withheld.
2. **Friction where safety lives, calm everywhere else.** Allergen verification breaks the page's serenity intentionally. Nothing else does.
3. **Earned silence over performed presence.** Familiar-collapsed method, no-warning-state overage, silent substitution, absent prep-feedback on no-prep days — silence is the design.
4. **Direct manipulation IS direct confidence.** Every gesture (drag-drop, swipe, tap, long-press) creates an immediate visible result, with undo available where reversal matters.

## Design System Foundation

**Inherits `docs/DESIGN.md` v2.0** (warm-neutral palette, Honey rule, button taxonomy, StickyBottomBar pattern, 17 locked components). No new tokens introduced.

**New domain components introduced by this spec** (to be added to DESIGN.md v2.1 when shipped):

1. `WallCardSwipeStack` — paginated day-to-day swipe container; manages mode + activeDay state.
2. `WallCardPage` — day-card composition: header + Main hero + variations strip + ingredients + method + snack + optional extra.
3. `VariationChip` — compact per-child variation summary with tap-to-expand to a `VariationExpandedCard` (kept inline in `VariationChip.tsx` for cohesion).
4. `OptionalExtraBlock` — kind label + per-child included/excluded chips.
5. `MainGroupBadge` — inline "M1 · same as Tuesday" hint.
6. `DragHandle` — six-dot grip for canvas tile drag.
7. `UndoToast` — 5-second bottom-edge undo with auto-dismiss.
8. `AllergenClearedBadge` (extending canonical Story 3.10 affordance) — per-kid per-Main guardrail-cleared state with spinner during swap re-evaluation.

All compose from existing DESIGN.md v2.0 tokens. No new color tokens, no new typography scale.

## Visual Foundation

### Color System

Inherited token usage (unchanged from the archived precursor's Step 8):

- `bg` (warm-cream) for day-card background
- `fg` for primary readable text (dish titles, ingredients, method)
- `fg-muted` for eyebrows, meta lines, secondary text
- `amber-warm` as the one acting color (mode toggle active, primary CTA, method numbers, ingredient bullets, MainGroupBadge background)
- `sacred` for safety-clearance affordances (allergen-cleared badge)
- `foliage`, `lumi-terracotta`, `sacred` (also) for the three child color dots
- `border`, `surface`, `surface-2` for subtle structure

**Tokens NOT used:** no `destructive` / `safety-red` (this spec has no destructive UI); no `honey-accent` for primary actions (reserved per Honey rule); no new color introductions.

### Typography System

Inherited scale from DESIGN.md v2.0. Specific applications (Penguin-page hierarchy):

- Dish title: serif italic, `text-3xl`
- Slot eyebrows ("Main meal", "Snack", "Optional extra"), section headers ("You'll need", "How to make it"): sans medium uppercase, `text-[10px]` tracking `0.25em`
- Attribution + portions: sans regular, `text-sm`
- Meta line (time budget + familiarity): sans regular, `text-xs`
- Ingredients list, method step text: sans regular, `text-base`
- Variation chip text: sans regular, `text-xs`
- Day rollup ("Total to pack: 6 min"): sans medium uppercase, `text-[11px]` tracking `0.2em`
- Prep-investment feedback: sans italic, `text-[11px]`
- Action bar primary label: sans bold, `text-sm`
- Action bar secondary link: sans medium uppercase, `text-[11px]` tracking widest

### Spacing & Layout Foundation

Inherits the 4pt-base Tailwind scale.

- `WallCardPage` outer: `px-6 py-10`, sections separated by `space-y-8`
- Within sections: `space-y-3` (header block), `space-y-2.5` (ingredients), `space-y-4` (method steps)
- `WallCardSwipeStack` outer card: `rounded-2xl border border-border/30`, `max-w-lg`
- Variation chip strip: horizontal-scroll, `-mx-6 px-6 gap-3` for edge-to-edge feel
- Snack and Optional Extra sections: `border-t border-border/15 pt-6` to visually separate from method

### Accessibility Considerations

Five binding commitments (in addition to canonical DESIGN.md §10):

1. **Touch target sizes ≥44pt** for mode toggle, variation chips, expand toggles, action bar buttons.
2. **Keyboard navigation across the swipe stack.** Arrow keys advance days; Tab cycles through ModeToggle → variation chips → method toggle → action bar.
3. **Reduced-motion respect** on all transitions (route slide, drag lift, swap settle, mode toggle).
4. **Screen-reader semantics.** ModeToggle has `role="tablist"`; variation chips have `aria-expanded`; pagination position announces via `aria-label`.
5. **Contrast compliance** at WCAG 2.1 AA minimum across all amber-warm-on-bg combinations.

## Design Direction Decision

### Direction Committed

**The Day-Card-with-Variations under the family-first frame** is the committed direction for this spec.

The visual reference is the live React mock at:
`apps/web/src/routes/_dev-day-detail-multi-child.tsx`

The mock demonstrates a complete 5-day Mon-Fri example exercising:
- Family-first composition (one Main per day, per-child Variation chips)
- 3-Mains-with-2-day-repeats pattern (M1 Mon+Tue, M2 Wed+Thu, M3 Fri-flex)
- 3-slot weighted structure (Main hero, Snack secondary, Optional Extra flexible)
- Variation chip expand/collapse with full per-child detail
- Mode toggle (Prep / Finish) filtering method by step tag
- Familiarity-driven method collapse
- Calm time-budget surfacing + prep-investment retrospective
- Mode-specific action bar verbs

### Design Directions Considered (Historical)

This spec did NOT generate forward design-direction variations. The current direction emerged from three iterative mock rounds documented in the archived precursor (`ux-design-spec-day-detail-unclog.archived-2026-05-28.md`):

1. **Inherited cooking-page-with-explanation chrome** — rejected for cognitive load.
2. **Cooking-only flat surface with co-presented recipes** — rejected for cognitive load.
3. **Wall Card paginated by unique recipes** — superseded 2026-05-28 by the family-first reframe; the variation primitive made per-recipe-per-day pagination obsolete.

The current direction (Day-Card-with-Variations) absorbs the calm typographic surface, the mode toggle, the soft budgets, and the anti-nudge doctrine from the archived precursor, while restructuring composition around Main + Variations + Snack + Optional Extra.

## Backend Implications

Flagged for Epic 3 solutioning. Each implication is phrased as a candidate story or solutioning concern.

### Data model

- **`plan_items.family_main_group_id`** — UUID nullable column linking sibling rows that share a Main on the same day. Rows in the same group carry the same `recipe_id` but differ on `variation`. Migration: add column with index on `(plan_id, day, family_main_group_id)`.
- **`plan_items.variation`** — JSONB column carrying the per-child adjustment object: `{ portionSize, texture, spiceLevel, cuttingStyle, container, addOns, removals, notes }`. Default `'{}'::jsonb`.
- **`plan_items.slot`** — already a free-text string per Explore findings. The contract should narrow it to `'main' | 'snack' | 'extra'` (or `'optional_extra'`), but this is a contract refinement, not a DB migration.

### Recipe model

- **`recipes.instructions`** — currently `string | string[] | null`. Restructure to `Array<{ text: string, mode: 'prep' | 'finish' }>` to back the Wall Card's Prep/Finish toggle. Two paths:
  - **Lazy migration via recipe-agent (story 3-31)** — when the recipe-agent next fetches/refreshes a recipe, it emits the new shape. Old `string[]` rows coexist temporarily.
  - **One-shot migration** — convert all rows by LLM tagging or simple heuristic (first half = prep, second half = finish).
- **`recipes.prepMinutes`** and **`recipes.finishMinutes`** — first-class queryable numerics, NOT NULL on the lazy-catalog fetch path. Currently only `prep_time_minutes` exists; add a `finish_time_minutes` column.

### Child profile

- **`children` table extensions** — add columns for `appetite_level: 'light' | 'normal' | 'heavy'`, `texture_needs: 'soft' | 'normal' | 'mixed'`, `spice_tolerance: 'mild' | 'regular' | 'spicy'`. Optional: use the existing `bag_composition_pattern` JSONB escape hatch as a fast first-cut before committing to schema.
- These fields drive automatic Variation generation by the planner.

### Planner (story 3-7 + orchestrator prompts)

- **Generate 3-main weekly skeleton** — Lumi's orchestrator output shape changes from "per-child per-day per-slot" to "3 Mains per week with 2-day-repeat pattern + per-child Variations + Snacks + Optional Extras."
- **Soft-prefer shared Mains** in the prompt; only fork the Main when allergens or severe restrictions require it.
- **Variation auto-derivation** — for each child, derive default Variation from child profile (age_band → portion + texture; spice_tolerance → spice; allergens → removals; activity_level → optional_extra add-ons).
- **Target dual soft budgets** (Finish ≤15 / Total ≤40) with deterministic verification + bounded retry; on retry exhaustion, accept over-target plan with informational metadata.

### BriefStateComposer projection

- **Group plan_items by `family_main_group_id`** when building `plan_tile_summaries`. Surface the day's shared Main + per-child Variations + Snack + Optional Extra as a unified tile summary, not as N independent items.
- The brief shape should carry `main_group_id` so the canvas tile can render 2-day-repeat grouping affordances.

### Canvas (BriefCanvas + PlanTile)

- **2-day-repeat visual grouping** — `PlanTile` shows the `M1 · same as Tuesday` inline hint; subtle visual connector between paired tiles.
- **Drag-drop swap endpoint** — `PATCH /v1/plans/:planId/days/:fromDay/swap-with/:toDay`, strong consistency, synchronous brief_state recompute, idempotency key.
- **Post-swap re-guardrail** — re-evaluates allergen-cleared state per kid per Main after swap; intermediate state shows spinner.
- **Delete legacy components** — `PlanActionSection`'s "Swap a day" button; `DisambiguationPicker`'s L1 intent split.

## Spec Boundaries / Open Questions

Five items not solved in this spec, flagged for downstream resolution.

1. **Ingredient verification (pantry-check) is upstream.** The Cafeteria-Defaulter Marcus's primary failure-trigger (5:58am realizing he's missing an ingredient) belongs to grocery-list integration, not the day card. The Wall Card must not assume verified ingredients; the design should allow a future per-page ingredient-confidence affordance without restructure.

2. **Partial-success affordance.** Devon's *"I'm packing string cheese instead of cumin chicken — why does your app act like that's a failure?"* The current action bar offers `[Mark cooked]` (success) or `Change my mind ↗` (give up). A third state — *"packed with substitution"* — is missing. Flagged for downstream story.

3. **Truly-split-day exception case.** When one kid's allergen forces a Main fork, the UI shows a "fully divergent — separate preparation" affordance. The exact treatment (whole-day mode flip vs per-kid-fork-only) is left for component-spec follow-up; the mock currently does not demonstrate this exception.

4. **Sunday-Batch View as future-state.** The meal-prep-enthusiast segment (Anika from the focus group) lives in a weekly mental model. A weekly-aggregated batch view is high-retention for that segment. Out of scope here but the design must not prevent it (daily-rollup phrasing remains compatible with future weekly aggregation).

5. **Behavioral data on substitute frequency.** This spec inherits the PRD's both-substitutes framing (PB&J + cafeteria, both real). It does not have beta-cohort data on which substitute correlates more strongly with week-4 churn. Recommended research: instrument both signals from week 1 of beta; revisit the load-bearing claim around beta-week-6.

## Verification

**Mock**: live at `/_dev-day-detail-multi-child`. Run `pnpm dev:web` and visit the route.

Expected visual properties:
- 5 paginated day pages (Mon → Fri) with horizontal swipe
- Each page shows ONE Main hero + per-child Variation chips below
- Tap a chip → expand the full per-child variation card
- M1 group hint on Mon and Tue ("Same as Tuesday" / "Same base as Monday — paneer added")
- M2 group hint on Wed and Thu
- Friday standalone as M3 flex
- Snack section beneath the Main
- Optional Extra block only on days where it's set (Tue: sports add for Kabir; Fri: sweet treat for all)
- Mode toggle (Prep | Finish) filters method live
- Daily rollup at footer
- Prep-investment feedback in Finish mode where applicable

**Build**: the family-first mock files typecheck cleanly. A pre-existing TS error in `packages/contracts/src/heart-notes.ts` (line 78) is unrelated to this work and blocks `pnpm --filter @hivekitchen/web typecheck` from running to completion. The family-first source files are syntactically and type-correct — no errors reported against them.

**Memories**: three new memories saved and indexed in MEMORY.md (`family-first-main-then-variations`, `three-main-weekly-pattern`, `three-slot-weighted-structure`). One memory updated (`shared-recipe-default` — reframed away from the binary).

**Spec**: archived precursor at `ux-design-spec-day-detail-unclog.archived-2026-05-28.md` carries a superseded banner in frontmatter and points here. This file is the current authoritative spec for the day-card and weekly-canvas surfaces.

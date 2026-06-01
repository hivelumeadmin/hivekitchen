---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
archivedAt: 2026-05-28
supersededBy: ux-design-spec-family-first-lunch.md
archivalReason: |
  Authored 2026-05-27/28 under the "unique recipes per day" frame inherited from
  earlier mocks. Workflow interrupted at Step 9 by a product-architecture course
  correction: lunch planning is family-first (one Main per family, varied per child),
  NOT per-child-cooking. The Wall-Card-as-paginated-unique-recipes direction does not
  survive that reframe.

  Preserved as historical reference for the reasoning that informed the new spec:
  the brainstorming output, focus-group revisions, party-mode pressure tests, and
  the architecture/PRD inheritance work remain useful context. See
  ux-design-spec-family-first-lunch.md for the current authoritative spec.
inputDocuments:
  - _bmad-output/planning-artifacts/ux-design-specification.md  # canonical product-level UX spec (complete, 2026-04-22)
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/product-brief-2026-04-18.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-design-spec-household-food-catalog.md  # domain-spec precedent
  - _bmad-output/brainstorming/brainstorming-session-2026-05-27-1957.md  # the brainstorm this spec realizes
  - _bmad-output/project-context.md
  - docs/DESIGN.md
  - docs/Product Concept .md
  - docs/AI Principles.md
  - apps/web/src/routes/_dev-day-detail-multi-child.tsx
  - apps/web/src/features/day-detail/components/WallCardPage.tsx
  - apps/web/src/features/day-detail/components/WallCardSwipeStack.tsx
  - apps/web/src/features/day-detail/data/multiChildMockData.ts
  - apps/web/src/features/plan/BriefCanvas.tsx
  - apps/web/src/features/plan/PlanActionSection.tsx
  - apps/web/src/features/plan/DisambiguationPicker.tsx
projectMemories:
  - parent-confidence-prevents-cafeteria
  - shared-recipe-default
  - day-detail-is-cooking-not-explanation
  - prep-and-finish-are-activity-modes
  - recipe-vs-method-distinction
  - degraded-modes-are-user-actions
project_name: HiveKitchen
user_name: Menon
date: 2026-05-28
status: in-progress
scope: 'Day-detail unclog — two coupled surfaces: (1) weekly plan canvas drag-drop swap + tile-tap navigation + legacy deletions; (2) Day-detail Wall Card (paginated unique-recipe pages, Penguin typography, Prep/Finish mode toggle, time budget, confidence cue, prep-investment feedback).'
---

# UX Design Specification — Day-detail Unclog

**Author:** Menon (with Sally facilitating)
**Date:** 2026-05-28
**Status:** In progress
**Output scope:** Two coupled surfaces — Weekly Plan Canvas cleanup + Day-detail Wall Card.

## Executive Summary

### Project Vision

The Day-detail Unclog is a two-surface realignment of the existing weekly plan canvas and day-detail screen. Both surfaces have drifted from the product's north-star promise: *the system thinks first, the parent shows up.* The unclog returns them to honest service of the cooking moment and the partner-handoff fluidity already promised at the product level.

This spec inherits — and does not restate — the canonical product-level UX vision (`ux-design-specification.md`, complete 2026-04-22): system-led UI, ready-answer Brief, silent plan mutation with quiet diff, "beats PB&J on Tuesday" minimum-value bar, ambient Lumi presence. The unclog operates *inside* that frame.

**Load-bearing claim** *(softened post party-mode, per Mary's pressure-test)*: the day-detail experience must be the calm typographic surface a tired parent looks at, at 6am or 9pm, that makes them think *"yes, I can do this"* — so they don't reach for the **PB&J shortcut OR the cafeteria capitulation**. The PRD names both substitutes; this spec respects both. PB&J is the silent retention killer (high-frequency, no signal, no acute guilt — likely the bigger threat to the Premium cohort buying cultural depth). Cafeteria is the episodic capitulation (lower-frequency, higher emotional weight). Both failure paths matter; neither is the singular north-star anchor. Behavioral data on substitute frequency is flagged as a Spec Boundary — current framing inherits from PRD strategic positioning, not from beta-cohort evidence.

### Target Users

Inherits the product-level personas (Priya, Mike/Devon, partner, grandparent, internal-ops Sam). For this spec, five *moment-states* of the same person matter most, plus one *win-back* persona.

1. **The 9pm-prep cook** — calm-but-tired cognitive state, executing make-ahead method the evening before. Typically solo. Phone propped on counter or in-hand.
2. **The 6am-finish cook** — rushed-but-narrow state. Hands occupied, 1–2 second screen glances. Almost always solo. Phone on counter, possibly splashed.
3. **The Sunday-batch cook** — weekend-leisure state. May prep across multiple days. Tablet or laptop on the counter. Lower urgency, higher commitment.
4. **The Sunday-open planner** — the canonical *"Sunday 8–10pm open"* user reaching into next week's plan via the canvas. Drag-drop swap and tile-tap navigation are *their* affordances; the day-detail is what their tap reveals.
5. **The Partner-Handoff cook** *(focus-group correction — promoted from "state mutation" to first-class persona)*. Same physical environment as the 6am-finish cook but walks in cold. Did not compose this week's plan. No memory of what the kids prefer. The Wall Card must serve them as a person reading the recipe for the first time, with zero plan-keeper context.

Plus one target user the design must **win back** *(focus-group surfaced; hypothesis-driven — will be retired, promoted, or refactored once beta-cohort data exists)*:

6. **The Cafeteria-Defaulter** — currently chooses school cafeteria 2–4 days a week. Opens the app at 5:58am, calculates *"I do not have these ingredients, the morning is shot,"* and reaches for the lunch-money option. A Wall Card succeeds for this user only if it reduces the moment of ingredient-doubt at 5:58am — which is partially upstream of this spec (see Spec Boundaries).

The partner-of-cook handoff is real but for this spec is treated as the **Partner-Handoff cook** persona above, not a separate UI surface — both surfaces work identically across who's holding the phone.

### Key Design Challenges

Ten load-bearing challenges, specific to this spec *(party-mode added 3, revised 2, deferred 1)*.

1. **The cooking moment is hostile to phones.** Water, flour, oil, time-pressure, dim light. Touch interactions are unreliable. Penguin-page typography + no photos + minimal touch targets are the response. *(memory: parent-confidence-prevents-cafeteria)*

2. **Multi-recipe co-presentation creates cognitive load → substitute default.** Rejected mocks failed by showing 2–6 full recipes on one scroll. The paginated unique-recipe page model resolves this. *(memory: shared-recipe-default, prep-and-finish-are-activity-modes)*

3. **Self-declared familiarity must be simple, binary.** Known/not-known per recipe per household. No behavioral inference. Visibility rules diverge between Recipe (always shown) and Method (familiarity-gated). *(memory: recipe-vs-method-distinction)*

4. **Day-level consistency rule — DEFERRED to v1.1** *(per John's PM judgment, Sally's recommendation, Menon's confirmation 2026-05-28)*. MVP tolerates mixed-mode days (shared main + split snack permitted). The planner-LLM constraint + backend validation + UI affordance is approximately 1.5 weeks of cross-layer work we don't have before Oct 1 launch. The v1.1 backlog inherits this as a planner-enforcement story plus a tile-level affordance. *(memory: shared-recipe-default)*

5. **Beats PB&J on Tuesday — DUAL SOFT TARGETS** *(revised post party-mode + Menon's soft-target confirmation 2026-05-28)*. The single 30-min budget was wrong — it answered the Sunday-planner question, not the weeknight-5:47pm question. The fix: two complementary soft targets.
   - **Finish-time target: ≤15 min** (the actual PB&J substitute test on a weeknight)
   - **Total-time target: ≤40 min** (prep + finish summed; Sunday-planner sanity check)
   - Both are **soft** — Lumi's planner prefers within-target but does not reject over-target plans.
   - Prep-investment feedback shows both numbers when surfaced retrospectively (*"You front-loaded 20 min Sunday → 7 min Tuesday finish"*). *(memory: cooking-time-budgets, parent-confidence-prevents-cafeteria)*

6. **Tap→conversation handoff without modal interrupt** *(inherits Challenge 12 from canonical spec)*. The legacy DisambiguationPicker L1 is the *failed* version of this pattern — it forces users to disambiguate intent before reaching the day-detail. The unclog moves intent resolution *into* the day-detail's action bar verbs and into the canvas's drag-drop affordance, eliminating the L1 modal entirely.

7. **Allergen-bearing recipes break Wall Card uniformity** *(focus-group surfaced — Sarah, allergen-paranoid parent; inherits Challenge 7 from canonical spec)*. The Wall Card's calm-typographic uniformity is right for most recipes but wrong for allergen-bearing ones. At the allergen moment, calm reads as casual. Allergen-bearing recipe pages MUST inherit the *guardrail-cleared* affordance from the canonical spec — a visible *"we triple-checked this"* element that breaks the page's uniformity exactly where safety requires friction. The spec must commit to this inheritance at component spec time (Step 7), not gesture at it.

8. **Re-guardrail contract on drag-drop swap** *(per John — inheriting Journey 5 lesson from canonical spec)*. Post-swap render is BLOCKED until the guardrail verdict returns. Intermediate state shows the affirmative-badge spinner, never a stale-cleared badge. This is the highest-consequence inheritance from canonical Challenge 7 and is binding for the swap endpoint design. Missing acceptance criterion in the original draft; added now.

9. **Wall Card vs. Opportunity 1 (ready-answer home)** *(per John — silent canonical Opportunity 1 violation)*. Each Wall Card affordance (mode toggle, *"I know this one,"* show-steps) costs taps against the canonical *"no inbox, no chat prompt, no launcher"* promise. Each affordance MUST either justify itself against PB&J or auto-default to the calmest state on open:
   - **Mode default: time-aware** — Finish if local time is before noon; Prep if after 5pm; last-used otherwise.
   - **Familiarity default**: respected from per-recipe persistent flag.
   - **Show-steps default**: derived from familiarity (familiar → collapsed).
   - **No active gestures required to reach cooking-relevant content on first open.**

10. **Calm time-budget surfacing** *(rewritten post Menon's soft-target confirmation)*. The dual budget is a SOFT TARGET for Lumi's planner, not a hard constraint. The planner prefers plans within budget but does not reject over-budget plans. The Brief renders the daily rollup time HONESTLY — no warning state, no color shift, no Lumi morning-of nudge when over-budget. If a week consistently runs over across multiple days, Lumi *may* offer a calm Sunday-batch suggestion (make-ahead swap, shared-mode promotion) — never an interrupt on a per-day surface. Honors anti-nudge doctrine. *(memory: cooking-time-budgets, parent-confidence-prevents-cafeteria)*

### Design Opportunities

Six opportunities, all compounding with product-level moves *(party-mode added surfacing rule to #2; added #6 from focus group)*.

1. **Time-budget as confidence builder.** Per-page minute estimates + stack-level daily rollup that say *"you can do this"* before the parent asks. Reassurance, not countdown. (Surfacing always-on; no overage alert per Challenge 10.)

2. **Prep-investment positive reinforcement loop — surfacing rule** *(per Mary — anti-nudge doctrine, Principle 1 Corollary 3b)*. *"Sunday prep saved you 12 min this morning"* ONLY surfaces on user-initiated retrospective views (tap into yesterday's card, retrospective surface). NEVER as an unprompted morning ribbon on today's Wall Card. The current mock at `/_dev-day-detail-multi-child` violates this surfacing rule; it must be revised before this spec ships.

3. **Two-mode page model as generalizable pattern.** The Prep/Finish toggle (filtering method by step.mode tag) is a clean primitive that may extend to other planning surfaces in future epics (grocery list, evening check-in, etc.).

4. **Calm typographic surface as differentiator.** Photo-heavy recipe apps (Mealime, Paprika, Allrecipes) compete on visual richness. HiveKitchen competes on cognitive restraint. The Wall Card's Penguin-page treatment is part of the *ambient Lumi* promise at the design-primitive level.

5. **Canvas drag-drop as the *fluid weekly scaffold* PRD promise made real.** The PRD claims plans are scaffolds, not contracts. Drag-drop swap (with undo) embodies that claim at the canvas level. It earns the promise with one gesture.

6. **Sunday-Batch View as future-state** *(focus-group surfaced — Anika, meal-prep enthusiast; out of scope for this spec)*. The meal-prep enthusiast segment lives in a weekly mental model, not daily. A weekly-aggregated batch view (*"This week's prep: 90 min total"*) is high-retention for that segment. The design must not actively prevent it: daily-rollup phrasing and per-page time-budget should remain compatible with future weekly aggregation (no daily-only data shapes that block summing across days).

## Spec Boundaries / Open Questions

Five items not solved in this spec, flagged so downstream specs can pick them up.

1. **Ingredient verification (pantry-check) is upstream of this spec.** Cafeteria-Defaulter Marcus's primary failure-trigger is realizing at 5:58am that he doesn't have ingredient X. The time budget is *"theatre without a pantry-check that says you have everything for this."* This belongs with grocery-list integration (a different epic), but the Wall Card must not assume the parent has verified ingredients — the design should allow a future ingredient-confidence affordance on each page without restructure.

2. **Partial-success affordance.** Devon (chaos-absorbing partner): *"I'm packing string cheese instead of cumin chicken — why does your app act like that's a failure?"* The current action bar offers `[Mark cooked]` as a binary success or `Change my mind` (which maps to *give up*). A third state — *packed with substitution* — is missing. Worth considering in Step 7 (Component Strategy) or deferring to a downstream story; flagging so it isn't lost.

3. **The Cafeteria-Defaulter persona's primary win-back lever is partially upstream.** Items 1 and 2 above are both load-bearing for Marcus's conversion. This spec serves him on the in-Wall-Card experience but cannot single-handedly win him back. Honest scoping.

4. **Cook familiarity data model is downstream** *(per Winston — scope correction)*. The cook_familiarity storage decision (new table vs JSON column vs denormalized on plan_items) is a solutioning concern for Epic 3, not a UX-spec concern. Removed from this spec's backend implications.

5. **Substitute behavioral data is unvalidated** *(per Mary's strategic concern)*. The spec's framing inherits PRD strategic positioning (PB&J + cafeteria, both real). It does not have beta-cohort behavioral data on which substitute correlates more strongly with week-4 churn. Recommended research: instrument both signals from week 1 of beta; revisit the load-bearing-claim wording once data emerges (~beta-week-6).

## Backend Implications The Spec Flags

*(Winston shaped these; cook_familiarity removed per his scope correction; budget enforcement softened per Menon's soft-target confirmation)*

- **Recipe entity**: `prepMinutes` + `finishMinutes` as first-class queryable numerics (NOT NULL on lazy-catalog fetch path per story 3-31). Per-step `mode` tag (`make-ahead` | `morning-of`) LLM-generated by the Recipe Agent with a curated fallback for the seed set.
- **Plan generation (story 3-7)**: target the dual budgets via prompt-as-constraint + post-hoc deterministic verification (sum in code, not LLM). Accept over-target plans as-is — no retry-to-exhaustion, no `budgetExceeded` rejection. The brief_state projection carries `daily_rollup: { finish_minutes, target_finish, prep_minutes, target_total }` as informational metadata; UI never alerts on overage.
- **Drag-drop swap endpoint**: `PATCH /v1/plans/:planId/days/:fromDay/swap-with/:toDay` — strong consistency, synchronous brief_state recompute inside the same transaction, idempotency key on `(planId, fromDay, toDay, sortedDateHash)`. Response body returns the updated brief_state to avoid a follow-up fetch. **Re-runs guardrail before returning new brief_state** (Challenge 8 contract). Stories 3-12 and 3-13 already established the projection pattern.

## Core User Experience

### Defining Experience

This spec has two coupled defining experiences, both inheriting from the canonical product-level *Sunday-evening open* but specifying it at the surface level:

**1. Glanceable cooking competence (Wall Card)** — the cook (any of the five moment-states) opens the day-detail and, within 1–2 seconds of first paint, knows four things: *what they are making, for whom, roughly how long it will take, and whether they need to read the method or already know it.* Every Wall Card page must answer those four questions before the parent has to scroll or tap. This is the moment that decides whether the parent proceeds to cook or reaches for the substitute.

**2. Fluid weekly scaffolding (Canvas drag-drop)** — the Sunday-open planner notices a schedule conflict on Tuesday, drags Tuesday's tile onto Friday, watches the swap settle, and feels the PRD's *"plans are scaffolds not contracts"* promise honored at the gesture level. Confidence in the plan is earned in this single interaction.

### Platform Strategy

Inherited from the canonical product-level spec (mobile web primary, no native, no PWA). This spec adds two device-specific contexts:

- **Phone propped on the kitchen counter** is the dominant Wall Card surface. Touch targets must be reliable with damp/floured hands. Typography must hold legibility from a 2–3 foot reading distance.
- **Phone or tablet in-hand on the canvas** is the dominant Sunday-open planner surface. Drag-drop must work on both touch (long-press to lift) and pointer (hover-handle grab).
- **Fridge/wall display is out of scope** for this iteration. The Wall Card design must not actively prevent a future render mode (e.g., no app-shell chrome that wouldn't scale to a kiosk).

### Effortless Interactions

Six interactions that must feel zero-thought, per Challenge 9 (Opportunity 1 inheritance):

1. **Opening the day-detail** — single tile tap from the canvas. No intermediate menu.
2. **Knowing the active mode** — time-aware default (Finish before noon, Prep after 5pm). The cook never has to *choose* a mode on open.
3. **Knowing the time investment** — visible meta line on every page (*"~5 min to pack · Made 6 times"*). Read in one glance.
4. **Moving between recipes** — horizontal swipe; pagination dots track scroll. No menu, no "next" button.
5. **Marking done** — single primary button. Mode-specific verb (`[✓ Done prepping]` / `[✓ Mark cooked]`).
6. **Swapping days** — direct drag-drop on the canvas with 5-second undo toast. The gesture *is* the intent.

### Intentional Friction (where effortlessness would betray)

Three places this spec keeps friction on purpose:

1. **Allergen-bearing recipes** — the *guardrail-cleared* affordance interrupts the page's typographic uniformity exactly where safety requires reassurance, not smoothness (Challenge 7).
2. **Post-swap render** — blocked until guardrail verdict returns; the affirmative-badge spinner is the friction that earns the parent's safety trust (Challenge 8). Never render a stale-cleared badge after a swap.
3. **Method when unfamiliar** — first-time recipes open with method expanded. The cook *should* read the steps before starting. Once they self-declare familiarity, the friction disappears.

### Critical Success Moments

Four moments that determine whether this spec succeeds or fails:

1. **First Wall Card open by a Partner-Handoff cook.** Devon walks in cold at 6:14am Wednesday. He didn't compose the plan. He sees the page and within 1–2 seconds either proceeds to cook or defaults to substitute. *This is the single most important moment the spec serves.* Acceptance criterion: a cold cook can begin cooking without reading anything outside the Wall Card.

2. **The first successful drag-drop swap.** Sunday-open planner notices Tuesday is busy, drags Tuesday onto Friday, watches both tiles glide past each other, sees the undo toast, closes it without using it. *This is the moment the "fluid weekly scaffold" promise becomes real.* Acceptance criterion: swap completes in <500ms perceived time, undo is reachable for 5 seconds, both days' guardrails re-clear before render.

3. **The familiar-recipe collapse moment.** Week-4 user opens the same pita recipe for the fourth time, method is auto-collapsed, ingredients still visible. They feel *"I know this"* — earned competence, not patronized. Acceptance criterion: familiarity-toggle persistence is per-recipe-per-household; week-4 user does not re-declare on every open.

4. **The honest-over-budget reveal.** Week-3 user opens a day showing *"Total to pack: 18 min"* (over the 15-min finish target). No warning state, no color shift, no Lumi nudge. The parent reads the honest number, decides whether to proceed, and the app respects their judgment. Acceptance criterion: no UI element communicates *judgment* on over-budget time; the number is presented as information, not alarm.

### Experience Principles

Six principles distilled from the brainstorm, focus group, and party-mode reviews. Each ties to a load-bearing project memory or canonical-spec inheritance. These are binding for the rest of the spec.

1. **Recipe always shown; method earns disclosure.** Recipe (dish, ingredients, portions, attribution) is visible without interaction. Method (how-to steps) appears only when the cook doesn't know it. *(memory: recipe-vs-method-distinction)*

2. **One screen, one cooking unit.** No multi-recipe co-presentation. Each unique recipe owns its full-screen surface. Pagination scales to the day's distinct recipe count. *(memory: shared-recipe-default; brainstorm convergence)*

3. **The cook commands the time; time doesn't command the cook.** Dual budgets (Finish ≤15 min, Total ≤40 min) are soft targets. The Brief surfaces actual time honestly without warning or alarm. *(memory: cooking-time-budgets; canonical anti-nudge doctrine)*

4. **Calm reads as casual at the allergen moment.** Allergen-bearing recipes break the page's typographic uniformity to communicate verification. The Wall Card's serenity yields to safety friction exactly where it must. *(canonical Challenge 7 inheritance; focus group: Sarah)*

5. **Direct manipulation over menus.** Canvas drag-drop replaces the "Swap a day" button and DisambiguationPicker L1. Tap-to-day-detail replaces the stealth-menu tile. The gesture is the intent. *(brainstorm; canonical Challenge 12 inheritance)*

6. **Auto-default to the calmest state on open.** Each affordance (mode toggle, familiarity, show-steps) defaults to the configuration requiring zero gestures to reach cooking-relevant content. *(Challenge 9 — Opportunity 1 honoring; per John)*

## Desired Emotional Response

### Primary Emotional Goals

The single emotional thread that ties this entire spec together: the tired parent reads the Wall Card and thinks, *"yes, I can absolutely do this."* That feeling — earned competence in the face of fatigue — is what the design is for. Everything else is in service of it.

Four primary emotional goals, ranked by load-bearing weight:

1. **Calm competence.** The parent opens the page and within 1–2 seconds feels equipped — not overwhelmed, not patronized, just *equipped*. This is the emotional reframe of Challenge 2 (multi-recipe co-presentation): cognitive load isn't just a cognitive problem, it's an emotional one. Removing load returns competence.

2. **Earned autonomy.** The app provides information; the parent makes judgments. The over-budget rollup, the no-prep-day silence, the substitution that the app doesn't notice — all of these communicate *"we trust you to know what's right for your household."* This is the emotional reframe of the anti-nudge doctrine.

3. **Trustworthy safety.** At the allergen moment, calm reads as casual. The Wall Card's uniformity yields to a visible *"we checked this"* affordance — and the parent feels the friction as reassurance, not interruption. This is the emotional translation of Challenge 7's *"reassurance, not warning"* canon.

4. **Gestural confidence on the canvas.** Drag-drop swap and tile-tap navigation make the parent feel they are *commanding* the week, not negotiating with a tool. The PRD promise of "plans are scaffolds, not contracts" is delivered as a felt experience the first time a tile glides under the parent's finger.

### Emotional Journey Mapping

Five emotional arcs across the moment-states defined in Step 2:

1. **The Partner-Handoff cook's first open (Devon, 6:14am Wednesday)** — *orientation → recognition → "I've got this."* The page tells him what to make, for whom, and how long. He starts cooking without backstory. No moment of "I don't understand this plan."

2. **The 9pm-prep cook's evening session (Priya, Monday 9pm)** — *intentional → focused → done.* She knows it's prep time. The mode toggle is already on Prep. She executes the make-ahead steps for tomorrow's pita, marks done, closes the app. No interruption from "tomorrow's bus is in 11 hours."

3. **The 6am-finish cook (the same Priya, Tuesday 6am)** — *brief → unhurried → packed.* The mode is already on Finish (time-aware default). The method is collapsed (familiar). The page shows *"~5 min to pack"* and she's done in 4. No anxiety about the bus.

4. **The Sunday-open planner swapping a day (Mike, Sunday 9:14pm)** — *notice → gesture → glide → confidence.* Tuesday is busy. He drags Tuesday onto Friday, watches the swap settle in 400ms, sees the undo toast appear and fade. He doesn't undo. He closes the app feeling the week is his.

5. **The week-4 familiar-recipe moment (any cook)** — *open → recognize → quiet pride.* The method is collapsed by their own self-declaration. Ingredients listed. No redundant instruction. They feel known by their own household, not lectured.

### Micro-Emotions (continuums)

Six axes the design must navigate, with the desired pole stated first:

- **Confidence > Confusion** — the four-things-in-1-2-seconds Wall Card open contract.
- **Trust > Skepticism** — honest over-budget time numbers; never massaged for comfort.
- **Calm > Anxiety** — no alerts, no warning states, no Lumi nudges on per-day surfaces.
- **Earned competence > Patronization** — familiar-collapsed method respects the cook's growing expertise.
- **Autonomy > Judgment** — substitution unspoken; absence of prep silent; over-budget surfaced but uncolored.
- **Capability > Frustration** — drag-drop "just works"; undo is always reachable for 5 seconds.

### Emotions To Avoid (the failure-state palette)

Six emotional failure modes the design must actively prevent:

- **Guilt** about not prepping ahead, about over-budget time, about substitution. The prep-investment feedback line that violated this (*"Sunday prep saved you 12 min"* on the morning ribbon) has been moved to user-initiated retrospective surfaces only.
- **Anxiety** about allergen safety. Friction reassures here; opacity terrifies.
- **Patronization** when the cook already knows the recipe. The familiarity toggle exists for this.
- **Helplessness** during the swap moment. Undo toast is the antidote.
- **Performance pressure** from time visibility. Soft targets + honest surfacing reframe the time as information, not evaluation.
- **Cold-start dread** for the Partner-Handoff cook. Recipe-always-shown is the antidote.

### Design Implications — Emotion → UX Choice

Direct emotion→design mappings binding for Steps 5–9:

- **Calm competence** → no photos, no animated chrome, typography-only, ingredients in scannable list form, method collapsed by default for familiar recipes.
- **Earned autonomy** → no warning states on overage, no streaks, no per-day Lumi interrupts, no "you should" copy anywhere on the page.
- **Trustworthy safety** → visible cleared-badge breaks page uniformity exactly at allergen-bearing recipes; post-swap render-block until guardrail clears.
- **Gestural confidence** → drag-drop with hover-handle (desktop) / long-press (touch), 500ms settle animation, 5s undo toast positioned to thumb-friendly bottom edge.
- **Familiar pride** → familiarity toggle persistence per-recipe-per-household; week-4 user opens the page in its calmest state without re-declaring.
- **Honest time** → daily rollup displays actual minutes regardless of target; no color-shifting; no countdown.

### Emotional Design Principles

Four binding principles for the rest of the spec, all distilled from the work above:

1. **Honor judgment, never grade.** Information is provided; opinions are withheld. The app shows what is; the parent decides what to do.

2. **Friction where safety lives, calm everywhere else.** Allergen verification breaks the page's serenity intentionally. Nothing else does.

3. **Earned silence over performed presence.** The familiar-collapsed method, the no-warning-state overage, the absent prep-feedback line on no-prep days — these communicate trust through *what is not said.* Silence is the design.

4. **Direct manipulation IS direct confidence.** Every gesture (drag-drop, swipe, tap, long-press) creates an immediate visible result, with undo available where reversal matters. Confidence in the system is built one gesture at a time.

## UX Pattern Analysis & Inspiration

### Inspiring Products Analysis

Five products whose UX choices directly inform this spec. Each is named for the *specific pattern* it solves, not because the product is broadly similar to HiveKitchen.

**1. New York Times Cooking (recipe presentation)**
The NYT Cooking app's recipe pages are the strongest in-category proof that calm typographic restraint outperforms photo-density for cook-mode use. The dish name dominates; ingredients are a clean list; the method is numbered with breathing room; the hero image is single and incidental rather than 8-up grid. *What works:* the page is legible from a counter-propped phone at 2–3 feet. *What we'd diverge on:* NYT still displays story-mode prose between method steps; the Wall Card cuts that out for the cook moment.

**2. Things 3 (gestural direct manipulation)**
Things 3 by Cultured Code is the gold standard for "the gesture is the intent." Drag a todo, the surrounding rows part smoothly, the dropped item settles in. No "are you sure?" modal. No confirmation. Undo is reachable via swipe. *What works:* the parent's emotional sense of agency comes from the smoothness of the gesture, not the dialog confirming it. *What we adopt:* the 400ms settle animation cadence and the silent-but-reversible undo pattern map directly to canvas drag-drop swap.

**3. iA Writer (mode-based filtering)**
iA Writer's Focus Mode dims everything except the current paragraph. It's a *mode* the writer enters and exits — not a setting buried in preferences. The Prep/Finish toggle serves the same purpose: filter the surface to the cook's current activity without relocating to a new screen. *What works:* mode toggle visually changes the page in real-time and is one tap from any state.

**4. Apple Books / Penguin Classics typography**
Apple Books (and Penguin's print typography that inspired it) demonstrates that pure typography can carry significant content density without feeling cluttered. The serif italic title, sans body, calm-cream backgrounds — these are not aesthetic preferences but *functional choices that reduce cognitive load on focused-reading surfaces.* *What we adopt:* the typographic hierarchy directly; the Wall Card IS a typographic reading surface for cooking.

**5. Linear (planning-canvas direct manipulation)**
Linear's project/issue boards demonstrate that direct manipulation on a planning canvas (drag, drop, reorder, undo) scales emotionally for the user from "small adjustment" to "meaningful weekly reorganization" without any UI weight added. *What works:* the canvas feels *alive* under the user's hand without any animation theatrics. *What we adopt:* the hover-handle affordance on desktop, the long-press-to-lift on touch, the undo positioned where the thumb naturally lands.

### Transferable UX Patterns

Three pattern categories, mapped to specific spec challenges:

**Navigation Patterns**

- **Paginated single-content-unit pages** *(from NYT Cooking + Apple Books)* — solves Challenge 2 (multi-recipe co-presentation) by giving each unique recipe its own full-screen real estate. The pagination dots are the only navigation needed.
- **Tap-to-detail with no intermediate menu** *(from Linear, Things 3)* — solves Challenge 6 (tap→conversation handoff without modal). The canvas tile IS the navigation; no DisambiguationPicker, no "what would you like to do?" prompt.

**Interaction Patterns**

- **Drag-drop with hover-handle + long-press, silent-and-reversible** *(from Things 3, Linear, iOS home screen)* — the gestural confidence foundation for canvas swap. Critical detail from Things 3: the lift animation visually communicates "this is now mobile" before the user has fully committed to the drag.
- **Mode toggle that filters the visible content in-place** *(from iA Writer Focus Mode)* — solves the Prep/Finish challenge without forcing the cook to navigate to a different screen.
- **Collapsible secondary content via single tap** *(from NYT Cooking, Apple Books bookmarks)* — the show-steps / hide-steps toggle is a known pattern; familiarity-driven default state is the novel layer this spec adds.

**Visual Patterns**

- **Pure typography over photography** *(from NYT Cooking, Apple Books, Penguin)* — honors the emotional goal of *calm competence* and the design constraint of no-copyrighted-photos.
- **Warm-cream + serif italic + restrained sans** *(from Penguin Classics, NYT Cooking editorial)* — supports the *"ambient Lumi"* canonical promise at the typographic level.
- **Single-color-accent semantic system** *(from Things 3 — yellow stars only on important items, otherwise grayscale)* — for HiveKitchen, this means amber-warm is the one color that acts; everything else is fg / fg-muted / surface. Allergen friction uses the sacred color (also a known canonical-spec color) to break uniformity.

### Anti-Patterns to Avoid

Six patterns common in the cooking-app and family-app categories that this spec must actively reject. Each conflicts with at least one of our six emotional principles or six design principles.

1. **Photo-heavy recipe pages (Mealime, Yummly, Allrecipes, Tasty).** Hero photo + step photos + finished plate + ingredient mosaic = cognitive density. Conflicts with Principle 4 (calm typographic) and the *cognitive-load-equals-cafeteria-default* memory. Also a copyright minefield at scale.

2. **Streak / badge / gamification overlays (Duolingo, Habitica, Strong, MyFitnessPal).** Any "you've prepped 4 days in a row" or "5-day cooking streak" mechanic violates *Principle 3 (earned silence over performed presence)* and the canonical anti-nudge doctrine. The temptation to gamify is real because retention metrics improve short-term — and degrade trust long-term.

3. **Color-coded judgment (MyFitnessPal red/yellow/green calorie scoring, Yuka food rating).** Conflicts with the *honest time, never graded* emotional implication. Over the 15-min finish target → calm slate-fg, not amber, not red.

4. **Confirmation modals before reversible actions (most enterprise software).** "Are you sure you want to swap Tuesday and Friday?" violates *Principle 5 (direct manipulation IS direct confidence).* The undo toast is the only confirmation pattern acceptable for reversible actions.

5. **Tabbed navigation when content is naturally sequential (most recipe apps' ingredients/method/notes/reviews tabs).** Conflicts with *Principle 1 (recipe always shown; method earns disclosure)* — recipe and method live in one vertical scroll, not separate tabs.

6. **Social-proof clutter (Tasty's "X ratings, Y reviews, Z comments" headers; most recipe blogs' Pinterest-share / Print / Save buttons).** Conflicts with the *first 1–2 seconds of paint* Wall Card open contract from Step 3. Every non-content element in the cook's eyeline costs glanceability.

### Design Inspiration Strategy

Three buckets, each tied to specific spec sections that follow.

**What to ADOPT directly:**

- **Penguin / NYT Cooking typographic hierarchy** for the Wall Card (Step 7 component spec, Step 8 polish).
- **Things 3 / Linear drag-drop interaction model** for canvas swap (Step 7 component spec, Step 8 polish).
- **iA Writer Focus Mode toggle pattern** for the Prep/Finish toggle (Step 7).
- **Apple Books pagination dots + horizontal scroll-snap** for the Wall Card swipe stack (Step 7).

**What to ADAPT (modify before applying):**

- **NYT Cooking's recipe page** — adopt the typographic restraint, BUT cut story-mode prose between method steps. The cook-moment surface has no time for editorial voice.
- **Things 3's undo toast position** — adopt the gentle reversibility, BUT position the undo at the thumb-friendly bottom edge for phone (Things 3 positions it at top, which works on desktop but not on a counter-propped phone with one-handed glances).
- **Linear's hover-handle** — adopt for desktop, BUT add a long-press alternative for touch (Linear's touch experience is weaker than desktop; we can't inherit that gap).

**What to AVOID actively:**

- Photo-heavy presentation (any recipe imagery beyond the future-deferred render-mode).
- Streaks, badges, points, levels, social-proof headers.
- Color-coded judgment on any time or completion metric.
- Confirmation modals on reversible gestures.
- Tabbed navigation within a single cooking surface.

This strategy keeps the Wall Card and canvas inheriting the *best-in-class* patterns from each domain without inheriting any of the category's well-known UX failures.

## Design System Foundation

### Design System Choice

**Inherit the existing canonical design system: `docs/DESIGN.md` v2.0** (warm-neutral palette, Honey rule, button taxonomy, StickyBottomBar pattern, 17 locked components, post-γ migration as of May 2026). This spec does **not** introduce a new design system — it composes the Wall Card and canvas drag-drop from the existing system's tokens and primitives, and adds a small set of domain-specific components for the cooking surface.

This is the only design-system choice consistent with HiveKitchen's product positioning. The canonical product-level UX spec (complete 2026-04-22) and `docs/DESIGN.md` v2.0 are both binding context; the Day-detail Unclog operates inside that frame.

### Rationale for Selection

Three reasons the canonical system is the correct foundation:

1. **The brand is the typography.** The warm-cream + serif italic + restrained sans identity that DESIGN.md v2.0 codifies is the exact visual idiom this spec needs for the Wall Card (per Step 5 inspiration analysis — Penguin Classics + NYT Cooking + Apple Books). Choosing a different system would require re-establishing the brand on a sub-surface, which would itself degrade the product-level coherence.

2. **The action vocabulary already exists.** Button taxonomy (`PrimaryButton`, `SecondaryButton`, `TalkToLumiButton`) and the `StickyBottomBar` pattern from DESIGN.md v2.0 already serve the Wall Card's mode-action bar (`[✓ Mark cooked]`, `[✓ Done prepping]`, secondary text links). No new button system is required.

3. **The safety-color contract is canonical.** The *sacred* color token is bound to safety/clearance affordances by the canonical Challenge 7 inheritance. The Wall Card's allergen-bearing recipe pages MUST use the sacred color for the guardrail-cleared badge — that contract lives at the design-system level, not at the spec level. Inheriting the system inherits the contract.

### Implementation Approach

The canonical system covers ~90% of this spec's component needs through existing tokens and primitives. The remaining ~10% is a small set of **new domain-specific components** that compose from existing tokens — they are extensions to the system, not parallels.

**Composed from existing (no new primitives needed):**

- Action bar via `StickyBottomBar` + `PrimaryButton` + secondary text link
- Mode-action verbs as existing button primitives
- Allergen-cleared badge inherits from canonical safety affordance (Challenge 7)
- Day tile on the canvas uses existing `PlanTile` primitives + drag-handle affordance
- Page header / day-detail navigation via existing `DetailHeader` + `PageHeader`

**New domain components this spec introduces** (to be added to DESIGN.md v2.1 once the spec ships):

1. **`WallCardSwipeStack`** — paginated swipe container; one `WallCardPage` child per unique recipe; manages `mode` state + `activePage` index; renders header (mode toggle), horizontal scroll-snap content, footer (pagination dots + daily rollup + action bar + prep-investment feedback).
2. **`WallCardPage`** — single-recipe full-screen content composition; renders eyebrow + dish title + attribution line + meta line (time budget + confidence cue) + ingredients section + collapsible method section.
3. **`ModeToggle`** — Prep | Finish pill, segmented control style, single-color-accent on active half (amber-warm) per Step 5's *single-color-accent semantic system*.
4. **`PaginationDots`** — scroll-position-tracked horizontal dots, sub-pixel-sized (`h-1.5 w-1.5`), amber-warm active / border-muted inactive.
5. **`TimeBudgetMeta`** — single-line meta string, mode-aware verb ("to pack" / "to prep"), inline with confidence cue and middot separator.
6. **`AttributionLine`** — text-only subtitle ("For Aarav, Mira & Kabir · × 3"), no chips, no dots; per the brainstorm decision to drop attribution chips.
7. **`DailyRollup`** — single-line total ("Total to pack: 6 min"), uppercase tracking, sub-text scale; reads from sum of recipes' active-mode minutes.
8. **`PrepInvestmentFeedback`** — italic muted single-line ("Sunday prep saved you 8 min this morning"), surfaces in Finish mode + retrospective contexts only per Mary's anti-nudge surfacing rule.
9. **`DragHandle`** *(for canvas tiles)* — six-dot grip top-start of tile; visible on hover (desktop) and on long-press lift state (touch).
10. **`UndoToast`** *(for canvas drag-drop swap)* — bottom-edge, thumb-friendly, 5-second duration, single text + Undo action; auto-dismiss after timeout.

All ten compose from existing DESIGN.md v2.0 tokens (`bg`, `fg`, `fg-muted`, `amber-warm`, `sacred`, `border`, `surface`, `foliage`, `lumi-terracotta`). No new color tokens, no new typography scale.

### Customization Strategy

**No customization of the canonical system is required.** The Wall Card and canvas drag-drop fit cleanly inside the existing v2.0 token system. The only system-level extension is the addition of the ten new components above to DESIGN.md v2.1 when this spec ships.

The Honey rule (DESIGN.md §7 — amber-warm is the only acting color; secondary actions use muted text resolving to amber-warm on hover) is honored throughout the new components. The button taxonomy is honored (PrimaryButton for mode-action verbs; secondary text links for "Change my mind ↗" and "Skip prep tonight ↗"). The StickyBottomBar pattern is the shell for the Wall Card's mode-action bar (with caveats — see Step 7 for the dev-mock non-sticky variant used during exploration).

**One open governance question** *(flagged for downstream resolution, not for this spec)*: when this spec ships and the ten new components land in `apps/web/src/components/`, DESIGN.md v2.1 should be updated in the same PR to lock them as canonical. The "updated-spec-in-same-PR" hygiene is a canonical-spec contract; we just need to follow it when shipping.

## 2. Core User Experience (mechanical specification)

### 2.1 Defining Experience

**The Partner-Handoff cook's first Wall Card open at 6:14am Wednesday.**

Of every interaction this spec covers, one decides whether the spec succeeds or fails: the moment a partner-handoff cook (Devon — Step 2 persona) opens the day-detail surface cold, having not composed this week's plan, and either *proceeds to cook* or *defaults to substitute.* If we nail this single first-open moment, every other surface follows. If we miss it, no amount of polish elsewhere recovers.

The companion defining experience — *Sunday-open planner's first drag-drop swap on the canvas* — is the gestural earner of the PRD's "fluid weekly scaffold" promise. It is documented as the Sister Mechanic in §2.5 because the same direct-manipulation principle crosses both surfaces.

### 2.2 User Mental Model

The Partner-Handoff cook does not bring a *"let me figure out what's planned"* mental model. They bring a *"show me what to make"* model — explicit, terse, expectant. Three mental-model anchors:

1. **The parent expects a ready answer, not a configurable surface.** They are walking into the kitchen, not into an app. Configuration, choice, composition — all of that was supposed to happen elsewhere (Sunday-evening planning, Lumi's autonomous work). The Wall Card's job is to *present* a finished answer.
2. **The parent expects the answer at glance distance, not reading distance.** The phone is propped 2–3 feet away on the counter. Anything below the first viewport must be secondary; the cook should be able to commit to the recipe before scrolling.
3. **The parent expects autonomy on judgment, not opinion from the system.** If the recipe takes 18 minutes and the cook has 12, the cook decides. The app does not.

**Where the parent currently struggles** (today's pre-unclog day-detail mock):
- Co-presented recipes force scanning across multiple cooking units
- Why-Lumi-chose / source / allergen-card chrome competes with the cooking-relevant content
- Action bar verbs (`Keep this lunch` / `Swap to something else`) speak to planning-time concerns, not cooking-time decisions

The Wall Card unclog removes each of these frictions at the mental-model level — one recipe per screen, no explanatory chrome, mode-aware verbs that match the cook's current activity.

### 2.3 Success Criteria

Five binding acceptance criteria for the first-open moment. These transition to acceptance criteria on the implementation story when this spec hands off.

1. **Page paints in <500ms perceived time** from tile-tap on the canvas to first meaningful render of the Wall Card's first page. Server-rendered or pre-fetched; the route transition itself is a sub-300ms animation, but the content must be ready.
2. **Within 1–2 seconds of first paint, the cook can identify** *what they are making, for whom, roughly how long it will take, and whether they already know it.* This is the four-things contract from Step 3.
3. **No active gesture is required to reach cooking-relevant content.** Mode is time-aware-defaulted; familiarity defaults from the per-recipe persistent flag; method shows or hides based on familiarity, not on cook action.
4. **The cook can begin cooking without scrolling below the first viewport** on a typical phone (375pt wide, 667pt tall). Ingredients + meta line + dish title fit above the fold for the first page in both Prep and Finish modes.
5. **The cook does not navigate away to find missing context.** No information needed for the cook moment (allergen verification, dietary fit, child preference confirmation) requires leaving the Wall Card.

### 2.4 Novel vs. Established Patterns

**Established patterns this experience reuses** (from Step 5 inspiration analysis):

- Paginated single-content-unit pages (NYT Cooking + Apple Books)
- Mode toggle that filters visible content in-place (iA Writer Focus Mode)
- Collapsible secondary content via single tap (NYT Cooking, Apple Books bookmarks)
- Typographic-first reading surface (Penguin / Apple Books)
- Sticky bottom action bar with primary + secondary verbs (StickyBottomBar pattern from DESIGN.md v2.0)

**Novel patterns this experience introduces:**

- **Recipe-vs-Method visibility distinction via self-declared familiarity.** No competitor in the recipe-app space currently separates the *what* (always shown) from the *how* (conditionally shown by familiarity). Most recipe apps either show everything always (Mealime, Allrecipes) or hide nothing (NYT Cooking with its collapsible Notes section, but ingredients always inline with method).
- **Mode-aware default (time-of-day inferred).** Mode toggles in other apps are user-driven or last-used; here the mode reads the local time and presents Prep or Finish accordingly. Last-used is the secondary fallback when local time is in the ambiguous noon–5pm window.
- **Time-budget meta line as confidence cue.** Most recipe apps surface time as a *prep duration* metadata at the top of the recipe (e.g., NYT Cooking's "1 hour" label). This spec surfaces it as *the cook's question answered* — "~5 min to pack" reads as reassurance, not as a clock.

**Pattern combination strategy:** the novel patterns sit *inside* the established visual frame. The cook recognizes the page as "a recipe page" within milliseconds; the novel layering reduces friction without requiring user education.

### 2.5 Experience Mechanics

#### 2.5.1 Main Mechanic — Wall Card First-Open

**Initiation.**
- Parent taps a day tile on the BriefCanvas weekly grid. No long-press, no menu — single tap. Tile shows momentary `:active` state (subtle scale-down to 0.97, 80ms) to confirm the tap registered.
- Route transition: slide-in from the trailing edge (start side on RTL), 250ms ease-out. The DetailHeader paints first, content underneath.

**Interaction.**
- On first paint of the WallCardSwipeStack:
  - `ModeToggle` reads local time. Pre-noon → Finish. Post-5pm → Prep. Noon–5pm → last-used (defaulted to Finish if no prior state).
  - `WallCardPage` for the first recipe renders immediately with: eyebrow ("Main meal") + dish title (large serif italic) + attribution line ("For Aarav, Mira & Kabir · × 3") + meta line ("~5 min to pack · Made 6 times") + ingredients list ("You'll need").
  - Method section renders below the fold. Collapsed if `familiarityKnown == true`. Expanded otherwise (for first-timers).
  - `PaginationDots` at footer if N>1 recipes for the day.
  - `DailyRollup` shows mode-aware total ("Total to pack: 6 min").
  - `ModeActionBar` shows mode-specific verbs: Finish → `[✓ Mark cooked]` + `Change my mind ↗`; Prep → `[✓ Done prepping]` + `Skip prep tonight ↗`.
- Cook can swipe horizontally to next recipe page. Snap-points at page boundaries; scroll-position tracked into `PaginationDots` active state.
- Cook can tap `Show steps ▾` / `Hide steps ▴` to toggle method expansion. State persists for the session; persistent familiarity flag updates on `Mark cooked` (Step 9 to spec the persistence contract).

**Feedback.**
- The meta line is the primary confidence affordance. Cook reads it once and forms a judgment: *"I have ~5 min, I know this one, let's go."*
- No loading spinners on first paint (content is pre-fetched). If a sub-resource (e.g., the per-step mode tag) is missing, the page shows the recipe + a calm sub-line ("Method is being prepared — open again in a moment") and never blocks the cook.
- On `Mark cooked`, the primary button transitions to a confirmed state (filled with amber-warm + check icon swap to filled), 250ms, then the route returns to the canvas. The tile on the canvas shows a quiet checked state on next render.

**Completion.**
- Cook taps `[✓ Mark cooked]`. Action confirms in-place (no modal). Route returns to the canvas. No "successfully marked" toast (per Mary's anti-nudge rule — silence is confirmation enough).
- Cook may swipe to next recipe page mid-session without marking the current one done. No state is lost; familiarity / method-expanded preferences persist.

#### 2.5.2 Sister Mechanic — Canvas Drag-Drop Swap

**Initiation.**
- Desktop: parent hovers a day tile. After ~150ms of hover, a six-dot `DragHandle` appears at the top-start corner of the tile (no layout shift; absolute-positioned inside the tile).
- Touch: parent long-presses any part of the tile for 350ms. The tile enters a *lift* state — subtle scale-up to 1.02, elevated shadow, very slight rotation (1° random), haptic feedback (where supported, single light tap).

**Interaction.**
- Lifted tile follows the pointer/finger. Adjacent tiles softly part to indicate valid drop zones. Paused days show a dimmed/no-drop cursor on hover.
- Drop completes when the parent releases over a target tile (swap target). Both tiles glide to their new positions via a 400ms ease-in-out animation. No drop animation if released over the original tile (cancel).

**Feedback.**
- During lift: dragged tile is amber-warm-tinted at the border (no fill change — just a hairline accent) to indicate active manipulation.
- During hover-over-target: target tile shows a same-color tint on its border (and the pre-existing content briefly dims to indicate "this slot will accept the swap").
- On drop completion: the swap-settle animation is the primary confirmation. Simultaneously, an `UndoToast` appears at the bottom edge of the viewport for 5 seconds: *"Tuesday ↔ Friday swapped"* with an `Undo` button.
- Behind the scenes: the swap endpoint runs guardrail re-evaluation. If either day's guardrail does NOT clear within the swap-settle animation duration (~400ms), the tiles show their `AllergyClearedBadge` in a spinner state until clearance returns. Pre-swap badges are NOT shown stale.

**Completion.**
- After 5 seconds: `UndoToast` dismisses. Swap is committed.
- If parent taps `Undo` within the window: tiles return to their original positions via the reverse 400ms animation. Brief_state recomputes back to the prior state.
- If guardrail re-evaluation fails (rare; safety-blocked swap): the swap rolls back automatically with a calm `UndoToast` replacement message: *"Swap couldn't be completed — [day] needs a different recipe to be safe."* This is the only error-state messaging in the swap flow.

#### 2.5.3 Mode Transitions Within a Day-Open Session

The cook may mid-session tap the `ModeToggle` to switch from Finish to Prep (or vice versa). When this happens:
- Active mode-action bar verbs swap inline (no animation; just a label change)
- Method steps filter live to the new mode's tagged steps
- Daily rollup recomputes to the new mode's total
- Pagination state and current page index are preserved

No round-trip to the server is needed for a mode toggle — all mode-tagged data is already in the brief_state projection.

## Visual Design Foundation

This spec **inherits** the canonical visual foundation from `docs/DESIGN.md` v2.0 — warm-neutral palette, editorial serif + refined sans typography, honey-tinted accents on calm-cream backgrounds. No new tokens are introduced. The work in this section is specifying how the *new domain components* (Step 6 §10) compose from those tokens for the Wall Card and canvas drag-drop surfaces.

### Color System

**Inherited token usage** for the day-detail unclog surfaces:

| Component / Element | Token | Usage |
|---|---|---|
| Wall Card page background | `bg` | Default warm-cream foundation; matches DetailHeader |
| Dish title, ingredients, method steps | `fg` | Primary readable text |
| Eyebrow labels, attribution, meta line, pagination dots (inactive) | `fg-muted` | Calm secondary text and de-emphasized affordances |
| Active mode-toggle half, primary CTA fill, amber accents on bullets and method numbers | `amber-warm` | The one acting color (Honey rule) |
| Allergen-cleared badge, guardrail-cleared affordance | `sacred` | Reserved for safety-clearance per canonical Challenge 7 |
| Component card chrome (WallCardSwipeStack outer border, kid-name color dots in attribution) | `border`, `foliage`, `lumi-terracotta`, `sacred` | Subtle structure + child-attribution colors |
| Inactive method state, scroll-snap background | `surface`, `surface-2` | Subtle layered surfaces |
| Loading / spinner states on allergen badge during swap re-evaluation | `safety-cleared-200`, `foliage-300` | Per canonical Story 3.10 pattern |

**Tokens NOT used in this spec** (intentional restraint):

- **No `destructive` / `safety-red`** — the spec has no destructive UI surface. Over-budget time is calm-fg, not warning. The "couldn't swap" error message in the UndoToast uses muted-fg, not red.
- **No `honey-accent` for primary actions** — the Honey rule (DESIGN.md §7) reserves it for one specific affordance; the Wall Card's primary CTA uses `amber-warm` per the canonical PrimaryButton.
- **No custom color introductions.** If a future need surfaces (e.g., a "make-ahead vs morning-of" color-coding for method steps), it deserves canonical-system discussion, not local invention.

### Typography System

**Inherited typography scale** from `docs/DESIGN.md` v2.0. The Wall Card uses the following specific applications (referencing DESIGN.md token names where they exist; explicit pt/px values where the spec needs specificity beyond DESIGN.md's general scale):

| Element | Typeface family | Style | Size | Rationale |
|---|---|---|---|---|
| Dish title (`WallCardPage` headline) | Serif (editorial) | Italic | `text-3xl` (≈30pt) | Penguin-page anchor; the most visually authoritative element on the page |
| Slot eyebrow ("MAIN MEAL", "SNACK") | Sans (refined) | Medium, uppercase | `text-[10px]`, tracking-[0.25em] | Quiet pre-headline label; uppercase tracking signals categorization without weight |
| Attribution line ("For Aarav, Mira & Kabir · × 3") | Sans (refined) | Regular | `text-sm` | Subtitle to the dish title; close enough to feel attached, light enough not to compete |
| Meta line ("~5 min to pack · Made 6 times") | Sans (refined) | Regular | `text-xs` | The confidence cue; deliberately small to feel ambient |
| "You'll need" / "How to make it" section headers | Sans (refined) | Medium, uppercase | `text-[10px]`, tracking-[0.25em] | Echo the eyebrow style for visual coherence |
| Ingredients list | Sans (refined) | Regular | `text-base` (≈16pt) | Primary readable content; comfortable for 2–3 foot reading distance |
| Method step text | Sans (refined) | Regular, leading-relaxed | `text-base` | Same as ingredients; comfortable scanning |
| Method step numbers (in amber-circle markers) | Sans (refined) | Semibold | `text-xs` | Inside the circle marker; doesn't need to be loud |
| Daily rollup ("TOTAL TO PACK: 6 MIN") | Sans (refined) | Medium, uppercase | `text-[11px]`, tracking-[0.2em] | Calm summary; uppercase tracking matches the eyebrow style for footer-as-quiet-header feel |
| Prep-investment feedback ("Sunday prep saved you 8 min this morning.") | Sans (refined) | Italic | `text-[11px]` | Most muted line on the page; italic distinguishes it as commentary rather than instruction |
| Action bar primary label ("Mark cooked", "Done prepping") | Sans (refined) | Bold | `text-sm` | Inherits PrimaryButton typography from DESIGN.md v2.0 |
| Action bar secondary link ("Change my mind ↗") | Sans (refined) | Medium, uppercase | `text-[11px]`, tracking-widest | Inherits secondary-link typography from canonical TalkToLumiButton-adjacent pattern |

**Type hierarchy intent** (descending visual weight):
Dish title → Section headers / eyebrows → Ingredients & method body → Attribution & meta → Pagination & rollup → Prep-investment commentary.

This hierarchy reflects the *temporal hierarchy* of the cook's attention: dish identity first (what am I making), context second (for whom, how long), execution third (ingredients, method), summary last (rollup, prep payoff).

### Spacing & Layout Foundation

**Inherited spacing rhythm** from `docs/DESIGN.md` v2.0 (Tailwind 4pt-base scale: `gap-1` = 4px, `gap-2` = 8px, … `gap-8` = 32px, etc.). 

**`WallCardPage` internal spacing:**
- `space-y-8` (32px) between header / image / sections
- `space-y-3` (12px) within the header block (eyebrow, title, attribution, meta)
- `space-y-2.5` (10px) between ingredient items
- `space-y-4` (16px) between method steps (gives breathing room for multi-sentence steps)
- `px-6 py-10` (24px horizontal, 40px vertical) page padding

**`WallCardSwipeStack` shell spacing:**
- Outer card: `rounded-2xl border border-border/30` (canvas-card chrome)
- Header (ModeToggle): `border-b border-border/20 px-6 py-4`
- Footer (PaginationDots + DailyRollup + ActionBar + PrepFeedback): `border-t border-border/20 px-6 py-5`, internal `gap-4` between footer sub-elements
- `max-w-lg` on the stack (≈512px) — comfortable for phone-propped reading; expands to full width on mobile, constrained on tablet/desktop

**Layout principles:**

1. **Vertical rhythm respects the cook's scan path.** Generous vertical space between sections (`space-y-8`) creates clear visual segments; tight space within sections (`space-y-2.5` to `space-y-4`) keeps related content grouped.
2. **Horizontal padding is generous on the page (`px-6`), tight on the swipe stack header/footer.** This keeps the recipe content centered and legible while the chrome (mode toggle, rollup, action bar) reads as compact ambient information.
3. **No grid system imposed.** The Wall Card is a vertical reading surface; columns would fragment the cook's scan. The canvas IS a grid (the 5-day weekly tile row), but that grid is inherited from BriefCanvas, not introduced here.

**Canvas drag-drop spacing:**
- Day tiles inherit BriefCanvas grid spacing (single row, 5 cells, evenly distributed)
- Drag-handle position: `top-2 start-2` (8px from top-start corner, inside the tile)
- UndoToast: `bottom-6 inset-x-6` (24px from edges); on phone, `max-w-md`; on desktop, `max-w-lg`

### Accessibility Considerations

Five binding accessibility commitments for this spec (in addition to canonical DESIGN.md §10 — Accessibility):

1. **Touch target sizes ≥44pt.** All interactive elements (mode toggle halves, page-tile, action-bar buttons, show-steps toggle, undo button) meet or exceed 44pt minimum dimension. Pagination dots are decorative; pagination is reachable via swipe (touch) and arrow keys (keyboard).
2. **Keyboard navigation across the swipe stack.** Left/right arrow keys advance pagination on focused stack. Tab key cycles through ModeToggle → show-steps toggle → action bar primary → action bar secondary. Enter/Space activate the focused element.
3. **Reduced-motion respect.** All animations (route slide, drag-drop lift, swap-settle, undo toast fade, mode-toggle transition) check `prefers-reduced-motion`. When reduced, transitions are instantaneous or replaced with a 50ms opacity fade.
4. **Screen-reader semantics.** ModeToggle has `role="tablist"` with `role="tab"` halves and `aria-selected` state. PaginationDots are `aria-hidden` (decorative); the live "page X of Y" is announced via an `aria-live="polite"` region on swipe. UndoToast has `role="status"` for arrival announcement; the Undo button has explicit `aria-label="Undo Tuesday and Friday swap"`.
5. **Contrast compliance.** All text-on-bg combinations meet WCAG 2.1 AA at minimum (4.5:1 for body, 3:1 for large text). The amber-warm-on-bg combinations used in primary CTA and method-step numbers are validated by canonical DESIGN.md token contrast tests — no new combinations introduced here.

**Allergen-bearing recipe accessibility** (one additional commitment specific to Challenge 7):
- The guardrail-cleared affordance MUST NOT rely solely on the sacred color to communicate safety state. The badge includes a visible icon (the canonical checkmark) and a text label ("Cleared for [allergen]") readable to colorblind users and screen readers. This is canonical AllergyClearedBadge inheritance (Story 3.10 + product-level Challenge 7).


---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: []
session_topic: 'Day-detail screen for HiveKitchen — cognitive load problem at the cooking moment'
session_goals: 'Explore alternative structural framings for what a day-detail screen IS and how it should sequence the cook''s attention. Surface novel structural ideas that escape the "one screen = one full day of recipes" frame the current mock inherits.'
selected_approach: 'progressive-flow'
techniques_used: ['what-if-scenarios (complete)', 'mind-mapping (complete)', 'first-principles-thinking (complete)', 'decision-tree-mapping (complete)']
ideas_generated: ['Round 1: 8 seeded (4 picked)', 'Round 2: 11 seeded (1 picked, voice/photo constraints surfaced)', 'Round 3: 8 in-constraint variations', 'Phase 2 clusters: 7 directional families, 4 in-scope (A B C D), E+F pulled in', 'Phase 3 resolutions: 9 truths revised (1 dropped, 2 reframed), 6 sub-questions resolved', 'Phase 4 output: single buildable Wall Card concept']
session_outcome: 'Wall Card design committed: paginated full-screen typographic per-unique-recipe surface with Prep/Finish mode toggle, self-declared familiarity hiding method, mode-specific action verbs. Awaiting user choice: rebuild mock (A) or invoke CU for spec (B).'
context_file: ''
---

# Brainstorming Session Results

**Facilitator:** Sally (UX Designer persona, via Menon)
**Date:** 2026-05-27

## Session Overview

**Topic:** Day-detail screen for HiveKitchen — cognitive load problem at the cooking moment

**Goals:** Explore alternative structural framings for what a day-detail screen IS and how it should sequence the cook's attention. Surface novel structural ideas that escape the "one screen = one full day of recipes" frame the current mock inherits.

### Context Guidance

**Persona:** Sally — empathetic UX advocate who paints pictures with words, balances creative storytelling with edge-case attention.

**The cook's moment:** Tuesday 6am. Parent half-awake, knife in hand, phone propped on the kitchen counter. Needs to make lunch for 1–3 kids before school bus.

**What we've already locked down (project memory):**
- *Shared recipe is the default* — households cook ONE main meal for all kids by default; only snacks may diverge. Day-level consistency rule: all slots shared OR all slots split.
- *Day-detail is cooking, not explanation* — recipe + method, no why-Lumi/source/nutrition cards, no Keep/Swap/Pause planning verbs in the cook's eyeline.

**What we built and rejected (twice):**
1. First mock: hero image + ingredients + side-by-side attribution chips + 4-card rail of safety/allergen/why/source + Keep/Swap/Pause. **Rejected for cognitive load.**
2. Rebuild (cooking-only): dish name + meta row + image + ingredients/method side-by-side + Mark cooked. **Still rejected for cognitive load.**

**The structural diagnosis we're brainstorming around:**
- Even stripped to recipe + method, the screen shows 2–6 full recipes co-presented (shared day = 2 recipes; split day = up to 6).
- Cookbooks and recipe apps don't co-present multiple recipes — one recipe per page.
- Within a recipe, ingredients and method shouting equally is a flat layout that ignores the sequential nature of real cooking.

### Three Open Questions Driving the Session

1. **What is the right unit of a "day-detail" screen?** Whole day, single slot, single recipe, single step?
2. **Within a recipe, how do we structure the cook's attention over time?** Static page vs. stepped/wizard vs. something else?
3. **For multi-child split mode, do we co-present all kids' days or sequence through screens?**

### Session Setup

Facilitator selected approach: **Progressive Technique Flow** (Sally-facilitated, 4 phases)

## Technique Selection

**Approach:** Progressive Technique Flow

**Journey Design:** Systematic creative progression from wild divergence → patterned themes → first-principles rebuild → committed direction.

**Progressive Techniques:**

- **Phase 1 — Expansive Exploration:** *What If Scenarios* — break the inherited screen-frame entirely; aim for 30+ wild ideas before any patterning.
- **Phase 2 — Pattern Recognition:** *Mind Mapping* — cluster the wild ideas by emerging affinity (modality, temporal flow, unit of presentation, etc.) into 3–5 directional families.
- **Phase 3 — Idea Development:** *First Principles Thinking* — take the top 2–3 directional families and rebuild them from the fundamental truths of the 6am cooking moment.
- **Phase 4 — Action Planning:** *Decision Tree Mapping* — map the choice architecture of which finalist concept becomes the next mock and the basis for the CU UX spec.

**Journey Rationale:** The repeated rejection of two day-detail mocks (the planning-explanation version and the cooking-static-page version) shows the problem is structural, not stylistic. We have to leave the inherited frame on purpose, then rebuild — not iterate within the frame. This journey is deliberately designed to make the early steps uncomfortable and divergent (Phase 1 with What If) so that the later, more rigorous steps (First Principles in Phase 3) operate on a wider candidate pool than the obvious ones.

---

## Phase 1 — What If Scenarios

**Started:** 2026-05-27

**Facilitation seed (Sally):** Picture the cooking moment as concretely as possible. Tuesday 6am. Kitchen lights yellow. Cook is still half-asleep, knife in hand. Phone propped on the counter, splashed with water. Bus arrives in 38 minutes. Now: what if literally none of the screen we built is the right answer? Let me throw open four what-ifs across deliberately orthogonal domains and seed the first round of ideas before inviting the user in.

### Round 1 — Seeded ideas

**[#1 · Modality]** No-Screen Audio Sidekick
*Concept:* Cook says *"Lumi, lunch"* — Lumi voices the dish name, ingredients-to-grab, then walks the method aloud beat by beat. Cook says *"next"* or *"again."* Phone face-down or in pocket.
*Novelty:* Eliminates the cognitive-load problem by eliminating the screen. Hands and eyes stay on food.

**[#2 · Attention Sequence]** One-Card-at-a-Time Stepper
*Concept:* Full-screen card shows ONE step. Big type, no chrome. Swipe right = next step, swipe up = ingredient list, swipe down = mark cooked. No co-presentation, ever.
*Novelty:* Treats the screen as a teleprompter, not a recipe page. Mimics how a TV chef demos — one beat at a time, ambient context only.

**[#3 · Form Factor]** Printed Sunday Sheet
*Concept:* Lumi generates a single A5 printable for the whole week. Lives on the fridge under a magnet. The "screen" is paper; day-detail is one cell on a 7-day grid.
*Novelty:* Inverts the digital-first assumption. Recognizes that the kitchen is a hostile environment for phones (water, flour, time pressure) and a friendly one for paper.

**[#4 · Form Factor]** Fridge-Display Mode
*Concept:* Day-detail renders for a horizontal countertop display or a wall-mounted screen, not a phone-in-hand. Larger type, longer dwell time, glanceable from across the kitchen while moving.
*Novelty:* Acknowledges that phone-in-hand is the wrong form factor for the cooking moment.

**[#5 · Time-Shifting]** Pre-Cooked Tonight, Re-Read Tomorrow
*Concept:* Day-detail isn't for cooking morning-of — it's for *prep-the-night-before*. Most lunch components can be made Sunday or the previous evening, when the cook has time. Morning view collapses to a "pack the bag" checklist.
*Novelty:* Re-times the entire cognitive load. The "knife-in-hand-at-6am" persona may be the wrong target — it's "tired-after-work-at-9pm" that actually needs the recipe surface.

**[#6 · Adaptive]** Skill-Adaptive Method
*Concept:* First time a cook makes a recipe, method shows 8 detailed steps. Fifth time, it collapses to a 3-step "you know this one" version. Tenth time, just the ingredient list and a one-line reminder.
*Novelty:* Cognitive load shouldn't be constant. The screen earns the right to shrink as the cook learns. The recipe ages with use.

**[#7 · Social]** Cook-With-Partner Mode
*Concept:* Two phones, one recipe. Parent A gets the "main + carrot" tasks; Parent B gets the "snack pack + bag check" tasks. Lumi splits the work between two cooks in the room.
*Novelty:* The current model assumes solo cooking. Most morning kitchens have two adults. Splits load between humans, not on screen.

**[#8 · Sensory / Camera-Aware]** Camera-Aware Step Advancer
*Concept:* Phone propped on counter, front camera quietly watches the cutting board. When the cook reaches for the chicken, the screen advances to "slice into strips." When chicken is in pita, screen advances to carrots. No swiping.
*Novelty:* Removes the "interact with screen while cooking" friction. Lumi watches and follows the cook, not the other way around.

### Round 1 — User reactions

User picked **#1 (audio sidekick), #2 (one-card stepper), #4 (fridge display), #5 (evening prep)**.

User dropped (without push-back): #3 (printed sheet), #6 (skill-adaptive), #7 (partner mode), #8 (camera-aware).

**Cross-cutting theme of the picks (Sally's read):** *Detach the cook from the phone-in-hand at 6am.* All four picks solve the same problem from different angles — remove the screen (voice), shrink what it shows (single step), reposition it (fridge), or move the work to a calmer hour (evening). The unifying instinct: **the cook should not be staring at a dense phone screen while holding a knife.**

### Round 2 — Seeded extensions + orthogonal pivots

#### Doubling down on the loved thread

**[#9 · Hybrid of #1+#2]** Stepper-with-Voice
*Concept:* Visual stepper card on screen + voice reads the same step aloud. Cook swipes OR says *"next."* Eyes when chopping carefully, ears when hands are wet. Multi-modal, cook chooses.
*Novelty:* Honors that the cooking moment is not one uniform state — it flips between eyes-free and eyes-on within seconds. Lets the cook tap whichever channel is free.

**[#10 · Hybrid of #1+#5]** Evening Brief, Morning Whisper
*Concept:* At 9pm, Lumi runs a full brief on the kitchen tablet — recipes visible, prep happens in the calm. At 6am, Lumi just says aloud *"pita's pre-made in the fridge; carrots are cut; you only need to pack. Bus is in 38."* Two completely different surfaces for two completely different cognitive states.
*Novelty:* Treats 9pm-cook and 6am-cook as two different people who need different interfaces. The current design serves neither well by trying to serve both with one screen.

**[#11 · Hybrid of #4+#1]** Always-On Kitchen Lumi
*Concept:* Fridge-mounted display that's also a voice device. Always on. Glanceable when you move past, voice-active when your hands are busy. Day-detail isn't an app you open — it's an ambient presence in the room.
*Novelty:* Removes the "open the app" friction. Closer to a smart speaker than a smartphone app — the screen is furniture, not a destination.

#### Pivoting to wilder, orthogonal territory

**[#12 · Wild / Trust]** No-Recipe Mode
*Concept:* Lumi has watched the household cook the pita 30 times. On the 31st morning, it just says: *"Same as last Tuesday. You've got this. Bus in 38."* No recipe shown unless requested. Swipe up for the ingredients, otherwise silence.
*Novelty:* The most aggressive form of skill-adaptive — trust the cook. The kindest thing a UI can do is get out of the way entirely. Recognizes that for frequent recipes, the screen is the obstacle, not the helper.

**[#13 · Wild / Distributed]** Lumi Cooks Half Of It
*Concept:* The agent identifies which 2 components a smart appliance can handle (oven preheats at 5:55am for the chicken; rice cooker pre-loaded last night finishes at 6:10). The cook's day-detail only shows the steps a human needs to execute. The kitchen has multiple actors; the cook is one of them.
*Novelty:* Reframes "day-detail" as the human's slice of a distributed cooking job. The screen is honest about what's already handled.

**[#14 · Alien — Barista Rush]** Like a Coffee Shop Call Sheet
*Concept:* At 8am rush, a barista pumps out 6 different drinks with 3 components each. They don't use recipes — they use shorthand on a call sheet (*"oat lat, 2 shot, no foam"*). Day-detail rendered as a single-line shorthand: *"pita / cumin chx / carrot rib / 2 dates · ×3."* Compressed, single-glance, no narrative.
*Novelty:* Cooking as performance/throughput, not as instruction. A pro doesn't need full sentences; they need cues. Trusts the cook to fill in the gaps.

**[#15 · Alien — Surgical Tray]** The Prep-Tray View
*Concept:* An OR nurse lays out instruments in the exact order they'll be needed. Day-detail opens with a photo of the counter as it SHOULD look before you start: pita pack here, chicken jar there, carrot pot, knife, board. Tap any item to see what it's for. Cook orients in space, not in time.
*Novelty:* Recipe as spatial layout, not temporal sequence. Removes the "what's next" question by showing the whole flow as a tableau.

**[#16 · Failure Mode]** Takeout Fallback
*Concept:* The screen acknowledges a failed morning. *"Running late? 90-second pivot: pita + deli chicken from the fridge + an apple. Done."* Lumi pre-computes a degraded version of the meal using what's already on hand. Failure isn't pretended away.
*Novelty:* Most cooking UIs assume success. Designing for "I'm losing the morning" is honest — and it might be what *enables* the parent to trust the system on the good days.

**[#17 · Emotional]** Morning Calm Mode
*Concept:* Screen opens with two lines: *"Pita today. Aarav loves this one."* No checklist, no ingredients, no method. The cook is reminded WHY before HOW. Tap to expand into the recipe.
*Novelty:* Leads with the emotional motivation, not the task. Cooking for someone you love is a fundamentally different act from executing a recipe; the UI can honor that.

**[#18 · Inner Child]** Lunchbox-First View
*Concept:* Day-detail opens with a picture of the FINISHED, PACKED lunchbox — exactly how it'll look when zipped. Below: *"here's how to get there."* The destination is shown before the journey, in its real form.
*Novelty:* Most recipes show plated food. The lunchbox-packed view is the cook's actual mental endpoint. Cuts a beat of translation work.

**[#19 · Extreme Minimum]** Photo-Only Day-Detail
*Concept:* If your phone is dead, the kitchen is loud, you have 4 minutes — what's the irreducible artifact? A laminated photo of *"today's four components"* on the fridge: pita / chicken / carrot / dates. No text. Cook reconstructs from the photo. Zero cognitive cost to "read."
*Novelty:* Strips the day-detail to its floor. Forces the question: what's the LEAST a day-detail could be and still be useful? Possibly: an image.

### Round 2 — User reactions

User picked **only #11** from Round 2 (Always-On Kitchen Lumi).

**Hard constraints surfaced by user (2026-05-27, captured as session-level constraints):**

- **No voice.** Voice is not being introduced now. Kills #1, #9, #10, and the voice half of #11.
- **No photos.** Photos add cognitive load AND introduce copyright risk (Lumi can't legally source food photography at scale). Kills #15, #18, #19 and any photo-based concept.
- **Full-screen treatment.** The recipe should own the surface. No competing chrome/cards.
- **Method steps are few by design.** Lumi's recipe-agent generates short methods. No need to paginate / step / sequence — they fit on one screen.

**Convergence (Sally's read):** The design space has collapsed to **the Wall Card** — a typographic full-screen recipe page, photo-free, voice-free, ambient/glanceable, that can live on a fridge display or a phone-on-counter. Typography IS the visual system; warm honey-cream background, serif headline, lists for ingredients and method. Round 3 should explore variations WITHIN this constrained design space rather than pushing more wild divergence.

### Round 3 — Variations within the Wall Card direction

**[#20 · Typographic Full-Screen]** Recipe-as-Penguin-Page
*Concept:* Each recipe is one full-screen page treated like a Penguin Classic — pure typography. Title in large serif italic, ingredients as a clean bullet list, method as a numbered list. Black-warm on cream. Read like a page in a literary cookbook. No image, no chrome, no card boundary, no chip.
*Novelty:* Typography IS the design system. Removes every secondary element. Forces hierarchy to carry meaning. Honors the HiveKitchen warm-neutral palette as foundation, not decoration.

**[#21 · Paginated Recipes]** Swipe-Between-Recipes Pagination
*Concept:* Day-detail is a swipable stack of full-screen pages — one per recipe. Page 1: Main. Page 2: Snack. Page 3 (only in split): Mira's main. Etc. Pagination dots at bottom indicate position. Each page is alone in space; no co-presentation of recipes.
*Novelty:* Resolves the "multiple recipes co-presented" problem without voice or photos. Each recipe gets its own real estate; the cook navigates by intent (which recipe?) not by scroll.

**[#22 · Bento Per Slot]** Single-Card-Per-Cooking-Unit
*Concept:* For shared mode: ONE full-screen card per slot, swipe between Main and Snack. For split mode: ONE card per kid (the kid's whole short day, ingredients-plus-method, fits on one page). Pagination scales with cognitive units, not data units.
*Novelty:* The unit of pagination matches the unit of cooking attention. The cook commits to one job per swipe.

**[#23 · Ambient Today-Card]** Today IS The Home Screen
*Concept:* The app's default view IS today's wall card. No navigation to "find" the recipe. Open the app — you're already on today. Tomorrow is a swipe right; yesterday's pack-check is a swipe left.
*Novelty:* Removes the "navigate to day-detail" friction entirely. The app's identity is today.

**[#24 · Method-First Hierarchy]** Lead With The Doing
*Concept:* Open the wall card — you see METHOD steps full screen. Ingredients hide behind a small *"what to grab"* link at the top; tap to expand inline. The cook is in motion at 6am, not grocery-listing.
*Novelty:* Hierarchy by temporal relevance. Ingredients are a pre-cooking concern (gathering, shopping); method is the in-the-moment concern. Lead with what's needed now.

**[#25 · Prose Format]** Recipe-as-Sentence
*Concept:* Recipe is one short paragraph: *"Cumin chicken pita today for all three. Grab the chicken, three pitas, a carrot. Slice the chicken thin, ribbon the carrot with lemon, pack each pita folded — not pre-stuffed. Drop two dates in each pouch."* No lists. Prose density carries the recipe.
*Novelty:* Returns to how 19th-century cookbooks read. Reading a paragraph is lighter cognitive work than parsing two lists when the recipe is short enough. Also: 100% type, zero visual chrome.

**[#26 · Bus-Time Anchor]** Time-Pressure Banner
*Concept:* The wall card carries one small, calm line at top: *"Bus 7:42 · 38 min to pack."* Updates live. Replaces the "× 3 servings · 15 min prep" meta clutter with the only number that actually matters to the cook in the moment.
*Novelty:* Replaces decorative metadata (servings, prep time) with a single time-anchored fact that's actually load-bearing for the cook.

**[#27 · No-Day-Detail]** The Recipe Lives In The Tile
*Concept:* The most radical compression: there's NO separate day-detail screen. Tapping a day tile on the weekly canvas expands the tile inline to full-screen, shows the wall card content, then collapses back. The "screen" is a state of the tile, not a new destination.
*Novelty:* Deletes the navigation. Day-detail is a property of the canvas, not a place. Saves a back-button, an animation, and a mental model.

**Phase 1 closure (Sally):** 27 ideas across 3 rounds. User reached convergence early — at Round 3 they explicitly elected to stop diverging and move to patterning. Workflow's 100-idea goal was not hit, but the constraints surfaced (no voice, no photos, full-screen, short methods, ambient/wall preference) did real work cutting the design space. Continuing to diverge would have generated noise within an already-narrow corridor.

---

## Phase 2 — Mind Mapping

**Started:** 2026-05-27

**Goal:** Cluster the live ideas (≈16 after constraint culling) into directional families so Phase 3 (First Principles) can rebuild the top 2–3 from the ground up.

### Live ideas after constraint cull

Dead by constraint or user drop: #1, #2, #3, #6, #7, #8, #9, #10 (voice half only), #11 (voice half only), #15, #18, #19.

Surviving: **#4/#11-ambient · #5 · #10-evening half · #12 · #13 · #14 · #16 · #17 · #20 · #21 · #22 · #23 · #24 · #25 · #26 · #27** (16 ideas).

### Cluster Map

**Cluster A — TYPOGRAPHIC SURFACE** *(how the recipe content itself is rendered)*
- #20 Penguin Page (full-screen pure typography, serif italic title, lists)
- #25 Prose Format (one paragraph instead of two lists)
- #14 Barista Call Sheet (single-line compressed shorthand)

*Big question this cluster answers:* What format does the recipe text take?

**Cluster B — PAGINATION & NAVIGATION** *(how multi-recipe is handled)*
- #21 Swipe-Between-Recipes (one full-screen page per recipe, paginated)
- #22 Bento per Cooking-Unit (one page per slot in shared mode, per kid in split mode)
- #23 Today IS The Home Screen (app's default view is today; tomorrow = swipe right)
- #27 No-Day-Detail (inline expansion of the canvas tile, no separate screen)

*Big question:* How does the cook reach and move between recipes?

**Cluster C — HIERARCHY & ATTENTION** *(what's surfaced first, what's hidden)*
- #24 Method-First Hierarchy (method full-screen, ingredients behind a small link)
- #26 Bus-Time Anchor (drop decorative meta; show only time-to-bus)
- #17 Morning Calm Mode (lead with WHY — "Aarav loves this one" — before HOW)

*Big question:* What does the cook see first, and what can be hidden?

**Cluster D — AMBIENT & PRESENCE** *(where the surface lives)*
- #4/#11 Always-On Wall Card (fridge-mounted glanceable display)
- #23 Today IS Home Screen (overlap with B — the app is the ambient surface)

*Big question:* Is the screen a destination to navigate to, or an ambient presence in the kitchen?

**Cluster E — TIME-SHIFTING** *(when the cook engages)*
- #5 Pre-Cooked Tonight, Re-Read Tomorrow (most work happens night-before)
- #10-evening half: 9pm full brief, 6am minimal pack-check

*Big question:* When does the recipe get its primary use — morning or evening?

**Cluster F — TRUST & DISTRIBUTION** *(acknowledging the cook isn't alone or new)*
- #12 No-Recipe Mode (after N successful cooks, hide the recipe; cook from memory)
- #13 Lumi Cooks Half Of It (distributed across smart appliances)

*Big question:* Does the cook always need the full recipe?

**Cluster G — FAILURE MODES & FALLBACKS** *(designing for non-success mornings)*
- #16 Takeout Fallback (degraded 90-second pivot when running late)

*Big question:* What happens when the morning is going wrong?

### Sally's read on the gravitational center

Clusters A, B, C, and D are all aspects of ONE coherent product direction: **a typographic, paginated, ambient wall card.** The user's constraints (no voice, no photos, full-screen, short methods) and the one Round-2 pick (#11 ambient) pull strongly toward this gravity well. These four clusters describe FOUR sub-questions within that one direction:

- **A:** Penguin page · Prose · Barista shorthand — *content format*
- **B:** Pagination model — *navigation across recipes*
- **C:** What's hidden vs. shown first — *attention hierarchy*
- **D:** Ambient device vs. summoned app — *presentation model*

Clusters E, F, G are orthogonal to that direction — they're either different surfaces entirely (E: evening flow) or extensions to layer later (F, G). Worth naming but not necessarily Phase 3 priorities.

### Recommendation for Phase 3

Take A + B + C + D into First Principles (the wall card and its sub-questions). E, F, G stay parked as either future stories or layered enhancements that can fold in after the core wall card direction is committed.

### Phase 2 — User picks

User picked **one concept from each surviving cluster, and pulled in E and F that I had parked**:

- **A — #20 Penguin Page** (typography-led full-screen content; not prose, not shorthand)
- **B — #21 Swipe-Between-Recipes** (one full-screen page per recipe, paginated; not bento-per-unit, not today=home, not no-day-detail)
- **C — #24 Method-First Hierarchy** (method leads, ingredients tucked behind a link)
- **D — #4/#11 Ambient Wall Card** (fridge-mount / always-on glanceable display feel)
- **E — #5 Evening Prep** (most cooking work shifts to the night-before; morning is pack-check only)
- **F — #12 No-Recipe Mode** (after N successful cooks, recipe is hidden; cook from memory)

User explicitly DROPPED Cluster G with scope clarification: *"Fallback is outside the scope of Application — user may click fallback as buy lunch."* Saved to memory as [[degraded-modes-are-user-actions]]. The app does not design for failure modes — buying lunch is a user action outside the app, not a feature.

### Integrated Wall Card direction (Sally's synthesis from picks)

The day-detail screen is a **paginated, full-screen, typographic, ambient surface that operates in two temporal modes** (evening prep + morning pack) and **shrinks adaptively** as the cook becomes familiar with the recipe. Each recipe gets its own swipe-page. Method leads, ingredients are one tap away. No photos, no voice, no chrome. The Penguin page is the visual atom.

---

## Phase 3 — First Principles Thinking

**Started:** 2026-05-27

**Goal:** Strip every assumption about what a day-detail "is" and rebuild it from the fundamental truths of the cooking moment. Use the user's six picks as ingredients, but force each to justify itself against a truth, not a preference.

### Fundamental truths about the cooking moment (Sally's starting set)

These are the truths I'll anchor the rebuild against. Each should be defended or rejected before we use it.

1. **Two cognitive states.** The 9pm cook (tired-but-not-rushed) and the 6am cook (rushed-and-fuzzy) are functionally different people. A single interface that serves both equally serves neither well.

2. **The cook is moving.** Hands occupied, eyes mostly on food, occasional glances at the screen. The screen has 1–2 seconds of attention per glance, not 30.

3. **Attention shifts within a recipe.** Pre-cooking (gathering ingredients) and during-cooking (executing method) need different information weighted differently. Ingredients are read once; method is read step by step.

4. **Time pressure escalates toward the bus.** At 6am, the only meta that matters is "minutes until the bus." Decorative metadata (servings, prep-time, source) competes with this and loses.

5. **Recipes get memorized.** A pita made every Tuesday for 5 weeks no longer needs a recipe. The UI that helped on week 1 becomes friction by week 5.

6. **The kitchen is hostile to phones.** Water, flour, oil, time-pressure. Touch interactions are unreliable in the actual cooking environment.

7. **Lumi generates short recipes by design.** 3–5 method steps, 4–7 ingredients. The recipe AGENT enforces this upstream.

8. **Households cook one main meal for all kids by default** (per [[shared-recipe-default]]). Split mode is rare and allergen-driven.

9. **The cook is usually solo at 6am.** 9pm prep may be paired (partner, older kid), 6am usually isn't.

### How each pick maps to a truth

- **#20 Penguin Page** → serves truth #6 (pure type is least vulnerable to splashes, dim light, and small touch targets gone wrong)
- **#21 Paginated swipe** → serves truth #3 (single-thing focus while cooking; no co-presentation)
- **#24 Method-first** → serves truths #3 and #4 (in the cooking moment, method is the only thing needed; ingredients were a *pre-cooking* concern)
- **#11 Ambient Wall Card** → serves truth #6 (phone-in-hand is wrong form factor; ambient is right; on phone propped on counter, "ambient" = persistent + glanceable)
- **#5 Evening Prep** → serves truth #1 (acknowledges two cognitive states; routes the heavy cognitive lift to the calmer one)
- **#12 No-Recipe Mode** → serves truth #5 (recipe UI is not a constant; it earns the right to shrink as the cook learns)

### Sub-questions Phase 3 must resolve

1. **The page model:** Is "evening mode" a different page (different screen entirely) from "morning mode," or the same page rendered differently based on time?
2. **The first thing seen:** Is the day-detail's opening view the method, or a "tonight's prep" call-out (evening) and "just pack" call-out (morning)?
3. **The skill ramp:** What does "no-recipe mode" look like concretely? Method collapses to one-line cues? Page disappears entirely from the swipe stack? Just-the-bus-timer view?
4. **Multi-child in the swipe stack:** In split mode, does each kid's recipe become its own swipe page? (Probably yes given #21.) What's the page order?
5. **The action bar:** Is it still "Mark cooked + Change my mind" (per the earlier cook-only direction)? Or does evening mode need different verbs ("Pause day," "Skip prep tonight")?
6. **Form factor today vs tomorrow:** The Wall Card concept implies a fridge/counter display, but HiveKitchen ships on phones today. Is the phone-propped-on-counter the design target, with the fridge display being a future render mode?

### Phase 3 — User clarifications and truth revisions

User responded with significant reframes on truths and sub-questions:

**Truth #1 RECAST → "Two activity modes," not "two cognitive states":**
User: *"Instead of two States we can change it to Prep and Finish. User can prep the before the week start, evening before and end up doing prep and finishing during morning."*

Reframe: the cook engages each recipe in two ACTIVITY MODES (Prep and Finish), not two clock-bound cognitive states. Mode is user-driven and can happen at any time. Same cook may do partial prep Sunday, more prep + full finish Tuesday morning. Saved to memory as [[prep-and-finish-are-activity-modes]].

**Truth #4 DROPPED — Bus time pressure is not load-bearing:**
User: *"Let not worry too much about bus time preassure."*

Bus-time-anchor framing (#26) and any UI weight given to time-to-bus is dropped. The design does not lead with countdown urgency.

**Sub-question 4 RESOLVED — Multi-child pagination unit is "unique recipe":**
User: *"In prep or packing mode it should be for all children. it should be based on what recipe. if both children have 2 different recipes then yes, two separated instructions in prep and in method two separated ones."*

Resolved: unit of pagination is the **unique recipe**, not per-child. If three kids share one main, that main is ONE page (portion multiplier handles the count). If two kids share a snack but one has a different one, that's two pages. Page count = number of distinct recipes in the day.

**NEW conceptual frame — Recipe ≠ Method:**
User: *"Recipe does not change. The user only have to look at method only if he does not know recipe."*

The "Recipe" and "Method" are different content layers with different visibility rules:
- **Recipe** (dish + ingredients + portions + attribution) — *always shown*.
- **Method** (how-to steps) — *only shown when the cook doesn't know it*.

This REFINES sub-question 2 and #24 (Method-First Hierarchy). Method-first becomes *"Method-when-needed"*. The default view shows the recipe; method is progressively disclosed by familiarity. Saved to memory as [[recipe-vs-method-distinction]].

### Revised truths (rebuilt against user clarifications)

1. **Two activity modes per recipe** — Prep (make-ahead cooking work) and Finish (morning packing). User-driven, not time-bound. Same recipe, both modes, filtered method.
2. *(unchanged)* The cook is moving — 1–2 second glances.
3. *(unchanged)* Attention shifts within a recipe — gathering ≠ executing.
4. ~~Time pressure escalates toward the bus.~~ *(DROPPED — bus pressure is not load-bearing.)*
5. **Recipe and method decay differently** — the recipe (what + portions + ingredients) is needed every cook. The method (how) is needed only when the cook doesn't know it. Method earns the right to shrink/disappear as the cook learns; recipe stays.
6. *(unchanged)* Kitchen is hostile to phones.
7. *(unchanged)* Lumi recipes are short by design.
8. *(unchanged)* Shared main is default; split is rare.
9. *(unchanged)* Cook is usually solo at 6am.

### Integrated Wall Card — synthesis after clarifications

**Page model:** The day-detail is a swipe-stack of pages, **one per unique recipe** for the day. Cumin pita shared across 3 kids = one page. Three different mains for three kids = three pages.

**Each page contains:**
- **Recipe layer** (always visible): dish name (large serif italic), child attribution ("For Aarav, Mira & Kabir"), ingredient list with quantities (× N portions baked in).
- **Method layer** (conditionally visible): step-by-step, filtered by active mode (Prep / Finish), collapsed/hidden if cook is familiar with the recipe.
- **Mode toggle**: Prep | Finish, defaults inferable from time but always user-overridable.

**Familiarity-driven method visibility:**
- New recipe → method expanded by default in the active mode.
- Known recipe → method collapsed; "Show steps" expand-affordance.
- Mastered recipe → method gone entirely; only recipe + mode toggle visible.

**Multi-child split mode:** the swipe stack contains one page per unique recipe. Pages are ordered by slot (main(s) first, then snack(s)). Kids who share a recipe appear together in that recipe's attribution.

### Sub-questions status

1. ~~Page model.~~ **RESOLVED** — same page, mode toggle filters method.
2. ~~First thing seen.~~ **RESOLVED** — recipe (dish + ingredients), not method.
3. **Skill ramp** — clearer now (method earns shrinkage), but how is familiarity *measured*? Per-household? Per-cook? Recipe-cook-count? Self-declared? Still open.
4. ~~Multi-child split.~~ **RESOLVED** — one page per unique recipe.
5. **Action bar** — still open. Earlier picked *"Mark cooked + Change my mind"*; does Prep mode need different verbs (*"Done prepping"* / *"Skip prep tonight"*)?
6. **Form factor today vs tomorrow** — still open. Phone-propped-on-counter as primary target with fridge display as future mode? User hasn't directly responded.

### Phase 3 — Final user resolutions

1. **Familiarity measurement** → **Self-declared by user.** A small user-controlled toggle ("I know this one") hides the method. No cook-count tracking, no behavioral inference. Simple and respects the cook's own judgment.
2. **Action bar verbs** → **Mode-specific:**
   - Prep mode: `[✓ Done prepping]` · `Skip prep tonight ↗`
   - Finish mode: `[✓ Mark cooked]` · `Change my mind ↗`
3. **Form factor** → **Phone or iPad** as primary targets (responsive web app). Fridge / wall display is out of scope for this iteration. The "ambient" quality from #11 manifests as *phone-or-iPad-propped-on-counter*, not as a dedicated display.

All Phase 3 sub-questions resolved. Direction is unambiguous.

---

## Phase 4 — Decision Tree Mapping

**Started:** 2026-05-27

**Goal:** Map the choice architecture and commit to a single buildable concept. Identify the next-action decision.

### The choice architecture

Every fork in the design space has been made during the brainstorm. The "tree" is more of a trunk:

```
DAY-DETAIL = the Wall Card
├── Visual system: Penguin Page typography (no photos, no chrome)
├── Pagination: one swipe-page per UNIQUE RECIPE
│   ├── Shared day → 1 page per slot (main + snack = 2 pages)
│   └── Split day → 1 page per unique recipe across kids
├── Content layers
│   ├── Recipe (always visible) — dish, ingredients, portions, attribution
│   └── Method (conditionally visible)
│       ├── Self-declared "I know this one" → method collapsed/hidden
│       └── Otherwise → method expanded
├── Mode toggle (Prep | Finish)
│   ├── Prep → make-ahead method steps · [✓ Done prepping] · Skip prep tonight ↗
│   └── Finish → morning-of method steps · [✓ Mark cooked] · Change my mind ↗
└── Form factor: responsive web (phone + iPad), counter-propped
    └── (Fridge/wall display deferred to future hardware story)
```

### What's load-bearing for the next mock

- **Single page per unique recipe** in a swipe stack
- **Penguin-page typography** — full-screen, no photos, no chrome
- **Recipe always shown** (dish name, attribution, ingredients with quantities, portions)
- **Method collapsible** behind self-declared *"I know this one"* toggle
- **Method semantically split** into make-ahead vs morning-of steps (requires recipe-agent to tag steps with mode — backend implication for story 3-31)
- **Mode toggle** (Prep | Finish) filters the method
- **Mode-specific action bar verbs**
- **Responsive web** for phone + iPad

### What's deferred to the UX spec (CU)

These are spec-level details, not brainstorm decisions:
- Exact typography scale and rhythm (heading sizes, line-heights)
- Mode toggle visual treatment (pill, segmented control, tabs)
- Pagination indicator (dots, fraction, none)
- Animation/transition between pages (slide, fade, none)
- Empty / loading / error states
- Per-recipe "I know this one" persistence (per-household? per-cook?)
- Pagination order in split mode (alphabetical by kid? by slot kind? by recipe ingredient overlap?)

### What's deferred to backend stories

- Recipe-agent (story 3-31) must tag each method step with `make-ahead` vs `morning-of` so the mode toggle has something to filter
- Per-recipe `cook_familiarity_known` flag on the household / cook record
- Planner enforcement of day-level consistency (per [[shared-recipe-default]]) becomes simpler under the unique-recipe-page model — the canvas tile counts unique recipes per day

### Recommended next action

Either path works; choose based on velocity preference.

- **(A) Rebuild the mock first, then spec.** Translate the brainstorm into pixels at `/_dev-day-detail-multi-child`, see if the design holds up visually with concrete content, then have CU formalize the spec from the validated pixels. **Pros:** the user has already corrected 3 mocks; one more in-pixels iteration de-risks the spec. **Cons:** one more loop before the formal artifact lands.
- **(B) Spec first via CU, then rebuild.** Invoke `bmad-create-ux-design` to produce the formal UX spec from the brainstorm decisions, then rebuild the mock against the spec. **Pros:** the spec becomes the source-of-truth and the next mock is built once. **Cons:** speccing without pixel-validation risks codifying something that visually doesn't work.

**Sally's pick:** Option A. The pattern in this conversation has been "mocks teach us; specs lock in." The brainstorm changed our mental model three times — one more pixel-level iteration is cheap insurance before formalization.






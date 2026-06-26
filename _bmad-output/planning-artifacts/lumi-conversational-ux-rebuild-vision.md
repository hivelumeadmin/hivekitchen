# Vision — Lumi-Led Conversational UX Rebuild

**Date:** 2026-06-26
**Author:** Drafted by Claude (engineering/UX) at Menon's request
**Status:** DRAFT — design north star. Not sliced. Paired with the technical spec below.
**Companion doc:** [`plan-conversational-edit-routing-spec.md`](./plan-conversational-edit-routing-spec.md) — the cost-safe intent-routing + `CatalogRepo.pick()` layer that makes the "talk to your plan" interaction affordable. Read that for the *how*; this doc is the *what / why*.

> **⚠️ Come-back note.** This is captured mid-design, before the Onboarding agent API re-spec (Epic 2.7) is finalized. The UX direction here assumes the same control-inversion the API is moving toward (deterministic controller owns flow, LLM is a stateless conversational turn). Once the API side lands, reconcile §3 (onboarding) and §4 (planner) against the finalized contracts and the companion routing spec.

---

## 0. The one-line thesis (valet model — corrects an earlier draft)

> **The product is the destination. Conversation is a tool you pick up and put down. Lumi is the valet — it knows the family deeply, anticipates, works in the background, and stays invisible until summoned or until it has something genuinely worth saying. Front-load safety, defer the rest, keep the once-per-week expensive generation unchanged.**

**The app must never look like a chat application.** The Brief/plan is a calm, finished, full-width surface — no persistent chat column, no message-bubble stream as the home base. Lumi's intelligence is felt through *the work being right*, not through Lumi talking.

> **Correction note.** Rev 1 of this doc drifted chat-forward — it proposed "one continuous conversation that renders screens" and "a persistent conversational dock." Menon corrected this (2026-06-26): *"the application should not look like a chat app… Lumi is there when you need it, like an old-time valet — present, knows you, but works in the background and doesn't interfere."* §2 below is rewritten to the valet model. See mockup [`lumi-valet-model-mockup.html`](./lumi-valet-model-mockup.html).

The unified conversation-thread model already exists in the architecture, and the *plumbing* (SSE, surface-aware context, the thread store) is reused. What changes is the **surface**: Lumi recedes from the layout. Today it's sprinkled across ~8 components as decoration (a 40px orb, a `max-w-xs` popover, a `lumi_note` paragraph, callouts, hints, FABs); the rebuild replaces that scatter with **one calm ambient presence that comes forward only when summoned or when it has acted.**

### The valet doctrine (the five rules every surface obeys)

1. **The app never looks like chat.** No persistent chat column, no bubble stream as home. The plan is a finished answer.
2. **Lumi is ambient at rest** — a small, quiet presence (the valet by the door), near-invisible. Not a FAB that demands attention.
3. **Proactive is rare and quiet.** When Lumi acted in the background, it surfaces *one dismissible line* — never a stream, never a badge storm.
4. **"Knows you" is shown through the work, not the talk.** The plan is already right; visible-memory phrases woven into the product ("because Tuesdays are chaos") prove it remembers, with zero conversation.
5. **When summoned, Lumi is a focused, temporary moment** — a sheet that slides in, does the thing, and *recedes back into the product*. It never becomes home.

---

## 1. The central tension (named first)

**Today Lumi is everywhere as a *presence* but nowhere as a *conversation*.**

- ~20 routes, two parallel plan implementations, two onboarding implementations — every screen is a new place with new controls. That sprawl is the fatigue source.
- The `LumiPanel` holds 8 turns in a bottom-right popover. It reads as a help widget, not a relationship.
- The thing Menon explicitly wants — *users connecting conversationally so fatigue drops and engagement rises* — is the one thing the current topology suppresses.

The rebuild keeps the visual system (it's good) and rebuilds the **interaction topology** on top of it.

---

## 2. Overall HiveKitchen UI/UX

**Reframe: a finished product the valet laid out for you — not a thread.**

a) **One spatial model: the finished surface.** The home is a calm, editorial, *complete* answer — the Brief, the week, the kitchen — presented full-width. Artifacts (a `PlanTile`, a grocery list, a Heart Note) are things Lumi *prepared and placed*, not turns in a chat log. The user opens the app to a ready week, the way you'd find the morning paper laid out — not to a blinking cursor. (The "artifact" idiom still applies; what changes from Rev 1 is that artifacts live on a finished surface, **not** inside a scrolling conversation.)

b) **Lumi is ambient, summonable, and recedes — not a persistent dock.** Replace the `max-w-xs` popover with a quiet presence (the breathing orb in the corner), near-invisible at rest. Three behaviors only:
   - **At rest** — the dot. No open panel, no thread, no "Ask Lumi" box sitting there. The work speaks.
   - **Whisper** — when Lumi acted in the background, *one dismissible line* (with Undo / See why / Dismiss). Then gone.
   - **Summoned** — tap the dot → a *focused, temporary sheet* slides in, you say one thing, the artifact updates underneath, the sheet recedes and you're back in the finished product.

   The thread plumbing (SSE, history, surface context) still exists under the hood — but it is **never the resting layout.** This is the inverse of Rev 1's "persistent dock," and it is the correct read of "Lumi works in the background." *(See mockup `lumi-valet-model-mockup.html` for all three states on one surface.)*

c) **Collapse ~20 routes into ~4 anchors.** Most current routes are destinations Lumi could *surface* instead:
   - **Brief** (home / this week)
   - **Kitchen** (profile, kids, allergens, memory — the Kitchen Map made visible)
   - **People** (Heart Notes, Lunch Link, grandparent)
   - **Lumi** (the thread itself, full-screen)

   Everything else (day-detail, grocery, swap, history, evening check-in) becomes an *artifact Lumi opens inside the Brief or thread*, not a tab to hunt for. Fewer places = less fatigue.

d) **Keep the "Editorial Hearth" design language — it's genuinely 2026-current.** Instrument Serif + Public Sans, honey-as-recognition, terracotta-as-Lumi's-voice, dark-first. Don't redesign the visual system; redesign the topology. Enforce the **Honey rule harder**: amber fires at *recognition moments* (a plan landing, an allergen cleared, a kid's favorite remembered) and those must feel earned, not constant. Honey is the engagement currency.

---

## 2.5 Lumi's voice — the prompt carriage (WHEN vs HOW)

The valet model splits cleanly across two layers, and this split is the same control-inversion Epic 2.7 applies to onboarding:

> **WHEN Lumi surfaces is a *controller* decision. HOW it speaks when it does is the *prompt's* job.** A prompt always produces output when called — so "works in the background, doesn't interfere" is enforced by the controller choosing *not* to call Lumi, or rendering its output as a whisper rather than a chat turn. The prompt only governs voice.

**The HOW is already partly shipped.** `apps/api/src/agents/prompts/lumi-base.prompt.ts` (the ambient `LumiAgent` persona — *not* onboarding, which uses a separate identity sentence) gained a **"How you carry yourself"** valet-carriage block (2026-06-26): *work in the background; act first, narrate in one or two lines; don't fill silence; don't invite more conversation; don't end with "let me know if…"; never announce that you remember — just be specific.* The evening length modifier in `lumi.agent.ts` was tightened from "2–4 sentences welcome" to "2–3 sentences, don't pad or invite more chat."

**The WHEN is the build work** — the controller/UI decides:
- at rest → don't call Lumi at all; the surface stands on its own
- background action → fire *one* nudge, render as a dismissible whisper (reuse the existing `lumi.nudge` SSE + `generateNudge`'s one-sentence cap)
- summoned → open the focused sheet, run the turn, then recede

Onboarding is the deliberate exception (it *must* ask) — its restraint is a separate edit to `onboarding.prompt.ts` (ask-the-minimum; defer all non-safety to week one) and the 2.7 sentinel removal.

---

## 3. Onboarding (deep)

Current: `OnboardingText.tsx` (~2,460 lines) — two-column chat + live Kitchen Profile panel + 6 Moments + focused/history view toggle + chip-bracket encoding + regex fallback extraction. The *concept* is right (interview, not form; build the Kitchen Map as you talk). The *execution* is heavy with too many modes.

> **Aligns with Epic 2.7.** The API is already inverting onboarding control (controller owns the moment FSM; LLM becomes a stateless turn function; safety nets/sentinels deleted). The UX changes below should land *on top of* that inverted backend, not fight it.

a) **Make the live profile panel the hero, not the sidebar.** The most delightful thing you have is "the Kitchen Profile fills in as you talk." Flip the weighting: conversation is a slim focused column; the **Kitchen Map building itself in real time** is the showpiece — a child appears, an allergen pill clicks into place with safety-teal, a dish lands in the bag. That "I'm being understood" feeling is the core anti-fatigue lever.

b) **One conversation mode, not three.** Drop the focused/history toggle and the chip-bracket encoding. A single calm thread: Lumi's serif question, chips inline below it (keep the hint/action/choice taxonomy — it's good), one pill input. The waveform glyph stays as Lumi's signature.

c) **Voice and text as one continuous session, not a fork.** Per the unified-thread model, a parent should start talking and finish typing without losing the Kitchen Map. The select screen becomes "Lumi just starts talking; tap the keyboard anytime." Architecturally supported; most onboarding can't do it — it's a differentiator. *(Note: text-first remains doctrine; this is the eventual target, not a request to un-defer voice.)*

d) **Front-load safety, defer everything else.** Moment 2 (allergens) is the only moment non-negotiable before a plan exists. Let the parent reach a first plan after Moments 1–2 (who's at the table + what to keep safe); let Lumi pull the rest (taste, bag, schedule, culture) conversationally over the first week as gentle in-context asks. Shorter time-to-value; turns onboarding into an ongoing relationship rather than a wall. **Biggest fatigue win — but see the open tension in §6.**

e) **End on a recognition moment, not a "Finalize" button.** The summary plays back the kitchen Lumi now understands, in warm prose ("So — Maya, 7, no nuts; Sam, 4, loves anything orange; 25 minutes on weekday mornings"), with the honey-glow firing as it lands. CTA is "Show me my first week," not "Finalize."

---

## 4. Weekly Planner (deep)

Current: `features/plan/PlanPage.tsx` — a 5-column row of `PlanTile`s with a serif hero; Lumi is narration *around* the grid (`lumi_note`, "Why this week," draft status). Slots (Main/Snack/Extra) exist in the data layer but the tile flattens them to one dish line; the action row diverges from the locked `StickyBottomBar` rule. The planner is where review-fatigue concentrates.

a) **Lead with the answer as a sentence; defend it on demand.** The "system-led, present a ready answer" philosophy is right and rare — lean all the way in. Top of the planner is Lumi saying, in one warm line, *what the week is and why it's good for this family* ("An easy week — two no-cook days because you flagged Tuesdays are chaos"). The 5 day-cards sit below as the artifact. "Why this week" is one tap away, never forced. The user reads one sentence and trusts, instead of auditing 5 days × 3 slots.

b) **Conversational editing as the primary verb — the engagement engine.** Make the dominant interaction *talking to the plan*: tap any day → the Lumi dock focuses with that day's context already hydrated (surface-aware context already exists) → the parent says "Maya's bored of wraps" → the tile re-renders live. Every edit is a chat turn; every turn re-renders an artifact. **This is the loop that makes a planner feel alive instead of like a spreadsheet you maintain.**
   - **Cost guardrail:** this is exactly what the companion routing spec protects. Conversational edits resolve via a cheap-tier classifier + deterministic catalog/variation ops (`CatalogRepo.pick()`), NOT a `plan.compose` re-run. The expensive path stays once-per-week. See [`plan-conversational-edit-routing-spec.md`](./plan-conversational-edit-routing-spec.md).

c) **Show the slot structure, but progressively.** Flattened dish line for the calm default; reveal Main/Snack/Extra on tile-focus (expand). Calm by default, structured on demand — lets a parent tweak a snack without touching the Main.

d) **Fix the `StickyBottomBar` divergence — and use it as the trust anchor.** The planner's primary action ("Confirm the week") belongs in the locked sticky bar with "Talk to Lumi" always in the right slot. That persistent invitation keeps the conversational relationship one tap away on the highest-fatigue screen.

e) **Make "next week" a forward-looking conversation, not just a tab unlock.** Instead of a Friday-4pm unlock, have Lumi proactively open next week in the thread via the existing nudge SSE ("Want me to draft next week? I'm thinking lighter — this week was heavy"). The planner becomes something Lumi *brings* to you.

---

## 5. The cost premise (why none of this blows the budget)

Menon's original design buried conversation specifically to control per-week LLM cost. The rebuild preserves that. The reasoning, in full, lives in the companion spec; the short version:

- **~80% of the rebuild is zero-LLM:** the dock, artifact-in-thread rendering, route collapse, progressive slots, the sticky bar, the answer-as-a-sentence hero (the `lumi_note` is already generated). Topology changes don't touch token spend.
- **Conversation costs land only where the model must think** — and most don't. The rule: **render conversationally, resolve deterministically.** Chip taps = free. Swaps/variations from the cached catalog = deterministic (T0). Only intent classification hits a cheap tier (T1). Only net-new dishes / explicit redo hit the expensive path (T2) — behind a confirm gate.
- **Net:** the expensive `plan.compose` fires the same number of times per week. What goes up is *engagement-per-dollar*, not dollars-per-week.

---

## 6. Open tensions / decisions (resolve before building)

1. **Deferred onboarding vs. fail-closed allergen guardrail (§3d).** Letting a parent reach a first plan after Moments 1–2 means generating a plan before taste/bag/schedule data exists. The guardrail is fail-closed on declared allergens — which is fine after M2 — but cold catalog + thin preference data may degrade plan quality or force more T2 escalations. **Pressure-test:** does a "minimum-viable Kitchen Map" (M1+M2) produce a safe, non-embarrassing first week? If not, the defer line moves.
2. **Dock placement** (left rail vs. bottom dock vs. full-screen Lumi route) — needs a prototype to feel. Suggest building one `_dev-` route first.
3. **Artifact-in-thread on which surface first.** Recommend the Brief as the pilot — highest value, clearest artifact, lowest risk.
4. **How much route collapse is safe** given existing deep-links and the child/grandparent/ops scopes. The 4-anchor model (§2c) is a target, not a guarantee; audit deep-link dependencies first.

---

## 7. Suggested build order (when this becomes epics)

Lowest-risk-first, mirroring how Epic 2.7 sequences (gate → deterministic core → conversational layer last):

1. **Spec + build the Lumi dock** (replaces `LumiOrb`/`LumiPanel`). Concrete component contract, states, SSE/voice integration. Unblocks everything else.
2. **Artifact-in-thread pilot on the Brief** as a `_dev-` route — feel it before committing.
3. **Planner conversational editing** — depends on the companion routing spec + `CatalogRepo.pick()` landing first (that's the cost keystone).
4. **Onboarding UX simplification** — lands on top of the Epic 2.7 inverted backend; one conversation mode, profile-panel-as-hero, recognition-moment summary.
5. **Route collapse to 4 anchors** — last, after deep-link audit.

---

## 8. What to do when you come back (post-API)

1. Read the finalized Epic 2.7 onboarding contracts (`OnboardingController` / `TurnRunner` split, the slot-predicate model, the chip-as-deterministic-state output).
2. Reconcile §3 (onboarding UX) against those contracts — the "one conversation mode" and "profile-as-hero" changes should map cleanly onto the inverted backend.
3. Reconcile the companion routing spec (`plan-conversational-edit-routing-spec.md`) §5 signatures against whatever 2.7 settles for the provider-seam call shape, strict-schema path, and trace facility — rename, don't rethink.
4. Resolve the three open decisions in the routing spec §9 (snack attestation, recency source, `plan_slots` snack storage).
5. Pick the pilot surface (§7.2) and prototype the dock (§7.1).

---

## Appendix — Current-state references (what the rebuild replaces)

- `apps/web/src/routes/(app)/layout.tsx` — mounts `AppHeader` + global `LumiOrb` + `LumiPanel`
- `apps/web/src/components/LumiOrb.tsx`, `LumiPanel.tsx`, `LumiFAB.tsx` — the decoration-scattered Lumi surfaces the dock replaces
- `apps/web/src/features/plan/PlanPage.tsx`, `PlanTile.tsx`, `PlanActionSection` — the planner (note: `PlanActionSection` diverges from the locked `StickyBottomBar`)
- `apps/web/src/features/onboarding/OnboardingText.tsx` (~2,460 lines) — the two-column chat + live profile panel + 6 Moments
- `apps/web/src/routes/(app)/onboarding.tsx` — the onboarding state machine (select → voice|text → consent → mental-model)
- `apps/web/src/stores/lumi.store.ts`, `useLumiNudgeSSE.ts`, `useLumiContext` — the conversational state + proactive-nudge + surface-awareness already in place
- `docs/DESIGN.md` — Editorial Hearth v2.0 (tokens, Honey rule, 5-button taxonomy, StickyBottomBar, 17 locked components) — **kept, not redesigned**
- `_bmad-output/planning-artifacts/epic-2.7-brief.md` — the onboarding control-inversion this UX rebuild lands on top of
- Memory: `onboarding-ux-is-chat-not-form`, `chip-taxonomy-three-types`, `design-md-canonical`, `mock-screen-reference-check`, `three-slot-weighted-structure`, `family-first-main-then-variations`, `parent-confidence-prevents-cafeteria`

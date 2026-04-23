---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-02b-vision', 'step-02c-executive-summary', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete']
workflowComplete: true
completedDate: '2026-04-20'
inputDocuments:
  - '_bmad-output/planning-artifacts/product-brief-2026-04-18.md'
  - '_bmad-output/brainstorming/brainstorming-session-2026-04-17-1940.md'
documentCounts:
  briefs: 1
  research: 0
  brainstorming: 1
  projectDocs: 0
workflowType: 'prd'
project_name: 'HiveKitchen'
operatingMode: 'challenger — brief/brainstorm are source of truth; docs/ are constraints only; market-winning positioning takes priority over matching user notes'
classification:
  projectType: 'web_app'
  projectTypeNotes: 'web-only (locked). React/Vite SPA + Fastify API + SSE + ElevenLabs WebSocket. No mobile, no PWA push. H2 two-sided marketplace dropped — H1 only.'
  domain: 'regulated consumer AI — household planning'
  domainNotes: 'COPPA + AADC posture on child-signal data; allergy-liability as safety-critical; cultural-data sourcing as product requirement. Not a clean CSV match.'
  complexity: 'medium-high'
  complexityDrivers:
    - 'unified voice↔text thread model under one auth context'
    - 'longitudinal family-intelligence graph (sole compounding moat)'
    - 'cultural-data sourcing at product-quality depth'
    - 'COPPA/AADC compliance posture for under-13 signal data'
    - 'allergy-safety liability (non-informational)'
  projectContext: 'greenfield · H1 only'
  strategicFramingForDownstream:
    substitutes: ['pantry-scavenged PB&J (zero-friction default)', 'school-lunch tired-day escape hatch']
    moatRanking: ['longitudinal family intelligence graph', 'cultural depth (if verified w/ native cooks)', 'Heart Note ritual', 'Pantry-Plan-List workflow']
    positioningLock: 'retain the "what''s for lunch" JTBD framing (SEO reality). "AI companion" framing rejected — positioning theater + expands COPPA surface.'
    complianceStance: 'COPPA compliance via parent-as-account-holder + VPC + parental review dashboard + ElevenLabs DPA + no ad/analytics SDKs on Lunch Link pages. Compliance is a design requirement, not a blocker.'
vision:
  primaryProblem: 'Recurring daily puzzle of packable, healthy, culturally-authentic, child-accepted lunches — too multi-dimensional to solve repeatedly from scratch; no tool is knowledgeable enough to be a real partner.'
  lumiRole: 'Specialized sous-chef who learns your family week by week. Carries the mental load. Never audits the parent.'
  emotionalOutcome: 'Earned, not advertised. Byproduct of the puzzle being solved well — child feels seen, parent feels they showed up.'
  weekOneWowMoment: 'Sunday morning: the plan is already done, and the week reflects the family''s cultural identity back without being asked. Delivered with honesty — onboarding makes Lumi''s learning visible; no day-1 omniscience pretense.'
  coreInsight: '2026 is when AI can finally be in the kitchen with you — overhearing, remembering, adjusting at cost/latency that makes the sous-chef metaphor literal, not aspirational.'
  onePitchSentence: 'HiveKitchen is the sous-chef in your kitchen — she learns your family week by week, handles the weekly lunch plan and shopping list, and gives you back the part that matters: showing up for your child.'
  primaryMoat: 'Longitudinal family-intelligence graph (compounding). Cultural depth, Heart Note, Pantry-Plan-List = retention hooks, not moats.'
  heartNoteStatus: 'Retained as product doctrine and retention engine. Not the week-1 wow. Not the pitch headline.'
  visibleMemoryDoctrine: 'Parent can see what Lumi has learned, edit it, and forget it. Product doctrine, not just a compliance panel — closes the "knows your family" credibility gap and satisfies COPPA/GDPR-adjacent trust.'
  positioningLock: '"Lunch-planning partner who knows your family" — sous-chef framing retained in product, not just marketing. Rejects both "meal planner" (too thin) and "AI companion" (theatrical + COPPA-risky).'
  flaggedForEpics:
    - 'Grocery list export integrations (Instacart/Walmart) to resolve "shopping" promise honestly'
    - 'Thursday mid-week re-engagement surface (Sally''s blind spot — week-4 churn risk)'
    - 'Lumi''s "corner of the counter" — ambient presence, not chat bubble'
    - 'Generative vs. curated cultural templates (Mary''s pressure-test) — technical depth decision'
    - 'Onboarding as ritual — three signal questions (grandmother''s food / Friday rhythm / child''s refusal) rather than a 20-field form'
  killSignals60Day:
    - '<40% of activated beta households still planning via Lumi in week 4'
    - 'Week-1 plan rejection/edit rate >50% (the puzzle is not being solved)'
    - '<60% of activated households reporting mid-beta willingness-to-pay at $6.99/mo'
prdBacklog:
  - section: 'Pricing'
    flag: 'The $6.99/mo flat-subscription anchor is a hypothesis. Evaluate alternative structures: per-child tiering, school-year prepay, grandparent gift bundle, employer-benefit B2B2C.'
  - section: 'GTM'
    flag: 'Direct-to-parent is the H1 default. Surface grandparent-gift and employer-benefit channels as expansion lanes; design an explicit community-trust strategy for cultural-community channels (mosques, temples, community centers) — not just a channel list. Candidate levers: open-source cultural-template contribution, default-anonymized community-originated data, community stewardship roles, transparent multi-language data-use manifesto.'
  - section: 'Plan Lifecycle / Product Principles'
    flag: 'Define the system-observable event that constitutes "parent saw the plan" — page-load of home screen, scroll-past-fold, time-on-plan-view, or other. "Silence is trust" requires a verified visibility signal.'
  - section: 'Product Principles'
    flag: 'Principle 2b (proposed): Lumi does not nudge on Heart Note absence. Writing is voluntary; silence is not a gap to be closed. No re-engagement surface may reference Heart Note frequency or absence — no streaks, no indicators, no "you''ve been quiet" copy. Retention engine must not invert into guilt engine.'
  - section: 'Product Principles'
    flag: 'Principle 4 (amended): Voice is a first-class channel; tier determines access, not capability. Two moments are free on all tiers regardless of pricing — Heart Note voice capture (Principle 3 sacredness) and voice-interview onboarding (anti-friction spine). All other voice conversation is Premium-metered.'
  - section: 'Epics (earlier)'
    flag: 'Cultural model must be composable, not categorical — multi-cultural households (South Asian + Jewish, Caribbean + Latinx, Halal + Hindu-vegetarian, etc.) are first-class, not edge cases.'
  - section: 'Epics (earlier)'
    flag: 'Grocery list export integrations (Instacart/Walmart) to resolve "shopping" promise honestly without claiming fulfillment.'
  - section: 'Epics (earlier)'
    flag: 'Thursday mid-week re-engagement surface — Sally''s blind spot — to absorb week-4 churn.'
  - section: 'Epics (earlier)'
    flag: 'Lumi''s "corner of the counter" ambient presence — not a chat bubble; not a page to visit.'
  - section: 'Technical Depth'
    flag: 'Generative vs. curated cultural templates — the Sunday wow collapses by week 3 if the template library is static. Cultural model must compose.'
  - section: 'Onboarding'
    flag: 'Onboarding as ritual — three signal questions (grandmother''s food / Friday rhythm / child''s refusal) rather than a 20-field form. Lumi''s learning must be visible from week 1.'
  - section: 'UX Design / Epics'
    flag: 'Grief-state UX — what does Lumi do when a week accumulates a string of negative ratings from a child? Copy, UX, and Lumi''s voice in that moment are not specified. Must avoid both false cheer and pity; must stay inside Principle 3 (Heart Note sacredness).'
  - section: 'Voice Interaction / UX Design'
    flag: 'Voice mid-Heart-Note loss-of-context recovery — when cellular drops or mic fails mid-Heart-Note-capture, what does the parent see? Options: preserved draft, visual transcription of captured audio so far, re-record from top. Load-bearing for the most emotional capture moment in the product.'
  - section: 'QA / Testing Strategy'
    flag: 'Test infrastructure implicitly required but not yet budgeted: @axe-core/playwright (accessibility), Lighthouse CI (Core Web Vitals per route), SSE-capable integration test harness (eventsource-mock or equivalent — MSW does not cover SSE), Playwright fixtures for microphone permissions, i18n snapshot tool for multilingual Heart Note rendering. ~4 test infra packages unacknowledged in the stack.'
---

# Product Requirements Document — HiveKitchen

**Author:** Menon
**Date:** 2026-04-19

## Executive Summary

**HiveKitchen is the sous-chef in your kitchen — she learns your family week by week, handles the weekly lunch plan and shopping list, and gives you back the part that matters: showing up for your child.**

HiveKitchen is a web-delivered AI planning companion for working parents of school-age children (4–17) who face a recurring puzzle every school week. Packable lunches must be healthy, preservative-free, allergy-safe, school-policy-compliant, culturally authentic — and actually eaten. Existing tools treat this as recipe discovery. HiveKitchen treats it as a standing partnership with an AI agent — **Lumi** — who learns the family's kitchen, constraints, culture, and child palate, and produces a finished weekly plan before the school week begins.

The primary economic segment is dual-working-parent households managing at least one non-trivial constraint (allergy, school food policy, selective-eating child, or combination). Cultural identity is the sharpest *wedge* within that segment: Halal, Kosher, South Asian, East African, and Caribbean households are underserved by US-centric meal products and are the highest-converting entry point for go-to-market. Cultural depth is therefore a *differentiator*, not a segment — one that disproportionately wins the culturally-identified sub-set of the primary segment. The cultural model must be **composable, not categorical** — a significant portion of the wedge segment is multi-cultural (e.g., South Asian + Jewish, Caribbean + Latinx, Halal + Hindu-vegetarian households), and blended families are *more* sensitive to cultural fidelity, not less. The product treats cultural identity as layered and additive rather than as a lookup-table match.

The child participates as a signal source through the daily **Lunch Link** — a no-install, link-delivered ritual carrying a parent-authored **Heart Note** and a single-tap rating — but never operates the system.

The weekly cycle is proactive and low-friction: Lumi generates next week's plan on Friday–Sunday, surfaces it on a home screen that requires no taps, derives the grocery list, routes specialty ingredients to the right store, ingests casual mentions during an Evening Check-in to enrich the family profile, and carries the parent's Heart Note to the child unmodified. Plans are proposals, never approvals. Silence is trust; confirmation is not required. Visibility always is. Plans are weekly scaffolds, not immutable contracts — they remain fluid until the day they cover, absorbing leftover swaps, sick days, and partner-handoff reality without requiring re-planning.

HiveKitchen ships USA-first as an invite-only closed beta (April–September 2026, six months free), transitioning to public launch on **October 1, 2026** under a two-tier model — **Standard at $6.99/month or $69/year** (text-led, with free voice onboarding, Heart Note voice capture, and a 10-minute weekly voice-conversation allowance) and **Premium at $12.99/month or $129/year** (unlimited tap-to-talk Evening Check-in, priority voice features, and future Lumi's-Voice-to-the-Child milestones). Both tiers are school-year aligned with auto-pause during holidays. The closed beta receives Premium features free through September 2026; a mid-beta A/B test of Standard-only conversion validates the tier structure before public launch. The Horizon 2 two-sided provider marketplace is explicitly deferred out of this release.

**The wager.** HiveKitchen's bet is that a longitudinal family profile plus Lumi's track record of successful plans against that family compounds into a defensible position that a well-prompted ChatGPT or a warmed-up Mealime cannot replicate in the window before general-purpose LLMs ship native household templates. The beta period is what validates or kills the bet.

**The threat window.** HiveKitchen's advantage against horizontal LLMs (ChatGPT Memory+Projects, Claude Projects) is a 12–24 month vertical-workflow window. The beta period must convert that window into installed family profiles with meaningful plan-success history before general-purpose LLMs ship native household templates.

### What Makes This Special

**The core insight.** The category-shifting enabler is not that AI can plan lunches — it's that in 2026, LLMs are finally cheap and fast enough for AI to be *in the kitchen with you*: overhearing, remembering, adjusting, asking only what it needs — at a cost and latency that makes the sous-chef metaphor literal rather than aspirational. Configuration *is* the conversation; there is no 20-field form. Three signal questions ("What did your grandmother cook?" "What's a Friday in your house?" "What does your child refuse?") begin the relationship; every subsequent plan adjustment and mentioned detail silently enriches it.

**How cultural recognition earns its way in.** Onboarding does not fake day-one omniscience. In week 1 the plan is competent and honest about its blanks ("Give me a week — I'll learn the rhythm"). By week 2 or 3, the plan begins to reflect the family's cultural identity back — a biryani night, a hamentaschen Friday — without having been re-asked. The first-session win is proactive completeness; the compounding win is cultural recognition without configuration.

**Defensibility: a vertical-workflow focus bet.** HiveKitchen's defensibility rests on vertical-workflow depth plus a longitudinal family profile that Lumi has tested plans against. Most of the profile accumulates in the first ~90 days; what compounds beyond that is Lumi's *successful-plan track record* against this specific family — which does not exist anywhere else. Cultural depth, the Heart Note ritual, and the Pantry-Plan-List loop remain **retention engines and product requirements, not moats** — a well-motivated competitor could replicate any of them in weeks. This is a focus bet — vertical-workflow execution against horizontal generalists — not a structural moat. The thesis requires outshipping both ChatGPT-as-meal-planner and Mealime-as-family-tool on the single workflow that matters: the weekly school-lunch puzzle, solved end-to-end, family-specific, culturally honored.

**Visible memory as product doctrine.** Parents can see what Lumi has learned, edit it, and forget it. This is not a compliance bolt-on — it is the trust surface that closes the "knows your family" credibility gap, satisfies COPPA (US under-13 data rule) and California AADC (Age-Appropriate Design Code) posture for under-13 signal data, and makes the accumulating intelligence legible rather than uncanny. The principle of visible, editable memory **supersedes** the moat — parents own their profile; if a parent forgets, Lumi forgets, and the track record goes with it. The moat is real but voluntary; trust is the precondition, not the output.

**Positioning.** HiveKitchen is a *lunch-planning partner who knows your family*. It rejects the "meal planner" frame (too thin, commoditized, and loses to free AI chatbots) and the "AI companion" frame (theatrical and expands regulatory surface). It wins on the job parents actually have ("what's for lunch") while delivering an experience that competitors cannot: a standing relationship, not a tool session.

**The real competitive set.** The primary comparison is **ChatGPT with Memory + Projects / Claude Projects** — a general-purpose LLM with persistent context that a technically-literate parent can configure into a lunch-planning helper. HiveKitchen's thesis is that the cultural-depth data model, the proactive weekly cadence, the Pantry-Plan-List loop, and the child-side Lunch Link surface combine into a workflow that a configured LLM cannot match without an order-of-magnitude more user effort. Secondary comparisons: **Samsung Food / Whisk** (ex-Yummly team, culturally aware), **Paprika / AnyList** (incumbent household-habit products), and category tools like **Mealime** and **EatThisMuch**. The true day-to-day substitutes are the **pantry-scavenged PB&J** (zero friction, zero cost, muscle memory) and the **tired-day school-lunch escape hatch** — every feature must beat *three minutes and a paper bag*.

### Success Bar, Risks, and Scope

**Beta validation signal (60-day check).** HiveKitchen is working if **≥40% of activated beta households** (those that completed onboarding and received a first plan) are still planning through Lumi in week 4, and **<50% of week-1 plans are rejected or heavily edited**. Activation rate (invitation → first plan) is a secondary signal but not the gating threshold. Below either primary threshold, the thesis — not the execution — is failing. A parallel validation signal (collected at mid-beta) is explicit willingness-to-pay: **≥60% of activated households reporting they would pay $6.99/month if charged today**. Below that threshold, the retention signal is a false positive of free-product usage — and the pricing hypothesis must be revisited before public launch.

**Top risks.**

1. **Allergy-safety liability:** a single false-negative on a safety-critical constraint is existentially worse than many planning misses. **This is the one product surface where the "silence is trust" doctrine does not apply** — allergies require explicit, auditable parent confirmation at profile creation and on every affected plan change. Confirmation architecture and legal posture are P0; detailed treatment lives in the Compliance/Safety section of the PRD.
2. **Cold-start credibility:** promising "knows your family" before the graph has time to learn is the quickest way to bounce week-1 users. The honesty-about-learning posture ("Give me a week") mitigates this, but only if onboarding copy and first-plan presentation follow through without drift into over-claiming.

**Explicitly out of scope for this release.** The Horizon 2 two-sided provider marketplace, any native mobile client, and any grocery-fulfillment integration beyond exportable shopping lists.

## Project Classification

- **Project Type:** Web application. React/Vite SPA (Lumi Client) + Fastify/Node.js API (HiveKitchen API) + Server-Sent Events for real-time delivery + ElevenLabs WebSocket for voice. Supabase (PostgreSQL) + Redis + object storage. **Web-only is locked** — no mobile client, no PWA-push in this release.
- **Domain:** Regulated consumer AI in the household-planning stack. Overlaps **edtech-adjacent** (COPPA and California AADC posture for under-13 signal data), **food-safety-adjacent** (allergy-safety liability — stakes are physical, not reputational), and **consumer AI** (accumulating-intelligence moat, LLM and voice-pipeline cost economics). No single CSV-taxonomy row fits.
- **Complexity:** Medium-High. Drivers: (1) unified voice-and-text thread model under one authenticated conversation context; (2) longitudinal family-intelligence graph as the sole compounding differentiator; (3) cultural-data sourcing at product-quality depth across Halal, Kosher, Hindu-vegetarian, South Asian, East African, and Caribbean households — and blended multi-cultural households; (4) COPPA/AADC compliance posture for under-13 signal data; (5) allergy-safety liability (stakes are physical, not reputational).
- **Project Context:** Greenfield. Horizon 1 only for this release — the Horizon 2 two-sided hyperlocal cloud-kitchen provider marketplace is explicitly deferred. Pre-build; no legacy code to preserve; strong upstream design constraints from existing architecture and principles documents.

## Product Principles

Product principles govern every downstream design, architecture, and engineering decision. They are constraints, not aspirations. Every functional requirement, UX flow, and technical choice must pass this filter. Principles below are numbered for cross-reference from Epics and stories; sub-principles, corollaries, and amendments are named inline.

### Principle 1 — Lumi leads. Parents confirm. Children feel.

Every plan, prep card, adjustment, and insight is produced by Lumi first and presented as a finished proposal. Visibility is required; confirmation is not.

**Sharpening.** "Lumi leads" does NOT mean "Lumi initiates frequently." Lumi has the plan ready when the parent comes looking; she does not interrupt with nudges, warnings, or "want me to add X?" prompts. Each proactive prompt is a micro-decision, and micro-decisions are cognitive load. Lumi waits on the parent, not the other way around.

### Principle 2 — No approvals, only proposals.

Plans never require explicit approval. They remain mutable until the day they cover. No accept buttons. No confirmation modals. Silence is trust, not consent. Visibility is the only requirement; adjustment is optional.

### Principle 3 — The Heart Note is sacred.

A parent-to-child emotional channel, never used for logistics, reminders, chores, or system messaging. It exists solely to let the child feel the lunch was prepared with love.

**Corollary 3a.** The Heart Note cannot reference the feedback system, the lunch rating, or Lumi's learning — ever. It is the parent's unmodified voice. Lumi does not scaffold, shape, nudge, suggest, or amplify its emotional content. When Lumi needs to communicate with the child directly, she uses a separate, clearly signed channel, never the Heart Note.

**Corollary 3b (no-nudge).** Lumi does not nudge on Heart Note absence. Writing is voluntary; silence is not a gap to be closed. No re-engagement surface may reference Heart Note frequency or absence — no streaks, no indicators, no "you've been quiet" copy. A retention engine that audits the emotional act it carries inverts into a guilt engine. This is forbidden.

### Principle 4 — Voice and text are Lumi's conversational channels.

Both are first-class; users choose their modality based on context and preference.

**Corollary 4a.** Transactional surfaces (grocery list, plan view, prep card, Lunch Link emoji) remain tap-based. Voice and text are for conversation; tap is for transaction.

**Amendment (tier).** Voice is a first-class channel; tier determines *access*, not *capability*. Two moments are free on all tiers regardless of pricing — Heart Note voice capture (Principle 3 sacredness) and voice-interview onboarding (anti-friction spine). All other voice conversation is Premium-metered.

**Sub-principle — Lumi's voice character.** Warm, never chirpy. Calm evening energy. Asks only what she genuinely needs to know. Silence is a complete answer. Ends conversations with "I'm here" presence rather than pressure. She is a conduit for emotion, never a participant in it. Parent-to-child feeling travels through her; it never originates with her.

### Principle 5 — Earned through eating, not through tapping.

The child's accumulating artifacts (flavor profile, cuisine passport, cultural journey) reflect genuine taste and growth from lunches and ratings — not rewards for behavioral frequency. No streaks. No points. No leaderboards. No gamification. The artifact is a document of the child's becoming, not a score on it.

### Boundary 1 — Children signal. Children do not operate.

Children rate, request, vote, contribute recipes (age-appropriate, parent-approved), and see their accumulating flavor profile in passive, read-only form. Children do not access settings, edit profiles, plan weeks, or configure the system. No child account. No child-controllable surfaces. The child is a signal source, not a system operator.

### Doctrine — Visible memory supersedes moat.

Parents can view, edit, and forget everything Lumi has learned. Forgetting collapses the longitudinal track record that is the product's compounding defensibility. The principle of visible, editable, forgettable memory **supersedes** the moat — trust is the precondition, not the output. Competitors may lock users in opaque memory; HiveKitchen earns them every week.

### Doctrine — Allergy safety carves out from "silence is trust."

Allergies are the single product surface where the "silence is trust" doctrine does not apply. Allergy-relevant decisions require explicit, auditable parent confirmation. A separate deterministic guardrail layer — independent of LLM judgment — runs as a post-filter on every plan. Safety-critical decisions do not share infrastructure or posture with generative decisions. The one carve-out exists because the cost of a failure is categorically different: physical, not reputational.

### Doctrine — Internal-use only during beta.

During the closed beta (April–September 2026), child-associated data is handled strictly for internal product-quality purposes: no third-party data sharing, no behavioral advertising, no cross-product mixing, no data resale. This posture is what permits the soft-VPC consent mechanism to be defensible; it is load-bearing for the compliance architecture and must not drift.

### Doctrine — Payload scrubbing for any sharing surface.

If a sharing feature ships (trusted-circle recipe sharing in Growth, or any future community surface), the shared payload **must contain zero child-identifying data** — no child name, no child-level rating, no child-linked allergen or dietary identity. A payload scrubber strips these fields before the recipe leaves the origin household. Public / anonymous recipe sharing remains out of scope for MVP per §10 of the brief (social-platform prohibition).

## Success Criteria

### User Success

**Primary user-success kill signal:**

- **First-plan satisfaction** (survey within 48 hours of first-plan view): **≥75% of activated households** rate the first plan "fits our family" (4 or 5 on a 5-point scale). Earliest leading indicator — if week 1 doesn't land, no retention number rescues the thesis.

**Supporting signals (tracked, not gating):**

- **Cultural recognition lands** (for culturally-identified households): ≥70% report the week-2-or-3 plan "felt like it knew us" — the compounding-wow check.
- **Heart Note authored-rate on school days** (after week 4, habit-stabilized): ≥50%.
- **Child Lunch Link engagement**: ≥60% of children with delivery channel configured tap at least weekly by week 3.
- **Qualitative beta signal**: ≥3 mentions per household of "Lumi got better" / "it knows us" / "I stopped thinking about lunch" by week 8.

### Business Success

**Beta validation (60-day check):**

- ≥40% of activated beta households still planning via Lumi in week 4.
- <50% week-1 plan rejection / heavy-edit rate.
- ≥60% of activated households report mid-beta willingness-to-pay at Standard $6.99/mo.
- ≥20% of activated households report willingness-to-pay at Premium $12.99/mo.
- Activation rate (invitation → first plan) tracked as secondary, not gating.

**Premium-tier validation (mid-beta A/B test):**

- At month 5, half the beta cohort transitions to Standard-only (voice capped at 10 min/week). Retention delta is measured over the following 30 days.
- **Kill thresholds:** if Standard-vs-Premium retention gap is <10 points, the tier structure adds no value (collapse to a single tier); if the gap is >25 points, Premium is pricing out the core experience (revisit tier design).

**Public-launch KPIs (Oct 1, 2026 → April 2027):**

- ≥40% trial-to-paid conversion (post-beta cohort).
- ≥70% month-2 paid retention (Standard + Premium combined).
- ≥25% of paying households on Premium tier by month 3. Kill signal: <15% means Premium is not compelling.
- Willingness-to-pay validated across ≥3 distinct cultural segments via paid conversion.

### Technical Success

**Performance SLOs:**

- Plan generation: first plan delivered **<90s** from profile completion.
- Evening Check-in latency (text): first-token **<500ms**.
- Evening Check-in latency (voice, Premium): first-token **<800ms**; turn-to-turn **<600ms**.
- Lunch Link delivery: **≥99.5%** successful by **7:30am local** on school days.

**Unit-economic SLOs:**

- Standard-tier voice cost ceiling: **<$1.00/mo/HH** (covers Heart Note voice capture + voice onboarding + 10-minute weekly Evening Check-in cap).
- Premium-tier voice cost ceiling: **<$4.00/mo/HH** at p95 (target typical: $2.50–$3.50).
- LLM cost per plan generation: **<$0.25/plan**.

**Safety and compliance (non-negotiable):**

- **Zero** false-negatives on declared allergies across all plans generated. Enforced by a dedicated allergy-safety guardrail layer independent of LLM judgment.
- COPPA / California AADC audit-readiness by public launch: VPC mechanism tested, parental review dashboard live, ElevenLabs DPA executed, no third-party analytics or advertising SDKs on Lunch Link pages.
- Visible Memory panel operational — parent can view, edit, and forget profile entries.

**Reliability:**

- API availability: **99.9%** during school hours (6am–9pm local).
- Voice pipeline availability: **99.5%** (graceful text fallback when unavailable).
- Family-profile data durability: **99.999%** (Supabase baseline; no acceptable data loss on family profile).

### Measurable Outcomes

| Category | Signal | Threshold | When |
|---|---|---|---|
| User | First-plan satisfaction | ≥75% 4-or-5 rating | Week 1 (beta) |
| User | Cultural recognition landed | ≥70% | Week 2–3 |
| User | Heart Note authored-rate | ≥50% school days | Week 4+ |
| Business | Week-4 planning retention (activated) | ≥40% | Beta day 60 |
| Business | Week-1 plan rejection / heavy-edit | <50% | Beta day 30 |
| Business | WTP at $6.99 Standard | ≥60% activated | Beta day 90 |
| Business | WTP at $12.99 Premium | ≥20% activated | Beta day 90 |
| Business | Trial-to-paid conversion | ≥40% | Post-beta |
| Business | Premium tier mix (paid cohort) | ≥25% | Public launch +90d |
| Tech | Plan generation latency (p95) | <90s | Continuous |
| Tech | Voice first-token (Premium) p95 | <800ms | Continuous |
| Tech | Lunch Link delivery by 7:30am | ≥99.5% | Continuous |
| Tech | Standard-tier voice cost | <$1.00/mo/HH | Continuous |
| Tech | Premium-tier voice cost (p95) | <$4.00/mo/HH | Continuous |
| Tech | Allergy false-negatives | 0 | Absolute |
| Compliance | COPPA / AADC audit-ready | Yes | By Oct 1, 2026 |

## Product Scope & Phased Development

### MVP Strategy & Philosophy

HiveKitchen's MVP is a **problem-solving + experience-quality MVP**, not a revenue MVP and not a platform MVP.

- *Problem-solving:* the closed beta must prove that the sous-chef value proposition actually eliminates the weekly puzzle for families under realistic conditions. The beta is a falsifiability exercise for the core thesis, not a rehearsal of feature completeness. Kill signals are defined in Success Criteria.
- *Experience quality:* the quality floor of the Sunday-morning moment, the first-plan satisfaction landing, the cultural-recognition earning-in by week 2–3, and the Heart Note sacredness must be real-grade, not wireframe-grade. A lean MVP that lands emotionally beats a complete MVP that feels cold. This is the honest reading of "Lumi gets better because families *feel* her getting better."
- Not a revenue MVP: beta is explicitly free. Willingness-to-pay is *validated* mid-beta, not captured.
- Not a platform MVP: no external API, no plugin surface, no third-party integrations beyond the listed processor dependencies.

**MVP posture:** the smallest scope that can land both (a) the puzzle-solver promise for 50–150 beta households across constraint-managing working parents and culturally-specific families, and (b) the beta validation signals needed to commit to public launch on October 1, 2026. Every cut is measured against these two standards, not against feature completeness.

### MVP Feature Set (Phase 1 — Closed Beta, April 2026)

The essentials that cannot be cut, organized by the six capability groups surfaced in User Journeys:

**Onboarding & Profile (Group 1).**
Voice-interview onboarding (free, all tiers). Three signal-question + paragraph-dump pattern. Six cultural templates (Halal, Kosher, Hindu vegetarian, South Asian, East African, Caribbean). Composable cultural-identity model (blended families as first-class from day 1). Visible Memory panel live from day 1. Two-phase VPC soft-consent architecture.

**Weekly Plan Lifecycle (Group 2).**
Proactive Friday–Sunday plan generation. Home-screen plan view with no-tap-to-reveal. Plans-as-scaffolds with sick-day pause and day-level fluidity. Allergy + school-policy + child-palate constraint composition. Leftover-aware swap proposals. Pantry-Plan-List silent loop at MVP depth (tap-to-purchase → inferred pantry decrement).

**Household Coordination (Group 3).**
Shared family thread with multi-parent access. Packer-of-the-day UX. Partner handoff without re-planning tax. Secondary Caregiver invite-scoped sessions.

**Sacred Channel — Heart Note (Group 4).**
Parent authoring (text + free voice capture). Unmodified delivery. Emoji rating from child. Heart Note voice playback **deferred to Growth** as Premium feature. Guest-author (grandparent) **deferred to Growth** — guest Heart Note ships alongside Gift Subscription at public launch.

**Child-Side Surfaces (Group 5).**
No-install Lunch Link (email / WhatsApp / SMS delivery). Emoji rating (four options). Passively-accreting flavor-profile artifact. COPPA/AADC Boundary 1 compliance — no child account, no settings access. Text-only child reply channel (per Domain Requirements — no child voice in MVP).

**Safety & Operations (Group 6).**
Independent allergy-safety guardrail layer (non-negotiable). Allergy anomaly dashboard for ops. Audit log with plan-generation stage history. Presentation-layer contract (no pre-guardrail plan ever displayed). Incident-response SLA.

**Cross-cutting technical foundations.**
Monorepo two-app split (`apps/web` SPA + `apps/marketing` SSG). SSE for backend→client push; ElevenLabs WS for voice. Observability MVP-grade (Pino, PagerDuty, basic alerts). CSP / COOP / COEP day-1 posture. Reconnect backoff + jitter. Safety-classified field model enforced. Readability CI check. TTS caption fallback. Two-tier pricing infrastructure present but Premium-features-free-for-beta.

### Post-MVP Phase 2 — Growth (Public Launch through H1 2027)

Prioritized by load-bearing impact on the public-launch thesis:

**P0 (launch-gating — must ship by October 1, 2026):**

1. **Standard vs. Premium paid tiers activated.** Billing infrastructure goes live; credit-card VPC becomes the primary consent mechanism; beta households transition to paid.
2. **Allergy-safety confirmation architecture promoted to P0.** Explicit parent confirmation UX on allergy-relevant plan changes (per Journey 5 learning).
3. **Grandparent gift subscription + guest Heart Note authorship.** $129/yr annual Premium tier + rate-limited guest author (two notes/month).
4. **Grocery-list export** to at least Instacart + one major retailer (Walmart or Kroger) so the "shopping list" pitch promise lands honestly.
5. **Native-cook review** complete for top-3 cultural templates (Halal, South Asian, Hindu vegetarian).
6. **Observability upgraded to Growth-grade** — SLO dashboards, error-budget accounting, multi-severity on-call. Compliance Officer assigned.

**P1 (first 3 months post-launch):**

7. Thursday mid-week re-engagement surface (addresses week-4 churn risk).
8. Onboarding-as-ritual polish (warmer voice-interview copy, cultural sign-posting, honesty-about-learning copy discipline).
9. Heart Note voice playback for Premium.
10. Community-contributed cultural supplier directory (open-source contribution + default anonymization).

**P2 (months 4–6 post-launch):**

11. Native-cook review for remaining cultural templates (East African, Caribbean, Kosher).
12. Cultural-community channel trust infrastructure (multi-language data-use manifesto, community stewardship roles).
13. Ambient presence UX ("corner of the counter") promoted from design flag to shipped surface.

### Post-MVP Phase 3 — Vision (Beyond 2026)

Named but explicitly out of this PRD's commitment:

- Horizon 2 two-sided provider marketplace (cloud-kitchen, hyperlocal, culturally-paired).
- Native mobile clients (iOS / Android).
- International markets with localized cultural-template libraries and tiered pricing.
- Employer-benefit B2B2C channel.
- Pediatrician / dietitian referral channel for allergy and clinical-nutrition households.
- Grocery fulfillment direct integration.
- Lumi's Voice to the Child — milestone moments, cultural acknowledgements, end-of-year flavor letter (Premium feature).
- Voice-enabled child reply channel (gated by compliance review).
- Alternative pricing structures: school-year prepay, per-child tiering, cultural-community bulk licensing.

### Risk Mitigation Strategy

**Technical risks.**

- *Unified voice↔text thread model under one auth context.* Highest-complexity surface per Architect pressure-test. Mitigation: prototype the unified thread early in beta prep; build text-first; layer voice on the proven text foundation.
- *Allergy-safety architecture correctness.* Non-negotiable. Mitigation: independent rule-based guardrail + presentation-layer contractual binding (specified in Domain Requirements); rigorous testing including race-condition scenarios per Journey 5.
- *Cultural-template depth at launch.* Six templates with internal + one-advisor review is the floor; public-launch gate raises this to native-cook review for top-3. Any template failing to pass native-cook review by launch blocks **that template**, not the launch.
- *Test infrastructure.* Four test-infrastructure packages are implicitly required but not yet in the engineering budget (Playwright a11y, Lighthouse CI, SSE integration harness, i18n snapshot tooling — flagged in PRD backlog). Treat as first-class engineering work stream, not retrofit.

**Market risks.**

- *Cold-start credibility.* "Knows your family" on day 1 is a lie the product cannot cash. Mitigation: honest onboarding posture + week-2-or-3 cultural-recognition moment + Visible Memory panel trust surface. Locked in Vision and Executive Summary.
- *ChatGPT Memory+Projects or Claude Projects shipping native Household templates within the 12–24 month threat window.* Mitigation: beta period explicitly framed as converting the threat window into installed family profiles with meaningful plan-success track record before horizontal competitors ship.
- *Beta-to-paid conversion cliff.* Free-beta retention is a false positive of willingness-to-pay. Mitigation: mid-beta WTP survey at $6.99 Standard + $12.99 Premium (required thresholds: ≥60% + ≥20% of activated households); A/B test of Standard-only at month 5 to isolate Premium's retention contribution.
- *Cultural-community channel trust.* Venture-funded SF AI products start at low trust with mosques, temples, and community centers. Mitigation: community-trust GTM strategy required before public launch (flagged in PRD backlog); stewardship roles, default anonymization, multi-language transparency.

**Resource risks.**

- *Six-month beta-to-public-launch timeline.* Aggressive given compliance posture, cultural-review gating, and marketplace deferral not yet absorbed into team capacity. Mitigation: MVP is explicitly a *closed beta*, not a paid product — launch-readiness is gated by beta validation signals, not calendar. If beta signals fail the 60-day check, public launch is *deferred*, not rushed.
- *Compliance Officer role timing.* Must be assigned before public launch. Mitigation: external compliance advisor during beta; full-time Compliance Officer hired by August 2026 at the latest.
- *Cultural-authenticity review capacity.* Cannot rely on generic engineers for cultural-template decisions. Mitigation: community advisors hired on contract from beta prep onward; explicit budget line for this rather than absorbing into product engineering.
- *Team-size anchor.* Beta phase approximately 3–5 engineers + 1 PM/founder + 1 operations lead + 1 design lead + external compliance advisor + ~6 community advisors (contract). Public launch approximately 8–12 engineers + 2 designers + 1 Compliance Officer + expanded ops + community advisor network. Adjustments to this anchor should trigger scope re-evaluation, not timeline compression.

## User Journeys

### Journey 1 — Priya (Premium tier, primary parent, happy path)

**Persona.** Priya Patel, 38, product designer at a Series B startup in Austin. Married to Raj (who travels Monday–Thursday). Two kids: Ayaan (9) and Maya (6). Maya has a confirmed peanut allergy. Priya grew up eating dal-chawal and roti; she feels a quiet, constant guilt that her kids eat American-coded school lunches five days a week. She is a Premium subscriber from day one — voice is her comfort modality at the end of a long day.

**Opening scene.** Friday, September 25, 2026, 9:47pm. Priya has just finished cleaning the kitchen. She opens the beta invitation on her laptop, skeptical. She has tried Mealime. She has tried prompting ChatGPT to plan a week of culturally-aware school lunches. Neither stuck. She clicks "Start with a conversation."

**Rising action.** Lumi opens with voice. Six minutes, three questions: *"What did your grandmother cook?" "What's a Friday in your house?" "What does Maya refuse, and what does Ayaan tolerate?"* Priya talks — not types — for four minutes straight. Zero fields. At the end, Lumi presents a starter profile composed of three active templates (South Asian + Hindu vegetarian + allergy-aware-peanut) and asks, *"Does this look like your kitchen?"* Priya adjusts two things: Maya also won't eat okra, Ayaan likes things he can hold.

**Climax.** Sunday of week 3. Priya opens the app with coffee. Thursday shows a small mithai-box lunch. Friday shows puri and aloo sabji. It is Diwali week. She had not typed the word Diwali. She had mentioned it in passing during Wednesday's voice Evening Check-in — *"Diwali is in three weeks; I haven't started planning anything."* Lumi had said *"Noted"* and nothing else. Three weeks later, the plan reflects it back. Priya's eyes well up. She realizes she has stopped thinking about lunch on Sunday nights.

**Resolution.** By week 8, Priya opens the app once a week for maybe ninety seconds. The flavor-passport page for Ayaan shows dal, puri, khichdi, roti, South Indian curd rice. When her mother-in-law visits, Priya proudly shows her. *"He eats all of this now. He chose these."* Cultural transmission she feared she was failing at has been quietly documented by a system that never once made her feel graded.

**Capabilities revealed.** Voice-interview onboarding (free all tiers). Composable cultural identity model (South Asian + Hindu vegetarian + peanut allergy simultaneously). Unlimited Premium tap-to-talk Evening Check-in. Passive cultural-calendar awareness (Diwali integration without prompting). Silent profile enrichment from casual mentions. Visible Memory panel (reviewed at week 4). Passive flavor-profile artifact. Heart Note voice capture (free all tiers). Premium voice playback of Heart Note (future).

### Journey 2 — Mike + Devon (Standard tier, primary parent, edge-case chaos-absorption)

**Persona.** Mike Rosenberg, 42, freelance illustrator. Married to Devon Campbell, 40, epidemiologist. Blended-heritage household: Mike is Jewish, Devon is Afro-Caribbean. Two kids: Zoe (11, periodically vegetarian, unpredictably) and Jonah (7, sensory-sensitive eater). No allergies. Mike chose Standard tier deliberately — $6.99 is enough, he doesn't want voice fees, he lives in text.

**Opening scene.** Tuesday morning, beta week 6, 6:47am. Jonah walks into the kitchen flushed. *"I don't wanna go, Dad."* Mike takes his temperature. 101.4°F. Sick day.

**Rising action.** Mike opens the home screen. He taps the Tuesday lunch tile for Jonah, selects "sick day — pause Lunch Link, preserve plan." The Tuesday plan for Zoe remains. Lumi silently notes the disruption, doesn't nudge, doesn't reschedule. Wednesday, Mike tags Devon in via the household's shared thread: *"you're up."* Devon — who has never taken over a lunch-pack day mid-week before — opens the home screen on her phone. It shows her as packer-of-the-day. Wednesday's plan is already there. A note from Lumi (text, because Standard): *"Leftover Caribbean pumpkin from Sunday's dinner works in Zoe's lunch today if you want the swap."* Devon taps accept. Thirty seconds.

**Climax.** Thursday 8:34am. The school's own app pushes a bulletin: microwave repair, no heated food Thursday or Friday. By the time Devon looks at the home screen, Lumi has already adjusted. A small banner: *"Thursday and Friday shifted to room-temperature options. No action needed."* Devon sends Mike a screenshot. *"Lumi caught the school thing."* Mike replies with a laughing emoji. Neither of them had to coordinate it.

**Resolution.** Two months in, Mike and Devon stop calling each other to coordinate lunch. The shared family thread is where Lumi holds the state — who is packing, what is in the fridge, what the school changed. Mike did not need Premium. At beta month 5, the A/B cohort splits Mike into the Standard-only arm — his voice cap drops to 10 minutes/week. He barely notices; he has used voice maybe twice total. He stays through the transition. His retention data becomes one of the key signals telling the team that Standard is viable for a material share of the market.

**Capabilities revealed.** Sick-day pause with plan-preservation. Partner-handoff / multi-parent coordination via shared family thread. Text-based Evening Check-in (unlimited, all tiers). Leftover-aware Pantry-Plan-List swap proposals. School-policy diff-watch and silent plan adjustment. Packer-of-the-day ownership UX. Standard-tier voice cap enforcement. Family-thread unification across members. Cultural composability (Jewish + Afro-Caribbean blended — requires additive cultural model per Growth flag).

### Journey 3 — Ayaan (child, signal source, Boundary 1)

**Persona.** Ayaan Patel, 9, fourth-grader, Priya's son. Plays soccer twice a week. Hates peas. Has been slowly eating more Indian food at dinner because his mom cooks it on weekends now.

**Opening scene.** Monday of beta week 1, school cafeteria. Ayaan unzips his lunchbox. Inside: a wrap, sliced cucumber, a small cup of sunbutter, and — on blue card stock, slipped in — a handwritten note from his mom. *"Protein bowl day. I love you. Go get 'em at goalie practice."* A QR code at the bottom. His dad's old iPad is at home; the link is bookmarked "Ayaan's Lunch."

**Rising action.** At lunch he opens the bookmark on the iPad. The page shows the lunch in a photo, the note from his mom, and four emoji options: 😍 🙂 😐 😕. He taps 🙂. The page says *"Thanks, Ayaan."* That is the entire interaction. No login. No setting. No profile. Over the next three weeks he gets into the rhythm. When he taps the 😍 on his mom's spinach-potato-curry wraps, they show up again in the next weekly rotation. He notices. He starts to feel like the app is listening to him without ever having asked him anything.

**Climax.** Week 5. The Friday Lunch Link shows a small biryani scoop, photographed on his own plate. Below the photo, a note from his mom: *"This is what Nani used to pack me. Enjoy."* Below the note, a new page has appeared: *Ayaan's Flavor Journey.* A small grid. Dal, roti, puri, biryani, idli, cucumber chutney, hummus, sunbutter. Small tiles. Grouped into *Indian*, *American*, *Mediterranean*. At dinner that night, Ayaan says to Priya, *"I got Indian food at lunch today. Nani's kind."* Priya does not tell him she had no idea that was on the plan until Friday morning.

**Resolution.** By week 12 Ayaan has never opened a settings page, never seen his own profile, never configured anything. His flavor-passport fills in passively — earned through eating, never through tapping. He has a sense of becoming. His food identity is accreting in the same direction his mom always hoped it would, but the accretion is *his*, not hers.

**Capabilities revealed.** No-install child-side web surface (Lunch Link). Emoji rating UX (4 options, single tap). Heart Note recipient UX (text + optional parent voice-playback for Premium). Flavor-passport artifact as read-only, passively accreting. Earned-through-eating principle (no streaks, no points, Principle 5). COPPA/AADC posture (no child account, no settings access, no profile editing, Boundary 1). Cultural-calendar tie-in visible to child through the plan, not through configuration. Age-band progression hook for older children.

### Journey 4 — Nani (grandparent gift + guest Heart Note authorship)

**Persona.** Shobha Patel, 68, widowed, lives in Edison, NJ. Priya's mother. Mails monthly care packages of barfi, hand-ground garam masala, and a jar of garlic pickle. Calls Ayaan and Maya every Sunday afternoon. Quietly worries that her grandchildren will grow up not knowing the food she grew up on.

**Opening scene.** Early October 2026. Nani is scrolling Instagram and sees a HiveKitchen ad — a brown-skinned mother in a kitchen, a handwritten note, a child smiling at a lunchbox. The tagline reads: *"Send them a little of you, even when you can't be there."* The ad runs in Hindi first, English second. She pauses. She clicks.

**Rising action.** The gift-subscription page offers one year of HiveKitchen Premium to Priya's family for $129. Below it, a second option: *"Guest Heart Note access — author up to two notes a month to your grandchildren, for an additional $24/year."* Nani enables both. She pays. The gift is scheduled to land the day before Diwali.

**Climax.** Diwali-week Friday. Ayaan's lunchbox carries the Diwali plan that Priya had been delighted by. His Heart Note that day, however, is not from Priya. It is from Nani, typed two days earlier in her deliberate English: *"Beta, Diwali mubarak. I made this recipe when I was eight years old, same as you. I taught your mama. Now you're eating it. I love you. — Nani."* At dinner that evening, Ayaan shows the note to Priya. Priya does not tell him that her mother — who lives four hours away — has now become part of the daily fabric of her son's school lunch. She goes to the bathroom and cries.

**Resolution.** Over the year, Nani sends twelve notes. Each one carries cultural lineage — a phrase in Gujarati, a childhood memory, a nickname only family uses. Lumi delivers each one exactly as Nani wrote it. No softening. No suggestion. No prompt from Lumi at any stage to "help write." The sacred channel stays unmodified regardless of author. The cap (two notes per month) is not a revenue lever — it is a sacredness guardrail. Frequency must not dilute meaning.

**Capabilities revealed.** Gift-subscription purchase flow. Guest Heart Note authorship with rate-limited access. Multi-generational authorship model (parent + grandparent share the same sacred channel). Cultural-lineage preserved in Heart Note content. Principle 2a enforcement regardless of author identity. Principle 3 sacredness cap (volume limit as design doctrine, not monetization). Acquisition channel validation (grandparent-gifted households as high-emotional-context entry point). $129/year Premium annual at gift-acceptable price anchor.

### Journey 5 — Sam (internal operations, allergy-incident response)

**Persona.** Sam Okonkwo, 34, HiveKitchen beta-cohort operations lead. Manages the 50-household beta day-to-day. Watches the allergy-safety dashboard as a core responsibility. First responder when the safety guardrail layer fires an anomaly.

**Opening scene.** Wednesday morning of beta week 9, 9:12am. Sam's dashboard flashes orange: household ID 038 has an allergy-concerning anomaly. Household 038 declared sesame allergy for their child, Layla. Tuesday evening's generated plan suggested a tahini-based dip for Wednesday's lunch. Tahini is sesame paste. The parent has not complained; the system's own anomaly detector surfaced it.

**Rising action.** Sam opens the incident record. The audit log tells a three-stage story:
1. The allergy-safety guardrail layer DID flag the tahini proposal. The log shows `rejected: allergen match [sesame]`.
2. The LLM regenerated the plan with the guardrail's rejection as context. The regenerated plan was clean — hummus swap (chickpea-only, sesame-paste-free).
3. But — and this is the problem — the home screen had cached the pre-regeneration plan for 94 seconds before the regenerated version propagated. The parent had opened the app during that 94-second window. She had seen the tahini version. She had caught it in her own kitchen and substituted on the fly. Layla ate the substituted lunch; no reaction.

**Climax.** Sam escalates to engineering by 9:19am. The guardrail worked. The presentation layer raced. Engineering identifies a cache-invalidation bug between the plan-generation service and the home-screen read model. The fix is backported within 24 hours. The parent is contacted personally by Sam with the full transparency log — *"Here is exactly what our system did, what failed, and what we are doing about it. We are so sorry."* The parent thanks Sam for the transparency. No customer is lost.

**Resolution.** The incident becomes the reason the Growth-phase "allergy-safety confirmation architecture" gets promoted to P0. Going forward, when any allergy-relevant ingredient appears in a generated plan for a household with a declared allergy, the home screen must explicitly render a *"This plan passed allergy check for Layla against sesame"* confirmation badge — so that the parent knows, with an audit trail, that the system *affirmatively cleared* the plan, not just that nothing was blocking it. The presentation layer is now contractually bound to honor the guardrail's rejection, not race it. Zero children were harmed. The incident sharpens the entire safety posture of the product before the product has paid customers.

**Capabilities revealed.** Allergy-safety guardrail layer independent of LLM judgment. Allergy anomaly dashboard for ops. Audit log with three-stage plan-generation history. Incident-response SLA and escalation path. Presentation-layer contract with safety layer (no race, no stale reads). Transparency log exportable to parent on request. Confirmation architecture (P0 for Growth — every allergy-relevant plan gets an affirmative cleared-by badge). Operational-readiness criterion tied to COPPA/AADC audit posture.

### Journey Requirements Summary

The five journeys surface a capability map that organizes MVP and Growth scope into six groups:

**1. Onboarding & Profile (Journey 1 primary, Journeys 2 + 4 supporting).** Voice-interview onboarding free to all tiers. Three-signal-question paragraph-dump pattern. Composable cultural-identity model. Starter-template composition (multi-template stacking). Visible Memory panel from day 1.

**2. Weekly Plan Lifecycle (Journeys 1, 2, 5).** Proactive plan generation Friday–Sunday. Home-screen visibility with no-tap-to-reveal. Plan-as-scaffold with day-level fluidity. Cultural-calendar integration. School-policy diff-watch. Leftover-aware swap proposals. Sick-day pause with plan-preservation.

**3. Household Coordination (Journey 2).** Shared family thread with multi-parent access. Packer-of-the-day ownership UX. Partner handoff without re-planning tax. State held by Lumi across members.

**4. Sacred Channel — Heart Note (Journeys 1, 3, 4).** Parent authoring (text + free voice capture). Guest authorship (grandparent) with rate-limited sacredness cap. Child recipient UX with emoji rating. Heart Note voice playback (Premium). Principle 2a unmodified-delivery enforcement regardless of author.

**5. Child-Side Surfaces (Journey 3).** No-install Lunch Link. Emoji rating. Passively-accreting flavor-passport artifact. Earned-through-eating Principle 5 enforcement. COPPA/AADC Boundary 1 compliance (no child account, no settings access).

**6. Safety & Operations (Journey 5).** Allergy-safety guardrail layer independent of LLM. Anomaly dashboard. Audit log with stage-by-stage plan-generation history. Presentation-layer contract with safety layer. Transparency log exportable. Confirmation architecture (Growth P0). Incident-response SLA.

**Capability priorities by phase:**
- **MVP (closed beta, Apr 2026):** groups 1, 2, 3, 4, 5, 6 (all six, at MVP depth).
- **Growth (public launch, Oct 2026):** deepening of groups 3 (partner invite UX), 4 (guest authorship + Heart Note voice playback), 6 (confirmation architecture promotion to P0).
- **Vision:** group 5 expands with Lumi's Voice to the Child milestones; cross-group additions like mobile native and Horizon 2 marketplace layer.

## Domain-Specific Requirements

### Compliance & Regulatory

**COPPA — 16 CFR Part 312.**
Parent-as-account-holder is the foundational compliance posture. Requirements:

- **Verifiable Parental Consent (VPC)** via a two-phase architecture:
  - *Beta phase (April–September 2026):* layered soft-VPC — every invited household is human-vetted by the HiveKitchen ops team during the invitation process (video call, scheduled voice call, or structured intake), establishing in-person-equivalent consent; at account creation, the parent electronically signs a plain-language consent declaration (timestamped + audit-logged) as a durable audit artifact. Beta data handling is **strictly internal-use only** — no third-party data sharing, no behavioral advertising, no cross-product mixing, no data resale.
  - *Public launch onward (October 1, 2026):* credit-card charge-and-refund ($0.01 immediate-refund) at subscription signup, including gift subscriptions (via gifting payer's card) and beta-to-paid transitions (VPC fires at first billing event automatically). Zero added UX friction because payment collection is already happening.
- **Parental notice** describing what is collected about the child, by whom (HiveKitchen + processors: ElevenLabs, SendGrid/Twilio, Supabase, LLM provider), for what purpose, and retention horizon. Delivered at signup, linkable from every child-facing surface.
- **Parental review dashboard** — the Visible Memory panel — renders as both compliance surface and trust surface simultaneously. Parent can view, edit, and delete every data point Lumi has learned about or associated with the child.
- **Data minimization** — no collection without named purpose. Child flavor-profile derives only from plan outcomes and emoji ratings; no standalone child-volunteered data capture.
- **No behavioral advertising or third-party ad/analytics SDKs** on Lunch Link pages or any child-accessible surface. Internal product analytics is first-party only; child devices are never fingerprinted.
- **Deletion on request** — full erasure within 30 days of parent request, including processor-side (ElevenLabs voice artifacts, Twilio delivery logs) via DPA-enforced downstream deletion.

**California AADC (AB 2273) — Age-Appropriate Design Code.**

- **Data Protection Impact Assessment (DPIA)** completed and maintained before public launch.
- **Most-protective privacy settings by default** on all child-touching surfaces. Lunch Link pages carry no tracking, no behavioral analytics, no third-party domains loaded.
- **Geolocation off by default** for all accounts; opt-in only for cultural-supplier-directory routing, and only at household (not child) level.
- **Plain-language notices** accessible to children where applicable.
- **No dark patterns** in any consent, upgrade, or data-sharing flow.

**State-level minor privacy patchwork.**
Connecticut, Utah, Texas, Florida, Virginia state laws layer on top of COPPA/AADC. Baseline: if the product meets AADC and COPPA, state compliance is a delta, not a rebuild. Quarterly monitoring of state legislative developments; internal compliance changelog maintained.

**Food-safety / allergen regulatory context.**
HiveKitchen is an advisory product assisting parent decisions, not a food producer. Terms of Service and marketing language consistently position it as such. The allergen data model tracks the top 9 FDA FALCPA allergens (milk, eggs, fish, shellfish, tree nuts, peanuts, wheat, soy, sesame per the FASTER Act) plus parent-declared additional allergens (kiwi, corn, nightshade sensitivity, etc.) with consistent taxonomy.

**International readiness.**
USA-only in MVP. GDPR and UK Children's Code readiness deferred but inform architecture: data-minimization, right-to-delete, and DPA discipline built in now to avoid retrofits later.

### Technical Constraints

**Security.**

- Encryption at rest (AES-256, Supabase baseline) and in transit (TLS 1.3 only; HSTS enforced).
- Secret management via environment variables. No secrets in code, no secrets in git. Rotation schedule owned by the designated Compliance Officer role (assigned at public launch).
- RBAC with four role types: **Primary Parent** (full access); **Secondary Caregiver** (same-household access minus billing + account deletion); **Guest Author** (rate-limited Heart Note authoring, no profile access); **Ops** (read-only household-anonymized audit views).
- Session management: short-lived access tokens + rotating refresh tokens. Primary Parent can invalidate all sessions.
- Audit logs covering allergy decisions, plan generations, Heart Note authorship and delivery, Visible Memory edits, billing changes, and account deletions. Retention meets COPPA minimums.

**Privacy architecture.**

- Visible Memory panel as doctrine surface — the principle of visible, editable, forgettable memory supersedes the moat.
- **Child flavor-profile retention:** retained indefinitely while the account is active (aligned with the longitudinal family-intelligence thesis); deleted 30 days after account closure per COPPA; parent can selectively forget specific entries via the Visible Memory panel at any time. **Parent-initiated "reset flavor journey"** option (once per year maximum) purges all child artifacts and restarts the profile without closing the account — intended for families whose circumstances change (divorce, cultural-identity shift, child age-progression).
- Voice transcripts retained only for 90 days for product-quality purposes unless the parent explicitly opts into longer retention.
- Anonymization for aggregate learning: cultural-template refinement and model improvement use household-anonymized data only, with no ability to reconstruct individuals.
- Child device non-identification: Lunch Link pages issue one-time signed URLs. No persistent cookies, no device fingerprinting, no IP logging beyond a 24-hour rolling window for abuse detection.

**Child voice data — scope discipline.**

- **MVP:** Heart Note voice capture is parent-side only (parent records, child listens or reads). Any child "something to say back" channel in MVP is **text-only**. No child voice capture in MVP.
- **Growth / Vision:** a voice-enabled child reply channel may be considered, gated by an explicit compliance review (child voice is biometric-adjacent; ElevenLabs DPA must cover it explicitly; retention tightened; additional parental consent layer required).

**Cultural-template review posture.**

- **Beta (six templates: Halal, Kosher, Hindu vegetarian, South Asian, East African, Caribbean):** each template reviewed internally + by at least one community advisor before beta launch. Templates with only internal review are flagged as `v0` in the ops dashboard.
- **Public launch gate:** the three highest-beta-demand templates (projected: Halal, South Asian, Hindu vegetarian) must pass native-cook review (≥2 native cooks per template) before October 1, 2026. Remaining templates follow in the subsequent quarter.

**Content-sharing payload boundary** (design principle for any future recipe-sharing surface).

If the product introduces a recipe-sharing feature (trusted-circle per brainstorm idea #21, and/or any future community surfaces), the shared payload **must contain zero child-identifying data** — no child name, no child-level rating, no child-linked allergen or dietary identity. A payload scrubber strips these fields before the recipe leaves the origin household. This preserves internal-use-only posture regardless of sharing scope. Public / anonymous recipe sharing remains **out of scope for MVP** per the brief's §10 (social-platform prohibition) and is deferred as a Growth-phase product decision.

**Performance SLOs.** Plan generation p95 <90s. Evening Check-in text first-token <500ms; voice first-token <800ms; turn-to-turn <600ms. Lunch Link delivery ≥99.5% by 7:30am local on school days. (Carried from Success Criteria for compliance-audit mapping.)

**Cost SLOs.** Standard-tier voice <$1.00/mo/HH. Premium-tier voice <$4.00/mo/HH at p95. LLM cost per plan generation <$0.25.

**Availability.** API 99.9% during school hours (6am–9pm local). Voice pipeline 99.5% with graceful text fallback. Data durability 99.999% on family profile; 99.9% on child-side cached artifacts.

### Integration Requirements

| Dependency | Purpose | Compliance / contract notes |
|---|---|---|
| **ElevenLabs** | STT/TTS, conversational voice | DPA executed. Child voice handling clause explicit (MVP: parent voice only; Growth review before child voice). 90-day retention cap. US-region processing. |
| **SendGrid** (or equivalent) | Lunch Link + Heart Note email delivery | DPA. Child-surface delivery excludes behavioral analytics. Delivery logs 90-day retention. |
| **Twilio** | SMS + WhatsApp delivery of Lunch Link | DPA. Message-content not stored beyond delivery window. |
| **Supabase** | Postgres, Auth, Storage | DPA. US-region primary. Encryption at rest. Audit-log retention configured. |
| **Stripe** | Billing, Standard + Premium tier, gift subscriptions, school-year auto-pause | PCI-DSS Level 1 inherited from Stripe. HiveKitchen stays SAQ-A. Credit-card VPC mechanism at subscription signup. |
| **OpenAI / Anthropic LLM** | Plan generation, Evening Check-in | Zero data retention enforced via API settings. No training on household data. Allergen decisions never routed through LLM alone. |
| **Internal analytics** | Product telemetry | First-party only. No third-party ad or analytics SDKs on any surface. PII excluded before storage. |

### Risks and Mitigations

**1. Allergy-safety false-negative.**
*Risk:* LLM generates a plan containing a declared allergen; parent acts on it; child reacts.
*Mitigation:* Rule-based guardrail layer independent of LLM runs as post-filter on every plan. Presentation layer contractually bound to never display a pre-guardrail plan (per Journey 5 incident). Explicit parent-confirmation architecture for allergy-relevant plan changes (Growth P0). Incident-response SLA: dashboard alert within 5 minutes of anomaly; on-call engineer within 15 minutes; parent notified within 1 hour with full transparency log.

**2. COPPA / AADC regulatory action.**
*Risk:* FTC action ($40K+ per violation); state AG actions compound; class action.
*Mitigation:* Two-phase VPC architecture (soft-VPC for beta, credit-card at public launch). Parental review dashboard live from day 1. No ad/analytics SDKs on child surfaces. DPAs with every processor. Annual compliance audit. Designated Compliance Officer at public launch.

**3. Child-voice data exposure.**
*Risk:* Processor breach leaks child audio.
*Mitigation:* MVP does not capture child voice. Growth-phase child-voice consideration gated by explicit compliance review. Retention cap + encryption. Independent annual security audit.

**4. Cultural authenticity failure.**
*Risk:* Templates are superficial; community discovers; reputation collapse in wedge segment.
*Mitigation:* MVP templates reviewed internally + ≥1 community advisor each. Top-3 templates native-cook-reviewed (≥2 cooks per template) before public launch. Growth-phase community-contribution channel with transparent authorship trail. Quarterly quality review cadence.

**5. Lunch Link misdirection or Heart Note leak.**
*Risk:* Wrong note displayed to wrong child; screenshot leaks publicly; viral incident.
*Mitigation:* Single-use time-boxed signed URLs. Note-to-lunchbox binding (URL cryptographically encodes child + date). Audit logs on every delivery. No broad-reachable sharing surface.

**6. Beta-to-paid refund cluster.**
*Risk:* Beta users expect free-forever; chargebacks cluster at first billing event.
*Mitigation:* Transparent mid-beta (month 4) reminder of paid-start date. Month-5 explicit upgrade confirmation UX. 14-day first-charge grace-refund policy. WTP validation at mid-beta (already in Success Criteria).

**7. Voice-cost runaway on Premium.**
*Risk:* Heavy voice users push unit economics underwater.
*Mitigation:* Per-household voice-cost monitoring dashboard for ops. Soft cap with gentle messaging above 95th percentile. Hard rate-limit only on sustained abuse patterns (bot traffic detection).

**8. Cold-start disappointment.**
*Risk:* "Knows your family" promise undercut by blank week-1 profile.
*Mitigation:* Honest onboarding copy ("Give me a week — I'll learn the rhythm"). Starter-quality first plan via template composition. Week 2–3 cultural recognition as earned-not-faked moment. Already locked in vision doctrine.

**9. Recipe-sharing drift into social-platform territory.**
*Risk:* Trusted-circle recipe sharing (Growth) evolves into public / community feed, creating content moderation burden and drifting HiveKitchen toward the "social or sharing platform" excluded by §10 of the brief.
*Mitigation:* Payload-scrubbing boundary enforced programmatically (zero child PII in any shared content). Trusted-circle sharing only in Growth scope. Public / anonymous sharing deferred to Vision with explicit product-scope re-evaluation, not an engineering decision.

## Innovation & Novel Patterns

HiveKitchen is not a speculative technology bet. Its stack — LLM + voice pipeline + Postgres + React web — is conventional in 2026. Its innovations are at the **product-doctrine, interaction-design, data-model, and systems-safety layers**, where most consumer AI products concede competitive ground by default. The five innovations below are the load-bearing differentiators the PRD commits to preserving through Architecture and Epic decisions downstream.

### Detected Innovation Areas

**1. The Pantry-Plan-List Silent Loop.**
*What's new.* Tap-to-purchase at the store is the pantry update. No separate pantry-management UI exists. Pantry state is inferred from purchase behavior plus plan consumption; next week's plan then uses the inferred state. The parent never enters, checks, or corrects inventory.
*What assumption it challenges.* Every household meal-planning product in the last decade (Mealime, Plan to Eat, Paprika, AnyList, Kitchen Stories) treats pantry management as either a manual-entry feature or an omitted feature. HiveKitchen treats it as neither — the grocery action itself is the state transition, and the plan-generation step consumes the state silently. This is the "micro-elegance" the brief names as a category signature.
*Why it matters for defensibility.* Closed silent-loop patterns are expensive to replicate because they require tight coupling across three surfaces (grocery execution, pantry model, plan generation). A competitor who bolts on a pantry feature doesn't get the integration — they get the feature with a re-entry tax, which is exactly what parents are fleeing.

**2. "No Approvals, Only Proposals" — Silence-as-Trust Interaction Doctrine.**
*What's new.* Plans exist as the default state of the world. No confirm buttons, no modal acks, no accept / reject flow. Parents can adjust plans mutably until the day they cover; not-adjusting is trust, not consent. Visibility is required; confirmation is not.
*What assumption it challenges.* That AI-generated proactive content must be human-in-the-loop gated to feel safe or respectful. Calendar AI, email-drafting Copilots, and meal-planning suggestion systems default to either *silent-until-asked* (ChatGPT before memory) or *forced confirmation* (Gmail Smart Compose, Copilot calendar suggestions). HiveKitchen rejects both poles and names a middle path: **present the proposal as the world; let the parent change it if they want; do not tax them for inaction.**
*Why it matters for defensibility.* This pattern is harder to implement than it looks. It requires a reliable plan-quality floor (users must be able to trust silence), an instrumented visibility signal (so "silence is trust" doesn't become "silence is abandonment undetected"), and a failure-recovery posture that does not invert into over-approval prompts when something goes wrong. A competitor can copy the UI; they cannot easily copy the organizational discipline required to maintain this posture over feature expansion.

**3. Composable Cultural-Identity Model — Additive, Not Categorical.**
*What's new.* Cultural identity is treated as a layered, additive, weighted composition — not a lookup-table match. A single household can simultaneously be South Asian + Hindu-vegetarian + peanut-allergic + Jewish-via-spouse + kosher-leaning-for-Passover-only. All constraints are active; the plan engine composes them per meal, per day, per week.
*What assumption it challenges.* Every cultural-sensitive food product extant in 2026 — Samsung Food / Whisk, HelloFresh cuisine tiles, even ChatGPT's household profile templates — treats culture as a categorical tag selection. Blended-heritage families (approximately 25% of US urban households with children under 18, per 2020 Census derivations) collapse under the categorical model: either their heritage is flattened, or they are excluded.
*Why it matters for defensibility.* Blended-heritage families are disproportionately the segment that cares most about cultural recognition — because recognition is harder for them, not easier. Category-based competitors cannot retrofit a composable model; it is a foundational data-model decision that propagates through template design, plan generation, and the cultural-supplier-directory routing layer.

**4. Visible Memory Supersedes Moat — Trust Doctrine Over Defensibility.**
*What's new.* Parents can view, edit, and forget every data point Lumi has learned about or associated with their family. Forgetting collapses the longitudinal profile and the plan-success track record — the very things the product relies on as its compounding defensibility. The doctrine states plainly: the moat is real but voluntary; trust is the precondition, not the output.
*What assumption it challenges.* Every consumer AI product with memory in 2026 (ChatGPT, Claude Projects, Character.AI, Replika, Pi) treats memory as operator-owned, opaque, and retention-sticky. The playbook is: accumulate, don't expose, maximize lock-in. HiveKitchen publicly inverts this — exposing the graph and making it voluntarily destructible. Under AADC and CCPA pressure, competitors will grudgingly add "export / delete" buttons; HiveKitchen makes user sovereignty the headline.
*Why it matters for defensibility.* Doctrinal innovations look like bugs from a pure-defensibility lens — and they are, locally. But the market signal is the opposite: trust-forward products win disproportionately in segments with elevated scrutiny (children's data, health data, financial data). HiveKitchen's bet is that the wedge segment — culturally-specific families, allergy households, data-conscious dual-professional parents — rewards the trust stance commercially, not just ethically.

**5. Allergy-Safety Architecture — Rule-Based Guardrail Independent of LLM, with Presentation-Layer Contractual Binding.**
*What's new.* Allergy decisions are never routed through LLM judgment. A deterministic rule-based guardrail layer runs as a post-filter on every generated plan; the presentation layer is contractually bound to never display a pre-guardrail plan (the constraint surfaced concretely in Journey 5's race-condition incident). Where the product's general posture is "silence is trust," the allergy surface explicitly carves out: allergies require explicit, auditable parent confirmation architecture.
*What assumption it challenges.* The prevailing 2026 industry pattern for consumer-AI safety is "prompt it better, then post-hoc filter with a second LLM call." This works until it doesn't, and when it doesn't, the failure is expensive. HiveKitchen's stance: safety-critical decisions that can cause physical harm to children do not share infrastructure with generative decisions. A separate, smaller, deterministic layer with an audit trail is the floor.
*Why it matters for defensibility.* Independent guardrail architecture is a systems-engineering investment that cheaper competitors skip. It is invisible to the parent until the one moment it matters — at which point the difference between "safe" and "tragic" is architectural, not prompt-level. This is what insurers, regulators, and cultural-community gatekeepers look for when deciding whether to trust a product handling their children's food.

### Market Context & Competitive Landscape

| Innovation | Horizontal AI (ChatGPT Memory + Projects, Claude Projects) | Vertical meal-planning (Mealime, Plan to Eat, Paprika) | Cultural-aware food (Samsung Food / Whisk, HelloFresh) | HiveKitchen differentiator |
|---|---|---|---|---|
| **Pantry-Plan-List silent loop** | Not modeled | Manual entry or omitted | Manual entry or omitted | Silent closed cycle; pantry is a derived state |
| **No approvals, only proposals** | Silent-until-asked default | Explicit plan-generation UI, user-selects-each-meal flow | Recipe-selection flow | Plans as default state of the world; silence is trust |
| **Composable cultural identity** | Template-plus-prompt configuration | Cuisine tags (thin) | Cuisine category selector | Layered additive model that composes per meal |
| **Visible memory supersedes moat** | Opaque memory, sticky retention | No memory model | Minimal profiling | User-sovereign, selectively forgettable, doctrine-headline |
| **Independent allergy guardrail** | Prompt + filter | Static allergen tags | Static allergen tags | Deterministic layer + presentation-contract binding + confirmation architecture |

The dominant pattern among competitors is **feature parity at execution depth, not architectural depth.** HiveKitchen's thesis is that architectural depth is the vertical-workflow focus bet — while ChatGPT ships a "Household" template in any given quarter, the five innovations above are not replicated by a template. They are replicated only by deliberate, multi-surface, multi-quarter architectural investment. This is the source of the 12–24 month threat window named in the Executive Summary.

### Validation Approach

Each innovation has a named validation signal mapped to the Success Criteria section. Innovation is only real when it measurably changes user outcome.

- **Pantry-Plan-List silent loop** validates through the *absence* of pantry-management-UI complaint in qualitative beta interviews, combined with ≥3 mentions per household of "I didn't have to think about groceries" by week 8. Pantry-inference accuracy is tracked internally: ≥85% of specialty-ingredient decrement events should match actual household consumption, measured through weekly plan-vs-actual reconciliation.
- **No approvals, only proposals** validates through the week-1 plan rejection/edit rate (<50% target, carried from Success Criteria) combined with the visibility-signal implementation (PRD backlog flag carried from Socratic elicitation — defines the system-observable event that constitutes "parent saw the plan"). If rejection rates cluster above 50% AND visibility signals are healthy, the innovation is not landing — plans are seen and rejected, not seen and trusted.
- **Composable cultural identity** validates through blended-family beta-cohort retention. At least 10 beta households must be identified as multi-cultural or blended-heritage. Their week-4 retention must be within 5 points of the single-culture cohort. A larger gap indicates the composable model is failing its hardest test.
- **Visible memory supersedes moat** validates through three signals: (a) opt-in rate for the Visible Memory panel review (target: ≥30% of activated households visit the panel in the first 30 days); (b) edit/forget actions per active household (non-zero is healthy — zero indicates the panel is performative); (c) retention of households that exercise "forget" actions (must be ≥80% of households that don't — if forgetting causes churn, the doctrine is broken).
- **Independent allergy guardrail** validates through the non-negotiable absolute signal in Success Criteria: zero false-negatives across all plans generated. Secondary: guardrail-catch rate (how often the guardrail intercepts LLM outputs that would have been unsafe) — a healthy guardrail demonstrates its value by catching ≥1 anomaly per 10,000 plans without any reaching parent-visible state.

### Risk Mitigation

Each innovation carries a distinct failure mode and a named fallback posture.

- **Pantry-Plan-List silent loop failure** (pantry-inference accuracy <70% sustained): fallback is an opt-in "pantry correction" lightweight UI for the subset of households that exceed error tolerance. This is a degraded state for a minority of users, not an architectural retreat — the silent loop remains the default for accurate households.
- **No approvals, only proposals failure** (plan-edit rate sustained >50% despite quality investments): fallback is a one-tap "approve / adjust" surface on the home screen for the subset of households that signal preference for explicit confirmation via a settings opt-in. The core doctrine remains intact for the majority.
- **Composable cultural identity failure** (blended-family retention materially below single-culture cohort): fallback is a primary-cultural-identity selector with additive modifiers. This is a partial retreat to categorical modeling, preserving the composable infrastructure for richer handling post-correction.
- **Visible memory supersedes moat failure** (forget actions strongly correlated with churn): fallback is a time-boxed forget (soft-delete with 30-day recovery window) before hard-delete, plus contextual warnings in the Visible Memory panel ("forgetting this may affect next week's plan"). The doctrine holds; the UX gains a recovery safety net.
- **Independent allergy guardrail failure** (a false-negative occurs): this is the one innovation where "failure" is not tolerated as a degraded state. The posture is zero-tolerance, incident-response SLA (alert within 5 minutes, engineer within 15, parent within 1 hour with full transparency log), architectural review within 24 hours, and backported fix. The innovation is the architecture — the fallback is a sharper version of the architecture, not a retreat from it.

## Web Application Specific Requirements

### Project-Type Overview

HiveKitchen is a React + Vite single-page application (SPA) delivered exclusively via web browser, with no native mobile client and no progressive-web-app push features in this release. The frontend communicates with the Fastify backend via REST for state-changing operations, **Server-Sent Events (SSE)** for real-time push from the backend to the client, and **ElevenLabs WebSocket** for the voice pipeline only. The product spans both desktop and mobile-web form factors; mobile-web is a first-class delivery surface (grocery mode, Heart Note authoring at 10pm on a phone, Lunch Link viewing on a child's parent-shared device), not an afterthought.

### Technical Architecture Considerations

**Monorepo layout — two-app split.**

- `apps/web` — **authenticated SPA** (React + Vite). Home screen, plan, Evening Check-in, Visible Memory, grocery mode, Heart Note author, household thread, Lunch Link viewer, billing portal. Gift-subscription checkout is also hosted here as a pre-auth SPA island (transactional, dynamic price display, cart state).
- `apps/marketing` — **pre-authenticated static surface** (Astro or vite-ssg). Landing, pain-point pre-login demo, pricing, gift-subscription lead page, cultural-community partner pages, FAQ, legal surfaces.
- Shared `packages/ui` for common components (button, typography, color tokens) consumed by both apps.

Two build outputs, two CDN origins, one shared component library. Cleaner separation, simpler Vite configs, independent deploy cadence for marketing changes (which happen more frequently than product changes).

**Real-time transport strategy.**

- **SSE (Server-Sent Events)** for all unidirectional backend-to-client push — plan updates, Heart Note status, Lunch Link delivery confirmations, household thread messages, Evening Check-in text responses. SSE chosen over WebSocket because (a) traffic is overwhelmingly one-way, (b) SSE auto-reconnect with `Last-Event-ID` is well-supported, (c) SSE plays better with HTTP caching, proxies, and CDN infrastructure.
- **WebSocket** reserved for **ElevenLabs voice pipeline only** — bidirectional, low-latency audio streaming required for conversational speech.
- No other WebSocket use in H1; the two-transport discipline keeps the system model simple.

### Browser Support Matrix

| Browser | Minimum version | Coverage rationale |
|---|---|---|
| **Safari (iOS + macOS)** | Last 2 major versions | Load-bearing for mobile-web use cases; iOS Safari is the primary Heart Note voice-capture surface and the primary Lunch Link viewer. |
| **Chrome / Chromium (desktop + Android)** | Last 2 major versions | Majority desktop + Android share. |
| **Edge (Chromium)** | Last 2 major versions | Windows default. |
| **Firefox (desktop)** | Last 2 major versions | Minority but load-bearing for privacy-conscious segment. |
| **Legacy / Internet Explorer** | **Not supported** | Explicit exclusion. |

**iOS Safari-specific constraints:**

- **Microphone permission UX** — must never request microphone permission on a user's first tap of a voice surface. An informed-consent screen describing why Lumi needs mic access, what she captures, and how long she retains it is mandatory before the system-level permission prompt is triggered. Denial state must feel equal to granted state — text flow is presented as a parallel modality, not a fallback. The user must not feel penalized for declining.
- **Audio-playback autoplay restrictions** — voice responses must be triggered by user gesture on iOS Safari (Premium voice Evening Check-in tap-to-talk already aligns with this).
- **WebSocket background-tab pause behaviour** — voice sessions must gracefully resume or bail out on tab backgrounding.

### Responsive Design

**Breakpoint strategy.**
Mobile-first breakpoints:

- **≤640px (mobile phone):** one-hand grocery mode, Heart Note capture in bed, Lunch Link viewing on parent-shared device, home-screen at a glance.
- **641–1023px (tablet / large phone landscape):** weekly Brief view, Evening Check-in.
- **≥1024px (desktop):** full home screen with parallel daily + weekly views, Visible Memory panel with larger data tables.

**Mobile-web-specific considerations.**

- Grocery mode: large text, high-contrast, tap-target ≥48×48 CSS pixels, store-layout-aware sort, sticky header with running check-off count, haptics on check-off where supported. The store environment is adversarial (bad cellular signal in freezer aisles, one-handed use, cart in motion).
- Heart Note authoring: voice-first capture on mobile; text input has large default font, autocorrect enabled, keyboard-covers-the-input handled via viewport-height-aware layout.
- Lunch Link: viewed on the child's parent-shared device (old iPad, parent phone in bag). Touch-first, single-purpose page, no navigation chrome, four emoji buttons at ≥80×80 CSS pixels.

### Connectivity-Loss UX

Offline-read caching is explicitly **out of scope** for MVP (product decision; assumes reliable cellular). The UX must fail honestly when cellular drops: if the client cannot reach the API for >3 seconds in grocery mode or plan view, an unobtrusive banner surfaces — *"You're offline. I'll catch up when you're back."* — with any in-flight check-offs visibly marked as pending. No silent broken state; no cheerful animation hiding a dead connection.

### Performance Targets

Per-surface Core Web Vitals targets for the public launch:

| Surface | LCP (p75) | INP (p75) | CLS | TTI |
|---|---|---|---|---|
| Public landing / pre-login demo | <1.5s | <150ms | <0.05 | <2.0s |
| Authenticated home (logged-in entry) | <2.0s | <200ms | <0.1 | <3.0s |
| Lunch Link (child-facing) | <1.0s target / <1.2s SLO | <100ms | <0.02 | <1.5s |
| Grocery mode | <1.5s | <150ms | <0.05 | <2.0s |
| Evening Check-in (text) | <2.0s | <150ms | <0.05 | <3.0s |

Infrastructure requirements to hit these:

- CDN in front of all static and cacheable API responses (Cloudflare or equivalent).
- Regional edge caching for the landing and pre-login demo.
- Code-splitting at route boundary; voice-pipeline JS is lazy-loaded (not in the critical path for text-tier users).
- Image delivery via adaptive format (AVIF/WebP with JPEG fallback) and aggressive lazy-loading outside the above-fold region.
- No third-party scripts on authenticated surfaces (already mandated by the COPPA/AADC posture); this bounds render-blocking.

### SEO Strategy

**Public, indexable surfaces.**

- Landing page, pain-point pre-login demo, cultural-community partner pages, pricing, gift-subscription purchase flow, public editorial (blog / cultural storytelling if introduced in Growth).
- These receive full SEO treatment: canonical URLs, descriptive meta titles and descriptions, OpenGraph and Twitter meta, JSON-LD structured data (`Product` for pricing; `FAQPage` for the pre-login demo), `sitemap.xml`, `robots.txt` allowing these paths.

**Explicitly non-indexed surfaces.**

- All authenticated product surfaces (home, plan, Visible Memory, Evening Check-in, grocery mode, Heart Note author) — `noindex, nofollow` meta, `Disallow` in robots.txt for authenticated path prefixes.
- **Lunch Link pages (child-facing) — explicitly non-indexable, non-crawlable.** The URL is one-time and signed; defense-in-depth adds `noindex, nofollow, noarchive, nosnippet` and `X-Robots-Tag: none` HTTP header, plus `Disallow: /lunch/*` in robots.txt. A Lunch Link must never surface in search results under any circumstance.

**Structured data.**

- `WebApplication` + `Organization` at the root for brand signaling.
- `Offer` for pricing tiers on the pricing page.
- No structured data on authenticated or child-facing surfaces.

**Acquisition-funnel implication.**
Per the positioning locked in the Executive Summary, HiveKitchen does not compete for top-of-funnel "what's for lunch" SEO against BuzzFeed and Tasty. SEO exists to capture intent-driven searches (e.g., "halal school lunch planning," "AI meal planner for kids with allergies"), gift-flow searches (grandparent intent), and branded queries. Content strategy focuses on depth, not volume.

### Accessibility Level

**Target: WCAG 2.1 Level AA across all surfaces.** The product cannot be accessible-by-afterthought; three segments make this load-bearing rather than compliance-posture.

**Load-bearing accessibility surfaces:**

- **Lunch Link (child-facing).** Screen-reader compatible (children with visual impairment use school-issued iPads with VoiceOver or similar assistive tech). Four emoji ratings must have accessible labels, not emoji-only interaction. Heart Note text rendered in plain-language markup; image alt text describes the lunch.
- **Grocery mode.** In-store use often involves bad lighting, cart motion, one-handed operation — which overlaps strongly with accessibility needs. High-contrast mode, tap-target size, haptic feedback (where supported), voice readout of the shopping list (Premium).
- **Heart Note authoring.** Screen-reader-accessible text input; voice capture with a clearly-labeled fallback to text; no time-sensitive completion requirements.
- **Evening Check-in (text and voice).** Conversational UI must be navigable by keyboard alone; voice is an augmentation, not a requirement.

**Specific requirements.**

- All interactive elements have accessible names and roles.
- Color contrast ratio ≥4.5:1 for normal text, ≥3:1 for large text.
- Focus indicators visible on all focusable elements; keyboard navigation complete across all surfaces.
- No flashing content above WCAG thresholds.
- Plain-language reading level (≤grade 8) on all parent-facing notification copy; ≤grade 4 on child-facing Lunch Link surface. **Enforced via a readability CI check** — build fails when Lunch Link copy exceeds grade 4 or parent-facing copy exceeds grade 8. Prevents the common pattern of plain-language requirements silently degrading to "clear adult copy."
- Multilingual content rendering: Heart Notes may contain Hindi (Devanagari), Hebrew, Arabic (RTL), Tamil, etc. — the Heart Note text renderer supports correct script display, direction, and diacritics regardless of UI locale. UI itself remains English in H1; cultural-term rendering is content-layer, not UI-layer localization.
- **TTS caption fallback** — voice output from Lumi (Evening Check-in voice responses, Heart Note voice playback) has an always-available caption fallback. Captions visible concurrently with voice; accessible via screen reader; not opt-in-only.

### Implementation Considerations

**Authentication and session.**

- Supabase Auth for parent account creation; email/password + Google/Apple OAuth for Primary Parents.
- Short-lived access tokens (15 min) + rotating refresh tokens (30 day).
- Session data carried via `httpOnly, Secure, SameSite=Lax` cookies (upgraded to `SameSite=Strict` where architecturally feasible; see CSRF posture below).
- Secondary Caregiver invite flow does not require separate account creation — an invite link issues a session token scoped to the household's secondary role (per RBAC model). All scoped-session claims (household_id + role + invite_id) are resolved at a single Fastify `preHandler`, never per-route.
- Guest Heart Note author (grandparent) has session scoped to author-only, rate-limited by count, resolved by the same preHandler.

**CSRF posture.** API and web on same-site origins with `SameSite=Strict` cookies where architecturally feasible; fallback to double-submit-cookie token pattern for any flows that require cross-origin handling. Configured at day 1, not retrofitted after a pentest.

**State management and data flow.**

- Zustand for client state (per monorepo convention).
- Server-authoritative for safety-classified fields; optimistic-with-rollback for non-safety state. Authoritative enumeration lives in the **Safety-Classified Field Model** subsection below.
- SSE event subscription per household; client reconciles on reconnect using `Last-Event-ID`.

**Frontend-backend contract.**

- All API request and response shapes defined in shared Zod schemas in `packages/contracts`; TypeScript types inferred via `z.infer<>` and re-exported from `packages/types`.
- API versioning via URL path (`/api/v1/`) — forward-compatible deprecation with parallel-serve overlap of ≥90 days before removing a versioned endpoint.

**Rejected / skipped technical concerns** (per web_app CSV skip_sections):

- **Native features** (device permissions beyond browser-exposed ones, filesystem access, background process): not in scope; HiveKitchen is web-only.
- **CLI commands**: not applicable; no command-line interface exists or is planned.

### Observability Contract

The product cannot be operated safely without a named observability posture. Five layers:

**1. Infrastructure health — MVP-grade for beta, Growth-grade at public launch.**
Beta (April–September 2026): basic structured logging (Pino), HTTP 5xx alert thresholds, SSE-disconnect counters, ElevenLabs WS error-rate alerts, on-call rotation via PagerDuty or equivalent. Public launch (October 1, 2026): proper SLO dashboards with error-budget accounting, SLO-alert routing, multi-severity on-call. Don't over-invest in SRE tooling before paying customers exist.

**2. Product telemetry — day-1 instrumentation.**
From beta day 1: plan-generation p50/p95 latency; voice cost per household per day; LLM cost per plan; allergy-guardrail catch rate; Lunch Link delivery time-to-7:30am success rate; Visible Memory panel visit rate; first-plan satisfaction survey completion. Each signal maps directly to a Success Criteria threshold. Without this instrumentation, the 60-day beta validation is un-measurable.

**3. SSE operational requirements.**
SSE through Cloudflare (or any CDN) requires explicit operational configuration to prevent buffering-induced disconnects. All SSE endpoints set `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`. Heartbeat emitted every ≤30 seconds to keep the connection alive through intermediaries that buffer `text/event-stream` at idle. Server-side event-log retention must exceed the maximum expected disconnect window (documented bound: ≥6 hours for `Last-Event-ID` replay).

**4. Reconnect-storm policy — baked in from MVP.**
Client-side reconnection uses exponential backoff with jitter: initial backoff 1s, multiplier 2×, ±20% jitter, max 60s between attempts. Applies to SSE and ElevenLabs WS. Cheap to do right at day 1; expensive to retrofit after a beta cohort has already triggered a thundering-herd event.

**5. Degraded-mode UX — honest and rare.**
User-visible failure states and their copy direction:

- Voice down: *"Voice is having a moment. Text still works normally — I'm here."* Voice-dependent flows fall back to text without blocking.
- SSE disconnected: unobtrusive "reconnecting..." indicator; auto-recover without parent action if reconnect succeeds in <30s; visible banner only if >30s.
- Plan-generation delayed: *"I'm taking a little longer than usual — will update in a few minutes."* Never a spinner-forever.
- Allergy guardrail fail-closed: *"I couldn't finish this week's plan safely. I've paused and notified our team. No action needed from you."* Ops alerted; parent reassured; no unsafe plan shown.
- Connectivity loss (per Connectivity-Loss UX subsection): *"You're offline. I'll catch up when you're back."*

**6. Content Security posture — day 1.**
Strict CSP with named script-src allowlist (no inline scripts, no eval). Voice pipeline has a strict origin allowlist (ElevenLabs only). COOP/COEP (cross-origin isolation) enabled on authenticated surfaces to enable SharedArrayBuffer and WebCodecs for future audio-processing features. Configured at day 1, not retrofitted after a pentest.

### Safety-Classified Field Model

Optimistic client-side updates are permitted on non-safety state to preserve responsive UX; prohibited on safety-classified state. Explicit enumeration authoritative for Architecture and all downstream Epic work:

**Server-authoritative** (rendered pending or disabled until acknowledged):

- Allergy declarations and edits (life-safety)
- Plan confirmation events involving any allergy-relevant ingredient
- Heart Note authorship "send" event (sacred channel — no rollback UX)
- Heart Note delivery state
- Billing actions — subscribe, cancel, upgrade, downgrade, gift purchase
- Account deletion and data-export requests
- Guest author invites (grandparent access + rate-limit counters)
- Partner / Secondary Caregiver invites
- Visible Memory "forget" actions
- Cultural template selection or composition changes
- School policy declarations
- Visible Memory entry edits (edit-non-delete; affects plan generation, needs reconcile before next plan run)

**Optimistic with rollback** (client renders instantly; server reconciles within target latency):

- Recipe preferences / "we liked this" / "we didn't"
- Child emoji tap rating (registers instantly; server wins on conflict)
- Casual-mention enrichment during Evening Check-in
- UI preferences (display density, theme, sort order)
- Read / unread markers on Evening Check-in and household-thread messages
- Plan view-mode preferences (weekly vs. daily)
- Heart Note draft state (local-only until "send" is pressed)
- Non-allergen plan swaps (parent drags Tuesday's sandwich to Wednesday for a non-allergic child)
- Grocery-list check-offs in "I'm at the store" mode (rare-case fail renders "that didn't save, try again"; eventual consistency within ~5s)
- Evening Check-in user-message send (message renders in thread immediately with pending indicator; sent/delivered marker reconciles within 500ms)

Any field introduced in later PRD sections must be classified explicitly; no implicit "probably optimistic" fallback.

## Functional Requirements

Every feature built downstream must trace back to one of these 106 functional requirements. If a capability is missing from this list, it does not exist in the product.

### Family Profile & Onboarding

- **FR1:** Primary Parent can create a household account through supported authentication methods.
- **FR2:** Primary Parent can complete profile setup via a voice-based onboarding interview as the default onboarding path.
- **FR3:** Primary Parent can complete profile setup via a text-based conversational onboarding with equivalent outcome to the voice interview.
- **FR4:** Primary Parent who declines voice onboarding receives identical product capabilities and tier access as those who use it.
- **FR5:** Primary Parent can add one or more children to the household with name, age-band, declared allergies, school food-policy constraints, and palate preferences.
- **FR6:** Primary Parent can select one or more cultural templates (Halal, Kosher, Hindu vegetarian, South Asian, East African, Caribbean) in any combination, including multi-template composition for blended-heritage households.
- **FR7:** System infers starter cultural template composition from the onboarding conversation and presents the result for parental confirmation before committing.
- **FR8:** Primary Parent can execute a digital signed consent declaration during beta onboarding as the verifiable-parental-consent mechanism.
- **FR9:** Primary Parent can execute credit-card verifiable-parental-consent at subscription signup.
- **FR10:** Primary Parent can invite a Secondary Caregiver to the household with scoped access, without requiring the invitee to create a separate account.
- **FR11:** Primary Parent can manage their own account profile (email, password, auth method, display name) separately from the household and child profiles.
- **FR12:** Primary Parent can recover account access through a password-reset or auth-provider-recovery flow.
- **FR13:** Primary Parent can redeem a gifted subscription by activating a pre-paid subscription tier or accepting access to a gift-configured household.
- **FR14:** System delivers a comprehensive parental-notice disclosure at signup, prior to any child data collection, describing what data is collected, by whom (including named processors), for what purpose, and with what retention horizon.

### Lunch Bag Composition

The daily plan delivers a **Lunch Bag** consisting of up to three slots:

- **Main** — the primary meal component. Always required for every child.
- **Snack** — a secondary component intended for recess, morning tea, or mid-day consumption. Optional per child.
- **Extra** — an open-type third component (fruit, drink, treat, cultural side, or a parent-custom-added item). Optional per child.

Composition is **parent-owned, per child**. Lumi fills declared slots with plan content but does not add or remove slots autonomously. The bag has a hard ceiling of three slots; no composition expansion beyond Main + Snack + Extra is supported. Snack is **culturally neutral** — cultural templates apply only to Main and Extra content. Snack items are modeled as item-level SKUs (fruit, bars, yogurt cups, etc.) predominantly of low-or-zero prep character, distinct from Main content which is recipe-modeled. School-policy rules may be scoped per-slot; **allergy-safety rules apply bag-wide without exception.**

- **FR107:** Primary Parent can declare, per child, whether the Snack slot and Extra slot are active during household onboarding; Main is always active.
- **FR108:** Primary Parent can modify any child's Lunch Bag composition (Snack on/off, Extra on/off) at any time post-onboarding; changes take effect on the next plan-generation cycle.
- **FR109:** System generates content for every active slot in a child's Lunch Bag on every scheduled school day, subject to allergy, policy, and cultural constraints.
- **FR110:** System renders Snack items as a distinct section of the derived shopping list (FR48), visually and ordinally separate from Main-recipe ingredients; store-mode aisle-path sort (FR49) groups Snack items together.
- **FR111:** System models Snack content as item-level SKUs with unit-based pantry depletion, separately from Main content which is modeled as recipes with ingredient decomposition. The Extra slot supports either item-level or recipe-level content.
- **FR112:** System supports school-policy rules with per-slot scoping (bag-wide, Main-only, Snack-only, Extra-only); a policy change targeting a specific slot triggers regeneration only of items in that slot for affected future plans.
- **FR113:** Allergy-safety rules apply bag-wide and do not support per-slot scoping; the allergy guardrail (FR76) treats an allergen in any slot identically regardless of which slot it appears in.
- **FR114:** Primary Parent can pin a component type (e.g., "always include a fruit") to the Extra slot for a specific child; Lumi respects the pin in all subsequent plans for that child.
- **FR115:** Primary Parent can ban specific component types (e.g., "no sweet treat ever") from the Extra candidate pool for a specific child.
- **FR116:** System passively weights a parent's repeated removal of Extra items from a child's bag as a preference signal, silently biasing future Extra-slot content selection for that child.
- **FR117:** Primary Parent can save a parent-authored Extra item as a custom reusable entry in the household's Extra library.
- **FR118:** System supports a defined set of day-level context overrides — **Bag-suspended, Half-day, Field-trip, Sick-day, Post-dentist (soft-only), Early-release, Sport-practice, Test-day** — that temporarily modify composition and/or content for a single (child, day). Lumi proposes each override based on calendar signal or parent flag; Primary Parent confirms per Principle 1; overrides auto-revert after the day.
- **FR119:** System proposes adding an Extra item on a day with an on-calendar high-activity event (e.g., sport practice, field trip) for children whose Extra slot is normally off; Primary Parent confirms.
- **FR120:** Lunch Link (FR34) renders each component of the Lunch Bag as a distinct visual element beneath the Heart Note on the same surface. The Heart Note is visually dominant; the bag preview and rating surface appear below it. Each item card is individually previewable by the child and supports the Layer 2 swipe-right gesture specified in FR36.

### Weekly Plan Lifecycle

- **FR15:** System generates a week's worth of lunch plans (one per school day per child) in advance of the start of the school week, drawing on household profile, per-child Lunch Bag composition (see Lunch Bag Composition section), pantry state, school policy, cultural context, and child palate. Each daily plan produces content for every slot (Main — always; Snack and Extra — if active for that child) declared in that child's composition.
- **FR16:** Primary Parent or Secondary Caregiver can view the current week's plan from a default landing surface without performing any preceding interaction.
- **FR17:** Primary Parent or Secondary Caregiver can view any individual day's plan with preparation instructions.
- **FR18:** Primary Parent or Secondary Caregiver can edit any day's plan for any child at any point before that day by swapping the item in any individual slot (Main, Snack, Extra) independently, swapping the plan with another day's, or marking skip/sick.
- **FR19:** System adjusts affected future-day plans in response to school-policy changes, leftover state shifts, and cultural-calendar events without requiring the parent to re-plan.
- **FR20:** Primary Parent or Secondary Caregiver can pause the Lunch Link for a specific child on a specific day without altering the underlying plan.
- **FR21:** Primary Parent can view the following week's draft plan beginning Friday afternoon of the preceding week.
- **FR22:** Primary Parent can update declared school-policy constraints (e.g., nut-free rule, no-heating rule) and have the changes propagate through all affected future plans.
- **FR23:** Primary Parent can request regeneration of a full week or specific day plan with the same constraint set.
- **FR24:** System surfaces an explicit graceful-degradation state when it cannot generate a safe plan for a household given the constraint set.
- **FR25:** Primary Parent or Secondary Caregiver can view historical plans and their outcomes (emoji ratings, swaps made) for any prior week.
- **FR26:** System maintains cultural-calendar awareness for all active household cultural-template compositions and weights upcoming-event-adjacent meals into plan generation without requiring parent prompting.

### Household Coordination

- **FR27:** Primary Parent or Secondary Caregiver can designate which household member is responsible for packing lunch on any given day.
- **FR28:** Primary Parent and Secondary Caregiver can exchange messages within a shared household thread.
- **FR29:** System uses household-thread context to enrich household profile and inform plan adjustments where signals are present.
- **FR30:** Primary Parent can revoke Secondary Caregiver access at any time without requiring caregiver consent.
- **FR31:** Primary Parent can transfer primary ownership of the household to another Secondary Caregiver.

### Heart Note & Lunch Link

- **FR32:** Primary Parent, Secondary Caregiver, or authorized Guest Author can compose a Heart Note by text input for any child for any specific day.
- **FR33:** Primary Parent, Secondary Caregiver, or authorized Guest Author can compose a Heart Note by voice capture on any tier.
- **FR34:** System delivers the Lunch Link to the child via the parent-designated delivery channel (email, WhatsApp, SMS, or parent-copied URL) prior to the child's lunch time on each school day.
- **FR35:** Child can view the Lunch Link on any device via a session-scoped link without logging in, installing software, or creating an account.
- **FR36:** Child can rate a Lunch Link using a two-layer interaction. **Layer 1 (primary, always available):** a single whole-bag emoji tap from the 4-emoji set `{love, like, meh, no}`. **Layer 2 (optional, discoverable):** for any individual component (Main, Snack, Extra), the child can register a positive preference by swiping right on the item card; no swipe is neutral and carries no signal weight. There is no thumbs-down, swipe-left, or negative per-slot option. Layer 1 is the one-tap ritual (completable in under 5 seconds); Layer 2 is a lightweight opt-in depth for children who choose to engage further.
- **FR37:** Child can view their cumulative flavor-profile artifact from within the Lunch Link.
- **FR38:** System delivers the Heart Note content to the child exactly as authored, without AI modification, addition, softening, or suggestion.
- **FR39:** System does not reference the feedback system, Lumi's learning, or plan changes within the Heart Note surface.
- **FR40:** Primary Parent can grant a Grandparent Guest Author Heart Note authoring permission rate-limited to a capped frequency.
- **FR41:** Premium-tier Primary Parent can enable voice playback of the Heart Note for the child via the Lunch Link.
- **FR42:** Child can submit a text-based "request a lunch" suggestion that the Primary Parent reviews and approves before Lumi incorporates it into plan generation.
- **FR43:** System never surfaces notifications, streaks, or absence-reminders referencing Heart Note authoring frequency to any parent.
- **FR44:** Primary Parent can compose a Heart Note in advance with scheduled delivery for a specific day.
- **FR45:** Primary Parent can edit or cancel a Heart Note at any point before its delivery window opens.
- **FR46:** Primary Parent can view the delivery status of every Heart Note sent (delivered, viewed, rated, not-yet-opened).
- **FR47:** System does not capture child voice audio in MVP; any future voice-enabled child reply channel is gated behind an explicit compliance review and a separate parental consent layer.
- **FR121:** The Lunch Link rating window opens when the child first views the Lunch Link or at the child's scheduled lunchtime (whichever comes first) and closes at **8 PM local time on the same day**. After the window closes, no further rating submissions are accepted and the bag's rating state is frozen; no retroactive or backlog rating surface is provided.
- **FR122:** Each `(child, day)` Lunch Link corresponds to exactly one session URI. Whether the link is shared by the Primary Parent, a Secondary Caregiver, or multiple caregivers, it resolves to the same URI for that child on that day. The URI is one-time-use: once the child submits a Layer 1 rating or the 8 PM window closes (FR121), the session is consumed and subsequent rating attempts on the same link are rejected.
- **FR123:** When two or more children share a single device, each child has independent `(child, day)` Lunch Link sessions with separate URIs; rating submissions are attributed to the specific child whose session was active at submission time. No cross-child signal leakage occurs at the device level.
- **FR124:** System weights Layer 2 per-slot signals (Main, Snack, Extra) independently in the child-preference learning model; a positive signal on one slot does not imply inference about other slots.
- **FR125:** System treats the absence of a rating — whether Layer 1 skipped or any Layer 2 slot not swiped — as "no signal" for that data point, never as a negative preference or dislike.
- **FR126:** System distinguishes sibling-specific preference patterns from family-wide patterns in multi-child households; a preference learned for one child is not automatically propagated to siblings without supporting signal.
- **FR127:** System occasionally proposes variant preparations or pairings of an existing item and captures the delta in child ratings (Layer 1 and Layer 2) as an active-learning signal; variant proposals are visible to the Primary Parent before delivery per Principle 1.

### Grocery & Pantry-Plan-List Loop

- **FR48:** System derives a shopping list from the current week's plan accounting for inferred pantry state, without requiring manual pantry entry.
- **FR49:** Primary Parent or Secondary Caregiver can view the shopping list in a "store mode" optimized for one-handed in-store use with store-layout-aware sort.
- **FR50:** System routes specialty ingredients to appropriate stores via the cultural-supplier directory, producing a multi-store split list when applicable.
- **FR51:** Primary Parent or Secondary Caregiver can mark items as purchased; the act of marking updates the inferred pantry state silently.
- **FR52:** System proposes leftover-aware plan swaps when pantry state indicates surplus or soon-to-expire items.
- **FR53:** System degrades honestly during connectivity loss in store mode; in-flight check-offs are preserved as pending and the parent is informed of the connectivity issue without silent failure.
- **FR54:** Primary Parent can add non-plan-derived items to the shopping list (household staples not tied to the lunch plan).
- **FR55:** Primary Parent can correct an inferred pantry state when the inference disagrees with kitchen reality.

### Evening Check-in & Conversational Enrichment

- **FR56:** Primary Parent or Secondary Caregiver can engage in unlimited text-based conversation with Lumi at any time on any tier.
- **FR57:** Premium-tier subscriber can engage in unlimited tap-to-talk voice conversation with Lumi.
- **FR58:** Standard-tier subscriber can engage in tap-to-talk voice conversation with Lumi up to 10 minutes per week.
- **FR59:** System extracts profile-enrichment signals from conversational mentions without requiring explicit parental commands to update the profile.
- **FR60:** System surfaces Lumi's voice output with concurrent text captions for accessibility.
- **FR61:** System adjusts Lumi's conversational length and tone in response to household context signals (time of day, recent activity).
- **FR62:** System surfaces a periodic "I noticed" learning moment to the parent that makes profile enrichment legible and offers parent confirmation or correction.
- **FR63:** Primary Parent can initiate an Evening Check-in conversation with Lumi at any time; Lumi does not proactively initiate conversations.
- **FR64:** Primary Parent can ask Lumi to explain why she chose a specific meal for a specific day and receive a plan-reasoning answer.

### Visible Memory & Trust Controls

- **FR65:** Primary Parent can view every data point Lumi has learned about or associated with the household and each child.
- **FR66:** Primary Parent can edit any learned data point, with changes reconciled before the next plan-generation event.
- **FR67:** Primary Parent can delete any specific learned data point at any time.
- **FR68:** Primary Parent can initiate a "reset flavor journey" purge of all child-associated artifacts once per year without closing the account.
- **FR69:** Primary Parent can request full account deletion with data erasure across the platform and all named processors within 30 days.
- **FR70:** Primary Parent can access a parental review dashboard summarising all child-associated data collection, processing, and retention.
- **FR71:** Primary Parent can export an auditable copy of all household data in a machine-readable format.
- **FR72:** Primary Parent can view the consent history associated with their household (VPC events, policy updates acknowledged, data-sharing opt-ins).
- **FR73:** Each learned data point in the Visible Memory panel carries metadata showing when it was learned and from what source type (onboarding, conversation, plan outcome, explicit edit).
- **FR74:** Geolocation access is off by default at household and child level; Primary Parent can explicitly opt in to geolocation for specific named purposes at household level only, never at child level.
- **FR75:** System retains voice transcripts for a bounded default period (90 days) for product-quality purposes; Primary Parent can opt in to longer retention or immediate deletion at any time.

### Allergy Safety & Guardrails

- **FR76:** System applies an independent rule-based allergy guardrail, separate from LLM judgment, to every generated plan before any user-visible surface renders it.
- **FR77:** System does not display any plan version to any user that has not been cleared by the allergy guardrail.
- **FR78:** System maintains an auditable log of every allergy-guardrail decision, including both acceptances and rejections.
- **FR79:** System requires explicit parent confirmation on any plan change that affects an allergy-relevant ingredient for a household with declared allergies.
- **FR80:** System produces a transparency log exportable to the parent on request showing every system action taken for allergy-relevant decisions affecting their household.
- **FR81:** System flags allergy-relevant uncertainty on any plan item whose ingredient provenance cannot be verified, and either substitutes safely or surfaces the uncertainty to the parent for resolution.
- **FR82:** System escalates a hard-fail case (no safe plan possible for a given week given the constraints) to ops and to the parent with a transparent description.
- **FR83:** Primary Parent can view a standing household allergy-safety audit dashboard in addition to the on-request transparency-log export.

### Billing, Tiers & Gift Subscriptions

- **FR84:** Primary Parent can subscribe to the Standard tier at monthly or annual pricing with school-year aligned billing and automatic pause during school holidays.
- **FR85:** Primary Parent can subscribe to the Premium tier at monthly or annual pricing with school-year aligned billing and automatic pause during school holidays.
- **FR86:** Primary Parent can upgrade from Standard to Premium or downgrade from Premium to Standard at any time within a billing period.
- **FR87:** Primary Parent can cancel any subscription at any time with explicit confirmation.
- **FR88:** A third-party payer can purchase a gift subscription for a specified household at either tier with annual prepayment.
- **FR89:** A gift-subscription payer can optionally purchase Guest Heart Note authoring permission associated with that gift.
- **FR90:** System transitions beta-cohort households from free access to paid status at the end of the beta period with explicit upgrade confirmation UX and a 14-day first-charge refund window.
- **FR91:** System handles failed payment events (card expired, bank declined) with a defined grace period, parent notification, and service-continuity posture.
- **FR92:** System generates billing receipts or invoices accessible to the Primary Parent.
- **FR93:** Primary Parent can configure school-year start and end dates per household to align auto-pause with their actual school calendar.
- **FR94:** Gift purchaser can cancel a gift before redemption and receive a full refund.

### Ops, Support & Incident Response

- **FR95:** Ops personnel can view an allergy-safety anomaly dashboard with alert severity, household identifier (anonymized where permitted), incident status, and audit-log access.
- **FR96:** Ops personnel can view plan-generation latency, voice-cost-per-household, allergy-guardrail catch-rate, and Lunch Link delivery success-rate metrics in aggregate and per-household (anonymized) views.
- **FR97:** Ops personnel can escalate an allergy-safety incident through a defined SLA pathway (dashboard alert → on-call engineer → parental notification with transparency log).
- **FR98:** System maintains audit logs of allergy decisions, plan generations, Heart Note authorship and delivery, Visible Memory edits, billing changes, and account deletions for the regulatory-minimum retention period.
- **FR99:** Primary Parent can submit a support request or feedback message via a defined channel within the product.
- **FR100:** Ops personnel can respond to a Primary Parent support request with a bounded response SLA.
- **FR101:** Compliance Officer (or equivalent role) can export the audit log subset required for regulatory audit, subpoena, or parental data-request.
- **FR102:** System delivers in-product surveys to activated households at defined validation milestones — first-plan satisfaction (within 48 hours of first plan), cultural recognition (week 2 and week 3 for culturally-identified households), mid-beta willingness-to-pay (beta day 60), and post-launch satisfaction (30 days post-payment).
- **FR103:** Ops personnel can assign specific households into tier-variant experimental arms (e.g., beta month-5 Standard-only transition) for controlled A/B validation, with audit-logged cohort assignment.
- **FR104:** System monitors per-household voice cost and applies tier-appropriate soft-cap messaging above the 95th percentile for that tier; sustained abuse patterns trigger hard rate-limits.

### Cross-cutting / Account Preferences

- **FR105:** Primary Parent can configure notification preferences (when and how Lumi reaches out — weekly plan ready, grocery list ready, Heart Note window reminders).
- **FR106:** Primary Parent has their own user profile (display name, preferred language for cultural terms, communication preferences) distinct from household and child profiles.

## Non-Functional Requirements

### Performance

- **Plan generation (p95):** first plan delivered within **90 seconds** of profile completion; subsequent plans within **60 seconds**.
- **Evening Check-in latency (text, p95):** first-token within **500 ms**; turn-to-turn within **1.5 seconds**.
- **Evening Check-in latency (voice, Premium, p95):** first-token within **800 ms**; turn-to-turn within **600 ms**.
- **Lunch Link delivery reliability:** **≥99.5%** of Lunch Links delivered by **7:30 AM local time** on school days.
- **Core Web Vitals (p75) per surface:**

| Surface | LCP | INP | CLS |
|---|---|---|---|
| Public landing / pre-login demo | <1.5 s | <150 ms | <0.05 |
| Authenticated home | <2.0 s | <200 ms | <0.10 |
| Lunch Link (child-facing) | <1.0 s target, <1.2 s SLO | <100 ms | <0.02 |
| Grocery mode | <1.5 s | <150 ms | <0.05 |
| Evening Check-in (text) | <2.0 s | <150 ms | <0.05 |

### Security

- **Encryption at rest:** AES-256 for all persistent storage (Supabase baseline plus application-layer encryption for allergen profile and Heart Note content).
- **Encryption in transit:** TLS 1.3 only; legacy TLS and plaintext HTTP rejected at load balancer. HSTS enforced with preload.
- **Authentication:** Supabase Auth with OAuth (Google, Apple) and email + password. Session access tokens ≤15 minutes; refresh tokens ≤30 days with rotation on use.
- **Authorization:** four-role RBAC (Primary Parent, Secondary Caregiver, Guest Author, Ops) enforced at a single Fastify preHandler — no per-route role checks.
- **Content Security Policy:** strict CSP on all authenticated surfaces — no inline scripts, no `eval`, named allowlist for script and media sources. ElevenLabs is the only third-party origin for voice. COOP / COEP enabled on authenticated surfaces for cross-origin isolation.
- **CSRF:** `SameSite=Strict` cookies where same-origin feasible; double-submit-cookie pattern for cross-origin flows.
- **Secret management:** environment variables only; no secrets in git, no secrets in code. Rotation quarterly for all processor credentials; ad-hoc on suspected compromise.
- **Audit logs:** immutable append-only; cover allergy decisions, plan generations, Heart Note authorship and delivery, Visible Memory edits, billing changes, and account deletions. Retained for the regulatory minimum (varies by category; no less than 12 months).
- **Vulnerability posture:** dependency scanning on every build; annual external penetration test beginning before public launch; quarterly internal security review.

### Privacy & Data Handling

- **COPPA posture:** two-phase Verifiable Parental Consent (soft-VPC for beta; credit-card VPC at public launch). Parental notice at signup. Parental review dashboard operational from day 1. No third-party ad or analytics SDKs on any child-touching surface. Deletion on request honored within 30 days across all named processors.
- **California AADC posture:** DPIA completed before public launch; most-protective privacy settings by default; geolocation off by default; no dark patterns; plain-language notices.
- **Data minimization:** no data collection without named purpose. Child flavor-profile derives only from plan outcomes and emoji ratings.
- **Retention:**

| Data class | Default retention | Parent control |
|---|---|---|
| Family profile | Active account lifetime | Explicit edit / forget at any time |
| Child flavor profile | Active account lifetime | Selective forget, annual reset, account-close +30 days |
| Voice transcripts | 90 days | Opt-in longer retention, on-demand immediate deletion |
| Heart Note content | Delivered-and-then-deleted (no server-side archive beyond audit metadata) | On-demand immediate deletion |
| Lunch Link URL | One-time use, expires <48 hours after intended delivery | — |
| Audit logs | Regulatory-minimum per category (typically 12 months; 7 years for compliance-critical) | Not user-controllable (regulatory obligation) |
| Billing records | Regulatory-minimum (typically 7 years) | Not user-controllable (tax / accounting obligation) |

- **Data portability:** parent can export an auditable copy of all household data in structured JSON format within 72 hours of request.
- **Processor DPA chain:** every processor (ElevenLabs, SendGrid, Twilio, Supabase, Stripe, LLM provider, internal analytics) under executed DPA with downstream deletion enforcement on parent erasure requests.

### Scalability

- **Beta capacity target:** 150 concurrent active households with no degradation of any Performance NFR above.
- **Public-launch capacity target:** 5,000 concurrent active households at October 1, 2026 launch.
- **End-of-H1-2027 target:** 50,000 concurrent active households with linear cost scaling (no architectural rewrite).
- **School-morning peak:** Lunch Link delivery surge between 6:00–8:00 AM local time across US timezones must not exceed any Performance NFR. System provisioned for **3× baseline** traffic during this window.
- **Plan-generation queue:** weekend plan-generation batch (Friday PM through Sunday AM) must complete within 36 hours for the entire active household base, with no household waiting more than 4 hours from their generation window open.
- **Vertical scaling:** Supabase provisioned at appropriate tier with headroom; Redis cluster sized for SSE event fanout; LLM provider capacity reserved for peak planning windows.

### Accessibility

- **Target:** WCAG 2.1 Level AA compliance across all surfaces, verified via automated (`@axe-core/playwright`) and manual audits.
- **Plain-language copy enforcement:** readability CI check — Lunch Link copy ≤ reading grade 4; parent-facing copy ≤ grade 8. Build fails on violation.
- **TTS caption fallback:** all voice output from Lumi renders concurrent text captions; captions accessible via screen reader; not opt-in.
- **Keyboard navigation:** complete across all authenticated and public surfaces.
- **Color contrast:** ≥4.5:1 for normal text, ≥3:1 for large text.
- **Focus indicators:** visible on all focusable elements.
- **Multilingual content rendering:** Hindi (Devanagari), Hebrew, Arabic (RTL), Tamil, and other scripts render correctly within Heart Notes and cultural-term display regardless of UI locale. UI itself remains English in H1; content-layer multilingual.

### Reliability & Availability

- **API availability:** **99.9%** during school hours (6 AM–9 PM local, per user timezone); **99.5%** outside school hours.
- **Voice pipeline availability:** **99.5%** with graceful text fallback when unavailable.
- **Data durability (family profile):** **99.999%** (Supabase baseline); no acceptable data loss.
- **Data durability (child flavor-profile):** **99.999%**.
- **Data durability (Heart Note in-flight):** **99.999%** during delivery window; deleted post-delivery per retention policy.
- **Disaster recovery:** RPO ≤1 hour for all primary data; RTO ≤4 hours for critical path (Lunch Link delivery, plan view, allergy guardrail). Backups tested quarterly.
- **Vendor-failure fallback:** voice pipeline degrades to text-only if ElevenLabs unavailable; email / SMS delivery has per-channel fallback (primary fails → try secondary within 30 minutes); LLM provider has secondary-provider failover within 15 minutes.
- **Reconnect discipline:** exponential backoff with jitter (1 s initial, 2× multiplier, ±20% jitter, max 60 s) for SSE and ElevenLabs WS — prevents thundering-herd reconnects.

### Observability

- **MVP-grade (beta phase, April–September 2026):**
  - Structured logging (Pino) for all backend services
  - HTTP 5xx alerting on threshold breaches
  - SSE disconnect counters with alert on anomalous spikes
  - ElevenLabs WS error-rate alerts
  - On-call rotation (PagerDuty or equivalent)
- **Growth-grade (public launch, October 1, 2026 onward):**
  - SLO dashboards with error-budget accounting per service
  - Multi-severity on-call (P1 / P2 / P3) with defined escalation
  - Synthetic monitoring for critical user paths (plan view, Lunch Link delivery, Heart Note delivery)
- **Product telemetry (day-1 from beta):** plan-generation latency p50 / p95, voice cost per household per day, LLM cost per plan, allergy-guardrail catch rate, Lunch Link delivery time-to-7:30-AM success rate, Visible Memory panel visit rate, first-plan satisfaction survey completion rate.
- **Incident-response SLA (allergy-safety anomaly):** dashboard alert within 5 minutes of detection; on-call engineer engaged within 15 minutes; parent notified within 1 hour with transparency log; architectural review within 24 hours; backported fix within 72 hours.

### Integration

- **ElevenLabs (voice pipeline):** WebSocket for STT / TTS. DPA executed with explicit child-voice handling clause (MVP: parent voice only). US-region processing. 90-day retention cap.
- **SendGrid (email delivery):** Lunch Link and Heart Note email rails. DPA with child-surface behavioral-analytics exclusion. 90-day delivery-log retention.
- **Twilio (SMS + WhatsApp):** Lunch Link multi-channel delivery. DPA; no message-content retention beyond delivery window.
- **Supabase (Postgres + Auth + Storage):** primary data layer. DPA; US-region primary; encryption at rest; audit-log retention configured.
- **Stripe (billing):** Standard + Premium tiers, gift subscriptions, school-year auto-pause. PCI-DSS Level 1 inherited; HiveKitchen SAQ-A compliant. Credit-card VPC at subscription signup.
- **OpenAI or Anthropic (LLM):** plan generation, Evening Check-in text, voice-transcript processing. Zero data retention enforced via API settings. No training on household data. Allergen decisions never routed through LLM judgment.
- **Internal analytics:** first-party only; no third-party ad or analytics SDKs on any surface; PII excluded before storage.
- **API rate limiting:** per-household quotas on plan-generation, Evening Check-in calls, and Lunch Link delivery to prevent abuse. Voice usage soft-capped at the 95th percentile per tier (per FR104).

### Cost & Unit Economics

- **Standard-tier voice cost ceiling:** <$1.00 per household per month (covers Heart Note voice capture + voice onboarding + 10-minute weekly Evening Check-in cap).
- **Premium-tier voice cost ceiling:** <$4.00 per household per month at p95 (target typical: $2.50–$3.50).
- **LLM cost per plan generation:** <$0.25 per plan.
- **CDN + infrastructure cost per household per month:** <$0.50 at beta scale; <$0.20 at 10,000+ household scale (economies of scale).
- **Compliance / audit cost budget:** external annual audit + external compliance advisor retainer budgeted separately from per-household marginal cost.

### Compliance

- **COPPA (16 CFR Part 312):** audit-ready at public launch. Compliance Officer role assigned by August 2026. External compliance advisor retained throughout beta.
- **California AADC (AB 2273):** DPIA completed before public launch; most-protective-defaults enforced.
- **State-level minor privacy (CT, UT, TX, FL, VA and evolving):** compliance changelog maintained; quarterly legislative monitoring; compliance deltas tracked against COPPA / AADC baseline.
- **FDA FALCPA + FASTER Act:** allergen data model tracks top-9 declared allergens consistently; additional parent-declared allergens supported.
- **GDPR / UK Children's Code readiness:** deferred (USA-only MVP) but architectural choices (data minimization, right-to-delete, DPA discipline) do not foreclose future extension.

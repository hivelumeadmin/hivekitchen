# HiveKitchen — Product Brief

**Author:** Menon (facilitated by Mary, Business Analyst)
**Date:** 2026-04-18
**Status:** Draft v2
**Companion documents:** `docs/Product Concept .md`, `_bmad-output/brainstorming/brainstorming-session-2026-04-17-1940.md`

---

## 1. Executive Summary

HiveKitchen is an AI-led school lunch planning companion for families who want to pack safe, meaningful, and genuinely enjoyable lunches without carrying the mental load of planning them. Its AI agent, **Lumi**, learns each family's identity — allergies, school policies, cultural and religious food requirements, child preferences, pantry state, and household rhythms — and produces a personalized weekly plan before the school week begins. Parents confirm or adjust through a voice-or-text conversation; children receive a daily **Lunch Link** carrying a parent-written **Heart Note**; Lumi learns from their feedback and gets meaningfully better the longer it is used.

The product launches in a closed beta (April–September 2026, invite-only, 6 months free), and at public launch on **October 1, 2026** transitions into a **two-sided, hyperlocal, cloud-kitchen-inspired marketplace** — where participating provider households cook Lumi-generated plans for other families within a 5-mile radius.

**Initial market:** USA. **Pricing:** $6.99/month or $69/year per household, school-year aligned, auto-pausing during holidays.

**Core differentiation:** accumulating family-specific intelligence; a silent Pantry-Plan-List loop that eliminates grocery cognitive load; first-class cultural identity depth for underserved communities (Halal, Kosher, South Asian, East African, Caribbean) rendered end-to-end from pantry to child's screen; a deliberately sacred parent-to-child emotional channel (the Heart Note) that competitors cannot replicate through generic AI; and a cloud-kitchen-model provider marketplace that turns cultural sourcing into a supply-side moat.

---

## 2. Problem

School lunch planning is a high-frequency, high-stakes decision that parents repeat throughout the school year. It must simultaneously balance child preferences, nutritional adequacy, time constraints, safety requirements (allergies), school-specific food policies, and cultural or religious food identity — and these constraints differ by household and change over time.

Existing meal-planning and recipe tools are built for discovery, not for reliably translating constraints into safe, compliant, packable, child-accepted lunches. The result is recurring cognitive load for parents, inconsistent outcomes, and a planning process that defaults to stress, guesswork, or repetition. Culturally specific households — Halal, Kosher, South Asian, East African, Caribbean and others — are particularly underserved by US-centric meal products that treat cultural identity as a toggle rather than a foundational constraint, and provide no awareness of where these households actually source specialty ingredients.

A secondary unmet need: working parents have few daily rituals of meaningful connection with their children during the school day. School lunches, delivered with intention and acknowledged by the child, can become a small but durable emotional ritual — and today's tools do nothing with that opportunity.

---

## 3. Target Users

**Primary user:** a parent or caregiver, aged roughly 28–55, with one or more school-age children (4–17), managing at least one non-trivial lunch-planning constraint — food allergy, school nut-free policy, Halal or Kosher household, a child who refuses most things, or a combination. Time-poor, decision-fatigued, not looking for recipe inspiration. Looking for a system that does the thinking for them without erasing their family's identity.

**Culturally specific communities** (Halal, Kosher, South Asian, East African, Caribbean) are a deeply valued and underserved primary segment, not an afterthought.

**Secondary user:** the child, who participates through the Lunch Link ritual and whose feedback shapes Lumi's learning over time. The child is a signal-source, not a system operator.

**Initial geography:** United States. Launch markets will favor dense urban and suburban zones where hyperlocal provider matching (Horizon 2) can achieve liquidity within a 5-mile radius.

---

## 4. Solution

### 4.1 Core experience — Horizon 1

HiveKitchen is a weekly planning cycle built around Lumi's proactive intelligence, surfaced through seven product surfaces:

- **The Weekly Plan** — Lumi generates next week's plan before the week begins, drawn from a curated **Seed Library** and shaped by the family's full profile (preferences, allergies, school policies, cultural identity, calendar, pantry state). Each day's plan is a **Lunch Bag** with up to three parent-declared slots per child: a required **Main**, an optional **Snack** (culturally neutral, item-level SKUs such as fruit or bars), and an optional **Extra** (open-type — fruit, drink, treat, cultural side, or a parent-authored custom item). Composition is parent-owned per child; Lumi fills the declared slots.
- **The Brief** — a unified UI surface presenting daily, weekly, and monthly synthesis. Daily Brief shows today's lunch, prep card, Heart Note status, who's packing. Weekly Brief shows next week's draft plan, feedback rollup, profile refinement prompts. Monthly Brief shows family flavor snapshot, learned preferences, cultural lean.
- **The Lunch Link** — a time-limited, no-app web link delivered daily to each child by email, WhatsApp, SMS, or parent-copied URL. The Heart Note appears first and visually dominant on the surface; beneath it the bag preview renders each component (Main, Snack, Extra) as a distinct item. The child rates through a two-layer interaction: a one-tap whole-bag emoji (`love / like / meh / no`) as the always-available ritual, and an optional swipe-right per-item thumbs-up for children who want to go deeper. No thumbs-down exists; absence of a rating is never a negative signal. The rating window closes at 8 PM local same day. Over time, the link also surfaces the child's accumulating **flavor profile and cultural journey** — cuisine passport, mother-tongue food words, ancestor cuisine badges, cultural calendar companion, and an end-of-year flavor letter. Built passively from lunches and taps, never from configuration.
- **The Heart Note** — a short, parent-authored emotional message for the child. Never used for logistics. The retention engine of the Lunch Link ritual.
- **Lumi's Voice to the Child** — a distinct communication channel separate from the Heart Note, clearly signed as Lumi. Hosts periodic "I know you" notes, cultural-first acknowledgements, adventure-level milestones, and the end-of-year flavor letter. Never impersonates the parent; never used for logistics.
- **The Pantry-Plan-List Loop** — a silent closed cycle where the grocery list is derived from the plan, the parent's tap-to-purchase action at the store IS the pantry update, and the pantry state informs next week's plan and powers pantry-aware swap suggestions. Snack items appear as first-class citizens on the list in a distinct section (item-level SKUs, not ingredient decompositions), so no household's snack supply silently runs out mid-week. No separate pantry management surface exists. Grocery execution supports an "I'm at the store" mode (large text, tap-to-check-off, store-layout-aware sort) and multi-store split lists that route specialty ingredients (e.g., atta, halal meat) to a community-maintained **Cultural Supplier Directory** within a 5-mile radius.
- **The Evening Check-in Loop** — a context-aware, home-screen resident conversation between parent and Lumi, available in both voice and text. Lumi senses energy, duration, and household chaos, adapting her length and tone accordingly. Glanceable when the parent is rushed ("What's tomorrow?"), conversational when they want to think out loud ("Help me figure out Tuesday"). Sunday is always a longer planning conversation. One learned-time reminder per day; dismissed means silent until tomorrow.

### 4.2 Horizon 2 — Provider Marketplace (launches October 1, 2026)

At public launch, HiveKitchen introduces a **two-sided marketplace**:

- **Provider households** enroll to cook homely-style lunches for other families' Lumi-generated weekly plans, operating under cloud-kitchen-grade standards (food safety, insurance, inspection, payment flows).
- **Hyperlocal matching** within a 5-mile radius. The cultural supplier directory that powers Horizon 1 grocery routing doubles as the supply-side infrastructure for provider-buyer matching. Cultural identity becomes a matching criterion — Halal buyers matched with Halal providers.
- **Full-week production cadence** — each provider takes a full week's approved plan as their production unit.
- **Higher-tier provider subscription** — monetization scales from the supply side.
- **Emotional layer is preserved** — providers cook, parents write Heart Notes. The sacred channel stays parent-authored.

---

## 5. Operating Principles & Boundaries

Five principles, two corollaries, one sub-principle, and one structural boundary govern every product decision. They are constraints, not aspirations.

- **Principle 1 — Lumi leads. Parents confirm. Children feel.** Every plan, prep card, adjustment, and insight is produced by Lumi first and presented as a finished proposal. Visibility is required; confirmation is not. *Sharpening:* "Lumi leads" does NOT mean "Lumi initiates frequently." Lumi has the plan ready when the parent comes looking; she does not interrupt with nudges, warnings, or "want me to add X?" prompts. Each proactive prompt is a micro-decision, which is cognitive load.
- **Principle 2 — No approvals, only proposals.** Plans never require explicit approval. They remain mutable until the day they cover. No accept buttons; no confirmation modals. Silence is trust, not consent.
- **Principle 3 — The Heart Note is sacred.** A parent-to-child emotional channel, never used for logistics, reminders, or system messaging. **Corollary 3a:** the Heart Note never references Lumi's learning, the feedback system, or plan changes. Lumi carries it unmodified. When Lumi needs to communicate with the child directly, she uses Lumi's Voice to the Child — a separate, clearly signed channel.
- **Principle 4 — Voice and text are Lumi's conversational channels.** Both are first-class; users choose their modality based on context and preference. Every conversational capability — profile enrichment, the evening check-in, plan adjustments through dialogue, Heart Note dictation, child replies — is available in both. **Corollary 4a:** transactional surfaces (grocery list, plan view, prep card, Lunch Link emoji) remain tap-based. Voice/text are for conversation; tap is for transaction.
- **Principle 4 sub-principle — Lumi's Voice:** warm, never chirpy; calm evening energy; asks only what she genuinely needs to know; silence is a complete answer; ends conversations with "I'm here" presence rather than pressure.
- **Principle 5 — Earned through eating, not through tapping.** The child's accumulating artifacts (flavor profile, cuisine passport, cultural journey) reflect genuine taste and growth from lunches and ratings — not rewards for behavioral frequency. No streaks, no points, no leaderboards.
- **Boundary 1 — Children signal. Children do not operate.** Children rate, request, vote, contribute recipes (age-appropriate, parent-approved), and see their accumulating flavor profile in passive, read-only form. Children do not access settings, edit profiles, plan weeks, or configure the system.

---

## 6. Differentiation & Moat

Most meal-planning AI is a feature that a general-purpose assistant could replicate. HiveKitchen's defensibility comes from five compounding advantages:

1. **Accumulating family-specific intelligence.** Every emoji tap, plan adjustment, evening check-in, and conversational aside enriches Lumi's model of the family. After 3 months a competitor cannot replicate this context without re-acquiring it. Cancellation feels like losing a knowledgeable family member — the visible "what you'd lose" switching cost is the commercial expression of this moat.
2. **The Pantry-Plan-List Loop.** A silent, closed cycle where the parent never manages a pantry directly, yet Lumi always knows the current state. The combination of tap-to-purchase, plan-aware decrement, and silent list regeneration is a category-redefining anti-friction pattern — the sort of micro-elegance that feels magical and is expensive to copy.
3. **Cultural identity depth end-to-end.** Halal, Kosher, Hindu vegetarian, and other cultural templates are not UI toggles but rule systems tuned to real-world communities. This depth renders through every surface: plan generation, grocery routing (cultural supplier directory), provider matching (Horizon 2), and the child's own flavor artifacts (cuisine passport, mother-tongue food words, ancestor cuisine, cultural calendar). Competitors cannot replicate this without the community-sourced data HiveKitchen accumulates.
4. **The Heart Note ritual and the child's flavor journey.** An emotional channel between parent and child, routed through a product — backed by a child-owned, passively-accumulating artifact of taste and heritage. Together these make the Lunch Link durable beyond the emoji-tap novelty window, and give the child a sense of *becoming* that is hard to replace.
5. **The cloud-kitchen marketplace (Horizon 2).** A hyperlocal, culturally-paired supply side operating at professional food-safety standards while producing home-cooked-style food. A defensible category position between unregulated home cooks and generic ghost kitchens, with the cultural supplier directory providing shared infrastructure with Horizon 1.

---

## 7. Go-to-Market

### 7.1 Phasing

| Phase | Window | What ships | Revenue |
|-------|--------|-----------|---------|
| Phase 1 — Closed Beta | Apr–Sept 2026 (6 months) | Household planning product, invite-only | None (6 months free) |
| Phase 2 — Public Launch | From **October 1, 2026** | Household subscription + provider marketplace go live together | Household subs + provider subs |

### 7.2 Pricing (Horizon 1 — household side)

- **$6.99 / month** or **$69 / year** per household, unlimited children.
- School-year aligned billing, auto-pause during school holidays.
- USA first, USD. International tiered pricing deferred until post-launch signal.
- Grandparent gift subscription available as a pre-paid year.

### 7.3 Pricing (Horizon 2 — provider side)

- Higher-tier provider subscription. Exact structure TBD — shaped by beta feedback and provider economics modeling prior to October 1, 2026.
- Potential transaction fees: TBD.

### 7.4 Acquisition

- Pre-login "try a demo family" interactive preview on the landing page.
- Pain-point-led landing page ("what's your biggest lunch pain?") → tailored demo plan → account creation.
- "Less than one coffee a week" value anchoring in marketing copy.
- Grandparent-gifting as an emotional acquisition loop.
- Cultural community partnerships (mosques, synagogues, temples, community centers) for trusted-channel acquisition in underserved segments.

### 7.5 Beta recruitment

- Invite-only, targeting ~50–150 households in the USA across: households with at least one child allergy; Halal, Kosher, Hindu vegetarian, or South Asian / East African / Caribbean culturally identified households; dual-working-parent households.
- Success measured by qualitative feedback quality, profile completeness trajectory, week-3 satisfaction, Heart Note usage rate, child Lunch Link engagement, and the emergence of cultural-supplier directory data from the community itself.

---

## 8. Success Hypotheses

Hypotheses to be validated — not commitments.

- **Beta (90-day interim check):** ≥70% of invited households complete their profile; ≥60% of children engage with the Lunch Link weekly; ≥50% Heart Note written-rate on school days; ≥3 qualitative mentions per household of "Lumi got better" by week 8; ≥30% of culturally-identified households contribute at least one supplier entry by week 12.
- **Public launch (first 6 months post-Oct 1):** ≥40% trial-to-paid conversion post-beta; ≥70% month-2 retention; demonstrable willingness-to-pay across at least three cultural segments.
- **Marketplace (launch + 6 months):** ≥20 provider households onboarded in at least 2 US metro areas; ≥100 matched weeks fulfilled; provider-side NPS above 40; buyer-side repeat-match rate above 60%.

---

## 9. Known Risks & Open Questions

All flagged; none resolved in this brief.

**Commercial / marketplace risks**

- US cottage food, MEHKO, and CFO regulation vary significantly by state. Cloud-kitchen framing mitigates but does not eliminate regulatory complexity.
- Food safety liability, insurance structure, and audit cost for distributed household kitchens.
- Two-sided marketplace cold-start — hyperlocal 5-mile radius requires provider and buyer density within each zone.
- Provider recruitment, cultural authenticity verification, and quality control at scale.
- Payment flows, tax treatment, and provider earnings disclosure.

**Product / execution risks**

- **Compressed timeline.** Six months is aggressive for core product validation + provider onboarding + food-safety infrastructure. A staggered Horizon 2 launch may become a necessary fallback.
- **Setup friction.** Time-to-first-good-plan must land under 10 minutes or beta engagement degrades. Voice-interview onboarding + cultural identity templates + progressive enrichment are the anti-friction spine.
- **Child-feedback decay** beyond week 12. Mitigated by the Heart Note being the primary retention engine (Principle 3 is load-bearing commercially, not just emotionally) and by the child's passively-accumulating flavor artifacts creating a second retention layer.
- **Seed Library depth.** 200 recipes across multiple cultural communities is thin; library must expand rapidly through the beta.
- **Cultural Supplier Directory cold-start.** The directory requires community contribution. Early beta households in cultural segments must be engaged as contributors, not just consumers.
- **Voice cost (ElevenLabs) at scale.** Mitigated by heavy voice users correlating with high-retention users and by text parity ensuring no forced voice usage.
- **Seasonal churn during US summer break.** Addressed structurally via auto-pause pricing, but retention recovery in September is untested.

**Open strategic questions**

- Provider subscription pricing model not yet specified.
- International pricing strategy deferred.
- Whether the closed beta includes any provider-side dry-run cohort, or is strictly buyer-side.
- Flavor-artifact UI format selection (constellation / garden / recipe book / journal) — one or two to ship.

---

## 10. Out of Scope (at launch)

HiveKitchen is **not**: a recipe platform, a nutrition tracker, a grocery delivery service, a general family meal planner, a social or sharing platform, a household scheduling tool, a two-way calendar integration, a meal diary, a food waste tracker, or a memory journal. The Family Calendar exists solely to inform lunch planning. The Google Calendar integration is read-only. The Heart Note is never used for logistics or chores. Children cannot operate the system. Voice is not a command shortcut or a rejection UI.

---

## 11. What Success Looks Like

For a parent, success is opening the app on the weekend, seeing a plan that feels right, making zero adjustments (or two), and not thinking about school lunches again until next week — and when they shop, tapping items off a list that routed their halal meat to Haji's and their milk to Kroger without a single decision. For a child, success is opening a Lunch Link and feeling that the lunch — and the note from their mum or dad — was made specifically for them; their emoji tap actually mattered; and over time, seeing a small, quiet flavor map fill in that feels like their own. For the product, success at 90 days post-public-launch is a majority of households engaging weekly, children above 50% Lunch Link participation, a meaningful share of free users converting to paid not because they were pushed but because Lumi has become hard to give up, and the first Horizon-2 provider matches producing real dinners-turned-lunches within their 5-mile communities.

---

*End of brief. v2.*

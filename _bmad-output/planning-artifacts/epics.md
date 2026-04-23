---
stepsCompleted: [1, 2, 3, 4]
workflowComplete: true
completedAt: '2026-04-22'
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
excludedDocuments:
  - docs/Technical Architecture.md
  - docs/Backend_Architecture.md
  - docs/Voice Interaction Design.md
  - docs/Design System.md
  - docs/Product Concept .md
  - docs/AI Principles.md
  - _bmad-output/brainstorming/brainstorming-session-2026-04-17-1940.md
inputDocumentsUsage: |
  PRD, Architecture, and UX Spec are authoritative. docs/* and brainstorming
  excluded per user instruction at workflow start.
project_name: 'HiveKitchen'
user_name: 'Menon'
date: '2026-04-22'
---

# HiveKitchen — Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for HiveKitchen, decomposing the 127 functional requirements (PRD), 10 non-functional requirement axes (PRD), architecture-derived technical requirements (architecture.md), and UX design requirements (UX Spec) into implementable stories.

Scope: **MVP-cut-aligned for closed beta (April 2026)** with Growth/Vision items tagged for the post-launch backlog.

## Requirements Inventory

### Functional Requirements

**Family Profile & Onboarding (FR1–FR14)**

- FR1: Primary Parent can create a household account through supported authentication methods.
- FR2: Primary Parent can complete profile setup via a voice-based onboarding interview as the default onboarding path.
- FR3: Primary Parent can complete profile setup via a text-based conversational onboarding with equivalent outcome to the voice interview.
- FR4: Primary Parent who declines voice onboarding receives identical product capabilities and tier access as those who use it.
- FR5: Primary Parent can add one or more children to the household with name, age-band, declared allergies, school food-policy constraints, and palate preferences.
- FR6: Primary Parent can select one or more cultural templates (Halal, Kosher, Hindu vegetarian, South Asian, East African, Caribbean) in any combination, including multi-template composition for blended-heritage households.
- FR7: System infers starter cultural template composition from the onboarding conversation and presents the result for parental confirmation before committing.
- FR8: Primary Parent can execute a digital signed consent declaration during beta onboarding as the verifiable-parental-consent mechanism.
- FR9: Primary Parent can execute credit-card verifiable-parental-consent at subscription signup.
- FR10: Primary Parent can invite a Secondary Caregiver to the household with scoped access, without requiring the invitee to create a separate account.
- FR11: Primary Parent can manage their own account profile (email, password, auth method, display name) separately from the household and child profiles.
- FR12: Primary Parent can recover account access through a password-reset or auth-provider-recovery flow.
- FR13: Primary Parent can redeem a gifted subscription by activating a pre-paid subscription tier or accepting access to a gift-configured household.
- FR14: System delivers a comprehensive parental-notice disclosure at signup, prior to any child data collection, describing what data is collected, by whom (including named processors), for what purpose, and with what retention horizon.

**Lunch Bag Composition (FR107–FR120)**

- FR107: Primary Parent can declare, per child, whether the Snack slot and Extra slot are active during household onboarding; Main is always active.
- FR108: Primary Parent can modify any child's Lunch Bag composition (Snack on/off, Extra on/off) at any time post-onboarding; changes take effect on the next plan-generation cycle.
- FR109: System generates content for every active slot in a child's Lunch Bag on every scheduled school day, subject to allergy, policy, and cultural constraints.
- FR110: System renders Snack items as a distinct section of the derived shopping list (FR48), visually and ordinally separate from Main-recipe ingredients; store-mode aisle-path sort (FR49) groups Snack items together.
- FR111: System models Snack content as item-level SKUs with unit-based pantry depletion, separately from Main content which is modeled as recipes with ingredient decomposition. The Extra slot supports either item-level or recipe-level content.
- FR112: System supports school-policy rules with per-slot scoping (bag-wide, Main-only, Snack-only, Extra-only); a policy change targeting a specific slot triggers regeneration only of items in that slot for affected future plans.
- FR113: Allergy-safety rules apply bag-wide and do not support per-slot scoping; the allergy guardrail (FR76) treats an allergen in any slot identically regardless of which slot it appears in.
- FR114: Primary Parent can pin a component type (e.g., "always include a fruit") to the Extra slot for a specific child; Lumi respects the pin in all subsequent plans for that child.
- FR115: Primary Parent can ban specific component types (e.g., "no sweet treat ever") from the Extra candidate pool for a specific child.
- FR116: System passively weights a parent's repeated removal of Extra items from a child's bag as a preference signal, silently biasing future Extra-slot content selection for that child.
- FR117: Primary Parent can save a parent-authored Extra item as a custom reusable entry in the household's Extra library.
- FR118: System supports a defined set of day-level context overrides — Bag-suspended, Half-day, Field-trip, Sick-day, Post-dentist (soft-only), Early-release, Sport-practice, Test-day — that temporarily modify composition and/or content for a single (child, day). Lumi proposes each override based on calendar signal or parent flag; Primary Parent confirms per Principle 1; overrides auto-revert after the day.
- FR119: System proposes adding an Extra item on a day with an on-calendar high-activity event (e.g., sport practice, field trip) for children whose Extra slot is normally off; Primary Parent confirms.
- FR120: Lunch Link (FR34) renders each component of the Lunch Bag as a distinct visual element beneath the Heart Note on the same surface. The Heart Note is visually dominant; the bag preview and rating surface appear below it. Each item card is individually previewable by the child and supports the Layer 2 swipe-right gesture specified in FR36.

**Weekly Plan Lifecycle (FR15–FR26)**

- FR15: System generates a week's worth of lunch plans (one per school day per child) in advance of the start of the school week, drawing on household profile, per-child Lunch Bag composition, pantry state, school policy, cultural context, and child palate. Each daily plan produces content for every active slot.
- FR16: Primary Parent or Secondary Caregiver can view the current week's plan from a default landing surface without performing any preceding interaction.
- FR17: Primary Parent or Secondary Caregiver can view any individual day's plan with preparation instructions.
- FR18: Primary Parent or Secondary Caregiver can edit any day's plan for any child at any point before that day by swapping the item in any individual slot independently, swapping the plan with another day's, or marking skip/sick.
- FR19: System adjusts affected future-day plans in response to school-policy changes, leftover state shifts, and cultural-calendar events without requiring the parent to re-plan.
- FR20: Primary Parent or Secondary Caregiver can pause the Lunch Link for a specific child on a specific day without altering the underlying plan.
- FR21: Primary Parent can view the following week's draft plan beginning Friday afternoon of the preceding week.
- FR22: Primary Parent can update declared school-policy constraints (e.g., nut-free rule, no-heating rule) and have the changes propagate through all affected future plans.
- FR23: Primary Parent can request regeneration of a full week or specific day plan with the same constraint set.
- FR24: System surfaces an explicit graceful-degradation state when it cannot generate a safe plan for a household given the constraint set.
- FR25: Primary Parent or Secondary Caregiver can view historical plans and their outcomes (emoji ratings, swaps made) for any prior week.
- FR26: System maintains cultural-calendar awareness for all active household cultural-template compositions and weights upcoming-event-adjacent meals into plan generation without requiring parent prompting.

**Household Coordination (FR27–FR31)**

- FR27: Primary Parent or Secondary Caregiver can designate which household member is responsible for packing lunch on any given day.
- FR28: Primary Parent and Secondary Caregiver can exchange messages within a shared household thread.
- FR29: System uses household-thread context to enrich household profile and inform plan adjustments where signals are present.
- FR30: Primary Parent can revoke Secondary Caregiver access at any time without requiring caregiver consent.
- FR31: Primary Parent can transfer primary ownership of the household to another Secondary Caregiver.

**Heart Note & Lunch Link (FR32–FR47, FR121–FR127)**

- FR32: Primary Parent, Secondary Caregiver, or authorized Guest Author can compose a Heart Note by text input for any child for any specific day.
- FR33: Primary Parent, Secondary Caregiver, or authorized Guest Author can compose a Heart Note by voice capture on any tier.
- FR34: System delivers the Lunch Link to the child via the parent-designated delivery channel (email, WhatsApp, SMS, or parent-copied URL) prior to the child's lunch time on each school day.
- FR35: Child can view the Lunch Link on any device via a session-scoped link without logging in, installing software, or creating an account.
- FR36: Child can rate a Lunch Link using a two-layer interaction. Layer 1: single whole-bag emoji tap from {love, like, meh, no}. Layer 2: optional swipe-right per item card to register positive preference. No thumbs-down, no swipe-left, no negative per-slot option.
- FR37: Child can view their cumulative flavor-profile artifact from within the Lunch Link.
- FR38: System delivers the Heart Note content to the child exactly as authored, without AI modification, addition, softening, or suggestion.
- FR39: System does not reference the feedback system, Lumi's learning, or plan changes within the Heart Note surface.
- FR40: Primary Parent can grant a Grandparent Guest Author Heart Note authoring permission rate-limited to a capped frequency.
- FR41: Premium-tier Primary Parent can enable voice playback of the Heart Note for the child via the Lunch Link.
- FR42: Child can submit a text-based "request a lunch" suggestion that the Primary Parent reviews and approves before Lumi incorporates it into plan generation.
- FR43: System never surfaces notifications, streaks, or absence-reminders referencing Heart Note authoring frequency to any parent.
- FR44: Primary Parent can compose a Heart Note in advance with scheduled delivery for a specific day.
- FR45: Primary Parent can edit or cancel a Heart Note at any point before its delivery window opens.
- FR46: Primary Parent can view the delivery status of every Heart Note sent (delivered, viewed, rated, not-yet-opened).
- FR47: System does not capture child voice audio in MVP; any future voice-enabled child reply channel is gated behind an explicit compliance review and a separate parental consent layer.
- FR121: Lunch Link rating window opens at first view or scheduled lunchtime (whichever first) and closes at 8 PM local time same day. After close, no further rating submissions accepted; bag rating state frozen; no retroactive surface.
- FR122: Each (child, day) Lunch Link corresponds to exactly one session URI. The URI is one-time-use: once child submits Layer 1 rating or 8 PM closes, session is consumed; subsequent attempts on the same link rejected.
- FR123: When two or more children share a single device, each child has independent (child, day) Lunch Link sessions with separate URIs; rating submissions attributed to the specific child whose session was active. No cross-child signal leakage at device level.
- FR124: System weights Layer 2 per-slot signals independently in the child-preference learning model; positive on one slot does not imply inference about other slots.
- FR125: System treats absence of a rating — Layer 1 skipped or any Layer 2 slot not swiped — as "no signal," never as negative preference or dislike.
- FR126: System distinguishes sibling-specific preference patterns from family-wide patterns in multi-child households; preference learned for one child not auto-propagated to siblings without supporting signal.
- FR127: System occasionally proposes variant preparations or pairings of an existing item and captures the delta in child ratings as an active-learning signal; variants visible to Primary Parent before delivery per Principle 1.

**Grocery & Pantry-Plan-List Loop (FR48–FR55)**

- FR48: System derives a shopping list from the current week's plan accounting for inferred pantry state, without requiring manual pantry entry.
- FR49: Primary Parent or Secondary Caregiver can view the shopping list in a "store mode" optimized for one-handed in-store use with store-layout-aware sort.
- FR50: System routes specialty ingredients to appropriate stores via the cultural-supplier directory, producing a multi-store split list when applicable.
- FR51: Primary Parent or Secondary Caregiver can mark items as purchased; the act of marking updates the inferred pantry state silently.
- FR52: System proposes leftover-aware plan swaps when pantry state indicates surplus or soon-to-expire items.
- FR53: System degrades honestly during connectivity loss in store mode; in-flight check-offs preserved as pending; parent informed of connectivity issue without silent failure.
- FR54: Primary Parent can add non-plan-derived items to the shopping list (household staples not tied to lunch plan).
- FR55: Primary Parent can correct an inferred pantry state when the inference disagrees with kitchen reality.

**Evening Check-in & Conversational Enrichment (FR56–FR64)**

- FR56: Primary Parent or Secondary Caregiver can engage in unlimited text-based conversation with Lumi at any time on any tier.
- FR57: Premium-tier subscriber can engage in unlimited tap-to-talk voice conversation with Lumi.
- FR58: Standard-tier subscriber can engage in tap-to-talk voice conversation with Lumi up to 10 minutes per week.
- FR59: System extracts profile-enrichment signals from conversational mentions without requiring explicit parental commands to update the profile.
- FR60: System surfaces Lumi's voice output with concurrent text captions for accessibility.
- FR61: System adjusts Lumi's conversational length and tone in response to household context signals (time of day, recent activity).
- FR62: System surfaces a periodic "I noticed" learning moment to the parent that makes profile enrichment legible and offers parent confirmation or correction.
- FR63: Primary Parent can initiate an Evening Check-in conversation with Lumi at any time; Lumi does not proactively initiate conversations.
- FR64: Primary Parent can ask Lumi to explain why she chose a specific meal for a specific day and receive a plan-reasoning answer.

**Visible Memory & Trust Controls (FR65–FR75)**

- FR65: Primary Parent can view every data point Lumi has learned about or associated with the household and each child.
- FR66: Primary Parent can edit any learned data point, with changes reconciled before the next plan-generation event.
- FR67: Primary Parent can delete any specific learned data point at any time.
- FR68: Primary Parent can initiate a "reset flavor journey" purge of all child-associated artifacts once per year without closing the account.
- FR69: Primary Parent can request full account deletion with data erasure across the platform and all named processors within 30 days.
- FR70: Primary Parent can access a parental review dashboard summarising all child-associated data collection, processing, and retention.
- FR71: Primary Parent can export an auditable copy of all household data in a machine-readable format.
- FR72: Primary Parent can view the consent history associated with their household (VPC events, policy updates acknowledged, data-sharing opt-ins).
- FR73: Each learned data point in the Visible Memory panel carries metadata showing when it was learned and from what source type (onboarding, conversation, plan outcome, explicit edit).
- FR74: Geolocation access is off by default at household and child level; Primary Parent can explicitly opt in to geolocation for specific named purposes at household level only, never at child level.
- FR75: System retains voice transcripts for a bounded default period (90 days) for product-quality purposes; Primary Parent can opt in to longer retention or immediate deletion at any time.

**Allergy Safety & Guardrails (FR76–FR83)**

- FR76: System applies an independent rule-based allergy guardrail, separate from LLM judgment, to every generated plan before any user-visible surface renders it.
- FR77: System does not display any plan version to any user that has not been cleared by the allergy guardrail.
- FR78: System maintains an auditable log of every allergy-guardrail decision, including both acceptances and rejections.
- FR79: System requires explicit parent confirmation on any plan change that affects an allergy-relevant ingredient for a household with declared allergies.
- FR80: System produces a transparency log exportable to the parent on request showing every system action taken for allergy-relevant decisions affecting their household.
- FR81: System flags allergy-relevant uncertainty on any plan item whose ingredient provenance cannot be verified, and either substitutes safely or surfaces the uncertainty to the parent for resolution.
- FR82: System escalates a hard-fail case (no safe plan possible for a given week given the constraints) to ops and to the parent with a transparent description.
- FR83: Primary Parent can view a standing household allergy-safety audit dashboard in addition to the on-request transparency-log export.

**Billing, Tiers & Gift Subscriptions (FR84–FR94)**

- FR84: Primary Parent can subscribe to the Standard tier at monthly or annual pricing with school-year aligned billing and automatic pause during school holidays.
- FR85: Primary Parent can subscribe to the Premium tier at monthly or annual pricing with school-year aligned billing and automatic pause during school holidays.
- FR86: Primary Parent can upgrade from Standard to Premium or downgrade from Premium to Standard at any time within a billing period.
- FR87: Primary Parent can cancel any subscription at any time with explicit confirmation.
- FR88: A third-party payer can purchase a gift subscription for a specified household at either tier with annual prepayment.
- FR89: A gift-subscription payer can optionally purchase Guest Heart Note authoring permission associated with that gift.
- FR90: System transitions beta-cohort households from free access to paid status at the end of the beta period with explicit upgrade confirmation UX and a 14-day first-charge refund window.
- FR91: System handles failed payment events (card expired, bank declined) with a defined grace period, parent notification, and service-continuity posture.
- FR92: System generates billing receipts or invoices accessible to the Primary Parent.
- FR93: Primary Parent can configure school-year start and end dates per household to align auto-pause with their actual school calendar.
- FR94: Gift purchaser can cancel a gift before redemption and receive a full refund.

**Ops, Support & Incident Response (FR95–FR104)**

- FR95: Ops personnel can view an allergy-safety anomaly dashboard with alert severity, household identifier (anonymized where permitted), incident status, and audit-log access.
- FR96: Ops personnel can view plan-generation latency, voice-cost-per-household, allergy-guardrail catch-rate, and Lunch Link delivery success-rate metrics in aggregate and per-household (anonymized) views.
- FR97: Ops personnel can escalate an allergy-safety incident through a defined SLA pathway (dashboard alert → on-call engineer → parental notification with transparency log).
- FR98: System maintains audit logs of allergy decisions, plan generations, Heart Note authorship and delivery, Visible Memory edits, billing changes, and account deletions for the regulatory-minimum retention period.
- FR99: Primary Parent can submit a support request or feedback message via a defined channel within the product.
- FR100: Ops personnel can respond to a Primary Parent support request with a bounded response SLA.
- FR101: Compliance Officer (or equivalent role) can export the audit log subset required for regulatory audit, subpoena, or parental data-request.
- FR102: System delivers in-product surveys to activated households at defined validation milestones — first-plan satisfaction (within 48 hours of first plan), cultural recognition (week 2 and week 3 for culturally-identified households), mid-beta willingness-to-pay (beta day 60), and post-launch satisfaction (30 days post-payment).
- FR103: Ops personnel can assign specific households into tier-variant experimental arms (e.g., beta month-5 Standard-only transition) for controlled A/B validation, with audit-logged cohort assignment.
- FR104: System monitors per-household voice cost and applies tier-appropriate soft-cap messaging above the 95th percentile for that tier; sustained abuse patterns trigger hard rate-limits.

**Cross-cutting / Account Preferences (FR105–FR106)**

- FR105: Primary Parent can configure notification preferences (when and how Lumi reaches out — weekly plan ready, grocery list ready, Heart Note window reminders).
- FR106: Primary Parent has their own user profile (display name, preferred language for cultural terms, communication preferences) distinct from household and child profiles.

### NonFunctional Requirements

**Performance (NFR-PERF)**

- NFR-PERF-1: Plan generation p95 first plan ≤90s from profile completion; subsequent plans ≤60s.
- NFR-PERF-2: Evening Check-in text first-token ≤500ms p95; turn-to-turn ≤1.5s.
- NFR-PERF-3: Evening Check-in voice (Premium) first-token ≤800ms p95; turn-to-turn ≤600ms.
- NFR-PERF-4: Lunch Link delivery ≥99.5% by 7:30am local on school days.
- NFR-PERF-5: Core Web Vitals p75 per surface — Public landing LCP <1.5s; Authenticated home LCP <2.0s; Lunch Link LCP <1.0s target / <1.2s SLO; Grocery mode LCP <1.5s; Evening Check-in LCP <2.0s. INP/CLS per PRD §10 table.
- NFR-PERF-6: Anchor device performance — Samsung Galaxy A13 on 4G must complete every Phase 1 flow within budget (UX Spec §13.8).

**Security (NFR-SEC)**

- NFR-SEC-1: Encryption at rest AES-256 + application-layer envelope encryption for Safety-Classified-Sensitive fields (allergens, Heart Note content, cultural identifiers, dietary preferences, caregiver relationships).
- NFR-SEC-2: TLS 1.3 only; HSTS enforced with preload.
- NFR-SEC-3: Supabase Auth with OAuth (Google, Apple) + email/password. Access tokens ≤15 minutes; refresh tokens ≤30 days with rotation on use; reuse → revoke-all.
- NFR-SEC-4: Four-role RBAC (Primary Parent, Secondary Caregiver, Guest Author, Ops) enforced at single Fastify preHandler.
- NFR-SEC-5: Strict CSP on all authenticated surfaces — no inline scripts, no eval, named allowlist. ElevenLabs is the only third-party origin for voice. COOP/COEP enabled.
- NFR-SEC-6: CSRF — SameSite=Lax cookies + double-submit-cookie token for cross-origin flows.
- NFR-SEC-7: Secret management — env-var-only; quarterly processor credential rotation; Supabase Vault for runtime secrets in staging+prod; .env.local for dev.
- NFR-SEC-8: Audit logs immutable append-only; cover allergy decisions, plan generations, Heart Note authorship/delivery, Visible Memory edits, billing, account deletions; ≥12 months retention.
- NFR-SEC-9: Vulnerability posture — dependency scanning every build; annual external pentest before public launch; quarterly internal security review.

**Privacy & Data Handling (NFR-PRIV)**

- NFR-PRIV-1: COPPA two-phase VPC — soft-VPC for beta + credit-card VPC at public launch.
- NFR-PRIV-2: Parental notice at signup; parental review dashboard operational from day 1; deletion-on-request honored within 30 days across all named processors.
- NFR-PRIV-3: California AADC posture — DPIA completed before public launch; most-protective settings by default; geolocation off by default; no dark patterns.
- NFR-PRIV-4: No third-party ad/analytics SDKs on any child-touching surface.
- NFR-PRIV-5: Data retention per PRD §10 table — voice transcripts 90d default; family profile active-account-lifetime; Heart Note delivered-and-deleted (no server archive beyond audit metadata); Lunch Link URL one-time-use, expires <48h after delivery; audit logs regulatory minimum (10y for billing/tax per architecture amendment H, 12mo+ for COPPA categories, 7y for safety-audit categories).
- NFR-PRIV-6: Data portability — auditable JSON export within 72 hours of request.
- NFR-PRIV-7: Processor DPA chain executed for ElevenLabs, SendGrid, Twilio, Supabase, Stripe, OpenAI/LLM provider, internal analytics.

**Scalability (NFR-SCAL)**

- NFR-SCAL-1: Beta capacity 150 concurrent active households with no degradation of any performance NFR.
- NFR-SCAL-2: Public-launch capacity 5,000 concurrent active households on Oct 1, 2026.
- NFR-SCAL-3: End-of-H1-2027 target 50,000 concurrent active households with linear cost scaling (no architectural rewrite).
- NFR-SCAL-4: School-morning peak 6:00–8:00am local across US timezones must not exceed any performance NFR. Provisioned for 3× baseline traffic during this window.
- NFR-SCAL-5: Plan-generation queue weekend batch (Friday PM through Sunday AM) completes within 36 hours for the entire active household base; no household waits more than 4 hours from generation window open.

**Accessibility (NFR-A11Y)**

- NFR-A11Y-1: WCAG 2.1/2.2 AA across all surfaces. Higher-bar carve-outs: WCAG 2.2 AAA for entire .child-scope; AAA contrast (7:1) and AAA error identification for safety-critical copy.
- NFR-A11Y-2: Readability CI check — Lunch Link copy ≤grade 4; parent-facing copy ≤grade 8. Build fails on violation.
- NFR-A11Y-3: TTS caption fallback — all voice output renders concurrent text captions; accessible via screen reader; not opt-in.
- NFR-A11Y-4: Keyboard navigation complete across all surfaces; visible focus indicator (2px foliage outline, 2px offset, 3:1 contrast).
- NFR-A11Y-5: Touch targets — 44×44 minimum (.app-scope/.ops-scope), 72×72 (.child-scope), 56×56 (.grandparent-scope).
- NFR-A11Y-6: Multilingual content rendering — Devanagari, Hebrew, Arabic RTL, Tamil, etc. correctly render in Heart Notes regardless of UI locale (content-layer, not UI-i18n).
- NFR-A11Y-7: Screen-reader testing — NVDA (Win), VoiceOver (macOS+iOS), TalkBack (Android) per release.

**Reliability & Availability (NFR-REL)**

- NFR-REL-1: API availability 99.9% during school hours (6am–9pm local per user TZ); 99.5% outside.
- NFR-REL-2: Voice pipeline availability 99.5% with graceful text fallback.
- NFR-REL-3: Data durability family profile 99.999%; child flavor profile 99.999%; Heart Note in-flight 99.999%.
- NFR-REL-4: Disaster recovery — RPO ≤1h for primary data; RTO ≤4h for critical path. Backups tested quarterly.
- NFR-REL-5: Vendor-failure fallback — voice degrades to text on ElevenLabs unavailability; email/SMS per-channel fallback within 30 min; LLM provider secondary-provider failover within 15 min.
- NFR-REL-6: Reconnect discipline — exponential backoff with jitter (1s × 2× ±20% jitter, max 60s) for SSE and ElevenLabs WS.

**Observability (NFR-OBS)**

- NFR-OBS-1: MVP-grade beta — Pino structured logging; HTTP 5xx alerts; SSE-disconnect counters; ElevenLabs WS error-rate alerts; on-call rotation via PagerDuty.
- NFR-OBS-2: Growth-grade public launch — SLO dashboards with error-budget accounting; multi-severity on-call (P1/P2/P3); synthetic monitoring for critical user paths.
- NFR-OBS-3: Product telemetry day-1 from beta — plan-generation p50/p95 latency; voice cost per HH per day; LLM cost per plan; allergy-guardrail catch rate; Lunch Link 7:30am success rate; Visible Memory panel visit rate; first-plan satisfaction completion rate.
- NFR-OBS-4: Incident-response SLA (allergy-safety anomaly) — dashboard alert ≤5 min of detection; on-call engineer engaged ≤15 min; parent notified ≤1h with transparency log; architectural review ≤24h; backported fix ≤72h.

**Integration (NFR-INT)**

- NFR-INT-1: ElevenLabs WS for STT/TTS; DPA with explicit child-voice clause (MVP: parent voice only); US-region; 90d retention cap.
- NFR-INT-2: SendGrid for email Lunch Link + Heart Note; DPA with child-surface analytics exclusion; 90d delivery-log retention.
- NFR-INT-3: Twilio for SMS + WhatsApp Lunch Link; DPA; no message-content retention beyond delivery.
- NFR-INT-4: Supabase Postgres + Auth + Storage; DPA; US-region primary; encryption at rest; audit-log retention configured.
- NFR-INT-5: Stripe billing — Standard + Premium tiers, gift subscriptions, school-year auto-pause; PCI-DSS Level 1 inherited; SAQ-A.
- NFR-INT-6: OpenAI/Anthropic LLM — zero data retention enforced via API; no training on household data; allergen decisions never routed through LLM judgment alone.
- NFR-INT-7: Internal analytics first-party only; no third-party SDKs on any surface; PII excluded.
- NFR-INT-8: API rate limiting — per-household quotas on plan-generation, Evening Check-in, Lunch Link delivery; voice usage soft-capped at 95th percentile per tier.

**Cost & Unit Economics (NFR-COST)**

- NFR-COST-1: Standard-tier voice cost ≤$1.00/HH/month.
- NFR-COST-2: Premium-tier voice cost ≤$4.00/HH/month at p95.
- NFR-COST-3: LLM cost per plan generation ≤$0.25.
- NFR-COST-4: CDN + infrastructure cost ≤$0.50/HH/month at beta scale; ≤$0.20/HH/month at 10,000+ HH.
- NFR-COST-5: Non-prod infrastructure envelopes (per architecture §5.7) — $0/mo dev; ~$25–32/mo staging fixed; ~$50/mo beta prod fixed; ~$140/mo launch prod fixed.

**Compliance (NFR-COMP)**

- NFR-COMP-1: COPPA (16 CFR Part 312) audit-ready at public launch. Compliance Officer assigned by August 2026.
- NFR-COMP-2: California AADC (AB 2273) DPIA completed before public launch.
- NFR-COMP-3: State-level minor privacy (CT, UT, TX, FL, VA) compliance changelog maintained; quarterly legislative monitoring.
- NFR-COMP-4: FDA FALCPA + FASTER Act allergen data model — top 9 declared allergens consistently tracked; additional parent-declared allergens supported.
- NFR-COMP-5: GDPR / UK Children's Code readiness deferred (USA-only MVP) but architectural choices (data minimization, right-to-delete, DPA discipline) do not foreclose extension.

### Additional Requirements

**From Architecture (technical/infrastructure requirements that affect implementation):**

- AR-1 (Bootstrap): Scaffold `apps/marketing` (Astro), `packages/ui` (shadcn copy-in target). Install all dependencies (Supabase, OpenAI Agents SDK + adapters, ElevenLabs client + server, Stripe, SendGrid, Twilio, ioredis + BullMQ, Fastify plugin family, test infra). Wire Fastify plugins. Zod env validation per app. Pino + OpenTelemetry skeleton. ESLint flat config with `eslint-plugin-boundaries` rules + scope-allowlist. Local dev workflow scripts (`supabase:start`, `seed:dev`, `dev`) in root `package.json`.
- AR-2 (LLMProvider adapter): `LLMProvider` interface in `apps/api/src/agents/providers/llm-provider.interface.ts` with OpenAI adapter + Anthropic stub. Domain orchestrator wraps SDK; SDK types confined to `agents/`. Provider failover circuit-breaker (default 5 failures in 60s → swap; 15 min recovery). Audit row event_type='llm.provider.failover' on swap.
- AR-3 (Allergy Guardrail Service): Standalone module `apps/api/src/modules/allergy-guardrail/` outside agent process boundary; sole authority on plan render-eligibility. Shared `allergy-rules.engine` between guardrail and `agents/tools/allergy.tools.ts`. Plans table carries `guardrail_cleared_at` and `guardrail_version`; presentation reads only `WHERE guardrail_cleared_at IS NOT NULL`.
- AR-4 (Tool-latency manifest): `apps/api/src/agents/tools.manifest.ts` declares `maxLatencyMs` per tool. CI lint blocks tools without declarations. Runtime p95 sampling per tool in Redis sliding window with Grafana alert when sampled p95 > declared × 1.5 for ≥1h.
- AR-5 (Single-row audit): `audit_log` table with single-row-per-action schema, `event_type` enum, `correlation_id`, `stages JSONB[]` for multi-stage events, composite index `(household_id, event_type, correlation_id, created_at)`, monthly partitions. All audit writes through `audit.service.write()`; lint forbids raw `audit_log` writes outside `audit/`.
- AR-6 (SSE InvalidationEvent contract): `packages/contracts/events.ts` Zod-discriminated union. Central client dispatcher in `apps/web/src/lib/sse.ts` routes events to `queryClient.invalidateQueries()` or `setQueryData()`. Single SSE channel per `(user_id, client_id-per-tab)` at `/v1/events`. Resume via `Last-Event-ID` from Redis event log (≥6h retention). Heartbeat every 20s.
- AR-7 (Brief state projection): Postgres projection table `brief_state` per household (Moment + Note + Thread + `memory_prose` snapshot). Maintained by application writer on `plan.updated`, `memory.updated`, `thread.turn`. Brief reads single-row by `household_id`. Pre-composed memory prose; never compose at view time.
- AR-8 (Single client-anomaly endpoint): `/v1/internal/client-anomaly` with Zod-discriminated payload `{ kind: 'error' | 'thread_integrity' | 'guardrail_mismatch' }`. Three backing tables. No user JWT, no HMAC; per-IP rate-limit (10 req/min/IP); CORS allowlisted to authenticated app origins only.
- AR-9 (Lunch Link signed URLs): HMAC-SHA256(child_id, date, nonce, exp=8pm_local) with daily-rotating key + 24h overlap. `lunch_link_sessions` table with `first_opened_at`, `rating_submitted_at`, `reopened_after_exp_count`. 60s grace window after exp. Sibling-device case: separate nonce per child-device-open.
- AR-10 (Envelope encryption): Per-household DEK wrapped by Supabase Vault KEK. Applied to `children.declared_allergens`, `children.cultural_identifiers`, `children.dietary_preferences`, `heart_notes.content`, `households.caregiver_relationships`. Audit-logged decryption endpoint for ops/eng access.
- AR-11 (Migration sequencing): Enum migrations precede first-table-using-them by ≥5000ms in timestamp. Sequential timestamps; one concept per migration; CI gate `supabase db diff` against history.
- AR-12 (Hosting + cost discipline): Fly.io API (region `iad` co-located with Supabase us-east; `dfw` standby for RTO); Cloudflare Pages for web + marketing; Supabase Pro for staging+prod (Vault required); Upstash Redis (Fixed prod, Free staging, local Docker dev). Staging Fly auto-stop with `min_machines_running=0`. Three envs (dev/staging/prod) with synthetic-data posture for staging.
- AR-13 (Idempotency): Mandatory `Idempotency-Key` header on all POST/PATCH/DELETE; 24h Redis replay cache keyed by `(user_id, endpoint, key)`. Missing → 400 `/errors/idempotency-required`. Same-key-different-body → 409 `/errors/idempotency-conflict`. Allowlist exemption only for auth endpoints.
- AR-14 (Webhook auth): HMAC-SHA256 signature header validation for ElevenLabs (`X-Elevenlabs-Signature`) and Stripe webhooks. No user JWT on `/v1/webhooks/*`.
- AR-15 (Voice path): Client SDK manages WS to ElevenLabs (client-side only); HiveKitchen never opens or holds the WS. API owns only `POST /v1/voice/token` and `POST /v1/webhooks/elevenlabs`. Synchronous webhook response when `sum(estimated tool latency) ≤ 6000ms`; early-ack `"one sec"` continuation when chain >6000ms; non-verbal SSE orb pulse for 1.5–4s estimated chains.
- AR-16 (RLS + JWT scoping): `household_id NOT NULL` on every relevant table; Postgres RLS policies enforced; `current_household_id` JWT claim set by auth preHandler. Defense-in-depth alongside service-layer scoping.
- AR-17 (Service Worker for Lunch Link): Minimal read-only SW scoped to `/lunch/*` route only. Caches last-known Heart Note + bag preview by child token; serves stale with `last synced HH:MM` stamp on fetch failure. Stale TTL 24h. Parent-app SW deferred per PRD.
- AR-18 (LunchLink delivery cron schedule per US timezone): Per-TZ trigger schedule for `jobs/lunch-link-delivery.job` (Important Gap from architecture validation; resolve in Plan-generation epic).
- AR-19 (School-year + holiday calendar source for billing auto-pause): Calendar source for FR84/FR85/FR93 — parent-declared per FR93; data shape and validation rules to be specified in Billing epic.
- AR-20 (Multilingual font fallbacks): Font stack for Devanagari/Hebrew/Arabic-RTL/Tamil — Noto Sans per-script via `unicode-range` vs system-font fallback decision, lands in Heart Note epic.
- AR-21 (State-level minor-privacy patchwork architectural surface): `state_compliance_overrides` table or per-state policy enum on `households` for CT/UT/TX/FL/VA deltas beyond COPPA/AADC baseline, lands in Compliance epic.
- AR-22 (Data-portability export format): JSON schema for FR71 export; encryption-decryption-to-parent semantics; lands in Compliance epic.

### UX Design Requirements

**Design System Foundation**

- UX-DR1: Migrate token system v1.0 → v2.0 in `packages/design-system/tokens/` with: `--sacred-plum` (Heart Note exclusive), `--lumi-terracotta` and `--lumi-terracotta-warmed` (Lumi proposal exclusive), `--safety-cleared-teal` (allergy-cleared exclusive — never destructive-red), `--memory-provenance-*` (Visible Memory chips), `--honey-amber` (recognition moments only — not button hover), `--foliage-*` (focus indicator + freshness), `--warm-neutral-*` (base palette).
- UX-DR2: Typography system — Instrument Serif (headlines, Heart Notes, cultural recognition); Inter (body); Heart Note display type at 26pt+ per scope; pre-reader Lunch Link body at 18–20pt; grandparent body 18pt+ single column 45–55 char line length 1.6+ line-height; multilingual font fallback strategy (UX-DR20).
- UX-DR3: Spacing & layout discipline — 8pt grid, no compression below 16pt between adjacent content groups; remove default Shadcn Card shadow (border + surface-50 only); no global notification tray (banned `useToast`); no badge counts (banned in Shadcn allowlist).
- UX-DR4: Iconography — outline-only, rounded corners, consistent stroke width.
- UX-DR5: Contrast audit — `packages/design-system/contrast-audit.test.ts` verifies every token pair: AAA 7:1 for body text on dark+light modes; AA 3:1 for non-text UI (borders, icons, focus); 4.5:1 minimum for trust chips on both modes.

**Foundation Gate (Phase 0 — blocks Phase 1 components)**

- UX-DR6: Gate 1 — Thread ordering & resync contract. `packages/contracts/thread.ts` with `Turn.server_seq` (bigint, monotonic, authoritative ordering), `TurnBody` discriminated union (message/plan_diff/proposal/system_event/presence), `InvalidationEvent` extension `thread.resync` with `from_seq`.
- UX-DR7: Gate 2 — Guardrail coupling (Option A inline verdict). `packages/contracts/plan.ts` with `PlanUpdatedEvent` carrying `guardrail_verdict: AllergyVerdict` inline. Plan write held until guardrail resolves (target <800ms p95).
- UX-DR8: Gate 3 — Forget contract (soft-only Phase 1). `packages/contracts/memory.ts` with `ForgetRequest` (mode='soft' only Phase 1), `ForgetCompletedEvent`. Hard-forget Phase 2+ blocked on legal review.
- UX-DR9: Gate 4 — Presence event with generic surface addressing. `packages/contracts/presence.ts` with `PresenceEvent` and `SurfaceKind` enum (brief/plan_tile/lunch_link/heart_note_composer/thread/memory_node). TTL `expires_at` field.
- UX-DR10: Error contract — `packages/contracts/errors.ts` with `ErrorCode` enum (VALIDATION_FAILED, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, RATE_LIMITED, AGENT_UNAVAILABLE, GUARDRAIL_BLOCKED, CULTURAL_INTERSECTION_EMPTY, SCOPE_FORBIDDEN), `FieldError`, `ApiError` shape with `trace_id`. All Phase 0 gates use this shape.
- UX-DR11: TanStack Query provider + SSE bridge in `apps/web/src/lib/realtime/`, unit-tested with fake SSE feed.
- UX-DR12: ESLint scope-variant rule `no-cross-scope-component` in `packages/eslint-config-hivekitchen`. Forbids imports of scope-locked components into wrong scope's route tree.
- UX-DR13: Scope charter at `packages/design-system/SCOPE_CHARTER.md` — canonical spec for what renders where (.app/.child/.grandparent/.ops with allowed/forbidden components and voice register).
- UX-DR14: Scope enforcement — three layers: (a) route-level scope class on `<html>`; (b) ESLint rule UX-DR12; (c) dev-mode runtime assertion on each scope-locked component checking `document.documentElement.className` on mount.

**Phase 1 Custom Components (12 primary + 4 cross-cutting)**

- UX-DR15: `<BriefCanvas>` — Ready-Answer Open landing; MomentHeadline (Instrument Serif 32pt) + LumiNote (Inter 17pt terracotta indent) + 5× PlanTile + freshness strip; states fresh/stale/loading/failed; `.app-scope` only.
- UX-DR16: `<MomentHeadline>` — `<h1>` Instrument Serif 32pt warm-neutral-900; states default/emphasized/forecast-caveat; `aria-live=polite` for auto-updates.
- UX-DR17: `<LumiNote>` — Inter 17pt terracotta left-indent; states default/cultural-recognition (sacred-plum italic)/uncertainty (foliage italic); never >2 sentences, never names Lumi in third person, no exclamation marks.
- UX-DR18: `<PlanTile>` — day card with day header + dish line (Inter 19pt semibold) + method caption + optional `<TrustChip>` row; states decided/pending-input (dotted honey-accent border)/swap-in-progress (optimistic + spinner)/locked (PresenceIndicator inline)/mutability-frozen; variants today/upcoming/past; `<article>` with labelled actions.
- UX-DR19: `<QuietDiff>` — inline rear-view banner above Brief, Inter 14pt warm-neutral-600 low contrast, `⋯` for "why?"; states hidden/quiet (scaffolding change)/loud (escalates to AccountableError or system-role ThreadTurn). Never renders allergy/dietary mutations.
- UX-DR20: `<ThreadTurn>` polymorphic envelope — dispatches on `turn.body.kind` to TurnMessage/TurnPlanDiff/TurnProposal/TurnSystemEvent/TurnPresence body components. ThreadTurnChrome provides role-colored indent, timestamp, author. States envelope-level: incoming (fade-in)/settled/rolled-back (strikethrough)/redacted ("Lumi won't use this anymore"). Strict `server_seq` ordering; refetch from `from_seq` on `thread.resync`.
- UX-DR21: `<DisambiguationPicker>` — L1→L4 promotion ladder. States l1 (binary pills under tile)/l2 (N-way pills)/l3 (inline conversational input)/l4 (tile pending-input + thread continuation). L3→L4 bidirectional tether: source PlanTile pulses sacred-plum 30% alpha at 1.6s breath loop with thread breadcrumb pinned at thread top. On thread resolution, breadcrumb converts to QuietDiff-style settled summary, focus returns to tile. Never asks permission. Reduced-motion fallback: static plum dot.
- UX-DR22: `<HeartNoteComposer>` — `.grandparent-scope` only. Textarea Instrument Serif 26pt + cap counter + send affordance ("Tuck into Ayaan's Thursday lunch" not "Send"). States empty/writing/at-soft-cap (counter warms to honey-amber)/at-hard-cap (full-render with rhythm copy "Ayaan has both of your notes this month, Nani. The next one opens May 1." + textarea read-only + "Save for May 1" affordance schedules against next month's first Lunch Link)/sent/scheduled. Cultural recognition: family-language word (Nani/Dadi/Lola/Bibi) gets sacred-plum underline. Dev-mode assertion if rendered outside `.grandparent-scope`.
- UX-DR23: `<LunchLinkPage>` — `.child-scope` locked. Heart Note (Instrument Serif 28pt sacred-plum on warm-neutral-50, unmodified delivery) + food photo (4:5 aspect-ratio, 16px round-corner) + emoji row (3-tap response: 🧡 / 🤔 / 😋, 72×72 minimum) + "Tell [parent] back" voice affordance. Heart Note as `<blockquote>`; word-optional grammar.
- UX-DR24: `<AllergyClearedBadge>` — affirmative trust pill with safety-cleared-teal fill 8% alpha + teal checkmark 12px + text "Cleared for [Name]'s [allergen]" Inter 13pt medium. Tap → Popover with copy "We checked every ingredient against [Name]'s [allergen] allergy. Nothing in today's lunch contains [allergen] or was made near them." + "View audit" link to thread audit trail. States cleared/re-checking (foliage soft pulse)/blocked (replaced by `<AccountableError>`, not changed in place). Never renders without fresh guardrail verdict.
- UX-DR25: `<VisibleMemorySentence>` — sentence (Inter 16pt warm-neutral-800) + always-visible `⋯` affordance (not hover-only). States default/first-time (`⋯` pulses honey-amber once for 4s with one-time helper "Tap ⋯ to see where this came from or ask Lumi to forget it" — dismissed after first interaction or 4s)/forgotten ("Lumi won't use this anymore — [reason]")/provenance-shown (Popover shows source turn + confidence + last-used). Forget affordance triggers soft-forget; sentence updates within 300ms; `forget.completed` SSE event acknowledged.
- UX-DR26: `<PresenceIndicator>` — Figma-style "someone else is here" single-line affordance. 20px avatar + name + state ("viewing"/"editing") in Inter 13pt warm-neutral-600; positioned top-right of addressed surface. Receives `surface: { kind: SurfaceKind; id: string }` prop; subscribes to matching `presence.updated` events. States solo (hidden)/one-other-viewing/one-other-editing/multi-other ("2 others")/stale (fades on TTL expiry). Never blocks interaction; never says "locked by [Name]". `aria-live=polite` on state change.
- UX-DR27: `<FlavorPassport>` — sparse-page pattern. Vertical timeline with stamp cards (dish name + date + method caption + optional child voice quote). No empty slots, no "coming soon" placeholders. States empty (first 4 weeks: header only "Ayaan's taste is still forming. Lumi will notice and add it here.")/developing (1-8 stamps chronological)/established (9+ stamps with cuisine/texture/method filter). Variants `.app-scope` (parent view) and `.child-scope` (child's "my tastes" — reordered, read-aloud-ready). Timeline as ordered list; child-scope fully image+voice usable.

**Cross-Cutting Primitives (Phase 1)**

- UX-DR28: `<FreshnessState>` — single-line honest state Inter 13pt warm-neutral-500. Variants fresh (hidden)/stale ("Checking… last synced 4h ago")/offline ("You're offline. Yesterday's plan below.")/failed ("Lumi couldn't reach the plan right now. Trying again in 30s."). Never replaces surface; annotates it.
- UX-DR29: `<PackerOfTheDay>` — names which parent is packing tomorrow's lunch. "Tomorrow — Priya's packing" + `<PresenceIndicator>` if currently on Brief. Variants assigned/open ("Nobody's claimed tomorrow yet")/handoff-in-progress.
- UX-DR30: `<AccountableError>` — honest-error presentation. What happened (1 sentence) + What system is doing (1 sentence) + What user can do (optional primary action). Never "Something went wrong." Never "Oops." Example: "Lumi couldn't reach the pantry service. We're retrying for the next 30 seconds. You can refresh now if you'd rather not wait."
- UX-DR31: `<TrustChip>` — affirmative pill-chip with variant tinting. Variants cultural-template (sacred-plum)/allergy-cleared (safety-cleared-teal)/pantry-fresh (foliage)/memory-provenance (warm-neutral)/lumi-proposed (lumi-terracotta). Always checkmark-first or leaf-first, never cross-based. Low-saturation fills; text in neutral-900.
- UX-DR32: `<MobileNavAnchor>` — minimal single-row persistent anchor on mobile Brief/Thread/Memory only, showing the other two anchors as compact tap targets. Renders `<brief-row` (mobile only); invisible at `>=brief-row`. Load-bearing for first-time mobile users.

**Component Inventory Bans (Shadcn defaults NOT shipped)**

- UX-DR33: Banned components — `Toast`, `Sonner` (replaced by inline at-point feedback per UX-DR3); default `Badge` count variant (repurposed as TrustChip only); `Carousel` (contradicts presentational silence); `NavigationMenu` mega-menu (no nav tree); `Pagination` UI (thread uses virtualized infinite scroll); `AlertDialog` (reserved exclusively for genuine destructive operations like account deletion). `Dialog` allowlist: safety-block explainer, command palette, hard-forget confirmation (Phase 2+), auth re-entry. ESLint `no-dialog-outside-allowlist` rule.

**Navigation Model (locked)**

- UX-DR34: Anchor surfaces (parent scope) — Brief `/`, Thread `/thread`, Memory `/memory`. No top bar menu (avatar cluster top-right 32px); no bottom tab bar on mobile (replaced by `<MobileNavAnchor>` UX-DR32); no breadcrumbs (single "← Brief" affordance from contextual surfaces). Reserved fourth anchor "People" `/people` for Phase 2+. Contextual surfaces: Plan detail `/plan/:weekId`, Settings `/settings`. Scope entries: `/lunch/:token` (.child-scope), `/heart-note` (.grandparent-scope), `/admin` (.ops-scope). Cross-scope intentional exception: `/invite/:token` resolves role at redemption then redirects to appropriate scope.
- UX-DR35: Command palette `⌘K` Shadcn `Command`. `packages/contracts/palette.ts` `PaletteCommand` schema with `scope_requirement` enum. Route-level scope context → palette filters commands client-side → API re-authorizes on execution (defense-in-depth). Never trust client filter. Palette not mounted in `.child-scope`/`.grandparent-scope`.
- UX-DR36: Keyboard shortcuts — `⌘K` palette; `G B/T/M` go-to anchors; `Esc` back to Brief; `?` shortcut cheatsheet.

**Modal & Overlay Policy (allowlist-only)**

- UX-DR37: Modal allowlist — Safety-block explainer (`<Dialog>` on guardrail blocked), Command palette (`<Command>` on ⌘K), Hard-forget confirmation (Phase 2+ destructive), Auth re-entry (Supabase session genuinely expired). Removed: scope-entry confirmation (replaced by inline `<LumiNote>` variant pinned to Brief on first entry, dismissable). Banned: confirmation modals, feature announcements, nags, session-timeout modals (degrade to `<FreshnessState variant=stale>`).
- UX-DR38: Overlay z-index hierarchy — Dialog z-50 (warm-neutral-900/60 scrim) → Sheet z-40 → Popover/HoverCard z-30 → Tooltip z-20.

**Empty State Grammar**

- UX-DR39: Empty states render only real content + one honest sentence of what-happens-next. Never placeholder grids, illustrated characters, or "Coming soon." Specifications: Flavor Passport (0 stamps) → "Ayaan's taste is still forming. Lumi will notice and add it here." Visible Memory (0 nodes, week 1) → "Lumi is still learning about your family. Memory will show up here as patterns appear." Thread (0 turns, first session) → renders nothing above composer. Memory search (no results) → "Nothing matches '[query]'. Try a person's name, a meal, or a week." Lunch Link history (0 sent) → "No Heart Notes yet. You can tuck one into any upcoming lunch from the Brief." PlanTile list (plan not yet generated) → full-surface `<FreshnessState variant=pending>` "Lumi is drafting this week's plan. About 30 seconds." Observational, not imperative.

**Search & Filtering**

- UX-DR40: Memory search ranking — Postgres `tsvector` + `ts_rank_cd`; recency decay computed server-side: `score = bm25 * 0.5^(age_days / 14) * confidence`. `packages/contracts/memory-search.ts` request/response schemas. Tokens honored: person names, dish names (fuzzy), relative time, cultural templates, allergen names. Tokens rejected: internal IDs, SQL, regex. Memory-surface-only; `⌘K /memory <query>` jumps in pre-applied. `score_breakdown` returned with every hit (auditable).

**Feedback Patterns**

- UX-DR41: Feedback pattern matrix per situation: ephemeral safe-reversible action → Toast (`Sonner` allowed for this case only); silent scaffolding mutation → `<QuietDiff>`; optimistic rolled back → in-place inline replacement note; safety-critical block → `<AccountableError>` or modal escalation; async background completion → SSE-invalidated surface update (no dedicated feedback); network/service failure → `<FreshnessState>` or `<AccountableError>`; Lumi-initiated proposal applied → `AccountableFeedback` with `undo_token` valid 4h. `packages/contracts/feedback.ts` `AccountableFeedback` schema.

**Cultural Recognition (inverted: inference, not selection)**

- UX-DR42: Cultural priors as internal-only model. `packages/contracts/cultural.ts` with `Tier` (L1/L2/L3), `TemplateState` (detected/suggested/opt_in_confirmed/active/dormant/forgotten), `CulturalPrior` shape (presence 0-100 NOT zero-sum, opt_in/opt_out timestamps, last_signal_at), `HouseholdProfile` (active_priors[] + interfaith_mode {enabled, mode: 'honor_all'|'alternating_sovereignty'} + cultural_calendar.observances[]). `TemplateStateChangedEvent` SSE event.
- UX-DR43: Recognition Tier Ladder (L0–L3): L0 preference memory (relational, no opt-in, never culturally coded — "Maya doesn't eat bell peppers"); L1 method/ingredient (no opt-in, inferred from accepted plans); L2 meal-pattern (requires opt_in_confirmed AND user-used-name-first); L3 family-language/relational (requires active state AND linked memory-node citation, sacred-plum tint on family-language word, tap reveals provenance). Fall-back metadata in `CulturalProposalBody` with `intended_tier`/`rendered_tier`/`fallback_reason`; subtle `⋯` "Why this pick?" affordance when rendered<intended.
- UX-DR44: Ratification surface — no template-picker UI. Only user-visible cultural affordance is ratification turn in Thread originated by Lumi when prior reaches `suggested` state. Three actions: [Yes, keep it in mind] [Not quite — tell Lumi more] [Not for us]. Taps translate to `TemplateStateChangedEvent` transitions. No settings surface, no composition slider, no weight bar.
- UX-DR45: Cultural recognition guardrails — opt-in gate (L2/L3 require opt_in_confirmed/active); provenance gate (L3 requires linked memory node, fallback one tier if absent); confidence gate (below threshold → fall back); language-discovered gate (L2 requires user-used-pattern-name-first). Banned patterns: flag emojis next to prior names, "Celebrating [holiday]!" messaging, theme-swapping ("Diwali mode"), stereotype collocations, heritage-month surfacing, diaspora-flattening (no "South Asian" — Sylheti≠Punjabi), authenticity policing, cross-household benchmarking, unprompted festival menu injection. ESLint detects static literals + runtime `<CulturalBadge>` strips flag codepoints from interpolated strings.
- UX-DR46: Silence-mode (default) — household with zero ratified priors (Phase 1 day-1 default for every household). Flavor Passport sparse-page no cultural-prior surfaces; Brief header no Celebrating-X strip; Lumi opening line never references cultural context unprompted; ops-scope cultural-prior reads "withheld by household" not "none". L0 preference memory still active.
- UX-DR47: Family-language ratchet — household-scoped on first-person surfaces, preserved-as-authored on provenance surfaces. Forward only; once a household uses "Nani", Lumi never retreats to "Grandma".
- UX-DR48: Interfaith-mode copy — "Honor all rules in every meal." (replacing "Stricter: only propose meals respecting all rules"). When `honor_all` collapses to near-empty intersection, second option "Alternate whose rules lead each day." enables `alternating_sovereignty`.
- UX-DR49: Degraded-propose state — when `honor_all` intersection empty, agent returns `PlanUpdatedEvent` with `guardrail_verdict.status='degraded'`, `reason='CULTURAL_INTERSECTION_EMPTY'`, `priors_considered`, `suggestion='try_alternating_sovereignty'`. UI surfaces inline note on Brief with one-tap toggle to switch modes.

**Voice & Copy Register**

- UX-DR50: Voice & copy register — Instrument Serif for headlines/Heart Notes/cultural-recognition; Inter for everything else; no exclamation marks anywhere; contractions allowed; second person addressing user; third person for Lumi in descriptive surfaces, first person inside thread turns; family-language preserved per UX-DR47; no em-dashes in product copy (commas or sentence splits).

**Button & Form Patterns**

- UX-DR51: Button taxonomy — five variants: primary (warm-neutral-900 fill / one per surface / specific verb+object), secondary (warm-neutral-200 fill / alternate), tertiary (no fill underline / escape hatches), proposal (lumi-terracotta border / Lumi-initiated only / warmed-terracotta hover NOT honey-amber / dev-mode render-guard to Lumi-authored surfaces), destructive (warm-neutral-700 outline / soft-forget/handoff-reclaim/scope-exit / never safety-red). Banned: ghost buttons that look like text, icon-only without aria-label and ≥44px tap target, "OK"/"Cancel"/"Confirm"/"Yes"/"No" copy, red buttons for non-safety, proposal variant outside Lumi-authored surface.
- UX-DR52: Form & validation grammar — Shadcn `Form` + react-hook-form + Zod schemas from `packages/contracts`. Validation voice: never "Invalid input" / "This field is required" / "Please enter a valid…". Pattern: name the constraint + what would satisfy it in one sentence. On-blur for single-field, on-submit for cross-field, never on-change. Inline helpers (Inter 13pt warm-neutral-500) for non-obvious fields.

**Responsive & Accessibility**

- UX-DR53: Device target matrix — Desktop/laptop (.app/.ops, ≥1280px); Tablet (all parent scopes, 768–1279px); Phone (all parent scopes, 360–767px); Low-end Android perf floor — Samsung Galaxy A13 on 4G as anchor device.
- UX-DR54: Breakpoint strategy — Tailwind defaults + named semantic breakpoints in `tailwind.config.ts`: `brief-stacked` (`max:767px`), `brief-row` (`min:768px`), `thread-sidecar` (`min:1280px`), `ops-table-dense` (`min:1024px`). Mobile-first authoring.
- UX-DR55: Scope-variant responsive rules — `.app-scope` full responsive; `.child-scope` single-column always with +2pt text scale and 4:5 image aspect ratio locked and 72px emoji row at all sizes; `.grandparent-scope` single-column always with +2pt text scale and reduced visual density and optional large-text toggle (+2pt step); `.ops-scope` desktop-required (renders single-line redirect on `<md`).
- UX-DR56: Reduced-motion fallbacks — plum-pulse → static plum dot; honey-amber `⋯` first-time reveal → static honey-amber + helper text no pulse; SSE incoming turn fade-in → instant render; `<FreshnessState>` foliage soft-pulse → static foliage chip; scope-entry teaching reveal → instant render. Critical rule: no information conveyed by motion alone.
- UX-DR57: Reduced-transparency — all scrims/blurs/glass effects drop to solid warm-neutral backgrounds; Dialog backdrop warm-neutral-900/100 solid.
- UX-DR58: Voice accessibility contract — every voice turn has synchronized transcript (transcript is authoritative for screen readers/search/audit); voice turns keyboard-operable (Space play/pause, arrows scrub, Esc cancel); `aria-live=polite` announces transcripts; Voice-off/Text-only toggle disables TTS without degrading thread; honest-error on low-confidence STT ("Lumi didn't catch that clearly — could you type it or try again?").
- UX-DR59: Internationalization — Phase 1: English (US) only UI chrome + Lumi copy; family-language preserved per UX-DR47; Unicode-safe everywhere; RTL-safe layout primitives (logical CSS `margin-inline-start` not `margin-left`; `dir="auto"` on user-authored text nodes). Phase 2: Arabic+Urdu UI with full RTL.
- UX-DR60: Perf budgets at anchor device — Ready-Answer Open ≤1.2s FMP (hard ceiling 2.0s); SSE invalidation→update ≤600ms (hard 1.0s); Optimistic mutation ≤100ms (hard 200ms); Guardrail verdict coupled with plan.updated ≤800ms p95 (hard 1.5s — degrade to Option B with FreshnessState chip); Heart Note → Lunch Link delivery ≤2.0s (hard 4.0s); Memory search ≤500ms (hard 1.0s).
- UX-DR61: Bundle budgets — JavaScript ≤300KB gzipped initial app-scope load; route-split contextual surfaces; PlanTile photos ≤60KB at mobile sizes; aggregate font weight ≤200KB across all weights+scripts; lazy-load Settings/Admin/Flavor Passport; voice chunk lazy-loaded on first voice-overlay open.
- UX-DR62: Testing automation per PR — axe-core via Playwright on every route every scope (zero violations at AA, zero on AAA for `.child-scope`); Lighthouse CI at anchor device class (perf+a11y+best-practices ≥95); contrast audit (UX-DR5); visual regression (Phase 2+ Chromatic; beta uses committed Playwright screenshots in `packages/ui`); screen-reader semantic snapshot.
- UX-DR63: Accessibility lint — `eslint-plugin-jsx-a11y` strict config in `packages/eslint-config-hivekitchen`; logical-property lint rule forbids `margin-left/right`, `padding-left/right` in favor of logical equivalents; `useReducedMotion()` and `useReducedTransparency()` hooks in `apps/web/src/lib/a11y/`.

**Onboarding-as-Conversation**

- UX-DR64: Onboarding voice interview — three signal questions ("What did your grandmother cook?" / "What's a Friday in your house?" / "What does your child refuse?"). Voice-first with text always available; <10 minutes to first plan; first plan ships within 90 seconds of profile completion; "competent and honest about its blanks" copy posture (no day-1 omniscience pretense).
- UX-DR65: Onboarding mental-model copy — last step carries two short sentences, said once each: "The plan is always ready. Change anything, anytime. You don't need to approve it." and "Changes save as you go. No button needed." Never repeated. No coachmarks, no tooltips.
- UX-DR66: Anxiety-leakage telemetry escalation — if week-1–2 telemetry shows repeated retries of the same edit, render a ghost timestamp "saved just now" under the tile for 3 seconds after edit, then fade. On-demand from evidence, not shipped by default.

### FR Coverage Map

| FR | Epic | Note |
|---|---|---|
| FR1 | Epic 2 | Household account creation |
| FR2 | Epic 2 | Voice-based onboarding interview |
| FR3 | Epic 2 | Text-based equivalent onboarding |
| FR4 | Epic 2 | Decline-voice-receives-identical-capabilities |
| FR5 | Epic 2 | Add child with allergies + policies + palate |
| FR6 | Epic 2 | Cultural template selection (composable) |
| FR7 | Epic 2 | Inferred starter template + parental confirm |
| FR8 | Epic 2 | Beta soft-VPC signed consent |
| FR9 | Epic 10 | Credit-card VPC at subscription signup (public-launch) |
| FR10 | Epic 2 | Secondary Caregiver invite (scoped, no separate account) |
| FR11 | Epic 2 | Manage own account profile separately from household |
| FR12 | Epic 2 | Account access recovery |
| FR13 | Epic 8 | Redeem gifted subscription |
| FR14 | Epic 2 | Parental notice disclosure at signup |
| FR15 | Epic 3 | Generate weekly plan from profile + slots + pantry + culture |
| FR16 | Epic 3 | View current week's plan (Brief) |
| FR17 | Epic 3 | View individual day's plan with prep |
| FR18 | Epic 3 | Edit any day's slot independently |
| FR19 | Epic 3 | System adjusts on policy/leftover/calendar changes |
| FR20 | Epic 3 | Pause Lunch Link for child on day without altering plan |
| FR21 | Epic 3 | View following week's draft Friday afternoon |
| FR22 | Epic 3 | Update school-policy constraints; propagate |
| FR23 | Epic 3 | Request regeneration of week or day |
| FR24 | Epic 3 | Graceful-degradation when no safe plan possible |
| FR25 | Epic 3 | View historical plans + outcomes |
| FR26 | Epic 3 | Cultural-calendar awareness in plan generation |
| FR27 | Epic 5 | Designate packer-of-the-day |
| FR28 | Epic 5 | Shared household thread messages |
| FR29 | Epic 5 | Use thread context to enrich profile/plans |
| FR30 | Epic 5 | Revoke Secondary Caregiver access |
| FR31 | Epic 5 | Transfer primary household ownership |
| FR32 | Epic 4 | Compose Heart Note by text |
| FR33 | Epic 4 | Compose Heart Note by voice (any tier) |
| FR34 | Epic 4 | Deliver Lunch Link via parent channel before lunchtime |
| FR35 | Epic 4 | Child views Lunch Link no-install |
| FR36 | Epic 4 | Two-layer rating (4-emoji + per-item swipe) |
| FR37 | Epic 4 | Child views flavor passport |
| FR38 | Epic 4 | Heart Note delivered exactly as authored |
| FR39 | Epic 4 | No feedback/learning references in Heart Note |
| FR40 | Epic 8 | Grandparent Guest Author rate-limited permission grant |
| FR41 | Epic 4 | Premium voice playback of Heart Note (Premium-gated) |
| FR42 | Epic 4 | Child request-a-lunch text suggestion + parent approval |
| FR43 | Epic 4 | No notifications/streaks/absence-reminders for Heart Note |
| FR44 | Epic 4 | Compose Heart Note in advance with scheduled delivery |
| FR45 | Epic 4 | Edit/cancel Heart Note before delivery window |
| FR46 | Epic 4 | View delivery status of every Heart Note |
| FR47 | Epic 4 | No child voice capture in MVP |
| FR48 | Epic 6 | Derive shopping list from plan + inferred pantry |
| FR49 | Epic 6 | Store-mode shopping list (one-handed, aisle-aware) |
| FR50 | Epic 6 | Cultural-supplier directory routing (multi-store) |
| FR51 | Epic 6 | Mark items purchased; silent pantry-state update |
| FR52 | Epic 6 | Leftover-aware swap proposals on surplus/expiring |
| FR53 | Epic 6 | Connectivity-loss store-mode degradation |
| FR54 | Epic 6 | Add non-plan items to shopping list |
| FR55 | Epic 6 | Correct inferred pantry state |
| FR56 | Epic 5 | Unlimited text-based conversation any tier |
| FR57 | Epic 5 | Premium unlimited tap-to-talk voice |
| FR58 | Epic 5 | Standard 10min/week voice cap |
| FR59 | Epic 5 | Passive profile-enrichment from conversation |
| FR60 | Epic 5 | Concurrent text captions for voice output |
| FR61 | Epic 5 | Adaptive Lumi conversational length/tone |
| FR62 | Epic 5 | Periodic "I noticed" learning moments with confirm/correct |
| FR63 | Epic 5 | Parent-initiated Evening Check-in (Lumi never proactive) |
| FR64 | Epic 5 | Plan-reasoning explanations |
| FR65 | Epic 7 | View every learned data point about household and child |
| FR66 | Epic 7 | Edit any learned data point with reconciliation |
| FR67 | Epic 7 | Delete any specific learned data point |
| FR68 | Epic 7 | Reset flavor journey (annual, child-artifact purge) |
| FR69 | Epic 7 | Account deletion with 30-day processor erasure |
| FR70 | Epic 7 | Parental review dashboard |
| FR71 | Epic 7 | Auditable JSON data export |
| FR72 | Epic 7 | Consent history view |
| FR73 | Epic 7 | Memory-node provenance metadata |
| FR74 | Epic 6 | Geolocation opt-in (household-level only, for cultural-supplier) |
| FR75 | Epic 7 | Voice transcript retention controls |
| FR76 | Epic 3 | Independent rule-based allergy guardrail (authoritative) |
| FR77 | Epic 3 | Presentation-bind contract (no pre-guardrail render) |
| FR78 | Epic 3 | Allergy-guardrail decision audit log |
| FR79 | Epic 3 | Explicit parent confirmation on allergy-relevant plan changes |
| FR80 | Epic 4 | Allergy transparency log exportable to parent on request |
| FR81 | Epic 3 | Allergy-uncertainty flagging + safe substitute or surface |
| FR82 | Epic 3 | Hard-fail escalation to ops + parent |
| FR83 | Epic 9 | Standing household allergy-safety audit dashboard |
| FR84 | Epic 8 | Standard tier subscription school-year-aligned |
| FR85 | Epic 8 | Premium tier subscription school-year-aligned |
| FR86 | Epic 8 | Upgrade/downgrade within billing period |
| FR87 | Epic 8 | Cancel subscription with explicit confirmation |
| FR88 | Epic 8 | Gift subscription purchase (third-party payer, annual) |
| FR89 | Epic 8 | Gift Heart Note authoring add-on purchase |
| FR90 | Epic 10 | Beta-to-paid transition with 14-day refund |
| FR91 | Epic 8 | Failed-payment grace + notification + service-continuity |
| FR92 | Epic 8 | Billing receipts/invoices |
| FR93 | Epic 8 | Configure school-year start/end dates per household |
| FR94 | Epic 8 | Gift cancellation before redemption (full refund) |
| FR95 | Epic 9 | Allergy-safety anomaly dashboard |
| FR96 | Epic 9 | Plan-gen latency, voice cost, guardrail catch-rate, Lunch Link delivery metrics |
| FR97 | Epic 9 | Allergy-safety incident SLA escalation pathway |
| FR98 | Epic 9 | Audit logs for allergy/plan-gen/Heart Note/Visible Memory/billing/account |
| FR99 | Epic 9 | Parent support request channel |
| FR100 | Epic 9 | Ops support response with bounded SLA |
| FR101 | Epic 9 | Compliance Officer audit-log subset export |
| FR102 | Epic 10 | In-product surveys at validation milestones |
| FR103 | Epic 10 | Tier-variant cohort assignment (A/B) |
| FR104 | Epic 10 | Voice-cost soft-cap monitoring with messaging |
| FR105 | Epic 2 | Notification preferences |
| FR106 | Epic 2 | User profile (display name, language, comm prefs) distinct from household/child |
| FR107 | Epic 2 | Lunch Bag slot-active declaration during onboarding |
| FR108 | Epic 3 | Modify bag composition (Snack/Extra on/off) post-onboarding |
| FR109 | Epic 3 | Generate content for every active slot per child per school day |
| FR110 | Epic 3 | Snack as distinct shopping-list section + store-mode group |
| FR111 | Epic 3 | Snack item-level SKU modeling vs Main recipe modeling |
| FR112 | Epic 3 | School-policy per-slot scoping |
| FR113 | Epic 3 | Allergy bag-wide rule (no per-slot scoping) |
| FR114 | Epic 3 | Pin component type to Extra slot per child |
| FR115 | Epic 3 | Ban specific component types from Extra candidates per child |
| FR116 | Epic 3 | Passive bias from repeated Extra removal |
| FR117 | Epic 3 | Save parent-authored Extra item as reusable entry |
| FR118 | Epic 3 | Day-level context overrides (sick/half-day/field-trip/etc.) |
| FR119 | Epic 3 | Propose Extra item on high-activity days for normally-off-Extra children |
| FR120 | Epic 4 | Lunch Link renders bag components beneath Heart Note + Layer 2 swipe |
| FR121 | Epic 4 | Rating window opens on first view/lunchtime, closes 8pm local |
| FR122 | Epic 4 | One-time-use session URI per (child, day) |
| FR123 | Epic 4 | Sibling-device case: separate URIs per child-device-open |
| FR124 | Epic 4 | Layer 2 per-slot signals weighted independently |
| FR125 | Epic 4 | Absence of rating = "no signal", never negative |
| FR126 | Epic 4 | Sibling-specific vs family-wide preference patterns |
| FR127 | Epic 4 | Variant preparation/pairing active-learning |

**Coverage check:** All 127 FRs mapped. Per-epic counts: E1=0, E2=15, E3=30, E4=24, E5=14, E6=9, E7=10, E8=12, E9=8, E10=5, E11=0. Sum = 127 ✓

## Epic List

### Epic 1 — Foundation & Engineering Bedrock

**User outcome (engineering as the user here — see note below):** The team can deliver any Phase 1 user-facing feature on a safe, scope-enforced foundation that prevents the load-bearing drift modes (multi-writer thread races, scope leakage, silent state divergence, audit-write inconsistency, vendor-lock).

**Note on user-value framing.** This epic deviates from the BMad "user-value first" rule because Architecture (§Decision Impact Analysis Bootstrap) and UX Spec (§Foundation Gate) both explicitly mark this work as Phase-0 blocking — no user-facing epic can land safely without it. Treating it as its own epic (vs. inlining into Epic 2) protects the rest of the epic set from carrying technical-debt amendments retroactively.

**Scope:** Bootstrap (AR-1) — `apps/marketing` Astro scaffold, `packages/ui` empty + shadcn init, dependency installs, Fastify plugin wiring, Zod env validation per app, `.env.local.example` per app. Foundation Gate contracts (UX-DR6–UX-DR10) — `Turn.server_seq` + `thread.resync` (Gate 1), `PlanUpdatedEvent` with inline `guardrail_verdict` (Gate 2), `ForgetRequest`/`ForgetCompletedEvent` soft-only (Gate 3), `PresenceEvent` with `SurfaceKind` (Gate 4), `ApiError`/`FieldError`/`ErrorCode` (Phase 0 W1). Token system v2.0 (UX-DR1–UX-DR5) — `sacred-*`, `lumi-*`, `safety-cleared-*`, `memory-provenance-*`, `honey-amber`, `foliage-*`, `warm-neutral-*`. Scope charter at `packages/design-system/SCOPE_CHARTER.md` (UX-DR13). ESLint flat config + `eslint-plugin-boundaries` rules + `no-cross-scope-component` (UX-DR12) + `no-dialog-outside-allowlist` + scope-allowlist.config.ts (UX-DR14, UX-DR33). Pino + OTEL skeleton + Grafana Cloud OTLP wire. `tools.manifest.ts` with CI lint enforcement (AR-4). Single-row `audit_log` schema with monthly partitions + composite index (AR-5). Migration sequencing rule (AR-11). RealTime SSE bridge in `apps/web/src/lib/realtime/` (UX-DR11). Reduced-motion + reduced-transparency hooks (UX-DR63). Anchor-device perf budgets in `.github/workflows/perf.yml` (UX-DR62 baseline, UX-DR60). Contrast audit harness (UX-DR5). Workspace `package.json` scripts (`supabase:start`, `supabase:reset`, `seed:dev`, `seed:reset`, `dev`, `build`, `lint`, `typecheck`, `test`). Dockerfile for `apps/api` (Fly.io). PR template with patterns checklist.

**FRs covered:** None directly (platform substrate).
**NFRs anchored:** NFR-PERF-5 (CWV per surface), NFR-PERF-6 (anchor device), NFR-SEC-3 (auth tokens posture), NFR-SEC-5 (CSP/COOP/COEP), NFR-SEC-7 (secrets), NFR-SEC-8 (audit logs), NFR-A11Y-1 (WCAG 2.1/2.2 AA + AAA carve-outs), NFR-A11Y-2 (readability CI), NFR-A11Y-4 (keyboard nav), NFR-OBS-1 (MVP-grade beta observability), NFR-COST-5 (non-prod cost envelopes).
**Dependencies:** None. Blocks all subsequent epics.

---

### Epic 2 — Household Onboarding & Profile

**User outcome:** I can become a HiveKitchen household. I sign up, complete a 10-minute voice (or text) interview anchored on three signal questions, and the system knows my family well enough to draft my first plan within 90 seconds.

**Scope:** Supabase Auth (email/password + Google/Apple OAuth) + 4-role RBAC preHandler + JWT access (15min) + refresh cookie (30d, rotation-on-use, reuse → revoke-all) + Secondary Caregiver invite primitive (signed JWT, single-use jti, 14-day TTL) + COPPA soft-VPC signed declaration + parental notice disclosure pre-data-collection + parent-account-vs-household-profile separation + voice-first onboarding interview via ElevenLabs (three signal questions: grandmother's food, Friday rhythm, child's refusal) + text-equivalent path with same outcome + envelope-encrypted child profile (allergens, cultural identifiers, dietary preferences) + cultural-template inference from interview transcript + parental confirm-or-correct of inferred templates + per-child Lunch Bag slot declaration (Main always; Snack on/off; Extra on/off) + Visible Memory `memory_nodes` write primitive (used by E3+E5 too) + notification preferences + cultural-language preference (FR106) + onboarding mental-model copy (UX-DR65: "The plan is always ready. Change anything, anytime. You don't need to approve it." + "Changes save as you go. No button needed.").

**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR10, FR11, FR12, FR14, FR105, FR106, FR107.
**Dependencies:** Requires Epic 1 (Foundation Gate, auth scaffold, agent orchestrator skeleton, scope charter).

---

### Epic 3 — Weekly Plan & Ready-Answer Open

**User outcome:** I open HiveKitchen and find next week's plan ready, composed by Lumi with my family's constraints honored. I make zero or one or two adjustments via tap or one sentence to Lumi, and close in under 90 seconds.

**Scope:** Agent orchestrator (Branch-C wrapper) with LLMProvider adapter (OpenAI primary, Anthropic stub) + planner specialist agent + agent tools manifest with maxLatencyMs (recipe.search, recipe.fetch, memory.recall, pantry.read, plan.compose, allergy.check, cultural lookup) + runtime tool-latency sampling + Allergy Guardrail Service (AUTHORITATIVE; outside agent boundary) + advisory `allergy.check` tool calling shared rule engine + plan-generation BullMQ job with per-TZ schedule (resolves AR-18) + plan repository with revision versioning + `brief_state` projection writer (refreshed on plan.updated/memory.updated/thread.turn) + BriefCanvas (`<MomentHeadline>` + `<LumiNote>` + 5× `<PlanTile>` + `<FreshnessState>`) + PlanTile with all states + swap flow (per-slot independent + day-swap + skip/sick) + AllergyClearedBadge + Popover with audit link + freshness contract (single-line states; never silent staleness) + silent-mutation `<QuietDiff>` (scaffolding-only) + cultural-calendar awareness (cultural_calendar.observances drives weighting) + per-slot policy scoping + bag-wide allergy rule + day-level context overrides (Bag-suspended/Half-day/Field-trip/Sick-day/Post-dentist/Early-release/Sport-practice/Test-day) auto-revert + leftover-aware swap proposals + sick-day pause + Lunch Link pause for child on day + plan regeneration + graceful-degradation state ("no safe plan") + cultural-recognition L0 (preference: "Maya doesn't eat bell peppers") + L1 (method: "Tuesday's rice is pressure-cooked") + degraded-propose state with `CULTURAL_INTERSECTION_EMPTY` and `try_alternating_sovereignty` suggestion + Snack item-level SKU modeling vs Main recipe-with-ingredient-decomposition modeling + pin/ban Extra component types + passive bias from Extra removals + parent-authored reusable Extra library + propose Extra on high-activity days + variant preparation active-learning visible to parent before delivery (FR127, MVP delegate to E4) + LLM-provider failover circuit-breaker.

**FRs covered:** FR15, FR16, FR17, FR18, FR19, FR20, FR21, FR22, FR23, FR24, FR25, FR26, FR76, FR77, FR78, FR79, FR81, FR82, FR108, FR109, FR110, FR111, FR112, FR113, FR114, FR115, FR116, FR117, FR118, FR119.
**Dependencies:** Requires Epic 1 (orchestrator skeleton, contracts, audit, projection table) + Epic 2 (profile data with allergens, cultural templates, bag composition).

---

### Epic 4 — Lunch Link & Heart Note Sacred Channel

**User outcome:** My kid receives a Lunch Link with a Heart Note from me, taps an emoji, and starts to feel known. I can compose Heart Notes (text or hold-to-talk) from my phone, schedule them, edit before delivery, and track delivery status. The Heart Note arrives unmodified.

**Scope:** Lunch Link HMAC-SHA256 signed URLs (child_id, date, nonce, exp=8pm_local) + daily-rotating HMAC key with 24h overlap + `lunch_link_sessions` table + 60s grace window post-exp + sibling-device case with separate nonce per (child, device-open) + LunchLinkPage (.child-scope) + 4-emoji Layer 1 (love/like/meh/no, 72×72 minimum tap target) + per-item Layer 2 swipe-right (no thumbs-down, no swipe-left) + 8pm window enforcement + `<FlavorPassport>` sparse-page (parent-scope view + child-scope read-aloud-ready view) + bag preview rendering (Heart Note dominant, items below) + HeartNoteComposer (.app-scope text + voice via hold-to-talk) + envelope-encrypted Heart Note content + sacred-channel delivery (no AI modification) + scheduled delivery for specific day + edit/cancel before delivery window + delivery status view (delivered/viewed/rated/not-yet-opened) + Heart Note absence: zero notifications/streaks/reminders (FR43) + Premium voice playback of Heart Note via Lunch Link (Premium-gated, gate logic from Epic 8) + child request-a-lunch text suggestion → Primary Parent review + approve before plan incorporation + variant preparation captures rating delta as active-learning signal + SendGrid email delivery + Twilio SMS/WhatsApp delivery + parent-copied URL + `jobs/lunch-link-delivery.job` school-morning fanout (per-TZ) + Service Worker for `/lunch/*` route only (cache last successful GET, serve stale with `last synced HH:MM`, 24h TTL) + Layer 1 transparency log per FR80 (allergy-relevant decisions) + multilingual font fallbacks for non-Latin scripts (Devanagari, Hebrew, Arabic RTL, Tamil — resolves AR-20) + cultural recognition family-language sacred-plum underline in composer (Nani/Dadi/Lola/Bibi).

**FRs covered:** FR32, FR33, FR34, FR35, FR36, FR37, FR38, FR39, FR41, FR42, FR43, FR44, FR45, FR46, FR47, FR80, FR120, FR121, FR122, FR123, FR124, FR125, FR126, FR127.
**Dependencies:** Requires Epic 1 (signed-URL primitive, Service Worker scope, multilingual contract) + Epic 2 (children + auth + delivery channel preferences) + Epic 3 (plans with bag composition to render in Lunch Link bag preview, allergy guardrail clearance).

---

### Epic 5 — Household Coordination & Evening Check-in

**User outcome:** My partner and I share the load — we see who's packing tomorrow, hand off mid-week without re-planning, and Lumi already has Wednesday's plan when Devon opens her phone. I can chat with Lumi (voice or text) when it suits me, and she gets noticeably better at understanding my family week by week. When she notices something, I can see it and confirm or correct.

**Scope:** Shared family thread with server-assigned monotonic `server_seq` + `thread.resync` recovery + per-tab SSE channel + Figma-style `<PresenceIndicator>` with generic surface addressing + `<ThreadTurn>` polymorphic envelope (TurnMessage / TurnPlanDiff / TurnProposal / TurnSystemEvent / TurnPresence body components) + `<DisambiguationPicker>` L1→L4 promotion ladder + L3→L4 bidirectional tether (sacred-plum pulse + thread breadcrumb pinned at top, returns to QuietDiff settled summary) + Secondary Caregiver invite redemption flow (cross-scope `/invite/$token` route resolving role then redirecting) + revoke caregiver access + transfer primary ownership + `<PackerOfTheDay>` + Evening Check-in unlimited text + voice tier caps (Standard 10min/wk per FR58, Premium unlimited per FR57) + voice token issuance (`POST /v1/voice/token`) + ElevenLabs HMAC webhook (`POST /v1/webhooks/elevenlabs`) + tool-latency manifest enforcement at runtime + sync-vs-early-ack split at 6000ms boundary + `<EarlyAckPulse>` non-verbal SSE orb pulse for 1.5–4s estimated chains + spoken "one sec" continuation for >6s chains (NEVER "Let me pull that up...") + concurrent text caption fallback for all voice output + tone/length adaptation by household context (time of day, recent activity) + parent-initiated only (Lumi never proactive, FR63) + passive profile enrichment via memory.note tool from conversation mentions + "I noticed" learning moments on home surface with confirm/correct (FR62) + plan-reasoning explanations on demand (FR64) + cultural-recognition L2 meal-pattern ("Keeping Jollof Friday") with opt-in + language-discovered gates + L3 family-language with provenance (sacred-plum tint, tap reveals memory node) + Lumi-initiated ratification turn at `suggested` state (no template picker UI ever) + family-language ratchet (forward-only) + interfaith-mode toggle ("Honor all rules in every meal." / "Alternate whose rules lead each day.") + thread-integrity-anomaly client beacon to `/v1/internal/client-anomaly`.

**FRs covered:** FR27, FR28, FR29, FR30, FR31, FR56, FR57, FR58, FR59, FR60, FR61, FR62, FR63, FR64.
**Dependencies:** Requires Epic 1 (Foundation Gate Turn contract, presence contract, SSE bridge) + Epic 2 (auth, Secondary Caregiver invite primitive). Epic 3 strongly recommended first so Lumi has plans to discuss; can ship before Epic 4.

---

### Epic 6 — Grocery & Silent Pantry-Plan-List Loop

**User outcome:** When I shop, the list is in store-aisle order and routes specialty ingredients to the right store within 5 miles. When I'm done tapping items off, I never have to update a pantry. Next week's plan respects what's actually in my fridge.

**Scope:** Shopping-list derivation from current week's plan accounting for inferred pantry state + Snack-as-distinct-section (item-level SKUs separated from Main recipe ingredient decomposition) + multi-store split list when applicable + cultural-supplier directory routing within 5-mile radius + cultural_suppliers table seeding + store-mode UI (large text, one-handed, store-layout-aware sort, sticky header with running check-off count, haptics on supported devices) + tap-to-purchase silent pantry-state update + parent-correctable pantry inference (FR55) + leftover-aware swap proposals when pantry indicates surplus or soon-to-expire (proposes via Lumi turn in thread, parent confirms; swap mechanics owned by Epic 3) + non-plan-derived item add (household staples) + connectivity-loss store-mode UX (in-flight check-offs preserved as pending, honest "You're offline. I'll catch up when you're back." banner, no silent broken state) + geolocation opt-in at household level only (never child level) for cultural-supplier routing.

**FRs covered:** FR48, FR49, FR50, FR51, FR52, FR53, FR54, FR55, FR74.
**Dependencies:** Requires Epic 1 (foundation), Epic 2 (auth), Epic 3 (plans to derive list from). Can ship parallel with Epic 4 + Epic 5.

---

### Epic 7 — Visible Memory & Trust Controls

**User outcome:** I can see exactly what Lumi has learned about my family in plain prose — written in Lumi's voice, organized by facet. I can edit a sentence, soft-forget anything ("Lumi won't use this anymore"), hard-reset the child's flavor journey once a year, or wipe my entire account in 30 days across every processor. I can download an auditable JSON export of everything Lumi has on us.

**Scope:** Visible Memory authored-prose panel rendered from `brief_state.memory_prose` snapshot (composer pre-populates at plan-compose time; never LLM-on-scroll) + `<VisibleMemorySentence>` with always-visible `⋯` affordance + first-time honey-amber pulse + provenance chip Popover (source turn / confidence / last-used) + `<ForgetMenu>` with soft-only Phase 1 semantics ("Lumi won't use this anymore") + cascade to `memory_embeddings` + `memory_provenance` rows + nightly `memory-forget.job` soft → hard promotion at `soft_forget_at + 30d` + reset-flavor-journey annual purge of child artifacts (FR68) + edit-and-reconcile-before-next-plan-gen + parental review dashboard unifying compliance + trust surface (one panel) + consent history view (VPC events + policy acknowledgments + opt-ins) + data-portability JSON export (within 72h, decryption-to-parent semantics resolved per AR-22) + account deletion with 30-day processor-side erasure (Supabase + ElevenLabs + SendGrid + Twilio + Stripe + LLM provider) + voice transcript retention controls (90d default, opt-in longer / immediate-delete) + state-patchwork compliance overrides table (CT/UT/TX/FL/VA per AR-21) + payload-scrubbing primitive for any future sharing surface (built but unused at MVP) + memory-node provenance metadata visible (when learned, source type) + `<TrustChip variant=memory-provenance>` rendering.

**FRs covered:** FR65, FR66, FR67, FR68, FR69, FR70, FR71, FR72, FR73, FR75.
**Dependencies:** Requires Epic 1 (memory_nodes/provenance schema, contracts), Epic 2 (memory accumulating from onboarding), Epic 3 (memory accumulating from plan outcomes), Epic 5 (memory accumulating from conversation enrichment). Best shipped after Epic 5.

---

### Epic 8 — Billing, Tiers & Gift Subscriptions

**User outcome:** I (or a grandparent gifting the subscription) can subscribe to Standard or Premium, switch tiers within a billing period, cancel anytime cleanly, and configure school-year start/end dates so I don't pay for summer break. A grandparent can purchase a $129/yr gift Premium plus an optional $24/yr Guest Heart Note authoring add-on.

**Scope:** Stripe checkout integration + Standard tier ($6.99/mo or $69/yr) + Premium tier ($12.99/mo or $129/yr) + school-year auto-pause via parent-declared calendar (FR93, resolves AR-19 by anchoring to parent-declared dates with optional US federal holiday API enrichment) + monthly + annual billing + upgrade Standard→Premium and downgrade Premium→Standard mid-period + cancellation with explicit confirmation UX (no dark patterns) + receipts/invoices + failed-payment grace period + service-continuity messaging on payment failure + gift subscription purchase flow (third-party payer, annual, $129/yr Premium) + Guest Heart Note authoring add-on purchase ($24/yr) → triggers signed-JWT invite token (7-day TTL Phase 1) issued to gift recipient with rate-limited authoring permission per FR40 + redeem gifted subscription flow (FR13) + gift-cancellation-before-redemption with full refund + Stripe webhook (`POST /v1/webhooks/stripe`, HMAC validated) + Premium-tier feature gate logic (consumed by Epic 4 for FR41 voice playback and Epic 5 for FR57 unlimited voice).

**FRs covered:** FR13, FR40, FR84, FR85, FR86, FR87, FR88, FR89, FR91, FR92, FR93, FR94.
**Dependencies:** Requires Epic 1 (foundation, audit) + Epic 2 (auth, household). **Sequenced just before Epic 10** (Beta-to-Public-Launch) per user instruction — beta is free, so Stripe wiring isn't load-bearing earlier; landing it right before E10 minimizes the time billing infrastructure sits unused. Premium-tier feature gates consumed by Epic 4 (FR41 voice playback) and Epic 5 (FR57 unlimited voice) ship as inert "always-Premium" stubs in those epics during beta, then activate when E8 lands.

---

### Epic 9 — Ops Dashboard, Compliance Export & Incident Response

**User outcome (operator):** When something goes wrong at the safety layer, I see the full three-stage audit timeline within minutes. When a parent submits a support request, I respond within SLA. When a regulator requests records, the Compliance Officer can export the audit-log subset reliably. I monitor cost-per-household, plan-generation latency, voice cost, allergy-guardrail catch-rate, and Lunch Link delivery success-rate continuously.

**Scope:** Allergy-safety anomaly dashboard (.ops-scope) + standing household allergy-safety audit dashboard (FR83) + plan-generation p50/p95 latency telemetry + per-HH voice cost dashboard + LLM cost per plan + allergy-guardrail catch-rate metric + Lunch Link 7:30am delivery success-rate + three-stage plan-audit timeline (renders from `audit_log.stages JSONB[]` via `correlation_id = plan_id` composite-index lookup) + incident-response SLA workflow per architecture §integration paths (alert ≤5min → on-call ≤15min → parent ≤1h with transparency log → architectural review ≤24h → backported fix ≤72h) + per-HH (anonymized) ops view + audit logs covering allergy/plan-gen/Heart Note/Visible Memory/billing/account deletions + parent support-request channel within product (FR99) + ops support response with bounded SLA (FR100) + Compliance Officer audit-log subset export for regulatory audit/subpoena/parental data-request (FR101) + guardrail-mismatch beacon backing dashboard + thread-integrity-anomaly beacon backing dashboard + client_errors backing table dashboard.

**FRs covered:** FR83, FR95, FR96, FR97, FR98, FR99, FR100, FR101.
**Dependencies:** Requires Epics 1-8 to have data flowing through `audit_log` + cost telemetry. Build-along visible from Epic 3 onward; gains substance as upstream epics ship.

---

### Epic 10 — Beta-to-Public-Launch Transition

**User outcome:** Beta households transition cleanly to paid status at month 5/6 of beta with a 14-day grace refund. Mid-beta the team can run controlled A/B (Standard-only cohort vs control) to validate the tier structure. The compliance posture switches from beta soft-VPC to credit-card VPC at signup. Voice cost is monitored against per-tier ceilings with soft-cap messaging for the 95th percentile.

**Scope:** Credit-card VPC at subscription signup ($0.01 immediate-refund, replaces beta soft-VPC mechanism) per FR9 + beta-to-paid transition flow with explicit upgrade confirmation UX and 14-day first-charge refund window per FR90 + tier-variant cohort assignment via `households.tier_variant` column (per architecture §5.6 amendment K — defer GrowthBook to post-launch) with audit-logged cohort assignment per FR103 + month-5 Standard-vs-Premium A/B experimental arm (per PRD Premium-tier validation) + per-HH voice-cost monitoring + tier-appropriate soft-cap messaging above 95th percentile per FR104 + sustained-abuse-pattern hard rate-limit triggers + in-product survey delivery at validation milestones per FR102 (first-plan satisfaction within 48h, cultural recognition week 2 and week 3 for culturally-identified households, mid-beta WTP at beta day 60, post-launch satisfaction 30 days post-payment) + Compliance Officer role hand-off + beta sunset comms.

**FRs covered:** FR9, FR90, FR102, FR103, FR104.
**NFRs anchored:** NFR-COMP-1 (COPPA audit-ready at public launch), NFR-COMP-2 (AADC DPIA completed), NFR-COST-1, NFR-COST-2 (voice cost ceilings).
**Dependencies:** Requires Epic 1 (foundation), Epic 2 (auth + soft-VPC for beta), Epic 8 (Stripe billing infrastructure), Epic 9 (audit + telemetry surfaces). This epic is a transition wrapper, not foundational — fires at month 5/6 of beta.

---

### Epic 11 — Marketing & Public Acquisition

**User outcome (prospective parent or gifting grandparent):** I land on hivekitchen.com, understand what HiveKitchen is, see pricing, try a pre-login interactive demo, and either subscribe or gift a subscription. I can read about the cultural-community partnerships and trust posture before committing.

**Scope (deferred to near public launch per user instruction):** Astro SSG marketing site (`apps/marketing/`) + landing page (pain-point-led) + pricing page (Standard $6.99/mo or $69/yr; Premium $12.99/mo or $129/yr; gift Premium $129/yr) + pre-login interactive demo ("try a demo family") + cultural-community partner pages (Halal, Kosher, Hindu-vegetarian, South Asian, East African, Caribbean) + FAQ + legal pages (Terms, Privacy, COPPA-AADC notice, processor list) + gift-purchase entry point (links to `/gift/purchase` in app) + SEO discipline (intent-driven cultural + allergy + AI-meal-planner queries, branded queries, gift-flow queries — never top-of-funnel "what's for lunch" SEO competition) + non-indexed authenticated routes + non-indexed Lunch Link (`X-Robots-Tag: none` + `noindex,nofollow,noarchive,nosnippet`) + structured data (`Organization`, `WebApplication`, `Offer` for pricing tiers, `FAQPage`) + `apps/marketing/.env.local.example` + Cloudflare Pages deploy pipeline.

**FRs covered:** None directly (supports FR1 acquisition path, FR88 gift purchase entry).
**Dependencies:** Standalone from a runtime perspective — no app data dependency. **Deferred to near public launch (September 2026)** per user instruction.

---

## Epic dependency + sequencing graph

```
Epic 1 (Foundation) ━━━ blocks all others
   │
   ├─→ Epic 2 (Onboarding) ━━━ enables Epics 3-10
   │      │
   │      └─→ Epic 3 (Plan) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
   │             │                                                                                           │
   │             ├─→ Epic 4 (Lunch Link/HN) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
   │             ├─→ Epic 5 (Coord/Evening) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
   │             └─→ Epic 6 (Grocery) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
   │                     │                                                                                   │
   │                     └─→ Epic 7 (Memory) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
   │                                                                                                         │
   └─────────────────────────────────────────────────────────────────────────────→ Epic 9 (Ops) ━━━━━━━━━━━━━┫ (build-along through E3-E7)
                                                                                                             │
                                                                                Epic 8 (Billing) ━━━━━━━━━━━━┫ (just-in-time; ships right before E10)
                                                                                                             │
                                                                              Epic 10 (Beta→Launch) ━━━━━━━━━┛ (month 5/6 transition; needs E1-E9 + E8)

Epic 11 (Marketing) ━━━ standalone runtime; deferred to ~September 2026 (near public launch)
```

**Suggested shipping order:** E1 → E2 → E3 → (E4 + E5 + E6 in parallel) → E7 → E9 (build-along, surfaces grow with traffic from E3 onward) → **E8 (Billing) just-in-time before E10** → E10 (month 5/6 transition) → E11 (near public launch).

**Why E8 is sequenced late:** Beta is free, so Stripe doesn't need to be live during beta. Landing E8 just before E10 (the transition that activates billing) minimizes the time billing infrastructure sits unused and avoids maintaining Stripe wiring that no household is exercising. Premium-feature gates that Epic 4 (FR41) and Epic 5 (FR57) reference ship as inert "always-Premium" stubs during beta, then activate when E8 lands.

---

## Epic 1: Foundation & Engineering Bedrock

The team can deliver any Phase 1 user-facing feature on a safe, scope-enforced foundation that prevents the load-bearing drift modes (multi-writer thread races, scope leakage, silent state divergence, audit-write inconsistency, vendor-lock).

### Story 1.1: Scaffold apps/marketing (Astro) and packages/ui workspace package

As a developer,
I want the missing top-level workspaces (`apps/marketing`, `packages/ui`) scaffolded and registered with Turborepo + pnpm,
So that subsequent stories can add Astro pages and shadcn-copied-in components without hitting "package not found" errors.

**Acceptance Criteria:**

**Given** the existing repo has only `apps/{web,api}` and `packages/{contracts,types,tsconfig}`,
**When** Story 1.1 is complete,
**Then** `apps/marketing/` exists, scaffolded via `pnpm create astro@latest apps/marketing -- --template minimal --typescript strict --no-git --no-install --skip-houston`, with package name `@hivekitchen/marketing`, registered in `pnpm-workspace.yaml` (already covered by `apps/*` glob) and added to `turbo.json` tasks (`dev`, `build`, `lint`, `typecheck`, `clean`).
**And** `packages/ui/` exists as an empty workspace package with `package.json` (name `@hivekitchen/ui`), `tsconfig.json` extending `@hivekitchen/tsconfig/react`, `src/index.ts` empty barrel, and `tailwind.config.ts` consuming token presets from `packages/design-system/tokens`.
**And** `pnpm install` succeeds at workspace root with both new packages discovered.
**And** `pnpm dev:marketing` (turbo filter) starts the Astro dev server on a configurable port without errors.
**And** `pnpm typecheck` passes across the entire monorepo including the new packages.

### Story 1.2: Wire workspace package.json scripts + Dockerfile + per-app .env.local.example

As a developer,
I want a complete set of workspace scripts (`supabase:start`, `supabase:reset`, `seed:dev`, `seed:reset`, `dev`, `build`, `lint`, `typecheck`, `test`) plus a Fly.io-ready Dockerfile for `apps/api` and a `.env.local.example` for every app,
So that a new engineer can `pnpm install && pnpm supabase:start && pnpm seed:dev && pnpm dev` and have a working local environment in under five minutes.

**Acceptance Criteria:**

**Given** Story 1.1 is complete,
**When** an engineer clones the repo and runs the documented startup sequence,
**Then** `package.json` (root) contains `supabase:start`, `supabase:stop`, `supabase:reset`, `seed:dev`, `seed:reset`, `dev`, `build`, `lint`, `typecheck`, `test` scripts wired to `supabase` CLI and Turborepo filters.
**And** `apps/api/Dockerfile` exists as a Node 22 multi-stage build (build stage runs `pnpm build`; runtime stage copies `dist/` + `node_modules` and runs `node dist/server.js`); image builds successfully via `docker build` from repo root.
**And** `apps/api/.env.local.example`, `apps/web/.env.local.example`, `apps/marketing/.env.local.example` all exist with sanitized placeholder values for every environment variable referenced in their respective Zod env schemas (see Story 1.6 for `apps/api`).
**And** `apps/api/.env.local.example` includes `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `STRIPE_SECRET_KEY`, `SENDGRID_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `REDIS_URL`, `ELEVENLABS_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`, `JWT_SECRET`, `LOG_LEVEL`, `NODE_ENV`, `PORT`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`.
**And** `apps/web/.env.local.example` includes `VITE_API_BASE_URL`, `VITE_SSE_BASE_URL`.
**And** README.md root section "Local development" documents the bootstrap sequence.

### Story 1.3: Establish Foundation Gate contracts in packages/contracts

As a developer,
I want all five Foundation Gate Zod schemas (Turn, PlanUpdatedEvent with inline AllergyVerdict, ForgetRequest/Completed soft-only, PresenceEvent, ApiError) authored and exported from `packages/contracts`,
So that Epic 2+ features build over a stable substrate where multi-writer races, plan-vs-guardrail divergence, forget semantics, presence events, and error shapes are all single-source-of-truth.

**Acceptance Criteria:**

**Given** Story 1.1 is complete,
**When** Story 1.3 is complete,
**Then** `packages/contracts/src/thread.ts` exports `Turn` interface (`id`, `thread_id`, `server_seq: bigint`, `created_at`, `role: 'user'|'lumi'|'system'`, `body: TurnBody`), `TurnBody` discriminated union (`message`/`plan_diff`/`proposal`/`system_event`/`presence`), and an extension to `InvalidationEvent` adding `{ type: 'thread.resync'; thread_id; from_seq: bigint }`.
**And** `packages/contracts/src/plan.ts` exports `PlanUpdatedEvent` carrying `guardrail_verdict: AllergyVerdict` inline, with `AllergyVerdict` as a discriminated union of `cleared|blocked|pending|degraded` shapes including the `CULTURAL_INTERSECTION_EMPTY` reason and `try_alternating_sovereignty` suggestion.
**And** `packages/contracts/src/memory.ts` exports `ForgetRequest` with `mode: 'soft'` (Phase 1 only — TypeScript type prevents `'hard'` from being constructed in Phase 1) and `ForgetCompletedEvent`.
**And** `packages/contracts/src/presence.ts` exports `PresenceEvent` and `SurfaceKind` enum (`brief|plan_tile|lunch_link|heart_note_composer|thread|memory_node`) with `expires_at: string` TTL field.
**And** `packages/contracts/src/errors.ts` exports `ErrorCode` enum (`VALIDATION_FAILED|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|CONFLICT|RATE_LIMITED|AGENT_UNAVAILABLE|GUARDRAIL_BLOCKED|CULTURAL_INTERSECTION_EMPTY|SCOPE_FORBIDDEN`), `FieldError` (`path`, `code`, `message`), and `ApiError` (`code`, `message`, `fields?`, `trace_id`).
**And** `packages/contracts/src/events.ts` exports the Zod-discriminated `InvalidationEvent` union (existing events from architecture §4.1 + the new `thread.resync` extension).
**And** all five contract files have unit tests in `packages/contracts/src/*.test.ts` verifying that valid payloads parse and invalid payloads reject with appropriate Zod errors.
**And** `packages/types/src/index.ts` re-exports `z.infer<>` types for every schema in `packages/contracts/src/`.
**And** `pnpm contracts:check` (new CI script) verifies every schema in `contracts` is imported by at least one downstream module OR explicitly tagged `@unused-by-design`.

### Story 1.4: Establish token system v2.0

As a developer,
I want the v2.0 token system committed to `packages/design-system/tokens/` and exposed as Tailwind CSS custom properties,
So that scope-allowlist enforcement and component implementations can reference semantic tokens (`bg-sacred`, `text-lumi-terracotta`, `bg-safety-cleared/8`) instead of raw color values.

**Acceptance Criteria:**

**Given** Story 1.1 is complete,
**When** Story 1.4 is complete,
**Then** `packages/design-system/tokens/colors.css` defines `--sacred-plum-{50..900}`, `--lumi-terracotta-{50..900}` + `--lumi-terracotta-warmed`, `--safety-cleared-teal-{50..900}`, `--memory-provenance-{50..900}`, `--honey-amber-{50..900}` (recognition only — never button hover), `--foliage-{50..900}`, `--warm-neutral-{50..900}`, `--focus-indicator-color/width/offset`.
**And** `typography.css` defines Instrument Serif (headlines/Heart Notes) + Inter (body) with `font-display: swap`; `motion.css` defines `--sacred-ease` cubic-bezier with reduced-motion fallback.
**And** all three apps' `tailwind.config.ts` import the token CSS and expose Tailwind utilities; Inter + Instrument Serif self-hosted woff2 files in `apps/{web,marketing}/public/fonts/` (no Google Fonts CDN).
**And** a smoke-test page at `apps/web/src/routes/_dev-tokens.tsx` (gated by `NODE_ENV !== 'production'`) renders every token group for visual review.

### Story 1.5: Scope charter + ESLint scope-allowlist rules + dev-mode runtime assertions

As a developer,
I want the four UX scopes enforced by a written charter plus an ESLint rule plus dev-mode runtime assertions,
So that scope leakage is caught at three independent layers (review, lint, runtime).

**Acceptance Criteria:**

**Given** Story 1.4 is complete,
**When** Story 1.5 is complete,
**Then** `packages/design-system/SCOPE_CHARTER.md` exists as canonical spec for what renders where (.app/.child/.grandparent/.ops with allowed/forbidden components and voice register).
**And** `packages/eslint-config-hivekitchen/` exports a flat config with: (a) `no-cross-scope-component` (reads `packages/ui/src/scope-allowlist.config.ts`); (b) `no-dialog-outside-allowlist` (allowlist: safety-block explainer, command palette, hard-forget Phase 2+, auth re-entry); (c) `eslint-plugin-jsx-a11y` strict; (d) logical-property rule forbidding `margin-left/right`; (e) `eslint-plugin-boundaries` per architecture §6 (agents/ no fastify, repository.ts is sole Supabase importer, audit/ is sole audit_log writer, no SDK imports outside plugins/).
**And** route layouts apply scope class to `<html>`; scope-locked components implement dev-mode runtime assertions (throw on wrong-scope mount).
**And** `pnpm lint` from workspace root passes; deliberate-violation fixtures in `packages/eslint-config-hivekitchen/__fixtures__/` demonstrate each rule firing.

### Story 1.6: Wire Fastify plugins + Zod env validation in apps/api

As a developer,
I want all infrastructure SDK clients wrapped as Fastify plugins and Zod-validated env config at startup,
So that services and routes never import an SDK directly (lint-enforced) and env misconfigurations fail loudly at startup.

**Acceptance Criteria:**

**Given** Story 1.2 is complete,
**When** Story 1.6 is complete,
**Then** `apps/api/src/common/env.ts` exports a Zod schema validating every env var; `server.ts` calls `parseEnv()` before any other startup; on failure logs `fatal` Pino entry naming each missing/invalid var and exits with code 1.
**And** `apps/api/src/plugins/` contains `supabase.plugin.ts`, `openai.plugin.ts`, `elevenlabs.plugin.ts`, `stripe.plugin.ts`, `sendgrid.plugin.ts`, `twilio.plugin.ts`, `ioredis.plugin.ts`, `bullmq.plugin.ts`, `vault.plugin.ts` (in dev reads `.env.local`; staging+prod fetches non-bootstrap secrets from Supabase Vault).
**And** the `eslint-plugin-boundaries` rule from Story 1.5 forbids any file outside `apps/api/src/plugins/` from importing `@supabase/supabase-js`, `openai`, `@openai/agents`, `@openai/agents-openai`, `@elevenlabs/elevenlabs-js`, `stripe`, `@sendgrid/mail`, `twilio`, `ioredis`, `bullmq` — verified by deliberate-violation fixture.
**And** integration test `apps/api/test/integration/plugins.int.test.ts` boots the app against local Docker Supabase + local Docker Redis with stub Vault; all plugins decorate correctly.

### Story 1.7: Pino structured logging + OpenTelemetry skeleton + Grafana Cloud OTLP

As a developer,
I want Pino logging with request-scoped child loggers and OpenTelemetry instrumentation exporting to Grafana Cloud (or stdout in dev),
So that every request is traceable end-to-end with consistent log shape `{ requestId, userId?, householdId?, module, action }`.

**Acceptance Criteria:**

**Given** Story 1.6 is complete,
**When** Story 1.7 is complete,
**Then** `apps/api/src/middleware/request-id.hook.ts` generates UUIDv4 if `X-Request-Id` missing, attaches to `request.id`, creates child Pino logger as `request.log`, echoes ID in response header.
**And** Pino redaction allowlist explicitly blocks logging of `*.heart_note_content`, `*.child_name`, `*.declared_allergens`, `*.cultural_identifiers`, `*.dietary_preferences`, `*.card`, `*.cvv` paths.
**And** `apps/api/src/plugins/otel.plugin.ts` initializes `@opentelemetry/sdk-node` with auto-instrumentation for Fastify + ioredis + PostgreSQL; in dev exports to stdout, in staging/prod to OTLP endpoint per env.
**And** ESLint rule forbids `console.log`/`error`/`warn`/`info` in `apps/api/src/`.
**And** smoke-test integration test verifies `/v1/health` request produces correctly-shaped Pino log + corresponding OTEL span.

### Story 1.8: Single-row audit_log schema (monthly partitions + composite index) + audit.service.write()

As a developer,
I want the `audit_log` table created with the single-row-per-action schema, monthly partitioning, and the composite index on `(household_id, event_type, correlation_id, created_at)`, plus an `audit.service.write()` API that is the only allowed write path,
So that FR78/FR80 timeline reconstruction is a single-row read and audit volume scales to 50k HH × 5k plans/wk.

**Acceptance Criteria:**

**Given** Story 1.6 is complete,
**When** Story 1.8 is complete,
**Then** migration `20260501110000_create_audit_event_type_enum.sql` creates the Postgres enum with values from architecture §4.2 (`plan.*`, `memory.*`, `heart_note.*`, `lunch_link.*`, `voice.*`, `billing.*`, `vpc.*`, `account.*`, `auth.*`, `allergy.*`, `agent.*`, `webhook.*`, `invite.*`, `llm.provider.*`).
**And** migration `20260501140000_create_audit_log_partitioned.sql` creates `audit_log` parent table partitioned by `RANGE (created_at)` monthly with the schema columns + composite index + partial index `WHERE event_type='plan.generated' AND stages @> '[{"verdict":"rejected"}]'`.
**And** initial 6 monthly partitions pre-created; BullMQ recurring `apps/api/src/jobs/audit-partition-rotation.job.ts` creates next partition at start of each month.
**And** `apps/api/src/audit/audit.service.ts` exposes `audit.service.write(...)` returning `Promise<void>`, fire-and-forget via Fastify `onResponse` hook (`audit.hook.ts`); `audit.types.ts` mirrors enum (CI lint enforces parity).
**And** `eslint-plugin-boundaries` forbids any file outside `apps/api/src/audit/` from inserting into `audit_log` directly — verified by deliberate-violation fixture.

### Story 1.9: tools.manifest.ts skeleton with CI lint (no-tool-without-manifest)

As a developer,
I want a `tools.manifest.ts` registering every agent tool with `{ name, description, inputSchema, outputSchema, maxLatencyMs, fn }` plus a CI lint blocking PRs adding a tool without a manifest entry,
So that §3.5 budget computation has the data it needs at runtime.

**Acceptance Criteria:**

**Given** Story 1.6 is complete,
**When** Story 1.9 is complete,
**Then** `apps/api/src/agents/tools.manifest.ts` exists with the registry shape `Map<ToolName, ToolSpec>` and a placeholder tool to verify wiring works.
**And** `apps/api/scripts/check-tool-manifest.ts` scans `apps/api/src/agents/tools/*.tools.ts`, verifies each exported tool has all five required fields in the manifest; missing → exit 1 with diagnostic.
**And** `pnpm tools:check` is wired into `.github/workflows/ci.yml` as a required check.
**And** runtime sampling skeleton in `apps/api/src/observability/tool-latency.histogram.ts` exposes `recordToolLatency(toolName, latencyMs)` writing to Redis sliding-window histogram (full Grafana alert wiring deferred until tools land in Epic 3).

### Story 1.10: RealTime SSE bridge + central InvalidationEvent dispatcher

As a developer,
I want the central client-side SSE bridge (`apps/web/src/lib/realtime/`) that connects to `/v1/events`, parses typed `InvalidationEvent`s, and dispatches them to `queryClient`,
So that every Epic 2+ feature gets near-real-time UI invalidation for free.

**Acceptance Criteria:**

**Given** Story 1.3 is complete (`InvalidationEvent` contract exists),
**When** Story 1.10 is complete,
**Then** `apps/web/src/lib/realtime/sse.ts` exports `createSseBridge(queryClient)` that opens an `EventSource` to `/v1/events?client_id={uuid-from-sessionStorage}`, validates each incoming event with the Zod schema, and dispatches via exhaustive `switch` on `event.type`.
**And** non-thread events call `queryClient.invalidateQueries(...)`; `thread.turn` events use `setQueryData` (the streaming exception per architecture amendment); `thread.resync` refetches from `from_seq`.
**And** reconnect with exponential backoff (1s × 2× ±20% jitter, cap 60s) and `Last-Event-ID` resume.
**And** thread-sequence-gap detection: when `thread.turn` arrives with `server_seq != previous_seq + 1`, fires beacon to `/v1/internal/client-anomaly` with `{ kind: 'thread_integrity', thread_id, expected_seq, received_seq }` (full beacon endpoint lands in Epic 5; this story stubs the call site with `TODO` reference).
**And** unit tests verify dispatcher against fake SSE feed for each event type.

### Story 1.11: Reduced-motion + reduced-transparency hooks + accessibility lint

As a developer,
I want `useReducedMotion()` and `useReducedTransparency()` hooks plus `eslint-plugin-jsx-a11y` strict configuration,
So that every component built in Epic 2+ has access to the reduced-motion/transparency state for fallback rendering.

**Acceptance Criteria:**

**Given** Story 1.5 is complete,
**When** Story 1.11 is complete,
**Then** `apps/web/src/lib/a11y/use-reduced-motion.ts` exports `useReducedMotion()` returning `boolean` derived from `window.matchMedia('(prefers-reduced-motion: reduce)')`, updating reactively.
**And** `apps/web/src/lib/a11y/use-reduced-transparency.ts` exports `useReducedTransparency()` similarly.
**And** unit tests verify both hooks update on simulated `MediaQueryList.change` events.
**And** `eslint-plugin-jsx-a11y` strict rules in `packages/eslint-config-hivekitchen` cause `pnpm lint` to fail on any jsx-a11y violation.

### Story 1.12: Contrast audit harness in packages/design-system

As a developer,
I want `packages/design-system/contrast-audit.test.ts` programmatically verifying every token color pair against required WCAG ratios,
So that token additions cannot silently regress contrast and the WCAG 2.2 AA + AAA carve-out commitments are enforced in CI.

**Acceptance Criteria:**

**Given** Story 1.4 is complete,
**When** Story 1.12 is complete,
**Then** `packages/design-system/contrast-audit.test.ts` reads token definitions from `colors.css`, generates the matrix of required pairs (body text on each surface bg, focus indicator on each bg, trust chip text on each chip bg), computes WCAG contrast ratio per pair, fails the test if any pair falls below the bar (AAA 7:1 body, AA 3:1 non-text, 4.5:1 trust chips).
**And** test failure output names the failing pair, computed ratio, required ratio.
**And** initial pass produces zero failures against the v2.0 token set; wired into `pnpm test:design-system` and `.github/workflows/ci.yml`.

### Story 1.13: Anchor-device perf budgets + Lighthouse CI in .github/workflows/perf.yml

As a developer,
I want `.github/workflows/perf.yml` running Lighthouse CI against simulated anchor-device conditions (Samsung Galaxy A13 on throttled 4G — Slow 4G + 4× CPU throttle) failing PRs that exceed budgets,
So that UX-DR60 performance commitments are enforced from Epic 1 onward.

**Acceptance Criteria:**

**Given** Story 1.10 is complete,
**When** Story 1.13 is complete,
**Then** `.github/workflows/perf.yml` runs on every PR, builds `apps/{web,marketing}`, serves locally, runs `@lhci/cli` with custom mobile preset matching anchor-device throttle.
**And** `apps/web/lighthouserc.json` defines per-route budgets matching UX Spec §13.8 (Ready-Answer Open FCP ≤1.2s anchor; SSE invalidation flow via `apps/web/test/perf/sse-invalidation.spec.ts` Playwright timing).
**And** budget violations block PR merge; LHCI uploads artifact JSON reports to GHA artifacts.

### Story 1.14: PR template with patterns checklist + CI orchestration

As a developer,
I want `.github/PULL_REQUEST_TEMPLATE.md` enumerating the patterns checklist plus `.github/workflows/ci.yml` orchestrating typecheck → lint → unit → integration → e2e → a11y → contracts:check → tools:check → db diff as required gates,
So that every PR explicitly attests to non-mechanizable rules and CI mechanizes the rest.

**Acceptance Criteria:**

**Given** Stories 1.1–1.13 are complete,
**When** Story 1.14 is complete,
**Then** `.github/PULL_REQUEST_TEMPLATE.md` includes checklist with: PII redaction, error type catalog, audit event_type, design-system update, scope-allowlist update, tool maxLatencyMs.
**And** `.github/workflows/ci.yml` runs all gates in order with Turborepo cache for early exit; each stage failure blocks merge; required-status-check policy enforced.
**And** Turborepo remote cache configured (Cloudflare or Vercel free tier) for cross-PR build acceleration.
**And** smoke-test PR demonstrates all required CI gates pass green.

---

## Epic 2: Household Onboarding & Profile

I can become a HiveKitchen household. I sign up, complete a 10-minute voice (or text) interview anchored on three signal questions, and the system knows my family well enough to draft my first plan within 90 seconds.

### Story 2.1: Supabase Auth — email/password + Google/Apple OAuth

As a Primary Parent,
I want to create a HiveKitchen household account using email/password or Google/Apple OAuth,
So that I can begin onboarding without having to create yet another account from scratch (FR1).

**Acceptance Criteria:**

**Given** Supabase Auth is configured per Story 1.6 plugin wiring,
**When** I visit `/auth/login` and choose email/password or OAuth,
**Then** Supabase Auth handles authentication, returns a Supabase session, and our `auth.service.ts` exchanges that for a HiveKitchen access token (15min) + refresh cookie (30d, httpOnly, Secure, SameSite=Lax, Path=/v1/auth/refresh).
**And** on successful first-time auth, a `households` row is created with the new user as Primary Parent and the user is redirected to onboarding (`/auth/callback?next=/onboarding`); on returning auth, redirected to `/app` (Brief).
**And** `audit.service.write({event_type: 'auth.login', user_id, request_id, metadata: {method: 'email'|'google'|'apple'}})` fires.

### Story 2.2: 4-role RBAC preHandler + JWT rotation-on-use

As a developer,
I want a single Fastify preHandler enforcing the 4-role RBAC model with rotating refresh tokens,
So that every authenticated route resolves `(user_id, household_id, role)` consistently and refresh-token theft is auto-detected.

**Acceptance Criteria:**

**Given** Story 2.1 is complete,
**When** Story 2.2 is complete,
**Then** `apps/api/src/middleware/authenticate.hook.ts` registered as Fastify `onRequest` hook on all `/v1/*` routes (excluding `/v1/internal/*`, `/v1/webhooks/*`, `/v1/auth/login|refresh|logout`); validates Bearer JWT, rejects 401 on invalid/missing.
**And** `authorize.hook.ts` reads `request.user.role` and validates against per-route requirement; 403 on mismatch.
**And** `household-scope.hook.ts` sets `request.user.current_household_id` claim used by Postgres RLS.
**And** `POST /v1/auth/refresh` reads cookie, validates against `refresh_tokens` table, issues new access + rotates refresh; reuse of consumed token revokes all sessions for the user, audits `auth.refresh.reuse_detected`, returns 401.

### Story 2.3: Secondary Caregiver invite primitive (signed JWT, single-use jti, 14-day TTL)

As a Primary Parent,
I want to invite a Secondary Caregiver to my household with scoped access via a single-use 14-day-TTL invite link,
So that my partner can join without creating their own account from scratch (FR10).

**Acceptance Criteria:**

**Given** I am authenticated as Primary Parent,
**When** I post `POST /v1/households/:id/invites` with `{role: 'secondary_caregiver', email?}`,
**Then** server signs a JWT with claims `{household_id, role, invite_id (jti), exp: now+14d}`, persists row in `invites` table with `redeemed_at: null`, returns the invite URL `/invite/{base64url(jwt)}`.
**And** when invitee opens the URL in browser, `apps/web/src/routes/invite/$token.tsx` (cross-scope) calls `POST /v1/auth/invites/redeem`, server validates jti unredeemed, marks `redeemed_at`, creates Supabase Auth user (or links to existing), returns role + scope target.
**And** redeemed-jti reuse → `410 Gone` with `Problem+JSON { type: '/errors/link-expired' }`.
**And** audit row `invite.redeemed` written with `correlation_id = invite_id`.

### Story 2.4: Account profile management + recovery

As a Primary Parent,
I want to manage my own account profile (email, password, display name) and recover access via password reset or auth-provider recovery,
So that I can update my details independently of household/child profiles and never get locked out (FR11, FR12).

**Acceptance Criteria:**

**Given** I am authenticated,
**When** I update my profile via `PATCH /v1/users/me` or initiate password reset via `POST /v1/auth/password-reset`,
**Then** Supabase Auth handles the underlying credential change; my `users.display_name`, `email`, `preferred_language` columns update; OAuth users see "Manage at Google/Apple" instead of password reset.
**And** `audit.service.write({event_type: 'account.updated' | 'auth.password_reset_initiated', ...})` fires.
**And** password reset emails go through SendGrid with one-time signed link; expires in 1h.

### Story 2.5: Notification preferences + cultural-language preference

As a Primary Parent,
I want to configure when and how Lumi reaches out (weekly plan ready, grocery list ready, Heart Note window reminders) and my preferred language for cultural terms,
So that the system respects my contact preferences and renders culturally-correct family-language without re-asking (FR105, FR106).

**Acceptance Criteria:**

**Given** I am authenticated,
**When** I update notification preferences via `PATCH /v1/users/me/notifications` and cultural-language via `PATCH /v1/users/me/preferences`,
**Then** values persist on `users` table (notification_prefs JSONB, cultural_language enum).
**And** the family-language ratchet (UX-DR47) is initialized to my chosen language; once changed forward (e.g., "Grandma" → "Nani"), system never retreats.

### Story 2.6: Voice-first onboarding interview via ElevenLabs (three signal questions)

As a Primary Parent,
I want a voice-first onboarding interview anchored on three signal questions ("What did your grandmother cook?" / "What's a Friday in your house?" / "What does your child refuse?"),
So that I can complete profile setup conversationally in under 10 minutes without filling out fields, and Lumi can infer cultural and palate context from natural prose (FR2, UX-DR64).

**Acceptance Criteria:**

**Given** Story 2.1+2.2 are complete and ElevenLabs plugin wired (Story 1.6),
**When** I start onboarding at `/onboarding` and choose voice,
**Then** ElevenLabs voice session opens via `POST /v1/voice/token`, agent prompts the three signal questions in sequence using `apps/api/src/agents/prompts/onboarding.prompt.ts`, transcripts persist in onboarding thread.
**And** session length budget ≤10 min; interview uses `<EarlyAckPulse>` non-verbal pulse for thinking moments (per Story 5.x voice patterns) — never speech-fillers.
**And** at end, agent presents inferred household summary (cultural templates, palate notes, allergens mentioned) for confirmation; child profiles created (Story 2.10) only after parent confirms.

### Story 2.7: Text-equivalent onboarding path

As a Primary Parent who declines voice,
I want a text-based conversational onboarding with equivalent outcome to the voice interview,
So that I get identical product capabilities and tier access whether I used voice or text (FR3, FR4).

**Acceptance Criteria:**

**Given** Story 2.6 is complete,
**When** I start onboarding at `/onboarding` and choose text,
**Then** the same `onboarding.prompt.ts` runs but the orchestrator interacts via text turns in the onboarding thread; same three signal questions; same inferred-summary confirmation step.
**And** declining voice surfaces no degradation in tier capabilities, plan quality, or feature access.
**And** voice can be enabled later via `/app/settings/preferences` without re-onboarding.

### Story 2.8: COPPA soft-VPC signed declaration (beta)

As a Primary Parent,
I want to sign a digital consent declaration during beta onboarding as the verifiable-parental-consent mechanism,
So that the system has audit-able VPC for beta period before credit-card VPC takes over at public launch (FR8).

**Acceptance Criteria:**

**Given** I am at the onboarding consent step,
**When** I sign the plain-language consent declaration,
**Then** `vpc_consents` row persists with `(household_id, mechanism: 'soft_signed_declaration', signed_at, signed_by_user_id, document_version)` and is immutable thereafter.
**And** `audit.service.write({event_type: 'vpc.consented', correlation_id: household_id, metadata: {mechanism}})` fires.
**And** consent declaration text is the version committed at `apps/api/src/modules/compliance/consent-declarations/v1.md` (versioned per legal review).

### Story 2.9: Parental notice disclosure pre-data-collection

As a Primary Parent,
I want a comprehensive parental notice describing what data is collected, by whom (HiveKitchen + processors), for what purpose, and retention horizon, delivered at signup before any child data collection,
So that I have informed consent baseline aligned with COPPA + AADC posture (FR14).

**Acceptance Criteria:**

**Given** I have created an account but not yet added a child,
**When** I reach the "Add your first child" step,
**Then** the parental notice modal appears (allowed exception per UX-DR37 — informational not confirmation), listing all named processors (Supabase, ElevenLabs, SendGrid, Twilio, Stripe, OpenAI), data categories, purposes, retention horizons.
**And** notice acknowledgment persists on `users.parental_notice_acknowledged_at`; subsequent child-add attempts blocked until acknowledged.
**And** notice is linkable from every child-facing surface and from Settings.

### Story 2.10: Add child profile with envelope-encrypted sensitive fields

As a Primary Parent,
I want to add one or more children with name, age-band, declared allergies, school food-policy constraints, and palate preferences, with sensitive fields envelope-encrypted at rest,
So that my child's allergens, cultural identifiers, and dietary preferences carry the encryption posture that AADC's most-protective-defaults requires (FR5, NFR-SEC-1).

**Acceptance Criteria:**

**Given** Story 2.9 is complete and Vault plugin wired (Story 1.6),
**When** I add a child via `POST /v1/households/:id/children`,
**Then** `children` row persists; `declared_allergens`, `cultural_identifiers`, `dietary_preferences` JSONB columns are envelope-encrypted via per-household DEK wrapped by Vault KEK; `caregiver_relationships` similarly.
**And** decryption happens in `children.repository.findById()` for in-process use; never logged (per Story 1.7 Pino redaction).
**And** allergen-rule version snapshotted on child row for guardrail invariant.

### Story 2.11: Cultural-template inference + parental confirm

As a Primary Parent,
I want the system to infer starter cultural template composition from my onboarding conversation and present the result for my confirmation before committing,
So that I'm never asked "select your culture" via a picker — Lumi notices and I ratify (FR6, FR7, UX-DR42, UX-DR44).

**Acceptance Criteria:**

**Given** the onboarding interview transcript exists,
**When** I reach the inference-summary step,
**Then** the agent extracts cultural priors (`detected` state) with `confidence` and `presence` per `CulturalPrior` schema, surfaces them as a thread turn: *"I noticed [X] comes up — want me to keep that in mind?"* with three options [Yes] [Tell Lumi more] [Not for us].
**And** my response writes `TemplateStateChangedEvent` (`detected → opt_in_confirmed` or `forgotten`); audit row `template.state_changed` fires.
**And** zero priors ratified = silence-mode default (UX-DR46) — no cultural recognition surfaces in plans until I opt in to one.

### Story 2.12: Per-child Lunch Bag slot declaration

As a Primary Parent,
I want to declare per child whether the Snack slot and Extra slot are active during onboarding (Main is always active),
So that the plan generator knows which slots to fill before the first plan is composed (FR107).

**Acceptance Criteria:**

**Given** Story 2.10 is complete (child created),
**When** I complete the slot-declaration step (`PATCH /v1/children/:id/bag-composition`),
**Then** `children.bag_composition JSONB` persists `{main: true, snack: bool, extra: bool}`.
**And** changes post-onboarding (FR108) take effect on the next plan-generation cycle, not retroactively.

### Story 2.13: Visible Memory write primitives (memory_nodes seed)

As a developer,
I want the `memory_nodes` and `memory_provenance` tables seeded with initial nodes from onboarding,
So that Epic 7's Visible Memory panel has data to render and Epic 5's conversation enrichment has a write target from day 1.

**Acceptance Criteria:**

**Given** Story 1.3 is complete (memory contracts) and migration `20260502090000_create_memory_nodes_and_provenance.sql` has run,
**When** Story 2.6 onboarding completes,
**Then** initial `memory_nodes` rows are written for each disclosed allergen, cultural identifier, palate note, and family rhythm, with `memory_provenance` rows linking back to the onboarding turn (`source_type='onboarding'`).
**And** `memory.note` agent tool is registered in `tools.manifest.ts` for Epic 5 to call from Evening Check-in.

### Story 2.14: Onboarding mental-model copy + anxiety-leakage telemetry

As a Primary Parent,
I want the last step of onboarding to teach the no-approval mental model with two short sentences, said once,
So that I don't look for a "save" button on every plan edit thereafter (UX-DR65, UX-DR66).

**Acceptance Criteria:**

**Given** the inferred summary is confirmed (Story 2.11),
**When** the onboarding completes,
**Then** the final screen renders two sentences once: *"The plan is always ready. Change anything, anytime. You don't need to approve it."* and *"Changes save as you go. No button needed."* — no coachmarks, no tooltips, never repeated.
**And** week-1–2 telemetry tracks per-tile retry events; if a tile sees ≥3 retries of the same edit by the same user within 60s, the optional ghost-timestamp escalation activates (3-second "saved just now" under the tile, then fades) — ships behind `households.tile_ghost_timestamp_enabled` flag, off by default, on-demand from evidence.

---

## Epic 3: Weekly Plan & Ready-Answer Open

I open HiveKitchen and find next week's plan ready, composed by Lumi with my family's constraints honored. I make zero or one or two adjustments via tap or one sentence to Lumi, and close in under 90 seconds.

### Story 3.1: Allergy Guardrail Service (deterministic, authoritative, outside agent boundary)

As a Primary Parent,
I want every plan to pass through a deterministic rule-based allergy guardrail that runs outside the agent process boundary as the sole authority on render-eligibility,
So that no LLM hallucination, prompt injection, or guardrail tool failure can ever surface an allergen-containing plan to me (FR76, FR77, Pre-Step-1 Ruling).

**Acceptance Criteria:**

**Given** migration creates `allergy_rules` (top-9 FALCPA allergens + parent-declared) and `guardrail_decisions` tables,
**When** a plan is composed by the orchestrator and submitted to `allergyGuardrail.clearOrReject(plan, household)`,
**Then** the deterministic engine in `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts` evaluates every ingredient against every declared allergen for every child, returns `{verdict: 'cleared'|'blocked', conflicts: Conflict[]}`, and on success the service writes `plans.guardrail_cleared_at` + `plans.guardrail_version` atomically with the plan row.
**And** `plans.repository.findById()` includes `WHERE guardrail_cleared_at IS NOT NULL` for any read intended for presentation; lint rule on the file forbids `SELECT *` from `plans` without that clause.
**And** the same `allergy-rules.engine.ts` is imported by `apps/api/src/agents/tools/allergy.tools.ts` for the advisory `allergy.check` tool — single source of truth.

### Story 3.2: Domain orchestrator + LLMProvider adapter (OpenAI primary, Anthropic stub)

As a developer,
I want the agent orchestrator wrapped behind a `LLMProvider` interface with OpenAI adapter and Anthropic stub,
So that the NFR-mandated 15-min provider failover (NFR-REL-5, AR-2) is achievable without rewriting agent code.

**Acceptance Criteria:**

**Given** Story 1.6 (OpenAI plugin) is complete,
**When** Story 3.2 is complete,
**Then** `apps/api/src/agents/providers/llm-provider.interface.ts` exports `interface LLMProvider { complete(prompt, tools, options): Promise<LLMResponse>; stream(...): AsyncIterable<LLMEvent> }`.
**And** `openai.adapter.ts` wraps `@openai/agents` SDK; `anthropic.adapter.ts` is a stub raising `NotImplementedError` (full implementation deferred, but interface lock-in from day 1).
**And** `orchestrator.ts` constructor takes `{provider: LLMProvider, services: {memory, recipe, pantry, allergyGuardrail, ...}}` bundle; SDK types confined to adapter file; circuit-breaker around `provider.complete()` (5 failures in 60s → swap, 15-min health-check recovery) writes `audit.llm.provider.failover` on swap.

### Story 3.3: Planner specialist agent + planner.prompt.ts versioned

As a developer,
I want the planner specialist agent registered with `apps/api/src/agents/prompts/planner.prompt.ts` versioned and tested,
So that prompt changes are auditable and I can pin specific household to specific prompt versions during regression investigation.

**Acceptance Criteria:**

**Given** Story 3.2 is complete,
**When** Story 3.3 is complete,
**Then** `planner.prompt.ts` exports a versioned object `{version: 'v1.0.0', text: '...', toolsAllowed: ['recipe.search', 'recipe.fetch', 'memory.recall', 'pantry.read', 'plan.compose', 'allergy.check', 'cultural.lookup']}`.
**And** orchestrator passes the planner agent's allowed-tool-set to the LLMProvider; tools outside the allowed set throw `ForbiddenToolCallError`.
**And** every plan row carries `prompt_version` for audit reconstruction.

### Story 3.4: Agent tools — recipe/memory/pantry/plan/allergy/cultural — registered with maxLatencyMs

As a developer,
I want all six planner agent tools (`recipe.search`, `recipe.fetch`, `memory.recall`, `pantry.read`, `plan.compose`, `allergy.check`, `cultural.lookup`) implemented and registered in `tools.manifest.ts` with declared `maxLatencyMs`,
So that the orchestrator's sync-vs-early-ack split (per architecture amendment T) is computable and the runtime sampling alarm catches drift.

**Acceptance Criteria:**

**Given** Story 1.9 (manifest CI lint) is complete,
**When** Story 3.4 is complete,
**Then** each tool exists in `apps/api/src/agents/tools/` with input/output Zod schemas + implementation calling its corresponding service (never repository directly).
**And** `tools.manifest.ts` declares `maxLatencyMs` per tool (recipe.search=300, recipe.fetch=100, memory.recall=200, pantry.read=80, plan.compose=2000, allergy.check=150, cultural.lookup=80).
**And** `recordToolLatency` from Story 1.9 is invoked on every tool call; Grafana alert configured to fire when sampled p95 > declared × 1.5 for ≥1h.

### Story 3.5: Plan repository + revision versioning + presentation-bind contract

As a developer,
I want `plans` and `plan_items` tables with revision versioning and a `plan.commit` transaction writing `guardrail_cleared_at` + `guardrail_version` atomically,
So that the presentation-bind contract is structurally enforced and concurrent mutations don't race.

**Acceptance Criteria:**

**Given** Story 3.1 is complete,
**When** Story 3.5 is complete,
**Then** migrations create `plans` (id, household_id, week_id, revision, generated_at, guardrail_cleared_at NULL, guardrail_version NULL) and `plan_items` (plan_id, child_id, day, slot, recipe_id, item_id, ingredients JSONB).
**And** `plans.service.commit(plan)` runs guardrail then writes plan + guardrail status in one transaction; on guardrail block, regenerates with rejection in context (max 3 retries).
**And** `plans.repository.findByIdForPresentation()` enforces `WHERE guardrail_cleared_at IS NOT NULL`; `findByIdForOps()` allows pre-clearance reads with explicit `// presentation-bypass: ops-audit` comment lint exception.

### Story 3.6: brief_state projection writer

As a developer,
I want the `brief_state` Postgres table maintained by an application writer that updates on `plan.updated`/`memory.updated`/`thread.turn` events,
So that Brief reads are O(1) single-row lookups serving the <3s render SLO and silent staleness is impossible (architecture §1.5).

**Acceptance Criteria:**

**Given** migration creates `brief_state(household_id PK, moment_headline, lumi_note, memory_prose, plan_tile_summaries JSONB, generated_at, plan_revision)`,
**When** any of the three triggering events fire,
**Then** `apps/api/src/modules/plans/brief-state.composer.ts` recomposes the projection row idempotently; writes are guarded by `plan_revision` to avoid stale overwrite.
**And** `GET /v1/households/:id/brief` reads single-row from the projection; never composes at request time.
**And** projection write failure logs `error` and emits `brief.projection.failure` audit row but does not block the triggering event.

### Story 3.7: Plan-generation BullMQ job with per-TZ schedule

As a Primary Parent,
I want next week's plan composed automatically Friday PM through Sunday AM in my local timezone,
So that the Sunday-evening Ready-Answer Open finds a plan already ready (resolves AR-18, FR21).

**Acceptance Criteria:**

**Given** ioredis + BullMQ plugins wired (Story 1.6),
**When** Story 3.7 is complete,
**Then** `apps/api/src/jobs/plan-generation.job.ts` enqueues per-household plan-generation jobs based on `households.timezone`; Pacific kicks Friday 6pm local, Eastern Friday 6pm local, etc.
**And** worker concurrency tuned to LLM provider rate-limit; per-household max queue wait ≤4h; full batch completes within 36h for entire active base.
**And** per-job retry on transient failure (3 retries with exponential backoff); permanent failure escalates to ops anomaly dashboard.

### Story 3.8: BriefCanvas + MomentHeadline + LumiNote components

As a Primary Parent,
I want the Brief surface to render the Moment + Note + Plan composition on open,
So that I see my week as a finished answer, not a chat prompt or empty state (UX-DR15-17, FR16).

**Acceptance Criteria:**

**Given** Story 3.6 is complete (projection has data),
**When** I navigate to `/app` (Brief),
**Then** `<BriefCanvas>` renders `<MomentHeadline>` (Instrument Serif 32pt, `<h1>`) + `<LumiNote>` (Inter 17pt, terracotta indent) + 5× `<PlanTile>` row + `<FreshnessState>`; reads from `useBriefStateQuery()` (TanStack Query, staleWhileRevalidate).
**And** initial paint ≤1.2s on anchor device (Story 1.13 enforces); cached state served instantly with background refetch.
**And** `<BriefCanvas>` has scope-locked dev-mode runtime assertion to `.app-scope` only.

### Story 3.9: PlanTile component with all states + variants

As a Primary Parent,
I want each day's plan to render as a `<PlanTile>` with clear states (decided / pending-input / swap-in-progress / locked / mutability-frozen) and variants (today / upcoming / past),
So that I can see at a glance what's decided and what needs my attention (UX-DR18, FR16, FR17).

**Acceptance Criteria:**

**Given** Story 3.8 is complete,
**When** Story 3.9 is complete,
**Then** `<PlanTile>` renders day header (weekday + date as `<h2>`), dish line (Inter 19pt semibold), method-of-preparation caption, optional `<TrustChip>` row.
**And** `today` variant has morning-only amber tint; `past` variant low-saturation non-interactive; `locked` variant shows `<PresenceIndicator>` inline; `mutability-frozen` shows explainer Popover on tap (Sunday 4hr lockdown window).
**And** keyboard-operable: Tab navigation, Enter triggers swap flow, Esc returns focus.

### Story 3.10: AllergyClearedBadge + Popover with audit link

As a Primary Parent of a child with declared allergies,
I want every plan with allergy-relevant ingredients to show an affirmative `<AllergyClearedBadge>` with audit popover,
So that I have at-a-glance reassurance that today's lunch was checked, and an audit trail when I want to verify (UX-DR24, FR79).

**Acceptance Criteria:**

**Given** the household has declared allergens,
**When** a plan renders that contains allergen-adjacent ingredients (e.g., legumes for a peanut-allergic child),
**Then** `<AllergyClearedBadge>` renders with safety-cleared-teal pill + checkmark + text "Cleared for [Name]'s [allergen]".
**And** tap opens Popover with copy *"We checked every ingredient against [Name]'s [allergen] allergy. Nothing in today's lunch contains [allergen] or was made near them."* + "View audit" link to thread audit trail.
**And** badge re-checks on any `plan.updated` event with new `guardrail_verdict`; stale verdicts force `re-checking` state (foliage soft pulse).
**And** never destructive-red — uses `safety-cleared-teal` token only.

### Story 3.11: FreshnessState + QuietDiff components

As a Primary Parent,
I want the Brief to honestly tell me when data is stale, missing, or in-flight (`<FreshnessState>`) and to show me silently-mutated scaffolding changes via a low-emphasis rear-view (`<QuietDiff>`),
So that presentational silence never becomes evasive silence and I trust the system (UX-DR19, UX-DR28, freshness contract).

**Acceptance Criteria:**

**Given** Story 3.8 is complete,
**When** Story 3.11 is complete,
**Then** `<FreshnessState variant=fresh|stale|loading|failed>` renders as single-line Inter 13pt warm-neutral-500 — never replaces surface, annotates it.
**And** `<QuietDiff>` renders inline banner above Brief with one-line summary of scaffolding mutations since last view ("Swapped Tuesday's protein to match pantry"); persistent `⋯` opens "why?" Popover.
**And** `<QuietDiff>` never renders allergy/dietary/safety mutations — those escalate to `<AccountableError>` or `<ThreadTurn role=system>` (loud by design per silent-mutation carve-out).

### Story 3.12: Per-slot independent swap + day-swap + skip/sick

As a Primary Parent or Secondary Caregiver,
I want to edit any day's plan by swapping individual slots independently, swapping with another day's plan, or marking the day skip/sick,
So that I can adjust without re-planning the whole week (FR18, FR20).

**Acceptance Criteria:**

**Given** Story 3.9 is complete,
**When** I tap a slot and select an alternative (or drag a tile to swap days, or tap "Skip"),
**Then** `PATCH /v1/plans/:id/items/:itemId` fires with `Idempotency-Key`; non-allergen swaps optimistic with rollback (Safety-Classified Field Model); allergen-affecting swaps render pending until guardrail confirms (FR79).
**And** sick-day pause stops Lunch Link delivery without altering underlying plan (FR20); plan_items row marks `paused_at`.

### Story 3.13: Plan regeneration request

As a Primary Parent,
I want to request regeneration of a full week or specific day with the same constraint set,
So that I can ask Lumi to try again when a particular plan doesn't land (FR23).

**Acceptance Criteria:**

**Given** Story 3.5 is complete,
**When** I tap "Regenerate week" or "Regenerate Tuesday" on a plan,
**Then** `POST /v1/plans/:id/regenerate?scope=week|day` enqueues a fresh plan-generation job; rate-limited to 5/week/household per architecture §3.6.
**And** old plan_items archived (not deleted) with `replaced_by_plan_id`; new plan goes through allergy guardrail; on success, SSE `plan.updated` invalidates Brief.

### Story 3.14: Following week's draft view

As a Primary Parent,
I want to view next week's draft beginning Friday afternoon of the preceding week,
So that I have visibility into Lumi's composition before the Sunday open (FR21).

**Acceptance Criteria:**

**Given** Story 3.7 is complete,
**When** I navigate to `/app/plan` after Friday 4pm local time of the preceding week,
**Then** the upcoming-week tab is enabled; `GET /v1/plans?week=next` returns the draft if generated, otherwise `<FreshnessState variant=loading>` "Lumi is drafting next week — about 30 seconds".

### Story 3.15: Historical plans + outcomes view

As a Primary Parent,
I want to view historical plans and their outcomes (emoji ratings, swaps made) for any prior week,
So that I can see the family's eating history and reference what worked (FR25).

**Acceptance Criteria:**

**Given** Story 3.5 + Epic 4 lunch_link_sessions (rated outcomes) exist,
**When** I navigate to `/app/plan/:weekId` for a past week,
**Then** plan tiles render in `past` variant (low-saturation, non-interactive) with rating overlay (emoji from FR36 Layer 1, per-item Layer 2 swipes if any).
**And** the swap history is visible per-tile via tap → Popover.

### Story 3.16: School-policy update + propagation

As a Primary Parent,
I want to update declared school-policy constraints (nut-free rule, no-heating rule) and have the changes propagate through all affected future plans,
So that policy changes silently regenerate impacted days without my re-planning (FR22).

**Acceptance Criteria:**

**Given** I am authenticated,
**When** I update school policy via `PATCH /v1/children/:id/school-policies`,
**Then** affected future plan_items are flagged for regeneration; per-slot policy scoping (FR112) regenerates only items in the targeted slot for affected days.
**And** affected plans pass through guardrail; SSE `plan.updated` fires.

### Story 3.17: System adjusts on policy/leftover/calendar changes

As a Primary Parent,
I want the system to automatically adjust affected future-day plans when school policy changes, leftover state shifts, or cultural-calendar events arrive,
So that I don't have to re-plan when the world shifts under me (FR19).

**Acceptance Criteria:**

**Given** Stories 3.16 (policy) and Epic 6 (pantry) and 3.18 (cultural calendar) exist,
**When** any triggering event fires,
**Then** the orchestrator re-evaluates impacted future plans, regenerates as needed, passes through guardrail, fires SSE `plan.updated` with `<QuietDiff>` summary for scaffolding changes (loud `<AccountableError>` for safety changes).

### Story 3.18: Cultural-calendar awareness + L0/L1 priors

As a Primary Parent of a culturally-identified household,
I want the plan generator to weight upcoming cultural observances (Diwali, Shabbat, Ramadan, Lent, Navaratri) into plan composition without my prompting, plus L0 preference memory ("Maya doesn't eat bell peppers") and L1 method/ingredient priors,
So that my Diwali-week plan reflects mithai and puri without me typing the word Diwali (FR26, UX-DR42, UX-DR43).

**Acceptance Criteria:**

**Given** Story 2.11 has populated cultural priors,
**When** plan generation runs and `cultural_calendar.observances` shows an upcoming event for an opt-in-confirmed prior,
**Then** the orchestrator passes the observance + prior to the planner agent prompt; planner weights culturally-appropriate dishes for affected days.
**And** L0 preferences (relational, no opt-in needed) silently filter out refused items; L1 method priors (no opt-in, inferred from accepted plans) influence preparation.
**And** silence-mode households (zero ratified priors) see no cultural-recognition surfaces; planner uses neutral defaults.

### Story 3.19: Day-level context overrides

As a Primary Parent,
I want a defined set of day-level context overrides (Bag-suspended / Half-day / Field-trip / Sick-day / Post-dentist / Early-release / Sport-practice / Test-day) that temporarily modify composition for a single (child, day),
So that one-off events don't require permanent profile changes (FR118).

**Acceptance Criteria:**

**Given** Story 2.12 is complete,
**When** I tap an override option on a specific day,
**Then** `POST /v1/plans/:id/items/:itemId/override` writes `day_overrides` row; override auto-reverts after the day; Lumi proposes Sport-practice/Field-trip overrides from calendar signal per FR119.

### Story 3.20: Lunch Bag composition modification + Snack-vs-Main modeling

As a Primary Parent,
I want to modify any child's Lunch Bag composition (Snack on/off, Extra on/off) at any time post-onboarding, with Snack modeled as item-level SKUs and Main modeled as recipes,
So that the shopping list and store-mode reflect the right modeling (FR108, FR109, FR110, FR111).

**Acceptance Criteria:**

**Given** Story 2.12 is complete,
**When** I modify composition via `PATCH /v1/children/:id/bag-composition`,
**Then** changes take effect on next plan-generation cycle (not retroactively).
**And** Snack rows in plan_items use `item_sku` reference (linking to `snack_skus` table); Main rows use `recipe_id` reference; Extra supports either.

### Story 3.21: Pin/ban Extra component types + reusable Extra library

As a Primary Parent,
I want to pin component types (e.g., "always include a fruit") to the Extra slot and ban specific types (e.g., "no sweet treat ever") for a specific child, plus save parent-authored Extras as reusable entries,
So that my child's Extra slot reflects my preferences without re-stating them weekly (FR114, FR115, FR117).

**Acceptance Criteria:**

**Given** Story 3.20 is complete,
**When** I pin/ban via `PATCH /v1/children/:id/extra-rules` or save a custom Extra via `POST /v1/households/:id/extra-library`,
**Then** rules persist on `children.extra_rules JSONB` and `extra_library` table; planner respects pins (always includes) and bans (never proposes) in subsequent plans.

### Story 3.22: Passive bias from Extra removals + high-activity Extra proposal

As a Primary Parent,
I want the system to passively weight my repeated removal of an Extra item as a preference signal, and to propose adding an Extra on high-activity days for children whose Extra is normally off,
So that Lumi learns from my actions without making me explain (FR116, FR119).

**Acceptance Criteria:**

**Given** Stories 3.20+3.21 are complete,
**When** I remove the same Extra type ≥3 times within 30 days,
**Then** that type's selection probability for that child drops in subsequent plans (passive bias, no UI confirmation).
**And** when an on-calendar high-activity event (sport practice, field trip) is detected for a child whose Extra is off, planner proposes adding an Extra for that day; I confirm before commit.

### Story 3.23: Per-slot policy scoping + bag-wide allergy rule

As a Primary Parent,
I want school-policy rules to support per-slot scoping (bag-wide / Main-only / Snack-only / Extra-only) while allergy-safety rules apply bag-wide without exception,
So that a "no peanuts in Snack" school rule doesn't trigger needless Main regeneration, but allergens are caught wherever they appear (FR112, FR113).

**Acceptance Criteria:**

**Given** Story 3.16 is complete,
**When** I tag a school policy with a slot scope,
**Then** `school_policies.slot_scope` enum (`bag_wide|main|snack|extra`) persists; only items in the matching slot regenerate on policy change.
**And** allergy-safety rules in the guardrail engine ignore slot scope — allergen in any slot triggers full-plan rejection.

### Story 3.24: Allergy-uncertainty flagging + safe substitution

As a Primary Parent,
I want plan items with unverifiable ingredient provenance flagged for safety, with safe substitution where possible or surface to me for resolution,
So that uncertainty doesn't ship as silent risk (FR81).

**Acceptance Criteria:**

**Given** Story 3.1 is complete,
**When** the guardrail evaluates a plan and an ingredient lacks verified allergen-status,
**Then** the engine returns `verdict: 'uncertain'` with the specific ingredient flagged; orchestrator first attempts safe substitution; on failure, plan surfaces uncertainty to me via `<AccountableError>` with explicit substitute-or-pick affordance.

### Story 3.25: Hard-fail escalation (no safe plan possible)

As a Primary Parent,
I want a hard-fail case (no safe plan possible given my constraints) to escalate to ops and to me with a transparent description,
So that I know the system tried and what went wrong (FR82).

**Acceptance Criteria:**

**Given** Stories 3.5+3.24 are complete,
**When** the planner exhausts attempts and no safe plan exists for a household,
**Then** `audit.service.write({event_type: 'plan.hard_fail', stages: [...attempts]})` fires; ops anomaly dashboard alerts; parent receives in-app `<AccountableError>` *"Lumi couldn't compose a safe plan this week. Our ops team is reviewing — we'll be back to you within an hour."*

### Story 3.26: Graceful-degradation state UX

As a Primary Parent,
I want the Brief to render an honest graceful-degradation state when Lumi cannot generate a safe plan,
So that I see "Lumi is working on it" rather than a broken or empty surface (FR24).

**Acceptance Criteria:**

**Given** Story 3.25 is complete,
**When** plan composition fails and ops is engaged,
**Then** Brief renders `<FreshnessState variant=failed>` with the honest copy *"Lumi is reworking this week's plan. We'll have it ready by [estimated time]."* — never a spinner, never an evasive "Something went wrong."

### Story 3.27: Variant preparation active-learning (visible to parent before delivery)

As a Primary Parent,
I want Lumi to occasionally propose variant preparations of an existing item to capture child-rating delta as an active-learning signal, with the variant visible to me before delivery,
So that the system probes preference space without bypassing my approval per Principle 1 (FR127).

**Acceptance Criteria:**

**Given** Stories 3.5+3.21 are complete and a child has rated an item ≥3 times,
**When** the planner identifies a candidate variant,
**Then** the variant proposal renders on the affected day's `<PlanTile>` in `pending-input` state with two pills: [Try the variant] [Keep the original]; I confirm before plan commit; rating delta tracked for learning.

### Story 3.28: Pause Lunch Link for child on day without altering plan

As a Primary Parent,
I want to pause the Lunch Link for a specific child on a specific day without altering the underlying plan,
So that a sick day doesn't trigger Lunch Link delivery but the plan history remains intact (FR20).

**Acceptance Criteria:**

**Given** Stories 3.5 + Epic 4 lunch_link infrastructure exist,
**When** I tap "Pause Lunch Link" on a (child, day),
**Then** `lunch_link_sessions` row marked `suppressed_at`; SendGrid/Twilio job skips delivery; underlying plan_item retained for history.

### Story 3.29: Degraded-propose state with try_alternating_sovereignty toggle

As a Primary Parent of an interfaith household,
I want a clear surface when "honor all rules" intersection collapses to near-empty (e.g., Kosher + Halal + Hindu-veg with no shared protein), with a one-tap toggle to switch to alternating sovereignty,
So that the household isn't stuck with rice-and-steamed-vegetables plans (UX-DR48, UX-DR49).

**Acceptance Criteria:**

**Given** Story 3.18 (cultural priors) is complete,
**When** the planner detects `CULTURAL_INTERSECTION_EMPTY`,
**Then** `PlanUpdatedEvent.guardrail_verdict.status = 'degraded'` with `reason: 'CULTURAL_INTERSECTION_EMPTY'` and `suggestion: 'try_alternating_sovereignty'`; Brief renders inline note *"This week's plan couldn't honor every rule strictly. Try alternating whose rules lead each day?"* with one-tap mode-switch toggle.

### Story 3.30: LLM-provider failover circuit-breaker + audit

As a developer,
I want the orchestrator's LLMProvider failover automated via circuit-breaker with audit trail,
So that NFR-REL-5's 15-min secondary-provider failover is structural, not heroic (AR-2, integration GG).

**Acceptance Criteria:**

**Given** Story 3.2 is complete,
**When** the OpenAI provider fails 5 times in 60s,
**Then** circuit-breaker opens; orchestrator swaps to next provider in chain; `audit.llm.provider.failover` audit row written with `metadata: {from, to, reason}`; ops Grafana alert fires.
**And** passive health-check probe re-enables OpenAI after 15min if probe call succeeds.

---

## Epic 4: Lunch Link & Heart Note Sacred Channel

My kid receives a Lunch Link with a Heart Note from me, taps an emoji, and starts to feel known. I can compose Heart Notes (text or hold-to-talk) from my phone, schedule them, edit before delivery, and track delivery status.

### Story 4.1: Lunch Link HMAC-signed URLs + lunch_link_sessions table

As a developer,
I want HMAC-signed Lunch Link URLs with daily-rotating keys, 24h overlap, and a `lunch_link_sessions` table tracking redemption,
So that links are forge-resistant, single-use, and the 8pm-local close per FR121 is enforced server-side (AR-9, FR122, FR123).

**Acceptance Criteria:**

**Given** Story 1.6 is complete,
**When** Story 4.1 is complete,
**Then** migration creates `lunch_link_sessions(child_id, date, nonce, exp, first_opened_at, rating_submitted_at, rating, reopened_after_exp_count, suppressed_at)` and `lunch_link_keys` rotating-daily HMAC-key table.
**And** URL format `/lunch/{base64url(payload)}.{hex(hmac)}` where payload = `{child_id, date, nonce, exp: 8pm_local}`; previous-day key retained 24h for clock-skew.
**And** sibling-device case: separate nonce per `(child, device-open-event)` — no cross-child signal leakage.

### Story 4.2: LunchLinkPage (.child-scope) — Heart Note + bag preview + emoji rater

As a child,
I want to open my Lunch Link, see my Heart Note from my parent, see what's in my lunch, and tap an emoji to rate it,
So that I feel known without needing to log in or learn an app (FR35, FR36, FR120, UX-DR23).

**Acceptance Criteria:**

**Given** Story 4.1 is complete,
**When** I open `/lunch/{token}`,
**Then** `<LunchLinkPage>` (.child-scope locked) renders Heart Note (Instrument Serif 28pt sacred-plum, unmodified, `<blockquote>`) + food photo (4:5 aspect-ratio) + emoji row (3-tap response: 🧡 / 🤔 / 😋, 72×72 minimum tap target).
**And** word-optional grammar — every surface usable without reading; Heart Note is `<blockquote>`; emoji buttons have aria-labels.
**And** Layer 2 swipe-right per item card registers per-slot positive preference (FR36); no thumbs-down, no swipe-left exists.
**And** dev-mode runtime assertion: throws if rendered outside `.child-scope`.

### Story 4.3: 8pm window enforcement + 60s grace + 410 Gone post-expiry

As a developer,
I want the 8pm-local rating window enforced server-side with a 60s grace window, returning 410 Gone with `last_state_snapshot` after expiry,
So that ratings can't be retroactively gamed and the "no signal" semantic per FR125 is preserved (FR121, AR-9).

**Acceptance Criteria:**

**Given** Story 4.1 is complete,
**When** a child taps emoji at 7:59:59 vs 8:00:59 vs 8:01:00,
**Then** the first two are accepted (within window or grace); the third returns 410 Gone with `Problem+JSON { type: '/errors/link-expired', last_state_snapshot: {heart_note_excerpt, bag_preview, rating_if_submitted} }`.
**And** re-open after expiry increments `lunch_link_sessions.reopened_after_exp_count` (ops anomaly signal).
**And** absence of rating treated as "no signal" — never as negative preference (FR125).

### Story 4.4: Heart Note composer (text + hold-to-talk voice, envelope-encrypted)

As a Primary Parent or Secondary Caregiver,
I want to compose Heart Notes by text or by hold-to-talk voice for any child for any specific day, with content envelope-encrypted at rest,
So that my voice carries through unmodified and only the intended recipient (and authorized parent) ever sees the content (FR32, FR33, AR-10).

**Acceptance Criteria:**

**Given** Stories 4.1+1.6+envelope-encryption helper exist,
**When** I compose a note via `<HeartNoteComposer>` (.app-scope text variant, .grandparent-scope per Story 4.10),
**Then** content stored in `heart_notes.content` (envelope-encrypted via per-household DEK); plain-text only persisted in audit metadata never includes content.
**And** hold-to-talk variant uses ElevenLabs STT for transcription; transcript becomes the content; voice file deleted after transcription per voice retention policy.

### Story 4.5: Sacred-channel delivery (no AI modification)

As a Primary Parent,
I want my Heart Note delivered to my child exactly as authored — no AI modification, addition, softening, or suggestion,
So that the sacred channel doctrine holds and my child reads my words, not Lumi's interpretation (FR38, FR39).

**Acceptance Criteria:**

**Given** Story 4.4 is complete,
**When** a Heart Note is composed and queued for delivery,
**Then** `<LunchLinkPage>` renders the content character-for-character as authored — no LLM in the delivery path; the content cannot be passed through an agent tool by lint (boundary rule on `heart_notes.repository.findForDelivery`).
**And** Heart Note surface never contains feedback-system, learning-reference, or plan-change copy.

### Story 4.6: Scheduled Heart Note delivery + edit/cancel before window + delivery status

As a Primary Parent,
I want to compose Heart Notes in advance with scheduled delivery for a specific day, edit or cancel before the delivery window opens, and view delivery status,
So that I can write tonight's note tomorrow and track what landed (FR44, FR45, FR46).

**Acceptance Criteria:**

**Given** Story 4.4 is complete,
**When** I schedule a note for a future day via `POST /v1/heart-notes` with `scheduled_for`,
**Then** `heart_notes.status` enum (`draft|scheduled|delivered|viewed|rated|cancelled`) tracks state; edits/cancels allowed while `status IN ('draft', 'scheduled')`.
**And** `GET /v1/heart-notes?household_id` returns delivery-status list filterable by child + date range.

### Story 4.7: SendGrid + Twilio + parent-copied URL multi-channel delivery

As a Primary Parent,
I want Lunch Links delivered via my child's parent-designated channel (email via SendGrid / SMS or WhatsApp via Twilio / parent-copied URL) prior to lunchtime on each school day,
So that my child receives the link wherever they actually look (FR34).

**Acceptance Criteria:**

**Given** Stories 1.6 + 4.1 are complete,
**When** I configure delivery channel per child via `PATCH /v1/children/:id/delivery`,
**Then** `apps/api/src/jobs/lunch-link-delivery.job.ts` reads per-child channel preference, dispatches via SendGrid (email) or Twilio (SMS/WhatsApp); parent-copied URL surfaces in app for manual share.
**And** delivery success ≥99.5% by 7:30am local on school days (NFR-PERF-4); SendGrid/Twilio per-channel fallback within 30 min on failure.

### Story 4.8: Service Worker for /lunch/* route

As a child on a flaky 6:45am school-bus connection,
I want my Lunch Link to render the last successfully-fetched state with a "last synced HH:MM" stamp when the network drops,
So that I see my Heart Note and lunch even when cellular cuts out (AR-17, John+Sally Step-4-party amendment).

**Acceptance Criteria:**

**Given** Story 4.2 is complete,
**When** Story 4.8 is complete,
**Then** `apps/web/src/service-worker.ts` registers a Workbox-based SW scoped to `/lunch/*` route only; caches last successful GET by child token with 24h TTL.
**And** on fetch failure, serves stale with visible "last synced HH:MM" stamp (Inter 13pt warm-neutral-500); rating submission attempts queue for retry on reconnect.
**And** parent-app SW remains deferred (no caching for non-lunch routes).

### Story 4.9: FlavorPassport sparse-page (parent + child variants)

As a Primary Parent,
I want a FlavorPassport showing my child's accumulating flavor profile as a vertical timeline of stamps (no empty grids, no completion mechanic),
So that I can see and treasure my child's becoming without it feeling like a scoreboard (FR37, UX-DR27, Principle 5).

**Acceptance Criteria:**

**Given** Stories 3.5+4.3 (rated outcomes) exist,
**When** I navigate to `/app/children/:id/flavor-passport`,
**Then** `<FlavorPassport>` renders timeline of stamp cards (dish + date + method caption + optional child voice quote); states `empty` (header only, no grid) / `developing` (1-8 stamps) / `established` (9+ with cuisine/texture/method filter).
**And** child variant `/lunch/{token}/passport` (.child-scope) renders same data reordered: what the child liked first, read-aloud-ready, image+voice usable.

### Story 4.10: HeartNoteComposer (.grandparent-scope) with at-cap rhythm copy

As a Grandparent Guest Author,
I want to compose Heart Notes for my grandchild with rate-limit awareness expressed as rhythm copy when I hit the monthly cap,
So that the cap feels like a heartbeat, not a restriction (FR40 partial, UX-DR22).

**Acceptance Criteria:**

**Given** Epic 8 Story 8.x has issued me a Guest Author invite token,
**When** I redeem the invite (Story 2.3 flow with role=guest_author) and navigate to `/guest-author/compose`,
**Then** `<HeartNoteComposer>` (.grandparent-scope locked) renders with Instrument Serif 26pt textarea + cap counter + send affordance "Tuck into Ayaan's Thursday lunch".
**And** at-cap state fully renders (not collapsed) with copy *"Ayaan has both of your notes this month, Nani. The next one opens May 1."* — textarea read-only, "Save for May 1" affordance schedules against next month's first Lunch Link.
**And** family-language word (Nani/Dadi/Lola/Bibi) gets sacred-plum underline on detection (cultural recognition).
**And** dev-mode assertion throws if rendered outside `.grandparent-scope`.

### Story 4.11: Premium voice playback of Heart Note via Lunch Link

As a Premium-tier Primary Parent,
I want to enable voice playback of my Heart Note for the child via the Lunch Link,
So that my hold-to-talk Heart Note can be played by the child (FR41).

**Acceptance Criteria:**

**Given** Stories 4.4 + Epic 8 Premium-tier gating exist,
**When** my tier resolves to Premium (or beta-Premium-stub per E8 dependency note),
**Then** `<LunchLinkPage>` renders a small play-button below the Heart Note text; tap streams the original recording from Supabase Storage via signed URL.
**And** Standard-tier or unauthorized: play-button absent (text-only delivery).

### Story 4.12: Child request-a-lunch text suggestion + parent approval

As a child,
I want to submit a text-based "request a lunch" suggestion that my parent reviews and approves before Lumi incorporates it,
So that I have a voice in what shows up without operating the system (FR42, Boundary 1).

**Acceptance Criteria:**

**Given** Story 4.2 is complete,
**When** I tap "Tell [parent] back" on the Lunch Link and submit a text request,
**Then** `child_lunch_requests` row persists; parent receives in-app proposal in thread (Epic 5) with [Approve] [Adjust] [Decline] options.
**And** approved requests feed planner as a soft signal for future plans; never auto-applied.

### Story 4.13: No Heart Note absence nudges (anti-pattern enforcement)

As a Primary Parent,
I want zero notifications, streaks, or absence-reminders referencing Heart Note authoring frequency,
So that the sacred channel doesn't invert into a guilt engine (FR43, Corollary 3b).

**Acceptance Criteria:**

**Given** Story 1.5 (ESLint config) is complete,
**When** Story 4.13 is complete,
**Then** lint rule `no-heart-note-frequency-reference` blocks any string literal in `apps/web/src/`, `apps/api/src/`, `apps/marketing/src/` matching `streak|reminder|absence|haven't written|been quiet` adjacent to `heart_note` references.
**And** notification preferences UI (Story 2.5) explicitly excludes Heart Note from any toggle; no per-Heart-Note count or streak visible anywhere.

### Story 4.14: Layer 2 per-slot signal weighting + sibling-specific patterns

As a developer,
I want Layer 2 per-slot swipe signals weighted independently in the child-preference learning model and sibling-specific preference patterns distinguished from family-wide,
So that a positive on Maya's Snack doesn't infer Ayaan's Snack and "no signal" never becomes negative (FR124, FR125, FR126).

**Acceptance Criteria:**

**Given** Story 4.2 is complete,
**When** Story 4.14 is complete,
**Then** `child_preferences` table records per-`(child, slot, item, signal_type)` events; planner.tools.recipe.search reads per-child weights only; family-wide patterns require ≥2 children's signals.

### Story 4.15: Allergy transparency log exportable to parent (FR80)

As a Primary Parent of a child with declared allergies,
I want a transparency log exportable to me on request showing every system action taken for allergy-relevant decisions affecting my household,
So that I can verify the safety chain for any incident (FR80).

**Acceptance Criteria:**

**Given** Story 1.8 (audit_log) and Story 3.1 (guardrail decisions) exist,
**When** I request export via `POST /v1/heart-notes/transparency-log` (or via the Visible Memory panel link from Story 7.x),
**Then** server queries `audit_log WHERE household_id = $1 AND event_type LIKE 'allergy.%' ORDER BY created_at`; renders human-readable timeline; exports as JSON or PDF.

### Story 4.16: Multilingual font fallbacks for non-Latin scripts

As a Primary Parent composing Heart Notes in Hindi/Hebrew/Arabic/Tamil/Bengali,
I want my non-Latin script Heart Note to render correctly on the child's Lunch Link without falling back to tofu boxes,
So that the sacred channel honors my language (resolves AR-20, NFR-A11Y-6).

**Acceptance Criteria:**

**Given** Story 1.4 is complete,
**When** Story 4.16 is complete,
**Then** `apps/web/public/fonts/noto-sans-{devanagari|hebrew|arabic|tamil|bengali}.woff2` are self-hosted; `@font-face` declarations in `tokens.css` use `unicode-range` to load only the needed script subset per text content.
**And** `<LunchLinkPage>` and `<HeartNoteComposer>` render text with `dir="auto"` on user-authored text nodes; RTL scripts (Hebrew, Arabic) flow correctly.

---

## Epic 5: Household Coordination & Evening Check-in

My partner and I share the load — we see who's packing tomorrow, hand off mid-week without re-planning, and Lumi already has Wednesday's plan when Devon opens her phone. I can chat with Lumi (voice or text) when it suits me, and she gets noticeably better at understanding my family week by week.

### Story 5.1: Shared family thread + server-assigned monotonic sequence + thread.resync

As a developer,
I want the family thread implemented as an append-only log with server-assigned `server_seq` and a `thread.resync` recovery path,
So that two parents editing simultaneously produce in-order thread state on every client and SSE drops recover deterministically (FR28, UX-DR6, Foundation Gate 1).

**Acceptance Criteria:**

**Given** Story 1.3 (Turn contract) is complete,
**When** Story 5.1 is complete,
**Then** migration creates `threads(id, household_id)` and `thread_turns(id, thread_id, server_seq bigint generated by sequence, role, body jsonb, created_at)`.
**And** `POST /v1/threads/:id/turns` allocates `server_seq` server-side; `GET /v1/threads/:id?from_seq=N` returns turns ordered by `server_seq`.
**And** SSE `thread.turn` carries the new turn with `server_seq`; client detects gaps and triggers `thread.resync` invalidation.

### Story 5.2: SSE channel per (user_id, client_id-per-tab) + presence

As a Primary Parent on multiple tabs,
I want each tab to receive its own SSE stream so multi-parent presence works correctly,
So that "Devon is editing this tile" reflects reality and doesn't collapse two tabs as one user (UX-DR9).

**Acceptance Criteria:**

**Given** Stories 1.10+5.1 are complete,
**When** Story 5.2 is complete,
**Then** `GET /v1/events?client_id={uuid}` registers per-tab connection in Redis; events filter by household membership; `client_id` from sessionStorage (per-tab independence).
**And** server emits `presence.partner-active` events with `SurfaceKind` addressing (brief / plan_tile / thread / etc.); `<PresenceIndicator>` renders top-right of addressed surface, never blocks interaction.

### Story 5.3: ThreadTurn polymorphic envelope (5 body components)

As a Primary Parent,
I want the thread to render polymorphic turn types (message / plan_diff / proposal / system_event / presence) in unified chronological view,
So that voice turns, text turns, plan changes, and system events all appear in one timeline (UX-DR20).

**Acceptance Criteria:**

**Given** Stories 5.1+1.3 are complete,
**When** Story 5.3 is complete,
**Then** `<ThreadTurn>` envelope dispatches on `turn.body.kind` to `<TurnMessage>` / `<TurnPlanDiff>` / `<TurnProposal>` / `<TurnSystemEvent>` / `<TurnPresence>`.
**And** envelope-level states `incoming` (fade-in) / `settled` / `rolled-back` (strikethrough + note) / `redacted` ("Lumi won't use this anymore"); strict `server_seq` ordering; refetch from `from_seq` on `thread.resync`.

### Story 5.4: DisambiguationPicker L1→L4 with bidirectional tether

As a Primary Parent,
I want a tap on "swap Tuesday" to flow into one conversational turn for disambiguation when needed, with a visible link between the source tile and the conversation,
So that the voice/text/tap modality model holds and I never lose track of where I asked or where I'm answering (UX-DR21, Step 5 §Tap-to-Conversation).

**Acceptance Criteria:**

**Given** Stories 5.3+3.9 are complete,
**When** Story 5.4 is complete,
**Then** `<DisambiguationPicker>` levels L1 (binary pills under tile) / L2 (N-way pills) / L3 (inline conversational input) / L4 (tile in pending-input + thread continuation).
**And** L3→L4 tether: source PlanTile pulses sacred-plum 30% alpha at 1.6s breath loop; thread breadcrumb pinned at top *"Continuing from Wednesday's dinner"*.
**And** on resolution, breadcrumb converts to `<QuietDiff>`-style summary; focus returns to tile; pulse stops.
**And** reduced-motion fallback: static plum dot, no animation.

### Story 5.5: Secondary Caregiver invite redemption flow + revoke + transfer

As a Primary Parent,
I want my Secondary Caregiver invite to redeem cleanly with role established at redemption-time, plus the ability to revoke access or transfer primary ownership,
So that household coordination scales to my partner without requiring a separate account (FR10, FR30, FR31).

**Acceptance Criteria:**

**Given** Story 2.3 is complete,
**When** Story 5.5 is complete,
**Then** `/invite/$token` (cross-scope) calls `POST /v1/auth/invites/redeem`, role established, redirects to `(app)/household/settings`.
**And** `DELETE /v1/households/:id/caregivers/:user_id` revokes access without consent; ownership transfer via `POST /v1/households/:id/transfer-primary` requires new-Primary acknowledgment.
**And** all invite, revoke, transfer events audit-logged.

### Story 5.6: PackerOfTheDay + assignment + handoff

As a Primary Parent and partner,
I want to designate which household member is responsible for packing lunch on any given day, with handoff visible on open,
So that we share the load without coordination calls (FR27, UX-DR29).

**Acceptance Criteria:**

**Given** Stories 5.1+5.5 are complete,
**When** I assign packer via `PATCH /v1/households/:id/days/:date/packer`,
**Then** `day_assignments` row persists; SSE `packer.assigned` invalidates Brief; `<PackerOfTheDay>` renders "Tomorrow — Priya's packing" with `<PresenceIndicator>` if she's currently on Brief.
**And** open state ("Nobody's claimed tomorrow") and handoff-in-progress (optimistic) variants supported.

### Story 5.7: Evening Check-in unlimited text + tier-capped voice

As a Primary Parent,
I want unlimited text-based conversation with Lumi at any time on any tier, with voice tier-capped (Standard 10min/wk, Premium unlimited),
So that I can talk to Lumi in the modality that fits me without surprise voice bills (FR56, FR57, FR58).

**Acceptance Criteria:**

**Given** Stories 5.1+1.6 are complete,
**When** Story 5.7 is complete,
**Then** `POST /v1/threads/:id/turns` accepts text turns from authenticated parents unlimited; voice turns require `POST /v1/voice/token` which checks tier — Standard rejects after 10min/wk consumed (`voice_usage` table), Premium unlimited.
**And** soft-cap messaging at 95th percentile per tier (Story 10.x ships full FR104 logic; this story has placeholder counter).

### Story 5.8: ElevenLabs HMAC webhook + early-ack continuation pattern

As a developer,
I want the ElevenLabs webhook validated by HMAC and the orchestrator using sync-vs-early-ack split based on tool-latency manifest,
So that the <800ms first-token SLO holds and Lumi never says "Let me pull that up..." (AR-14, AR-15, architecture amendment T+EE).

**Acceptance Criteria:**

**Given** Stories 1.6+1.9+3.4 are complete,
**When** Story 5.8 is complete,
**Then** `POST /v1/webhooks/elevenlabs` validates `X-Elevenlabs-Signature` HMAC; failure → 401 + `voice.webhook.auth_failed` audit.
**And** orchestrator sums `maxLatencyMs` of expected tool chain; ≤6000ms → synchronous response; >6000ms → early-ack `{response: "one sec.", continuation: {resume_token, expected_within_ms}}`; for 1.5–4s estimated → non-verbal SSE `presence.lumi-thinking` orb pulse, no speech.
**And** continuation handler runs async, emits final response via thread SSE; ElevenLabs plays acknowledgement first then continuation.
**And** ESLint rule blocks string literals matching "Let me pull that up" or "Just a moment" or similar assistant-theatrical fillers.

### Story 5.9: Concurrent caption fallback for voice output

As a Primary Parent using voice,
I want concurrent text captions for Lumi's voice output, accessible via screen reader and visible without opt-in,
So that I never miss what Lumi said and accessibility is structural not optional (FR60, NFR-A11Y-3, UX-DR58).

**Acceptance Criteria:**

**Given** Story 5.8 is complete,
**When** Lumi delivers a voice response,
**Then** the same response text streams into the thread as a `<TurnMessage>` with `aria-live=polite` announcement; `<VoiceOverlay>` displays caption synchronized with audio playback; "Text only" toggle in accessibility settings disables TTS without losing thread content.

### Story 5.10: Adaptive Lumi tone/length + parent-initiated only

As a Primary Parent,
I want Lumi's conversational length and tone to adapt to context (time of day, recent activity), with conversation always parent-initiated (Lumi never proactive),
So that Sunday-evening conversations are longer and Tuesday-7am taps get a one-line answer, and Lumi doesn't interrupt me (FR61, FR63).

**Acceptance Criteria:**

**Given** Story 5.7 is complete,
**When** Story 5.10 is complete,
**Then** orchestrator passes context signals (`time_of_day`, `last_active_at`, `current_surface`) to the planner/support prompts; prompt instructs response-length and tone adaptation.
**And** no system-initiated turns, push notifications, or unsolicited Lumi messages — even on plan-ready or grocery-list-ready events (those surface only via SSE invalidation, not as conversational turns).

### Story 5.11: Passive profile-enrichment via memory.note tool

As a Primary Parent,
I want Lumi to extract profile-enrichment signals from my conversational mentions without me having to issue explicit profile-update commands,
So that mentioning "Diwali in three weeks" silently enriches the cultural calendar without me typing the word (FR59, AR-7).

**Acceptance Criteria:**

**Given** Stories 5.7+2.13 are complete,
**When** I mention an enrichable signal in conversation,
**Then** the orchestrator calls `memory.note` agent tool; tool writes to `memory_nodes` with `source_type='turn'`, `source_ref` linked to the originating turn, `confidence` from the agent.
**And** new memory nodes show on Visible Memory panel (Epic 7) with provenance chip.

### Story 5.12: "I noticed" learning moments with confirm/correct

As a Primary Parent,
I want a periodic "I noticed" surface that makes profile enrichment legible and offers me confirm or correct,
So that the accumulating intelligence is visible rather than uncanny (FR62).

**Acceptance Criteria:**

**Given** Story 5.11 is complete,
**When** Lumi accumulates ≥3 inferences within a period or hits a confidence threshold for a single inference,
**Then** the home surface (Brief footer or Note slot) renders a `<LumiNote variant=cultural-recognition>` *"I've noticed [X] — want me to keep that in mind?"* with [Yes] [Tell more] [Not for us] options.
**And** my response writes `TemplateStateChangedEvent` or `memory.confirm/correct` audit row.

### Story 5.13: Plan-reasoning explanations on demand

As a Primary Parent,
I want to ask Lumi to explain why she chose a specific meal for a specific day and receive a plan-reasoning answer,
So that the agent's reasoning is auditable when I'm curious or doubtful (FR64).

**Acceptance Criteria:**

**Given** Stories 3.5+3.8 (audit stages) are complete,
**When** I tap "Why this?" on a `<PlanTile>`,
**Then** Lumi reads the plan's `audit_log.stages JSONB[]` for `correlation_id = plan_id` and renders prose explanation in thread referencing the relevant memory nodes, cultural priors, pantry state, and constraints.
**And** explanation is generated upstream at plan-compose time and cached; never LLM-on-scroll.

### Story 5.14: Cultural recognition L2/L3 + ratification turns + family-language ratchet

As a Primary Parent of a culturally-identified household,
I want L2 meal-pattern recognition (e.g., "Keeping Jollof Friday") and L3 family-language recognition (e.g., "Nani's dal is on the week") with ratification turns initiated by Lumi, plus the family-language ratchet (forward-only),
So that recognition is in language not ornament and my family's terms preserve as I introduce them (UX-DR43, UX-DR44, UX-DR47).

**Acceptance Criteria:**

**Given** Stories 5.11+5.12 are complete,
**When** a prior reaches `suggested` state,
**Then** Lumi originates ratification turn in thread with three options [Yes, keep it in mind] [Not quite — tell more] [Not for us]; taps translate to `TemplateStateChangedEvent`.
**And** L2 requires `opt_in_confirmed` AND user-used-pattern-name-first (language-discovered gate); L3 requires `active` state AND linked memory-node citation; sacred-plum tint on family-language word.
**And** family-language ratchet: once household uses "Nani", Lumi never retreats to "Grandma" — `users.preferred_family_language_terms JSONB` tracks ratchet state.

### Story 5.15: Geolocation opt-in (household-level only)

As a Primary Parent,
I want geolocation off by default at household and child level, with opt-in only at household level for cultural-supplier directory routing,
So that no child is geolocation-tracked and AADC most-protective-defaults posture holds (FR74, NFR-PRIV-3).

**Acceptance Criteria:**

**Given** Story 2.4 is complete,
**When** I opt in via `PATCH /v1/households/:id/preferences` with `geolocation_enabled: true, purpose: 'cultural_supplier_routing'`,
**Then** household row records opt-in with `consented_at`, purpose enum; child-level geolocation never available.
**And** opt-in event audit-logged; revoke via same endpoint flips to false.

### Story 5.16: Voice transcript retention controls (90d default + opt-in longer / immediate-delete)

As a Primary Parent,
I want voice transcripts retained for a 90-day default with opt-in longer retention or immediate deletion at any time,
So that I control my voice data without being locked into a single retention model (FR75).

**Acceptance Criteria:**

**Given** Stories 5.7+5.8 are complete,
**When** Story 5.16 is complete,
**Then** `voice_transcripts` table has `retention_until` per row; nightly job purges expired transcripts.
**And** `PATCH /v1/users/me/voice-retention` with `{mode: 'default_90d' | 'extended_1y' | 'immediate_delete'}` updates household-wide policy; `POST /v1/voice-transcripts/:id/delete` immediately purges a specific transcript.

### Story 5.17: Thread-integrity-anomaly client beacon

As a developer,
I want the client-side thread-sequence-gap detector firing beacons to `/v1/internal/client-anomaly`,
So that Journey-5-class silent-state-divergence is observable post-launch (architecture amendment Mary + S compensating control).

**Acceptance Criteria:**

**Given** Story 1.10 (sequence-gap stub) is complete,
**When** Story 5.17 is complete,
**Then** `/v1/internal/client-anomaly` route exists in `apps/api/src/modules/internal/internal.routes.ts`, accepts Zod-discriminated payload `{kind: 'thread_integrity', thread_id, expected_seq, received_seq}`.
**And** payload writes to `thread_integrity_anomalies` table; per-IP rate-limit 10 req/min; no user JWT required; CORS allowlisted to authenticated app origins only (per architecture amendment BB).
**And** Grafana dashboard exposes anomaly rate; ops alert at >10 anomalies/hour.

---

## Epic 6: Grocery & Silent Pantry-Plan-List Loop

When I shop, the list is in store-aisle order and routes specialty ingredients to the right store within 5 miles. When I'm done tapping items off, I never have to update a pantry. Next week's plan respects what's actually in my fridge.

### Story 6.1: Shopping list derivation from current week's plan

As a Primary Parent,
I want the system to derive a shopping list from the current week's plan accounting for inferred pantry state, without requiring manual pantry entry,
So that the list is ready when I am (FR48).

**Acceptance Criteria:**

**Given** Stories 3.5+3.20 are complete,
**When** I navigate to `/app/grocery/list`,
**Then** `GET /v1/households/:id/grocery-list?week=current` reads plan_items, subtracts inferred pantry contents, returns items grouped by category.
**And** Snack items render as a distinct section visually and ordinally separate from Main-recipe ingredients (FR110).

### Story 6.2: Store-mode UI (one-handed, aisle-aware sort, sticky check-off)

As a Primary Parent at the grocery store,
I want a store mode optimized for one-handed use with store-layout-aware sort and sticky running check-off count,
So that I can shop without thinking (FR49).

**Acceptance Criteria:**

**Given** Story 6.1 is complete,
**When** I tap "Store mode" at `/app/grocery/store`,
**Then** UI renders large text (≥17pt), single-column, store-aisle-sorted list with sticky header showing running count `12/24 done`, tap-target ≥48px.
**And** haptics fire on check-off where supported; CSS `prefers-reduced-motion` respected.

### Story 6.3: Cultural-supplier directory routing (multi-store split list)

As a Primary Parent of a culturally-identified household with geolocation opt-in,
I want specialty ingredients routed to appropriate stores via the cultural-supplier directory, producing a multi-store split list,
So that I know to grab atta from Haji's and milk from Kroger (FR50).

**Acceptance Criteria:**

**Given** Stories 5.15+6.1 are complete,
**When** my plan includes specialty ingredients (atta, halal meat, paneer, jollof rice) and I have geolocation opted in,
**Then** `cultural_suppliers` table seeded with major US-metro routings; planner queries within 5-mile radius of household location; list renders with per-store sub-sections.
**And** when no supplier within range, ingredient routes to "general grocery" with annotation.

### Story 6.4: Tap-to-purchase silent pantry update + parent-correctable inference

As a Primary Parent,
I want marking items purchased to silently update inferred pantry state without me opening any pantry surface, and the option to correct inference when it disagrees with reality,
So that the Pantry-Plan-List loop closes silently and I have a recovery path when it's wrong (FR51, FR55).

**Acceptance Criteria:**

**Given** Story 6.2 is complete,
**When** I tap an item to mark purchased,
**Then** `POST /v1/grocery-items/:id/purchase` writes to `pantry_state` (item, quantity, purchased_at) silently; no UI confirmation, no pantry surface opens.
**And** `PATCH /v1/households/:id/pantry/:item` allows manual correction (e.g., "we already had 2 of these"); inference confidence drops on correction.

### Story 6.5: Leftover-aware swap proposals

As a Primary Parent,
I want the system to propose leftover-aware plan swaps when pantry state indicates surplus or soon-to-expire items,
So that the spinach in my fridge becomes Wednesday's lunch instead of waste (FR52).

**Acceptance Criteria:**

**Given** Stories 6.4+3.17 are complete,
**When** pantry inference detects surplus or expiry-window items,
**Then** orchestrator proposes a swap via Lumi turn in thread (Epic 5) referencing the affected day; parent confirms before plan_items mutate.
**And** confirmed swap fires `plan.updated`; `<QuietDiff>` summarizes "Tuesday's protein swapped for the spinach".

### Story 6.6: Add non-plan items + connectivity-loss UX

As a Primary Parent,
I want to add household staples not tied to the lunch plan to my shopping list, and to have honest connectivity-loss UX in store mode,
So that the list serves my whole grocery run and offline drops don't lose my taps (FR53, FR54).

**Acceptance Criteria:**

**Given** Story 6.2 is complete,
**When** I add an item via `POST /v1/grocery-items` with `source: 'manual'`,
**Then** item appears in list; doesn't affect pantry inference for plan generation.
**And** in store mode, connectivity loss >3s renders unobtrusive banner *"You're offline. I'll catch up when you're back."*; in-flight check-offs marked pending; resync on reconnect.

---

## Epic 7: Visible Memory & Trust Controls

I can see exactly what Lumi has learned about my family in plain prose. I can edit a sentence, soft-forget anything, hard-reset the child's flavor journey once a year, or wipe my entire account in 30 days. I can download an auditable JSON export of everything Lumi has on us.

### Story 7.1: Visible Memory panel with authored prose from projection

As a Primary Parent,
I want a Visible Memory panel rendering authored prose snapshots (not searchable lists, not LLM-on-scroll),
So that what Lumi has learned reads as warm, written-by-Lumi sentences and renders instantly (FR65, FR70, UX-DR25, AR-7).

**Acceptance Criteria:**

**Given** Stories 1.10+3.6+5.11 are complete,
**When** I navigate to `/app/memory`,
**Then** `<VisibleMemorySentence>` rows render from `brief_state.memory_prose` snapshot (pre-composed at plan-compose time); each sentence Inter 16pt warm-neutral-800 with always-visible `⋯` affordance.
**And** first-time reveal: `⋯` pulses honey-amber once for 4s with one-time helper *"Tap ⋯ to see where this came from or ask Lumi to forget it"*; dismissed after first interaction or 4s.

### Story 7.2: Provenance chips + edit + delete primitives

As a Primary Parent,
I want every memory sentence to show provenance metadata (when learned, source type) on tap, plus the ability to edit or delete any specific data point,
So that Visible Memory is editable, not just viewable (FR66, FR67, FR73).

**Acceptance Criteria:**

**Given** Story 7.1 is complete,
**When** I tap `⋯` on a sentence,
**Then** Popover renders `<ProvenanceChip>` showing source turn link, confidence, last-used; options [Edit] [Forget] [Adjust].
**And** edit triggers `PATCH /v1/memory/:nodeId` (reconciliation before next plan-gen); delete triggers soft-forget (Story 7.3).

### Story 7.3: Soft-forget + nightly soft→hard promotion job

As a Primary Parent,
I want soft-forget semantics ("Lumi won't use this anymore") with nightly soft→hard promotion job after `soft_forget_at + 30d`,
So that I have a 30-day recovery window per architecture §1.2 (UX-DR8 Phase 1 only ships soft).

**Acceptance Criteria:**

**Given** Story 7.2 is complete,
**When** I soft-forget a memory node,
**Then** `memory_nodes.soft_forget_at` set; sentence updates to "Lumi won't use this anymore — [reason]" within 300ms; `forget.completed` SSE event acknowledges; `audit memory.forgotten` row written.
**And** nightly job `apps/api/src/jobs/memory-forget.job.ts` promotes soft→hard at 30 days; cascades to `memory_embeddings` + `memory_provenance`; tombstone audit row.
**And** hard-forget UX (immediate purge) deferred to Phase 2+ per UX-DR8 — Phase 1 ships soft only.

### Story 7.4: Reset flavor journey (annual)

As a Primary Parent,
I want to initiate a "reset flavor journey" purge of all child-associated artifacts once per year without closing the account,
So that family circumstances change (divorce, cultural identity shift, age progression) without forcing me to recreate the household (FR68).

**Acceptance Criteria:**

**Given** Stories 7.1-7.3 are complete,
**When** I trigger reset via `POST /v1/children/:id/reset-flavor-journey`,
**Then** server checks last-reset > 365 days; cascades soft-forget across all child-associated `memory_nodes`, `child_preferences`, `flavor_passport_stamps`; auditable.
**And** UX confirmation modal (allowed exception) explains scope and irreversibility before execution.

### Story 7.5: Account deletion with 30-day processor erasure

As a Primary Parent,
I want to request full account deletion with data erasure across the platform and all named processors within 30 days,
So that COPPA right-to-delete is honored (FR69, NFR-PRIV-2).

**Acceptance Criteria:**

**Given** Stories 7.1-7.4 are complete,
**When** I request deletion via `POST /v1/households/:id/delete`,
**Then** server soft-deletes household, locks login, queues processor-side deletion jobs (Supabase, ElevenLabs, SendGrid, Twilio, Stripe, OpenAI) with 30-day SLA; daily progress report to compliance dashboard.
**And** at day 30, hard-delete cascade purges all household + child + memory + audit (except regulatory-retention categories per NFR-PRIV-5); final audit row written before household_id is gone.

### Story 7.6: Parental review dashboard (compliance + trust unified)

As a Primary Parent,
I want a parental review dashboard summarising all child-associated data collection, processing, and retention,
So that COPPA/AADC compliance and the trust surface are the same panel, not split (FR70, architecture cross-cutting concern 5).

**Acceptance Criteria:**

**Given** Stories 7.1-7.5 are complete,
**When** I navigate to `/app/memory/dashboard`,
**Then** dashboard renders per-child sections with: declared allergens (Story 2.10), cultural priors (Story 2.11), memory nodes count by source_type, voice transcript retention setting, recent VPC events.
**And** every section links to detail view with per-record audit + delete affordance.

### Story 7.7: Auditable JSON data export (FR71)

As a Primary Parent,
I want to export an auditable copy of all household data in machine-readable JSON within 72 hours of request,
So that my data is portable and the AADC right-to-portability is honored (FR71, NFR-PRIV-6, AR-22 resolved).

**Acceptance Criteria:**

**Given** Stories 7.1-7.6 are complete,
**When** I request export via `POST /v1/households/:id/export`,
**Then** background job composes JSON of all household tables (households, children, memory_nodes, plans, lunch_link_sessions, heart_notes, audit_log subset, vpc_consents, billing summary), encrypted-fields decrypted to clear-text in export, signed for tamper-evidence.
**And** export download URL emailed within 72h; signed URL expires 30 days; audit row `account.exported`.

### Story 7.8: Consent history view (FR72)

As a Primary Parent,
I want to view the consent history associated with my household (VPC events, policy updates acknowledged, data-sharing opt-ins),
So that I have a record of what I agreed to when (FR72).

**Acceptance Criteria:**

**Given** Stories 7.6+2.8 are complete,
**When** I navigate to `/app/memory/consent-history`,
**Then** chronological list of all `vpc.*` and `account.*` audit rows for the household renders with timestamp + mechanism + document version.

### Story 7.9: State-level minor-privacy patchwork overrides

As a developer,
I want a `state_compliance_overrides` table or per-state policy enum on `households` for CT/UT/TX/FL/VA deltas beyond COPPA/AADC baseline,
So that the architectural surface for state-patchwork compliance exists even if the deltas are minimal at MVP (resolves AR-21, NFR-COMP-3).

**Acceptance Criteria:**

**Given** Stories 7.6-7.8 are complete,
**When** Story 7.9 is complete,
**Then** migration creates `state_compliance_overrides(state, override_type, value, effective_from)` table; `households.state_residency` enum populated from billing address.
**And** compliance module can query `getOverridesForHousehold(household_id)` returning empty array at MVP (no deltas yet); structure exists for future deltas.

### Story 7.10: Payload-scrubbing primitive for future sharing surface

As a developer,
I want a payload-scrubbing primitive that strips child-identifying fields before any sharing surface egresses content,
So that any future trusted-circle recipe sharing (post-MVP) cannot accidentally leak child PII (PRD §10, architecture cross-cutting 12).

**Acceptance Criteria:**

**Given** Stories 7.5-7.9 are complete,
**When** Story 7.10 is complete,
**Then** `apps/api/src/modules/compliance/payload-scrubber.ts` exports `scrubForSharing(payload)` removing all fields tagged Safety-Classified-Sensitive (child_name, declared_allergens, cultural_identifiers, dietary_preferences, child-level rating).
**And** unit tests verify the scrubber on representative payloads; built but unused at MVP — primitive ready for any future sharing feature.

---

## Epic 8: Billing, Tiers & Gift Subscriptions

I (or a grandparent gifting the subscription) can subscribe to Standard or Premium, switch tiers within a billing period, cancel anytime cleanly, and configure school-year start/end dates so I don't pay for summer break.

### Story 8.1: Stripe checkout integration + Standard/Premium tier subscriptions

As a Primary Parent,
I want to subscribe to Standard ($6.99/mo or $69/yr) or Premium ($12.99/mo or $129/yr) via Stripe checkout,
So that I can become a paying customer with my preferred billing cadence (FR84, FR85).

**Acceptance Criteria:**

**Given** Story 1.6 (Stripe plugin) is complete,
**When** I tap "Subscribe" on `/app/billing/manage`,
**Then** `POST /v1/billing/checkout` creates Stripe Checkout Session with selected tier + cadence; redirects to Stripe-hosted page; on completion, Stripe webhook (Story 8.5) provisions household subscription.
**And** `subscriptions` table tracks `(household_id, tier, cadence, status, started_at, current_period_end)`.

### Story 8.2: School-year auto-pause via parent-declared calendar

As a Primary Parent,
I want school-year aligned billing with automatic pause during school holidays based on my declared school calendar,
So that I don't pay for summer break (FR93, AR-19 resolved by parent-declared anchoring).

**Acceptance Criteria:**

**Given** Story 8.1 is complete,
**When** I configure school-year via `PATCH /v1/households/:id/school-year` with `{start_date, end_date}`,
**Then** subscription auto-pauses at `end_date` (Stripe pause-collection); auto-resumes at next year's `start_date`; pre-pause notification sent.
**And** parent-declared calendar is the source of truth (per AR-19); optional US federal holiday API enrichment as proposal-only.

### Story 8.3: Upgrade/downgrade + cancel + receipts

As a Primary Parent,
I want to upgrade from Standard to Premium or downgrade from Premium to Standard at any time within a billing period, cancel anytime with explicit confirmation, and access billing receipts,
So that the billing surface respects me without dark patterns (FR86, FR87, FR92).

**Acceptance Criteria:**

**Given** Story 8.1 is complete,
**When** I trigger `PATCH /v1/billing/subscription` with `{tier}` or `DELETE /v1/billing/subscription`,
**Then** Stripe pro-rates upgrade/downgrade; cancellation requires explicit confirmation step (no dark pattern); receipts fetchable via `GET /v1/billing/receipts`.

### Story 8.4: Failed-payment grace + service-continuity

As a Primary Parent whose card expired,
I want a grace period and notification with service-continuity messaging on payment failure,
So that I have time to update without losing access (FR91).

**Acceptance Criteria:**

**Given** Story 8.5 (webhook) is complete,
**When** Stripe sends `invoice.payment_failed`,
**Then** `subscriptions.status = 'grace_period'`; service-continuity messaging surfaces in-app for 7 days; SendGrid email reminder at day 0, 3, 6.
**And** at day 7, `status = 'past_due'`; Lunch Link delivery suspended; account remains accessible to update billing.

### Story 8.5: Stripe webhook (HMAC-validated)

As a developer,
I want the Stripe webhook validated via HMAC signature handling all subscription lifecycle events,
So that Stripe is the source of truth for subscription state and webhook tampering is prevented (AR-14).

**Acceptance Criteria:**

**Given** Story 1.6 is complete,
**When** Stripe POSTs to `/v1/webhooks/stripe`,
**Then** `Stripe-Signature` header validated; events `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`, `customer.subscription.updated` handled; idempotent via Stripe event id.
**And** all events audit-logged with `event_type='billing.<stripe_event>'`.

### Story 8.6: Gift subscription purchase ($129/yr Premium)

As a Grandparent,
I want to purchase a gift subscription for a specified household at $129/yr Premium,
So that I can give my grandchild's family the product (FR88).

**Acceptance Criteria:**

**Given** Stories 8.1+8.5 are complete,
**When** I navigate to `/gift/purchase` (.grandparent-scope) and complete Stripe checkout with the recipient household identifier,
**Then** `gift_subscriptions(payer_user_id, recipient_household_id, tier, redemption_token, status, expires_at)` row created; recipient receives gift-redemption email with link.
**And** redemption activates Premium tier on recipient household; gift-purchaser audit row.

### Story 8.7: Guest Heart Note authoring add-on ($24/yr) + signed JWT invite

As a Grandparent gift-purchaser,
I want to optionally purchase Guest Heart Note authoring permission alongside the gift, triggering a signed-JWT invite for me to compose Heart Notes,
So that my notes can land in my grandchild's lunchbox (FR40, FR89).

**Acceptance Criteria:**

**Given** Story 8.6 is complete,
**When** I add the Guest Author add-on at gift checkout,
**Then** Stripe processes additional $24/yr; on success, server issues 7-day-TTL signed JWT invite (`role: guest_author`, monthly cap = 2 notes); invite link sent to my email.
**And** redemption flow (Story 5.5) routes me to `(grandparent)/guest-author/compose` with rate-limit enforcement per Story 4.10.

### Story 8.8: Redeem gifted subscription (FR13)

As a Primary Parent receiving a gift,
I want to redeem the gifted subscription by accepting access to the gift-configured household,
So that the gift activates my Premium tier without me having to subscribe separately (FR13).

**Acceptance Criteria:**

**Given** Story 8.6 is complete,
**When** I open the gift-redemption email link,
**Then** `POST /v1/billing/gifts/redeem` with token validates `gift_subscriptions.status = 'pending'`, marks `redeemed_at`, sets household subscription to Premium covering the gift period.
**And** original gift purchaser receives confirmation email.

### Story 8.9: Gift cancellation before redemption with full refund

As a Grandparent gift-purchaser,
I want to cancel a gift before redemption and receive a full refund,
So that the gift can be retracted cleanly if circumstances change (FR94).

**Acceptance Criteria:**

**Given** Story 8.6 is complete,
**When** I trigger `DELETE /v1/billing/gifts/:id` while `status = 'pending'`,
**Then** Stripe refunds the full amount; `gift_subscriptions.status = 'cancelled'`; recipient redemption link returns 410 Gone; audit row.

### Story 8.10: Premium-tier feature gate logic + activation of Epic 4/5 stubs

As a developer,
I want the Premium-tier feature gate logic shared by Epic 4 (FR41 voice playback) and Epic 5 (FR57 unlimited voice), activated when E8 lands and replacing the always-Premium stubs,
So that beta households experience Premium-equivalent features and paying households are correctly metered (FR41, FR57, FR58, dependency note).

**Acceptance Criteria:**

**Given** Stories 8.1+4.11+5.7 are complete,
**When** Story 8.10 is complete,
**Then** `apps/api/src/modules/billing/tier-gate.service.ts` exposes `isPremium(household_id)` reading from `subscriptions.tier`; during beta period (`households.in_beta = true`), returns true regardless.
**And** Epic 4 voice-playback affordance + Epic 5 unlimited-voice route call this service; the always-Premium stubs are removed.

---

## Epic 9: Ops Dashboard, Compliance Export & Incident Response

When something goes wrong at the safety layer, I see the full three-stage audit timeline within minutes. When a parent submits a support request, I respond within SLA. When a regulator requests records, the Compliance Officer can export the audit-log subset reliably.

### Story 9.1: Allergy-safety anomaly dashboard (.ops-scope)

As an ops operator,
I want an allergy-safety anomaly dashboard with alert severity, household identifier (anonymized where permitted), incident status, and audit-log access,
So that I can triage safety incidents within the 5-minute SLA (FR95, FR83).

**Acceptance Criteria:**

**Given** Stories 1.8+3.1+3.25 are complete,
**When** I navigate to `/ops/allergy-anomalies` (.ops-scope, role-gated),
**Then** dashboard reads `audit_log WHERE event_type IN ('allergy.guardrail_rejection', 'plan.hard_fail', 'allergy.uncertainty')` ordered by recency, with severity badge + status (open/in-progress/resolved).
**And** household IDs anonymized (display hash) unless ops user has elevated permission for de-anonymization (audit-logged).

### Story 9.2: Plan-generation latency + voice cost + guardrail catch-rate + Lunch Link delivery metrics

As an ops operator,
I want plan-gen latency (p50/p95), voice cost per HH, LLM cost per plan, allergy-guardrail catch-rate, Lunch Link 7:30am delivery success-rate metrics in aggregate and per-household (anonymized),
So that NFR cost SLOs and performance SLOs are continuously validated (FR96, NFR-OBS-3).

**Acceptance Criteria:**

**Given** Stories 1.7+3.7+4.7+5.8 are complete,
**When** I navigate to `/ops/metrics`,
**Then** Grafana-embedded dashboard renders all six metric families with 1h/24h/7d/30d windows; per-household drill-down via anonymized HH ID with elevated-permission gate.

### Story 9.3: Three-stage plan-audit timeline component

As an ops operator,
I want a three-stage plan-audit timeline component rendering from `audit_log.stages JSONB[]` via `correlation_id = plan_id`,
So that Journey-5-class incident reconstruction takes seconds, not partition scans (architecture amendment R + Amelia recommendation).

**Acceptance Criteria:**

**Given** Stories 1.8+3.5 are complete,
**When** I open a plan in `/ops/plan-audit/:planId`,
**Then** `<PlanStagesTimeline>` reads single `audit_log` row with `correlation_id = planId`, renders `stages[]` as vertical timeline (context_loaded → tool_call(s) → llm_output → guardrail_verdict) with per-stage timestamp + payload Popover.
**And** index lookup time <50ms even at 50k HH × 5k plans/wk volume.

### Story 9.4: Incident-response SLA workflow

As an ops operator,
I want an SLA workflow automating dashboard alert ≤5min → on-call engineer ≤15min → parent notified ≤1h with transparency log → architectural review ≤24h → backported fix ≤72h,
So that the FR97 incident-response posture is structural, not heroic (NFR-OBS-4).

**Acceptance Criteria:**

**Given** Stories 9.1+1.7 (PagerDuty integration) are complete,
**When** an `allergy.guardrail_rejection` audit row writes,
**Then** Grafana alert fires within 5min; PagerDuty pages on-call engineer; parent-notification template auto-drafts in `/ops/incidents/:id`; Compliance Officer dashboard tracks 24h architectural-review and 72h fix SLAs.

### Story 9.5: Parent support-request channel + ops response with bounded SLA

As a Primary Parent,
I want to submit a support request or feedback message via a defined channel within the product, and to receive a response with bounded SLA,
So that I have a path to a human when needed (FR99, FR100).

**Acceptance Criteria:**

**Given** Stories 1.6+5.1 are complete,
**When** I submit via `POST /v1/support` with `{subject, body}`,
**Then** request persists in `support_requests` table; SLA timer starts; ops sees in `/ops/support` queue.
**And** response from ops via `POST /v1/support/:id/response` writes to my thread as a `<TurnSystemEvent>` with `actor: 'support'`; SLA closure tracked.

### Story 9.6: Compliance Officer audit-log subset export (FR101)

As a Compliance Officer,
I want to export the audit-log subset required for regulatory audit, subpoena, or parental data-request,
So that compliance asks are deliverable on demand (FR101).

**Acceptance Criteria:**

**Given** Stories 1.8+9.1 are complete,
**When** I trigger `POST /v1/ops/compliance/export` with `{scope: 'household'|'date_range'|'event_type', filter}`,
**Then** background job composes filtered `audit_log` subset as JSON or PDF; signed download URL emailed; export action audit-logged with reason field.

### Story 9.7: Audit logs covering all categories (FR98)

As a developer,
I want audit logs covering allergy decisions, plan generations, Heart Note authorship and delivery, Visible Memory edits, billing changes, and account deletions for the regulatory-minimum retention period,
So that the audit substrate is comprehensive (FR98, NFR-PRIV-5).

**Acceptance Criteria:**

**Given** Story 1.8 is complete and each FR-relevant epic writes its audit rows,
**When** Story 9.7 is complete,
**Then** integration test verifies an end-to-end household lifecycle (signup → plan-gen → Heart Note → memory edit → billing change → account delete) produces audit rows for every required category.
**And** retention policies per `audit_event_type` enforced by `audit-archive.job.ts`: 12mo COPPA categories, 10y billing/tax, 7y safety-audit, 30d→cold for memory.*.

### Story 9.8: Guardrail-mismatch + thread-integrity-anomaly + client_errors backing dashboards

As an ops operator,
I want backing dashboards for the three client-anomaly beacon types (guardrail_mismatch, thread_integrity, error),
So that the §4.4 compensating-control set delivers operational signal (architecture amendment S, Mary Step-4-party).

**Acceptance Criteria:**

**Given** Stories 5.17+1.10 are complete,
**When** Story 9.8 is complete,
**Then** `/ops/anomalies/guardrail-mismatch`, `/ops/anomalies/thread-integrity`, `/ops/errors` dashboards render rate + recent samples with payload drill-down.
**And** ops alerts configured at threshold spikes; anomaly traces correlate via `request_id` to OTEL spans (Story 1.7).

---

## Epic 10: Beta-to-Public-Launch Transition

Beta households transition cleanly to paid status at month 5/6 of beta with a 14-day grace refund. Mid-beta the team can run controlled A/B (Standard-only cohort vs control) to validate the tier structure. The compliance posture switches from beta soft-VPC to credit-card VPC at signup.

### Story 10.1: Credit-card VPC at subscription signup ($0.01 immediate-refund)

As a developer,
I want credit-card VPC at subscription signup ($0.01 charge with immediate refund) replacing the beta soft-VPC mechanism,
So that public-launch COPPA posture activates per FR9 (NFR-COMP-1).

**Acceptance Criteria:**

**Given** Stories 8.1+2.8 are complete,
**When** Story 10.1 is complete,
**Then** new household signups (post-`households.in_beta = false` cutover) route through credit-card VPC: $0.01 charge + immediate refund via Stripe; `vpc_consents` row written with `mechanism: 'credit_card'`.
**And** beta households retain their soft-VPC consent (audit-immutable); transition households add a credit-card VPC row at first paid billing event.

### Story 10.2: Beta-to-paid transition flow with 14-day refund window

As a Primary Parent in the beta cohort,
I want a clear transition flow with explicit upgrade confirmation UX and a 14-day first-charge refund window,
So that I'm not surprised by a charge and have a grace period if I change my mind (FR90).

**Acceptance Criteria:**

**Given** Stories 8.1-8.10 are complete,
**When** the team triggers beta-to-paid transition via `POST /v1/ops/transition-cohort` (ops-scope),
**Then** affected households receive in-app + email transition flow: tier selection step + Stripe checkout + 14-day refund window callout; refund within 14 days via `POST /v1/billing/first-charge-refund` (no questions asked).
**And** transition completion sets `subscriptions.first_charged_at`; refund eligibility computed from this timestamp.

### Story 10.3: Tier-variant cohort assignment via households.tier_variant

As an ops operator,
I want tier-variant cohort assignment via `households.tier_variant` column for the month-5 Standard-vs-Premium A/B,
So that we validate the tier structure with controlled experimentation (FR103, AR §5.6).

**Acceptance Criteria:**

**Given** Story 8.10 is complete,
**When** I assign households via `POST /v1/ops/cohorts/assign` with `{household_ids, variant: 'standard_only' | 'control'}`,
**Then** `households.tier_variant` updates; tier-gate.service reads this for affected households (Standard-only forces tier=standard regardless of subscription); audit-logged cohort assignment.
**And** retention metrics tracked per cohort in Grafana for 30d window post-assignment.

### Story 10.4: Voice-cost soft-cap + 95th-percentile messaging + hard rate-limit

As a developer,
I want per-household voice cost monitoring with tier-appropriate soft-cap messaging above the 95th percentile and hard rate-limit on sustained abuse patterns,
So that NFR-COST-1 (<$1/mo Standard) and NFR-COST-2 (<$4/mo Premium p95) are enforced with parent-friendly messaging (FR104).

**Acceptance Criteria:**

**Given** Stories 5.7+9.2 are complete,
**When** Story 10.4 is complete,
**Then** `voice_usage` aggregated per HH per tier; when usage crosses 95th percentile within month, soft-cap message in thread *"Lumi noticed you've been talking a lot — that's wonderful. Just a heads-up, you're in the top 5% of voice users this month."*.
**And** sustained abuse pattern (e.g., bot traffic, >24h continuous voice session) triggers hard rate-limit with explicit user-facing explanation.

### Story 10.5: In-product surveys at validation milestones

As a Primary Parent in the beta cohort,
I want in-product surveys delivered at validation milestones — first-plan satisfaction (within 48h), cultural recognition (week 2 + week 3 for culturally-identified), mid-beta WTP (day 60), post-launch satisfaction (30d post-payment),
So that the team can validate the 60-day kill signals + Premium tier mix per PRD success criteria (FR102).

**Acceptance Criteria:**

**Given** Stories 5.1+8.1 are complete,
**When** Story 10.5 is complete,
**Then** `apps/api/src/modules/ops/survey.scheduler.ts` enqueues surveys based on household lifecycle events (first plan generated, week 2/3 of cultural-identified, day 60, 30d post first charge).
**And** survey turn appears in thread as `<TurnProposal>` with rating + free-text; responses persist in `survey_responses` table; ops dashboard aggregates response rates + outcomes against PRD threshold gates.

---

## Epic 11: Marketing & Public Acquisition

I land on hivekitchen.com, understand what HiveKitchen is, see pricing, try a pre-login interactive demo, and either subscribe or gift a subscription.

(Deferred to near public launch — September 2026)

### Story 11.1: Astro marketing site scaffold + landing page

As a prospective parent,
I want to land on hivekitchen.com and understand what HiveKitchen is in under 30 seconds,
So that I can decide whether to try the demo or learn more.

**Acceptance Criteria:**

**Given** Story 1.1 (Astro scaffold) is complete,
**When** Story 11.1 is complete,
**Then** `apps/marketing/src/pages/index.astro` renders a pain-point-led landing page with hero copy, three signal-question framing, beta sign-up gate (if beta still open) or subscribe CTA (if launched).
**And** Astro builds zero-JavaScript-by-default; LCP <1.5s on anchor device per PRD.
**And** SEO: canonical URL, meta title + description, OpenGraph + Twitter meta, JSON-LD `Organization` + `WebApplication`.

### Story 11.2: Pricing page with structured data

As a prospective parent,
I want to see Standard ($6.99/mo or $69/yr) and Premium ($12.99/mo or $129/yr) pricing with school-year auto-pause clearly explained,
So that I can decide which tier fits my family.

**Acceptance Criteria:**

**Given** Story 11.1 is complete,
**When** I navigate to `/pricing`,
**Then** page renders both tiers with feature comparison + school-year auto-pause callout + gift-purchase entry point.
**And** JSON-LD `Offer` structured data per tier; CTA links to `/auth/login?next=/billing/checkout?tier=...`.

### Story 11.3: Pre-login interactive demo

As a skeptical prospective parent,
I want to try a "demo family" interactive preview before subscribing,
So that I can see Lumi's quality without committing to onboarding.

**Acceptance Criteria:**

**Given** Stories 11.1+3.8 are complete,
**When** I navigate to `/pain-point-demo`,
**Then** page renders a sample BriefCanvas with a curated demo household (Halal + peanut-allergic blended-heritage), interactive swap flow, and "this is how it would look for your family — start your account" CTA.
**And** demo data is static (no API calls, no PII); SEO-indexable.

### Story 11.4: Cultural-community partner pages

As a culturally-identified prospective parent,
I want to read about HiveKitchen's cultural-community partnerships before signing up,
So that I trust the cultural fidelity claims.

**Acceptance Criteria:**

**Given** Story 11.1 is complete,
**When** Story 11.4 is complete,
**Then** `/cultural-partners/{halal|kosher|hindu-vegetarian|south-asian|east-african|caribbean}` pages exist as MDX content collections with native-cook quotes, cultural-recognition examples, and community partner endorsements.
**And** SEO-optimized for intent queries (e.g., "halal school lunch planning").

### Story 11.5: FAQ + legal pages

As a prospective parent,
I want easily-accessible FAQ, Terms, Privacy, and COPPA-AADC notice pages,
So that compliance and trust are visible pre-signup.

**Acceptance Criteria:**

**Given** Story 11.1 is complete,
**When** Story 11.5 is complete,
**Then** `/faq`, `/legal/terms`, `/legal/privacy`, `/legal/coppa-aadc` pages exist; processor list explicit on privacy page.
**And** JSON-LD `FAQPage` on `/faq` for SEO.

### Story 11.6: Gift-purchase entry point + non-indexed authenticated routes

As a Grandparent shopping for a gift,
I want a clear path from `/gift` on the marketing site to the in-app gift purchase flow,
So that I can complete the purchase without confusion (links to FR88).

**Acceptance Criteria:**

**Given** Stories 11.1+8.6 are complete,
**When** I navigate to `/gift`,
**Then** marketing page explains the gift Premium ($129/yr) + Guest Heart Note add-on ($24/yr); CTA links to `/gift/purchase` in app (.grandparent-scope).
**And** robots.txt and per-page meta enforce: marketing routes indexed; `/lunch/*` `noindex,nofollow,noarchive,nosnippet` + `X-Robots-Tag: none`; authenticated app routes `noindex,nofollow`.

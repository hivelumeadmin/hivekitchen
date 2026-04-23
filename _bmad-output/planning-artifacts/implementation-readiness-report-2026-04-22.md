---
workflow: bmad-check-implementation-readiness
date: 2026-04-22
project: hivekitchen
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
overallStatus: READY_WITH_RESERVATIONS
filesIncluded:
  prd: _bmad-output/planning-artifacts/prd.md
  architecture: _bmad-output/planning-artifacts/architecture.md
  epics: _bmad-output/planning-artifacts/epics.md
  ux: _bmad-output/planning-artifacts/ux-design-specification.md
  supporting:
    - _bmad-output/planning-artifacts/product-brief-2026-04-18.md
    - _bmad-output/planning-artifacts/ux-design-directions.html
---

# Implementation Readiness Assessment Report

**Date:** 2026-04-22
**Project:** hivekitchen

## Step 1 — Document Inventory

| Artifact | File | Size | Modified |
|---|---|---|---|
| PRD | `_bmad-output/planning-artifacts/prd.md` | 133 KB | 2026-04-20 22:58 |
| Architecture | `_bmad-output/planning-artifacts/architecture.md` | 145 KB | 2026-04-22 19:12 |
| Epics & Stories | `_bmad-output/planning-artifacts/epics.md` | 215 KB | 2026-04-22 22:44 |
| UX Spec | `_bmad-output/planning-artifacts/ux-design-specification.md` | 220 KB | 2026-04-22 13:31 |
| UX Directions (supporting) | `_bmad-output/planning-artifacts/ux-design-directions.html` | 48 KB | 2026-04-22 13:53 |
| Product Brief (supporting) | `_bmad-output/planning-artifacts/product-brief-2026-04-18.md` | 20 KB | 2026-04-20 23:01 |

**Issues:** None. No duplicate whole/sharded formats. All required artifacts present.
**Selections confirmed by user:** 2026-04-22.

---

## Step 2 — PRD Analysis

### Functional Requirements Extracted

The PRD formally numbers **127 Functional Requirements** across 12 capability sections. (The PRD's own prose says "106"; the requirements list itself extends to FR127 — this is a self-inconsistency worth noting, covered in Completeness Assessment.)

**Family Profile & Onboarding (FR1–FR14):**
- **FR1:** Primary Parent can create a household account through supported authentication methods.
- **FR2:** Primary Parent can complete profile setup via a voice-based onboarding interview as the default onboarding path.
- **FR3:** Primary Parent can complete profile setup via a text-based conversational onboarding with equivalent outcome to the voice interview.
- **FR4:** Primary Parent who declines voice onboarding receives identical product capabilities and tier access as those who use it.
- **FR5:** Primary Parent can add one or more children to the household with name, age-band, declared allergies, school food-policy constraints, and palate preferences.
- **FR6:** Primary Parent can select one or more cultural templates (Halal, Kosher, Hindu vegetarian, South Asian, East African, Caribbean) in any combination, including multi-template composition for blended-heritage households.
- **FR7:** System infers starter cultural template composition from the onboarding conversation and presents the result for parental confirmation before committing.
- **FR8:** Primary Parent can execute a digital signed consent declaration during beta onboarding as the VPC mechanism.
- **FR9:** Primary Parent can execute credit-card VPC at subscription signup.
- **FR10:** Primary Parent can invite a Secondary Caregiver with scoped access, without requiring separate account creation.
- **FR11:** Primary Parent can manage their own account profile (email, password, auth method, display name) separately from household and child profiles.
- **FR12:** Primary Parent can recover account access through password-reset or auth-provider recovery.
- **FR13:** Primary Parent can redeem a gifted subscription by activating a pre-paid tier or accepting access to a gift-configured household.
- **FR14:** System delivers a comprehensive parental-notice disclosure at signup, prior to any child data collection, describing what is collected, by whom, for what purpose, and retention horizon.

**Lunch Bag Composition (FR107–FR120):**
- **FR107:** Primary Parent can declare per child whether Snack and Extra slots are active during onboarding; Main always active.
- **FR108:** Primary Parent can modify any child's Lunch Bag composition at any time post-onboarding; changes take effect on next plan-generation cycle.
- **FR109:** System generates content for every active slot on every scheduled school day, subject to allergy, policy, and cultural constraints.
- **FR110:** System renders Snack items as a distinct section of the derived shopping list; store-mode aisle-path sort groups Snack items together.
- **FR111:** System models Snack content as item-level SKUs with unit-based pantry depletion; Main as recipes with ingredient decomposition; Extra supports either.
- **FR112:** System supports school-policy rules with per-slot scoping; slot-targeted policy change triggers regeneration only of items in that slot.
- **FR113:** Allergy-safety rules apply bag-wide and do not support per-slot scoping.
- **FR114:** Primary Parent can pin a component type (e.g., "always include a fruit") to the Extra slot for a specific child.
- **FR115:** Primary Parent can ban specific component types from the Extra candidate pool for a specific child.
- **FR116:** System passively weights a parent's repeated removal of Extra items as a preference signal for that child.
- **FR117:** Primary Parent can save a parent-authored Extra item as a custom reusable entry in the household's Extra library.
- **FR118:** System supports day-level context overrides (Bag-suspended, Half-day, Field-trip, Sick-day, Post-dentist soft-only, Early-release, Sport-practice, Test-day); Lumi proposes, parent confirms, auto-revert after day.
- **FR119:** System proposes adding an Extra item on a calendar-indicated high-activity day for children whose Extra slot is normally off; parent confirms.
- **FR120:** Lunch Link renders each Lunch Bag component as a distinct visual element beneath the Heart Note; Heart Note visually dominant; Layer-2 swipe gesture supported per item card.

**Weekly Plan Lifecycle (FR15–FR26):**
- **FR15:** System generates a full week of lunch plans in advance, per school day per child, from household profile, per-child composition, pantry state, school policy, cultural context, child palate.
- **FR16:** Primary Parent/Secondary Caregiver can view current week's plan from a default landing surface without prior interaction.
- **FR17:** Primary Parent/Secondary Caregiver can view any individual day's plan with preparation instructions.
- **FR18:** Primary Parent/Secondary Caregiver can edit any day's plan for any child before that day by swapping per slot, swapping days, or marking skip/sick.
- **FR19:** System adjusts affected future-day plans in response to school-policy changes, leftover state shifts, cultural-calendar events without re-plan.
- **FR20:** Primary Parent/Secondary Caregiver can pause Lunch Link for a specific child on a specific day without altering plan.
- **FR21:** Primary Parent can view the following week's draft plan beginning Friday afternoon of preceding week.
- **FR22:** Primary Parent can update school-policy constraints (nut-free, no-heating, etc.) and have changes propagate through affected future plans.
- **FR23:** Primary Parent can request regeneration of a full week or specific day plan with same constraint set.
- **FR24:** System surfaces an explicit graceful-degradation state when it cannot generate a safe plan given constraint set.
- **FR25:** Primary Parent/Secondary Caregiver can view historical plans and outcomes (ratings, swaps) for any prior week.
- **FR26:** System maintains cultural-calendar awareness for all active cultural-template compositions and weights upcoming-event-adjacent meals without prompting.

**Household Coordination (FR27–FR31):**
- **FR27:** Primary Parent/Secondary Caregiver can designate packer-of-the-day.
- **FR28:** Primary Parent and Secondary Caregiver can exchange messages within shared household thread.
- **FR29:** System uses household-thread context to enrich household profile and inform plan adjustments.
- **FR30:** Primary Parent can revoke Secondary Caregiver access at any time without caregiver consent.
- **FR31:** Primary Parent can transfer primary ownership of the household to another Secondary Caregiver.

**Heart Note & Lunch Link (FR32–FR47, FR121–FR127):**
- **FR32:** Primary Parent, Secondary Caregiver, or authorized Guest Author can compose Heart Note by text input for any child for any specific day.
- **FR33:** Primary Parent, Secondary Caregiver, or authorized Guest Author can compose Heart Note by voice capture on any tier.
- **FR34:** System delivers Lunch Link via parent-designated channel (email, WhatsApp, SMS, or parent-copied URL) prior to child's lunch time.
- **FR35:** Child can view Lunch Link on any device via session-scoped link without login, install, or account.
- **FR36:** Child can rate Lunch Link via Layer 1 whole-bag emoji (love/like/meh/no) plus optional Layer 2 swipe-right per slot for positive preference only.
- **FR37:** Child can view cumulative flavor-profile artifact from within Lunch Link.
- **FR38:** System delivers Heart Note content exactly as authored, without AI modification.
- **FR39:** System does not reference feedback system, Lumi's learning, or plan changes within Heart Note surface.
- **FR40:** Primary Parent can grant Grandparent Guest Author Heart Note authoring, rate-limited.
- **FR41:** Premium-tier Primary Parent can enable voice playback of Heart Note for child via Lunch Link.
- **FR42:** Child can submit text-based "request a lunch" suggestion; Primary Parent reviews and approves before incorporation.
- **FR43:** System never surfaces notifications, streaks, or absence-reminders referencing Heart Note authoring frequency.
- **FR44:** Primary Parent can compose Heart Note in advance with scheduled delivery.
- **FR45:** Primary Parent can edit or cancel Heart Note before delivery window opens.
- **FR46:** Primary Parent can view delivery status of every Heart Note sent (delivered, viewed, rated, not-yet-opened).
- **FR47:** System does not capture child voice audio in MVP; future child voice reply gated by compliance review and separate consent.
- **FR121:** Rating window opens at first view or child's scheduled lunchtime (whichever first); closes at **8 PM local** same day; no retroactive rating.
- **FR122:** Each `(child, day)` has exactly one session URI; one-time-use — consumed after Layer 1 submission or window close.
- **FR123:** Shared-device multi-child use has separate `(child, day)` URIs; no cross-child signal leakage.
- **FR124:** System weights Layer 2 per-slot signals independently; positive on one slot does not imply inference about others.
- **FR125:** Absence of rating is "no signal," never negative preference.
- **FR126:** System distinguishes sibling-specific preferences from family-wide patterns in multi-child households.
- **FR127:** System occasionally proposes variant preparations/pairings and captures rating delta as active-learning signal; variants visible to parent before delivery (Principle 1).

**Grocery & Pantry-Plan-List Loop (FR48–FR55):**
- **FR48:** System derives shopping list from current week's plan accounting for inferred pantry state, no manual pantry entry.
- **FR49:** Primary Parent/Secondary Caregiver can view shopping list in store mode — one-handed, store-layout-aware sort.
- **FR50:** System routes specialty ingredients to appropriate stores via cultural-supplier directory; multi-store split list when applicable.
- **FR51:** Primary Parent/Secondary Caregiver can mark items purchased; updates inferred pantry state silently.
- **FR52:** System proposes leftover-aware plan swaps when pantry indicates surplus or soon-to-expire.
- **FR53:** System degrades honestly during connectivity loss in store mode; in-flight check-offs preserved as pending.
- **FR54:** Primary Parent can add non-plan-derived items to shopping list.
- **FR55:** Primary Parent can correct inferred pantry state when it disagrees with kitchen reality.

**Evening Check-in & Conversational Enrichment (FR56–FR64):**
- **FR56:** Primary Parent/Secondary Caregiver can engage in unlimited text chat with Lumi on any tier.
- **FR57:** Premium subscriber can engage in unlimited tap-to-talk voice with Lumi.
- **FR58:** Standard subscriber can engage in tap-to-talk voice up to 10 minutes per week.
- **FR59:** System extracts profile-enrichment signals from conversational mentions without explicit parental update commands.
- **FR60:** System surfaces Lumi's voice output with concurrent text captions for accessibility.
- **FR61:** System adjusts Lumi's conversational length and tone in response to household context (time of day, recent activity).
- **FR62:** System surfaces periodic "I noticed" learning moment making profile enrichment legible; offers parent confirmation or correction.
- **FR63:** Primary Parent can initiate Evening Check-in; Lumi does not proactively initiate conversations.
- **FR64:** Primary Parent can ask Lumi why she chose a specific meal for a specific day and receive plan-reasoning answer.

**Visible Memory & Trust Controls (FR65–FR75):**
- **FR65:** Primary Parent can view every data point Lumi has learned about household and each child.
- **FR66:** Primary Parent can edit any learned data point; changes reconciled before next plan-generation.
- **FR67:** Primary Parent can delete any specific learned data point at any time.
- **FR68:** Primary Parent can initiate "reset flavor journey" purge of all child artifacts once per year without closing account.
- **FR69:** Primary Parent can request full account deletion with erasure across platform and all named processors within 30 days.
- **FR70:** Primary Parent can access parental review dashboard summarising all child-associated data collection, processing, retention.
- **FR71:** Primary Parent can export auditable copy of all household data in machine-readable format.
- **FR72:** Primary Parent can view consent history for household (VPC events, policy updates, data-sharing opt-ins).
- **FR73:** Each learned data point carries metadata: when learned, source type (onboarding, conversation, plan outcome, explicit edit).
- **FR74:** Geolocation off by default at household and child level; opt-in named purposes at household level only, never child level.
- **FR75:** System retains voice transcripts 90 days default; parent can opt in to longer retention or immediate deletion.

**Allergy Safety & Guardrails (FR76–FR83):**
- **FR76:** System applies independent rule-based allergy guardrail, separate from LLM judgment, to every generated plan before any user-visible surface.
- **FR77:** System does not display any plan version not cleared by allergy guardrail.
- **FR78:** System maintains auditable log of every allergy-guardrail decision (acceptances + rejections).
- **FR79:** System requires explicit parent confirmation on any plan change affecting allergy-relevant ingredient for household with declared allergies.
- **FR80:** System produces transparency log exportable to parent showing every allergy-relevant system action for household.
- **FR81:** System flags allergy-relevant uncertainty when provenance unverifiable; substitutes safely or surfaces uncertainty for resolution.
- **FR82:** System escalates hard-fail case (no safe plan possible) to ops and parent with transparent description.
- **FR83:** Primary Parent can view standing household allergy-safety audit dashboard in addition to on-request export.

**Billing, Tiers & Gift Subscriptions (FR84–FR94):**
- **FR84:** Primary Parent can subscribe Standard tier monthly/annual with school-year aligned billing + auto-pause during holidays.
- **FR85:** Primary Parent can subscribe Premium tier monthly/annual with school-year aligned billing + auto-pause.
- **FR86:** Primary Parent can upgrade Standard→Premium or downgrade Premium→Standard at any time within billing period.
- **FR87:** Primary Parent can cancel any subscription at any time with explicit confirmation.
- **FR88:** Third-party payer can purchase gift subscription for specified household at either tier with annual prepayment.
- **FR89:** Gift-subscription payer can optionally purchase Guest Heart Note authoring permission with gift.
- **FR90:** System transitions beta-cohort households free→paid at end of beta with explicit upgrade confirmation UX + 14-day refund window.
- **FR91:** System handles failed payment events (expired card, declined) with grace period, parent notification, service-continuity posture.
- **FR92:** System generates billing receipts/invoices accessible to Primary Parent.
- **FR93:** Primary Parent can configure school-year start/end dates per household for auto-pause alignment.
- **FR94:** Gift purchaser can cancel gift before redemption and receive full refund.

**Ops, Support & Incident Response (FR95–FR104):**
- **FR95:** Ops can view allergy-safety anomaly dashboard with alert severity, anonymized household ID, incident status, audit-log access.
- **FR96:** Ops can view plan-gen latency, voice-cost-per-household, guardrail catch-rate, Lunch Link delivery success-rate metrics in aggregate and anonymized per-household views.
- **FR97:** Ops can escalate allergy-safety incident through defined SLA (dashboard → on-call → parental notification with transparency log).
- **FR98:** System maintains audit logs of allergy decisions, plan generations, Heart Note authorship/delivery, Visible Memory edits, billing changes, account deletions for regulatory-minimum retention.
- **FR99:** Primary Parent can submit support request/feedback via defined in-product channel.
- **FR100:** Ops can respond to support request with bounded response SLA.
- **FR101:** Compliance Officer (or equivalent) can export audit-log subset for regulatory audit, subpoena, or parental data-request.
- **FR102:** System delivers in-product surveys at validation milestones — first-plan satisfaction (within 48hr), cultural recognition (weeks 2–3 for culturally-identified), mid-beta WTP (day 60), post-launch satisfaction (30 days post-payment).
- **FR103:** Ops can assign households into tier-variant experimental arms (e.g., month-5 Standard-only) for controlled A/B with audit-logged cohort assignment.
- **FR104:** System monitors per-household voice cost and applies tier-appropriate soft-cap messaging above 95th percentile; sustained abuse triggers hard rate-limits.

**Cross-cutting / Account Preferences (FR105–FR106):**
- **FR105:** Primary Parent can configure notification preferences (timing/channel — weekly plan ready, grocery list ready, Heart Note window reminders).
- **FR106:** Primary Parent has own user profile (display name, preferred cultural-term language, comms preferences) distinct from household and child profiles.

**Total FRs: 127.**

### Non-Functional Requirements Extracted

The PRD organizes NFRs into 10 categories, without numeric labeling. Listed by category with every concrete threshold:

**NFR-Performance:**
- NFR-P1 Plan generation (p95): first plan <90s from profile completion; subsequent plans <60s.
- NFR-P2 Evening Check-in text (p95): first-token <500ms; turn-to-turn <1.5s.
- NFR-P3 Evening Check-in voice (Premium, p95): first-token <800ms; turn-to-turn <600ms.
- NFR-P4 Lunch Link delivery: ≥99.5% delivered by 7:30 AM local on school days.
- NFR-P5 Core Web Vitals (p75) per surface — public landing (LCP<1.5s/INP<150ms/CLS<0.05); authenticated home (<2.0s/<200ms/<0.1); Lunch Link (<1.0s target, <1.2s SLO / <100ms / <0.02); grocery mode (<1.5s/<150ms/<0.05); Evening Check-in text (<2.0s/<150ms/<0.05).

**NFR-Security:**
- NFR-S1 Encryption at rest: AES-256 for all persistent storage (Supabase baseline + app-layer encryption for allergen profile and Heart Note).
- NFR-S2 Encryption in transit: TLS 1.3 only; HSTS with preload.
- NFR-S3 Auth: Supabase Auth (OAuth Google/Apple + email/password); access tokens ≤15 min; refresh tokens ≤30 days with rotation.
- NFR-S4 AuthZ: 4-role RBAC (Primary Parent, Secondary Caregiver, Guest Author, Ops) enforced at single Fastify preHandler — no per-route role checks.
- NFR-S5 CSP: strict; no inline scripts, no eval; named allowlist; ElevenLabs only third-party voice origin; COOP/COEP enabled on authenticated surfaces.
- NFR-S6 CSRF: SameSite=Strict where same-origin feasible; double-submit-cookie for cross-origin.
- NFR-S7 Secrets: env vars only; rotation quarterly; ad-hoc on compromise.
- NFR-S8 Audit logs: immutable append-only; allergy, plan-gen, Heart Note, Visible Memory, billing, account deletion; ≥12 months retention.
- NFR-S9 Vulnerability: dependency scanning on every build; annual external pentest before public launch; quarterly internal security review.

**NFR-Privacy & Data Handling:**
- NFR-PR1 COPPA posture: two-phase VPC; parental notice; parental dashboard day 1; no 3rd-party ad/analytics on child surfaces; 30-day deletion across all processors.
- NFR-PR2 California AADC: DPIA before public launch; most-protective defaults; geolocation off; no dark patterns; plain-language notices.
- NFR-PR3 Data minimization: no collection without named purpose; child flavor-profile only from plan outcomes + ratings.
- NFR-PR4 Retention schedule: family profile = active lifetime; child flavor-profile = active + 30 days post-close or annual reset; voice transcripts = 90 days; Heart Note content = delivered-and-deleted; Lunch Link URL = one-time, <48hr; audit logs = regulatory-minimum (≥12 months; 7 years for compliance-critical); billing = 7 years.
- NFR-PR5 Data portability: parent export structured JSON within 72 hours of request.
- NFR-PR6 Processor DPA chain: ElevenLabs, SendGrid, Twilio, Supabase, Stripe, LLM, internal analytics — all under DPA with downstream deletion enforcement.

**NFR-Scalability:**
- NFR-SC1 Beta capacity: 150 concurrent active households without NFR-Performance degradation.
- NFR-SC2 Public launch: 5,000 concurrent active households (Oct 1, 2026).
- NFR-SC3 End of H1-2027: 50,000 concurrent active households with linear cost scaling (no architectural rewrite).
- NFR-SC4 School-morning peak: 6–8 AM Lunch Link delivery surge across US timezones; 3× baseline provisioning.
- NFR-SC5 Plan-generation queue: Fri PM–Sun AM batch completes within 36 hours for active base; no household waits >4 hours.
- NFR-SC6 Vertical: Supabase at appropriate tier with headroom; Redis sized for SSE fanout; LLM capacity reserved for peak planning.

**NFR-Accessibility:**
- NFR-A1 WCAG 2.1 Level AA across all surfaces; `@axe-core/playwright` + manual audits.
- NFR-A2 Readability CI: Lunch Link ≤grade 4; parent-facing ≤grade 8; build fails on violation.
- NFR-A3 TTS caption fallback: all Lumi voice output has concurrent text captions; screen-reader accessible; not opt-in.
- NFR-A4 Keyboard navigation: complete across authenticated and public.
- NFR-A5 Color contrast: ≥4.5:1 normal text, ≥3:1 large text.
- NFR-A6 Focus indicators: visible on all focusable elements.
- NFR-A7 Multilingual content rendering: Devanagari, Hebrew, Arabic (RTL), Tamil, etc. inside Heart Notes and cultural-term display regardless of UI locale; UI itself English in H1.

**NFR-Reliability & Availability:**
- NFR-R1 API: 99.9% during school hours (6 AM–9 PM local per user TZ); 99.5% off-hours.
- NFR-R2 Voice pipeline: 99.5% with graceful text fallback.
- NFR-R3 Data durability (family profile): 99.999%.
- NFR-R4 Data durability (child flavor-profile): 99.999%.
- NFR-R5 Data durability (Heart Note in-flight): 99.999% during delivery window.
- NFR-R6 DR: RPO ≤1 hour primary; RTO ≤4 hours critical path (Lunch Link, plan view, allergy guardrail); quarterly backup testing.
- NFR-R7 Vendor failover: voice→text on ElevenLabs unavailability; email/SMS per-channel fallback within 30 min; LLM secondary-provider failover within 15 min.
- NFR-R8 Reconnect discipline: exponential backoff with jitter (1s initial, 2×, ±20%, max 60s) for SSE and ElevenLabs WS.

**NFR-Observability:**
- NFR-O1 MVP-grade (beta): Pino structured logs; HTTP 5xx alerting; SSE-disconnect counters; ElevenLabs WS error-rate alerts; on-call (PagerDuty).
- NFR-O2 Growth-grade (public launch): SLO dashboards with error-budget accounting per service; multi-severity on-call (P1/P2/P3); synthetic monitoring for critical user paths.
- NFR-O3 Product telemetry day-1: plan-gen p50/p95, voice cost per HH/day, LLM cost per plan, guardrail catch rate, Lunch Link 7:30AM success rate, Visible Memory visit rate, first-plan satisfaction completion.
- NFR-O4 Incident-response SLA (allergy anomaly): dashboard alert <5 min; on-call engineer <15 min; parent notified <1 hour with transparency log; architectural review <24 hours; backported fix <72 hours.

**NFR-Integration:**
- NFR-I1 ElevenLabs: WebSocket STT/TTS; DPA with explicit child-voice clause (MVP parent-only); US-region; 90-day retention.
- NFR-I2 SendGrid: Lunch Link + Heart Note email; DPA with child-surface behavioral-analytics exclusion; 90-day delivery logs.
- NFR-I3 Twilio: SMS + WhatsApp Lunch Link; DPA; no content retention beyond delivery window.
- NFR-I4 Supabase: Postgres + Auth + Storage; DPA; US-region primary; encryption at rest; audit-log retention configured.
- NFR-I5 Stripe: Standard/Premium, gifts, school-year auto-pause; PCI-DSS Level 1 inherited; HK stays SAQ-A; credit-card VPC at signup.
- NFR-I6 LLM (OpenAI/Anthropic): zero data retention enforced via API settings; no training on household data; allergen decisions never LLM-solo.
- NFR-I7 Internal analytics: first-party only; no 3rd-party ad/analytics SDKs; PII excluded pre-storage.
- NFR-I8 API rate limiting: per-household quotas on plan-gen, check-in calls, Lunch Link delivery; voice soft-cap at 95th percentile per tier (FR104 tie-in).

**NFR-Cost & Unit Economics:**
- NFR-C1 Standard-tier voice ceiling: <$1.00/HH/mo.
- NFR-C2 Premium-tier voice ceiling: <$4.00/HH/mo at p95 (typical $2.50–$3.50).
- NFR-C3 LLM cost per plan generation: <$0.25.
- NFR-C4 CDN + infrastructure: <$0.50/HH/mo at beta scale; <$0.20/HH/mo at 10,000+ scale.
- NFR-C5 Compliance/audit budget: external annual audit + compliance advisor retainer, budgeted separately from per-household marginal cost.

**NFR-Compliance:**
- NFR-CO1 COPPA (16 CFR Part 312): audit-ready at public launch; Compliance Officer role assigned by August 2026; external advisor throughout beta.
- NFR-CO2 California AADC (AB 2273): DPIA pre-launch; most-protective-defaults.
- NFR-CO3 State-level minor privacy (CT, UT, TX, FL, VA, evolving): compliance changelog; quarterly legislative monitoring; compliance deltas tracked against COPPA/AADC baseline.
- NFR-CO4 FDA FALCPA + FASTER Act: top-9 allergen model; parent-declared additional allergens supported.
- NFR-CO5 GDPR / UK Children's Code readiness: deferred (USA-only MVP) but data-min, right-to-delete, DPA discipline built in to avoid retrofits.

**Total NFR thresholds: 45 concrete, measurable bars across 10 categories.**

### Additional Requirements (Principles, Doctrines, Safety-Classified Fields)

Beyond labeled FRs/NFRs, the PRD commits Architecture and Epics to the following binding rules:

**Product Principles:**
- Principle 1 — Lumi leads. Parents confirm. Children feel. (Lumi does not interrupt with nudges.)
- Principle 2 — No approvals, only proposals. (Silence is trust; visibility is required.)
- Principle 3 — The Heart Note is sacred. (Corollary 3a: never references feedback/learning. Corollary 3b: no-nudge on absence — no streaks, no "you've been quiet" copy.)
- Principle 4 — Voice and text are Lumi's conversational channels. (Corollary 4a: transactional surfaces stay tap-based. Amendment: voice tier = access not capability; Heart Note capture + voice onboarding free on all tiers.)
- Principle 5 — Earned through eating, not tapping. (No streaks/points/leaderboards/gamification.)
- Boundary 1 — Children signal. Children do not operate. (No child account; no child-controllable surfaces.)

**Doctrines:**
- Visible memory supersedes moat.
- Allergy safety carves out from "silence is trust" (explicit, auditable parent confirmation).
- Internal-use only during beta (no 3rd-party sharing, behavioral ads, cross-product, data resale).
- Payload scrubbing for any sharing surface (zero child-identifying data; public/anonymous sharing out of scope MVP).

**Safety-Classified Field Model (binding for Architecture/Epics):**
- Server-authoritative: allergy declarations/edits; plan confirmation involving allergy-relevant ingredient; Heart Note "send"; Heart Note delivery state; billing actions; account deletion/export; Guest author invites + rate-limits; partner/Secondary invites; Visible Memory "forget"; cultural-template selection/composition; school-policy declarations; Visible Memory entry edits.
- Optimistic with rollback: recipe preferences; child emoji tap; casual-mention enrichment; UI preferences; read/unread markers; plan view-mode; Heart Note draft; non-allergen plan swaps; grocery check-offs; Evening Check-in user-message send.

**Constraints & Scope:**
- Web-only locked (no mobile, no PWA push).
- USA-only MVP.
- Two-app monorepo (`apps/web` SPA + `apps/marketing` SSG) — architecture prescribed.
- SSE for backend→client push; WebSocket only for ElevenLabs voice.
- Browser support: last 2 major versions of Safari, Chrome, Edge, Firefox; no IE.

### PRD Completeness Assessment

**Strengths:**
- Deep requirements traceability: 127 FRs are cleanly numbered, grouped, and mostly single-subject. Each FR names actor (Primary Parent, Secondary Caregiver, Guest Author, Child, Ops, Compliance Officer, System) and outcome.
- NFRs are numeric and testable — 45+ thresholds with p95, percentage, time, and cost bars.
- Innovations and doctrines are named, numbered, and cross-referenced; safety-classified field model is explicit (not "probably optimistic" by default).
- Cross-cutting risks enumerated with mitigations; fallback postures defined for each innovation.
- Compliance, cost, and scale bars all quantified.

**Concerns worth flagging into later steps:**
1. **FR count self-inconsistency.** PRD prose says "106 functional requirements" but the list itself extends to FR127 (FR107–FR120 Lunch Bag, FR121–FR127 Heart Note/Lunch Link). Not a gap, but a stale intro paragraph. Epics must cover all 127, not 106.
2. **"Parent saw the plan" visibility signal (PRD backlog flag).** Innovation #2 (Silence-as-Trust) validation requires a system-observable event defining "parent saw the plan." The FR list does not include an FR for this telemetry; Epics must either fill this gap or flag it consciously.
3. **Grief-state UX (PRD backlog flag).** Copy, UX, and Lumi's voice for a week of negative child ratings are not specified in any FR. Must appear either as a story or as an explicit deferral.
4. **Voice mid-Heart-Note loss-of-context recovery (PRD backlog flag).** Load-bearing for the most emotional capture moment. No FR covers it.
5. **Test infrastructure acknowledgement.** ~4 test-infra packages named (@axe-core/playwright, Lighthouse CI, SSE integration harness, i18n snapshot) not budgeted in any FR — Epics must carry these as explicit stories or as a cross-cutting infra epic.
6. **Cultural-supplier directory scope is underspecified.** FR50 routes specialty ingredients via "cultural-supplier directory" but the directory's data-model, sourcing, and maintenance cadence are not themselves FRs. Epics must clarify whether directory creation is in-scope or bootstrapped manually.
7. **Pantry inference model.** FR48, FR51, FR52, FR55 rely on an inferred pantry state but the inference engine's accuracy threshold is only stated as a validation signal (≥85%); no FR governs the learning/correction mechanic explicitly.
8. **Marketing-site SEO deliverables.** `apps/marketing` is named in architecture but its page inventory (landing, pricing, pain-point pre-login demo, gift page, cultural-community partner pages, FAQ, legal) is not in any FR — Epics must own this.

These gaps/flags will be tested against Epics coverage in Step 3.

---

## Step 3 — Epic Coverage Validation

### Epic Inventory

The epics document (`epics.md`) defines **11 epics** shipped against a closed-beta-then-public-launch sequence:

| Epic | Title | Role | FRs claimed |
|---|---|---|---|
| 1 | Foundation & Engineering Bedrock | Platform substrate (no user FRs directly) | 0 |
| 2 | Household Onboarding & Profile | Onboarding + profile + invites | 15 |
| 3 | Weekly Plan & Ready-Answer Open | Plan lifecycle + allergy guardrail + Lunch Bag | 30 |
| 4 | Lunch Link & Heart Note Sacred Channel | Child-facing + Heart Note + rating | 24 |
| 5 | Household Coordination & Evening Check-in | Thread + Evening Check-in (text+voice) | 14 |
| 6 | Grocery & Silent Pantry-Plan-List Loop | Shopping list + pantry | 9 |
| 7 | Visible Memory & Trust Controls | Memory/forget/export/account deletion | 10 |
| 8 | Billing, Tiers & Gift Subscriptions | Stripe + tiers + gifts | 12 |
| 9 | Ops Dashboard, Compliance Export & Incident Response | Ops + compliance | 8 |
| 10 | Beta-to-Public-Launch Transition | Credit-card VPC + A/B + WTP surveys | 5 |
| 11 | Marketing & Public Acquisition | Astro SSG + SEO (supports FR1/FR88, no direct FRs) | 0 |

The epics' own "FR Coverage Map" claims **127 FRs covered** with per-epic counts:
`E1=0, E2=15, E3=30, E4=24, E5=14, E6=9, E7=10, E8=12, E9=8, E10=5, E11=0 → 127 ✓`

### FR Coverage Matrix (Independent Verification)

I verified the epics' coverage map against the 127 FRs extracted in Step 2. Every FR has a claimed epic home. Spot-check of the math:

- **Family Profile & Onboarding (FR1–FR14):** FR1–FR8, FR10–FR12, FR14 → E2 (12); FR9 → E10; FR13 → E8. ✓ 14/14.
- **Lunch Bag Composition (FR107–FR120):** FR107 → E2; FR108–FR119 → E3; FR120 → E4. ✓ 14/14.
- **Weekly Plan Lifecycle (FR15–FR26):** FR15–FR26 → E3. ✓ 12/12.
- **Household Coordination (FR27–FR31):** FR27–FR31 → E5. ✓ 5/5.
- **Heart Note & Lunch Link (FR32–FR47, FR121–FR127):** FR32–FR39, FR41–FR47, FR120, FR121–FR127 → E4 (22); FR40 → E8. ✓ 23/23 (FR120 already counted above, i.e. FR32–47 minus FR40 = 15, plus FR121–FR127 = 7 → 22 mapped to E4, plus FR40 to E8).
- **Grocery (FR48–FR55) + FR74:** → E6. ✓ 9/9.
- **Evening Check-in (FR56–FR64):** → E5. ✓ 9/9.
- **Visible Memory (FR65–FR75 minus FR74):** → E7. ✓ 10/10.
- **Allergy Safety (FR76–FR83):** FR76–FR79, FR81, FR82 → E3 (6); FR80 → E4; FR83 → E9. ✓ 8/8.
- **Billing (FR84–FR94 minus FR90):** → E8 (10); FR90 → E10. ✓ 11/11.
- **Ops (FR95–FR101):** → E9. ✓ 7/7.
- **Cross-cutting (FR102–FR106):** FR102–FR104 → E10; FR105–FR106 → E2. ✓ 5/5.

Totals: 14 + 14 + 12 + 5 + 23 + 9 + 9 + 10 + 8 + 11 + 7 + 5 = **127 FRs mapped, 0 missing.**

### Status per FR

| FR Range | Claimed Epic(s) | Status |
|---|---|---|
| FR1–FR8, FR10–FR12, FR14 | E2 | ✓ Covered |
| FR9 | E10 | ✓ Covered |
| FR13, FR40, FR84–FR89, FR91–FR94 | E8 | ✓ Covered |
| FR15–FR26 | E3 | ✓ Covered |
| FR27–FR31 | E5 | ✓ Covered |
| FR32–FR39, FR41–FR47, FR120–FR127 | E4 | ✓ Covered |
| FR48–FR55 | E6 | ✓ Covered |
| FR56–FR64 | E5 | ✓ Covered |
| FR65–FR73, FR75 | E7 | ✓ Covered |
| FR74 | E6 | ✓ Covered |
| FR76–FR79, FR81, FR82 | E3 | ✓ Covered |
| FR80 | E4 | ✓ Covered |
| FR83, FR95–FR101 | E9 | ✓ Covered |
| FR90, FR102–FR104 | E10 | ✓ Covered |
| FR105–FR107 | E2 | ✓ Covered |
| FR108–FR119 | E3 | ✓ Covered |

**No missing FRs.** Every requirement has a traceable epic home.

### Coverage Statistics

- Total PRD FRs: **127**
- FRs covered in epics: **127**
- **FR coverage: 100%** ✓
- Epics covering zero FRs directly: **2** (E1 platform substrate, E11 marketing) — both justified with rationale in the epics document.
- NFR anchoring: each NFR category is named against at least one epic (Epic 1 anchors NFR-PERF-5/6, NFR-SEC-3/5/7/8, NFR-A11Y-1/2/4, NFR-OBS-1, NFR-COST-5; Epic 10 anchors NFR-COMP-1/2, NFR-COST-1/2; other epics anchor by scope).

### Non-FR Scope Gaps (PRD Backlog Flags NOT Absorbed)

Though FR coverage is complete, three items flagged in the PRD backlog do not appear to be absorbed into any epic's scope. These are **scope gaps**, not FR gaps, but they affect implementation readiness:

1. **❌ Grief-state UX (PRD backlog flag "UX Design / Epics").**
   - PRD explicitly flags: what Lumi does when a week accumulates a string of negative ratings from a child; copy, UX, and Lumi's voice in that moment are unspecified; must avoid false cheer and pity; must stay inside Principle 3 sacredness.
   - Grep across `epics.md`: zero matches for "grief", "negative ratings", "string of negative". **Not addressed in any epic.**
   - Impact: Epic 3 (plan) and Epic 5 (thread/Lumi voice) both could plausibly own this, but neither currently does.
   - Recommendation: Assign to Epic 5 (Lumi voice register + plan-reasoning copy) with a dedicated story defining the detection trigger (multi-day rating downturn) and the Lumi copy register for acknowledgment without false cheer or pity.

2. **❌ Voice mid-Heart-Note loss-of-context recovery (PRD backlog flag).**
   - PRD explicitly flags: when cellular drops or mic fails mid-Heart-Note voice capture, what does the parent see? Preserved draft? Visual transcription so far? Re-record from top? Load-bearing for the most emotional capture moment.
   - Grep across `epics.md`: no matches for "mid-heart-note", "cellular drop", "mic fail", "preserve draft" in Heart Note context. **Not addressed in Epic 4 scope or any story.**
   - Impact: Epic 4 ships the Heart Note voice capture (FR33) but does not specify the failure/recovery posture.
   - Recommendation: Add a story under Epic 4 defining the Heart Note voice-capture failure states (connection loss mid-record; mic permission revoked mid-session; tab backgrounding on iOS Safari), with UX spec for each state and the decision on draft preservation.

3. **❌ "Parent saw the plan" visibility signal (PRD backlog flag "Plan Lifecycle / Product Principles").**
   - PRD explicitly flags: "Silence is trust" requires a verified visibility signal defining the system-observable event that constitutes "parent saw the plan" — page-load of home screen, scroll-past-fold, time-on-plan-view, or other. Validation of Innovation #2 (Silence-as-Trust) depends on this.
   - Grep across `epics.md`: no matches for "parent saw the plan", "visibility signal", "time on plan", "scroll past", "plan view event". **Not addressed anywhere.**
   - Impact: Epic 9 defines product telemetry but the plan-view event is not enumerated; beta validation of the <50% plan-rejection signal loses its denominator without this.
   - Recommendation: Add to Epic 3 (as an instrumentation story on `<BriefCanvas>` and `<PlanTile>`) or Epic 9 (as a telemetry story in the product-telemetry suite). Pick a concrete definition (e.g., "BriefCanvas viewport visible for ≥2s with at least one PlanTile in viewport") and ship it as a named event.

### Near-Gaps Worth Flagging (Partially Addressed)

4. **⚠️ Pantry inference model depth.** Epic 6 covers the *surfaces* of inference (FR51 silent update, FR52 leftover-aware swaps, FR55 parent correction) but does not define the inference engine's accuracy target or the learning/correction loop explicitly. PRD's §Innovations validation names ≥85% pantry-inference accuracy as a measurable signal — but no story targets this threshold. Recommend adding an accuracy-tracking telemetry story to Epic 6 or Epic 9.

5. **⚠️ Cultural-template depth for launch.** Epic 2 handles template *composition* and Epic 3 handles *recognition ladder* (L0–L3), but the content/data-authoring work for the six cultural templates themselves (Halal, Kosher, Hindu vegetarian, South Asian, East African, Caribbean — each needing internal + community-advisor review, with top-3 native-cook review before public launch) is *content ops*, not story-level engineering. If this is intentionally out of epic scope (content operations rather than engineering epic), that needs to be stated explicitly. Currently the epics are silent.

### NFR Coverage Spot-check

Cross-reference against the 10 NFR categories from Step 2:

| NFR category | Anchored in |
|---|---|
| Performance (NFR-PERF-1..6) | E1 (budgets/CI), E3 (plan latency), E5 (voice latency), E4 (Lunch Link delivery reliability) |
| Security (NFR-SEC-1..9) | E1 (CSP/COOP/COEP/auth/audit schema), E2 (auth impl) |
| Privacy (NFR-PRIV-1..7) | E2 (VPC beta), E7 (dashboard, deletion, export), E10 (credit-card VPC) |
| Scalability (NFR-SCAL-1..5) | E1 (infra), E3 (plan-gen queue), E4 (Lunch Link fanout) |
| Accessibility (NFR-A11Y-1..7) | E1 (axe/lighthouse CI, readability CI), ALL component epics |
| Reliability (NFR-REL-1..6) | E1 (reconnect, backoff), E3/E4/E5 (vendor fallback) |
| Observability (NFR-OBS-1..4) | E1 (Pino/OTEL skeleton), E9 (dashboards, incident SLA) |
| Integration (NFR-INT-1..8) | E2 (Supabase), E4 (ElevenLabs+SendGrid+Twilio), E8 (Stripe), E3/E5 (LLM provider) |
| Cost (NFR-COST-1..5) | E1 (infra cost envelopes), E10 (voice-cost ceilings) |
| Compliance (NFR-COMP-1..5) | E7 (state patchwork table), E10 (COPPA audit-ready, AADC DPIA) |

NFR anchoring appears comprehensive. No NFR category is unanchored.

### Summary of Step 3

- **FR coverage: 127/127 = 100%.** No missing FR.
- **Three PRD-backlog scope gaps not absorbed into epics** (grief-state UX, voice mid-Heart-Note recovery, "parent saw the plan" visibility signal).
- **Two near-gaps worth flagging** (pantry-inference accuracy target, cultural-template content ops).
- **NFR anchoring is complete across all 10 categories.**

These scope gaps will carry into Step 4 (UX Alignment) and Step 5 (Epic Quality Review) for confirmation.

---

## Step 4 — UX Alignment

### UX Document Status

**Found.** `_bmad-output/planning-artifacts/ux-design-specification.md` (220 KB, 2689 lines, 14 step workflow complete, dated 2026-04-22). Supplementary artifact `ux-design-directions.html` (48 KB, pre-decision directions document) retained for reference; not the authoritative spec.

The UX Spec is organized across 14 major sections: Executive Summary, Core UX, Emotional Response, Pattern Analysis, Design System Foundation, Defining Experience Deep Dive, Visual Design Foundation, Design Direction Decision, User Journey Flows, Component Strategy, UX Consistency Patterns, Responsive & Accessibility, Implementation Roadmap. It pressure-tested via Party Mode (Sally/Winston/Mary/John/Amelia) with amendments integrated.

### UX ↔ PRD Alignment

**Journeys:** All five PRD journeys (J1 Priya / J2 Mike+Devon / J3 Ayaan / J4 Nani / J5 Sam) have deep-flow counterparts in UX Spec §9 with the same personas, emotional beats, and capability scopes. The UX Spec additionally ships an Onboarding Voice Interview medium flow (the "fourth defining moment") that reinforces FR2/FR3/FR7.

**Principles & Doctrines:** All six PRD Principles + four Doctrines are carried forward and visualized:
- Principle 1 (Lumi leads) → Ready-Answer Open (UX §6.1)
- Principle 2 (no approvals, only proposals) → silent plan mutation + `<QuietDiff>` pattern (UX §6.5)
- Principle 3 (Heart Note sacred) → Sacred-channel typography (Instrument Serif 26pt+), sacred-plum color, `<HeartNoteComposer>` scope-locked to `.grandparent-scope`, no Lumi scaffolding allowed
- Principle 4 (voice + text first-class) → Unified thread with polymorphic `<ThreadTurn>` envelope; tap→conversation promotion ladder (L1→L4)
- Principle 5 (earned through eating) → `<FlavorPassport>` sparse-page, no points/streaks
- Boundary 1 (children signal, don't operate) → `.child-scope` runtime assertion + ESLint no-cross-scope rule
- Visible Memory supersedes moat → `<VisibleMemorySentence>` authored-prose pattern (UX §11.8)
- Allergy carves out from silence → `<AllergyClearedBadge>` affirmative-trust pattern (NEVER destructive-red) + journey-5-derived contract

**Innovations:** All five named PRD innovations are design-represented:
1. Pantry-Plan-List silent loop → "I'm at the store" grocery mode (UX §12.5)
2. No-approvals-only-proposals → silent-mutation `<QuietDiff>` + freshness contract (UX §6.5, §6.7)
3. Composable cultural identity → Cultural Recognition Pattern inverted (§12.8) with L0–L3 tier ladder, template states, inference-not-selection
4. Visible memory supersedes moat → Visible Memory authored-prose panel
5. Independent allergy guardrail → `<AllergyClearedBadge>` with Popover-to-audit-trail + presentation-layer contract

**Safety-Classified Field Model:** UX Spec honors the PRD's server-authoritative vs. optimistic-with-rollback split. State-Layer Contract (§5.3) explicitly maps to Safety-Classified discipline.

**Scope discipline:** UX Spec defines `.app-scope` / `.child-scope` / `.grandparent-scope` / `.ops-scope` with Scope Charter (§11), aligning with PRD's three audiences (Primary Parent, Secondary Caregiver, Guest Author, Child) plus Ops.

**Component inventory:** 46 UX-DR items span Foundation Gate (Gate 1–4 + Error Contract), 12 primary custom components, cross-cutting primitives, Shadcn bans, navigation model, modal allowlist, empty-state grammar, search ranking, feedback-pattern matrix, cultural-recognition pattern, voice/copy register, button taxonomy, form grammar, responsive & accessibility suite, onboarding mental-model copy. Each maps to at least one PRD FR or NFR.

**UX requirements not in PRD (UX-first additions that Epics must carry):**
- Anchor-device perf floor (Samsung Galaxy A13 on 4G) — UX-DR53 / §13.8; not in PRD NFRs but enforced in epics via perf CI.
- Readability CI check (Lunch Link ≤ grade 4; parent ≤ grade 8) — present in both PRD NFR-A4 and UX-DR2/§13.4 — matched.
- Reduced-motion and reduced-transparency fallbacks — UX §13.6 / UX-DR56/57; PRD NFR-A5–A6 reference a11y but do not name reduced-motion explicitly. Non-drift; UX narrows the bar further.
- Touch target scope-variants (.app 44×44 / .child 72×72 / .grandparent 56×56) — UX-DR5; PRD uses single 48×48 in web-specific section. UX is stricter per scope; non-drift but worth epic ownership.
- Phase 2 Arabic + Urdu UI (RTL) — UX §13.7; PRD explicitly defers to "UI remains English in H1." Consistent — both label this Phase 2.

**PRD requirements not explicitly surfaced in UX Spec:**
- Voice mid-Heart-Note loss-of-context recovery (PRD backlog flag) — UX Spec specifies Heart Note voice capture typography and scope but does not specify the recovery/draft-preservation UX. Same gap as Step 3 Epic analysis.
- Grief-state UX copy register (PRD backlog flag) — UX Spec specifies Lumi's voice register (§12.9) but does not specify the register for multi-day negative-rating acknowledgment. Same gap as Step 3.
- "Parent saw the plan" visibility signal (PRD backlog flag) — UX Spec specifies the Ready-Answer Open and the freshness contract, but does not define the observable event that triggers the plan-view telemetry. Same gap as Step 3.

These three carry forward: PRD → epics → UX all silent on them.

### UX ↔ Architecture Alignment

**Architecture explicitly honors UX-derived requirements.** The architecture's §Step 4 party-mode review named Sally (UX) as one of four challengers, and amendments A–M integrate UX-Spec decisions directly. Specifically:

- **Foundation Gate contracts** (UX-DR6/7/8/9/10) are named in architecture §3.1 (`Turn.server_seq`, `thread.resync`, `PlanUpdatedEvent` with inline `guardrail_verdict`, `ForgetRequest` soft-only, `PresenceEvent`, `ApiError`/`FieldError`/`ErrorCode`).
- **`brief_state` projection** (AR-7) is specifically named as a UX-driven architectural decision — Winston's coining that Sally then adopted.
- **Scope charter + ESLint enforcement** (UX-DR13/14) is ratified in architecture as lint-layer enforcement, not convention.
- **Scope-allowlist config** lives at `packages/ui/src/scope-allowlist.config.ts` (architecture §6 file tree) and is CI-gated.
- **`<AllergyClearedBadge>` presentation-contract** (UX §6, UX-DR24) is pinned architecturally by reading only from `WHERE guardrail_cleared_at IS NOT NULL` — architecture §1 presentation-layer contract.
- **Voice path split** (sync ≤6s vs. early-ack >6s with "one sec" continuation) is specified in both UX §12.7 and architecture §integration paths — aligned bounds.
- **SSE invalidation bus + TanStack Query cache + Safety-Classified Field Model** triad is architecture §4 + UX §5 State-Layer Contract — aligned semantics.
- **Anchor-device perf budgets** (UX §13.8) are wired to `.github/workflows/perf.yml` in architecture §validation.
- **Multilingual font rendering** is flagged as an *Important Gap* in both UX Spec §13.11 and architecture §Gap Analysis (Gap #3 — multilingual font fallbacks). Not yet resolved, but *co-acknowledged* at the architecture↔UX boundary.

**Architecture requirements not mirrored in UX Spec (architecture-owned depth):**
- Branch-C hybrid orchestrator (OpenAI Agents SDK wrapped behind `LLMProvider` adapter) — runtime concern, not UX.
- Envelope encryption for Safety-Classified-Sensitive fields — DB concern, not UX.
- Single-row audit log with `correlation_id` + `stages JSONB[]` — observability concern; UX Spec sees only the dashboard surface in `.ops-scope`.
- Idempotency-Key + HMAC webhook validation — API-boundary concerns.

None of these create UX drift.

### Alignment Issues

**No critical misalignments found.** UX Spec, PRD, Architecture, and Epics form a coherent four-layer stack:

| Layer | Authoritative for |
|---|---|
| PRD | What the product must do; FR/NFR targets; principles; journeys |
| UX Spec | How it renders and feels; 46 UX-DR items; scope discipline |
| Architecture | How it's built; modules; amendments; CI/lint enforcement |
| Epics | How it ships; story decomposition; FR traceability |

All four agree on: Foundation Gate contracts, Scope Charter, Safety-Classified Fields, `brief_state` projection, Allergy Guardrail → presentation contract, voice path split, multilingual content rendering (with the same gap flagged), anchor-device perf budgets.

### Warnings

1. **Carry-over of the three PRD-backlog flags** (grief-state UX, voice mid-Heart-Note recovery, "parent saw the plan" visibility signal) into UX Spec silence. These are *stack-wide* gaps, not just UX gaps — PRD flagged them, UX did not resolve them, Epics did not absorb them. **These require explicit resolution before story work begins, not downstream discovery.**

2. **Cultural-template content ops boundary** is ambiguous across layers. PRD names 6 cultural templates with community-advisor review + top-3 native-cook review before public launch. UX Spec §12.8 ships the *inference model* (L0–L3 tier ladder, cultural priors, ratification turn). Architecture ships the `cultural/` module. Epic 2 + Epic 3 ship the surfaces. But **nobody owns the content authoring + native-cook-review workstream** — it's not engineering work, it's content ops + community-advisor contracting. Flag: either (a) explicitly scope this out of engineering epics and into a parallel content-ops workstream with its own schedule, or (b) add a content-ops epic (E12?) with template-review gates.

3. **UX Spec Phase 2 scope (Arabic/Urdu RTL, Chromatic visual regression, GrowthBook, large-text toggle)** is named but not epic-anchored. That's correct — Phase 2 is post-public-launch. Verify that Epic 10 does not claim Phase 2 scope.

4. **PRD explicitly deprecates `docs/Technical Architecture.md` and `docs/Design System.md` v1.0** in favor of UX Spec §5 token system v2.0 and architecture §4 (React + Vite, not Next.js). Confirmed in both UX and architecture frontmatter. No drift risk, but **developers reading `docs/` first instead of `_bmad-output/planning-artifacts/` will build the wrong thing.** Recommendation: ensure CLAUDE.md (already does) redirects to planning-artifacts as authoritative.

### Summary of Step 4

- UX Spec exists, is complete (14-step workflow), and is deeply aligned with PRD, Architecture, and Epics.
- All five PRD journeys have deep-flow UX counterparts.
- All six Principles + four Doctrines + five Innovations are design-represented.
- 46 UX-DR items map to epic stories; Foundation Gate (UX-DR6–10) is anchored in Epic 1.
- Architecture explicitly ratifies UX-derived decisions via Amendments A–M.
- **Same three PRD backlog flags carry forward unresolved.**
- Cultural-template content ops is unowned at the epic level.
- Legacy `docs/*` files are explicitly deprecated in favor of planning-artifacts.

No blocking misalignments. Step 5 (Epic Quality Review) can proceed against an aligned substrate.

---

## Step 5 — Epic Quality Review

### Story Inventory

| Epic | Title | Story count | Story ID range |
|---|---|---|---|
| 1 | Foundation & Engineering Bedrock | 14 | 1.1–1.14 |
| 2 | Household Onboarding & Profile | 14 | 2.1–2.14 |
| 3 | Weekly Plan & Ready-Answer Open | 30 | 3.1–3.30 |
| 4 | Lunch Link & Heart Note | 16 | 4.1–4.16 |
| 5 | Household Coordination & Evening Check-in | 17 | 5.1–5.17 |
| 6 | Grocery & Silent Pantry-Plan-List Loop | 6 | 6.1–6.6 |
| 7 | Visible Memory & Trust Controls | 10 | 7.1–7.10 |
| 8 | Billing, Tiers & Gifts | 10 | 8.1–8.10 |
| 9 | Ops Dashboard, Compliance, Incident | 8 | 9.1–9.8 |
| 10 | Beta-to-Public-Launch Transition | 5 | 10.1–10.5 |
| 11 | Marketing & Public Acquisition | 6 | 11.1–11.6 |
| **Total** | | **136** | |

### Best-Practices Compliance (per-epic)

| Epic | User value | Independence | Story sizing | No forward deps | DB just-in-time | Clear ACs | FR traceability |
|---|---|---|---|---|---|---|---|
| 1 | ⚠️ Explicit deviation (substrate) | ✓ | ✓ | ✓ | ✓ (audit_log in 1.8) | ✓ | N/A (0 FRs) |
| 2 | ✓ | ✓ (needs E1) | ✓ | ✓ | ✓ | ✓ | ✓ (15 FRs) |
| 3 | ✓ | ✓ (needs E1, E2) | ✓ | ✓ | ✓ (allergy_rules in 3.1, brief_state in 3.6) | ✓ | ✓ (30 FRs) |
| 4 | ✓ | ✓ (needs E1, E2, E3) | ✓ | ✓ | ✓ (lunch_link_sessions in 4.1) | ✓ | ✓ (24 FRs) |
| 5 | ✓ | ✓ (needs E1, E2) | ✓ | ✓ | ✓ (threads+thread_turns in 5.1) | ✓ | ✓ (14 FRs) |
| 6 | ✓ | ✓ (needs E1, E2, E3) | ✓ | ✓ | ✓ | ✓ | ✓ (9 FRs) |
| 7 | ✓ | ✓ (needs E1, E2, E3, E5) | ✓ | ✓ | ✓ (state_compliance_overrides in 7.9) | ✓ | ✓ (10 FRs) |
| 8 | ✓ | ✓ (needs E1, E2) | ✓ | ✓ | ✓ | ✓ | ✓ (12 FRs) |
| 9 | ✓ | ✓ (build-along E3+) | ✓ | ✓ | ✓ | ✓ | ✓ (8 FRs) |
| 10 | ✓ | ✓ (needs E1–E9) | ✓ | ✓ | ✓ | ✓ | ✓ (5 FRs) |
| 11 | ✓ | ✓ (standalone runtime) | ✓ | ✓ | ✓ | ✓ | N/A (supports FR1/FR88) |

### Findings

#### 🟡 Minor Concerns

1. **"As a developer" framing in 34/136 stories (25%).**
   - **Distribution:** E1: 14/14 (100%, appropriate for substrate); E2: 2/14; E3: 6/30; E4: 4/16; E5: 2/17; E7: 2/10; E8: 1/10; E9: 1/8; E10: 2/5.
   - **Assessment:** BMad doctrine prefers user-centric framing even for infrastructure stories. However, these 34 stories are all correctly identified as non-user-visible substrate (allergy guardrail internals, `brief_state` projection writer, LLMProvider adapter, signed-URL HMAC primitives, webhook handlers, audit log coverage, state-patchwork overrides table, multilingual font stack, etc.). Re-framing them as parent-value stories ("As a Primary Parent, I want correct session scoping…") would create artificial user-facing framing for work whose value manifests in other stories.
   - **Verdict:** Acceptable deviation, documented intent. No remediation required. Epic 1 explicitly carries a "Note on user-value framing" rationale (epics.md line 574).

2. **Epic 1 deliberately lacks direct FR coverage.**
   - Explicit deviation from BMad "user-value first" rule, with documented rationale: Architecture §Decision Impact Analysis and UX Spec §Foundation Gate both mandate Phase-0 blocking work that no user-facing epic can land without.
   - **Verdict:** Defensible and necessary. Treating this as its own epic protects later epics from carrying retrofit technical-debt amendments.

3. **Epic 11 has no direct FRs** but supports FR1 (account creation acquisition path) and FR88 (gift purchase entry). Stated as "Deferred to near public launch — September 2026."
   - **Verdict:** Correct scope. Marketing is acquisition, not product function.

#### 🟠 Major Issues — None

No major issues found. All stories are properly sized (none epic-sized), have Given/When/Then acceptance criteria with traceable FR/UX-DR/NFR/architecture-amendment citations, and reference prior stories for dependencies (never future stories).

#### 🔴 Critical Violations — None

No critical violations found. No technical epics claiming user value falsely; no forward dependencies; no over-sized stories; no vague acceptance criteria.

### Story Quality Deep-Dive

Sampled stories across Epics 1, 2, 3, 4, 5, 9, 10, 11 show consistent structure:

- **Narrative shape:** Role + want + reason with FR/UX-DR/NFR/AR citation. Example (3.10): *"As a Primary Parent of a child with declared allergies, I want every plan with allergy-relevant ingredients to show an affirmative `<AllergyClearedBadge>` with audit popover, So that I have at-a-glance reassurance that today's lunch was checked, and an audit trail when I want to verify (UX-DR24, FR79)."*
- **AC format:** All sampled stories use Given/When/Then BDD structure. Often multi-clause (`Given X`, `When Y`, `Then Z`, `And …`, `And …`).
- **Testable:** ACs name specific schemas, endpoints, events, lint rules, files, and metrics. Example: *"plans.repository.findById() includes WHERE guardrail_cleared_at IS NOT NULL"* — automatable via code inspection + lint rule.
- **FR traceability:** Every story cites its FR/UX-DR/NFR origin. Spot-check: Story 3.10 → FR79, UX-DR24. Story 5.14 → FR59, UX-DR42–48. Story 8.6 → FR88. Story 10.4 → FR104, NFR-COST-1, NFR-COST-2.
- **Dependencies explicit:** Each AC opens with `Given Stories N.N + N.N are complete`. No story references a *higher-numbered* story. Cross-epic dependencies flow only backward (E3 depends on E1/E2; E4 depends on E1/E2/E3; etc.) — never forward.

### Dependency Analysis

**Within-epic:** All sampled cases show backward references only (e.g., Story 3.6 "Given Story 3.5 is complete"; Story 9.8 "Given Stories 5.17+1.10 are complete"). No forward dependencies detected.

**Cross-epic:** Sequencing graph in epics.md:
```
E1 → E2 → E3 → (E4 ∥ E5 ∥ E6) → E7 → E9 (build-along) → E8 (just-in-time) → E10 → E11 (deferred)
```

Each epic's "Dependencies:" clause names only lower-numbered epics. Epic 8 is intentionally delayed (JIT before E10) since beta is free — architecturally sound optimization.

**Circular dependencies:** None detected.

### Database Migration Timing

Migrations are authored inside the story that first needs the table. Spot-checked:

- `audit_log` (Story 1.8) — foundation, necessary for every later audit-emitting story.
- `allergy_rules` + `guardrail_decisions` (Story 3.1) — created when guardrail service first needs them.
- `plans` + `plan_items` (Story 3.5) — created when plan repo first needs them.
- `brief_state` (Story 3.6) — created when projection writer first needs it.
- `lunch_link_sessions` + `lunch_link_keys` (Story 4.1) — created when Lunch Link module first needs them.
- `threads` + `thread_turns` (Story 5.1) — created when family thread first needs them.
- `state_compliance_overrides` + `households.state_residency` (Story 7.9) — created when state-patchwork override surface first needs them.

**Verdict:** Discipline is correct. No "create all tables upfront in Story 1.1" violation.

### Starter-Template Handling

Architecture specifies **existing monorepo + targeted scaffolds** (not a single starter template). Epic 1 Stories 1.1–1.2 handle the bootstrap correctly:

- Story 1.1: scaffolds `apps/marketing` (Astro) and `packages/ui` as missing top-level workspaces.
- Story 1.2: wires workspace scripts + Dockerfile + `.env.local.example` per app.

This is the right treatment — no fresh `create-t3-app`/Next starter cloning, respecting the pre-existing scaffold.

### Greenfield Completeness

As a greenfield project, Epic 1 correctly covers:

- ✅ Initial project setup stories (1.1–1.2).
- ✅ Dev environment configuration (1.2: `.env.local.example`, scripts).
- ✅ CI/CD pipeline setup early (1.13 Lighthouse CI, 1.14 PR template + CI orchestration, other stories mention lint rules as CI gates).
- ✅ Observability day-1 (1.7 Pino + OTEL skeleton).
- ✅ Test infrastructure day-1 (1.11 a11y hooks + jsx-a11y lint, 1.13 perf CI).
- ✅ Token system v2.0 (1.4) and scope charter (1.5) before any component story.

### Summary of Step 5

- **Story count:** 136 across 11 epics — appropriately sized for 6-month beta build.
- **Best-practices compliance:** 10/11 epics fully compliant; Epic 1 is an explicit, documented deviation (substrate epic with rationale).
- **Critical violations:** 0.
- **Major issues:** 0.
- **Minor concerns:** 1 (34 "As a developer" stories — acceptable for correctly identified substrate work; no remediation required).
- **Dependency discipline:** Backward-only, explicit, no circular references.
- **AC quality:** Strong Given/When/Then with concrete, testable assertions citing files/endpoints/schemas.
- **FR/NFR/UX-DR traceability:** Consistent across every sampled story.
- **Database migration timing:** Just-in-time, correctly distributed across stories.

**Epic Quality Gate: PASS.** No structural defects. Remediation required for overall readiness is limited to the 3 PRD-backlog scope gaps surfaced in Steps 3–4 (grief-state UX, voice mid-Heart-Note recovery, "parent saw the plan" visibility signal) and the cultural-template content-ops ownership gap surfaced in Step 4.

---

## Summary and Recommendations

### Overall Readiness Status

**READY WITH RESERVATIONS** — the planning stack (PRD + Architecture + UX Spec + Epics) is of exceptionally high quality and coherence, with 100% FR coverage, comprehensive NFR anchoring, and no critical or major epic quality violations. However, **four narrow but non-cosmetic gaps** must be resolved before Epic 3/4/5 story work lands in code, and **two workstream-ownership decisions** must be made before public launch. None are blocking Epic 1 (Foundation) — that can start immediately.

### What's Strong

- **FR coverage: 127/127 = 100%.** Every PRD requirement has a traceable epic and, within the epic, one or more concretely-specified stories.
- **NFR anchoring: complete** across all 10 NFR categories (Performance, Security, Privacy, Scalability, Accessibility, Reliability, Observability, Integration, Cost, Compliance).
- **Architecture↔UX↔PRD↔Epic alignment is tight.** Amendments in the architecture document (A–MM) integrate UX party-mode feedback; UX Spec explicitly cites PRD FRs and principles; Epics cite UX-DR items, architecture amendments (AR-1..AR-22), and PRD FRs/NFRs in every story.
- **Safety doctrine is structurally enforced, not document-only.** Allergy Guardrail outside agent boundary + presentation-layer contract (`WHERE guardrail_cleared_at IS NOT NULL`) + Journey 5–derived race-condition lessons → baked into Story 3.1, 3.5, 3.10.
- **Scope discipline** (.app / .child / .grandparent / .ops) is lint-enforced (Story 1.5), not convention.
- **Foundation Gate** (UX-DR6–10, Story 1.3) commits five load-bearing contracts — Turn, PlanUpdatedEvent with inline guardrail verdict, ForgetRequest (soft-only Phase 1), PresenceEvent, ApiError — before any user-facing story.
- **Story quality is uniformly high**: role + goal + reason with FR/UX-DR citation; Given/When/Then acceptance criteria naming concrete files, endpoints, schemas, lint rules; dependencies explicit and backward-only.
- **Just-in-time schema migrations** — no upfront "create all tables in Story 1.1" anti-pattern.
- **Cost discipline** is architectural — $0 dev / ~$25–32 staging / ~$50 beta prod / ~$140 launch prod, aligned with per-HH unit-economic SLOs.

### Critical Issues Requiring Immediate Action

Three PRD-backlog flags and one content-ownership gap. None block Epic 1. All should be resolved before the stories they touch land in code.

1. **Grief-state UX copy + detection trigger are unspecified.**
   - **Gap:** PRD flags "what does Lumi do when a week accumulates a string of negative ratings from a child"; no FR, no UX-DR, no epic story covers the detection logic or the copy register for multi-day-negative-rating acknowledgment.
   - **Action:** Add a story under Epic 5 (Lumi voice/copy register) defining: (a) the detection trigger (e.g., ≥3 consecutive `meh`/`no` Layer-1 ratings within a 5-day window for a single child); (b) the Lumi-initiated thread turn copy — acknowledging without false cheer or pity; (c) the relationship to Principle 3 (must not invert Heart Note absence into audit).
   - **When:** Before Story 5.13 (plan-reasoning explanations) or 5.14 (cultural L2/L3) lands. PM/UX to author; engineering adds story.

2. **Voice mid-Heart-Note loss-of-context recovery is unspecified.**
   - **Gap:** PRD flags "when cellular drops or mic fails mid-Heart-Note voice capture, what does the parent see?" No Epic 4 story defines preserved-draft / visual-transcription-so-far / re-record semantics. Load-bearing for the most emotional capture moment.
   - **Action:** Add a story under Epic 4 covering: (a) failure state taxonomy for voice capture (connection loss; mic-permission revoked mid-session; iOS Safari tab-background; storage-full); (b) draft-preservation UX decision (local-only buffer? server-side audio chunk upload?); (c) user-facing copy that does not shame or pressure (Principle 3b).
   - **When:** Before Story 4.4 (Heart Note composer text + voice) implements the voice path. Likely the single most-important gap by emotional stakes.

3. **"Parent saw the plan" visibility signal is unspecified.**
   - **Gap:** PRD flags that Innovation #2 (Silence-as-Trust) validation requires a system-observable event defining "parent saw the plan" (page-load? scroll-past-fold? time-on-plan-view?). No FR, no UX-DR, no telemetry story covers it.
   - **Action:** Add an instrumentation story under Epic 3 (or Epic 9 telemetry). Pick a concrete definition — recommended: *"`<BriefCanvas>` viewport visible for ≥2s with at least one `<PlanTile>` in viewport, emitted as `plan.viewed` telemetry event"*. Tie into the <50% plan-rejection beta validation signal (which is un-measurable without a denominator).
   - **When:** Before Story 9.2 (plan-gen latency + voice cost + guardrail catch-rate + Lunch Link delivery metrics) finalizes the product-telemetry suite.

4. **Cultural-template content ops is unowned.**
   - **Gap:** Six cultural templates (Halal, Kosher, Hindu vegetarian, South Asian, East African, Caribbean) need internal + community-advisor review; top-3 need native-cook review (≥2 cooks per template) before public launch. This is content authoring + contracting work, not engineering. It appears in no epic, no story, no schedule.
   - **Action:** Either (a) explicitly scope out of engineering epics with a parallel content-ops workstream document + schedule + budget; or (b) add a content-ops epic (E12?) with gating stories "Template X passes community review" as release gates for public launch.
   - **When:** Decide by end of April 2026. Public-launch gate is October 1, 2026 — six-month content-authoring runway is tight.

### Important Concerns (Near-Gaps Worth Flagging)

5. **Pantry inference accuracy target has no owning story.** Epic 6 covers inference *surfaces* (FR51/52/55) but no story defines the ≥85% accuracy threshold (PRD innovation validation bar) or the telemetry needed to measure it. Recommend adding an accuracy-tracking story to Epic 6 (inference-vs-actual reconciliation job) or Epic 9 (telemetry panel).

6. **Architecture has 5 "Important Gaps" tagged to be resolved in early epic stories** (architecture §Gap Analysis). Three are absorbed: per-TZ plan-gen schedule (Story 3.7), multilingual font fallbacks (Story 4.16), state-patchwork overrides (Story 7.9). Two remain to verify: (a) school-year + holiday calendar source for billing auto-pause (FR84/85/93) — addressed in Story 8.2 scope but verify the data-shape spec is explicit; (b) data-portability export format (FR71) — addressed by Story 7.7 but verify the JSON schema and encryption-to-parent semantics land in that story's AC before it's picked up.

### Recommended Next Steps (in order)

1. **Start Epic 1 (Foundation) immediately.** No blocker — scope is well-specified, 14 stories are ready. Story 1.3 (Foundation Gate contracts) is the highest-leverage story in the entire plan — get it right the first time.
2. **Author the four missing stories** (grief-state UX, Heart Note voice recovery, plan-view visibility signal, pantry-inference accuracy telemetry) and slot them into Epics 5, 4, 3/9, 6 respectively. Target: ready before their dependency stories start — concretely, ~2 weeks before Epic 3 lands.
3. **Decide content-ops ownership** for cultural templates. PM + founder decision by end of April 2026. Either parallel workstream doc or Epic 12.
4. **Hand off the three "As a developer" epics (Epics 1, 3, 10) to engineering leads** with explicit acknowledgment that "As a developer" framing is intentional for substrate work — don't let BMad purity arguments re-frame these into artificial user-value stories and create drift with the architecture.
5. **Verify Story 8.2 and Story 7.7 AC coverage** before they're picked up. School-year calendar data shape (Story 8.2) and data-export JSON schema (Story 7.7) are the two architecture "Important Gaps" most likely to slip.
6. **Propagate the three resolved PRD-backlog decisions** (once made) back into the PRD document so the artifacts stay in sync — PRD should not remain the authoritative source with "flagged" items while the epics carry the resolution.
7. **After Epic 1 lands**, re-run this readiness assessment on the updated epics document to confirm no new gaps were introduced by the Foundation Gate implementation details.

### Final Note

This assessment identified **4 critical issues** (3 PRD-backlog scope gaps + 1 content-ops ownership gap) and **2 near-gaps** (pantry-inference accuracy, 2 late-resolving architecture Important Gaps) across **6 categories** (UX copy, Heart Note recovery, telemetry, content ops, inference accuracy, data shape). No structural epic-quality violations. No FR coverage gaps. No NFR anchoring gaps.

**The planning stack is exceptionally well-built.** The remaining gaps are narrow and resolvable through focused PM/UX authoring in the next 2–4 weeks. Epic 1 can start immediately; Epic 2 can start within 2 weeks if the Foundation Gate contracts land cleanly; Epics 3/4/5 require the four missing stories to be authored before their touching stories land.

**Date:** 2026-04-22
**Assessor:** Claude (bmad-check-implementation-readiness skill)
**Project:** HiveKitchen
**Artifacts reviewed:** `prd.md` (1167 lines), `architecture.md` (1683 lines), `epics.md` (2617 lines), `ux-design-specification.md` (2689 lines), product-brief and ux-directions as supporting context.

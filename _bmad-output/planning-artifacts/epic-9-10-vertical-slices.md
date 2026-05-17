# Epics 9 + 10 — Vertical Slice Re-Decomposition (combined)

**Status:** Applied approach (b) — see [`epic-4-vertical-slices.md`](epic-4-vertical-slices.md) for slicing methodology.

**Source:**
- [`epics.md`](epics.md) §"Epic 9: Ops Dashboard, Compliance Export & Incident Response" — 8 horizontal stories (9.1 → 9.8)
- [`epics.md`](epics.md) §"Epic 10: Beta-to-Public-Launch Transition" — 5 horizontal stories (10.1 → 10.5)

**Output:** 16 vertical slices total — 9 in Epic 9 + 7 in Epic 10. Combined doc because their slices interleave heavily (ops dashboards surface what launch posture flips, and many Epic 10 slices need Epic 9 observability to verify behavior).

**Slicing rule shift for ops/launch epics:** The "demo path" rule applies, but the demonstrator is an **ops engineer / compliance officer / launch coordinator**, not a parent. A successful demo means: this surface gives someone with a specific operational role the answer/action they need within their SLA. The phrasing in each slice's Demo line reflects whoever the operator is.

---

## Slice map

| Slice | Demo path | Old stories folded in |
|---|---|---|
| 9-S1 | Ops engineer opens `/ops/plan-audit/{plan_id}` → `<PlanStagesTimeline>` renders all 4 stages (context_loaded → tool_call → llm_output → guardrail_verdict) with timestamps + payload popovers. Lookup ≤50ms even at 50k HH × 5k plans/wk synthetic load. | 9.3 |
| 9-S2 | Ops engineer opens `/ops/allergy-anomalies` → list of recent `allergy.guardrail_rejection / plan.hard_fail / allergy.uncertainty` events with severity badge + status (open/in-progress/resolved). Click into any → 9-S1 plan timeline. Household IDs hashed unless elevated permission. | 9.1 |
| 9-S3 | Trigger an `allergy.guardrail_rejection` audit write (via dev-mode forced rejection) → Grafana alert fires within 5min → PagerDuty pages on-call → in `/ops/incidents/{id}` see auto-drafted parent-notification template ready to send → SLA timers running for 1h notify, 24h architectural review, 72h fix | 9.4 **Incident MVP wall** |
| 9-S4 | Ops engineer opens `/ops/metrics` → Grafana-embedded dashboard renders 6 metric families (plan-gen p50/p95 latency, voice cost per HH, LLM cost per plan, guardrail catch-rate, Lunch Link 7:30am delivery rate, plan-revision-per-week). Window picker (1h/24h/7d/30d). Anonymized per-household drill-down behind elevated-permission gate. | 9.2 |
| 9-S5 | Parent → `/app/support` → submits subject + body → `support_requests` row + SLA timer starts. Ops engineer sees in `/ops/support` queue → composes response → parent's thread shows `<TurnSystemEvent actor="support">` with the response. SLA closure tracked. | 9.5 |
| 9-S6 | Compliance Officer opens `/ops/compliance/export` → filters by `scope='household'` + household_id → triggers export → background job composes filtered `audit_log` JSON → signed download URL emailed within 72h. Export action audit-logged with reason field. | 9.6 |
| 9-S7 | `audit-archive.job.ts` runs nightly → enforces per-category retention (12mo COPPA, 10y billing/tax, 7y safety, 30d→cold for memory.*). Verify by inserting old audit rows + running job → see appropriate archival/deletion per category. | 9.7 (retention side) **Compliance launch wall** |
| 9-S8 | End-to-end integration test simulates household lifecycle (signup → plan-gen → Heart Note → memory edit → billing change → account delete) → asserts audit rows for every required FR98 event-type category exist. | 9.7 (coverage verification) |
| 9-S9 | Trigger client anomalies (`guardrail_mismatch` via stale plan, `thread_integrity` via forced seq gap, `client_error` via JS error) → `/ops/anomalies/{type}` dashboards render rate + recent samples → `request_id` links to OTEL spans. | 9.8 |
| 10-S1 | New household signs up post-beta cutover → Stripe processes $0.01 charge with immediate refund → `vpc_consents` row written with `mechanism='credit_card'` → parent sees no actual charge on statement (just verification). | 10.1 **CC-VPC launch wall** |
| 10-S2 | Ops engineer triggers `POST /v1/ops/transition-cohort` with beta household IDs → affected parents receive in-app banner + email "Welcome to paid HiveKitchen — pick your tier" → tap → Stripe checkout completes → `subscriptions.first_charged_at` set | 10.2 (transition side) |
| 10-S3 | Within 14 days of first-charge → parent → Account → "Refund my first charge" → Stripe processes full refund, no questions asked → audit-logged. | 10.2 (refund window side) |
| 10-S4 | Ops engineer → `POST /v1/ops/cohorts/assign` with household IDs + `variant='standard_only'` → `households.tier_variant` updates → tier-gate forces tier=standard regardless of subscription for those households → 30-day retention tracking in Grafana | 10.3 |
| 10-S5 | Simulated household crosses 95th percentile voice usage in month → next thread response includes inline soft-cap message *"Lumi noticed you've been talking a lot — that's wonderful. Just a heads-up, you're in the top 5% of voice users this month."* | 10.4 (soft-cap side) |
| 10-S6 | Simulate sustained abuse pattern (>24h continuous voice session OR bot-like cadence) → hard rate-limit engages with user-facing explanation copy → audit-logged abuse-pattern event | 10.4 (hard-rate-limit side) |
| 10-S7 | First plan generated for new household → 48h later, survey turn renders in thread as `<TurnProposal>` "How does this week's plan feel?" with 1-5 stars + free text. Parent completes → response in `survey_responses`. Ops dashboard aggregates response rates against PRD threshold gates. Same scheduler hits week 2/3 cultural surveys, day 60 WTP, 30d post-payment. | 10.5 |

**Count:** 16 slices vs 13 original stories.

---

## Sequencing

```
                     ┌─────────────────────────────────────┐
EPIC 9 (Ops)         │                                     │
                     │   9-S1 ─ 9-S2 ─ 9-S3 ─ 9-S4         │
                     │     [incident       │               │
                     │      MVP wall]      │               │
                     │                     ├─ 9-S5  (parent support)
                     │                     ├─ 9-S6  (compliance export)
                     │                     ├─ 9-S7  (retention → wall)
                     │                     ├─ 9-S8  (e2e audit coverage)
                     │                     └─ 9-S9  (anomaly dashboards)
                     └─────────────────────────────────────┘
                                       │
                                       ▼ (Epic 9 surfaces verify Epic 10 cutover)
                     ┌─────────────────────────────────────┐
EPIC 10 (Launch)     │   10-S1 ─ 10-S2 ─ 10-S3 ─ 10-S4    │
                     │   [CC-VPC                           │
                     │    launch wall]                     │
                     │                  ┌─ 10-S5  (voice soft-cap)
                     │                  ├─ 10-S6  (voice hard limit)
                     │                  └─ 10-S7  (validation surveys)
                     └─────────────────────────────────────┘
```

**Three walls across these two epics:**

1. **Incident MVP wall = 9-S3.** Below this, safety incidents can happen but no ops surface tracks them. *No real customer data should be on the platform without 9-S3.*
2. **Compliance launch wall = 9-S7.** Audit retention must work before any regulator-eligible launch. *FR98/NFR-PRIV-5 hard gate.*
3. **CC-VPC launch wall = 10-S1.** Below this, public-launch COPPA posture isn't active. Beta cohort can continue on soft-VPC; new public signups need CC-VPC. *FR9 / NFR-COMP-1 hard gate.*

The combined launch posture flip happens roughly at: 9-S7 done + 10-S1 done. Then 10-S2 transitions beta households, 10-S3 honors the refund window, and 10-S4+ enables A/B + abuse controls + surveys.

---

## Epic 9 slices

### 9-S1 — Three-stage plan-audit timeline

**Demo:** Ops engineer logs into `/ops/plan-audit/{plan_id}`. `<PlanStagesTimeline>` renders 4 stages: `context_loaded` (timestamps + memory_nodes referenced) → `tool_call` (per-tool latency + result) → `llm_output` (prompt + completion preview) → `guardrail_verdict` (allergy verdict + reasoning). Each stage has a payload popover. Lookup completes in <50ms under 50k HH × 5k plans/wk synthetic load (validated by load test).

**Layers:**
- **UI:** `.ops-scope` route + `<PlanStagesTimeline>` component.
- **API:** `GET /v1/ops/plan-audit/:planId` reads single `audit_log` row with `correlation_id=planId`, returns `stages JSONB[]`.
- **Indexes:** Already in place from Story 1.8 + Story 3.5.

**Cited PRD codes:** Architecture amendment R, journey-5-class incident reconstruction.

---

### 9-S2 — Allergy-safety anomaly dashboard

**Demo:** Ops engineer opens `/ops/allergy-anomalies`. List of recent events filtered to `event_type IN ('allergy.guardrail_rejection', 'plan.hard_fail', 'allergy.uncertainty')`. Severity badge (sev-1/sev-2/sev-3), incident status (open/in-progress/resolved), age, anonymized household hash (real ID behind elevated-permission gate). Click into any → opens 9-S1 plan timeline for that incident.

**Layers:**
- **UI:** `.ops-scope` dashboard route.
- **API:** `GET /v1/ops/allergy-anomalies` aggregates audit_log by event_type + recency.

**Cited PRD codes:** FR95, FR83.

---

### 9-S3 — Incident-response SLA workflow 🚧 INCIDENT MVP WALL

**Demo:**
1. Trigger `allergy.guardrail_rejection` audit write via dev-mode forced rejection
2. Within 5 minutes → Grafana alert fires
3. PagerDuty pages on-call engineer
4. On-call opens `/ops/incidents/{id}` → see auto-drafted parent-notification template (subject + body filled with redacted incident summary)
5. SLA timers visible: 1h-to-parent-notify, 24h architectural review, 72h fix backport
6. Send the notification → SLA timer flips, audit row written

**Layers:**
- **API:** Grafana alerting rules + PagerDuty webhook integration.
- **UI:** `/ops/incidents/{id}` workspace with SLA timers + template editor.
- **Templates:** Parent-notification templates per incident type (allergy, billing, data, etc.).

**Cited PRD codes:** FR97, NFR-OBS-4.

**Why this is the incident MVP wall:** The platform handles allergy decisions affecting children's lives. Below 9-S3, an incident could occur and the team would learn about it through customer reports days later. No real customer data should be on the platform without 9-S3.

---

### 9-S4 — Operational metrics dashboard

**Demo:** Ops engineer opens `/ops/metrics`. Grafana-embedded dashboard renders 6 panels: plan-gen p50/p95 latency, voice cost per HH (rolling 30d), LLM cost per plan, guardrail catch-rate, Lunch Link 7:30am delivery rate, plan-revision-per-week (proxy for engagement). Window picker switches between 1h/24h/7d/30d. Per-household drill-down through anonymized HH ID, elevated-permission gate for de-anonymization (audit-logged).

**Layers:**
- **UI:** Embedded Grafana iframe in `.ops-scope`.
- **API:** Prometheus / OTEL metrics already wired from Story 1.7 + per-feature instrumentation.

**Cited PRD codes:** FR96, NFR-OBS-3.

---

### 9-S5 — Parent support channel

**Demo:** Parent → `/app/support` → "How can we help?" form (subject + body). Submit → `support_requests` row written, SLA timer starts. Ops engineer opens `/ops/support` → queue of open requests with age/priority → opens one → composes response → submit → parent's thread renders a new `<TurnSystemEvent actor="support">` turn with the response. Parent can reply in thread; reply lands back in `/ops/support`. SLA closure tracked.

**Layers:**
- **UI:** Parent-side support form; ops-side queue + response composer.
- **API:** `POST /v1/support`, `POST /v1/support/:id/response`, `GET /v1/ops/support`.
- **DB:** `support_requests(id, household_id, subject, body, status, sla_timer_started_at, sla_resolved_at)`.

**Cross-epic dependency:** Family thread schema + `<TurnSystemEvent>` rendering from Epic 5 5-S3.

**Cited PRD codes:** FR99, FR100.

---

### 9-S6 — Compliance Officer audit-log export

**Demo:** Compliance Officer opens `/ops/compliance/export`. Filter form: scope=household / date-range / event-type + filter values + mandatory reason field. Trigger → background job composes filtered `audit_log` subset as JSON or PDF → signed download URL emailed within 72h → export action audit-logged with the reason.

**Layers:**
- **UI:** Filter form + export status indicator.
- **API:** `POST /v1/ops/compliance/export` queues BullMQ job; job composes, signs, uploads, emails.
- **Audit:** Every export creates an audit row in a separate `compliance_exports` table for chain-of-custody.

**Cited PRD codes:** FR101.

---

### 9-S7 — Audit retention enforcement 🚧 COMPLIANCE LAUNCH WALL

**Demo:** Insert backdated audit rows (12mo+1day old for COPPA category, 10y+1day for billing, etc.). Run `audit-archive.job.ts` manually. Verify per-category behavior:
- COPPA categories (>12mo): archived to cold storage
- Billing/tax (>10y): archived
- Safety-audit (>7y): archived
- Memory.* (>30d): moved to cold storage (not deleted — recoverable for 30 day window)

**Layers:**
- **API:** `apps/api/src/jobs/audit-archive.job.ts` runs nightly, applies per-category retention policy.

**Cited PRD codes:** FR98, NFR-PRIV-5.

**Why this is the compliance launch wall:** Without retention enforcement, the system accumulates audit data indefinitely — violates COPPA's data-minimization and AADC's purpose-limitation principles. FR98 / NFR-PRIV-5 is a hard regulator gate.

---

### 9-S8 — End-to-end audit coverage verification

**Demo:** Run `pnpm test:audit-coverage` integration test → simulates full household lifecycle (signup → plan-gen → Heart Note → memory edit → billing change → account delete) → asserts presence of audit rows for every FR98-required event-type category. Test green = audit substrate comprehensive.

**Layers:**
- **API:** Integration test in `apps/api/test/audit-coverage.test.ts`.

**Cited PRD codes:** FR98 (coverage).

**This is a verification slice, not a feature.** It's listed as a slice because the demo path is concrete (run a test → see green/red) and the work is non-trivial (instrumentation of every audit-writing path).

---

### 9-S9 — Anomaly-beacon dashboards

**Demo:** Three dashboards at `/ops/anomalies/guardrail-mismatch`, `/ops/anomalies/thread-integrity`, `/ops/errors`. Each renders rate (events/min, events/hour, events/day) + recent samples (latest 50 with payload drill-down). `request_id` on each row links to OTEL traces. Ops alerts configured at threshold spikes (configurable per dashboard).

**Layers:**
- **UI:** Three `.ops-scope` dashboards.
- **API:** Reads from `thread_integrity_anomalies` (from Epic 5 5-S18), `guardrail_mismatches` (new table written when guardrail.verdict diverges from agent-claimed outcome), `client_errors` (existing).

**Cited PRD codes:** Architecture amendment S compensating control.

---

## Epic 10 slices

### 10-S1 — Credit-card VPC 🚧 CC-VPC LAUNCH WALL

**Demo:** New household signs up post-beta cutover (`households.in_beta = false` after admin cohort flip). Signup flow now includes a Stripe payment-method capture step (no checkout yet — just card-on-file) → backend triggers $0.01 charge → immediately refunded → `vpc_consents` row written with `mechanism='credit_card'`. Parent's statement shows $0.01 charge + $0.01 refund within minutes.

**Layers:**
- **API:** Signup branch on `households.in_beta` flag. New-signup path calls Stripe `paymentIntents.create({amount: 1, capture_method: 'automatic'})` then `refunds.create`.
- **DB:** `vpc_consents(household_id, mechanism, consented_at, stripe_payment_intent_id)`.

**Cited PRD codes:** FR9, NFR-COMP-1.

**Why this is the CC-VPC launch wall:** Below 10-S1, public-launch COPPA posture isn't active. Beta households retain their soft-VPC consent (immutable audit), but any new signups post-launch need verified-parental-consent via the CC mechanism per regulatory mandate.

---

### 10-S2 — Beta-to-paid transition (cohort trigger)

**Demo:** Ops engineer triggers `POST /v1/ops/transition-cohort` with a list of beta-household IDs. Affected parents receive in-app banner ("Your beta is becoming paid HiveKitchen. Pick your tier.") + SendGrid email. Tap banner → `/app/billing/transition` → tier selection step → Stripe checkout → completion → `subscriptions.first_charged_at` set + 14-day refund window callout displayed.

**Layers:**
- **UI:** Transition banner + dedicated transition page that explains the 14-day refund window prominently.
- **API:** `POST /v1/ops/transition-cohort` enqueues SendGrid emails + sets `households.transition_offered_at`.

**Cross-epic dependency:** Epic 8 8-S1 through 8-S5 (full revenue MVP) must ship before this slice can land.

**Cited PRD codes:** FR90.

---

### 10-S3 — 14-day first-charge refund (no-questions-asked)

**Demo:** Beta-transitioned household within 14 days of first charge → Account → Billing → "Refund my first charge" button visible. Tap → confirmation modal: "Full refund of $X. We'll cancel your subscription. You can resubscribe anytime." → confirm → Stripe full refund + subscription cancellation → audit-logged.

**Layers:**
- **API:** `POST /v1/billing/first-charge-refund` — checks `subscriptions.first_charged_at` within 14 days, processes full Stripe refund, cancels subscription, audit-logs.
- **UI:** Refund button conditionally visible during refund window.

**Cited PRD codes:** FR90 (refund side).

---

### 10-S4 — A/B cohort assignment (tier variants)

**Demo:** Ops engineer → `POST /v1/ops/cohorts/assign` with `{household_ids: [...], variant: 'standard_only'}`. Affected households: `households.tier_variant = 'standard_only'`. tier-gate.service (from Epic 8 8-S9) now reads `tier_variant` first — if `standard_only`, forces effective tier=standard regardless of `subscriptions.tier`. Other households: `variant='control'` retains normal tier-gate behavior. Grafana dashboard tracks retention metrics per cohort for 30 days post-assignment.

**Layers:**
- **API:** `POST /v1/ops/cohorts/assign`; tier-gate.service modified to honor variant override.
- **DB:** `households.tier_variant ENUM ('standard_only', 'control', NULL)`.
- **Grafana:** Cohort-tagged retention panel.

**Cross-epic dependency:** Epic 8 8-S9 (tier-gate.service) must ship first.

**Cited PRD codes:** FR103, AR §5.6.

---

### 10-S5 — Voice-cost soft-cap (95th-percentile messaging)

**Demo:** Simulate a household crossing 95th-percentile voice usage in current month (use scripted seed data). Send next voice turn → response includes inline soft-cap copy *"Lumi noticed you've been talking a lot — that's wonderful. Just a heads-up, you're in the top 5% of voice users this month."* Copy is warm, not punitive. Verify via screen-reader announcement that the soft-cap message is captioned.

**Layers:**
- **API:** Voice cost aggregation in `voice_usage`; threshold check in turn handler emits soft-cap turn alongside Lumi response.

**Cross-epic dependency:** Epic 5 5-S5 (voice infrastructure) and/or Epic 12 12-S10 (tap-to-talk voice).

**Cited PRD codes:** FR104, NFR-COST-1, NFR-COST-2.

---

### 10-S6 — Voice hard rate-limit (sustained abuse)

**Demo:** Simulate sustained abuse pattern (script that opens voice session and never closes for 24h+, OR bot-like cadence of >100 turns/hour). Detection trips → hard rate-limit engaged → user-facing copy explains the limit (no shame language; assumes accidental loop): "We've paused voice on this household — looks like something might be stuck. Voice resumes in [time]. Text still works."

**Layers:**
- **API:** Pattern detection cron + `voice_rate_limits(household_id, reason, until_ts)` table.
- **UI:** Inline copy when voice turn denied.

**Cited PRD codes:** FR104 (hard-limit side).

---

### 10-S7 — Validation milestone surveys

**Demo:** New household completes onboarding + first plan generates. 48 hours later, thread shows `<TurnProposal>` "How does this week's plan feel?" with 1-5 stars + free-text response field. Parent completes → response written to `survey_responses`. Ops dashboard at `/ops/surveys` aggregates response rates + satisfaction trend against PRD threshold gates (kill-signal at <X% satisfaction on first-plan survey). Same scheduler enqueues:
- Week 2 + week 3 cultural-recognition surveys for culturally-identified households
- Day 60 mid-beta WTP survey
- 30d post first-charge satisfaction survey

**Layers:**
- **API:** `apps/api/src/modules/ops/survey.scheduler.ts` — enqueues surveys based on household lifecycle events.
- **UI:** New `<TurnProposal variant='survey'>` rendering in thread (reuses the `<TurnProposal>` type introduced by Epic 5 5-S12 DisambiguationPicker L3/L4).

**Cross-epic dependencies:** Epic 5 5-S3 (family thread schema) + 5-S12 (`<TurnProposal>` type), Epic 8 8-S1 (first-charge event).

**Cited PRD codes:** FR102.

---

## What's intentionally NOT a slice

- **"Build the ops scope (`.ops-scope`)"** is not its own slice — `.ops-scope` already exists from Story 1.5 scope-charter work. Each Epic 9 slice consumes it.
- **"Provision Grafana + Prometheus"** is not a slice — infrastructure shipped in Story 1.7.
- **"Configure PagerDuty integration"** is bundled into 9-S3 as the operational mechanism, not a separate slice.
- **"Beta cutover ceremony"** (the operational act of flipping `households.in_beta=false` for the cohort) is not engineering work — it's a coordination event that happens *after* 10-S1 + 10-S2 ship.

---

## Cross-epic dependencies

| Slice | Depends on | Status |
|---|---|---|
| 9-S5 | Epic 5 5-S3 (family thread + `<TurnSystemEvent>`), 5-S12 (`<TurnProposal>`) | ⚠️ Epic 5 conversion done, slices pending |
| 10-S2 | Epic 8 8-S1 through 8-S5 (revenue MVP) | 🚧 ships in Epic 8 sequence |
| 10-S4 | Epic 8 8-S9 (tier-gate.service) | 🚧 ships in Epic 8 sequence |
| 10-S5 | Epic 5 5-S5 (voice infrastructure) / Epic 12 12-S10 | 🚧 ships in Epic 5 + 12 sequence |
| 10-S7 | Epic 5 5-S12 (`<TurnProposal>` type) + Epic 8 8-S1 (first-charge event) | 🚧 cross-epic timing |

**Cleanest sequencing across all converted epics for a "public launch ready" target:**

1. Epic 12 → 12-S8 → 12-S9 (ambient Lumi MVP wall)
2. Epic 5 → 5-S1 → 5-S3 (coordination MVP wall: presence + caregiver + packer)
3. Epic 9 → 9-S1, 9-S2, 9-S3 (incident MVP wall)
4. Epic 8 → 8-S1 to 8-S5 (revenue MVP wall)
5. Epic 7 → 7-S1 to 7-S5 (feature MVP wall)
6. Epic 9 → 9-S7 (compliance launch wall)
7. Epic 8 → 8-S9 (tier-gate wall)
8. Epic 7 → 7-S11 (regulatory MVP wall)
9. Epic 11 → 11-S1 to 11-S5 (marketing launch wall)
10. Epic 10 → 10-S1 (CC-VPC launch wall) ← **public-launch posture flips here**
11. Epic 10 → 10-S2 (beta-to-paid cohort transition)

That's ~70 slices to public-launch ready, **in a deterministic sequence**, where every slice on the path produces an observable result on landing day.

---

## Conversion progress (final)

| Epic | Slices | Walls |
|---|---|---|
| 4 (Lunch Link + Heart Note) | 18 | MVP wall at S5 |
| 5 (Coordination + Evening Check-in) | 20 | MVP wall at S6 |
| 6 (Grocery + Silent Pantry) | 11 | MVP wall at S6 |
| 7 (Visible Memory + Trust) | 13 | Feature wall S5, regulatory wall S11 |
| 8 (Billing + Tiers) | 13 | Revenue wall S5, tier-gate wall S9, gift wall S11 |
| 9 (Ops Dashboard) | 9 | Incident wall S3, compliance wall S7 |
| 10 (Beta→Launch) | 7 | CC-VPC launch wall S1 |
| 11 (Marketing) | 8 | Launch wall S5 |

**Total: 99 slices** across 8 open epics, replacing 78 original horizontal stories. All converted; approach (b) complete.

---

## What this gives you

You now have:
- A **walkable sequence to public launch** with deterministic walls marking decision moments (beta → paid posture, regulatory ready, etc.)
- **Per-slice demo paths** so every PR has an explicit manual-test acceptance gate
- **PRD requirement traceability preserved** — every FR/NFR/UX-DR code from the original stories is cited in at least one slice
- **A handoff format** that pulls planning out of any one head — the docs are sufficient for a contractor to pick up Epic N slice K without consulting you

What it doesn't give you:
- Sized estimates per slice — those need a developer who knows the codebase to attach hours (~2-5 days per slice is a reasonable starting heuristic, but it varies)
- Tooling to track slice progress — the existing `sprint-status.yaml` uses original story IDs; you'll want to either migrate it to slice IDs or maintain a mapping table

---

## Next steps you could take

1. **Pick one slice and ship it.** The conversion is theoretical until someone implements a slice. The smallest, most-demo-able first slice is **12-S8 (ambient text turn with stub agent)** — it'd give you a working ambient Lumi panel surface today that Epic 5 + Epic 7 + others build on. Alternative: **6-S1** (real grocery list from current plan) since the UI is already mounted and the work is mostly DB+API.
2. **Validate the slicing with a second pair of eyes.** Bring in your most engineering-skeptical reviewer (or Mary in a fresh session) to stress-test slice 4-S5 (sacred-channel doctrine slice — most subtle).
3. **Migrate `sprint-status.yaml`** to use slice IDs alongside the original story IDs, so as slices ship the artifact stays current.

I'd suggest #1 first — pick `12-S8` or `6-S1`, ship it, and see whether the slice-shape works in practice. The conversion's value emerges only when it's used to drive work.

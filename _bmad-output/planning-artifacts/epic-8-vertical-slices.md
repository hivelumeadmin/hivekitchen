# Epic 8 — Vertical Slice Re-Decomposition

**Status:** Applied approach (b) — see [`epic-4-vertical-slices.md`](epic-4-vertical-slices.md) for slicing methodology.

**Source:** [`epics.md`](epics.md) §"Epic 8: Billing, Tiers & Gift Subscriptions" — 10 horizontal stories (8.1 → 8.10).

**Output:** 13 vertical slices. **Three walls** — `S5` (revenue MVP), `S9` (tier-gate enabling real Premium metering), `S11` (gift redemption MVP).

**Stripe-specific shape note:** Billing has an awkward horizontal pull because the webhook handler is foundational — without it, checkout completion can't update subscription state. The vertical approach here: ship checkout WITH webhook handling for only the events that checkout needs, then expand the webhook handler as more flows ship. So S1 includes a minimal webhook (just `checkout.session.completed`); S6 expands to all lifecycle events. This trades "build the foundation once" for "have a working subscription on day 1."

---

## Slice map

| Slice | Demo path | Old stories folded in |
|---|---|---|
| 8-S1 | Tap "Subscribe" → Stripe-hosted checkout (test mode) → complete with `4242…` card → webhook fires → `subscriptions` row provisioned, tier=Standard, cadence=monthly | 8.1 (partial: Standard monthly only), 8.5 (partial: only `checkout.session.completed`) |
| 8-S2 | Pricing surface shows 4 options (Standard monthly $6.99 / annual $69 / Premium monthly $12.99 / annual $129). Pick any → checkout → DB reflects tier+cadence | 8.1 (full) |
| 8-S3 | On Standard → tap Upgrade → modal "You'll be charged $X.XX prorated today" → confirm → Stripe pro-rates → `subscriptions.tier='premium'` | 8.3 (upgrade side) |
| 8-S4 | Tap Cancel → friendly two-step confirmation ("Plan continues until [date]. No re-engagement nag.") → cancel | 8.3 (cancel side) |
| 8-S5 | Account → Receipts → list of past invoices from Stripe → click any → download PDF | 8.3 (receipts) **Revenue MVP wall** |
| 8-S6 | Webhook now handles `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted` — trigger each via Stripe CLI → audit_log rows appear, sub state stays in sync | 8.5 (full) |
| 8-S7 | Simulate `invoice.payment_failed` via Stripe CLI → in-app banner "Payment failed. Update by [date 7 days from now]." → at day 7 simulation, Lunch Link delivery suspends, account stays accessible to update billing | 8.4 |
| 8-S8 | Configure school-year via account settings (start Aug 25, end June 5) → Stripe pause-collection scheduled → fast-forward time → no charges during break → at next start, resumes automatically | 8.2 |
| 8-S9 | `tier-gate.service.ts` `isPremium(household_id)` deployed. Standard tier: Lunch Link voice-playback button absent, weekly voice cap enforced at 10min. Premium tier: button present, unlimited voice. During beta flag, returns true regardless. | 8.10 **Tier-gate wall** |
| 8-S10 | As Grandparent (separate account), navigate `/gift/purchase` → enter recipient family email → Stripe checkout → `gift_subscriptions` row → recipient receives gift-redemption email | 8.6 |
| 8-S11 | Recipient parent clicks redemption email → "Accept gift from Sarah?" → confirm → household subscription flips to Premium (gift-period covered) → original purchaser receives confirmation email | 8.8 **Gift MVP wall** |
| 8-S12 | Pre-redemption: Grandparent → "Cancel gift" → confirm → Stripe full refund → `gift_subscriptions.status='cancelled'` → recipient redemption link returns 410 Gone | 8.9 |
| 8-S13 | At gift checkout, add Guest Heart Note add-on ($24/yr) → Stripe processes additional charge → 7-day-TTL signed JWT invite emailed to purchaser → redeem → land in `(grandparent)/guest-author/compose` with monthly cap=2 | 8.7 |

**Count:** 13 slices vs 10 original stories.

---

## Sequencing

```
S1 ─ S2 ─ S3 ─ S4 ─ S5 ──┬─ S6  (full webhook lifecycle)
              [revenue   ├─ S7  (failed-payment grace)
               MVP wall] ├─ S8  (school-year auto-pause)
                        ├─ S9  (tier-gate → wall)
                        ├─ S10 (gift purchase)
                        │   │
                        │   └─ S11 (gift redemption → wall)
                        │       │
                        │       └─ S12 (gift cancel)
                        └─ S13 (Guest Heart Note add-on)
```

**Revenue MVP wall = S5.** A real customer can subscribe, upgrade/downgrade, cancel, get receipts. The minimum to ethically take real money. **Beta cohorts can transition to paid posture from S5 onward.**

**Tier-gate wall = S9.** Without `isPremium(household_id)` deployed, Premium features (4-S14 voice playback, 5-S18 voice cap relief) can't actually differentiate. Beta households experience Premium-equivalent behavior via a beta flag; this slice flips it to real metering.

**Gift MVP wall = S11.** Below S11, gift purchasing exists (S10) but recipients can't redeem — so launch-ready gift flow requires S10 + S11 together. S12 (cancellation) and S13 (Guest Heart Note add-on) are independent enhancements.

---

## Slice 8-S1 — First subscription (Standard monthly)

**Demo:**
1. Log in as test user (no subscription)
2. Account → Billing → "Subscribe to Standard" (monthly only — Premium/annual come in S2)
3. Redirect to Stripe-hosted checkout page
4. Pay with `4242 4242 4242 4242` (test card)
5. Stripe webhook fires `checkout.session.completed`
6. App refreshes — Account → Billing shows "Standard monthly, renews [date]"
7. Supabase: `subscriptions` row exists with `tier='standard'`, `cadence='monthly'`, `status='active'`

**Layers:**
- **UI:** Single "Subscribe" button on `/app/billing/manage`. No tier picker yet (S2 adds it).
- **API:** `POST /v1/billing/checkout` creates Stripe Checkout Session. `POST /v1/webhooks/stripe` validates HMAC + handles only `checkout.session.completed`.
- **DB:** `subscriptions(household_id, stripe_subscription_id, tier, cadence, status, started_at, current_period_end)`.

**Deferred:** Other tiers + annual cadence (S2), upgrade/downgrade (S3), cancel (S4), receipts (S5), other webhook events (S6), failure handling (S7).

**Cited PRD codes:** FR84 partial, FR85 partial, AR-14 (HMAC partial).

**Why this slice is fat-but-vertical:** The webhook needs to exist before checkout can be tested end-to-end. We're not splitting "build webhook" from "build checkout" because each in isolation is undemoable. S1 is intentionally a bigger slice for this reason — there's no smaller demoable Stripe slice.

---

## Slice 8-S2 — Full tier/cadence matrix

**Demo:** `/app/billing/manage` shows a 2×2 grid: Standard/Premium × Monthly/Annual. Tap any → Stripe checkout for that combination → complete → DB reflects chosen tier+cadence.

**Layers:**
- **UI:** Tier × cadence selector with feature comparison + school-year auto-pause callout (informational at this slice; auto-pause behavior ships in S8).
- **API:** `POST /v1/billing/checkout` accepts `{tier, cadence}` and uses correct Stripe Price ID.

**Cited PRD codes:** FR84, FR85.

---

## Slice 8-S3 — Upgrade / downgrade

**Demo:** Currently on Standard monthly. Account → Billing → "Switch to Premium" → modal shows "Charged $5.97 prorated today. Renews [date]." → confirm → Stripe pro-rates immediately → DB updated to `tier='premium'`. Same flow Premium→Standard with credit applied.

**Layers:**
- **UI:** Tier-switch modal with pro-ration preview.
- **API:** `PATCH /v1/billing/subscription` with `{tier}`; uses Stripe's `subscription_items.update` with pro-ration mode.

**Cited PRD codes:** FR86.

---

## Slice 8-S4 — Cancel cleanly

**Demo:** Account → Billing → "Cancel subscription" → two-step modal:
1. "Plan continues until [date]. No re-engagement nag. You can resubscribe anytime."
2. "Cancel anyway" or "Keep plan"

Tap "Cancel anyway" → Stripe `cancel_at_period_end=true` → `subscriptions.status='active_canceling'` → app shows "Cancels [date]" until period end.

**Layers:**
- **UI:** Two-step confirmation. **No dark patterns** — no upsell mid-cancel, no "Are you sure?? You'll miss…" copy.
- **API:** `DELETE /v1/billing/subscription` sets Stripe `cancel_at_period_end=true`.

**Cited PRD codes:** FR87 (no dark patterns).

---

## Slice 8-S5 — Receipts 🚧 REVENUE MVP WALL

**Demo:** Account → Billing → Receipts → list of past invoices (date, tier, amount, status). Tap any → opens Stripe-hosted PDF receipt in new tab.

**Layers:**
- **UI:** Receipts table.
- **API:** `GET /v1/billing/receipts` pulls from Stripe's `invoices.list`.

**Cited PRD codes:** FR92.

**Why this is the revenue MVP wall:** Subscribe + tier-switch + cancel + receipts is the minimum for a real paying customer. After S5, you can ethically take money. Beta cohorts can flip to paid posture from this slice onward.

---

## Slice 8-S6 — Full webhook lifecycle

**Demo:** Use Stripe CLI to trigger each event:
- `stripe trigger invoice.paid` → `subscriptions.status='active'`, `current_period_end` advanced, audit row written
- `stripe trigger customer.subscription.updated` → tier/cadence in DB matches Stripe truth
- `stripe trigger customer.subscription.deleted` → `subscriptions.status='canceled'`

Each event is idempotent (replay with same `event.id` → no duplicate effects).

**Layers:**
- **API:** Webhook handler expands to all lifecycle events; idempotency via Stripe `event.id` deduplication.

**Cited PRD codes:** AR-14 (full).

---

## Slice 8-S7 — Failed-payment grace + service continuity

**Demo:** Trigger `invoice.payment_failed` via Stripe CLI. App shows persistent in-app banner "Your payment failed. Update billing by [date 7 days from now] to keep your plan." SendGrid sends day-0/3/6 reminder emails. After day 7 simulation, `status='past_due'`, banner becomes "Plan paused — update billing to resume." Lunch Link delivery suspends; account stays accessible to update billing.

**Layers:**
- **UI:** In-app banner with countdown; settings flow for updating payment method.
- **API:** `invoice.payment_failed` handler → `status='grace_period'`; cron promotes to `past_due` at day 7; Lunch Link delivery job checks status before dispatching.

**Cross-epic dependency:** 4-S8 (SendGrid adapter); Lunch Link delivery job from 4-S8/4-S9.

**Cited PRD codes:** FR91.

---

## Slice 8-S8 — School-year auto-pause

**Demo:** Account → School Year → set `start=Aug 25, end=Jun 5` → save. App shows "Plan pauses June 5, resumes Aug 25." Fast-forward time → on June 5, Stripe `pauseCollection` scheduled, no charges during summer → on Aug 25, auto-resume. Pre-pause email reminder sent 7 days before.

**Layers:**
- **UI:** School-year config + clear "next pause/resume" indicator.
- **API:** `PATCH /v1/households/:id/school-year`; cron schedules Stripe `pause_collection` at pause date; resume scheduled at next start.
- **DB:** `households.school_year_start`, `school_year_end`.

**Cited PRD codes:** FR93, AR-19.

---

## Slice 8-S9 — Tier gate (real Premium metering) 🚧 TIER-GATE WALL

**Demo:**
- **On Standard tier:** Visit Lunch Link → no voice-playback button. Voice chat hits 10-minute weekly cap → 11th turn rejected with cap message.
- **On Premium tier:** Voice-playback button appears on Lunch Link. Voice chat unlimited.
- **During beta (`households.in_beta=true`):** `isPremium()` returns `true` regardless of `subscriptions.tier` — beta households experience Premium-equivalent features.

**Layers:**
- **API:** `apps/api/src/modules/billing/tier-gate.service.ts` exports `isPremium(household_id)`. Replaces the "always-Premium-stub" in 4-S14 and 5-S18.

**Why this is the tier-gate wall:** Without S9 deployed, Premium features can't actually differentiate. Beta cohorts get Premium-equivalent via flag; this slice flips it to real metering. Post-S9, you can have a mixed cohort of Standard + Premium households with correct behavior in each.

**Cross-epic dependency:** Replaces stubs in 4-S14 (premium voice playback) and 5-S18 (voice tier cap).

**Cited PRD codes:** FR41, FR57, FR58.

---

## Slice 8-S10 — Gift purchase (Grandparent → recipient family)

**Demo:** As Grandparent (separate account or session), navigate `/gift/purchase` (already linked from Epic 11 11-S8 marketing CTA, under `.grandparent-scope`). Enter recipient family email + optional gift message. Complete Stripe checkout for $129. `gift_subscriptions` row created with `status='pending'`. Recipient email arrives with redemption link.

**Layers:**
- **UI:** `/gift/purchase` form in `.grandparent-scope`. Includes the Guest Heart Note add-on toggle (functionality lands in S13; here it's just UI presence).
- **API:** `POST /v1/billing/gifts/purchase` creates Stripe Checkout session for `price_gift_annual_129`.
- **DB:** `gift_subscriptions(id, payer_user_id, recipient_household_id, tier, redemption_token, status, expires_at, redeemed_at, cancelled_at)`.

**Cited PRD codes:** FR88.

---

## Slice 8-S11 — Gift redemption 🚧 GIFT MVP WALL

**Demo:** Recipient parent clicks redemption email link → `/billing/gifts/redeem?token=...` → "Accept gift from Sarah?" → confirm → household subscription flips to Premium for the gift period → original purchaser receives confirmation email.

**Layers:**
- **UI:** Gift-redemption confirmation surface.
- **API:** `POST /v1/billing/gifts/redeem` validates token + `status='pending'` + token not expired; marks `redeemed_at`; updates household subscription. SendGrid confirmation email to purchaser.

**Cited PRD codes:** FR13.

**Why this is the gift MVP wall:** Below S11, gift purchasing exists (S10) but recipients can't redeem — broken end-to-end flow. S10 + S11 must ship together for the gift product to launch.

---

## Slice 8-S12 — Gift cancellation (pre-redemption)

**Demo:** Purchaser → Account → "My Gifts" → see pending gift → tap "Cancel" → confirm → Stripe full refund → `gift_subscriptions.status='cancelled'`. Recipient's redemption link now returns 410 Gone.

**Layers:**
- **UI:** "My Gifts" view + cancel confirmation.
- **API:** `DELETE /v1/billing/gifts/:id` requires `status='pending'`; Stripe `refunds.create` for full amount.

**Cited PRD codes:** FR94.

---

## Slice 8-S13 — Guest Heart Note authoring add-on

**Demo:** At gift checkout, toggle "Add Guest Heart Note authoring ($24/yr)". Stripe processes additional $24. On success, server issues 7-day-TTL signed JWT for the gift purchaser as `role='guest_author'`. Invite link emailed. Purchaser clicks → redeems → lands in `(grandparent)/guest-author/compose` (from Epic 4 4-S13) with monthly cap of 2 notes.

**Layers:**
- **API:** Gift checkout accepts add-on; on success, issues JWT invite + sends invite email.
- **Cross-epic:** Activates 4-S13's grandparent composer surface.

**Cited PRD codes:** FR40, FR89.

---

## What's intentionally NOT a slice

- **"Stripe customer creation"** is not its own slice. Customers are created in S1's checkout flow.
- **"Subscription state machine documentation"** is not a slice — that's a code comment / ADR, not a deliverable.
- **"Billing-side audit_log writes"** are not their own slice — every billing API/webhook handler writes audit rows as part of its work in the slice it's introduced.

---

## Cross-epic dependencies

| Slice | Depends on | Status |
|---|---|---|
| 8-S7 | 4-S8 (SendGrid adapter), 4-S8/4-S9 (Lunch Link delivery job) | ⚠️ Epic 4 conversion done, slices pending |
| 8-S9 | 4-S14 (premium voice playback stub), 5-S18 (voice cap stub) | ⚠️ Both have "always-Premium" stubs that S9 replaces |
| 8-S13 | 4-S13 (grandparent composer surface) | ⚠️ Same |

---

## Conversion progress

| Epic | Status |
|---|---|
| 4 | ✅ 18 slices |
| 5 | ✅ 20 slices |
| 6 | ✅ 11 slices |
| 7 | ✅ 13 slices |
| 8 | ✅ 13 slices (this doc) |
| 11 | ✅ 8 slices |
| 9 | pending |
| 10 | pending |

**Remaining:** Epics 9 + 10 (Ops Dashboard + Compliance Export + Incident Response; Beta→Launch Transition). These are mostly internal-tooling / coordination shape — not customer-feature shape. They benefit from slicing but the "demo path" rule shifts (you're demoing to an ops engineer or compliance officer, not a parent).

Recommend doing **Epic 9 + Epic 10 together** as a combined "ops + launch ceremony" doc, since their slices interleave naturally (ops dashboard surfaces what launch posture flips, etc).

Continue with Epics 9 + 10 combined?

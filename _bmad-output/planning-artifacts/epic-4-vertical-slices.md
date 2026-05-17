# Epic 4 — Vertical Slice Re-Decomposition (PILOT)

**Status:** Pilot for approach (b) — vertical feature threads. Once validated,
the same pattern applies to Epics 5, 6, 7, 8, 9, 10, 11.

**Source:** [`epics.md`](epics.md) §"Epic 4: Lunch Link & Heart Note Sacred
Channel" — 16 horizontal stories (4.1 → 4.16).

**Output:** 16 vertical slices. Each slice is shippable on its own day, has a
manual demo path, and exercises every relevant layer (UI ↔ API ↔ Agent ↔ DB).
Old story numbers are preserved as cross-references so the audit trail to PRD
requirements (FR/NFR/UX-DR codes) stays intact.

---

## Slicing methodology

A slice is a vertical thread through the system that produces **one
user-observable change** on the day it ships. Every slice has:

1. **A demo path.** One sentence answering "what can you click/see/do after
   this lands that you couldn't before?" If you can't write this sentence,
   it's not a slice — it's an internal refactor.
2. **A layer fan-out.** Which layers change: UI, API, Agent, DB. If only one
   layer changes, it's still a slice (e.g., a UI-only retoke), but the demo
   path must remain user-observable.
3. **Hardcoded inputs are OK in early slices.** Slice 1 might mock half of
   what slice 4 does properly. That's not technical debt — it's the only way
   to keep slices thin.
4. **PRD requirement traceability is preserved.** Each slice cites the
   FR/NFR/UX-DR codes it satisfies. Compliance with the original PRD doesn't
   change; only the *order* and *bundling* of work does.

### Anti-patterns this avoids

- ❌ "Build the HMAC signing service" (no user-visible output until UI ships)
- ❌ "Add the lunch_link_sessions table" (schema-only stories that can't be demoed)
- ❌ "Wire up SendGrid" (delivery infra with no path to verify it landed in an inbox)

### How to use this doc

For each slice, the "Demo" line is your manual-test acceptance gate. If you
can't reproduce the demo path on a real running system, the slice isn't
done — regardless of what unit tests say.

---

## Slice map — what shipped where

| Slice | Demo path | Old stories folded in |
|---|---|---|
| 4-S1 | Compose Heart Note draft → save → see "Saved" timestamp | 4.4 (partial: text-only path, no encryption yet) |
| 4-S2 | Open `/lunch/{stub-token}` → see the Heart Note + child name + hardcoded bag | 4.2 (partial: rendering only, no token validation) |
| 4-S3 | API generates real HMAC-signed token; link works pre-8pm, returns 410 post-8pm | 4.1, 4.3 |
| 4-S4 | Child taps emoji on Lunch Link → rating persists, visible on parent view | 4.2 (full), 4.14 (partial: per-rating write) |
| 4-S5 | Sacred-channel doctrine enforced: lint rule blocks LLM in delivery path; encryption at rest | 4.5, 4.4 (encryption completion) |
| 4-S6 | Schedule a Heart Note for tomorrow → see "Scheduled" status → edit/cancel before window | 4.6 |
| 4-S7 | Hold-to-talk voice → STT transcript appears in editable textarea | 4.4 (voice path) |
| 4-S8 | SendGrid delivers Lunch Link email at 7:30am to test inbox | 4.7 (email channel only) |
| 4-S9 | Twilio + parent-copied URL channels | 4.7 (remaining channels) |
| 4-S10 | Lunch Link survives offline reload with "last synced HH:MM" stamp | 4.8 |
| 4-S11 | Rating signals visibly shape next plan in planner output | 4.14 (full) |
| 4-S12 | FlavorPassport renders empty / developing / established states with real stamps | 4.9 |
| 4-S13 | Grandparent composer with at-cap rhythm copy | 4.10 |
| 4-S14 | Premium voice playback button on Lunch Link plays parent's recording | 4.11 |
| 4-S15 | Child "request-a-lunch" → parent sees proposal in Lumi thread → approves | 4.12 |
| 4-S16 | Hindi/Hebrew/Arabic/Tamil/Bengali Heart Note renders correctly on child link | 4.16 |
| 4-S17 | Allergy transparency log export (PDF + JSON) | 4.15 |
| 4-S18 | CI blocks PRs that add absence-nudge / streak / reminder copy near heart_note | 4.13 |

**Count:** 18 slices vs 16 original stories. Slightly more, but each slice
is smaller and demoable on landing day.

---

## Sequencing

Slices follow strict order S1 → S5 because each builds on the previous demo
path. From S6 onward, slices are largely **independently shippable** — you
could parallelize S6/S7/S8/S10 across different developers.

```
S1 ─ S2 ─ S3 ─ S4 ─ S5 ─┬─ S6  (scheduling)
                        ├─ S7  (voice composition)
                        ├─ S8  (email delivery)
                        ├─ S9  (SMS / WhatsApp / copy-URL)
                        ├─ S10 (offline service worker)
                        ├─ S11 (signal → planner feedback loop)
                        ├─ S12 (FlavorPassport)
                        ├─ S13 (grandparent surface)
                        ├─ S14 (premium voice playback)
                        ├─ S15 (child request-a-lunch)
                        ├─ S16 (multilingual fonts + RTL)
                        ├─ S17 (allergy transparency export)
                        └─ S18 (lint rule)
```

S5 is the "MVP wall" — the smallest set that delivers a sacred-channel-
compliant Heart Note end-to-end. Marketing / beta-cohort decisions hinge on
S5 landing.

---

## Slice 4-S1 — Compose Heart Note draft

**Demo:** Open `/app/heart-note`, type a message, click Save, see "Saved at
12:34" appear. Reload the page — the draft is still there.

**Layers touched:**
- **UI:** `routes/(app)/heart-note.tsx` exists from γ Phase 4 (mock-data). Replace mock with TanStack Query reading from real API. Wire `StationeryCard` textarea to RHF + autosave.
- **API:** `POST /v1/heart-notes` (creates row, `status='draft'`, content stored plaintext for now), `GET /v1/heart-notes?household_id&child_id&date`, `PATCH /v1/heart-notes/:id`.
- **Agent:** none.
- **DB:** `heart_notes` table (id, household_id, child_id, author_user_id, content, status, scheduled_for, created_at, updated_at). **Encryption deferred to S5.**

**Doesn't ship yet:**
- Envelope encryption (S5)
- Voice composition (S7)
- Scheduling controls (S6)
- Child-side rendering (S2)

**Cited PRD codes:** FR32 (compose), AR-10 partial.

**Manual test path:**
1. Log in as parent
2. Navigate to `/app/heart-note`
3. Type into the StationeryCard textarea
4. Wait ~3s — see "Saved at HH:MM" hint update
5. Refresh the page — your text is still there
6. Open Supabase → confirm row exists in `heart_notes`

---

## Slice 4-S2 — Render Heart Note on child surface (stub token)

**Demo:** Visit `/lunch/test-{child-id}-{date}` on your phone (any browser).
See the Heart Note you wrote in S1, the child's name, and a hardcoded bag
preview (sandwich, apple, water). No emoji yet, no expiry, no auth.

**Layers touched:**
- **UI:** `routes/(app)/lunch-link.tsx` exists from γ Phase 4. Replace mock with TanStack Query reading from a temporary dev-only endpoint.
- **API:** `GET /v1/lunch-link-dev/:childId/:date` (returns latest heart_note + child name + a hardcoded bag JSON). **Dev-only route — Slice 3 replaces with the signed/expiring real version.**
- **Agent:** none.
- **DB:** read from `heart_notes` + `children`.

**Doesn't ship yet:**
- HMAC token signing (S3)
- 8pm expiry / 410 Gone (S3)
- Emoji rating (S4)
- Real bag preview from plan_items (later slice — wait for S11)

**Cited PRD codes:** FR35 (child reads note), FR36 partial, UX-DR23 (.child-scope).

**Manual test path:**
1. Write a draft Heart Note as in S1 (e.g., for child Layla, May 14)
2. On your phone, open `/lunch/test-{Layla-id}-2026-05-14`
3. See your Heart Note rendered in Instrument Serif, sacred-plum, unmodified
4. See "Layla's Thursday lunch" salutation
5. See the hardcoded bag preview

---

## Slice 4-S3 — Real signed tokens + 8pm window

**Demo:** API generates `/lunch/{base64url(payload)}.{hex(hmac)}` for tomorrow.
Open at 7:59pm-local — works. Open at 8:01pm-local — 410 Gone with a
"last-state snapshot" panel showing the Heart Note + the rating the child
already submitted (or empty if none).

**Layers touched:**
- **UI:** `routes/(app)/lunch-link.tsx` handles the new shape (HMAC route param) + renders the 410 Gone state.
- **API:** `POST /v1/lunch-link/generate` (parent-facing, creates signed token), `GET /v1/lunch-link/:token` (verifies HMAC, checks expiry, returns 410 with `last_state_snapshot` or full payload).
- **Agent:** none.
- **DB:** `lunch_link_sessions` (child_id, date, nonce, exp, first_opened_at, rating_submitted_at, rating, reopened_after_exp_count, suppressed_at), `lunch_link_keys` (rotating-daily HMAC keys).

**Doesn't ship yet:**
- Multi-channel delivery (S8/S9 — for now, parent copies the URL out of the app)
- Sibling nonce-per-device (defer to S11 if we hit a real issue, otherwise drop)
- Service-worker offline (S10)

**Cited PRD codes:** AR-9, FR121, FR122, FR123, FR125.

**Manual test path:**
1. As parent, click "Generate Lunch Link" in the app — receive a URL
2. At 7:59pm local: open the URL on your phone → renders Heart Note + bag
3. Wait 2 minutes (or fast-forward your machine clock past 8pm)
4. Refresh → see 410 Gone page with the last-state snapshot
5. Refresh again → `reopened_after_exp_count` increments in DB

---

## Slice 4-S4 — Emoji rating

**Demo:** Child taps 😋 on the Lunch Link. Sees confirmation animation.
Parent opens `/app` and sees Layla's Tuesday tile now shows "Layla loved
this" with the emoji.

**Layers touched:**
- **UI:** Add emoji row (🧡 / 🤔 / 😋, 72×72 tap targets) to `lunch-link.tsx`. Add rating display to PlanTile via existing TrustChip pattern.
- **API:** `POST /v1/lunch-link/:token/rate` (writes `lunch_link_sessions.rating`, broadcasts SSE invalidation), `GET /v1/households/:id/brief` already projects ratings into tile summaries.
- **Agent:** none yet (signal capture is local; planner consumption is S11).
- **DB:** `lunch_link_sessions.rating` + audit_log entry.

**Doesn't ship yet:**
- Swipe-right per-item Layer 2 signal (S11)
- Family-wide pattern detection (S11)

**Cited PRD codes:** FR36 (emoji rater), FR124 partial, FR125 (no thumbs-down).

**Manual test path:**
1. Child opens valid Lunch Link
2. Taps 😋 → button highlights, "Got it!" toast appears
3. Parent opens `/app` → Layla's tile for that day shows the emoji
4. Refresh child link → emoji is shown as locked-in
5. Open Supabase → `lunch_link_sessions.rating = 'loved'`

---

## Slice 4-S5 — Sacred-channel doctrine enforcement (encryption + lint)

**Demo:** Heart Note content is envelope-encrypted at rest (visible as
ciphertext in raw DB). CI fails if a PR adds `await llm(` near
`heart_notes.findForDelivery`. **MVP wall reached.**

**Layers touched:**
- **UI:** none (transparent to the user).
- **API:** Add envelope encryption wrapper around `heart_notes.content` reads/writes using per-household DEK. Refactor S1's plaintext storage to encrypted.
- **Agent:** none — explicitly forbidden by lint rule.
- **DB:** content column treated as ciphertext; migration backfills any S1-era plaintext rows.

**Doesn't ship yet:**
- Voice file encryption (S7 introduces the file; S14 adds Premium playback which needs encrypted file storage too)

**Cited PRD codes:** FR38, FR39, AR-10 (full).

**Manual test path:**
1. Write a Heart Note via S1 flow
2. Open Supabase SQL editor → `SELECT content FROM heart_notes` → see ciphertext blob
3. Reload `/app/heart-note` → see plaintext (decryption working)
4. As a developer: open a PR with `await llm(`heart_notes.findForDelivery)` → CI fails on the boundary lint rule
5. Reload child Lunch Link → still works (decryption working on read path)

---

## Slice 4-S6 — Scheduling + edit/cancel + delivery status

**Demo:** Parent writes a note Sunday night, schedules for Thursday. Sees it
under "Scheduled". Edits it Wednesday — change saves. Cancels it Wednesday
night — gone. If they let it through, Thursday morning the status flips to
"Delivered".

**Layers touched:**
- **UI:** Add date picker + "Scheduled / Delivered / Cancelled" status pill to `heart-note.tsx`. Add "All Notes" delivery-status list view at `/app/heart-notes`.
- **API:** Extend `heart_notes.status` enum (`draft|scheduled|delivered|viewed|rated|cancelled`); `PATCH /v1/heart-notes/:id` honors status transitions; `GET /v1/heart-notes` filterable; BullMQ job flips status at delivery window open.
- **Agent:** none.
- **DB:** `heart_notes.status`, `scheduled_for`, `delivered_at`, `cancelled_at`.

**Cited PRD codes:** FR44, FR45, FR46.

**Manual test path:**
1. Compose a Heart Note → set scheduled_for=Thu → save
2. Status pill shows "Scheduled for Thu Apr 24"
3. Edit text → status remains "Scheduled"
4. Cancel → status flips to "Cancelled" (read-only)
5. New Heart Note, schedule for tomorrow, leave it
6. Tomorrow at 6am, status auto-flips to "Delivered"

---

## Slice 4-S7 — Hold-to-talk voice composition

**Demo:** In the composer, hold the mic button, say "Have a great day at
school, peanut", release. Transcript appears in textarea, editable. Audio
file deleted from temp storage after transcription.

**Layers touched:**
- **UI:** Add hold-to-talk mic button to StationeryCard. Show waveform during hold.
- **API:** `POST /v1/heart-notes/transcribe` (accepts audio blob, calls ElevenLabs STT, returns transcript, deletes audio).
- **Agent:** none (STT is a vendor call, not an agent).
- **DB:** no new tables (audio is ephemeral).

**Doesn't ship yet:**
- Premium voice retention for child playback (S14)

**Cited PRD codes:** FR32 (voice path), FR33, AR-10 (voice retention).

---

## Slice 4-S8 — SendGrid email delivery

**Demo:** Configure your test inbox as Layla's delivery channel. 7:30am
school day, get an email "Layla's Tuesday lunch is ready" with the link.
Tap → works.

**Layers touched:**
- **UI:** Add per-child delivery channel picker on child profile page (already-mounted route).
- **API:** `PATCH /v1/children/:id/delivery` (writes preference); `apps/api/src/jobs/lunch-link-delivery.job.ts` BullMQ job dispatches via SendGrid adapter at the per-timezone window.
- **Agent:** none.
- **DB:** `children.delivery_channel` enum.

**Cited PRD codes:** FR34 (email path), NFR-PERF-4 (≥99.5% by 7:30am).

---

## Slice 4-S9 — Twilio (SMS + WhatsApp) + parent-copied URL

**Demo:** Same as S8 but for SMS and WhatsApp. Plus a "Copy link" button in
the parent app for households that prefer to share manually.

**Layers touched:** Twilio adapter, SMS template, share-URL endpoint. UI add to channel picker.

**Cited PRD codes:** FR34 (remaining channels).

---

## Slice 4-S10 — Service Worker for offline `/lunch/*`

**Demo:** Open the child link with full signal. Walk into the basement (or
toggle airplane mode). Reload — link still renders with "last synced
07:23" stamp. Tap emoji — rating queues for retry on reconnect.

**Layers touched:** Workbox service worker scoped to `/lunch/*`, rating-submission retry queue.

**Cited PRD codes:** AR-17.

---

## Slice 4-S11 — Layer 2 signal weighting → planner feedback loop

**Demo:** Rate three Layla-Tuesday lunches as 😋. Open next week's plan
draft. Tuesday's tile for Layla biases toward similar dishes. Open the
planner-agent debug view (or audit_log) — see the weights applied.

**Layers touched:**
- **UI:** Optional debug view showing signal weights per child/slot.
- **API:** `child_preferences` table with per-`(child, slot, item, signal_type)` rows; `planner.tools.recipe.search` reads per-child weights only; family-wide patterns require ≥2 children's signals.
- **Agent:** Planner specialist agent (Story 3.3) gains a `child_signal` tool call.
- **DB:** `child_preferences`.

**Cited PRD codes:** FR124, FR125, FR126.

**This is the most "research-y" slice.** Recommend timeboxing the agent
prompt-tuning portion. If signals don't visibly shape plans within budget,
ship the weight-recording infrastructure and defer the planner-bias step
to a follow-up slice 4-S11b.

---

## Slice 4-S12 — FlavorPassport

**Demo:** Layla has 5 rated lunches. Open
`/app/children/{layla-id}/flavor-passport` → see 5 stamps in a vertical
timeline. Open `/lunch/{layla-token}/passport` on the child link → same
stamps, reordered, read-aloud-ready.

**Layers touched:** New page (parent + child variants), join over plan_items + ratings.

**Cited PRD codes:** FR37, UX-DR27.

---

## Slice 4-S13 — Grandparent composer with at-cap rhythm

**Demo:** Grandparent receives invite token (Story 2.3 flow). Redeems →
`/guest-author/compose`. Writes one note. Writes a second. Tries a third →
hits cap → sees "Ayaan has both of your notes this month, Nani. The next
one opens May 1." Schedules for May 1 — works.

**Layers touched:** `.grandparent-scope` route, cap counter, at-cap UI state, family-language sacred-plum underline.

**Cited PRD codes:** FR40 partial, UX-DR22.

---

## Slice 4-S14 — Premium voice playback

**Demo:** Parent (Premium) records a voice Heart Note via S7. Child opens
Lunch Link → small play button below text → tap → hears parent's voice.
Standard tier: play button absent.

**Layers touched:** Encrypted audio file storage retention, signed-URL endpoint, premium-tier gate.

**Cited PRD codes:** FR41.

**Cross-epic dependency:** Needs Epic 8 tier gating, OR a `beta-Premium-stub`
flag (per original Story 4.11 Dev Notes).

---

## Slice 4-S15 — Child request-a-lunch + parent approval

**Demo:** Child on Lunch Link taps "Tell mum back" → types "pizza on
Friday?" → submits. Parent opens `/app` → sees Lumi thread proposal "Layla
asked for pizza Friday — [Approve] [Adjust] [Decline]". Tap Approve → next
plan's Friday biases toward pizza-adjacent.

**Layers touched:** Child UI + `child_lunch_requests` table + thread proposal integration (Epic 5 dependency on thread surface). Planner soft-signal consumption.

**Cited PRD codes:** FR42, Boundary 1.

**Cross-epic dependency:** Threading surface ships in Epic 5.

---

## Slice 4-S16 — Multilingual fonts + RTL

**Demo:** Compose a Heart Note in Hindi: "आज स्कूल में मज़ा करना". Open child
link → Devanagari script renders correctly (no tofu boxes). Repeat in
Hebrew → RTL flow works.

**Layers touched:** `noto-sans-{devanagari|hebrew|arabic|tamil|bengali}.woff2` self-hosted with `unicode-range`; `dir="auto"` on user-authored text nodes.

**Cited PRD codes:** AR-20, NFR-A11Y-6.

---

## Slice 4-S17 — Allergy transparency log export

**Demo:** Open Account → Privacy → "Export allergy log" → choose JSON or
PDF → file downloads with a human-readable timeline of every
allergy.* audit event for the household.

**Layers touched:** `POST /v1/heart-notes/transparency-log` query over `audit_log`, JSON + PDF rendering.

**Cited PRD codes:** FR80.

---

## Slice 4-S18 — Absence-nudge lint rule

**Demo (negative test):** Open a PR adding a notification string like
`"You haven't written Layla a note this week"`. CI fails with a clear
lint error pointing to `no-heart-note-frequency-reference` and the
Corollary-3b citation.

**Layers touched:** ESLint custom rule + CI hook. No runtime change.

**Cited PRD codes:** FR43, Corollary 3b.

---

## What this re-decomposition changes

### For developers

- A slice fits in a 2–5 day envelope, not a 1–3 week epic. Smaller blast radius per PR.
- Every slice has a "demo before merge" gate. If you can't demo it, it's not done.
- Hardcoded values (mock bag, dev-only token) are accepted in S1/S2 because they get replaced in S3/S11 — explicit in the slice doc, not technical debt.

### For the user testing as the founder

- You can manually test the product **on every PR**, not after 4–6 weeks of layered work.
- After S5 ("MVP wall") you have a sacred-channel-compliant Heart Note flow you could put in front of a beta cohort. The remaining 13 slices are enhancements.
- Beta cohort decisions are no longer blocked on "is Epic 4 done?" — they're "did we cross the S5 wall?"

### For PRD compliance

- All 4.x AC codes are preserved across the slice map (see "Old stories folded in" column).
- No PRD requirement is dropped or weakened. Only the *order* and *bundling* of delivery changes.

---

## How to apply this pattern to Epics 5–11

For each open epic, repeat the same three-step exercise:

1. **List every original story** and tag each as: vertical-slice already,
   pure backend, pure UI, pure lint/infra.
2. **Identify the MVP wall** — what's the smallest set that gives a
   manual demo path through the feature's core promise?
3. **Re-bundle stories below the wall into vertical slices**, then
   sequence everything above the wall as parallelizable enhancements.

Estimated cost per epic: ~half a day with focus, ~one day with stakeholder review. Eight open epics ≈ one week of planning to fully convert.

Recommend doing **Epic 5 (Coordination + Evening Check-in)** next — it has the
most cross-cutting agent work and benefits most from vertical slicing.

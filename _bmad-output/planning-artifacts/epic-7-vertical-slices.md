# Epic 7 — Vertical Slice Re-Decomposition

**Status:** Applied approach (b) — see [`epic-4-vertical-slices.md`](epic-4-vertical-slices.md) for slicing methodology.

**Source:** [`epics.md`](epics.md) §"Epic 7: Visible Memory & Trust Controls" — 10 horizontal stories (7.1 → 7.10).

**Output:** 13 vertical slices. **Two MVP walls** — `S5` (feature-MVP: see/edit/forget works end-to-end) and `S11` (regulatory-MVP: full COPPA right-to-delete + processor erasure required before any public launch).

**Pre-existing:** `memory_nodes` write primitives shipped (Story 2.13 done). Epic 5 slice 5-S7 (passive memory enrichment via `memory.note` tool) will populate the data this surface reads. Epic 7 is almost entirely **read/edit/control** on existing data.

---

## Slice map

| Slice | Demo path | Old stories folded in |
|---|---|---|
| 7-S1 | Navigate to `/app/memory` → see authored prose sentences ("Layla loves dal-rice rotations...") | 7.1 (partial: read-only view) |
| 7-S2 | Tap `⋯` on a sentence → popover with provenance chip ("Learned April 21, confidence 87%") | 7.2 (provenance side) |
| 7-S3 | Tap `⋯` → "Edit" → modify sentence text → save → text updates inline; next plan-gen reflects the edit | 7.2 (edit side) |
| 7-S4 | Tap `⋯` → "Forget" → sentence flips to "Lumi won't use this anymore — [reason]" within 300ms | 7.3 (soft-forget side) |
| 7-S5 | Soft-forgotten 31 days ago → nightly job promotes to hard-forget → row + embeddings + provenance + cascaded → tombstone in audit_log | 7.3 (full promotion job) **Feature MVP wall** |
| 7-S6 | First-time visitor to `/app/memory` → `⋯` pulses honey-amber for 4s with helper text "Tap ⋯ to see where this came from or ask Lumi to forget it" → never appears again | 7.1 (FR65 first-time-reveal) |
| 7-S7 | Child profile → "Reset Layla's flavor journey" → confirm modal → all child memory_nodes + child_preferences + flavor_passport_stamps soft-forgotten → next plan-gen has clean slate. Annual cooldown enforced. | 7.4 |
| 7-S8 | `/app/memory/dashboard` → per-child sections showing declared allergens, cultural priors, memory counts by source_type, voice retention setting, recent VPC events | 7.6 |
| 7-S9 | `/app/memory/consent-history` → chronological list of all `vpc.*` and `account.*` audit events with timestamp + mechanism + document version | 7.8 |
| 7-S10 | Settings → "Export my data" → background job runs → email arrives with signed download URL → download JSON of all household data, signed for tamper-evidence | 7.7 |
| 7-S11 | Settings → "Delete my account" → dangerous confirmation → login locks → daily processor-erasure progress dashboard → day 30: hard delete cascade, final audit row | 7.5 **Regulatory MVP wall** |
| 7-S12 | Billing state changes → `households.state_residency` updates → `getOverridesForHousehold` callable (returns `[]` at MVP, structure exists for future deltas) | 7.9 |
| 7-S13 | Import `scrubForSharing(payload)` in a unit test → strips child_name, declared_allergens, cultural_identifiers, dietary_preferences from sample payload | 7.10 |

**Count:** 13 slices vs 10 original stories.

---

## Sequencing

```
S1 ─ S2 ─ S3 ─ S4 ─ S5 ──┬─ S6  (first-time helper)
                [feature  ├─ S7  (annual flavor reset)
                 MVP wall]├─ S8  (parental review dashboard)
                         ├─ S9  (consent history view)
                         ├─ S10 (JSON export)
                         ├─ S11 (account deletion — regulatory MVP wall)
                         ├─ S12 (state-override scaffold)
                         └─ S13 (payload-scrub primitive)
```

### Two walls

**Feature MVP wall = S5.** After S5, the trust surface's core promise works: a parent can see what Lumi knows, edit a sentence, soft-forget anything, and the system honors the 30-day recovery semantics. **This is what unlocks beta-cohort testing of the trust UX.**

**Regulatory MVP wall = S11.** Before any **public** launch (not beta) — COPPA right-to-delete + 30-day processor erasure must work. S11 is the gate for "we can take real customer data."

Between the walls, S6–S10 and S12–S13 are parallelizable across developers.

---

## Slice 7-S1 — Visible Memory read

**Demo:** Navigate to `/app/memory`. See a list of authored sentences — *"Layla loves dal-rice rotations and Tuesday is a no-meat day. Ayaan won't eat anything green that wasn't on the plate the day before."* Each sentence has an always-visible `⋯` affordance on the right.

**Layers:**
- **UI:** New route `/app/memory`. List of `<VisibleMemorySentence>` components. `font-sans text-base text-fg`.
- **API:** `GET /v1/households/:id/memory` reads `brief_state.memory_prose` snapshot (already projected by Story 3.6, populated by 5-S7's `memory.note` writes).
- **DB:** read-only.

**Deferred:** Provenance (S2), edit (S3), forget (S4), helper pulse (S6).

**Cited PRD codes:** FR65, FR70, UX-DR25, AR-7.

**Manual test path:**
1. Have a household with several memory_nodes (from Epic 5 5-S7 flow, or seed manually)
2. Visit `/app/memory`
3. See prose sentences rendering, one per row
4. Each sentence has a `⋯` icon at the right edge

---

## Slice 7-S2 — Provenance chips

**Demo:** Tap `⋯` on a sentence → popover opens with: source ("from your turn on April 21"), confidence ("87% sure"), last-used ("Used in last week's plan"). Provides [Edit] [Forget] [Adjust] options (Edit/Forget not yet functional — those come in S3/S4).

**Layers:**
- **UI:** Popover with `<ProvenanceChip>` component (uses existing TrustChip pattern). Three pills for actions (gray-disabled until S3/S4 wires them up).
- **API:** `GET /v1/memory/:nodeId/provenance` returns metadata.

**Cited PRD codes:** FR66 (partial).

---

## Slice 7-S3 — Edit a sentence

**Demo:** Tap `⋯` → "Edit" → sentence flips to inline edit field → modify text → save. The sentence text updates inline. Next plan-generation reflects the edit (the underlying memory_node is reconciled).

**Layers:**
- **UI:** Edit-in-place pattern on the row.
- **API:** `PATCH /v1/memory/:nodeId` with `{ prose, reason: 'parent_edit' }`. Reconciliation hook re-runs prose composition.
- **Agent:** Editing a memory_node invalidates derived embeddings; re-embed on next read.

**Cited PRD codes:** FR67, FR73.

---

## Slice 7-S4 — Soft-forget

**Demo:** Tap `⋯` → "Forget" → optionally type a reason → confirm. Sentence text flips to "Lumi won't use this anymore — [reason]" within 300ms. Subtle visual treatment (strikethrough or italic gray). Memory_node's `soft_forget_at` is set.

**Layers:**
- **UI:** Forget confirmation flow + soft-forgotten visual state.
- **API:** `PATCH /v1/memory/:nodeId/forget` sets `soft_forget_at` + reason; SSE `forget.completed`; audit row `memory.forgotten`.
- **Agent:** Planner queries filter out soft-forgotten nodes (`WHERE soft_forget_at IS NULL`).

**Cited PRD codes:** FR67 (soft-forget side), UX-DR8 Phase 1.

---

## Slice 7-S5 — Soft→hard promotion job 🚧 FEATURE MVP WALL

**Demo:** Memory node was soft-forgotten 31 days ago. Run the nightly `memory-forget.job.ts` (or wait). After run: row is hard-deleted from `memory_nodes`, cascaded across `memory_embeddings` + `memory_provenance`, replaced with a tombstone audit row. Verify by querying — node is gone, audit_log has tombstone.

**Layers:**
- **API:** BullMQ job `apps/api/src/jobs/memory-forget.job.ts` runs nightly, queries `WHERE soft_forget_at < NOW() - INTERVAL '30 days'`, hard-deletes, writes tombstone.

**Cited PRD codes:** FR67 (full), UX-DR8 Phase 1 (full).

**Why this is the feature MVP wall:** By S5, the headline promise — *"see what Lumi knows, edit a sentence, soft-forget anything"* — works end-to-end **including the 30-day-then-permanent semantic**. Without S5 the system silently keeps soft-forgotten data forever and the trust contract is broken. Beta cohorts can test the trust UX from this slice onward.

---

## Slice 7-S6 — First-time helper pulse

**Demo:** First-ever visit to `/app/memory` → first `⋯` icon pulses honey-amber for 4 seconds with helper text floating beside it: *"Tap ⋯ to see where this came from or ask Lumi to forget it"*. Dismisses on first user interaction or after 4s. Never appears again for that user. Verify by clearing local user pref → revisiting → seeing again.

**Layers:**
- **UI:** One-time helper with `localStorage`-backed `memory_helper_seen_at` and motion-reduce fallback.
- **API:** none.

**Cited PRD codes:** FR65 first-time-reveal.

---

## Slice 7-S7 — Annual flavor journey reset

**Demo:** Account → Child Layla → "Reset Layla's flavor journey" → confirmation modal explains scope ("All learned preferences, cultural priors, and FlavorPassport stamps will be soft-forgotten. This action takes 30 days to become permanent and can be done once per year.") → confirm → cascade soft-forget across all child-associated `memory_nodes`, `child_preferences`, `flavor_passport_stamps`. Verify next plan-gen has clean slate for Layla. Verify second attempt within 365 days is rejected with a friendly "already reset on [date]" message.

**Layers:**
- **UI:** Confirmation modal (an explicit allowed-exception to no-modals doctrine).
- **API:** `POST /v1/children/:id/reset-flavor-journey` — checks `last_reset_at + 365d`, executes cascade in transaction, writes audit.

**Cross-epic dependency:** None new — relies on Epic 5 5-S7 memory writes existing, which is in-flight.

**Cited PRD codes:** FR68.

---

## Slice 7-S8 — Parental review dashboard

**Demo:** `/app/memory/dashboard` → per-child sections: Layla — Allergens (peanuts, sesame), Cultural priors (Bengali household L2 active), Memory nodes (24 from turns, 8 from plans, 3 from corrections), Voice retention (90d default), Recent VPC events (3 entries). Each section linkable to detail view.

**Layers:**
- **UI:** New route + aggregated card layout.
- **API:** `GET /v1/households/:id/dashboard` joins declared allergens (2.10), cultural priors (2.11), memory_node counts grouped by source_type, voice retention prefs, recent vpc_consents.

**Cited PRD codes:** FR70.

---

## Slice 7-S9 — Consent history view

**Demo:** `/app/memory/consent-history` → chronological list: "April 21 2026 — Parental notice acknowledged (v1.0) via interview flow", "May 1 — Email marketing opt-in via Account Settings", "May 14 — Geolocation opt-in via Household Settings".

**Layers:**
- **UI:** Chronological list, no filters needed at MVP.
- **API:** `GET /v1/households/:id/consent-history` queries audit_log for `vpc.*` and `account.*` events.

**Cited PRD codes:** FR72.

---

## Slice 7-S10 — JSON data export

**Demo:** Settings → "Export my data" → background job dispatched → 72-hour SLA → email arrives with signed download URL → download a JSON file containing all household data (households, children, memory_nodes, plans, lunch_link_sessions, heart_notes, audit_log subset, vpc_consents, billing summary). Open in any JSON viewer — encrypted fields appear in clear-text in the export. Verify URL expires after 30 days.

**Layers:**
- **UI:** Single button + status indicator ("Preparing your export — we'll email you within 72h").
- **API:** `POST /v1/households/:id/export` queues BullMQ job; job composes JSON, decrypts envelope-encrypted fields, signs the payload, uploads to Supabase Storage, emails signed-URL via SendGrid (Epic 4 4-S8 adapter); writes `account.exported` audit row.

**Cited PRD codes:** FR71, NFR-PRIV-6, AR-22.

---

## Slice 7-S11 — Account deletion 🚧 REGULATORY MVP WALL

**Demo:** Settings → "Delete my account" → dangerous confirmation requires typing the household name + clicking "Delete forever" → login locks instantly → daily processor-erasure progress dashboard shows status (Supabase, ElevenLabs, SendGrid, Twilio, Stripe, OpenAI). At day 30: hard-delete cascade purges all household + child + memory + audit (except regulatory-retention categories per NFR-PRIV-5). Final audit row written before household_id is gone.

**Layers:**
- **UI:** Multi-step confirmation flow + status dashboard.
- **API:** `POST /v1/households/:id/delete` soft-deletes household, locks login, queues processor-side deletion jobs with 30-day SLA, broadcasts daily progress.
- **Ops:** Compliance dashboard surfaces deletion progress for ops oversight.

**Cited PRD codes:** FR69, NFR-PRIV-2.

**Why this is the regulatory MVP wall:** COPPA's right-to-delete is a hard launch gate. We can run **beta** cohorts behind explicit beta-consent before S11 lands, but any **public** launch (with real CC-VPC parents) requires S11 to work, including 30-day processor erasure.

**Manual test path:**
1. Create a test household with full data (plans, memory, heart notes, voice transcripts)
2. Settings → Delete → multi-step confirmation
3. Login immediately blocked
4. Day 1: check dashboard → see processor jobs queued
5. Day 1-29: watch daily progress reports
6. Day 30: verify all data gone from primary DB
7. Final audit row exists with `household.hard_deleted` event

---

## Slice 7-S12 — State-residency override scaffold

**Demo:** Set billing address state to CT → `households.state_residency = 'CT'`. Call `getOverridesForHousehold(householdId)` in a test or REPL → returns `[]` (no deltas at MVP). Structure exists for future deltas — when CT later requires an additional disclosure, you add one row to `state_compliance_overrides` and the existing code path picks it up.

**Layers:**
- **API:** `state_compliance_overrides(state, override_type, value, effective_from)` table + `households.state_residency` enum populated from billing.
- **Agent:** none.

**Cited PRD codes:** AR-21, NFR-COMP-3.

---

## Slice 7-S13 — Payload-scrubbing primitive

**Demo (negative-test style):** Open a unit test `payload-scrubber.test.ts`. Input fixture has child_name="Layla", declared_allergens=["peanut"], cultural_identifiers=["bengali"], dietary_preferences=["no-meat-tue"]. Call `scrubForSharing(payload)`. Output strips all four fields, leaves recipe data intact. Test passes.

**Layers:**
- **API:** `apps/api/src/modules/compliance/payload-scrubber.ts` exports `scrubForSharing()` using a Safety-Classified-Sensitive field allowlist.

**Cited PRD codes:** PRD §10, architecture cross-cutting 12.

**No UI consumer at MVP.** Built but unused — primitive ready for any future trusted-circle recipe sharing feature.

---

## What's intentionally NOT a slice

- **"Build the memory_prose projection"** — already shipped in Story 3.6. S1 just reads it.
- **"Build memory.note tool"** — shipped in Epic 5 5-S7. S1's data comes from there.
- **"Audit_log subset for compliance"** — already audited via existing infrastructure. S10 + S11 just compose existing rows.

---

## Cross-epic dependencies

| Slice | Depends on | Status |
|---|---|---|
| 7-S1 | Story 3.6 (brief_state projection) — DONE | ✅ ready |
| 7-S1+ | 5-S7 (memory.note writes) | ⚠️ Epic 5 conversion done, slices pending |
| 7-S5 | BullMQ infrastructure (Epic 1) — DONE | ✅ ready |
| 7-S10 | 4-S8 (SendGrid adapter) | ⚠️ Epic 4 conversion done, slices pending |
| 7-S11 | All other Epic 7 slices + processor delete APIs | 🚧 substantial integration work |

**Recommended sequence across remaining epics:** ship 7-S1 → 7-S5 (feature MVP wall) early — it surfaces the data that 5-S7 produces and validates the trust-UX promise without waiting for the deletion/export complexity.

---

## What remains to convert

| Epic | Status |
|---|---|
| 4 | ✅ converted |
| 5 | ✅ converted |
| 6 | ✅ converted |
| 7 | ✅ converted (this doc) |
| 8 (Billing) | pending — partly procedural (Stripe integration), still benefits from slicing |
| 9 (Ops Dashboard) | pending — mostly ops procedure, may be lighter weight |
| 10 (Beta→Launch) | pending — coordination + compliance posture, may be lighter weight |
| 11 (Marketing) | pending — separate Astro app, vertical slicing very natural |

Epics 8, 9, 10 are mixed-shape (less developer-feature-y, more ops/coordination). Recommend doing **Epic 11 (Marketing)** next — it's the cleanest pure-feature epic remaining. Epic 8 (Billing) next-to-last because its Stripe integration has unusual coupling. Epics 9 + 10 last as combined ops/launch ceremony.

Continue with Epic 11?

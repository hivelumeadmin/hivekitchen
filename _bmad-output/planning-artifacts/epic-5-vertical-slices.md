# Epic 5 — Vertical Slice Re-Decomposition

**Status:** Applied approach (b) — see [`epic-4-vertical-slices.md`](epic-4-vertical-slices.md) for slicing methodology.

**Source:** [`epics.md`](epics.md) §"Epic 5: Household Coordination & Evening Check-in" — 17 horizontal stories (5.1 → 5.17).

**Output:** 18 vertical slices. **MVP wall at 5-S3 (PackerOfTheDay)** — by that slice, a two-parent household can see each other's presence and hand off packing duty (Epic 5's core coordination promise).

---

## 2026-05-12 reconciliation with Epic 12 (Ambient Lumi)

The original 20-slice version of this doc included two slices for "tap LumiOrb → type → reply" (old 5-S1 stub-agent text turn + old 5-S2 real-Lumi response). On review against Epic 12's slice doc, those ambient-Lumi-conversation flows are properly Epic 12's domain — they hit `/v1/lumi/turns` (surface-scoped, per-user), not `/v1/threads` (the shared family-coordination thread).

**Resolution:**
- Old 5-S1 (text thread alive, stub Lumi) → **folded into 12-S8** (ambient text turn, stub agent)
- Old 5-S2 (real Lumi responses) → **folded into 12-S9** (LumiAgent with surface prompt + household snapshot)
- Remaining Epic 5 slices renumbered down by 2

Epic 5 is now genuinely about household coordination: presence, caregiver invites, packer assignments, plan-diff turns, disambiguation, etc. The family thread (`/v1/threads`) carries *coordination* turn types only — `system_event`, `presence`, `proposal`, `plan_diff` — never ambient Lumi chat.

**Still flagged for separate decision:** A handful of remaining Epic 5 slices (voice thread 5-S5, latency doctrine 5-S6, caption-only mode 5-S13) are voice-adjacent and arguably also belong in Epic 12. Not folded yet — wait for explicit decision. If folded later, those numbers free up too.

---

## Slice map

| Slice | Demo path | Old stories folded in |
|---|---|---|
| 5-S1 | Open `/app` in two tabs (or phones) → each tab sees "Devon is also on Brief" presence indicator | 5.2 |
| 5-S2 | Send Caregiver invite to partner → they redeem the link → both on `/app` with shared household data | 5.5 |
| 5-S3 | Two parents on `/app`. Tap Tuesday tile → "Devon packs Tuesday" assignment → Brief updates instantly for both tabs | 5.1 (schema), 5.6 **MVP wall** |
| 5-S4 | Drop the SSE socket in dev tools → another tab assigns a packer → reconnect → no missed turn (gap detected, `thread.resync` fires) | 5.1 (server_seq + resync), 5.17 (anomaly beacon) |
| 5-S5 | Hold mic in LumiPanel → speak → Lumi voice reply with synchronized captions visible | 5.7 (voice path), ~~5.8 (HMAC webhook)~~ **DROPPED off-Agent — no ElevenLabs webhook; STT is raw Scribe REST**, 5.9 (captions) |
| 5-S6 | Long-tool query → Lumi acknowledges first, completes async via thread SSE; no "Let me pull that up" copy in codebase (CI-enforced) | 5.8 (early-ack), 5.10 (filler-phrase lint) |
| 5-S7 | Mention "Diwali in 3 weeks" → Visible Memory peek shows the inferred cultural-calendar note with provenance link | 5.11 |
| 5-S8 | After 3 inferences cross threshold → Brief footer shows "I've noticed [X]" callout with [Yes] [Tell more] [Not for us] | 5.12 |
| 5-S9 | Tap "Why this?" on a PlanTile → thread opens with plan-reasoning prose citing memory + priors | 5.13 |
| 5-S10 | Cultural ratification — use "Nani" twice in chat → Lumi originates "Keeping Nani's dal on the week?" turn → tap Yes → family-language ratchet locks forward | 5.14 |
| 5-S11 | Sunday 8pm "tomorrow's plan?" gets 3-sentence warm response; Tuesday 7am same query gets one-liner | 5.10 (full) |
| 5-S12 | Tap "swap Wednesday" → L3 inline conversational input → tile pulses sacred-plum → answer in thread → tile resolves with QuietDiff summary | 5.4 |
| 5-S13 | Accessibility settings → "Text only" → voice doesn't auto-play, captions still stream to thread | 5.9 (full) |
| 5-S14 | Household preferences → enable Geolocation for cultural supplier routing → browser asks permission → audit-logged | 5.15 |
| 5-S15 | Send a voice turn → see transcript in account settings → switch to "Immediate-delete" → transcript gone | 5.16 |
| 5-S16 | Standard-tier account sends voice turns totalling 10:01min → 11th turn rejected with cap copy; text turns still work unlimited | 5.7 (tier-cap), prep for Epic 8 |
| 5-S17 | Primary transfers ownership to partner → partner accepts → roles swap, audit-logged | 5.5 (full transfer + revoke) |
| 5-S18 | Dev-mode forced server_seq gap → `/v1/internal/client-anomaly` beacon fires → Grafana anomaly rate spikes | 5.17 (full ops dashboard) |

**Count:** 18 slices (was 20 before the Epic 12 reconciliation).

---

## Sequencing

```
S1 ─ S2 ─ S3 ──┬─ S4  (thread sequencing + SSE resync)
       [MVP   ├─ S5  (voice — depends on 12-S10 in parallel)
        wall] ├─ S6  (early-ack + filler-phrase doctrine)
              ├─ S7  (passive memory enrichment)
              ├─ S8  ("I noticed" callout)
              ├─ S9  (plan-reasoning "Why this?")
              ├─ S10 (cultural recognition + ratchet)
              ├─ S11 (adaptive tone)
              ├─ S12 (DisambiguationPicker L3/L4)
              ├─ S13 (caption-only mode)
              ├─ S14 (geolocation opt-in)
              ├─ S15 (voice retention controls)
              ├─ S16 (voice tier cap)
              ├─ S17 (caregiver transfer/revoke)
              └─ S18 (thread anomaly beacon)
```

**MVP wall = S3.** Below the wall is strictly sequential — by S3 you have two-parent presence + caregiver invite redeemed + packer assignment landing in the shared family thread. That's Epic 5's headline promise without depending on voice (S5+) or any of the 14 enhancement slices above the wall. Coordination beta cohorts can use this from S3 onward.

Above the wall, most slices are parallelizable. The exceptions are S4 (depends on S3's family thread schema existing) and S5 (depends on Epic 12 12-S10 shipping in parallel).

---

## Slice 5-S1 — Multi-tab presence

**Demo:** Log in on two tabs (or one laptop + one phone). Both open `/app`. Each shows "Devon is also on Brief" badge top-right. Close one tab → other tab's badge clears within seconds.

**Layers:**
- **UI:** `<PresenceIndicator>` on Brief.
- **API:** `GET /v1/events?client_id={uuid}` per-tab SSE channel registered in Redis. Presence-active events broadcast filtered by household membership.
- **Agent:** none.
- **DB:** ephemeral (Redis presence; nothing persisted to threads yet).

**Deferred:** Family thread schema (lands in S3 with PackerOfTheDay), per-surface presence beyond Brief (added incrementally in later slices that introduce new surfaces).

**Cited PRD codes:** UX-DR9.

---

## Slice 5-S2 — Caregiver invite + redemption

**Demo:** Primary parent → Settings → "Invite partner" → emails a signed-JWT link → partner clicks → `/invite/$token` → redeem → lands on `/app` with shared household visible. Both can see each other via S1's presence indicator.

**Layers:**
- **UI:** Invite-generation form + `/invite/$token` redemption surface (route already exists from Epic 2).
- **API:** `POST /v1/auth/invites` (Story 2.3 backend done), `POST /v1/auth/invites/redeem` (new).
- **DB:** `caregivers` join table; existing invite_jti table from Story 2.3.

**Deferred:** Revoke + ownership transfer → S17.

**Cited PRD codes:** FR10, FR30.

---

## Slice 5-S3 — PackerOfTheDay + family-thread schema 🚧 MVP WALL

**Demo:** Two parents on `/app` (from S1 + S2). Primary taps Tuesday tile → assignment picker → choose Devon → Devon's tab updates instantly. Tile shows "Tuesday — Devon's packing". Open state ("Nobody's claimed Wednesday") visible for unassigned days.

**Layers:**
- **UI:** `<PackerOfTheDay>` chip on PlanTile + assignment picker.
- **API:** `PATCH /v1/households/:id/days/:date/packer` writes assignment + emits SSE `packer.assigned` + writes a `<TurnSystemEvent>` to the family thread.
- **Agent:** none.
- **DB:** Migration creates `threads(id, household_id)` and `thread_turns(id, thread_id, server_seq bigint generated by sequence, role, body jsonb, created_at)` — **this is where the family thread is born.** Plus `day_assignments(household_id, date, packer_user_id, assigned_at, assigned_by)`.

**Why family-thread schema is bundled here:** The original Story 5.1 was "build the thread schema" as a standalone deliverable — not a slice because nobody could demo it on its own. PackerOfTheDay is the first user-visible feature that *needs* a persisted family-thread turn (`packer.assigned` as `system_event`). Shipping the schema + endpoint + first turn type together is the smallest demoable thread-introduction slice.

**Cited PRD codes:** FR27, UX-DR29, FR28 partial (server_seq comes in S4).

**Why this is the MVP wall:** After S3, Epic 5's headline promise — "share the load with my partner, see who's packing tomorrow" — is fully realized. Coordination beta cohorts can use the multi-parent flow even before voice (S5) lands, and without depending on Epic 12 ambient Lumi at all.

---

## Slice 5-S4 — Thread sequencing + SSE resync

**Demo:** Open dev tools → drop the SSE socket. From another tab, assign a packer (S3's flow). First tab reconnects SSE → detects sequence gap → fires `GET /v1/threads/:id?from_seq=N` → missed `packer.assigned` turn appears in order.

**Layers:**
- **API:** `server_seq` column on `thread_turns` is auto-allocated from a per-thread sequence. `POST` writes increment; `GET ?from_seq` filters. SSE `thread.turn` carries seq. Client tracks last-seen seq per thread; on gap → triggers `thread.resync`.

**Why this slice can ship now:** S3 introduced persisted thread turns (`packer.assigned`). S4 can use those existing turns as the test material for the gap-recovery demo — no need for ambient Lumi chat (Epic 12) or any other persisted turn type.

**Cited PRD codes:** FR28 (full), Foundation Gate 1.

---

## Slice 5-S5 — Voice thread (Premium tier, captions on)

**Demo:** Tap mic in LumiPanel → hold → speak "swap Tuesday's lunch" → release → Lumi voice replies with caption ribbon synchronized. Caption text also lands in the *ambient Lumi thread* (Epic 12's `/v1/lumi/turns` thread, NOT the family thread) as a `<TurnMessage>` with `aria-live=polite`.

**Layers:**
- **UI:** `<VoiceOverlay>` with caption ribbon; mic in LumiPanel.
- **API:** _(updated 2026-06-07 — off-Agent)_ `POST /v1/voice/sessions` creates the session; the browser opens HiveKitchen's own WS `GET /v1/voice/ws` and streams WAV utterances; the API calls ElevenLabs Scribe STT (REST, synchronous) + TTS. **No `POST /v1/voice/token`, no `POST /v1/webhooks/elevenlabs`, no HMAC** — those are the deprecated ConvAI/Agent model. Mirror story 2.6b.
- **Agent:** HiveKitchen's OpenAI LumiAgent generates the reply (same as text); the reply text goes to ElevenLabs TTS.
- **DB:** `voice_transcripts(thread_id, turn_id, transcript, retention_until)`.

**Cross-epic dependency:** 12-S10 (tap-to-talk voice infrastructure) ships in parallel. This slice provides the captions/transcript persistence layer that 12-S10 consumes.

**Note for separate decision:** This slice is voice-adjacent — its primary user-visible behavior is on LumiPanel (Epic 12 surface). It might be cleaner to fold into 12-S10. Flagged but not yet folded.

**Deferred:** Tier cap (S16), retention controls (S15), early-ack (S6).

**Cited PRD codes:** FR60 (captions), NFR-A11Y-3, AR-14 partial, UX-DR58.

---

## Slice 5-S6 — Latency doctrine (early-ack + filler-phrase lint)

> **FOLDED INTO EPIC 12 (domain), 2026-06-07.** Tracked as Epic-12-domain (its only live consumer is the ambient-voice thinking-gap, an Epic 12 surface). The `5-s6` key/file are retained for the in-flight ready-for-dev story; physical renumber to `12-sNN` available on request. **Scope reconciled to codebase:** §3.5's full early-ack continuation transport (sync-vs-async split delivering the answer later over SSE) is **DEFERRED** — no real-time conversational path tool-calls today (`LumiAgent.respond`/`OnboardingAgent.respond` are single-shot, no tools; only the background `planWeek` job tool-calls), so the `>6000ms` branch has no live trigger. The slice ships: the `no-assistant-filler` ESLint rule, the tested `classifyLatency` latency-doctrine primitive, and the live non-verbal `lumi.thinking` orb pulse on the real STT→reply gap. See `_bmad-output/implementation-artifacts/5-s6-latency-doctrine-early-ack-filler-phrase-lint.md`.

**Demo (as-shipped):** Open a PR adding `"Let me pull that up..."` → CI fails on the `no-assistant-filler` lint rule. In a voice session, the LumiOrb shows a calm non-verbal "thinking" pulse during the STT→reply gap (no speech filler). *(Original spec demo — "estimated tool latency >6000ms → 'one sec.' → continuation over SSE" — is the deferred Deliverable D.)*

**Layers:**
- **API:** Orchestrator sums `maxLatencyMs` of expected tool chain; ≤6000ms → sync; >6000ms → early-ack + async continuation. ESLint rule blocks filler-phrase literals across `apps/*/src/`.
- **UI:** Presence `lumi-thinking` orb pulse during 1.5–4s estimated tools (non-verbal signal).

**Note for separate decision:** Latency-doctrine logic ultimately governs how Lumi responds across both family-thread and ambient-thread paths. The doctrine is shared; might cleanly live in Epic 12. Flagged but not yet folded.

**Cited PRD codes:** AR-14, AR-15, FR63 partial.

---

## Slice 5-S7 — Passive memory enrichment

**Demo:** In chat (ambient Lumi panel from 12-S8/12-S9), say "Diwali is in three weeks". Lumi acknowledges naturally. Open the Visible Memory dev-peek (or Account → Memory if Epic 7 surface exists) → new memory_node "cultural_calendar.diwali_2026-11-12" with provenance link back to your turn.

**Layers:**
- **API:** LumiAgent (Epic 12 12-S9) invokes `memory.note` agent tool when enrichment signals detected; tool writes `memory_nodes` with `source_type='turn'`, `source_ref=turn_id`, `confidence` score.
- **Agent:** `memory.note` registered in tool manifest (Story 1.9).

**Cross-epic dependency:** Visible Memory panel is Epic 7. For Epic 5 this slice ships a dev-mode peek; full surface ships in Epic 7.

**Cited PRD codes:** FR59, AR-7.

---

## Slice 5-S8 — "I noticed" learning moments

**Demo:** Accumulate ≥3 inferences across a week. Brief footer renders callout "I've noticed Layla rotates between dal-rice and rajma-rice on Tuesdays — want me to keep that in mind?" with [Yes] [Tell more] [Not for us]. Tap Yes → `TemplateStateChangedEvent` audit row.

**Layers:**
- **UI:** New `<LumiCallout>` component. Renders in Brief footer.
- **API:** Cron or on-write threshold check on `memory_nodes`; surfaces callout via brief_state projection extension.

**Cited PRD codes:** FR62.

---

## Slice 5-S9 — "Why this?" plan reasoning

**Demo:** Tap "Why this?" on Wednesday's PlanTile → Lumi opens panel → reads `audit_log.stages[]` for that plan → renders prose explanation citing memory nodes, cultural priors, pantry state.

**Layers:**
- **UI:** "Why this?" button on PlanTile (small, secondary).
- **API:** Read-only query over `audit_log` with `correlation_id = plan_id`; explanation generated at plan-compose time and cached (never LLM-on-scroll).

**Cited PRD codes:** FR64.

---

## Slice 5-S10 — Cultural recognition + family-language ratchet

**Demo:** Use "Nani" twice in conversation → Lumi originates ratification turn "I noticed Nani's dal is on the week — keep it on the week?" with [Yes] [Not quite — tell more] [Not for us]. Tap Yes → from now on Lumi uses "Nani" everywhere; once locked, never retreats to "Grandma".

**Layers:**
- **API:** L2/L3 priors with `suggested → active` state machine; ratification turn auto-emitted on `suggested` reach.
- **UI:** Ratification turn rendered with three pill options + sacred-plum tint on family-language word.
- **DB:** `users.preferred_family_language_terms JSONB` tracks ratchet.

**Cited PRD codes:** UX-DR43, UX-DR44, UX-DR47.

---

## Slice 5-S11 — Adaptive Lumi tone/length

**Demo:** Sunday 8pm "tomorrow's plan?" → 3-sentence warm response. Tuesday 7am same query → one-liner.

**Layers:**
- **API:** Orchestrator passes `time_of_day`, `last_active_at`, `current_surface` into prompt context; prompt instructions adapt tone + length.

**Cited PRD codes:** FR61, FR63.

---

## Slice 5-S12 — DisambiguationPicker L3/L4 with bidirectional tether

**Demo:** Tap "swap Wednesday" → Lumi needs clarification → L3 inline conversational input opens → answer in thread → source tile pulses sacred-plum at 1.6s breath loop → tile resolves with QuietDiff summary → pulse stops. Reduced-motion users see static plum dot, no breathing animation.

**Layers:**
- **UI:** New L3/L4 modes for existing DisambiguationPicker (currently only L1/L2). Thread breadcrumb at top "Continuing from Wednesday's dinner". Sacred-plum pulse animation (CSS keyframes, motion-reduce alternative).
- **API:** Family thread `<TurnProposal>` turn type lands here (first proposal turn — Epic 9 surveys 10-S7 reuses).

**Cited PRD codes:** UX-DR21, Step 5 §Tap-to-Conversation.

---

## Slice 5-S13 — Caption-only mode

**Demo:** Account → Accessibility → toggle "Text only" → next voice query: Lumi doesn't auto-play TTS, captions still stream to thread synchronously.

**Note for separate decision:** Voice-adjacent — might fold into Epic 12. Flagged but not yet folded.

**Cited PRD codes:** FR60 (full), UX-DR58.

---

## Slice 5-S14 — Geolocation opt-in (household-level)

**Demo:** Settings → "Find cultural suppliers near me" → toggle on → browser requests permission → user grants → household.geolocation_enabled=true, audit-logged. Child profiles never show this option.

**Layers:**
- **UI:** Toggle on `/app/household/settings`.
- **API:** `PATCH /v1/households/:id/preferences` writes consent + purpose enum.
- **DB:** `households.geolocation_enabled`, `geolocation_consented_at`, `geolocation_purpose`.

**Cited PRD codes:** FR74, NFR-PRIV-3.

---

## Slice 5-S15 — Voice transcript retention controls

**Demo:** Send a voice turn → Account → Voice Data → see transcript with retention countdown. Switch mode to "Immediate-delete" → transcript gone within 1 second.

**Layers:**
- **UI:** Account → Voice Data surface.
- **API:** `PATCH /v1/users/me/voice-retention` for mode; nightly purge job.
- **DB:** `voice_transcripts.retention_until`.

**Cited PRD codes:** FR75.

---

## Slice 5-S16 — Voice tier cap

**Demo:** Standard tier account sends voice turns totalling 10:01min in a week → 11th turn fails with copy "You've used this week's voice time. Text still works." Text turns continue unlimited.

**Layers:**
- **API:** `voice_usage(user_id, week_start, ms_consumed)`; the tier cap is checked at session creation (`POST /v1/voice/sessions`) — there is no `POST /v1/voice/token` (off-Agent, 2026-06-07).

**Cross-epic dependency:** Full FR104 tier logic ships in Epic 8/10. This slice has a placeholder counter for beta.

**Cited PRD codes:** FR58, FR104 partial.

---

## Slice 5-S17 — Caregiver transfer + revoke

**Demo:** Primary parent → Household Settings → "Transfer primary to Devon" → Devon receives in-thread acknowledgment request → Devon accepts → roles swap. Separately: Primary → "Remove access" on Devon → instant revoke without consent.

**Layers:**
- **UI:** Settings UI for both.
- **API:** `POST /v1/households/:id/transfer-primary`, `DELETE /v1/households/:id/caregivers/:user_id`.

**Cited PRD codes:** FR31.

---

## Slice 5-S18 — Thread integrity anomaly beacon (ops)

**Demo:** Dev-mode toggle artificially skips a server_seq → client detects gap → `/v1/internal/client-anomaly` beacon fires → row appears in `thread_integrity_anomalies` table → Grafana anomaly-rate panel ticks up. At >10 anomalies/hour, ops alert fires.

**Layers:**
- **API:** `/v1/internal/client-anomaly` route (no JWT, CORS allowlisted, 10 req/min/IP rate-limit).
- **UI:** Client gap detector wired to beacon.
- **DB:** `thread_integrity_anomalies`.
- **Ops:** Grafana dashboard panel + alertmanager rule.

**Cited PRD codes:** Architecture amendment Mary + S compensating control.

---

## Cross-epic dependencies created by this slice ordering

| Slice | Depends on (other epic) | Status |
|---|---|---|
| 5-S5 | Epic 12 12-S10 (voice infrastructure in parallel) | 🚧 parallel ship |
| 5-S7 (memory.note) | Story 2.13 (visible-memory write primitives) — DONE | ✅ ready |
| 5-S8 ("I noticed") | Epic 7 Visible Memory panel for full provenance UI; dev-peek in interim | ⚠️ Epic 7 not yet decomposed |
| 5-S9 ("Why this?") | Stories 3.5 + 3.8 audit_log stages writes — DONE | ✅ ready |
| 5-S10 (cultural ratchet) | Story 2.11 (cultural-template inference) — DONE | ✅ ready |
| 5-S16 (voice tier cap) | Epic 8 tier logic — not yet | 🚧 placeholder OK for beta |

---

## Notes on what's intentionally NOT a slice

- **"ThreadTurn polymorphic envelope"** (old Story 5.3) is *not* its own slice because nobody can demo "the envelope handles 5 body types" in isolation. Instead, each turn type is introduced where it has a user-visible purpose: `system_event` in S3 (`packer.assigned`), `plan_diff` already shipped from Epic 3 as QuietDiff, `proposal` arrives in S12 (DisambiguationPicker L3/L4), `presence` in S1.
- **"Ambient Lumi message turns"** (old 5-S1/5-S2 envelope work) folded into Epic 12 12-S8/12-S9 — see top-of-doc reconciliation.

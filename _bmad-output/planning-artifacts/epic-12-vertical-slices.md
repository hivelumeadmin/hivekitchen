# Epic 12 — Vertical Slice Re-Decomposition (Phase-2 onward)

**Status:** Applied approach (b) — see [`epic-4-vertical-slices.md`](epic-4-vertical-slices.md) for slicing methodology.

**Source:** [`epics.md`](epics.md) §"Epic 12: Ambient Lumi Companion" — Phases 1 + 2 are DONE (stories 12.1–12.7). This conversion covers the remaining horizontal stories 12.8 → 12.12.

**Output:** 5 vertical slices. **MVP wall at 12-S9** — ambient Lumi feels alive (real LLM responses with surface-aware prompts + household snapshot).

**Phase 1 / 2 already-shipped infrastructure:** Lumi contracts (12.1), Lumi store (12.2), thread-turns GET endpoint (12.3), thread uniqueness migration (12.4), voice session lifecycle (12.5), LumiOrb + LumiPanel mounted in root layout (12.6), route context registration (12.7). All slices below build on this.

---

## Architectural reconciliation with Epic 5 (RESOLVED 2026-05-12)

**Family thread vs. ambient-Lumi thread** are now firmly separated:

- **Family thread** (`/v1/threads`, Epic 5): shared across all caregivers in a household, carries `system_event` (5-S3 packer.assigned), `presence` (5-S1), `proposal` (5-S12 DisambiguationPicker L3/L4), `plan_diff` (already shipped via Brief QuietDiff). Lifetime: per-household.
- **Ambient Lumi thread** (`/v1/lumi/turns`, Epic 12): scoped per `(user, surface, context_signal)`. Carries the LumiPanel conversation (text + voice) specific to the surface the user is on. Lifetime: per-surface-per-user, lazily created.

**Decision recorded:** The "tap LumiOrb → type → Lumi reply" flow is canonically Epic 12's responsibility. The original 20-slice Epic 5 doc had two slices (old 5-S1 stub-agent + old 5-S2 real-Lumi) that mis-scoped ambient Lumi chat as family-thread work; those folded into **12-S8** and **12-S9** respectively. Epic 5 renumbered down by 2 (now 18 slices). See [`epic-5-vertical-slices.md`](epic-5-vertical-slices.md) top-of-doc note.

**Sequencing implication:** 12-S8 ships *before* 5-S1 (multi-tab presence). The whole Epic-12-Phase-2 sequence (12-S8 → 12-S9 stub-then-real Lumi) is a precondition for anything in Epic 5 that needs LumiPanel to be conversational. Most Epic 5 slices don't directly depend on Lumi chat though — they're about coordination (presence, packer, caregiver invites, etc.) and can interleave.

**Still flagged for separate decision:** Three voice-adjacent Epic 5 slices remain — 5-S5 (voice thread with captions), 5-S6 (latency doctrine + filler-phrase lint), 5-S13 (caption-only mode). All three involve LumiPanel UX and may also belong in Epic 12. Not folded yet — awaiting decision.

---

## Slice map

| Slice | Demo path | Old stories folded in |
|---|---|---|
| 12-S8 | Tap LumiOrb on Brief → panel opens → type "hi" → POST `/v1/lumi/turns` → user turn + stub Lumi turn ("Got it.") persist in `(user, surface='brief')` thread → reload page, both turns still there | 12.10 (partial: text turn endpoint with stub agent) |
| 12-S9 | Same flow, but ask "what should we have Tuesday?" → LumiAgent responds contextually citing actual children names + active allergens + Tuesday's dish; on `/app/grocery-list`, same query gets grocery-focused response | 12.9, 12.10 (full) **MVP wall** |
| 12-S10 | As Premium-tier parent, tap orb → switch to voice mode → speak → transcript renders in panel → hear Lumi reply via TTS → tap to end (or 20s inactivity). Raw audio bypasses HiveKitchen API. Standard-tier: tap voice button → see "Voice is a Premium feature" copy, falls back to text. | 12.8 |
| 12-S11 | Trigger a plan-generation completion event → 1–5 sec later, open Lumi panel → see new Lumi nudge turn referencing the plan ("I just finished next week — Tuesday has Layla's dal-rice"). Trigger again within 30 min → second nudge persisted but no orb signal (rate-limited). | 12.11 (turn persistence side) |
| 12-S12 | Trigger event → orb breathes (motion-safe) / glows → tap → panel opens to the nudge. Notification preferences toggle "Proactive Lumi nudges" off → trigger event → orb calm, nudge skipped entirely (turn not persisted either). Toggle accessible from both LumiPanel settings AND main notification preferences. | 12.11 (SSE delivery + orb breathing), 12.12 |

**Count:** 5 slices, matching the 5 original stories (the original stories were already roughly vertical — this conversion mainly tightens the demo paths and splits Story 12.11 into "turn persists" + "SSE orb breathes + opt-out").

---

## Sequencing

```
12-S8 ─ 12-S9 ──┬─ 12-S10 (voice path)
        [MVP    │
         wall]  └─ 12-S11 ─ 12-S12 (proactive nudges)
```

**MVP wall = 12-S9.** Below S9, the ambient Lumi panel works but Lumi gives stub responses — there's no "ambient companion" feel yet. After S9, the panel feels alive on every surface: ask anything from any screen, get a contextual response. **This is the wall that earns Epic 12 its name.**

12-S10 (voice) is parallel to 12-S9 — same MVP-wall tier of importance for Premium, but text is what unlocks the daily experience for the broader Standard cohort.

12-S11 + 12-S12 are sequential — nudges aren't useful without the orb-breathe + opt-out (S12) ergonomics.

---

## Slice 12-S8 — Ambient text turn (stub agent)

**Demo:**
1. Log in to Brief → tap LumiOrb (already mounted from 12-6)
2. LumiPanel opens
3. Type "hi" in composer → send
4. Browser POST `/v1/lumi/turns` with `{ message: "hi", context_signal: { surface: 'brief' } }`
5. API resolves-or-lazy-creates thread keyed by `(user_id, surface='brief')`
6. User turn persists; LumiAgent stub returns "Got it."; Lumi turn persists
7. Response returns `{ thread_id, turn_id, lumi_turn_id, lumi_response: "Got it." }`
8. Panel renders both turns
9. Reload page → tap orb again → both turns still there

**Layers:**
- **UI:** LumiPanel composer wired to `/v1/lumi/turns`. Surface inferred from Lumi store (Story 12.2 done). Renders the returned thread + appends turns optimistically.
- **API:** `POST /v1/lumi/turns` accepts `{message, context_signal}` + JWT auth. Lazy thread creation. Persists user turn → calls LumiAgent stub → persists Lumi turn → returns IDs + response.
- **Agent:** Stub `LumiAgent.respond()` that returns `"Got it."` regardless of input (real implementation lands in S9).
- **DB:** `lumi_threads(id, user_id, surface, created_at)`, `lumi_turns(id, thread_id, role, body, created_at)`.

**Deferred:** Real LLM responses (S9), surface-specific prompts (S9), household snapshot injection (S9), voice (S10), proactive nudges (S11–S12).

**Cited PRD codes:** ADR-002 Decision 3 partial (text turn endpoint).

**Canonical slice for ambient Lumi text turns.** Old Epic 5 5-S1 and 5-S2 (stub + real Lumi on family thread) folded into this slice and 12-S9 respectively — see reconciliation note above.

---

## Slice 12-S9 — LumiAgent with surface prompt dispatch + household snapshot 🚧 MVP WALL

**Demo:**
1. On Brief, type "what should we have for Tuesday?" in LumiPanel
2. Response: *"Tuesday is dal-rice with Layla's safe-for-peanut option. Want me to swap the protein?"* — cites actual child name + active allergens + the Tuesday dish from the current plan
3. Navigate to `/app/grocery-list`, ask "what's on the list?"
4. Response: *"You've got 12 items left, mostly Produce. The atta from Haji's is the only specialty stop."* — surface-specific grocery framing
5. Both responses persist into their respective surface threads (no thread cross-talk)

**Layers:**
- **Agent:**
  - `apps/api/src/agents/lumi.agent.ts` exports `LumiAgent.respond({ surface, contextSignal, turns, householdSnapshot, modality })`
  - `apps/api/src/agents/prompts/lumi-base.prompt.ts` (shared persona, extracted from existing `onboarding.prompt.ts`)
  - `apps/api/src/agents/prompts/surfaces/` directory: one prompt per surface (`planning`, `meal-detail`, `child-profile`, `grocery-list`, `evening-check-in`, `heart-note`, `general`)
- **API:** `POST /v1/lumi/turns` from S8 now passes through the real LumiAgent. Before calling, fetches a household snapshot (family name, children first names, active allergens) from DB → injects as a system message. Agent never reads DB directly.
- **Refactor:** `OnboardingAgent` switched to use `lumi-base.prompt.ts` as its persona source — all existing onboarding behavior unchanged. This validates the shared-persona extraction.

**Cited PRD codes:** ADR-002 Decision 6.

**Why this is the MVP wall:** Without S9, the panel is a chat box that replies "Got it." After S9, every surface gets a Lumi who *knows what you're looking at and who your family is*. That's the moment "ambient companion" earns its name.

**Manual test path:**
1. Seed test household with 2 children (Layla 7, Ayaan 4) + active allergens (peanut for Layla)
2. Generate a plan for the current week
3. On Brief, ask "tell me about Tuesday" → response should cite Layla, peanut, and Tuesday's actual dish
4. Switch surface to `/app/grocery-list` → ask "what do I still need?" → response should reference items from the current week's grocery list, not Tuesday's lunch
5. Open onboarding flow (if accessible in dev) → confirm OnboardingAgent still behaves identically (regression check on the shared-persona refactor)

---

## Slice 12-S10 — Tap-to-talk voice (Premium)

**Demo (Premium):**
1. As Premium tier, tap LumiOrb on any surface → mode selector → choose voice
2. Browser calls `POST /v1/lumi/voice/sessions` (already shipped Story 12-5) → receives single-use ElevenLabs STT + TTS tokens
3. Browser opens STT WebSocket + TTS WebSocket directly to ElevenLabs (raw audio bypasses HiveKitchen API)
4. User speaks → STT WebSocket sends transcript → transcript appended to LumiPanel as user turn
5. Transcript forwarded to HiveKitchen WS → HiveKitchen calls LumiAgent → response sent back via `{type: 'response.text', text}`
6. Response text appended to panel as Lumi turn + forwarded to TTS WebSocket → audio plays
7. Tap to end OR 20s of silence → both WebSockets closed → `DELETE /v1/lumi/voice/sessions/:id` called

**Demo (Standard):**
1. As Standard tier, tap voice mode → see graceful copy "Voice chat is part of Premium. We've got you in text — same Lumi."
2. Panel falls back to text mode (S8/S9 functionality intact)

**Layers:**
- **UI:** Voice mode UI in LumiPanel; WebSocket handlers for STT + TTS; tier-aware mode picker.
- **API:** Voice session lifecycle already shipped in 12-5; this slice consumes it.
- **No backend audio path** — that's the whole point per ADR-002 Decision 4.

**Cross-epic dependency:** Tier-gate.service from Epic 8 8-S9 (or beta-Premium-stub before that lands).

**Cited PRD codes:** ADR-002 Decision 4.

---

## Slice 12-S11 — Proactive nudge (turn persistence, rate-limited)

**Demo:**
1. Trigger a plan generation completion (via dev-mode "regenerate week" or wait for the weekly cron)
2. Within ~5 seconds, async job calls `LumiAgent.generateNudge({ trigger: 'plan_completed', surface: 'brief', context })`
3. Nudge persists as a Lumi turn in the Brief surface thread for the user(s)
4. Open Lumi panel manually → see the new nudge turn at the top of the thread
5. Within 30 min, trigger another event → second nudge generated + persisted, but Redis rate-limit gate blocks any orb signal
6. After 30 min, trigger again → orb signal allowed

**Layers:**
- **API:** Event hooks on `plan_completed`, `meal_rating_received`, `allergen_flagged`, `evening_checkin_completed` → call async `LumiAgent.generateNudge()` after the mutation resolves.
- **Rate limit:** Redis key `lumi:nudge:household:{id}` with 30-min TTL gates the *signal* (S12's SSE event), not the persistence (turns always persist for audit/recovery).
- **DB:** `lumi_turns` (existing) gains a `nudge_trigger` enum field for traceability.

**Deferred:** SSE delivery + orb breathing (S12), opt-out preference (S12).

**Cited PRD codes:** ADR-002 Decision 7 (persistence side).

---

## Slice 12-S12 — Orb breathing on nudge + global opt-out

**Demo (default state):**
1. Notification preferences: `proactive_lumi_nudges = true` (default)
2. Trigger a registered nudge event → S11's flow persists the nudge → S12's SSE emitter fires `lumi.nudge` on the household channel (if Redis rate-limit allows)
3. Frontend orb starts breathing/glowing (motion-reduce → static accent dot)
4. User taps orb → panel opens → nudge visible at top of thread

**Demo (opt-out):**
1. Open notification preferences (or LumiPanel settings) → toggle "Proactive Lumi nudges" off
2. Trigger event → SSE event suppressed; `LumiAgent.generateNudge()` *skipped entirely* (no turn persisted either — the user has chosen silence)
3. Orb stays calm. Panel shows no new turn when opened.

**Layers:**
- **API:** SSE `lumi.nudge` emitter on the household channel. `notification_prefs.proactive_lumi_nudges` boolean field (default `true`).
- **UI:** Orb breathing animation triggered by SSE event; opt-out toggle in two places (LumiPanel settings + main notification preferences).

**Cross-epic dependency:** Epic 5 5-S1 (per-tab SSE channel) + Epic 2 notification preferences (Story 2.5, done).

**Cited PRD codes:** ADR-002 Decision 7 (delivery side), ADR-002 OQ-5, FR105.

---

## Cross-epic dependencies

| Slice | Depends on | Status |
|---|---|---|
| 12-S8 | 12.1–12.7 (Phase 1 + 2 Lumi infrastructure) | ✅ done |
| 12-S9 | Existing OnboardingAgent (Story 2.6) — DONE | ✅ ready |
| 12-S10 | 12.5 (voice session lifecycle) — DONE; 8-S9 (tier-gate) | ⚠️ tier-gate depends on Epic 8 |
| 12-S11 | 12-S9 (LumiAgent.respond exists) | sequential |
| 12-S12 | 5-S1 (per-tab SSE), 2.5 (notification prefs) | ✅ both available |

---

## Updated conversion progress

| Epic | Slices | Walls |
|---|---|---|
| 4 (Lunch Link + Heart Note) | 18 | MVP wall at S5 |
| 5 (Coordination + Evening Check-in) | 18 | MVP wall at S3 |
| 6 (Grocery + Silent Pantry) | 11 | MVP wall at S6 |
| 7 (Visible Memory + Trust) | 13 | Feature S5, regulatory S11 |
| 8 (Billing + Tiers) | 13 | Revenue S5, tier-gate S9, gift S11 |
| 9 (Ops Dashboard) | 9 | Incident S3, compliance S7 |
| 10 (Beta→Launch) | 7 | CC-VPC launch S1 |
| 11 (Marketing) | 8 | Launch wall S5 |
| 12 (Ambient Lumi, Phase 2+) | 5 | MVP wall at S9 |

**Total: 102 slices** across 9 open epics (was 83 horizontal backlog stories). 2 slices removed by the Epic 5 ↔ Epic 12 reconciliation (old 5-S1 + 5-S2 folded into 12-S8 + 12-S9).

All open backlog work is now in vertical-slice form. Sprint-status.yaml migration applied.

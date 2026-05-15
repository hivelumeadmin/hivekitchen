# Epic 2 — Onboarding Integration Slices (post-hoc)

**Status:** Slices `2-s20` through `2-s26`. Filed 2026-05-12 after the user pointed out that onboarding was nominally "done" at the component level (Stories 2-6, 2-6b, 2-7, 2-11, 2-13, 2-14) but the **feature thread end-to-end has never been proven working**. This doc decomposes the remaining integration work into vertical slices.

**Why now:** Epic 2's done-status reflected per-story acceptance (each component shipped + unit tests pass) but the manual verification thread VT-2-T6 ("Voice onboarding interview") flagged the integration as untested. A user landing on `/onboarding` today gets a working visual chrome and mode picker — but the actual STT/TTS round-trip, agent tool calls, and profile-completion handoff have never been verified together. This is the gap.

**Relationship to existing slices:**
- Pairs with `2-s19` (resume-incomplete-onboarding) which is `done`. That slice handles routing; these slices handle the actual experience.
- The verification thread catalog (`epic-2-verification-threads.md`) treats these slices as the manual-test gates for VT-2-T1, VT-2-T6, VT-2-T7, VT-2-T10, VT-2-T11, VT-2-T15. Once shipped, those threads become exercisable.

---

## Slice map

| Slice | Demo path | Verifies stories |
|---|---|---|
| `2-s20` | On `/onboarding` select mode, tap a small audio icon next to the headline → Lumi TTS reads the headline + mode-picker copy aloud. Pause/resume control. | New affordance — no existing story. Smallest test of ElevenLabs TTS env wiring. |
| `2-s21` | Tap voice mode → ElevenLabs STT + TTS WebSockets open → Lumi greets via TTS → speak answer → STT transcript appears in chat panel → Lumi responds via TTS → back-and-forth through 3 signal questions ending at consent step. **MVP wall.** | Stories 2-6 (voice onboarding) + 2-6b (voice pipeline v2) end-to-end |
| `2-s22` | During voice or text interview, `OnboardingAgent` extracts (family names, child names + age bands, declared allergens, cultural template hints, bag preferences) and persists each as it's captured — verify in Supabase that `children`, `cultural_priors`, `memory_nodes` rows appear progressively during the interview. | Stories 2-11 (cultural template inference) + 2-13 (visible memory writes) + 2-10 (add child) integrated |
| `2-s23` | At end of interview, parental-notice consent step → user acknowledges → user lands on `/app` with `is_onboarded=true`, real children rows + acknowledged parental notice. Brief renders (with the "Lumi is preparing your first plan" empty state if no plan yet). | Story 2-8 (COPPA soft-VPC) + 2-9 (parental notice) + handoff to Epic 3 BriefCanvas. Pairs with 2-s19 routing. |
| `2-s24` | Same as `2-s21`/`2-s22` but text mode — user typing instead of speaking. Same agent + tool path, same end-of-flow handoff. | Story 2-7 (text-equivalent path) end-to-end |
| `2-s25` | Interview mentioned a cultural identifier ("we celebrate Diwali", "Nani's biryani is a Friday thing"). End-of-flow ratification card surfaces: *"I noticed [Bengali household / Nani family-language]. Want me to keep that in mind?"* Tap Yes → `cultural_priors.state='active'`, `users.preferred_family_language_terms` updated. Tap "Not quite" → state stays `suggested`. | Story 2-11 ratification path (not just inference) |
| `2-s26` | Start onboarding, complete Q1 of voice/text, close tab. Log back in → land on a "Continue where you left off?" surface showing the partially-captured state, with [Resume] and [Start over] options. Resume picks up at Q2. | Builds on 2-s19. Persists `onboarding_state` per user. |

**Count:** 7 slices.

---

## Sequencing

```
2-s20 (TTS read page) ──────────┐
                                 │
2-s21 (voice MVP) ─┬──── 2-s23 (consent + handoff) ──── 🚧 ONBOARDING MVP WALL
                   │                  │
2-s22 (agent tools) ┘                 │
                                       └─ 2-s25 (cultural ratification)
                                       │
2-s24 (text mode parity) ──────────────┤
                                       │
2-s26 (resume mid-flow) ───────────────┘
```

- `2-s20` is independent — smallest TTS test, ships first to validate ElevenLabs env config
- `2-s21` + `2-s22` ship together OR in tight sequence (the voice flow without agent persistence is a hollow demo)
- `2-s23` is the MVP wall — at this point, a parent can complete onboarding voice-first and land at `/app` with a real household
- `2-s24`, `2-s25`, `2-s26` are parallelizable enhancements above the wall

**MVP wall:** `2-s23`. After this slice, the headline promise of Epic 2 — *"I can become a HiveKitchen household. I sign up, complete a 10-minute voice interview, and Lumi knows my family well enough to draft my first plan within 90 seconds"* — is actually realized for the voice path.

---

## Slice 2-s20 — TTS-read the onboarding landing page

**Demo:**
1. Land on `/onboarding` select mode
2. Spot a small audio icon (Lucide `volume-2`) next to the eyebrow / headline
3. Tap it → Lumi voice reads the on-page copy aloud (headline → description → both mode option labels)
4. Icon flips to "pause" while playing; tap again to pause
5. After reaching end, icon returns to "play"

**Layers:**
- **UI:** New `<TTSReadButton>` primitive in `apps/web/src/components/`. Receives a text string and an `onPlay/onPause` callback. Renders an icon button with state.
- **API:** `POST /v1/voice/tts` — accepts `{text, voice_id}`, calls ElevenLabs TTS, streams audio back. Re-uses existing voice infrastructure from Story 2-6b's WebSocket plumbing but as a one-shot HTTP stream rather than a duplex session.
- **Agent:** none (TTS is a vendor call, not an agent call).
- **DB:** none.

**Deferred:**
- Per-paragraph syncing / highlighting (could be a polish slice later)
- TTS on other surfaces — this slice is `/onboarding` select mode only

**Why this slice first:** smallest demonstrable use of the ElevenLabs TTS env wiring. If `ELEVENLABS_VOICE_ID` or `ELEVENLABS_API_KEY` aren't configured, this slice fails fast and surfaces the gap. No agent involvement; no STT; no complex orchestration.

**Cited PRD codes:** FR (accessibility / read-aloud), NFR-A11Y-3.

---

## Slice 2-s21 — Voice interview MVP (full STT + TTS round-trip) 🚧 PARTIAL MVP

**Demo:**
1. Complete `2-s20`'s pre-onboarding mode picker → tap "Start with voice"
2. Backend: `POST /v1/voice/sessions` issues ElevenLabs STT + TTS tokens
3. Browser opens both WebSockets browser-direct (raw audio bypasses HiveKitchen API per ADR-002)
4. Lumi speaks the first signal question via TTS: *"Tell me about who's in your family."*
5. Parent speaks response → STT transcript streams into the conversation panel
6. Orchestrator routes transcript to `OnboardingAgent` → response back via TTS
7. Repeat for Q2 (*"What does a normal weekday lunch look like?"*) and Q3 (*"Any food rules I should know — allergies, cultural fasts, things they hate?"*)
8. After Q3 → conversation pauses, screen transitions to consent step (handed to `2-s23`)
9. Tap to end at any time → both WebSockets close cleanly + `DELETE /v1/voice/sessions/:id`

**Layers:**
- **UI:** `OnboardingVoice` component currently exists as a scaffold (Story 2-6). This slice wires it to the real STT/TTS pipeline. Renders a conversation thread inline. Includes mic-button state (idle / listening / processing / Lumi-speaking).
- **API:** Voice session lifecycle (`POST/DELETE /v1/voice/sessions`) already shipped in Story 2-6b. ElevenLabs HMAC webhook handler exists. Orchestrator integration verified working.
- **Agent:** `OnboardingAgent.respond({turns, householdSnapshot})` invoked per turn. At this slice the agent just responds; the data-extraction tool calls are `2-s22`'s scope.
- **DB:** `voice_transcripts` rows written per turn (Story 5-16's retention spec applies).

**Deferred to 2-s22:** the actual tool calls that persist family/child/allergen/cultural data. This slice ships the "conversation feels real" experience without locking in the persistence.

**Cited PRD codes:** FR32 (voice), FR33, FR58, ADR-002 Decision 4.

**Cross-epic dependency:** Epic 12 12-s10 (tap-to-talk voice) is the broader version of this same infrastructure. If Epic 12 ships first, this slice should reuse its voice-session plumbing rather than fork.

---

## Slice 2-s22 — Onboarding agent tool wiring

**Demo:**
1. Walk a complete voice or text interview (uses `2-s21` or `2-s24`)
2. After Q1 (*"who's in your family"*), parent says *"My partner Devon and I have one kid, Layla, she's seven."*
3. Immediately verify in Supabase: a `children` row exists for the household with `name='Layla'`, `age_band='7-9'`
4. After Q3 (*"any food rules"*), parent says *"She's peanut-allergic and we don't eat pork."*
5. Verify: `children.declared_allergens = ['peanut']`; `memory_nodes` row `source_type='turn'` capturing the no-pork preference
6. If interview mentioned a cultural identifier — Q1 or Q2 — verify `cultural_priors` row with the inferred template (`state='suggested'` at this point; `2-s25` flips it to `active`)
7. End of interview → all extracted data persisted, household snapshot fully populated

**Layers:**
- **API:** New tools registered with `OnboardingAgent`:
  - `child.upsert({name, age_band, allergens})` — persists to `children` table
  - `cultural_template.infer({hint})` — writes to `cultural_priors` with `state='suggested'`
  - `memory.note({prose, source_type, source_ref, confidence})` — already exists (Story 2-13) — re-used here
- **Agent:** `OnboardingAgent` prompt extended with extraction instructions (per signal question, what data to look for, when to call which tool). Prompts versioned.
- **DB:** writes only via the tools above; no new tables.

**Deferred:**
- The cultural ratification card (end-of-flow surface that flips `suggested → active`) — `2-s25`
- Per-tool latency budgets / observability — Story 1-9 manifest entries get added but full ops dashboard is Epic 9

**Cited PRD codes:** FR59 (memory), AR-7, Story 2-11, 2-13 integration.

**Manual test path:** after interview, run SQL:
```sql
SELECT * FROM children WHERE household_id = $me;
SELECT * FROM cultural_priors WHERE household_id = $me;
SELECT * FROM memory_nodes WHERE household_id = $me AND source_type = 'turn';
```

Each table should have rows reflecting what was said.

---

## Slice 2-s23 — Consent + parental-notice + handoff to /app 🚧 ONBOARDING MVP WALL

**Demo:**
1. Interview Q1–Q3 complete (via `2-s21` or `2-s24`)
2. Flow advances to consent step: parental-notice disclosure dialog opens (Story 2-9 component) with the canonical document content
3. Parent reads → scrolls to bottom → "I've read this — start adding my family" button enables → tap
4. Backend writes `users.parental_notice_acknowledged_at = NOW()` + version
5. (If beta cohort) soft-VPC declaration captured per Story 2-8
6. Backend computes `is_onboarded = true` (per 2-s19's derivation: parental_notice ack + at least one child row from 2-s22)
7. Client navigates to `/app`
8. BriefCanvas renders with the empty state: *"Lumi is preparing your first plan. Check back Sunday evening."*

**Layers:**
- **UI:** Consent step wires the existing `ParentalNoticeDialog` (Story 2-9) at end-of-interview. Sequence: interview → consent → handoff. Each step is its own mode in `routes/(app)/onboarding.tsx`.
- **API:** `POST /v1/compliance/parental-notice/acknowledge` (Story 2-9 done). `POST /v1/compliance/vpc` (Story 2-8 done). Both called as part of the flow.
- **Agent:** none.
- **DB:** `users` row update, `vpc_consents` row (beta cohort).

**Why this is the MVP wall:** at this point, Epic 2's headline promise *("I can become a HiveKitchen household")* is end-to-end real. A parent can sign up, complete a voice interview, acknowledge parental notice, and land on a working `/app` surface with their family known to Lumi. Beta cohorts can begin using the product from this slice onward.

**Cited PRD codes:** FR8 (VPC), FR9, NFR-COMP-1, Story 2-8, 2-9, 2-s19 (is_onboarded handoff).

---

## Slice 2-s24 — Text-mode parity

**Demo:**
1. On `/onboarding` select mode → "I'd rather type"
2. Same 3 signal questions, but text inputs (one at a time)
3. Same agent path: each typed answer → `OnboardingAgent` → extracts data → tool calls → persists
4. End of flow → same consent step + handoff as `2-s23`

**Layers:**
- **UI:** `OnboardingText` component exists as a scaffold (Story 2-7). This slice wires it to the orchestrator + tools path that `2-s22` built.
- **API:** Re-uses Story 2-7's `POST /v1/onboarding/turns` endpoint with `modality='text'`.
- **Agent:** Same `OnboardingAgent` as voice — same prompt, same tools. Modality is the only difference.

**Cited PRD codes:** FR (text-equivalent), Story 2-7.

---

## Slice 2-s25 — Cultural ratification card (RESCOPED 2026-05-15)

**Reframe note:** The original spec mixed two distinct ratifications:
1. *Template* ratification at onboarding ("Bengali household? Yes/No") — interview-driven, single decision.
2. *Family-language term* ratification over time ("Nani" vs "Grandma") — needs ambient-signal accumulation (parent saying "Nani" twice in chat → Lumi originates the question).

Audit on 2026-05-15 confirmed #1 is already shipped (`CulturalRatificationCard` +
`POST /v1/cultural-priors/ratify` + `cultural_priors.state` transitions
`detected → opt_in_confirmed`). #2 was never going to work from a 3-question
intake interview — it's properly scoped under **Epic 5 5-S10 (Story 5.14)**
where the ambient detection layer lives. The `users.preferred_family_language_terms`
column the original spec called for was never added; it would have been the
wrong place to model term ratchets.

This slice is now verification-only:

**Demo:**
1. On a fresh signup, complete the onboarding interview mentioning a cultural identifier (e.g., "we celebrate Diwali")
2. Confirm `cultural_priors` row written by `cultural.note` tool with `state='detected'`
3. `CulturalRatificationCard` surfaces between consent and mental-model with the three pill options [Yes, keep it in mind] [Tell Lumi more] [Not for us]
4. Tap Yes → ratify endpoint flips `state → opt_in_confirmed`
5. Reach `/app`; trigger a planner run; confirm `cultural.lookup` tool returns the opt-in prior so the planner can honour it
6. Re-run `apps/web/test/e2e/2-11-cultural-ratification.spec.ts` against the live flow — must pass

**Layers (all already shipped — this slice ships zero new code on success):**
- **UI:** `CulturalRatificationCard.tsx`, `CulturalRatificationStep.tsx`
- **API:** `CulturalPriorService.ratify` (`apps/api/src/modules/cultural-priors/cultural-prior.service.ts`)
- **DB:** `cultural_priors.state` transitions; `users.cultural_language` enum from Story 2.5 covers the household-level preference

**Cited PRD codes:** UX-DR43, UX-DR44, Story 2-11.

**Family-language ratchet handoff:** The UX-DR47 forward-only ratchet for
specific terms (Nani / Abuela / Yaya) moves to **Epic 5 5-S10**. Reference:
`_bmad-output/planning-artifacts/epic-5-vertical-slices.md` line 39.
That slice has the right signal model (ambient chat detection over time)
to make the ratchet meaningful.

---

## Slice 2-s26 — Resume mid-flow onboarding

**Demo:**
1. Start onboarding voice mode → answer Q1 only → close tab
2. Log back in next day → land on `/onboarding` per `2-s19`'s `is_onboarded=false` routing
3. Resume surface appears (instead of "select mode" picker): *"You started with voice on May 12. Pick up where you left off?"* with [Continue] and [Start over] options
4. Tap Continue → voice mode reopens, conversation thread re-hydrates with Q1 transcript + Lumi's prior responses → Q2 is the next prompt

**Layers:**
- **UI:** New `<OnboardingResume>` surface that appears when there's an in-progress `onboarding_state` row for the user
- **API:** `GET /v1/onboarding/state` returns current step + accumulated transcript references; `POST /v1/onboarding/state/reset` clears for "Start over"
- **DB:** New `onboarding_state(user_id, household_id, current_step, modality, started_at, last_activity_at)` table; `onboarding_turns(state_id, turn_index, role, content, captured_data jsonb)` for per-question transcripts

**Cited PRD codes:** FR (resume), UX (no-restart).

---

## What's intentionally NOT a slice

- **Voice cost monitoring during onboarding** — Story 10-S5 / 10-S6 handle voice-cost soft-cap globally. Onboarding inherits.
- **Mental-model copy + anxiety-leakage telemetry** — Story 2-14 already shipped that component. It renders inline within interview steps. No separate slice needed.
- **Onboarding analytics dashboard** — falls under Epic 9 ops dashboard scope.

---

## Cross-epic dependencies

| Slice | Depends on | Status |
|---|---|---|
| 2-s20 | ElevenLabs API + voice_id env config in `.env.local` | ⚠️ blocked on env wiring; surfaces the dev-env gap |
| 2-s21 | Story 2-6b voice WS backend + ElevenLabs HMAC webhook | ✅ shipped — needs verification |
| 2-s22 | Story 2-13 memory primitives + Story 2-11 cultural inference | ✅ shipped — needs tool registration |
| 2-s23 | Story 2-8 COPPA-soft-VPC + Story 2-9 parental notice + 2-s19 is_onboarded routing | ✅ all shipped |
| 2-s24 | Story 2-7 text path scaffold + 2-s22 agent tools | ⚠️ depends on 2-s22 |
| 2-s25 | Story 2-11 cultural inference + 2-s22 cultural_priors write | ⚠️ depends on 2-s22 |
| 2-s26 | 2-s19 routing + new onboarding_state table | ⚠️ new schema |

**Most slices have their backend already shipped — what's missing is the *integration*.** This is exactly the gap component-level "done" status masked.

---

## Sprint-status entries

To be added to `sprint-status.yaml` after this doc is reviewed:

```yaml
  # ==========================================================================
  # Epic 2 onboarding integration — surfaced 2026-05-12 by VT-2-T6 review.
  # Component-level stories 2-6 / 2-6b / 2-7 / 2-11 / 2-13 / 2-14 shipped but
  # the feature thread end-to-end was never verified. These 7 slices close
  # the gap. See: _bmad-output/planning-artifacts/epic-2-onboarding-integration.md
  # ==========================================================================
  2-s20-tts-read-onboarding-landing: backlog                                  # folds: VT-2-T6 prep (env-wiring smoke test)
  2-s21-voice-interview-mvp-stt-tts-roundtrip: backlog                        # folds: 2-6 + 2-6b integration verification
  2-s22-onboarding-agent-tool-wiring: backlog                                 # folds: 2-11 + 2-13 + 2-10 integration
  2-s23-consent-and-handoff-to-app: backlog                                   # WALL: onboarding MVP wall; folds: 2-8 + 2-9 + handoff
  2-s24-text-mode-parity: backlog                                             # folds: 2-7 integration verification
  2-s25-cultural-ratification-card: backlog                                   # folds: 2-11 ratification path
  2-s26-resume-mid-flow-onboarding: backlog                                   # new — onboarding_state persistence
```

---

## Honest framing

These 7 slices represent **work-after-the-fact for stories that were marked done but weren't actually verified end-to-end**. The marked-done stories' code did ship — they're not regressions. But the headline product promise of Epic 2 doesn't currently work without these integration slices.

The reasonable next move:
1. Walk VT-2-T6 (voice onboarding) manually on the dev environment to confirm the gap is what we think it is (and identify any other surprises)
2. Pick one slice to start with — `2-s20` is the smallest, riskless smoke test of the ElevenLabs env config, recommended as first
3. Sequence remaining slices toward the MVP wall (`2-s23`)

If the user wants this fixed before any other open epic gets touched, that's a reasonable prioritization — onboarding is genuinely upstream of every feature epic. Without onboarding working, beta cohorts can't even reach the surfaces those epics target.

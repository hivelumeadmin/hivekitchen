# VT-2-T6 Walk-through Script (Voice Onboarding)

**Purpose:** Exercise the voice-onboarding feature thread end-to-end on a running dev environment. Surface the actual gaps so the `2-s20`–`2-s23` slices can target real problems, not assumed ones.

**Audience:** You, walking through manually. I'll diagnose anything that breaks.

**Pre-flight (verified 2026-05-12):**
- ✅ `apps/api/.env.local` contains `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_WEBHOOK_SECRET`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_CUSTOM_LLM_SECRET`, `OPENAI_API_KEY`
- ✅ `apps/web/.env.local` contains `VITE_API_BASE_URL`, `VITE_API_WS_URL`, `VITE_SUPABASE_*`
- ✅ Code paths exist: `OnboardingVoice.tsx`, `useVoiceSession.ts`, `voice.routes.ts` with `POST /v1/voice/sessions` + `GET /v1/voice/ws`, `OnboardingAgent`, `VoiceService` wired
- ⚠️ Original VT-2-T6 doc said `POST /v1/voice/token` — that's stale. Actual route is `POST /v1/voice/sessions`. (Will update after this walk-through.)

---

## Setup

Run these in two terminals at repo root:

```bash
# Terminal 1 — API
pnpm dev:api

# Terminal 2 — Web (Vite dev server)
pnpm --filter @hivekitchen/web dev
```

Expected:
- API ready on `http://localhost:4000` (or whatever `PORT` is set to)
- Web on `http://localhost:5173`
- Console: no Zod env-validation errors on the API side (if you see one, the env var is missing/malformed — stop and paste the error)

**Browser:** Chrome or Edge (microphone permission flow is cleanest). Open Dev Tools to **Network** tab + **Console**, both visible. Filter Network by `Fetch/XHR` AND `WS`. Test in an incognito / fresh profile so you control auth state.

**Supabase:** Have the table editor open in another browser tab so you can verify DB writes.

---

## Step 1 — Sign in as a returning user with incomplete onboarding

The voice flow lives at `/onboarding`. To reach it, you need to be an authenticated user who is not yet onboarded (`is_onboarded=false` per 2-s19's derivation).

**Option A — fresh signup (preferred, exercises 2-s19's first-login path):**
1. Visit `http://localhost:5173/auth/login`
2. Use the signup form with a fresh test email
3. After signup, you should auto-route to `/onboarding`

**Option B — existing user with cleared state:**
- In Supabase, find your test user row in `users`. Set `parental_notice_acknowledged_at = NULL` and ensure `children` has zero rows for that household. Log in.

**Checkpoint:** URL ends with `/onboarding`. Page shows the v2.0 mode-picker (Hero, "Start with voice", "I'd rather type"). 

**If something else:** paste me the URL, the page state, and any console error.

---

## Step 2 — Tap "Start with voice"

What should happen, in order:
1. Browser prompts for microphone permission (allow it)
2. Network tab: `POST /v1/voice/sessions` — 200 response with `{session_id: "..."}`
3. Network tab: WebSocket connection to `ws://localhost:4000/v1/voice/ws?session_id=...&token=...` — status "101 Switching Protocols"
4. UI: the voice orb appears, status text cycles `Connecting…` → `Listening…`
5. Within 2-5 seconds: Lumi speaks the first signal question. You should hear: *"Tell me about who's in your family,"* or similar prompt — and the orb status text becomes "Lumi is speaking"
6. Audio plays through speakers
7. When Lumi finishes speaking, status returns to "Listening…"

**Things to watch:**
- **WebSocket frames** in the Network → WS tab — you should see `text` frames containing audio metadata + binary frames containing the actual audio chunks
- **No 401 / 4001 / 4003 close codes** — those mean auth failed
- **Console**: no errors about microphone or unsupported codecs

**If `POST /v1/voice/sessions` fails:**
- 401 → JWT not being sent (auth store empty); we shouldn't be here, log in again
- 500 → check API console for the actual error. Most common: ElevenLabs key invalid (paste the API console error)

**If WebSocket fails (1006 / 1011 close):**
- Check API console for the WS handler's error
- Verify `VITE_API_WS_URL` resolves correctly (should be `ws://localhost:4000` for dev)

**If WS connects but no audio plays:**
- Check whether the API console logs say "ElevenLabs TTS request succeeded"
- Check `ELEVENLABS_VOICE_ID` matches a real voice ID on your ElevenLabs account (some IDs are account-specific)

---

## Step 3 — Speak your first response

You: *"My partner and I have one kid named Layla, she's seven."*

What should happen:
1. Voice orb status: "Listening…" → "Thinking…" (after you stop speaking ~1.5s of silence)
2. Server: STT WebSocket receives audio → transcription returns text
3. Server: text passed to `OnboardingAgent.respond(...)` → LLM responds
4. Lumi speaks the next question (likely *"What does a typical weekday lunch look like for Layla?"*)
5. **DB write check** — in Supabase, query:
   ```sql
   SELECT id, role, body, created_at
   FROM thread_turns
   WHERE thread_id IN (SELECT id FROM threads WHERE household_id = '<your-household-id>')
   ORDER BY created_at DESC LIMIT 5;
   ```
   You should see your turn + Lumi's response, both persisted.

**Critical observation here:** does the agent extract data and write to the DB? Per the slice plan, `2-s22` is supposed to do this — agent tools like `child.upsert`, `cultural_template.infer`. Check:
- `SELECT * FROM children WHERE household_id = $me` — is "Layla" persisted?
- `SELECT * FROM memory_nodes WHERE household_id = $me AND source_type = 'turn'` — any rows?

**My prediction:** the conversation works but DB extractions don't happen. The agent generates conversational responses (chat with you) but doesn't call tools to persist structured data. That's exactly the gap `2-s22` fills.

If extractions DO happen unexpectedly — great surprise, mark 2-s22 as partially-already-done.

---

## Step 4 — Walk through all 3 signal questions

Q1: *who's in your family* — answer with names + ages
Q2: *typical weekday lunch* — answer with food preferences
Q3: *any food rules* — answer with allergies, dietary, cultural patterns

What should happen at end of Q3:
1. Voice orb status: "Wrapping up…"
2. Voice WS closes (1000 / normal closure)
3. `DELETE /v1/voice/sessions/:id` request in Network tab
4. `audit_log`: `voice.session_ended` row written
5. UI: `OnboardingVoice` calls `onComplete({cultural_priors_detected})` → `OnboardingPage` advances `mode` to `consent`
6. `OnboardingConsent` component renders — parental notice dialog should auto-open

**If the flow advances to consent: great**, the conversation completed cleanly. Move to step 5.

**If it doesn't advance** (orb stays in "Listening…" or "Speaking…" forever): the `onComplete` callback isn't firing. This is the most likely place for `2-s21` to need work. Capture: the last status, the last WS frame, any console errors.

---

## Step 5 — Consent step + handoff

What should happen:
1. `OnboardingConsent` renders the parental notice content (Story 2-9 dialog)
2. You scroll, ack button enables, tap → `PATCH /v1/users/me` writes ack
3. If interview mentioned a cultural identifier → flow advances to `cultural-ratification` step; tap Yes → `cultural_priors.state = 'active'`
4. Else → flow advances to `mental-model` step
5. After mental-model → `navigate('/app')`
6. Brief renders with either real plan (if generated) or "Lumi is preparing your first plan" empty state

**Verify in Supabase:**
- `users.parental_notice_acknowledged_at` populated ✓
- `users.parental_notice_acknowledged_version` populated ✓
- `children` rows present (if 2-s22 gap exists, this row count = 0)
- `cultural_priors` row if applicable
- `is_onboarded` derived correctly: should now be `true` (per 2-s19) if children rows exist

---

## What to report back

After walking the thread, paste me:

1. **Where you stopped** — completed all 5 steps? Or where did you halt?
2. **Each step's pass/fail** — a quick table:
   - Step 1 (signup → /onboarding): pass / fail (notes)
   - Step 2 (voice mode opens, Lumi speaks first Q): pass / fail
   - Step 3 (your speech transcribed + Lumi responds): pass / fail
   - Step 4 (full 3-Q conversation completes + advances to consent): pass / fail
   - Step 5 (consent → /app with populated household): pass / fail
3. **DB observations:**
   - Did `thread_turns` get rows for each Q&A? Y/N
   - Did `children` get a row from the interview? Y/N
   - Did `memory_nodes` get rows? Y/N
   - Did `cultural_priors` get a row? Y/N
4. **Console errors** — paste any red errors from browser console + API console
5. **WS frames** — if voice failed, paste the close code + reason from the Network → WS detail

I'll triage and slot each finding into the relevant slice (`2-s20` for env stuff, `2-s21` for STT/TTS roundtrip, `2-s22` for data extraction, `2-s23` for handoff). If something surprising surfaces, we add a new slice or amend an existing one.

---

## Heads up: known-likely failures

Based on inspection alone, I'd expect:

1. **Step 2 works** — voice infrastructure is solid (Story 2-6b was substantive)
2. **Step 3 works for conversation** but **DB extractions are missing** — `2-s22` is genuinely needed
3. **Step 4 may or may not auto-advance** — `OnboardingVoice.onComplete` wiring is one suspect area
4. **Step 5 consent may work** but cultural-ratification probably doesn't show even if you mention a cultural identifier (depends on whether 2-s22's `cultural_template.infer` tool is registered)

If those predictions match what you observe — confidence in the slice plan goes up. If you hit something unexpected — the slice plan adapts.

---

**Ready when you are.** Start the two dev servers and reply with where you got to.

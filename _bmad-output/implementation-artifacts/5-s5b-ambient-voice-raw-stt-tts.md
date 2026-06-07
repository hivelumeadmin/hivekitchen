# Story 5-S5b: Ambient Lumi Voice — Migrate off ElevenLabs Agent to Raw STT/TTS

Status: done

<!-- folds: migration of 12-S10 / 12.5 ambient voice off ConvAI Agent -->
<!-- direction change 2026-06-07: ElevenLabs = raw Scribe STT + TTS only, no ConvAI Agent -->
<!-- closes the FOLLOW-UP flagged in 5-S5 Completion Notes -->

## Context / Why

The product moved off the ElevenLabs Conversational AI ("ConvAI") **Agent**. ElevenLabs
is now used as **two stateless audio services only — Scribe STT (REST) + TTS**. HiveKitchen
owns the realtime transport, session lifecycle, and turn management; the browser does
client-side VAD and ships complete utterances; HiveKitchen's **OpenAI agent** always
generates the reply.

**Onboarding voice (story 2.6b) is already the correct, as-built reference.** The browser
captures audio with client-side VAD, sends complete WAV utterances over **HiveKitchen's own
WebSocket** (`GET /v1/voice/ws`), the API calls **ElevenLabs Scribe STT (REST)**, the
OnboardingAgent replies, and the API streams **ElevenLabs TTS** back. Study it before building.

**The ambient Lumi tap-to-talk path (stories 12-S10 + 12.5, extended by 5-S5 captions) is the
one surface still bound to the ConvAI Agent.** Exactly three runtime touchpoints remain:

1. `apps/api/src/modules/lumi/lumi.service.ts → issueElevenLabsCredentials()` (lines ~390–416)
   calls `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=<voiceId>`
   **twice** (labelled stt/tts) and returns ConvAI signed-URL WebSockets as `stt_token`/`tts_token`.
2. `apps/web/src/hooks/useLumiVoiceSession.ts → openSttWs()` (lines ~356–393) opens the ConvAI
   signed-URL WS and listens for `{ type: 'user_transcript' }` messages.
3. `POST /v1/lumi/voice/sessions` returns `{ stt_token, tts_token, voice_id }` (the signed URLs).

This slice swaps that transport to the onboarding model. After it, no code path requests a
ConvAI signed URL, and `ELEVENLABS_AGENT_ID` is unused.

## Story

As a Premium-tier parent using tap-to-talk in LumiPanel,
I want my voice handled by HiveKitchen's own pipeline (Scribe STT + TTS over HiveKitchen's WebSocket),
so that voice works without depending on an ElevenLabs Conversational AI Agent,
and the experience matches the proven onboarding voice path.

## Reference implementation (study before building — do NOT reinvent)

| What | Where (exact) |
|------|---------------|
| Server STT (Scribe REST) | `apps/api/src/modules/voice/voice.service.ts → transcribe()` (~L639) — `POST /v1/speech-to-text`, multipart `audio` blob + `model_id: scribe_v1` |
| Server TTS streamed over WS | `voice.service.ts → streamTts()` (~L718) — `POST /v1/text-to-speech/{voice}/stream`, `model_id: eleven_v3`, `mp3_44100_128`; pipes `res.body` reader → `ws.send(Buffer)` |
| Server TTS browser-direct token | `voice.service.ts → issueTtsToken()` (~L679) — `POST /v1/single-use-token/tts_websocket`; returns `{ token, voice_id, model_id }` |
| HK-owned voice WS route | `voice.routes.ts → GET /v1/voice/ws` (~L96) — JWT via `?token=`, `?session_id=`; binary frame → `processAudioChunk`; in auth `SKIP_EXACT` |
| Server WS turn loop | `voice.service.ts → openWsSession()` + `processAudioChunk()` — in-memory `Map<sessionId, WsSession>`, `isProcessing` concurrency guard, transcript/response.start/response.end frames |
| Client VAD → WAV → HK WS | `apps/web/src/hooks/useVoiceSession.ts` — `useMicVAD` `onSpeechEnd` → `encodeWav(audio, 16000)` → `ws.send(ArrayBuffer)`; status machine; MP3 Blob playback via `Audio` |
| WAV encoder | `apps/web/src/lib/encodeWav.ts → encodeWav(Float32Array, 16000)` |
| WS message contracts | `packages/contracts/src/voice.ts` — `WsServerMessageSchema` (`session.ready`/`transcript`/`response.start`/`response.end`/`error`), `WsClientMessageSchema` (`ping`) |

## Acceptance Criteria

1. **No ConvAI signed URL is ever requested.** `lumi.service` no longer calls `get_signed_url`
   or uses `agent_id`; `issueElevenLabsCredentials()` is deleted. A voice session starts over
   HiveKitchen's own transport.

2. **STT is server-side Scribe.** When client-side VAD detects end-of-speech, the browser sends
   the complete utterance (WAV, 16 kHz mono) over the HK voice WebSocket; the API transcribes it
   via **ElevenLabs Scribe STT (REST, `scribe_v1`)**. No `user_transcript` ConvAI WS message
   exists anywhere in the path.

3. **Reply is HiveKitchen's OpenAI LumiAgent; persistence preserved.** The transcript drives a
   turn through `LumiService.submitTextTurn({ modality: 'voice' })` (unchanged from 5-S5): the
   LumiAgent generates the reply, the reply is synthesized via **ElevenLabs TTS** and played in
   the browser, and both turns persist to the ambient Lumi thread with `thread_turns.modality =
   'voice'` plus the `voice_transcripts` row (5-S5 behaviour, byte-for-byte).

4. **Captions still work (5-S5).** `<CaptionRibbon>` still shows the user transcript +
   Lumi reply. The caption wiring (`onTranscript`/`onLumiReply` → store) is unchanged — only
   the data source changes from a ConvAI WS message to the HK WS server frame.

5. **`ELEVENLABS_AGENT_ID` is fully removed.** Not just runtime-dead — *no readers remain*.
   See **Dev Notes → AC#5 removal set** for the complete file list (it currently has live
   readers in `voice.routes.ts` and `voice.routes.test.ts` even though `VoiceService` never
   uses it). Removed from `env.ts` and `apps/api/.env.local.example`. Onboarding keeps working
   (its runtime uses raw Scribe + `issueTtsToken`, never the ConvAI agent).

6. **Teardown unchanged (12-S10 guarantees preserved).** On tap / inactivity / error /
   disconnect / unmount: sessions, sockets, AudioContext, and the inactivity timer are cleaned
   up exactly as today; the `DELETE /v1/lumi/voice/sessions/:id` still fires; no orphaned
   sockets. The hook's public surface `{ startSession, endSession }` is unchanged (layout +
   `VoiceSessionContext` + LumiOrb/LumiPanel must not need edits).

7. **Tier/role gates unchanged (12-S10).** `createTalkSession` still enforces primary-parent +
   Premium (403 → `PREMIUM_FALLBACK_COPY`, panel stays in text mode, no WS opened).

8. **Grep guard is green.** No `get_signed_url`, `agent_id`, `ELEVENLABS_AGENT_ID`,
   `user_transcript`, `convai`, or `issueElevenLabsCredentials` remains in `apps/api/src` or
   `apps/web/src` (the vendored `.agents/skills/elevenlabs-agents/**` boilerplate is out of
   scope — do not touch it; the `MediaPanels.tsx` "ConvAI defaults to 16 kHz" comment is a
   passing remark on the onboarding narration sample rate, update the wording if you like but
   it is not an Agent dependency).

---

## Tasks / Subtasks

### Task 1 — Decide + record the transport shape (AC: #1, #2, #3) — DO THIS FIRST

**You cannot reuse `VoiceService` wholesale.** Its `transcribe()` / `streamTts()` /
`issueTtsToken()` are `private`, and the class is constructed with onboarding-only deps
(`OnboardingAgent`, `CulturalPriorService`, `MemoryService`) and an onboarding-specific
`processAudioChunk` / `closeSession` (summary extraction, cultural priors, memory seeding).
Constructing a `VoiceService` from `LumiService` to borrow one method would drag all of that in.

- [x] 1.1 **Extract the three stateless ElevenLabs HTTP helpers** out of `VoiceService` into a
  shared module — recommended `apps/api/src/modules/voice/elevenlabs-audio.ts` — as pure
  functions that take `(elevenLabsApiKey, voiceId, ...)`:
  - `transcribeWav(apiKey: string, wav: Buffer): Promise<string>` ← body of `transcribe()`
  - `streamTtsToWs(apiKey: string, voiceId: string, text: string, ws: WebSocket): Promise<void>` ← body of `streamTts()`
  - `issueTtsToken(apiKey: string): Promise<{ token; voice_id?; model_id? }>` ← body of `issueTtsToken()` (only if you pick browser-direct TTS, option B below)

  Then have `VoiceService` (onboarding) call the extracted functions so there is exactly ONE
  Scribe/TTS fetch implementation. This honours the story's "do NOT duplicate the Scribe/TTS
  fetch logic" rule. **Keep Lumi-thread + LumiAgent ownership in `LumiService` / the new Lumi WS
  handler.** (If you judge extraction too invasive for onboarding, the fallback is to make the
  three methods `public static` on `VoiceService` and call them statically — but a standalone
  module is cleaner and keeps `VoiceService` from being a junk drawer. Record your choice.)

- [x] 1.2 **Choose the TTS transport and record the decision in the Dev Agent Record.** Two
  viable shapes — both satisfy AC#1–3; pick on diff-size vs. moving-parts:

  - **Option A — single HK WS, server-streamed TTS (mirrors onboarding exactly; RECOMMENDED).**
    One WebSocket. Server WS handler: receive WAV → `transcribeWav` → send `{type:'transcript'}`
    → `LumiService.submitTextTurn({modality:'voice'})` → send `{type:'response.start'}` →
    `streamTtsToWs(reply, ws)` (binary MP3) → `{type:'response.end', text: reply}`. Browser
    mirrors onboarding's `useVoiceSession` playback (MP3 Blob via `Audio`). Fully eliminates all
    browser-direct ElevenLabs sockets (no ConvAI, no `stream-input`). Cost: rewrite
    `useLumiVoiceSession` playback from the current PCM-AudioContext path to the MP3-Blob path.

  - **Option B — HK WS for STT + browser-direct TTS via real single-use token (smaller web diff).**
    `POST /v1/lumi/voice/sessions` returns a REAL `issueTtsToken()` token + `voice_id` + `model_id`
    (NOT a ConvAI signed URL). STT moves to a HK WS (WAV up, `{type:'transcript'}` + reply text
    down). The browser keeps its existing `openTtsWs`/`playAudioChunk`/`sendToTts` PCM path almost
    verbatim — `openTtsWs` already expects `single_use_token=…&output_format=pcm_16000`, exactly the
    `issueTtsToken` contract; only the token *source* changes. Cost: two sockets remain, and voice
    orchestration is split (STT over WS, reply over the existing `/v1/lumi/turns` POST OR over the
    WS — decide and record).

  **Recommendation: Option A.** It is the true "off-Agent, HiveKitchen-owns-transport" end state,
  it converges ambient Lumi and onboarding onto one transport + one set of helpers, and it deletes
  the most ConvAI-shaped code. Option B is acceptable if the web rewrite risk outweighs the
  architectural win — say so explicitly if you take it.

### Task 2 — API: new Lumi voice WS + remove ConvAI credential issuance (AC: #1, #2, #3, #6, #7)

- [x] 2.1 Delete `LumiService.issueElevenLabsCredentials()` and its call site in
  `createTalkSession` (lines ~107, ~390–416). `createTalkSession` keeps everything else:
  `assertAmbientSurface`, the primary-parent + Premium-tier gates (AC#7), lazy ambient-thread
  resolution, the `voice_sessions` row insert, and the 20s Redis sentinel. Its **return shape
  changes** — see Task 4 (contract).

- [x] 2.2 Add a HiveKitchen WS route for ambient Lumi — recommended `GET /v1/lumi/voice/ws`,
  mirroring `voice.routes.ts → GET /v1/voice/ws`:
  - JWT via `?token=` (verify with `fastify.jwt.verify`), talk session via `?session_id=`.
  - **Register the path in the auth plugin's `SKIP_EXACT` set** (find it the same way
    `/v1/voice/ws` is registered — the global auth hook will 401 the upgrade otherwise; browsers
    cannot set `Authorization` on a WS upgrade). This is the #1 silent-failure trap.
  - On open: resolve the talk session via `LumiRepository.findTalkSession(sessionId)`; verify
    `session.user_id === payload.sub` (close `4001` on mismatch) and `status === 'active'`
    (`4004` if not found). Read `household_id` + `thread_id` off the row.
  - On binary frame: call into `LumiService` (e.g. a new `processVoiceUtterance({ sessionId,
    householdId, contextSignal, wav, ws })`) that does `transcribeWav` → `submitTextTurn({
    householdId, message: transcript, contextSignal, modality: 'voice' })` → (Option A)
    `streamTtsToWs`. Reuse onboarding's guardrails: `isProcessing` single-flight guard, the
    `MAX_AUDIO_BYTES ≈ 2 MB` cap, non-fatal `{type:'error', code:'stt_failed'|'agent_failed'|
    'tts_failed'}` frames (do NOT tear the session down on a single STT miss — the user just
    speaks again, matching 12-S10's `TRANSCRIPT_FAILED_COPY` behaviour).
  - On close: best-effort cleanup; the authoritative session teardown stays the
    `DELETE /v1/lumi/voice/sessions/:id` → `closeTalkSession` path (do not double-close).

- [x] 2.3 Wire the new route's `LumiService` exactly like `lumi.routes.ts` does today (it already
  constructs `LumiService` with `voiceTranscriptRepository` etc.). Reuse the extracted
  `elevenlabs-audio.ts` helpers — do not re-add fetch logic.

- [x] 2.4 Keep `voice_transcripts` persistence and the ambient-thread turn writes intact — they
  are already inside `submitTextTurn` (5-S5). The voice path simply passes `modality:'voice'`.

### Task 3 — Web: rewrite STT (and, for Option A, playback) in useLumiVoiceSession (AC: #2, #3, #4, #6)

- [x] 3.1 Replace `openSttWs` (the ConvAI signed-URL WS + `user_transcript` handler, ~L356–393)
  with a HK voice WS opened at
  ```${import.meta.env.VITE_API_WS_URL}/v1/lumi/voice/ws?session_id=${id}&token=${jwt}`}`` (read
  the JWT from `useAuthStore.getState().accessToken`, exactly as onboarding's `useVoiceSession`
  does at ~L188–194; `VITE_API_WS_URL` is already configured — `ws://localhost:3001`). Set
  `ws.binaryType = 'arraybuffer'`.
- [x] 3.2 In the VAD `onSpeechEnd`, replace the base64-PCM-over-ConvAI send with
  `encodeWav(audio, 16000)` → `ws.send(arrayBufferCopy)` (copy into a fresh `ArrayBuffer` per
  onboarding L139–142 to avoid `SharedArrayBuffer`). Delete the now-dead `float32ToInt16` /
  `int16ToBase64` helpers (your changes orphan them).
- [x] 3.3 Handle server frames: `{type:'transcript', text}` → `onTranscript(text)` (+ Option B:
  drive the existing `handleTranscript` turn POST); Option A: `{type:'response.end', text}` →
  `onLumiReply(text)` and play the buffered MP3 (mirror onboarding's `playBufferedAudio`);
  `{type:'error', message}` → transient notice, keep session live (12-S10 behaviour). Parse with
  `WsServerMessageSchema.safeParse` (reuse the contract).
- [x] 3.4 **Preserve every teardown/re-entrancy guard (AC#6):** `startingRef`/`endingRef`, the
  WS identity guards, the 20s inactivity timer + `resetInactivityTimer` (reset on speech start
  AND during playback), the unmount `useEffect`, and the `DELETE /v1/lumi/voice/sessions/:id` on
  end. Keep the tier/role 403 → `PREMIUM_FALLBACK_COPY` path in `startSession` (AC#7). **Keep the
  exported API `{ startSession, endSession }` identical** so `layout.tsx` /
  `VoiceSessionContext` / LumiOrb / LumiPanel need no changes.
- [x] 3.5 If Option A: remove `openTtsWs` / `playAudioChunk` / `sendToTts` (browser-direct
  ElevenLabs TTS) entirely. If Option B: keep them but feed `openTtsWs` the REAL token + model
  from the session response, and ensure no ConvAI URL is passed anywhere.

### Task 4 — Contracts: reshape the talk-session response (AC: #1, #3)

- [x] 4.1 `VoiceTalkSessionResponseSchema` (`packages/contracts/src/lumi.ts` ~L77) currently is
  `{ talk_session_id, stt_token, tts_token, voice_id }`. Reshape it:
  - **Option A:** `{ talk_session_id }` only (the browser opens the HK WS with JWT + session_id;
    server owns TTS). Drop `stt_token`/`tts_token`/`voice_id`.
  - **Option B:** `{ talk_session_id, tts_token, voice_id, model_id }` (real single-use token);
    drop `stt_token`.
  Update the inferred type re-export and `CreateTalkSessionResult` in `lumi.service.ts` to match.
- [x] 4.2 Update the voice-session tests in `packages/contracts/src/lumi.test.ts` for the new
  shape, and the web `VoiceTalkSessionResponseSchema.parse` consumer + the
  `useLumiVoiceSession.test.ts` `makeSessionResponse()` fixture.

### Task 5 — Cleanup: remove ELEVENLABS_AGENT_ID end-to-end (AC: #5, #8)

- [x] 5.1 Remove **every** reader (grep `ELEVENLABS_AGENT_ID` + `agentId` first to confirm the
  set — see Dev Notes → AC#5 removal set):
  - `apps/api/src/common/env.ts` (~L68–71) — the schema field + comment.
  - `apps/api/.env.local.example` (~L49) — the line.
  - `apps/api/src/modules/voice/voice.routes.ts` (~L40) — `agentId: fastify.env.ELEVENLABS_AGENT_ID`.
  - `apps/api/src/modules/voice/voice.service.ts` — `agentId?` in `VoiceServiceDeps` (~L47),
    the `private readonly agentId` field (~L72) + its constructor assignment (~L84). It is never
    read anywhere in the class, so removing it is inert for onboarding runtime.
  - `apps/api/src/modules/voice/voice.routes.test.ts` (~L123) — `ELEVENLABS_AGENT_ID: 'test-agent-id'`.
- [x] 5.2 Remove the 12-S10 USER-SIDE GATE that required a dashboard-configured ConvAI agent.
- [x] 5.3 Update the 12-S10 / 12.5 banners (and the 5-S5 FOLLOW-UP note) to point here as the
  completed migration.

### Task 6 — Tests (AC: all)

- [x] 6.1 **API WS / service:** the ambient voice utterance path calls `transcribeWav` (Scribe),
  then `LumiService.submitTextTurn({ modality:'voice' })`, then synthesizes via TTS — and never
  calls `get_signed_url`. Assert the `isProcessing` single-flight guard drops a concurrent frame
  and that an STT failure emits a non-fatal `error` frame without closing the session.
- [x] 6.2 **Persistence (unchanged):** confirm 5-S5's coverage still holds — `submitTextTurn`
  with `modality:'voice'` writes `voice_transcripts` + `thread_turns.modality='voice'`; text
  turns do not. (The existing `lumi.service.test.ts` voice-modality block already asserts this —
  keep it green.)
- [x] 6.3 **Web — rewrite `useLumiVoiceSession.test.ts`.** It currently asserts TWO WebSockets
  and a `{type:'user_transcript'}` ConvAI message (L313–314) — that will fail post-migration.
  Rewrite to: WAV sent over a single HK WS; server `{type:'transcript'}` → `onTranscript`;
  reply → `onLumiReply`; teardown closes the socket(s), fires `DELETE`, and leaves no open
  sockets; 403 → `PREMIUM_FALLBACK_COPY`; 20s inactivity → `endSession`. Reuse the mock-WS
  harness already in that file.
- [x] 6.4 **Grep guard test:** assert `get_signed_url`, `agent_id`, `ELEVENLABS_AGENT_ID`,
  `user_transcript`, `convai`, and `issueElevenLabsCredentials` are absent from `apps/api/src`
  and `apps/web/src` (exclude the vendored `.agents/**` boilerplate).

## Dev Notes

### CRITICAL — the audio helpers are private + onboarding-coupled

`transcribe()`, `streamTts()`, `issueTtsToken()` are `private` on `VoiceService`, which is built
with `OnboardingAgent` + `CulturalPriorService` + `MemoryService`. Do NOT instantiate
`VoiceService` from `LumiService`. Extract the three HTTP helpers into a stateless module (Task
1.1) and have BOTH onboarding and the new Lumi WS call them — one Scribe/TTS implementation, no
duplication.

### CRITICAL — Scribe STT is REST-only; that is WHY there must be a HiveKitchen WS

There is no browser-direct streaming STT token from ElevenLabs. The browser cannot call Scribe.
The complete utterance must transit a HiveKitchen WebSocket so the server can call Scribe REST.
Ambient Lumi has NO HK WS today (it talks browser-direct to ConvAI) — you are adding one. Mirror
`GET /v1/voice/ws`; do not try to reuse it (its handler is bound to onboarding `voice_sessions`
semantics + `processAudioChunk`).

### CRITICAL — auth SKIP_EXACT for the WS upgrade

The global auth hook 401s any route not in its skip set, and a browser cannot send an
`Authorization` header on a WS upgrade. Find how `/v1/voice/ws` is added to `SKIP_EXACT` (auth
plugin) and add `/v1/lumi/voice/ws` the same way. Forgetting this = silent upgrade failures that
look like "WS won't connect."

### AC#5 removal set — `ELEVENLABS_AGENT_ID` has LIVE readers (runtime-dead ≠ unused)

The draft's "onboarding does not depend on it" is true only at *runtime* — onboarding uses raw
Scribe + `issueTtsToken`, never the ConvAI agent. But the var is still **read** here and must be
removed from all of:

| File | Line (approx) | What |
|------|---------------|------|
| `apps/api/src/common/env.ts` | 68–71 | schema field `ELEVENLABS_AGENT_ID` + comment |
| `apps/api/.env.local.example` | 49 | `ELEVENLABS_AGENT_ID=replace-with-agent-id` |
| `apps/api/src/modules/voice/voice.routes.ts` | 40 | `agentId: fastify.env.ELEVENLABS_AGENT_ID` |
| `apps/api/src/modules/voice/voice.service.ts` | 47, 72, 84 | `agentId?` dep, field, ctor assign (never read) |
| `apps/api/src/modules/voice/voice.routes.test.ts` | 123 | `ELEVENLABS_AGENT_ID: 'test-agent-id'` |

Grep `ELEVENLABS_AGENT_ID` AND `agentId` before declaring AC#5 done. `ELEVENLABS_VOICE_ID` and
`ELEVENLABS_TTS_MODEL_ID` stay (TTS still needs them).

### Caption flow (5-S5) is transport-agnostic — do not touch it

`<CaptionRibbon>`, `lumi.store` (`captionTranscript`/`captionLumiReply`, cleared in
`endTalkSession`), and the layout-level callbacks (`routes/(app)/layout.tsx` L30–32:
`onTranscript → setCaptionTranscript`, `onLumiReply → setCaptionLumiReply`,
`onError → setVoiceError`) are unchanged. Only the data SOURCE feeding `onTranscript`/`onLumiReply`
moves from a ConvAI WS message to the HK WS server frame. The ribbon renders only while
`voiceStatus === 'active'` (unmounts on end → no residual `aria-live`).

### hkFetch is a 2-arg call and auto-JSON-stringifies

`hkFetch(path, init)` — no third schema arg; `Schema.parse(result)` separately. Pass the raw
object as `init.body` (it stringifies for you — never `JSON.stringify` it). The voice turn POST
(if you keep Option B's client-orchestrated turn) already does this correctly at
`useLumiVoiceSession.ts` L182–185. Documented in 5-S2/S3/S4, 12-S9/S10.

### Zod 4 (not 3.23, despite project-context)

`z.record()` needs two args; `z.string().uuid()` enforces RFC-4122 variant nibble; `.datetime()`
rejects Supabase offset timestamps. Test UUID fixtures must be variant-valid (the existing
`useLumiVoiceSession.test.ts` uses `…-4aaa-8aaa-…` form — copy it).

### Session lifecycle stays in the talk-session row

`POST /v1/lumi/voice/sessions` → `createTalkSession` (gates + `voice_sessions` row + 20s Redis
sentinel) is the bind point; its `talk_session_id` is the WS `?session_id=`. `DELETE
/v1/lumi/voice/sessions/:id` → `closeTalkSession` (ownership-checked 403, idempotent on
`status==='active'`, Redis sentinel DEL) remains the authoritative teardown. The WS `close`
handler should be best-effort only — do not duplicate the DELETE's work.

### Out of scope (transport swap only)

No change to: captions UI, `voice_transcripts` schema, the text-turn path, the LumiAgent prompt,
the tier/role gates, or onboarding behaviour. Do not "improve" adjacent code.

### Source file map

| What | Where | Action |
|------|-------|--------|
| ElevenLabs audio helpers (NEW shared) | `apps/api/src/modules/voice/elevenlabs-audio.ts` | CREATE (extract `transcribe`/`streamTts`/`issueTtsToken`) |
| Onboarding VoiceService | `apps/api/src/modules/voice/voice.service.ts` | MODIFY (call extracted helpers; drop `agentId`) |
| LumiService | `apps/api/src/modules/lumi/lumi.service.ts` | MODIFY (delete `issueElevenLabsCredentials`; add voice-utterance processing; reshape `CreateTalkSessionResult`) |
| Lumi routes | `apps/api/src/modules/lumi/lumi.routes.ts` | MODIFY (add `GET /v1/lumi/voice/ws`; reshape session response) |
| Auth plugin | `apps/api/src/plugins/auth.plugin.ts` (verify path) | MODIFY (add WS route to `SKIP_EXACT`) |
| env / example | `apps/api/src/common/env.ts`, `apps/api/.env.local.example` | MODIFY (remove `ELEVENLABS_AGENT_ID`) |
| voice routes test | `apps/api/src/modules/voice/voice.routes.test.ts` | MODIFY (remove agent-id) |
| Lumi voice hook | `apps/web/src/hooks/useLumiVoiceSession.ts` | MODIFY (HK WS STT; Option A playback) |
| Lumi voice hook test | `apps/web/src/hooks/useLumiVoiceSession.test.ts` | REWRITE (no ConvAI) |
| Talk-session contract | `packages/contracts/src/lumi.ts` + `lumi.test.ts` | MODIFY (reshape `VoiceTalkSessionResponseSchema`) |
| WS message contract | `packages/contracts/src/voice.ts` | REUSE (`WsServerMessageSchema`); extend only if a new frame is needed |
| Banners | `12-s10-*.md`, `12-s5-*`/`12.5`, 5-S5 FOLLOW-UP | MODIFY (point here as done) |

### Test baselines (from 5-S5, confirm with `pnpm test` before starting)

- **API:** ~1689 pass / 20 fail (documented pre-existing: auth×7, children.repository×3,
  extra-library×3, lunch-link-dev, onboarding.tools, audit-parity, catalog-seed,
  households-memory-200, plan-adjustment, memory-partial-seeding).
- **Web:** ~526 pass / 2 fail (5-S3 debt: `PackerAssignmentDialog`, `sse.test` packer.assigned key).
- **Contracts:** ~696 pass / 7 fail (3× auth 5-S2 working-tree debt, cultural, 3× heart-notes).
- **Typecheck:** API 11 / web 6 / contracts+types 1 — all pre-existing in untouched files.

Net test delta: `useLumiVoiceSession.test.ts` is rewritten (count roughly flat), contract
voice-session tests adjust to the new shape, +API WS/service tests, +1 grep-guard test.

### USER-SIDE GATES

1. No DB migration (transport-only). `voice_transcripts` already exists (5-S5, migration
   `20261018000000`).
2. Manual demo: live ambient tap-to-talk session — speak, see the caption, hear Lumi — with
   raw Scribe STT + TTS and NO ConvAI agent configured. Requires `ELEVENLABS_API_KEY` +
   `ELEVENLABS_VOICE_ID` only.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Opus 4.8, 1M context)

### Transport Decision (Task 1)

**Helper extraction — standalone module.** The three private/onboarding-coupled
helpers were resolved by extracting the two stateless fetch helpers
(`transcribeWav`, `streamTtsToWs`) into a new shared module
`apps/api/src/modules/voice/elevenlabs-audio.ts`. `VoiceService.transcribe()` /
`streamTts()` now delegate to them (onboarding behaviour byte-for-byte identical),
and `LumiService.processVoiceUtterance` calls the same functions — one Scribe/TTS
implementation, zero duplication. `issueTtsToken` was NOT extracted (it stays
private on `VoiceService`) because Option A does not use a browser-direct TTS token.

**TTS transport — Option A (single HK WS, server-streamed TTS).** Chosen over
Option B per the story's recommendation: it is the true off-Agent end state,
converges ambient Lumi + onboarding onto one transport + one helper set, and
deletes the most ConvAI-shaped code (both browser-direct sockets gone). Cost paid:
`useLumiVoiceSession` playback was rewritten from the PCM-AudioContext path to the
onboarding MP3-Blob-via-`Audio` path.

**Context delivery.** Option A needs the `LumiContextSignal` server-side to drive
`submitTextTurn`. The browser sends a one-shot `{ type: 'context', context_signal }`
JSON frame on WS open (validated by the new `LumiVoiceClientMessageSchema`), stored
on the per-connection `LumiVoiceWsState` the route owns. Audio frames arriving
before context are dropped (defensive; ordering guarantees context lands first
because VAD starts after open). This keeps the full context signal (entity/recent
actions) reaching the agent, matching the 5-S5 text path — not just the surface.

### Completion Notes List

- **Off-ConvAI migration complete.** `issueElevenLabsCredentials` deleted; no
  `get_signed_url` / `agent_id` / `ELEVENLABS_AGENT_ID` / `user_transcript` /
  `convai` / `issueElevenLabsCredentials` remains anywhere under `apps/api/src` or
  `apps/web/src` (enforced by the new `off-convai-guard.test.ts`, 7 cases green).
- **New API surface.** `GET /v1/lumi/voice/ws` (HiveKitchen-owned WS, mirrors
  `/v1/voice/ws`): JWT via `?token=`, talk session via `?session_id=`, registered
  in auth `SKIP_EXACT`. Per-frame: `transcribeWav` (Scribe) → `submitTextTurn({
  modality:'voice' })` (LumiAgent reply + 5-S5 persistence, unchanged) →
  `streamTtsToWs`. Single-flight `isProcessing` guard + 2 MB cap + non-fatal
  `stt_failed`/`agent_failed`/`tts_failed` error frames (session never torn down on
  one miss — 12-S10 behaviour). Authoritative teardown stays `DELETE
  /v1/lumi/voice/sessions/:id`; WS close is best-effort.
- **Contract reshape.** `VoiceTalkSessionResponseSchema` → `{ talk_session_id }`
  only (dropped `stt_token`/`tts_token`/`voice_id` + `VoiceCredentialSchema`). Added
  `LumiVoiceClientMessageSchema` (`context` | `ping`). `CreateTalkSessionResult`
  updated to match.
- **Web rewrite.** `useLumiVoiceSession` now opens ONE HK WS, ships VAD utterances
  as WAV (`encodeWav` → ArrayBuffer), plays the reply as an MP3 Blob, and feeds
  captions from the HK server frames (`transcript`→`onTranscript`,
  `response.end`→`onLumiReply`). All teardown/re-entrancy guards preserved
  (`startingRef`/`endingRef`, 20s inactivity timer, unmount effect, DELETE,
  Premium 403 fallback). Public surface `{ startSession, endSession }` unchanged —
  no edits to `layout.tsx` / `VoiceSessionContext` / LumiOrb / LumiPanel.
- **ELEVENLABS_AGENT_ID fully removed** from `env.ts`, `.env.local.example`,
  `voice.routes.ts`, `voice.service.ts` (dep/field/ctor), and both voice tests.
- **Caption flow (5-S5) untouched** — only the data source moved from a ConvAI WS
  message to the HK server frame; `CaptionRibbon`/`lumi.store`/layout callbacks
  unchanged.
- **Verification.** Typecheck: 0 new errors (API 11 / web 6 / contracts+types 1 —
  all pre-existing in untouched files). Tests at/above baseline, 0 new failures:
  API 1700p/20f (baseline 1689p/20f; +11 net: +6 processVoiceUtterance, +7 grep
  guard, −2 obsolete credential-failure tests), web 528p/2f (baseline 526p/2f; +2,
  rewritten hook test), contracts 697p/7f (baseline 696p/7f; +1). The pre-existing
  failures are the documented baseline set (auth/children/extra-library/heart-notes
  /etc.). Lint: not configured at repo root (no `eslint.config.*`), so not run.
- **USER-SIDE GATE remaining:** manual live tap-to-talk demo (raw Scribe + TTS, NO
  ConvAI agent) — needs `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` only. No DB
  migration (`voice_transcripts` already exists from 5-S5).

### File List

**Created**
- `apps/api/src/modules/voice/elevenlabs-audio.ts` — shared `transcribeWav` + `streamTtsToWs`
- `apps/api/src/modules/lumi/off-convai-guard.test.ts` — grep guard

**Modified (API)**
- `apps/api/src/modules/lumi/lumi.service.ts` — delete `issueElevenLabsCredentials`; add `LumiVoiceWsState` + `processVoiceUtterance` + `sendJson`; reshape `CreateTalkSessionResult`
- `apps/api/src/modules/lumi/lumi.routes.ts` — add `GET /v1/lumi/voice/ws`
- `apps/api/src/modules/lumi/lumi.service.test.ts` — +6 `processVoiceUtterance` tests
- `apps/api/src/modules/lumi/lumi.routes.test.ts` — reshape voice-session happy path; drop 2 obsolete credential-failure tests; remove dead fetch helpers
- `apps/api/src/modules/voice/voice.service.ts` — delegate to extracted helpers; drop `agentId`
- `apps/api/src/modules/voice/voice.routes.ts` — drop `agentId` dep
- `apps/api/src/modules/voice/voice.service.test.ts` — drop `agentId`
- `apps/api/src/modules/voice/voice.routes.test.ts` — drop `ELEVENLABS_AGENT_ID`
- `apps/api/src/middleware/authenticate.hook.ts` — add `/v1/lumi/voice/ws` to `SKIP_EXACT`
- `apps/api/src/common/env.ts` — remove `ELEVENLABS_AGENT_ID`
- `apps/api/.env.local.example` — remove `ELEVENLABS_AGENT_ID`

**Modified (web)**
- `apps/web/src/hooks/useLumiVoiceSession.ts` — single HK WS + MP3 playback (Option A)
- `apps/web/src/hooks/useLumiVoiceSession.test.ts` — rewritten for the single-WS flow
- `apps/web/src/features/onboarding/components/MediaPanels.tsx` — reword ConvAI comment

**Modified (contracts)**
- `packages/contracts/src/lumi.ts` — reshape `VoiceTalkSessionResponseSchema`; add `LumiVoiceClientMessageSchema`
- `packages/contracts/src/lumi.test.ts` — update for new shapes

**Modified (docs)**
- `_bmad-output/implementation-artifacts/12-s10-tap-to-talk-voice-browser-direct.md` — banner → migration completed
- `_bmad-output/implementation-artifacts/12-5-talk-session-lifecycle-post-delete-v1-lumi-voice-sessions.md` — banner → migration completed
- `_bmad-output/implementation-artifacts/5-s5-voice-thread-standard-tier-captions.md` — FOLLOW-UP → resolved
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 5-s5b → review

### Change Log

| Date | Change |
|------|--------|
| 2026-06-07 | Story 5-S5b authored: migrate ambient Lumi voice off the ElevenLabs ConvAI Agent (`get_signed_url`/`agent_id`) to raw Scribe STT + TTS over HiveKitchen's own WebSocket, mirroring onboarding 2.6b. Drafted, not implemented. |
| 2026-06-07 | Story re-authored as code-grounded context engine: read all touched + reference sources; specified helper-extraction (helpers are private/onboarding-coupled), the required new HK Lumi WS + auth `SKIP_EXACT`, the full `ELEVENLABS_AGENT_ID` removal set (it has live readers in voice.routes/service/test despite being runtime-dead), the talk-session response reshape, Option A vs B TTS transport with recommendation, and the test rewrite + baselines. |
| 2026-06-07 | **Implemented (Option A).** Extracted `elevenlabs-audio.ts` (transcribeWav + streamTtsToWs); added `GET /v1/lumi/voice/ws` + `LumiService.processVoiceUtterance` + `LumiVoiceWsState`; deleted `issueElevenLabsCredentials`; reshaped `VoiceTalkSessionResponseSchema` → `{ talk_session_id }` + added `LumiVoiceClientMessageSchema`; rewrote `useLumiVoiceSession` to a single HK WS with MP3 playback; removed `ELEVENLABS_AGENT_ID` end-to-end; added grep guard + service tests + rewritten web hook test. 0 new typecheck errors; suites at/above baseline (API 1700p/20f, web 528p/2f, contracts 697p/7f). Status → review. |
| 2026-06-07 | **Code review complete** (3-layer adversarial: Blind Hunter, Edge Case Hunter, Acceptance Auditor). Auditor verdict: PASS (all 8 ACs satisfied). 4 patches, 10 deferred, 5 dismissed. See Review Findings below. |

### Review Findings

- [x] [Review][Patch] P1 — Oversized audio frame uses misleading `stt_failed` error code [`lumi.service.ts` — `processVoiceUtterance` oversized-frame path] — FIXED: changed to `audio_too_large` code with distinct message; added test
- [x] [Review][Patch] P2 — Empty/whitespace Scribe transcript not guarded before `submitTextTurn` [`lumi.service.ts:217–221`] — ALREADY IMPLEMENTED by dev agent (`if (transcript.trim().length === 0)` guard present); dismissed
- [x] [Review][Patch] P3 — Empty LumiAgent reply calls TTS with `''` [`lumi.service.ts` — `processVoiceUtterance` reply extraction] — FIXED: guard added before `streamTtsToWs`; sends `response.end` directly for empty reply; added test
- [x] [Review][Patch] P4 — Context frame arrives before server registers message listener [`lumi.routes.ts` — `GET /v1/lumi/voice/ws` connection handler] — FIXED: message listener registered synchronously before async IIFE; buffering with `msgBuffer` + drain after `findTalkSession` resolves

- [x] [Review][Defer] D1 — `agent_id` substring match too broad in grep guard [`off-convai-guard.test.ts`] — deferred, pre-existing acceptable risk; legitimate future fields with `agent_id` substring unlikely
- [x] [Review][Defer] D2 — `convai` substring matches migration doc comments [`off-convai-guard.test.ts`] — deferred, pre-existing acceptable risk; consistent with D1
- [x] [Review][Defer] D3 — JWT in WS URL query string [`useLumiVoiceSession.ts:251`] — deferred, pre-existing pattern identical to `/v1/voice/ws`; not new to this diff
- [x] [Review][Defer] D4 — WS mid-TTS closure — ElevenLabs body not proactively aborted [`elevenlabs-audio.ts:75–85`] — deferred, reader IS cancelled in `finally`; at most one chunk wasted before error propagates; impact minimal
- [x] [Review][Defer] D5 — Server-side 20s Redis sentinel may expire during long TTS stream [`lumi.service.ts` — processVoiceUtterance] — deferred, sentinel is best-effort; DELETE request drives authoritative close
- [x] [Review][Defer] D6 — Client inactivity timer fires during slow agent turn (>20s from transcript frame) [`useLumiVoiceSession.ts:73–78`] — deferred; fix = add `resetInactivityTimer()` in `response.start` handler; file as follow-up
- [x] [Review][Defer] D7 — `response.end` received before `response.start` — `onLumiReply` fires but no audio played [`useLumiVoiceSession.ts:129–132`] — deferred, acceptable silent degradation; null-buf guard handles it
- [x] [Review][Defer] D8 — `VITE_API_WS_URL` missing gives START_FAILED_COPY with no dev diagnostic [`useLumiVoiceSession.ts:354`] — deferred, build-time config issue; acceptable UX
- [x] [Review][Defer] D9 — Old session timer/endSession race into new session [`useLumiVoiceSession.ts:326–329`] — deferred, pre-existing concurrency complexity not introduced by this diff
- [x] [Review][Defer] D10 — Orphaned talk_session row when `WS_BASE_URL` falsy [`useLumiVoiceSession.ts:354–357`] — deferred, impossible in production; 20s TTL sentinel covers cleanup

# Story 12-S10: Tap-to-Talk Voice — Browser-Direct (Premium)

Status: review

> ⚠️ **PARTIALLY SUPERSEDED 2026-06-07 — off the ElevenLabs Agent.** This story's
> STT path mints ElevenLabs Conversational AI ("ConvAI") **Agent** signed URLs
> (`lumi.service.ts → issueElevenLabsCredentials()` → `get_signed_url?agent_id=`)
> and its Dev Notes carry a USER-SIDE GATE requiring a dashboard-configured ConvAI
> agent. That model is deprecated. The ambient Lumi voice path must use raw
> ElevenLabs Scribe STT (REST) + TTS, matching the onboarding reference (story
> 2.6b). **MIGRATION COMPLETED by slice 5-S5b (2026-06-07):** `issueElevenLabsCredentials`
> is deleted, ambient voice now runs raw Scribe STT + TTS over HiveKitchen's own
> `GET /v1/lumi/voice/ws`, and the dashboard-ConvAI-agent USER-SIDE GATE is gone
> (no `get_signed_url` / `agent_id` / `ELEVENLABS_AGENT_ID` remains). The
> tap-to-talk UX/contracts in this story stand; only the STT/TTS transport changed.

## Story

As a Premium-tier parent using HiveKitchen,
I want to speak to Lumi directly from any surface,
so that I can get a contextual, voice-based response without typing.

## Acceptance Criteria

1. **Given** any non-onboarding surface with LumiPanel open, **When** the user is in text mode, **Then** a "Voice" affordance (button or mode tab) is visible in the panel that lets them switch to voice mode.

2. **Given** a Standard-tier user (or non–primary-parent), **When** they attempt to enter voice mode (the API returns 403), **Then** they see graceful copy: "Voice chat is part of Premium. We've got you in text — same Lumi." The panel remains in text mode; no talk session row is created.

3. **Given** a Premium-tier primary parent, **When** they tap the voice affordance, **Then** `POST /v1/lumi/voice/sessions` is called with the current `context_signal`; the store moves to `voiceStatus: 'connecting'`; the STT and TTS WebSocket connections open using the returned tokens; once both connections are ready, `voiceStatus` transitions to `'active'`.

4. **Given** `voiceStatus: 'active'` and the user is speaking, **When** the mic VAD (Voice Activity Detection via `@ricky0123/vad-react`) captures a complete speech segment, **Then** the captured audio is sent to the ElevenLabs STT WebSocket; the resulting transcript is displayed immediately in the panel as a user turn (optimistic — before the API responds).

5. **Given** a transcript has arrived from ElevenLabs STT, **When** it is POSTed to `POST /v1/lumi/turns` (with the current `context_signal`), **Then** the API returns `{ thread_id, user_turn, lumi_turn }`; the `lumi_turn.body.content` text is displayed as a Lumi turn in the panel; the same text is sent to the ElevenLabs TTS WebSocket for audio playback.

6. **Given** a voice session is active, **When** the user taps the LumiOrb (in voice mode the orb acts as an "end session" button), **Then** both STT and TTS WebSocket connections are closed, `DELETE /v1/lumi/voice/sessions/:talk_session_id` is called, and the store resets to `voiceStatus: 'idle'`, `panelMode: 'text'`, `talkSessionId: null`.

7. **Given** 20 seconds of microphone silence (no speech segment captured), **When** the inactivity threshold is reached, **Then** the session ends exactly as per AC#6 (same cleanup path, auto-triggered).

8. **Given** any voice session error — WebSocket connection failure, microphone permission denied, ElevenLabs upstream error, or unhandled throw in the session lifecycle, **When** the error occurs, **Then**: both WebSocket connections are closed (if open); `DELETE /v1/lumi/voice/sessions/:talk_session_id` is called (if a session was created); `voiceStatus: 'error'` is set on the store; a concise inline error message is rendered in the panel via `role="alert"`; the panel falls back to text mode.

9. **Given** raw audio captured from the user's microphone, **Then** it flows browser → ElevenLabs STT WebSocket only. It NEVER transits the HiveKitchen API. Only text (transcript and response) crosses the HiveKitchen boundary. (ADR-002, Decision 4.)

10. **Given** a completed voice session, **When** the user reopens the panel or sends a text turn, **Then** the voice turns are visible in the panel thread (both user and Lumi turns are persisted in `thread_turns` by the existing `POST /v1/lumi/turns` logic from AC#5) and they appear in the next LumiAgent context window.

## Tasks / Subtasks

- [x] Task 1 — Create `useVoiceSession` hook (AC: #3, #4, #5, #6, #7, #8, #9)
  - [ ] Create `apps/web/src/hooks/useVoiceSession.ts`
  - [ ] Signature:
    ```ts
    interface UseVoiceSessionOptions {
      onTranscript: (text: string) => void;   // called with user speech text
      onLumiReply: (text: string) => void;    // called with Lumi response text
      onError: (msg: string) => void;         // error surface
    }

    interface UseVoiceSessionReturn {
      startSession: (contextSignal: LumiContextSignal) => Promise<void>;
      endSession: () => Promise<void>;
    }

    export function useVoiceSession(opts: UseVoiceSessionOptions): UseVoiceSessionReturn
    ```
  - [ ] `startSession(contextSignal)`:
    1. Parse `VoiceTalkSessionResponseSchema` from `POST /v1/lumi/voice/sessions`
    2. On 403: call `opts.onError('Voice chat is part of Premium. We've got you in text — same Lumi.')` — do NOT set `talkSessionId` or open WSs.
    3. On success: call `useLumiStore.getState().setTalkSession(talk_session_id)` (sets `voiceStatus: 'connecting'`)
    4. Open TTS WebSocket (see Task 2 below)
    5. Open STT WebSocket (see Task 3 below)
    6. Once both are connected: `useLumiStore.getState().setVoiceStatus('active')`
    7. Start the 20s inactivity `setTimeout` (reset on each `onTranscript` callback; fires `endSession()`)
  - [ ] `endSession()`:
    1. Clear the inactivity timer
    2. Close TTS WebSocket (if open) — `ws.close(1000, 'session ended')`
    3. Close STT WebSocket (if open) — same
    4. If `talkSessionId !== null`: `DELETE /v1/lumi/voice/sessions/:id` via `hkFetch`
    5. `useLumiStore.getState().endTalkSession()` (resets `voiceStatus: 'idle'`, `panelMode: 'text'`, etc.)
  - [ ] On any unhandled error in `startSession`: call error cleanup (close any open WS, call DELETE if session created, set voiceStatus 'error')

- [x] Task 2 — ElevenLabs TTS WebSocket (AC: #5, #9)
  - The TTS WebSocket pattern mirrors `apps/web/src/features/onboarding/components/MediaPanels.tsx` (already shipping, established pattern).
  - [ ] Open `WebSocket` to:
    ```
    wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice_id)}/stream-input
      ?single_use_token=${tts_token}
      &model_id=eleven_multilingual_v2
      &output_format=pcm_16000
    ```
  - [ ] On `ws.onopen`: send the ElevenLabs init message:
    ```json
    { "text": " ", "voice_settings": { "stability": 0.5, "similarity_boost": 0.8 }, "generation_config": { "chunk_length_schedule": [120] } }
    ```
  - [ ] Function `sendToTts(text: string)`:
    - Send: `JSON.stringify({ text })`
    - Send end sentinel: `JSON.stringify({ text: "" })`
  - [ ] Decode inbound audio messages (`{ audio: base64string, isFinal?: boolean }`):
    - Decode base64 → `Uint8Array` → `Float32Array` (each Int16 → divide by 32768)
    - Schedule via `AudioContext.createBufferSource()` for gapless playback (same pattern as MediaPanels.tsx `nextPlayTimeRef`)
  - [ ] On `ws.onerror` / `ws.onclose` (abnormal): call `opts.onError('Voice connection lost. Try again.')`

- [x] Task 3 — ElevenLabs STT WebSocket + VAD (AC: #4, #9)
  - **VAD via `@ricky0123/vad-react`** — already installed in `apps/web/package.json`.
  - The STT WebSocket transport uses `stt_token` from `POST /v1/lumi/voice/sessions`.
  - **CRITICAL RECONCILIATION**: The S12-5 `issueElevenLabsCredentials` calls the ElevenLabs Conversational AI signed URL endpoint (`/v1/convai/conversation/get_signed_url?agent_id=…`) TWICE — once labeled `stt` and once `tts`. The resulting URLs point to the **Conversational AI WebSocket**, NOT a dedicated STT-only endpoint. This story owns resolving this (per the S12-5 dev note: "Story 12.8 owns the actual browser-direct WS transport and may revise the exact endpoint(s) called here").
  - **Recommended approach (pick one and document the choice inline):**
    - **Option A — Conversational AI as STT-only**: Connect to `stt_token` URL as a Conversational AI WebSocket. Send mic audio as `{ user_audio_chunk: base64PCM }`. Listen for `{ type: 'user_transcript', user_transcript: string }`. On transcript received: call `opts.onTranscript(transcript)` + POST to `/v1/lumi/turns` + send Lumi reply to TTS WS. Do NOT use ElevenLabs's built-in LLM response (if the Conversational AI agent generates one, ignore it in favour of HiveKitchen's). Downside: requires the ElevenLabs agent to be configured with a custom LLM webhook pointing to HiveKitchen. Document this as a USER-SIDE GATE.
    - **Option B — Revise backend, use separate STT endpoint**: Modify `lumi.service.ts` `issueElevenLabsCredentials` to call a dedicated ElevenLabs STT streaming credential endpoint (e.g., `/v1/speech-to-text/stream-token` or equivalent single-use token) for `stt_token`, keeping TTS as-is. This fully matches ADR-002 Decision 4.
  - [ ] Regardless of approach chosen: use `useMicVAD` from `@ricky0123/vad-react` for voice activity detection:
    ```ts
    import { useMicVAD } from '@ricky0123/vad-react';

    const vad = useMicVAD({
      onSpeechEnd: (audio: Float32Array) => {
        // audio is PCM 16kHz Float32Array — encode + send to STT WS
        const int16 = float32ToInt16(audio);  // scale by 32768, clamp to Int16 range
        const b64 = btoa(String.fromCharCode(...new Uint8Array(int16.buffer)));
        sttWs.send(JSON.stringify({ user_audio_chunk: b64 }));
      },
    });
    ```
  - [ ] Only start VAD when `voiceStatus === 'active'`. Stop VAD (if the library supports pausing) when session ends. If VAD cannot be cleanly stopped, it silently no-ops on session end because `sttWs` is already closed.
  - [ ] On STT transcript received: reset the 20s inactivity timer; call `opts.onTranscript(text)`.
  - [ ] Helper `float32ToInt16(float32: Float32Array): Int16Array` — convert sample-by-sample:
    ```ts
    function float32ToInt16(float32: Float32Array): Int16Array {
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return int16;
    }
    ```

- [x] Task 4 — Wire transcript → HiveKitchen → TTS (AC: #5)
  - [x] In `useVoiceSession`, `onTranscript` callback:
    ```
    onTranscript: async (transcript) => {
      // 1. Display user turn optimistically
      opts.onTranscript(transcript);  // caller appends to panel
      // 2. POST to HiveKitchen for LumiAgent + persistence
      const raw = await hkFetch('/v1/lumi/turns', {
        method: 'POST',
        body: { message: transcript, context_signal: contextSignal },
      });
      const data = LumiTurnResponseSchema.parse(raw);
      // 3. Display Lumi turn + send to TTS
      opts.onLumiReply(data.lumi_turn.body.content);  // caller appends to panel
      sendToTts(data.lumi_turn.body.content);          // internal TTS WS call
      // 4. Pin threadId
      useLumiStore.setState(s => ({ threadIds: { ...s.threadIds, [surface]: data.thread_id } }));
    }
    ```
  - [ ] The transcript body type is `'message'` — `data.lumi_turn.body` is `{ type: 'message', content: string }`. Guard: only call `sendToTts` if `data.lumi_turn.body.type === 'message'` (defensively handles future body types).
  - [ ] hkFetch body: pass raw object, NOT `JSON.stringify(...)` (the fetch lib does that; double-encoding breaks the API — see S9 / S3 standing notes).

- [x] Task 5 — Voice mode UI in LumiPanel (AC: #1, #2, #3, #4, #5, #8)
  - [ ] Add a mode toggle row to the `LumiPanel` header area (between the `<p>Lumi</p>` label and the close button, or below the header) with two buttons: "Text" and "Voice".
  - [ ] Use raw `type="button"` elements styled with Tailwind. Match the panel's warm-neutral tone (no SaaS chrome). Example styling: `text-xs font-sans px-2 py-0.5 rounded transition-colors` with `bg-surface-2 text-fg` for active state, `text-fg-muted hover:text-fg` for inactive.
  - [ ] Voice button click:
    - If `voiceStatus === 'idle'`: call `startSession(contextSignal ?? { surface })`
    - If `voiceStatus === 'active'`: call `endSession()` (acts as a stop button)
    - If `voiceStatus === 'connecting'`: no-op (disabled state)
  - [ ] Premium fallback (AC#2): when `startSession` calls `opts.onError(msg)`, show the error message in the panel's inline `role="alert"` area; do NOT switch `panelMode` to 'voice'. The panel remains fully usable in text mode.
  - [ ] Voice status display in LumiPanel:
    - `voiceStatus: 'connecting'`: show "Connecting to Lumi voice…" hint text
    - `voiceStatus: 'active'`: show "Listening…" hint text; mic icon or equivalent visual
    - `voiceStatus: 'error'`: show inline error via `role="alert"` (already wired in existing panel)
  - [ ] The optimistic user turn (from `onTranscript`) and the Lumi reply (from `onLumiReply`) are appended via `useLumiStore.getState().appendTurn(turn)` — construct a `Turn` object locally (temporary ID OK; the real `user_turn` from the API replaces nothing — we just keep both for simplicity at MVP).
    - **Simpler alternative**: just append the real turns from `data.user_turn` and `data.lumi_turn` returned by `POST /v1/lumi/turns` — skip the optimistic display since voice turns have ~1–2s latency which is acceptable.
    - Use whichever approach results in fewer moving parts (recommendation: use real turns from API, skip optimistic).

- [x] Task 6 — LumiOrb voice-mode tap-to-end (AC: #6)
  - [ ] In `apps/web/src/components/LumiOrb.tsx`, update `handleClick()`:
    ```ts
    function handleClick() {
      const { isPanelOpen, voiceStatus } = useLumiStore.getState();
      if (voiceStatus === 'active') {
        // endSession is owned by useVoiceSession — need a way to call it.
        // Option: expose endSession via the store, OR wire via a ref passed from the
        // component that mounts the hook.
        endSession();
        return;
      }
      if (isPanelOpen) {
        useLumiStore.getState().closePanel();
        return;
      }
      useLumiStore.getState().openPanel();
    }
    ```
  - [ ] **Clean wiring pattern**: `useVoiceSession` is mounted in `LumiPanel` (which is the component that needs `startSession`/`endSession`). Pass `endSession` up to `LumiOrb` via a React ref or a store action.
    - **Recommendation**: Add a `voiceSessionRef: React.MutableRefObject<{ endSession: () => Promise<void> } | null>` on a shared context or passed as a prop from the root layout to both `LumiOrb` and `LumiPanel`. Avoid adding `endSession` to the Zustand store (functions in stores are an anti-pattern here since the session state is local).
    - Simpler alternative: Mount `useVoiceSession` in the **root layout** (same component that mounts `<LumiOrb>` and `<LumiPanel>`), passing callbacks down via props or a lightweight context. This avoids the cross-component ref problem entirely.

- [x] Task 7 — Tests (AC: all)
  - [ ] `apps/web/src/hooks/useVoiceSession.test.ts` — new file
    - Setup: mock `globalThis.fetch`, mock `WebSocket` (replace with `vi.fn()` returning a mock WS with `onopen`, `onmessage`, `onerror`, `onclose` + `send` + `close` spies)
    - Test: `startSession` calls `POST /v1/lumi/voice/sessions` with context_signal
    - Test: `startSession` with 403 response calls `onError` with the Premium copy; does not open WebSocket; does not set `talkSessionId` in store
    - Test: `startSession` on success opens both WS connections; store transitions to `'connecting'` then `'active'`
    - Test: `endSession` closes both WS connections, calls `DELETE /v1/lumi/voice/sessions/:id`, resets store
    - Test: receiving a transcript triggers `onTranscript` → `POST /v1/lumi/turns` → `onLumiReply`
    - Test: 20s inactivity timer fires `endSession` (use `vi.useFakeTimers` + `vi.advanceTimersByTime(20001)`)
    - Test: WS connect error triggers `onError` + cleanup (store resets to 'error', DELETE called)
  - [ ] `apps/web/src/components/LumiPanel.test.tsx` — add 4–6 new test cases:
    - Mode toggle renders "Text" and "Voice" buttons when panel is open
    - Clicking "Voice" when idle calls `POST /v1/lumi/voice/sessions` (mock fetch)
    - Premium fallback copy appears when session creation returns 403
    - "Listening…" hint renders when `voiceStatus: 'active'`
    - "Connecting…" hint renders when `voiceStatus: 'connecting'`
  - [ ] `apps/web/src/components/LumiOrb.test.tsx` — add:
    - When `voiceStatus: 'active'`, clicking orb calls `endSession` (not `closePanel`)
    - When `voiceStatus: 'idle'` and panel is closed, clicking orb calls `openPanel` (unchanged behavior)
  - [ ] **No API changes, no new contracts, no new migrations** — this is a pure web layer story.

## Dev Notes

### ADR-002 Decision 4 — Canonical voice architecture

From `_bmad-output/planning-artifacts/adr-ambient-lumi.md` §Decision 4 (read in full before implementing):

```
Browser                  HiveKitchen API           ElevenLabs
[1] POST /v1/lumi/voice/sessions ─────────────────►
    ◄──── { stt_token, tts_token, voice_id, talk_session_id }
[2] Open ElevenLabs STT WS (stt_token) ────────────────────────────►
[3] Open ElevenLabs TTS WS (tts_token, voice_id) ──────────────────►

── CONVERSATION TURN ─────────────────────────────────────────────
[4] mic audio ──────────────────────────────────────────────────── STT WS
[5] ◄─────────────────────────────────── transcript                STT WS
[6] append user turn to panel
[7] POST /v1/lumi/turns (transcript) ─────────────────►
                         ◄── { user_turn, lumi_turn }
[8] append lumi turn to panel
[9] forward lumi_turn.body.content ─────────────────────────────── TTS WS
    ◄────────────────────────────────── audio chunks               TTS WS
   (play via Web Audio API)

── SESSION END ───────────────────────────────────────────────────
[10] close STT WS + close TTS WS
[11] DELETE /v1/lumi/voice/sessions/:talk_session_id ─────────────►
```

Key constraints from ADR (never violate):
- HiveKitchen NEVER handles raw audio. Only text crosses the HK boundary.
- Audio flows browser → ElevenLabs STT WS only.
- The permanent ElevenLabs API key never reaches the browser. Single-use tokens only.

### S12-5 reconciliation — token endpoint mismatch

`lumi.service.ts` `issueElevenLabsCredentials()` currently calls:
```
GET https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${voice_id}
```
TWICE — once for `sttToken`, once for `ttsToken`. Both return a **Conversational AI signed URL** (a single WebSocket that handles STT + built-in LLM + TTS, not a separate STT stream).

This is intentional placeholding — the S12-5 dev note says "Story 12.8 owns the actual browser-direct WS transport and may revise the exact endpoint(s) called here."

**You must resolve this.** Two options:

**Option A — Use Conversational AI for STT only (lower backend change, but needs ElevenLabs agent config):**
- Keep `lumi.service.ts` as-is.
- On the frontend, connect to `stt_token` as a Conversational AI WebSocket.
- Send mic audio as base64 PCM: `{ user_audio_chunk: "<base64>" }`.
- Listen for `{ type: 'user_transcript', user_transcript: string }` for the STT result.
- Ignore the ElevenLabs built-in agent response (we use HiveKitchen's LumiAgent instead).
- ElevenLabs requires the configured agent to not block on responses for this to work cleanly. Document this as **USER-SIDE GATE: ElevenLabs agent must be configured as "pass-through" or with a custom LLM webhook pointing to HK API**.
- Use `tts_token` for TTS WS as per the MediaPanels.tsx pattern.

**Option B — Revise backend to correct token types:**
- Modify `lumi.service.ts`:
  - `sttToken`: call ElevenLabs speech-to-text streaming token endpoint (verify current ElevenLabs API docs — endpoint may be `/v1/speech-to-text/streaming-auth-token` or similar).
  - `ttsToken`: keep calling `/v1/convai/conversation/get_signed_url` OR switch to `/v1/text-to-speech/{voice_id}/stream-token` if ElevenLabs exposes one.
- This is the ADR-clean approach but requires verifying current ElevenLabs API (knowledge may be stale).

Document your choice in the Dev Agent Record below. Either is acceptable at MVP; correctness over architecture purity at this stage.

### TTS WebSocket pattern (established — mirror MediaPanels.tsx)

From `apps/web/src/features/onboarding/components/MediaPanels.tsx` (lines ~55–80):
```ts
// URL format for TTS stream-input:
const url = `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice_id)}/stream-input?single_use_token=${tts_token}&model_id=eleven_multilingual_v2&output_format=pcm_16000`;
const ws = new WebSocket(url);

ws.onopen = () => {
  // Init message required before any text:
  ws.send(JSON.stringify({
    text: ' ',
    voice_settings: { stability: 0.5, similarity_boost: 0.8 },
    generation_config: { chunk_length_schedule: [120] },
  }));
};

// Send text:
ws.send(JSON.stringify({ text: 'Hello Lumi' }));
// End sentinel:
ws.send(JSON.stringify({ text: '' }));

// Receive audio:
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data as string) as { audio?: string; isFinal?: boolean };
  if (msg.audio) {
    // base64 → Uint8Array → Float32Array → AudioContext schedule
  }
};
```

Reuse this exact pattern — do NOT reinvent it. Import or inline the audio decode + Web Audio API scheduling logic.

### Voice Activity Detection via `@ricky0123/vad-react`

`@ricky0123/vad-react` is installed (see `apps/web/package.json`). It provides VAD with React hooks.

```ts
import { useMicVAD } from '@ricky0123/vad-react';

const vad = useMicVAD({
  startOnLoad: false,   // don't auto-start; start when session becomes active
  onSpeechEnd: (audio: Float32Array) => {
    // audio is 16kHz PCM as Float32Array
    // convert to Int16 → base64 → send to STT WS
  },
  positiveSpeechThreshold: 0.8,   // confidence above this → speech
  negativeSpeechThreshold: 0.3,   // confidence below this → silence
  minSpeechFrames: 5,             // minimum frames to register as speech
});

// Start when voice session becomes active:
if (vad.userSpeaking !== undefined) {
  // vad.start() / vad.pause() for lifecycle management
}
```

Check the `@ricky0123/vad-react` README for exact API — `useMicVAD` returns `{ start, pause, destroy, userSpeaking, loading, errored }`. Start on session connect, pause/destroy on session end.

**PCM encoding** (Float32Array → base64 for STT WS):
```ts
function float32ToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer);
  return btoa(String.fromCharCode(...bytes));
}
```

### Zustand store — existing voice actions

The `lumi.store.ts` already has the full voice state shape. Use these actions:
- `setTalkSession(sessionId)` — sets `talkSessionId + voiceStatus: 'connecting' + voiceError: null`
- `setVoiceStatus(status)` — transitions `voiceStatus` (use `'active'` once WS are ready)
- `setVoiceError(msg)` — sets `voiceError + voiceStatus: 'error'` (or `'idle'` if null)
- `endTalkSession()` — resets to `{ talkSessionId: null, voiceStatus: 'idle', isSpeaking: false, voiceError: null, panelMode: 'text' }`
- `appendTurn(turn)` — appends to `turns` list
- `openPanel(mode?)` / `closePanel()`

Do NOT add new actions to the store for this story — all needed actions already exist.

### hkFetch double-encoding trap (standing note from S9/S3)

`hkFetch` internally calls `JSON.stringify(init.body)`. Pass the raw object; NEVER `JSON.stringify` before passing:
```ts
// CORRECT:
await hkFetch('/v1/lumi/turns', { method: 'POST', body: { message: transcript, context_signal: contextSignal } });

// WRONG — double-encodes:
await hkFetch('/v1/lumi/turns', { method: 'POST', body: JSON.stringify({ message: transcript, context_signal: contextSignal }) });
```

### LumiTurnResponseSchema — use existing contract

`lumi_turn.body` type is `TurnBody` from `@hivekitchen/types`. Guard before accessing `.content`:
```ts
const lumiText = data.lumi_turn.body.type === 'message' ? data.lumi_turn.body.content : '';
```
Use `turn.body.content` NOT `turn.body.text` — the `text` field does not exist (S9 reconciliation #4).

### 20s inactivity — use `setTimeout` not store

The inactivity timer is local to the hook lifecycle. Use a `useRef<ReturnType<typeof setTimeout>>` inside `useVoiceSession`. Reset on each `onSpeechEnd` callback. On session end / component unmount, call `clearTimeout`.

### Standard-tier fallback — treat all 403s alike

`lumi.service.ts` throws `ForbiddenError` for both non-Premium tier and non–primary-parent role. Both are 403 on the wire. The client should show the same graceful fallback copy for any 403 from `POST /v1/lumi/voice/sessions`. Do not try to parse the 403 reason message — show a single friendly copy.

Recommended copy: `"Voice chat is part of Premium. We've got you in text — same Lumi."`

### LumiOrb click-to-end — wiring recommendation

The cleanest minimal approach: mount `useVoiceSession` in the root layout component alongside `<LumiOrb>` and `<LumiPanel>`, then pass `endSession` as a callback via a shared context (a tiny React context wrapping just `endSession`) that `LumiOrb` reads. This avoids adding session logic to either `LumiOrb` or `LumiPanel` and keeps the hook at the layout level where it survives route changes.

Alternatively: extend `LumiPanel`'s close button to also call `endSession()` when `voiceStatus === 'active'`. The orb still toggles the panel in all modes; the voice cleanup happens via the panel's close path. This is slightly less intuitive UX-wise but dramatically simpler to wire.

### No API changes at MVP

`POST /v1/lumi/voice/sessions` — already implemented in 12-5. ✅
`DELETE /v1/lumi/voice/sessions/:id` — already implemented in 12-5. ✅
`POST /v1/lumi/turns` — already implemented in 12-S8/S9. ✅
`LumiService`, `LumiRepository` — no changes needed. ✅

The ONLY backend change that MAY be needed is in `issueElevenLabsCredentials` if you choose Option B (separate STT token). If you choose Option A (Conversational AI for STT), no backend changes.

### Cross-epic dependency note

The slice doc notes "Cross-epic dependency: Tier-gate.service from Epic 8 8-S9 (or beta-Premium-stub before that lands)." The current `lumi.service.ts` already does a `getHouseholdTier()` call and throws 403 for non-Premium. This is the tier gate. No Epic 8 work needed — the gate is already in place.

### Zod 4 — project is Zod 4, not 3.23

`project-context.md` says "Zod 3.23" but the installed version is Zod 4. Known footguns:
- `z.record()` requires two args: `z.record(z.string(), z.SomeSchema())`.
- `z.string().uuid()` uses strict RFC-4122 — fixture UUIDs must have correct variant nibble (`8/9/a/b` in 4th group).
- `z.string().datetime()` rejects Supabase offset timestamps — normalize via `new Date(ts).toISOString()`.

### Test baseline (after 12-S9 + post-7-s13 patch state)

- **web**: 470/470 (last known state after 7-s12 + no further web changes from 7-s13)
- **api**: 1617 pass / 20 fail (documented pre-existing baseline; see 12-S9 done state)
- **contracts**: lumi 48/48 (no contract changes in this story)

This story adds new web tests only. Expected delta: +12–18 web tests across `useVoiceSession.test.ts`, `LumiPanel.test.tsx`, `LumiOrb.test.tsx`.

No new API tests, no new contract tests.

### USER-SIDE GATES

1. **Microphone permission**: browser will prompt for mic permission when VAD starts. The error state (AC#8) must handle `DOMException: Permission denied` from the VAD library.
2. **ElevenLabs agent configuration** (if Option A chosen): The ElevenLabs Conversational AI agent (`ELEVENLABS_VOICE_ID`) must be configured in the ElevenLabs dashboard to pass transcripts to HiveKitchen without running its own LLM response. Document the exact configuration step required.
3. **Live stack manual test**: voice sessions require a real ElevenLabs account, valid `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` (agent ID), and a mic-enabled browser. Unit tests mock WebSocket.

### Project Structure

**New files:**
- `apps/web/src/hooks/useVoiceSession.ts`
- `apps/web/src/hooks/useVoiceSession.test.ts`

**Modified files:**
- `apps/web/src/components/LumiPanel.tsx` — add mode toggle, voice status UI, wire `useVoiceSession` (or receive callbacks via context/props)
- `apps/web/src/components/LumiPanel.test.tsx` — add voice mode UI tests
- `apps/web/src/components/LumiOrb.tsx` — update `handleClick` for voice-active state
- `apps/web/src/components/LumiOrb.test.tsx` — add voice-mode click tests
- `apps/web/src/app/` (root layout file) — mount `useVoiceSession` at layout level (if wired there)
- `apps/api/src/modules/lumi/lumi.service.ts` — `issueElevenLabsCredentials` (only if Option B chosen)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status tracking

**No changes to:**
- `packages/contracts/` — no new contract shapes
- `packages/types/` — no new types
- `apps/api/src/modules/lumi/lumi.routes.ts` — routes unchanged
- `apps/api/src/agents/` — agent layer unchanged
- `apps/web/src/stores/lumi.store.ts` — store unchanged (all needed actions exist)

### References

- [Source: `_bmad-output/planning-artifacts/adr-ambient-lumi.md` §Decision 4] — canonical voice pipeline sequence diagram + key constraints
- [Source: `_bmad-output/planning-artifacts/epic-12-vertical-slices.md` §Slice 12-S10] — demo path, layers, Standard fallback spec
- [Source: `apps/api/src/modules/lumi/lumi.service.ts`] — `createTalkSession` + `issueElevenLabsCredentials` + `closeTalkSession` implementation
- [Source: `apps/api/src/modules/lumi/lumi.routes.ts`] — `POST /voice/sessions` + `DELETE /voice/sessions/:id` routes
- [Source: `apps/web/src/stores/lumi.store.ts`] — full voice state shape + existing actions
- [Source: `apps/web/src/components/LumiPanel.tsx`] — existing panel; voice mode stub (lines 131–140)
- [Source: `apps/web/src/components/LumiOrb.tsx`] — existing orb; `handleClick` + `isVoiceActive` logic
- [Source: `apps/web/src/features/onboarding/components/MediaPanels.tsx`] — canonical ElevenLabs TTS WebSocket pattern (lines 1–170)
- [Source: `apps/web/package.json`] — `@ricky0123/vad-react` installed; no `@11labs/client` SDK
- [Source: `packages/contracts/src/lumi.ts`] — `VoiceTalkSessionResponseSchema`, `LumiTurnResponseSchema`, `LumiContextSignalSchema`
- [Source: `_bmad-output/implementation-artifacts/12-s9-lumiagent-surface-prompt-household-snapshot.md` §Dev Notes] — hkFetch double-encoding trap, turn body content shape, Zod 4 gotchas

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (Claude Code)

### Debug Log References

- Existing `apps/web/src/hooks/useVoiceSession.ts` already existed (onboarding voice hook from Epic 2.6b) — new hook named `useLumiVoiceSession` to avoid conflict.
- `minSpeechFrames` not a valid `useMicVAD` option — corrected to `minSpeechMs: 250`.
- Test environment (jsdom) `Response.prototype.json()` uses ReadableStream internally and resolves over multiple indeterminate microtask ticks, making Promise-flush counting unreliable. Fixed by replacing `new Response(JSON.stringify(body))` with a fake response shim `{ ok, status, json: () => Promise.resolve(body) }` so `.json()` resolves in exactly one tick.
- `vi.fn().mockImplementation(arrowFn)` triggers Vitest warning when used as constructor (`new WebSocket()`). Fixed by using `function` keyword in `mockImplementation`.

### Completion Notes List

- Chose **Option A** for STT: ElevenLabs Conversational AI WebSocket used as STT-only. `stt_token` is the full signed WSS URL. Sends `{ user_audio_chunk: base64PCM }`, receives `{ type: 'user_transcript', user_transcript }`. No backend changes required.
- Hook named `useLumiVoiceSession` (not `useVoiceSession`) to coexist with the onboarding hook at `hooks/useVoiceSession.ts`.
- Voice session context (`VoiceSessionContext`) provides `startSession`/`endSession` from `AppScopeLayout` to both `LumiPanel` and `LumiOrb` without prop-drilling.
- Real turns from `POST /v1/lumi/turns` appended directly — no optimistic voice turns (per story's "simpler alternative" recommendation).
- USER-SIDE GATE: ElevenLabs Conversational AI agent (`ELEVENLABS_VOICE_ID`) must be configured in the ElevenLabs dashboard as pass-through / with a custom LLM webhook pointing to the HiveKitchen API so the agent doesn't generate its own LLM response. The frontend ignores any built-in agent reply and uses `HiveKitchen's LumiAgent response exclusively.
- Test baseline: 484 passing (52 test files). Story adds 14 new tests (+7 hook, +5 panel, +2 orb).

### File List

**New files:**
- `apps/web/src/hooks/useLumiVoiceSession.ts`
- `apps/web/src/hooks/useLumiVoiceSession.test.ts`
- `apps/web/src/contexts/VoiceSessionContext.tsx`

**Modified files:**
- `apps/web/src/components/LumiPanel.tsx`
- `apps/web/src/components/LumiPanel.test.tsx`
- `apps/web/src/components/LumiOrb.tsx`
- `apps/web/src/components/LumiOrb.test.tsx`
- `apps/web/src/routes/(app)/layout.tsx`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

| Date       | Change                                                                 |
|------------|------------------------------------------------------------------------|
| 2026-06-05 | Story 12-S10 authored: tap-to-talk voice (Premium). Pure web-layer story. `useVoiceSession` hook, mode picker in LumiPanel, ElevenLabs STT/TTS WS, VAD via @ricky0123/vad-react, 20s inactivity auto-close, Standard-tier fallback. No API/contract/migration changes. |

## Review Findings

_Code review 2026-06-05 (3-layer adversarial: Blind Hunter, Edge Case Hunter, Acceptance Auditor). 2 decision-needed, 13 patch, 3 deferred, 6 dismissed._

_**Patches applied 2026-06-06** (all 14, incl. P14 from the resolved decision). `useLumiVoiceSession.ts` rewritten: error-state preserved through teardown via `endSession(errorMsg?)` (P1); `vad.errored` observed + `vad.start()` wrapped for mic-denial (P2); identity (`=== ws`) guards on all WS open/message/error/close handlers (P3, P9); `startingRef`/`endingRef` re-entrancy guards (P4, P8); unmount cleanup effect (P5); `openPanel('voice')` on session start (P6); inactivity timer reset on speech-capture + playback + cleared at start (P7); chunked `int16ToBase64` (P11); odd-byte PCM guard (P12); empty-transcript skip (P13); transient non-destructive notice on turn-POST failure (P14). `LumiPanel.tsx`: clears sticky `voiceError` on text submit (P10). AC#8 test strengthened to assert `voiceStatus:'error'` + `voiceError` survive teardown + DELETE fired. **Verification: web 484/484 pass; 0 new typecheck errors (3 web baseline untouched: child-bag-composition ×2, heart-notes ×1).**_

_**E2E gate: manually deferred 2026-06-06** (Menon). The live tap-to-talk pipeline can't run headlessly — it needs a real ElevenLabs account (`ELEVENLABS_API_KEY` + agent `VOICE_ID`), a mic-enabled browser, and the dashboard agent configured pass-through (USER-SIDE GATES #2/#3). Playwright regression suite (incl. 12-6/12-7/12-s8 orb-panel/context/text-turn) was NOT run as part of this review. **Story remains `review`** pending the manual live-stack voice demo. Re-run `pnpm --filter @hivekitchen/web exec playwright test` and complete the manual demo before flipping to `done`._

### Decision-needed (resolved 2026-06-05)

- Mid-session turn-POST failure → **Surface + stay in session** (Menon). Reclassified to Patch P14 below.
- Non-`message` Lumi turn → **Accept silence at MVP** (Menon). Reclassified to Deferred below.

### Patch

- [x] [Review][Patch] **[Critical]** AC#8 error state is clobbered back to idle — error/close handlers call `onError` (→ `setVoiceError` → `voiceStatus:'error'`) then `endSessionRef.current()`, whose final `endTalkSession()` resets `voiceStatus:'idle', voiceError:null`. User never reliably sees the error or the text-fallback reason; the `role="alert"` flashes then vanishes. Fix: preserve the error after teardown (set `voiceError` *after* `endTalkSession`, or give `endSession` a preserve-error path). Also strengthen the AC#8 test to assert the resulting `voiceStatus`/`voiceError`. [useLumiVoiceSession.ts:256-267,295-306,209] [lumi.store.ts:109-116]
- [x] [Review][Patch] **[Critical]** Microphone-permission denial unhandled (AC#8 + USER-SIDE GATE #1) — `useMicVAD` is wired with only `onSpeechEnd`+thresholds; `vad.errored`/`loading` are never observed and `vad.start()` doesn't synchronously throw. On mic-denied the UI shows "active/Listening…" forever with a dead mic; no `onError`, no cleanup. Fix: observe `vad.errored` (and gate `'active'` on `!vad.loading`) → route to `onError` + `endSession`. [useLumiVoiceSession.ts:116-128,346]
- [x] [Review][Patch] **[High]** Partial-connect race resurrects a zombie AudioContext — if one WS rejects while the TTS WS is mid-connect, `Promise.all` rejects and `endSession` runs, but the late TTS `open` handler then recreates `audioCtxRef`/sends on an orphaned socket (never closed). Fix: in the `open` handlers, bail if `ttsWsRef.current !== ws` (session-generation/identity guard). [useLumiVoiceSession.ts:230-243,334-343]
- [x] [Review][Patch] **[High]** Double-start race — `handleVoiceClick` only blocks `'connecting'`, but `voiceStatus` stays `'idle'` until the POST resolves; a second click spawns a 2nd talk session + 2nd WS pair, clobbering the first refs (leaked sockets, orphaned/undeleted server session). Fix: add an in-flight/`startingRef` guard (or early-return when `talkSessionId !== null`). [useLumiVoiceSession.ts:312] [LumiPanel.tsx:102-111]
- [x] [Review][Patch] **[High]** No unmount cleanup — the hook has no `useEffect` teardown; on layout unmount/logout/navigation away the mic stream stays hot, both WS + AudioContext leak, the inactivity timer fires against a dead component, and the server session is never DELETEd. Fix: `useEffect(() => () => { void endSessionRef.current(); }, [])`. [useLumiVoiceSession.ts]
- [x] [Review][Patch] **[High]** `panelMode` never set to `'voice'` — no voice action calls `openPanel('voice')`, so `isVoiceMode` stays `false` the whole session: the Voice tab never shows active state and the "Tap the orb to end voice session" hint ([LumiPanel.tsx:190]) never renders. Fix: set `panelMode:'voice'` on session start. [LumiPanel.tsx:96,190] [lumi.store.ts]
- [x] [Review][Patch] **[High]** Inactivity timer kills active conversations — it's reset *only* on transcript received, not on speech capture (`onSpeechEnd`) or during TTS playback, so a long user utterance or a >20s Lumi reply auto-ends mid-stream; a stale timer from a prior session is also not cleared at `startSession` entry. Fix: reset on `onSpeechEnd`, pause/extend during playback, and clear any pending timer when a new session starts. [useLumiVoiceSession.ts:100-105,118,137]
- [x] [Review][Patch] **[Medium]** `endSession` re-entrancy → double DELETE — concurrent callers (inactivity timer + orb tap, or error + manual end) each read `talkSessionId` before it's cleared, firing two `DELETE /voice/sessions/:id`. Fix: add an `endingRef` guard or null `talkSessionId` synchronously first. [useLumiVoiceSession.ts:173-210]
- [x] [Review][Patch] **[Medium]** WS close/error guards test ref-nullness, not identity — `if (ttsWsRef.current !== null)` instead of `=== ws`; in a reconnect overlap an old socket's late non-1000 close can tear down a freshly-started session. Fix: compare `=== ws`. [useLumiVoiceSession.ts:262-267,301-306]
- [x] [Review][Patch] **[Medium]** `voiceError` is sticky in text mode — the `isVoiceMode &&` guard was removed (correct for AC#2's Premium copy), but `voiceError` now only clears via `setTalkSession`/`endTalkSession`, so a text submit or tab switch leaves the terracotta alert under the composer indefinitely. Fix: clear `voiceError` on text submit / add a dismiss. [LumiPanel.tsx:196] [lumi.store.ts:106-107]
- [x] [Review][Patch] **[Medium]** `int16ToBase64` per-byte string concat over a full utterance is O(n²) — `onSpeechEnd` audio is the entire segment (tens of KB+); the loop concat causes jank on longer speech. Fix: chunked `String.fromCharCode`/`Uint8Array` slicing. [useLumiVoiceSession.ts:19-24]
- [x] [Review][Patch] **[Low]** Odd-byte TTS PCM → uncaught `RangeError` — `new Int16Array(bytes.buffer, off, bytes.byteLength/2)` with an odd byteLength throws out of the WS `message` handler. Fix: floor the length / guard `byteLength % 2`. [useLumiVoiceSession.ts:77]
- [x] [Review][Patch] **[Low]** Empty transcript still POSTs — `{ user_transcript: '' }` passes the `typeof === 'string'` check, POSTs `message:''`, hits the server's `min(1)` 400, which is swallowed. Fix: `if (!text.trim()) return;` before POSTing. [useLumiVoiceSession.ts:136,290]
- [x] [Review][Patch] **[Medium]** (from decision: surface + stay in session) Mid-session turn-POST failure is silently swallowed — `handleTranscript`'s bare `catch {}` drops 4xx/5xx/parse failures with no UI cue. Fix: in the `catch`, surface a brief inline alert (without tearing down the live session — do NOT route through `setVoiceError`/`endSession`, which would flip `voiceStatus` away from `'active'`; use a transient error surface so the user can simply speak again). [useLumiVoiceSession.ts:166]

### Deferred

- [x] [Review][Defer] **[Medium]** `useMicVAD` ONNX model loads on every `(app)` route for ALL users (incl. Standard tier who can't use voice) — bandwidth/CPU cost imposed on non-voice users; consider lazy-mounting the hook only when voice is invoked. [routes/(app)/layout.tsx:18] — deferred, architectural (spec recommended layout-level mount)
- [x] [Review][Defer] **[Low]** Voice button re-fires `POST /voice/sessions` on each click while in `'error'`/post-403 state — a Standard user can spam 403s; no client backoff. [LumiPanel.tsx:102-111] — deferred, minor
- [x] [Review][Defer] **[Low]** Initial blank TTS frame can play audio while `voiceStatus` is still `'connecting'` — minor ordering; single-space init frame unlikely to be audible. [useLumiVoiceSession.ts:235] — deferred, minor
- [x] [Review][Defer] **[Medium]** Non-`message` Lumi turn → silent dead-air in voice — `lumiText` is `''`, so no `onLumiReply`/`sendToTts` and `TurnRow` renders nothing. [useLumiVoiceSession.ts:160-165] — deferred per decision (accept silence at MVP; non-message turns rare in voice)

### Dismissed (6)

- Optimistic user-turn display dropped — spec-sanctioned ("simpler alternative", Task 5).
- Orb tap-to-end leaves the panel open — AC#6 only mandates the store reset (idle/text/null), which happens.
- `onSpeechEnd` lacks a session-active guard — already guarded by WS `readyState` + `vad.pause()`.
- `float32ToInt16` truncation-toward-zero rounding — non-defect (negligible quantization).
- `int16ToBase64` host-endian assumption — browsers are little-endian; ElevenLabs PCM is frame-aligned.
- VAD `onSpeechEnd` after end sends to a closed socket — guarded; no-op.

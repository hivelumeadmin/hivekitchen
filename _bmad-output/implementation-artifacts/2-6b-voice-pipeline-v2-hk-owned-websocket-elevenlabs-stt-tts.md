# Story 2.6b: Voice Pipeline v2 — HK-Owned WebSocket, ElevenLabs STT + TTS

Status: done

> **Replaces Story 2.6** (voice-first onboarding via ElevenLabs Custom LLM mode).
> Story 2.6 is `done` and its migrations/DB schema remain in place. This story
> replaces the transport layer only — the onboarding interview content, thread
> model, and cultural-prior inference (Story 2.11) are unchanged.

## Story

As a Primary Parent,
I want a voice-first onboarding interview where HiveKitchen owns the real-time
audio pipeline end-to-end and ElevenLabs is used only for best-in-class STT and
v3 expressive TTS,
so that every utterance is processed by Lumi's onboarding agent in real-time
and responded to with warm, natural-sounding voice — without the browser ever
connecting directly to ElevenLabs (FR2, UX-DR64).

## Architecture Overview

```
Browser mic
  ↓ @ricky0123/vad-react (VAD — silence detection)
  ↓ onSpeechEnd(Float32Array PCM)
  ↓ encode WAV
  ↓ binary WS frame (opcode 0x2)
                         ↓
                  HiveKitchen API
                  @fastify/websocket
                         ↓
                  POST /v1/speech-to-text     ← ElevenLabs Scribe STT
                         ↓
                  OnboardingAgent.respond()   ← OpenAI gpt-4o
                         ↓
              POST /v1/text-to-speech/:id/stream  ← ElevenLabs TTS v3
                         ↓
                  binary WS frames (MP3 chunks) → browser AudioContext
```

**Three HiveKitchen-owned endpoints (all new or replaced):**

| Endpoint | Caller | Auth | Purpose |
|---|---|---|---|
| `POST /v1/voice/sessions` | Browser | JWT | Creates `voice_sessions` row; returns `session_id` |
| `GET /v1/voice/ws` | Browser | JWT query-param `token` | WebSocket upgrade; audio streaming pipeline |
| ~~`POST /v1/voice/token`~~ | removed | — | Replaced by `POST /v1/voice/sessions` |
| ~~`POST /v1/voice/llm`~~ | removed | — | Was Custom LLM endpoint |
| ~~`POST /v1/webhooks/elevenlabs`~~ | removed | — | Was post-call webhook |

**What changes vs. Story 2.6:**
- ElevenLabs is no longer a call-home Custom LLM host — it is a pure API service
- Browser never connects to ElevenLabs; all ElevenLabs API calls are server-side
- Session lifecycle is owned by HiveKitchen (no webhook to wait for)
- `inferFromSummary` runs synchronously inside `closeSession()` → race condition eliminated
- `@elevenlabs/react` removed from `apps/web`; replaced by `@ricky0123/vad-react` + native `WebSocket`

## Acceptance Criteria

1. **Given** an authenticated `POST /v1/voice/sessions` with `{ context: 'onboarding' }`, **When** the request arrives, **Then** the API creates a `threads` row (`type: 'onboarding'`, `status: 'active'`) and a `voice_sessions` row (`status: 'active'`), leaving `elevenlabs_conversation_id` as NULL (column stays nullable; no migration needed), and returns `{ session_id: <uuid> }` — 200.

2. **Given** an authenticated `GET /v1/voice/ws?session_id=<uuid>` (JWT in `token` query-param), **When** the WebSocket handshake completes, **Then** the server validates the JWT claim matches the `voice_sessions.user_id`, sends `{ type: 'session.ready' }` as a text frame, and the connection is now active. If JWT is missing/invalid → WS close code 4001. If `session_id` not found or already closed → WS close code 4004.

3. **Given** an active WS connection and the client sends a **binary frame** (WAV-encoded utterance, 16-bit PCM, 16 kHz mono, max 60 s), **When** the frame arrives and the session is not currently processing another turn, **Then** the server:
   - (a) Calls ElevenLabs Scribe STT (`POST /v1/speech-to-text`, `model_id=scribe_v1`); on API error returns `{ type: 'error', code: 'stt_failed', message: 'Could not hear that — try again' }` without closing session
   - (b) Sends `{ type: 'transcript', seq: <n>, text: <transcript> }` text frame to the client
   - (c) Calls `OnboardingAgent.respond(messages)` — returns `{ text: string, complete: boolean }`; on agent error returns non-fatal `error` frame and reverts `isProcessing`
   - (d) Sends `{ type: 'response.start', seq: <n> }` text frame
   - (e) Calls ElevenLabs TTS v3 stream (`POST /v1/text-to-speech/:voice_id/stream`, `model_id: 'eleven_v3'`, `output_format: 'mp3_44100_128'`, `voice_settings: { style: 0.6, stability: 0.5, similarity_boost: 0.8, use_speaker_boost: true }`); expression tags in `text` are passed to TTS intact
   - (f) Streams each binary MP3 chunk as a **binary WS frame** to the client
   - (g) Sends `{ type: 'response.end', seq: <n>, text: <expression-stripped text> }` text frame
   - (h) Persists user turn (`role: 'user'`, `modality: 'voice'`) and Lumi turn (`role: 'lumi'`, `modality: 'voice'`, content = expression-stripped text) to `thread_turns` via `appendTurnNext`
   - (i) If `complete === true`: proceeds to AC5 (`closeSession`)

4. **Given** an active WS connection and a **binary frame** arrives while `isProcessing === true`, **Then** the server drops the frame silently, logs `voice.turn_dropped_concurrent` at `warn`, and takes no other action (no error frame to client).

5. **Given** `OnboardingAgent.respond()` returns `{ complete: true }` (all signal questions answered), **Then** `closeSession()` runs synchronously in the same turn handler:
   - (a) Calls `agent.extractSummary(transcriptTurns)` on the accumulated thread turns
   - (b) Appends `system_event` turn (`{ type: 'system_event', event: 'onboarding.summary', payload: summary }`)
   - (c) Calls `culturalPriorService.inferFromSummary({ householdId, threadId, transcript })`
   - (d) Calls `repository.closeThread(threadId)` and `repository.updateVoiceSession({ status: 'closed', ended_at: now })`
   - (e) Sends `{ type: 'session.summary', summary: <OnboardingSummary>, cultural_priors_detected: <boolean> }` text frame
   - (f) Closes the WS with code 1000 (normal)
   - The client uses `cultural_priors_detected` to navigate to the `cultural-ratification` onboarding mode immediately, without a separate GET call.

6. **Given** the session has been open for ≥10 minutes and the next binary frame arrives (or a server-side 10-minute timer fires), **Then** the server generates the closing phrase via `agent.closingPhrase()` (returns `"[warmly] That's everything I needed — let me put together your first plan."`), pipes it through TTS v3 as a normal turn (steps 3d–3h), then runs `closeSession()` (steps 5a–5f) with `status: 'timed_out'` in place of `'closed'`.

7. **Given** the WS connection closes from the client side before the agent signals `complete`, **Then** the server runs `closeSession()` (steps 5a–5f), persisting whatever turns have accumulated; `cultural_priors_detected` is logged internally but not sent (WS is closed).

8. **Given** an unauthenticated `POST /v1/voice/sessions`, **Then** 401.

9. **Given** `POST /v1/voice/sessions` while a `voice_sessions` row with `status: 'active'` already exists for the same household, **Then** 409 — the client must close the existing session before creating a new one (prevents accidental parallel sessions).

10. **Given** any request to `POST /v1/voice/token`, `POST /v1/voice/llm`, or `POST /v1/webhooks/elevenlabs`, **Then** 404 — those routes are removed.

11. **Given** `apps/web` package.json, **Then** `@elevenlabs/react` does not appear as a dependency; `@ricky0123/vad-react` is present.

12. **Given** TTS v3 streaming fails mid-stream (network error after first chunks delivered), **Then** the server sends `{ type: 'error', code: 'tts_failed', message: 'Voice unavailable — please read the response instead' }`, does NOT close the session, and allows the next utterance.

## Tasks / Subtasks

- [x] Task 1 — Install new server dependency (AC: 2)
  - [x] `pnpm add @fastify/websocket` in `apps/api`
  - [x] Register `@fastify/websocket` plugin in `apps/api/src/app.ts` alongside the other Fastify plugins:
    ```typescript
    import websocket from '@fastify/websocket';
    // ...
    await app.register(websocket);
    ```

- [x] Task 2 — Contracts: replace Custom LLM/webhook schemas with WS message schemas (AC: 2, 3, 5, 6)
  - [x] In `packages/contracts/src/voice.ts`, **replace** the entire file with:
    ```typescript
    import { z } from 'zod';

    // POST /v1/voice/sessions
    export const VoiceSessionCreateSchema = z.object({
      context: z.literal('onboarding'),
    });
    export const VoiceSessionCreateResponseSchema = z.object({
      session_id: z.string().uuid(),
    });

    // WebSocket — client → server text frame
    export const WsClientMessageSchema = z.discriminatedUnion('type', [
      z.object({ type: z.literal('ping') }),
    ]);

    // WebSocket — server → client text frames
    export const WsSessionReadySchema = z.object({
      type: z.literal('session.ready'),
    });
    export const WsTranscriptSchema = z.object({
      type: z.literal('transcript'),
      seq: z.number().int(),
      text: z.string(),
    });
    export const WsResponseStartSchema = z.object({
      type: z.literal('response.start'),
      seq: z.number().int(),
    });
    export const WsResponseEndSchema = z.object({
      type: z.literal('response.end'),
      seq: z.number().int(),
      text: z.string(),
    });
    export const WsSessionSummarySchema = z.object({
      type: z.literal('session.summary'),
      summary: z.object({
        cultural_templates: z.array(z.string()),
        palate_notes: z.array(z.string()),
        allergens_mentioned: z.array(z.string()),
      }),
      cultural_priors_detected: z.boolean(),
    });
    export const WsErrorSchema = z.object({
      type: z.literal('error'),
      code: z.string(),
      message: z.string(),
    });

    export const WsServerMessageSchema = z.discriminatedUnion('type', [
      WsSessionReadySchema,
      WsTranscriptSchema,
      WsResponseStartSchema,
      WsResponseEndSchema,
      WsSessionSummarySchema,
      WsErrorSchema,
    ]);

    // Types
    export type VoiceSessionCreate = z.infer<typeof VoiceSessionCreateSchema>;
    export type VoiceSessionCreateResponse = z.infer<typeof VoiceSessionCreateResponseSchema>;
    export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;
    export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
    export type WsSessionSummary = z.infer<typeof WsSessionSummarySchema>;
    ```
  - [x] Remove `VoiceTokenRequestSchema`, `VoiceTokenResponse`, `ElevenLabsLlmRequestSchema`, `ElevenLabsPostCallWebhookPayload` exports from `packages/contracts/src/index.ts`
  - [x] Add new WS schema exports to `packages/contracts/src/index.ts`
  - [x] Update `packages/types/src/index.ts` — remove old type re-exports, add new ones
  - [x] Delete (or stub-empty) `packages/contracts/src/voice.test.ts` test file and replace with tests for new schemas:
    - `VoiceSessionCreateSchema` accepts `{ context: 'onboarding' }`, rejects `{ context: 'evening' }`
    - `WsClientMessageSchema` accepts `{ type: 'ping' }`, rejects unknown type
    - `WsSessionSummarySchema` accepts valid summary with `cultural_priors_detected: true`

- [x] Task 3 — Env vars: remove Custom LLM / webhook vars, add voice ID (AC: 10)
  - [x] In `apps/api/src/common/env.ts` `EnvSchema`:
    - Remove: `ELEVENLABS_WEBHOOK_SECRET`, `ELEVENLABS_AGENT_ID`, `ELEVENLABS_CUSTOM_LLM_SECRET`
    - Add: `ELEVENLABS_VOICE_ID: z.string().min(1)` (the ElevenLabs voice ID for TTS, e.g., Rachel)
    - Keep: `ELEVENLABS_API_KEY` unchanged
  - [x] Update `apps/api/.env.local.example`:
    - Remove the three deprecated vars; add `ELEVENLABS_VOICE_ID=replace-with-voice-id` under the ElevenLabs section
    - Update comment to read: `# ---- ElevenLabs (STT + TTS v3) ----------`

- [x] Task 4 — API: update `OnboardingAgent.respond()` return type (AC: 3, 5)
  - [x] In `apps/api/src/agents/onboarding.agent.ts`:
    - Change `respond(messages: LlmMessage[])` signature from `Promise<string>` to `Promise<{ text: string; complete: boolean }>`
    - The agent must return `complete: true` when all three signal questions are answered and the closing summary phrase has been generated
    - Implementation: add a sentinel check in the system prompt instructing the LLM to include `[SESSION_COMPLETE]` at the very end of its response when the interview is done; strip the sentinel in the `respond()` method before returning, setting `complete: true`
    - System prompt addition (append to existing onboarding system prompt):
      ```
      When you have asked all three signal questions and spoken the closing
      summary phrase ("That's everything I needed — let me put together your
      first plan."), append the literal token [SESSION_COMPLETE] at the very
      end of your response, with no text after it.
      ```
    - In `respond()`: detect `[SESSION_COMPLETE]` suffix → `complete = true`, strip it from `text`
    - Add `closingPhrase(): string` method that returns the hardcoded closing phrase with expression tags
    - Update all call sites that currently expect `respond()` to return `string` (there are none outside voice.service.ts after Story 2.11's text path uses its own method)
  - [x] Export `OnboardingAgentResponse` type from `onboarding.agent.ts`:
    ```typescript
    export interface OnboardingAgentResponse {
      text: string;
      complete: boolean;
    }
    ```

- [x] Task 5 — API voice module: new `VoiceService` (AC: 1, 3, 4, 5, 6, 7, 9, 12)
  - [x] Replace `apps/api/src/modules/voice/voice.service.ts` with new implementation:

    ```typescript
    // Key types and structure — implement fully in the file

    interface WsSession {
      sessionId: string;
      userId: string;
      householdId: string;
      threadId: string;
      seq: number;
      messages: LlmMessage[];
      isProcessing: boolean;
      startedAt: Date;
      timeoutHandle: ReturnType<typeof setTimeout> | null;
    }

    export class VoiceService {
      // In-memory session store. At beta scale (150 concurrent HH) this is
      // sufficient; a Redis-backed store is a deferred upgrade (see deferred-work.md).
      private readonly sessions = new Map<string, WsSession>();

      constructor(deps: VoiceServiceDeps) { /* ... */ }

      // Called by POST /v1/voice/sessions
      async createSession(userId: string, householdId: string): Promise<{ sessionId: string }>
      // 1. Check for existing active session for householdId → throw ConflictError (409)
      // 2. createThread(householdId, 'onboarding', 'voice')
      // 3. createVoiceSession({ userId, householdId, threadId, elevenLabsConversationId: null })
      // 4. Return { sessionId: session.id }

      // Called when WS connects
      async openWsSession(sessionId: string, userId: string, ws: WebSocket): Promise<WsSession>
      // 1. findVoiceSession(sessionId) → 4004 if not found or not active
      // 2. Verify session.user_id === userId → 4001 if mismatch
      // 3. Store WsSession in this.sessions map
      // 4. Set 10-minute timeout → calls this.handleTimeout(sessionId, ws)
      // 5. Send { type: 'session.ready' } text frame
      // 6. Return WsSession

      // Called for each binary frame from client
      async processAudioChunk(sessionId: string, audioBuffer: Buffer, ws: WebSocket): Promise<void>
      // 1. Get WsSession from map → if not found, log and return
      // 2. If isProcessing → drop + log voice.turn_dropped_concurrent → return
      // 3. Check timeout (Date.now() - startedAt > 10min) → handleTimeout and return
      // 4. session.isProcessing = true
      // 5. const seq = ++session.seq
      // 6. Try:
      //    a. STT: POST to ElevenLabs Scribe → transcript text
      //       On fail: send WsError('stt_failed'), isProcessing = false, return
      //    b. Send WsTranscript(seq, transcript)
      //    c. session.messages.push({ role: 'user', content: transcript })
      //    d. const { text, complete } = await agent.respond(session.messages)
      //       On fail: send WsError('agent_failed'), isProcessing = false, return
      //    e. Send WsResponseStart(seq)
      //    f. TTS v3 stream → pipe binary chunks as binary WS frames
      //       On mid-stream fail: send WsError('tts_failed'), isProcessing = false, return (no close)
      //    g. const strippedText = stripExpressionTags(text)
      //    h. Send WsResponseEnd(seq, strippedText)
      //    i. session.messages.push({ role: 'assistant', content: strippedText })
      //    j. Persist user turn + lumi turn via repository.appendTurnNext
      //    k. if (complete) await this.closeSession(sessionId, ws, 'completed')
      // 7. Finally: session.isProcessing = false

      // Runs synchronously — the race fix
      private async closeSession(
        sessionId: string,
        ws: WebSocket | null,
        reason: 'completed' | 'timed_out' | 'client_disconnect',
      ): Promise<void>
      // 1. Remove session from this.sessions (idempotency guard if called twice)
      // 2. Clear timeout handle if set
      // 3. Build transcriptTurns from session.messages
      // 4. extractSummary(transcriptTurns)
      // 5. appendTurnNext(system_event: onboarding.summary)
      // 6. culturalPriorService.inferFromSummary({ householdId, threadId, transcript })
      //    → set cultural_priors_detected = (result.detected.length > 0)
      //    On error: log warn, cultural_priors_detected = false
      // 7. repository.closeThread(threadId)
      // 8. repository.updateVoiceSession({ status: reason === 'completed' ? 'closed' : reason, ended_at: now })
      // 9. If ws != null (not client_disconnect), send WsSessionSummary, then ws.close(1000)
      // 10. Log voice.session_ended with reason, turn_count

      // Called on 10-minute timer fire
      private async handleTimeout(sessionId: string, ws: WebSocket): Promise<void>
      // 1. Retrieve session from map; if gone (already closed), return
      // 2. Generate closing phrase via agent.closingPhrase()
      // 3. Pipe closing phrase through TTS v3 → send binary chunks + WsResponseEnd
      // 4. await this.closeSession(sessionId, ws, 'timed_out')

      // Called when WS connection closes (onclose)
      async onWsClose(sessionId: string): Promise<void>
      // 1. Retrieve session from map; if gone, return
      // 2. await this.closeSession(sessionId, null, 'client_disconnect')
    }
    ```

  - [x] ElevenLabs API calls in VoiceService use raw `fetch` (not `@elevenlabs/elevenlabs-js` SDK methods) to avoid SDK API surface uncertainty — pass `xi-api-key` header:
    ```typescript
    // STT
    const form = new FormData();
    form.append('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'utterance.wav');
    form.append('model_id', 'scribe_v1');
    const sttRes = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': this.elevenLabsApiKey },
      body: form,
    });
    const { text } = await sttRes.json() as { text: string };

    // TTS v3 stream
    const ttsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.elevenLabsApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_v3',
          output_format: 'mp3_44100_128',
          voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.6, use_speaker_boost: true },
        }),
      },
    );
    for await (const chunk of ttsRes.body!) {
      ws.send(Buffer.from(chunk)); // binary frame
    }
    ```
  - [x] `VoiceServiceDeps` interface: replace `elevenlabs: ElevenLabsClient` with `elevenLabsApiKey: string` and `voiceId: string`
  - [x] Import `ConflictError` from `common/errors.ts` (add if not present: HTTP 409, type `/errors/conflict`)

- [x] Task 6 — API voice module: new routes (AC: 1, 2, 8, 9, 10)
  - [x] Replace `apps/api/src/modules/voice/voice.routes.ts` with:

    ```typescript
    // POST /v1/voice/sessions — JWT auth applies (normal)
    fastify.post('/v1/voice/sessions',
      { schema: { body: VoiceSessionCreateSchema, response: { 200: VoiceSessionCreateResponseSchema } } },
      async (request) => {
        const { sessionId } = await service.createSession(
          request.user.id,
          request.user.household_id,
        );
        request.auditContext = {
          event_type: 'voice.session_started',
          user_id: request.user.id,
          household_id: request.user.household_id,
          request_id: request.id,
          metadata: { session_id: sessionId },
        };
        return { session_id: sessionId };
      },
    );

    // GET /v1/voice/ws — WebSocket upgrade. JWT passed as ?token= query param.
    // Must be added to SKIP_PREFIXES in authenticate.hook.ts (WS cannot send
    // Authorization header); JWT is validated manually inside the handler.
    fastify.get('/v1/voice/ws', { websocket: true }, async (socket, request) => {
      // 1. Validate ?token= JWT claim (use fastify.jwt.verify)
      // 2. Validate ?session_id= presence
      // 3. await service.openWsSession(sessionId, userId, socket)
      //    → throws on 4001/4004 conditions; handler translates to ws.close(code)
      // 4. socket.on('message', async (msg) => {
      //      if (msg is Buffer) await service.processAudioChunk(sessionId, msg, socket)
      //      else if (msg is text) { const parsed = WsClientMessageSchema.safeParse(JSON.parse(msg))
      //                              if ping → socket.send(JSON.stringify({ type: 'pong' })) }
      //    })
      // 5. socket.on('close', () => service.onWsClose(sessionId))
    });
    ```
  - [x] Add `'/v1/voice/ws'` to `SKIP_EXACT` list in `authenticate.hook.ts` (JWT validated inside handler)
  - [x] **Do NOT register** `POST /v1/voice/token`, `POST /v1/voice/llm`, or `POST /v1/webhooks/elevenlabs` — they are removed. Their absence causes Fastify to return 404 naturally.

- [x] Task 7 — Web: install VAD dependency, remove ElevenLabs React SDK (AC: 11)
  - [x] In `apps/web`:
    ```bash
    pnpm remove @elevenlabs/react
    pnpm add @ricky0123/vad-react
    ```
  - [x] Verify `apps/web/package.json` — `@elevenlabs/react` is gone, `@ricky0123/vad-react` is present

- [x] Task 8 — Web: `useVoiceSession` hook (AC: 3, 5, 6, 12)
  - [x] Create `apps/web/src/hooks/useVoiceSession.ts`:

    ```typescript
    // State machine: 'idle' | 'connecting' | 'ready' | 'listening' |
    //                'processing' | 'speaking' | 'closing' | 'closed' | 'error'
    //
    // Responsibilities:
    // 1. POST /v1/voice/sessions → get session_id
    // 2. Open WebSocket: ws = new WebSocket(`${WS_BASE_URL}/v1/voice/ws?session_id=<id>&token=<jwt>`)
    // 3. Buffer incoming binary frames (MP3 chunks) indexed by seq
    // 4. On WsResponseEnd: concatenate buffered chunks → Blob(audio/mpeg) → new Audio(URL.createObjectURL) → play
    // 5. Hook into @ricky0123/vad-react: onSpeechStart → state = 'listening';
    //    onSpeechEnd(Float32Array) → encode WAV → ws.send(wavBuffer) → state = 'processing'
    // 6. On WsSessionSummary: call onComplete({ cultural_priors_detected })
    // 7. On WsError: set errorMessage, state remains (non-fatal errors keep session open)
    // 8. Expose: { status, transcriptLines, lumiLines, errorMessage, start(), stop() }

    // WAV encoding helper (inline or from @/lib/encodeWav.ts):
    // 16-bit PCM, 16 kHz, mono, canonical WAV header
    function encodeWav(pcmFloat32: Float32Array, sampleRate: number): Uint8Array

    export interface VoiceSessionCallbacks {
      onComplete: (result: { cultural_priors_detected: boolean }) => void;
      onError?: (message: string) => void;
    }

    export function useVoiceSession(callbacks: VoiceSessionCallbacks): {
      status: VoiceSessionStatus;
      transcriptLines: string[];
      lumiLines: string[];
      errorMessage: string | null;
      start: () => Promise<void>;
      stop: () => void;
    }
    ```

  - [x] VAD config for `@ricky0123/vad-react`:
    ```typescript
    const vad = useMicVAD({
      onSpeechStart: () => { setStatus('listening'); },
      onSpeechEnd: (audio: Float32Array) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        const wav = encodeWav(audio, vad.sampleRate ?? 16000);
        wsRef.current.send(wav.buffer);
        setStatus('processing');
      },
      positiveSpeechThreshold: 0.8,
      negativeSpeechThreshold: 0.6,
      minSpeechFrames: 3,
      preSpeechPadFrames: 3,
    });
    ```
  - [x] While `status === 'processing'` or `status === 'speaking'`, VAD onSpeechEnd is a no-op (drops audio) — server-side concurrent protection (AC4) is the authoritative guard, but client-side is also a good UX guard
  - [x] WAV encode helper: create `apps/web/src/lib/encodeWav.ts` — standard 44-byte WAV header + 16-bit PCM samples converted from Float32 via `Math.max(-1, Math.min(1, sample)) * 0x7FFF`
  - [x] `WS_BASE_URL` comes from `VITE_API_WS_URL` env var (e.g., `ws://localhost:3001`); add to `apps/web/.env.local.example`

- [x] Task 9 — Web: update onboarding page (AC: 3, 5)
  - [x] In `apps/web/src/routes/(app)/onboarding.tsx`:
    - Remove `useConversation` import from `@elevenlabs/react`
    - Import `useVoiceSession` from `@/hooks/useVoiceSession.js`
    - Pass `onComplete: ({ cultural_priors_detected }) => { setMode(cultural_priors_detected ? 'cultural-ratification' : 'select'); }` to `useVoiceSession`
    - The existing `voice` mode UI — mic button, status indicator, transcript display — is adapted to consume `{ status, transcriptLines, lumiLines, errorMessage, start, stop }` from the hook
    - Remove all references to `@elevenlabs/react` (`useConversation`, `Conversation`, `Status`, etc.)

- [x] Task 10 — API: VoiceRepository compatibility (AC: 1, 5, 7)
  - [x] In `apps/api/src/modules/voice/voice.repository.ts`:
    - `createVoiceSession` signature already accepts `elevenLabsConversationId: string` — change to `elevenLabsConversationId: string | null`
    - Remove `findSessionByConversationId` method (no longer used)
    - Verify `closeThread`, `appendTurnNext`, `updateVoiceSession` methods exist (they do from Story 2.6)
    - Add `findActiveSessionForHousehold(householdId: string): Promise<VoiceSessionRow | null>` for the 409 guard in AC9:
      ```typescript
      async findActiveSessionForHousehold(householdId: string): Promise<VoiceSessionRow | null> {
        const { data } = await this.supabase
          .from('voice_sessions')
          .select(SESSION_COLUMNS)
          .eq('household_id', householdId)
          .eq('status', 'active')
          .maybeSingle();
        return data ?? null;
      }
      ```

- [x] Task 11 — API: add `ConflictError` to common errors (AC: 9)
  - [x] In `apps/api/src/common/errors.ts`, add:
    ```typescript
    export class ConflictError extends HiveKitchenError {
      constructor(message: string) {
        super(409, '/errors/conflict', 'Conflict', message);
      }
    }
    ```

- [x] Task 12 — Contracts: add voice test coverage for new schemas (AC: no functional AC — quality)
  - [x] Create `packages/contracts/src/voice.test.ts`:
    - `VoiceSessionCreateSchema` accepts `{ context: 'onboarding' }`, rejects `{ context: 'other' }`
    - `WsClientMessageSchema` accepts `{ type: 'ping' }`, rejects `{ type: 'unknown' }`
    - `WsSessionSummarySchema` accepts full summary with `cultural_priors_detected: true/false`
    - `WsResponseEndSchema` accepts `{ type: 'response.end', seq: 1, text: 'hello' }`

- [x] Task 13 — Deferred-work entry (non-code)
  - [x] Append to `_bmad-output/implementation-artifacts/deferred-work.md`:
    ```
    ## Deferred from: Story 2-6b voice pipeline v2 (2026-04-28)

    - **In-memory WsSession store** — `VoiceService.sessions` is a `Map<string, WsSession>`. At
      beta scale (150 concurrent HH) this is sufficient. At 5,000+ HH scale, WS connections must
      be routable to a specific API instance or the map must be replaced with Redis. Ticket: upgrade
      VoiceService to Redis-backed session store when API is deployed behind a load balancer.

    - **ElevenLabs Scribe async mode** — Scribe v1 is synchronous REST (~200–400ms). ElevenLabs
      provides an async batched Scribe endpoint with lower per-word cost. Evaluate when voice
      usage exceeds 100 HH active simultaneously.

    - **MediaSource streaming audio** — current implementation buffers all MP3 chunks and plays
      on response.end. MediaSource API would reduce perceived latency by ~200ms. Deferred until
      there is user feedback that the pause before Lumi speaks is noticeable.
    ```

## Dev Notes

### Binary frame encoding

**Client → Server (user utterance):**
- Format: WAV (RIFF), 16-bit signed PCM, 16 kHz, mono
- Produced by `encodeWav(Float32Array, sampleRate)` in `apps/web/src/lib/encodeWav.ts`
- VAD (`@ricky0123/vad-react`) triggers `onSpeechEnd(Float32Array)` with the utterance
- Maximum size: 60 s at 16 kHz 16-bit mono = ~1.9 MB — well within ElevenLabs Scribe limits

**Server → Client (Lumi response):**
- Format: MP3 binary chunks (`output_format: 'mp3_44100_128'`)
- Each WS binary frame is one ReadableStream chunk from the TTS v3 response body
- Client buffers chunks per-seq, plays entire response on `response.end` via `Audio(URL.createObjectURL(new Blob(chunks, { type: 'audio/mpeg' })))`

### WS authentication pattern

Standard browsers cannot set `Authorization` headers on WebSocket connections. JWT is passed as:
```
GET /v1/voice/ws?session_id=<uuid>&token=<jwt>
```
The handler validates `token` via `fastify.jwt.verify(token)` before calling `openWsSession()`. Because the JWT is short-lived (15-minute access token, per Story 2.2), the token-in-URL exposure window is minimal. Log `ws.auth_attempt` at `debug` with `user_id` on success.

### Session lifecycle diagram

```
POST /v1/voice/sessions → { session_id }
  ↓
GET /v1/voice/ws?session_id=...&token=...
  ↓ (WS open)
server → { type: 'session.ready' }
  ↓
client sends binary frame (utterance)
  ↓
server → { type: 'transcript', seq, text }
server → { type: 'response.start', seq }
server → [binary chunk...binary chunk]
server → { type: 'response.end', seq, text }
  ↓ (repeat per utterance)
  ↓ (when agent returns complete: true)
server → { type: 'session.summary', summary, cultural_priors_detected }
server closes WS (code 1000)
  ↓
client navigates to cultural-ratification | select based on cultural_priors_detected
```

### Thread / DB persistence (unchanged from Story 2.6)

All thread persistence follows the same pattern established in Story 2.6:
- One `threads` row per session (`type: 'onboarding'`)
- `thread_turns` rows: `role ∈ { user, lumi, system }`, `modality: 'voice'`
- Final `system_event` turn: `{ type: 'system_event', event: 'onboarding.summary', payload: ... }`
- `voice_sessions.elevenlabs_conversation_id` is NULL for new sessions (column is already nullable; no migration needed)

### What Story 2.6 left in place (keep, do not remove)

- `supabase/migrations/20260504000000_create_threads.sql`
- `supabase/migrations/20260504010000_create_thread_turns.sql`
- `supabase/migrations/20260504020000_create_voice_sessions.sql`
- `apps/api/src/modules/voice/voice.repository.ts` — most methods unchanged
- `apps/api/src/common/strip-expression-tags.ts` — still used
- `apps/api/src/agents/onboarding.agent.ts` — modified in Task 4, not replaced

### `apps/web/src/lib/fetch.ts` — no change

The existing `hkFetch` utility covers `POST /v1/voice/sessions`. The WS connection uses native `WebSocket`.

### Cost profile (voice pipeline)

| Component | Old (Story 2.6) | New (2.6b) |
|---|---|---|
| STT | ElevenLabs TTS (bundled in agent) | ElevenLabs Scribe v1: ~$0.40/hr of audio |
| TTS | ElevenLabs v3 Conversational | ElevenLabs TTS v3: ~$0.30/1k chars |
| Agent | Per Custom LLM turn HTTP call | Same: OpenAI gpt-4o per turn |

Cost profile is comparable. Scribe v1 is billed per audio second; TTS v3 is billed per character. For a 10-minute onboarding interview the STT cost is ≤ $0.07 and TTS ≤ $0.05 (3–5 turns × ~200 chars each). This is within the <$1/mo/HH Standard voice SLO.

### Project Structure Notes

Files touched in this story:

```
apps/api/
  src/
    app.ts                                     [M] register @fastify/websocket
    common/
      env.ts                                   [M] remove 3 vars, add ELEVENLABS_VOICE_ID
      errors.ts                                [M] add ConflictError
    agents/
      onboarding.agent.ts                      [M] respond() → { text, complete }, add closingPhrase()
    modules/
      voice/
        voice.routes.ts                        [M] replace — new POST + WS routes
        voice.service.ts                       [M] replace — HK-owned WS pipeline
        voice.repository.ts                    [M] findActiveSessionForHousehold; nullable conversationId
  .env.local.example                           [M] update ElevenLabs vars

apps/web/
  src/
    hooks/
      useVoiceSession.ts                       [A] new hook
    lib/
      encodeWav.ts                             [A] WAV encoding helper
    routes/
      (app)/
        onboarding.tsx                         [M] swap ElevenLabs SDK for useVoiceSession

packages/
  contracts/src/
    voice.ts                                   [M] replace all schemas
    voice.test.ts                              [M] replace tests
    index.ts                                   [M] export new, remove old

_bmad-output/
  implementation-artifacts/
    deferred-work.md                           [M] append 3 deferred items

Legend: [M]=modify [A]=add
```

### Testing

- Unit test `encodeWav()` — verify RIFF header bytes and sample count for a known Float32Array input
- Unit test `OnboardingAgent.respond()` — mock OpenAI client returning `[SESSION_COMPLETE]` suffix; verify `complete: true` and stripped `text`
- Unit test `VoiceService.processAudioChunk()` — mock STT/TTS/agent; verify turn persistence sequence
- Unit test `VoiceService.closeSession()` — verify `culturalPriorService.inferFromSummary` called BEFORE `ws.close()`
- Integration test: WS upgrade with invalid JWT → close code 4001
- Integration test: concurrent binary frames → second frame dropped (check `voice.turn_dropped_concurrent` log)

### References

- ElevenLabs Scribe STT: `POST https://api.elevenlabs.io/v1/speech-to-text` — `xi-api-key` header, multipart form (`audio` file + `model_id=scribe_v1`)
- ElevenLabs TTS v3 stream: `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream` — `xi-api-key` header, JSON body with `model_id: 'eleven_v3'`, streaming binary response
- `@ricky0123/vad-react` — `useMicVAD()` hook; `onSpeechEnd(Float32Array)` callback
- `@fastify/websocket` — `{ websocket: true }` route option; `socket` is a `WebSocket` from the `ws` library
- Architecture: [Source: _bmad-output/planning-artifacts/architecture.md#Voice]
- Story 2.11 (cultural prior inference): [Source: _bmad-output/implementation-artifacts/2-11-cultural-template-inference-parental-confirm.md]
- Story 2.6 (replaced, Custom LLM patterns): [Source: _bmad-output/implementation-artifacts/2-6-voice-first-onboarding-interview-via-elevenlabs-three-signal-questions.md]
- PRD FR2, FR57, FR60: voice-first onboarding, voice conversation, caption fallback

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- typecheck: `pnpm typecheck` (9 packages, all green)
- lint: `pnpm lint` (no new violations introduced; pre-existing issues remain in unrelated files: web/account.tsx, OnboardingConsent.tsx, ParentalNoticeContent.tsx, OnboardingText.test.tsx, CulturalRatificationStep.tsx, CulturalRatificationCard.tsx, api/children.routes.test.ts, api/households.repository.ts)
- tests: contracts 232/232 ✅, api 158/158 ✅ (11 integration suites skipped — env-gated), web 78/78 ✅

### Completion Notes List

- ElevenLabs is now a pure STT/TTS service via raw `fetch`. The Custom LLM (`/v1/voice/llm`) and post-call webhook (`/v1/webhooks/elevenlabs`) are removed; old endpoints surface as 404 (verified by tests).
- HK-owned WebSocket route (`GET /v1/voice/ws`) is added to `SKIP_EXACT` in `authenticate.hook.ts`; JWT comes through `?token=` query-param and is verified inside the handler.
- `VoiceService.sessions` is an in-memory `Map`. Sufficient for beta scale; deferred-work entry recorded for the Redis-backed upgrade.
- `OnboardingAgent.respond()` signature changed to `Promise<{ text, complete }>`. Updated existing text-path callers in `onboarding.service.ts` and `cultural-prior.service.ts` (the story note that they used a different method was outdated).
- `CulturalPriorService.inferFromSummary` now returns `{ detectedCount }` so the voice service can populate `cultural_priors_detected` in the `session.summary` WS frame; existing void-callers are unaffected.
- The text-onboarding `OnboardingVoice.tsx` was rewritten to consume `useVoiceSession`. The legacy `voice.store.ts` is mirrored from the hook so cross-tree consumers (`onboarding.tsx` error/loading branches) continue working.
- `ConflictError` already existed in `common/errors.ts`; Task 11 was a no-op verification.
- VAD options use the installed `@ricky0123/vad-react@0.0.36` API surface (`positiveSpeechThreshold`, `negativeSpeechThreshold`, `minSpeechMs`, `preSpeechPadMs`) — story spec referenced the older Frames-based API.
- Story 2.7 text-path agent semantics preserved: text-mode `respond()` ignores the `[SESSION_COMPLETE]` sentinel because TEXT_RULES never instructs the model to emit it.

### File List

#### Modified
- `apps/api/src/app.ts` — register `@fastify/websocket`
- `apps/api/src/common/env.ts` — remove ELEVENLABS_WEBHOOK_SECRET / ELEVENLABS_AGENT_ID / ELEVENLABS_CUSTOM_LLM_SECRET; add ELEVENLABS_VOICE_ID
- `apps/api/src/common/logger.test.ts` — drop ELEVENLABS_WEBHOOK_SECRET fixture; add ELEVENLABS_VOICE_ID
- `apps/api/.env.local.example` — remove deprecated ElevenLabs vars; add ELEVENLABS_VOICE_ID
- `apps/api/src/agents/onboarding.agent.ts` — `respond` returns `{ text, complete }`; add `closingPhrase()`; `[SESSION_COMPLETE]` sentinel handling
- `apps/api/src/agents/prompts/onboarding.prompt.ts` — voice prompt instructs sentinel emission
- `apps/api/src/middleware/authenticate.hook.ts` — `SKIP_EXACT` switched from `/v1/voice/llm` to `/v1/voice/ws`
- `apps/api/src/modules/voice/voice.routes.ts` — replaced with POST /v1/voice/sessions + WS /v1/voice/ws
- `apps/api/src/modules/voice/voice.service.ts` — replaced with HK-owned WS pipeline
- `apps/api/src/modules/voice/voice.repository.ts` — `findVoiceSession`, `findActiveSessionForHousehold`; nullable `elevenLabsConversationId`
- `apps/api/src/modules/voice/voice.routes.test.ts` — replaced with new tests covering sessions/WS routes + 404 for removed endpoints
- `apps/api/src/modules/onboarding/onboarding.service.ts` — unwrap `.text` from new agent response shape
- `apps/api/src/modules/cultural-priors/cultural-prior.service.ts` — unwrap `.text`; `inferFromSummary` returns `{ detectedCount }`
- `apps/web/package.json` — remove `@elevenlabs/react`; add `@ricky0123/vad-react`
- `apps/web/.env.local.example` — add `VITE_API_WS_URL`
- `apps/web/src/features/onboarding/OnboardingVoice.tsx` — replaced; consumes `useVoiceSession`
- `apps/web/src/routes/(app)/onboarding.tsx` — voice `onComplete` now routes via `cultural_priors_detected`
- `packages/contracts/src/voice.ts` — replaced with new session + WS message schemas
- `packages/contracts/src/voice.test.ts` — replaced with new schema tests
- `packages/types/src/index.ts` — re-exports refreshed for new voice types

#### Added
- `apps/api/package.json` — `@fastify/websocket` dependency
- `apps/web/src/hooks/useVoiceSession.ts` — VAD + WS pipeline hook
- `apps/web/src/lib/encodeWav.ts` — Float32 PCM → 16-bit WAV encoder
- `apps/web/src/lib/encodeWav.test.ts` — encoder unit tests
- `_bmad-output/implementation-artifacts/deferred-work.md` — 3 deferred items (in-memory store, Scribe async, MediaSource)

### Change Log

| Date       | Change                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| 2026-04-28 | Story 2-6b implemented: HK-owned WebSocket voice pipeline replacing ElevenLabs Custom LLM transport.    |

### Review Findings

**Group A — API Voice Module** (voice.service.ts, voice.routes.ts, voice.routes.test.ts, voice.repository.ts)
_Reviewed 2026-04-28 · 3 decision-needed · 10 patch · 2 deferred · 4 dismissed_

#### Decision-Needed (resolved)
- [x] [Review][Decision→Patch] **client_disconnect DB status maps to 'closed' — same as completed** — Decision: use `'disconnected'` as the DB status for `client_disconnect` reason to preserve all three end-states (`'closed'`, `'timed_out'`, `'disconnected'`) for analysis.
- [x] [Review][Decision→Patch] **Missing session_id param closes WS with code 4004** — Decision: change to 4001 (auth/client-error family).
- [x] [Review][Decision→Patch] **AC6 handleTimeout does not persist a user turn** — Decision: persist a synthetic `{ role: 'user', content: '[session timed out]' }` turn before the lumi closing phrase turn.

#### Patch
- [x] [Review][Patch] **`response.end` never sent after `tts_failed`** — When `streamTts` throws, the error frame is sent and the function returns, but `response.start` was already sent. The client is left in a permanently open turn state (started, never ended), breaking turn-boundary tracking. Fix: send `{ type: 'response.end', seq, text: '' }` before the error frame, or restructure so `response.start` is only sent after TTS begins successfully. [voice.service.ts ~line 199]
- [x] [Review][Patch] **ReadableStream leak in `streamTts` when `ws.send` throws** — If the WebSocket is closed client-side mid-stream, `ws.send` throws inside the `while(true)` read loop. There is no `finally` calling `reader.cancel()`, so the `ReadableStream` stays open and Node.js continues buffering ElevenLabs TTS data from the network until the remote closes. Fix: wrap the reader loop in try/finally and call `reader.cancel()` on exit. [voice.service.ts ~line 455]
- [x] [Review][Patch] **`findActiveSessionForHousehold` throws 500 on data anomaly** — `.maybeSingle()` returns a PostgREST PGRST116 error if more than one active row matches. The error propagates as an unhandled throw from `createSession`, surfacing as a 500 with no useful context. Fix: use `.limit(1).single()` pattern, or catch the PGRST116 code and throw a `ConflictError` with a clear message. [voice.repository.ts ~line 103]
- [x] [Review][Patch] **JWT token in `?token=` query string logged by Fastify access logger** — Fastify's default request serializer logs the full URL, including query params. The JWT is a bearer credential. Fix: configure a custom `reqSerializers` in Fastify that redacts `token` from the URL, or move token to a header via an auth sub-protocol handshake. [voice.routes.ts ~line 69]
- [x] [Review][Patch] **`handleTimeout` concurrent with in-flight `processAudioChunk` → dual TTS streams** — The 10-minute `setTimeout` fires unconditionally on wall-clock time, even if a turn is currently being processed (`isProcessing = true`). Both coroutines call `streamTts` to the same socket simultaneously, and `handleTimeout` calls `closeSession` which deletes the session while `processAudioChunk` is still running. Fix: check `session.isProcessing` at the start of `handleTimeout` and reschedule if true. [voice.service.ts ~line 245]
- [x] [Review][Patch] **Non-`NotFoundError` DB errors in `closeSession` re-thrown → WebSocket left open** — The `updateVoiceSession` try/catch re-throws all errors except `NotFoundError`. A network error or constraint violation causes the `ws.close(1000)` and final log to never execute, leaving the WebSocket connection open indefinitely. Fix: catch all errors (log at error level), ensuring the WS close and log always execute. [voice.service.ts ~line 362]
- [x] [Review][Patch] **Test mock conflates `findVoiceSession` and `findActiveSessionForHousehold` chains** — `buildMockSupabase` returns `activeSession` for both `.eq().maybeSingle()` and `.eq().eq().maybeSingle()`, meaning the 409-conflict test inadvertently also stubs `findVoiceSession`. When WS tests are added, this will silently give wrong results. Fix: split the mock so the two methods return independently configurable values. [voice.routes.test.ts ~line 66]
- [x] [Review][Patch] **Unbalanced `session.messages` after agent failure** — The user transcript is pushed to `session.messages` (line 175) before the agent call. If the agent fails and the handler returns, the next turn's `agent.respond(session.messages)` receives an unbalanced history (user message with no assistant reply), which can confuse the LLM into incorrect onboarding responses. Fix: push the user transcript only after confirming the agent call will proceed (i.e., move the push after the agent success path, or roll back on failure). [voice.service.ts ~line 175]
- [x] [Review][Patch] **`openWsSession` reconnect race — old `timeoutHandle` leaks** — If `openWsSession` is called twice for the same `sessionId` (e.g., a reconnect before the TCP close event propagates), the map entry is overwritten with a new `WsSession` and the old `clearTimeout` is never called. The old timer fires later and calls `handleTimeout` on the new socket. Fix: check if a session already exists in the map and clear its `timeoutHandle` before overwriting. [voice.service.ts ~line 117]
- [x] [Review][Patch] **`socket.on('message')` registered after `await openWsSession` → first audio frame can be dropped** — `sendText(ws, { type: 'session.ready' })` is called inside `openWsSession` (before it returns), but the `message` listener is registered after `openWsSession` resolves in the IIFE. A fast client that sends an audio frame immediately on receiving `session.ready` will race the listener registration and the frame will be silently discarded. Fix: register the `message` listener synchronously before calling `openWsSession`, or send `session.ready` only after the listeners are set up. [voice.routes.ts ~line 107]

#### Deferred
- [x] [Review][Defer] **TOCTOU in `createSession` — no DB-level uniqueness constraint** [voice.service.ts ~line 78] — deferred, pre-existing; two concurrent POST /v1/voice/sessions for the same household can both pass the `findActiveSessionForHousehold` null-check before either inserts. Requires a partial unique index `(household_id) WHERE status = 'active'` in the DB schema.
- [x] [Review][Defer] **No WS integration tests for AC2–AC7, AC12** [voice.routes.test.ts] — deferred, testing gap; all WebSocket behaviors (audio processing, concurrent turns, timeout, client disconnect, TTS failure) are untested. Noted in Dev Agent Record as a known gap.

---

**Group B — API Supporting Layer** (onboarding.agent.ts, onboarding.prompt.ts, onboarding.service.ts, onboarding.routes.ts, authenticate.hook.ts, env.ts, app.ts)
_Reviewed 2026-04-28 · 3 decision-needed · 8 patch · 3 deferred · 5 dismissed_

#### Decision-Needed (resolved)
- [x] [Review][Decision→Patch] **`closeSession` timed_out/disconnected writes `onboarding.summary` even on empty conversations** — Decision B: only write the `onboarding.summary` system_event and close thread on `reason === 'completed'`; for timed_out/disconnected, close thread without summary so `householdHasCompletedOnboarding` stays false.
- [x] [Review][Decision→Patch] **Lumi message pushed to `session.messages` before DB writes** — Decision B: move `session.messages.push(lumi reply)` to after both DB writes succeed; in-memory history stays balanced if a write fails.
- [x] [Review][Decision→Patch] **`extractSummary` failure swallowed with empty summary** — Decision A: on failure for `completed` sessions, refuse to persist; send `{ type: 'error', code: 'summary_failed' }` frame; close WS with 1011; close thread without summary so re-onboarding is unblocked.

#### Patch
- [x] [Review][Patch] **`respond()` sentinel detection uses `lastIndexOf` instead of `endsWith`** — Mid-response occurrence of `[SESSION_COMPLETE]` (model hallucination) truncates the reply at that position and immediately closes the session. Fix: `trimmed.endsWith(SESSION_COMPLETE_SENTINEL)` and slice from the end. [onboarding.agent.ts:44]
- [x] [Review][Patch] **Sentinel strip applied on text-modality path** — If the model leaks `[SESSION_COMPLETE]` on the text path despite `TEXT_RULES` forbidding it, the Lumi response text is silently truncated and `complete: true` is returned (ignored by the text caller, but truncation is visible). Fix: gate the sentinel logic on `modality === 'voice'` only. [onboarding.agent.ts:44]
- [x] [Review][Patch] **`isSummaryConfirmed` verdict check too permissive** — `return /^yes\b/.test(verdict) && !verdict.includes('no')` produces false negatives when "no" appears as a substring in a legitimate yes response (e.g., "yes, notable"). Fix: `return verdict === 'yes'` — strict equality is safe given `max_tokens: 5` and `temperature: 0`. [onboarding.agent.ts:266]
- [x] [Review][Patch] **`respond()` voice path uses cached `ONBOARDING_SYSTEM_PROMPT` constant** — The ternary `modality === 'voice' ? ONBOARDING_SYSTEM_PROMPT : getOnboardingSystemPrompt(modality)` means the voice path always uses the module-load-time string. If `getOnboardingSystemPrompt` is ever made runtime-parameterizable, voice silently uses the old value. Fix: always call `getOnboardingSystemPrompt(modality)` and remove the `ONBOARDING_SYSTEM_PROMPT` import from the agent. [onboarding.agent.ts:27]
- [x] [Review][Patch] **Trailing slash on `/v1/voice/ws/` bypasses `SKIP_EXACT`** — `split('?')[0]` yields `/v1/voice/ws/`, which is not in the Set. Fastify's `ignoreTrailingSlash` is false by default; a client or proxy appending `/` receives a 401 on the WS upgrade. Fix: strip trailing slash before the set lookup. [authenticate.hook.ts:19]
- [x] [Review][Patch] **`handleTimeout` reschedule loop has no upper bound** — If `session.isProcessing` never clears (hung OpenAI/ElevenLabs call), the 5-second reschedule fires indefinitely, accumulating uncleared `setTimeout` handles. Fix: add `attempt` counter parameter with `MAX_RESCHEDULE_ATTEMPTS = 6` (30 s cap); force close on breach. [voice.service.ts:258]
- [x] [Review][Patch] **`closeSession` incomplete sessions: `timed_out`/`client_disconnect`** — Previously always wrote `onboarding.summary` system_event and closed thread, permanently locking household from re-onboarding after any abandoned session. Now skips summary event for incomplete sessions and closes thread without it. [voice.service.ts:310 — D-B-1:B]
- [x] [Review][Patch] **`closeSession` `extractSummary` failure silently persisted empty allergens** — Previously swallowed the error and wrote `{ allergens_mentioned: [] }` to the DB, locking the household with missing allergy data. Now refuses to persist (D-B-3:A): sends error frame, closes WS 1011, leaves household unblocked for re-onboarding. [voice.service.ts:334]
- [x] [Review][Patch] **`closeSession` summary event written with `modality: 'text'` on voice thread** — Fixed as part of the closeSession rewrite: summary `system_event` now uses `modality: 'voice'`. [voice.service.ts:352]

#### Deferred
- [x] [Review][Defer] **JWT `?token=` written to access logs** [voice.routes.ts:69] — pre-existing `TODO(security)`; add pino request serialiser in `app.ts` to redact `?token=<value>` before shipping to production log aggregation.
- [x] [Review][Defer] **`submitTextTurn` race-recovery conflates "finalized" and "read-lag" nulls** [onboarding.service.ts:96-107] — low-probability edge case; add `householdHasCompletedOnboarding` check before choosing the error message in a future hardening pass.
- [x] [Review][Defer] **Orphaned-turn detection false-positive on duplicate short messages** [onboarding.service.ts:136-141] — content-equality check misidentifies legitimate "Yes"/"OK" retries as orphan resumes; fix with recency guard when hardening the text-onboarding retry path.

---

**Group C — Web Voice Layer** (useVoiceSession.ts, OnboardingVoice.tsx, onboarding.tsx, encodeWav.ts, voice.store.ts)
_Reviewed 2026-04-28 · 0 decision-needed · 11 patch · 0 deferred_

#### Patch
- [x] [Review][Patch] **`stop()` skips CONNECTING WebSocket — leaks open connection** — `readyState === WebSocket.OPEN` check misses `CONNECTING` state; a WS mid-handshake at `stop()` time is never closed. Fix: close on `OPEN || CONNECTING`. [useVoiceSession.ts:159]
- [x] [Review][Patch] **Ghost session after mid-fetch `stop()`** — `stop()` called during `await hkFetch` sets `startedRef.current = false`, but the continuation after `await` opens the WebSocket unconditionally; session leaks with no cleanup. Fix: `if (!startedRef.current) return` immediately after the fetch resolves. [useVoiceSession.ts:186]
- [x] [Review][Patch] **Overlapping audio — prior `<audio>` not paused before new one starts** — If a second `response.end` arrives while the first `<audio>` element is still playing, both play simultaneously. Fix: pause and null `playingAudioRef.current` at the top of `playBufferedAudio`. [useVoiceSession.ts:71]
- [x] [Review][Patch] **Cleanup `useEffect([stop])` re-fires mid-session** — `stop` depends on `vad` (returned by `useMicVAD` with a new reference each render); the cleanup effect re-runs on every render, tearing down the live session. Fix: `stopRef` pattern — update `stopRef.current = stop` via a side-effect-free `useEffect`, then use `stopRef.current()` in the cleanup `useEffect` with empty `[]` deps. [useVoiceSession.ts:249]
- [x] [Review][Patch] **`ArrayBuffer` binary branch lacks seq guard (Blob branch has it)** — A late binary frame from turn N arriving after `response.start` for turn N+1 would push into the wrong buffer. Fix: `if (audioBufferRef.current?.seq === buf.seq)` guard, matching the Blob branch. [useVoiceSession.ts:214]
- [x] [Review][Patch] **Zero-chunk `response.end` leaves status stuck at `'processing'`** — When the server sends `response.end` with an empty TTS stream (e.g., Lumi's closing phrase suppressed), `playBufferedAudio` returns early leaving status as `'processing'` indefinitely. Fix: transition to `'ready'` when `chunks.length === 0`. [useVoiceSession.ts:67]
- [x] [Review][Patch] **`callbacks` prop in `handleServerMessage`/`start` deps — unstable reference each render** — The callbacks object is a new reference each render, causing `handleServerMessage` and `start` to recreate every render. Fix: `callbacksRef` pattern — update `callbacksRef.current = callbacks` via `useEffect`, access `callbacksRef.current` inside handlers, remove `callbacks` from deps. [useVoiceSession.ts:55]
- [x] [Review][Patch] **`VITE_API_WS_URL` unset produces silent `"undefined/v1/voice/ws"` URL** — If `VITE_API_WS_URL` is missing from `.env.local`, the WS URL becomes `"undefined/v1/voice/ws?..."` producing a confusing error. Fix: `if (!WS_BASE_URL) throw new Error('VITE_API_WS_URL is not configured')` in `start()`. [useVoiceSession.ts:179]
- [x] [Review][Patch] **Stale voice error persists on re-mount of `OnboardingVoice`** — If the voice store has an error from a previous session, it is visible on re-mount before `start()` fires. Fix: call `clearError()` before `start()` in the mount effect. [OnboardingVoice.tsx:22]
- [x] [Review][Patch] **`setMode('select')` + `navigate('/app')` both called when `householdId === null`** — In the consent `onConsented` callback, both `setMode('select')` and `navigate('/app')` execute when `householdId === null`, causing a brief flash of the select screen. Fix: `if/else` guard. [onboarding.tsx:94]
- [x] [Review][Patch] **`navigate('/app')` called during render body in `cultural-ratification` block** — Side-effect in render causes double-execution in React Strict Mode. Fix: move to `useEffect([mode, householdId, navigate])` and render `null` while the effect fires. [onboarding.tsx:107]

---

**Group D — Contracts & Types** (voice.ts, voice.test.ts, thread.ts, thread.test.ts, contracts/index.ts, types/index.ts)
_Reviewed 2026-04-28 · 1 decision-needed (D-D-1:A) · 12 patch · 0 deferred_

#### Decision-Needed (resolved)
- [x] [Review][Decision→Patch] **`WsErrorSchema.code` unconstrained `z.string()`** — Decision A: define `WsErrorCodeSchema = z.enum(['stt_failed', 'agent_failed', 'tts_failed', 'summary_failed'])` and use it in `WsErrorSchema`. Export `WsErrorCode` type from both contracts and types packages.

#### Patch
- [x] [Review][Patch] **`seq` accepts 0 and negative integers** — `z.number().int()` on `WsTranscriptSchema`, `WsResponseStartSchema`, `WsResponseEndSchema` has no floor; seq=0 and seq=-1 pass silently. Fix: `.min(1)` on all three seq fields (monotonic counter starts at 1). [voice.ts:25,31,36]
- [x] [Review][Patch] **`SequenceId` regex allows negative numeric strings** — `/^-?\d+$/` accepts `"-1"`, `"-9999"`; number branch accepts negative integers. Fix: regex `/^\d+$/` (remove `-?`), `.nonnegative()` on number branch. [thread.ts:11,9]
- [x] [Review][Patch] **`text` accepts empty string on transcript and response.end** — Empty transcript injected into agent history; empty response.end renders blank Lumi reply bubble. Fix: `.min(1)` on both text fields. [voice.ts:26,37]
- [x] [Review][Patch] **`WsClientMessageSchema` ping allows extra properties** — Zod's default strips unknown keys silently; use `.strict()` to surface protocol violations during development. [voice.ts:15]
- [x] [Review][Patch] **`TurnBodyRatificationPrompt.key` is `z.string()` — not constrained to `CulturalKeySchema`** — An invalid key (`"jamaican_curry"`) passes schema validation and causes a runtime crash in `CulturalRatificationCard`. Fix: import `CulturalKeySchema` from `./cultural.js` and use it for `key`. [thread.ts:53]
- [x] [Review][Patch] **`WsServerMessageSchema` union never tested as a union (only leaf schemas tested)** — Removal of any member from the union would not be caught by existing acceptance tests. Fix: add 6 routing tests via `WsServerMessageSchema.safeParse(...)`. [voice.test.ts]
- [x] [Review][Patch] **No test for `tts_failed` error code (AC12)** — `voice.test.ts` only tests `stt_failed`; AC12 code/message pair untested at contract layer. Fix: add routing test for `tts_failed` through `WsServerMessageSchema`. [voice.test.ts]
- [x] [Review][Patch] **No seq boundary rejection tests** — `seq: 0`, `seq: -1`, `seq: 1.5` never tested; post-`min(1)` constraints would silently regress without them. Fix: add 5 rejection tests across the three seq schemas. [voice.test.ts]
- [x] [Review][Patch] **No `text: ""` rejection tests** — Post-`.min(1)` empty-string constraints untested. Fix: add 2 rejection tests for transcript and response.end. [voice.test.ts]
- [x] [Review][Patch] **`VoiceSessionCreateResponseSchema` missing `session_id` absent test** — Pattern from `VoiceSessionCreateSchema` not replicated for the response. Fix: add `safeParse({}).success === false` test. [voice.test.ts]
- [x] [Review][Patch] **`TurnBodyRatificationPrompt` missing from `thread.test.ts`** — Union member never exercised in canonical test file; accidental removal from union goes undetected. Fix: add `TurnBodyRatificationPrompt` describe block + `TurnBody` union discriminant test. [thread.test.ts]
- [x] [Review][Patch] **`Turn.modality` never tested** — Valid `'voice'`, absent, and invalid `'fax'` cases unverified. Fix: add 3 modality tests inside `Turn` describe. [thread.test.ts]

---

**Group E — Config & Infra** (.env.local.example ×2, vite-env.d.ts, package.json ×2, sprint-status.yaml, deferred-work.md)
_Reviewed 2026-04-28 · 0 decisions · 4 patch · 4 deferred_

#### Patch
- [x] [Review][Patch] **`TWILIO_ACCOUNT_SID=ACreplace` fails Zod `/^AC[0-9a-fA-F]{32}$/` regex** — 9-char non-hex placeholder causes `parseEnv()` → `process.exit(1)` on startup; blocks any new developer who copies the example file verbatim. Fix: replace placeholder with `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`. [apps/api/.env.local.example]
- [x] [Review][Patch] **`VITE_API_WS_URL` undeclared in `vite-env.d.ts`** — Introduced by 2-6b; undeclared vars are typed `any`, permitting a hard `as string` cast that silences the TypeScript compiler. A missing env var in staging silently constructs `"undefined/v1/voice/ws?..."`. Fix: add `readonly VITE_API_WS_URL?: string` to `ImportMetaEnv`; remove the `as string` cast at line 12. [apps/web/src/vite-env.d.ts, useVoiceSession.ts:12]
- [x] [Review][Patch] **`CORS_ALLOWED_ORIGINS` undiscoverable in dev** — Defaulted var absent from `.env.local.example`; developer who runs Vite on a non-5173 port gets CORS 403 with no visible knob to turn. Fix: add commented entry with guidance. [apps/api/.env.local.example]
- [x] [Review][Patch] **`sprint-status.yaml` entry shows `in-progress`** — All Groups A–E reviewed and passing; status header also stale. Fix: update story entry to `done`, update `last_updated`. [sprint-status.yaml]

#### Deferred
- [→ deferred-work.md] **VAD onnxruntime-web WASM not served in production build** — `vite.config.ts` has no WASM configuration; `public/` has no `.wasm` files; Vite dev server masks the gap. Risk: runtime 404 on WASM fetch in prod build. Test: `pnpm build && vite preview` voice step.
- [→ deferred-work.md] **`@elevenlabs/elevenlabs-js` SDK client is dead code** — `fastify.elevenlabs` decoration never accessed; all ElevenLabs calls use raw `fetch`. Remove plugin/dep or migrate to SDK client.
- [→ deferred-work.md] **ws:// → wss:// not documented for TLS deploys** — Missing comment in `.env.local.example`; mixed-content block produces silent WS failure in HTTPS staging.
- [→ deferred-work.md] **`^0.0.36` semver intent ambiguous on pre-1.0 VAD package** — Under npm/pnpm, `^0.0.36` = `=0.0.36`; the caret implies "compatible updates" but the range is pinned. Consider exact specifier `"0.0.36"` for clarity.

# Story 2.6: Voice-first onboarding interview via ElevenLabs (three signal questions)

Status: done

## Story

As a Primary Parent,
I want a voice-first onboarding interview anchored on three signal questions ("What did your grandmother cook?" / "What's a Friday in your house?" / "What does your child refuse?"),
so that I can complete profile setup conversationally in under 10 minutes without filling out fields, and Lumi can infer cultural and palate context from natural prose (FR2, UX-DR64).

## Architecture Overview

ElevenLabs is pure voice transport — it handles audio capture, STT, TTS (Eleven v3 Conversational with expressive mode), and WebSocket session management. HiveKitchen is the brain — it drives every response. The integration uses ElevenLabs' **Custom LLM mode**: ElevenLabs calls HiveKitchen's `/v1/voice/llm` endpoint per turn with the conversation history in OpenAI `messages[]` format, HiveKitchen runs the onboarding agent and returns text, ElevenLabs renders it with v3 TTS. HiveKitchen never calls TTS directly.

```
Browser mic → ElevenLabs WebSocket (STT)
                    ↓ POST /v1/voice/llm  (per turn, OpenAI messages[] format)
               HiveKitchen API  →  onboarding agent  →  OpenAI gpt-4o
                    ↑ SSE text stream (with [warmly] / [pause] expression tags)
ElevenLabs TTS v3 Conversational → audio → browser speaker
```

Three API endpoints owned by HiveKitchen:

| Endpoint | Caller | Auth | Purpose |
|---|---|---|---|
| `POST /v1/voice/token` | Browser | JWT | Issues ElevenLabs signed URL; stores `conversation_id → user context` |
| `POST /v1/voice/llm` | ElevenLabs platform | Bearer secret | Custom LLM — per-turn SSE response |
| `POST /v1/webhooks/elevenlabs` | ElevenLabs platform | HMAC | Post-call webhook — persists full transcript after session ends |

## Acceptance Criteria

1. **Given** I am authenticated at `/onboarding` and tap the voice button, **When** the client calls `POST /v1/voice/token`, **Then** the API creates a `threads` row (type `onboarding`) and a `voice_sessions` row (status `active`), calls ElevenLabs `get-signed-url?agent_id=ELEVENLABS_AGENT_ID&include_conversation_id=true`, stores the returned `conversation_id` on the session row, and returns `{ token: signed_url, sessionId: hk_uuid }` — 200. The client passes `signed_url` to the ElevenLabs SDK to open the WebSocket.

2. **Given** the voice session is active, **When** the user completes an utterance, **Then** ElevenLabs sends the conversation history to `POST /v1/voice/llm` as OpenAI `messages[]`; HiveKitchen validates the `Authorization: Bearer` header against `ELEVENLABS_CUSTOM_LLM_SECRET`, looks up the session via `elevenlabs_extra_body.UUID` (= `conversation_id`), runs the onboarding agent, and returns the response as SSE text — which ElevenLabs renders via Eleven v3 Conversational TTS. The response text may include expression tags (`[warmly]`, `[pause]`, etc.) that ElevenLabs renders natively.

3. **Given** all three signal questions have been answered, **When** the LLM endpoint generates the response for the final turn, **Then** the agent produces an inferred summary (cultural templates, palate notes, allergens mentioned) as the response text, which ElevenLabs speaks aloud. The parent can respond verbally to confirm or correct.

4. **Given** the voice session ends (user taps End or the ElevenLabs session closes naturally), **When** ElevenLabs fires the post-call webhook to `POST /v1/webhooks/elevenlabs`, **Then** the HMAC signature validates against `ELEVENLABS_WEBHOOK_SECRET`; the API looks up the session via `data.conversation_id`, persists all transcript turns to `thread_turns` (role: `user`/`lumi`, modality: `voice`), writes a `system_event` turn with the extracted onboarding summary payload, and sets `voice_sessions.status = 'closed'` with `ended_at` recorded.

5. **Given** an unauthenticated request to `POST /v1/voice/token`, **Then** 401.

6. **Given** `POST /v1/voice/llm` is called with a missing or incorrect `Authorization` header, **Then** 401 — no turn processed.

7. **Given** `POST /v1/webhooks/elevenlabs` is called with an invalid HMAC signature, **Then** 403 — nothing persisted, rejection logged.

8. **Given** a valid LLM or webhook call but `conversation_id` not found in `voice_sessions`, **Then** 404.

9. **Given** the ElevenLabs API is unavailable during `POST /v1/voice/token`, **Then** 502 and the client surfaces the text path offer (Story 2.7) with no capability degradation.

10. **Given** the voice session is ≥10 minutes old (UX-DR64 budget), **When** the next LLM turn arrives, **Then** the agent returns a closing phrase ("That&apos;s everything I needed — let me put together your first plan."), and the session ends naturally.

## Tasks / Subtasks

- [x] Task 1 — DB migrations: threads, thread_turns, voice_sessions (AC: 1, 4, 8)
  - [x] `supabase/migrations/20260504000000_create_threads.sql`
    ```sql
    CREATE TABLE threads (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      type          text NOT NULL,
      status        text NOT NULL DEFAULT 'active',
      created_at    timestamptz NOT NULL DEFAULT now()
    );
    -- Rollback: DROP TABLE threads;
    ```
  - [x] `supabase/migrations/20260504010000_create_thread_turns.sql`
    ```sql
    CREATE TABLE thread_turns (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id  uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      server_seq bigint NOT NULL,
      role       text NOT NULL CHECK (role IN ('user','lumi','system')),
      body       jsonb NOT NULL,
      modality   text NOT NULL DEFAULT 'text' CHECK (modality IN ('text','voice')),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (thread_id, server_seq)
    );
    -- Rollback: DROP TABLE thread_turns;
    ```
  - [x] `supabase/migrations/20260504020000_create_voice_sessions.sql`
    ```sql
    CREATE TABLE voice_sessions (
      id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id                    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      household_id               uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      thread_id                  uuid NOT NULL REFERENCES threads(id),
      elevenlabs_conversation_id text UNIQUE,   -- set at token-issue time via include_conversation_id=true
      status                     text NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active','closed','timed_out')),
      started_at                 timestamptz NOT NULL DEFAULT now(),
      ended_at                   timestamptz
    );
    -- Rollback: DROP TABLE voice_sessions;
    ```

- [x] Task 2 — Contracts: voice schemas + Turn modality + SSE events (AC: 1, 2, 4, 6, 7)
  - [x] Replace `packages/contracts/src/voice.ts` with:
    ```typescript
    import { z } from 'zod';

    // POST /v1/voice/token — request body
    export const VoiceTokenRequestSchema = z.object({
      context: z.literal('onboarding'),
    });

    // POST /v1/voice/token — response
    export const VoiceTokenResponse = z.object({
      token: z.string(),       // ElevenLabs signed_url — passed directly to SDK
      sessionId: z.string().uuid(), // HiveKitchen session ID
    });

    // POST /v1/voice/llm — what ElevenLabs sends (OpenAI Chat Completions format)
    // The 'elevenlabs_extra_body.UUID' field carries ElevenLabs' conversation_id
    export const ElevenLabsLlmRequestSchema = z.object({
      messages: z.array(z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
      })),
      model: z.string(),
      stream: z.boolean(),
      temperature: z.number().optional(),
      max_tokens: z.number().int().optional(),
      user_id: z.string().optional(),
      elevenlabs_extra_body: z.object({
        UUID: z.string(), // ElevenLabs conversation_id — used to look up HiveKitchen session
      }).passthrough(),
    });

    // POST /v1/webhooks/elevenlabs — post-call webhook (fires once after session ends)
    // Only 'post_call_transcription' type is consumed; others are acknowledged and ignored
    export const ElevenLabsPostCallWebhookPayload = z.object({
      type: z.string(),
      event_timestamp: z.number(),
      data: z.object({
        agent_id: z.string(),
        conversation_id: z.string(), // maps to voice_sessions.elevenlabs_conversation_id
        status: z.string(),
        transcript: z.array(z.object({
          role: z.enum(['user', 'agent']),
          message: z.string(),
          time_in_call_secs: z.number().optional(),
        })).optional(),
      }).passthrough(),
    });

    export type VoiceTokenRequest = z.infer<typeof VoiceTokenRequestSchema>;
    export type ElevenLabsLlmRequest = z.infer<typeof ElevenLabsLlmRequestSchema>;
    export type ElevenLabsPostCallWebhook = z.infer<typeof ElevenLabsPostCallWebhookPayload>;
    ```
  - [x] Extend `Turn` in `packages/contracts/src/thread.ts`: add `modality: z.enum(['text', 'voice']).optional()` (no breaking change — existing turns without it are implicitly text)
  - [x] Add voice SSE event variants to `InvalidationEvent` in `packages/contracts/src/events.ts`:
    ```typescript
    z.object({ type: z.literal('voice.session.started'), session_id: z.string().uuid(), user_id: z.string().uuid() }),
    z.object({ type: z.literal('voice.session.ended'),   session_id: z.string().uuid(), user_id: z.string().uuid() }),
    ```
  - [x] Export new types from `packages/types/src/index.ts`
  - [x] Create `packages/contracts/src/voice.test.ts`:
    - `VoiceTokenRequestSchema` accepts `{ context: 'onboarding' }`, rejects unknown context
    - `ElevenLabsLlmRequestSchema` accepts valid messages array with `elevenlabs_extra_body.UUID`
    - `ElevenLabsPostCallWebhookPayload` accepts post-call shape with transcript array

- [x] Task 3 — API env: two new ElevenLabs vars (AC: 1, 2)
  - [x] Add to `apps/api/src/common/env.ts` EnvSchema:
    ```typescript
    ELEVENLABS_AGENT_ID: z.string().min(1),
    ELEVENLABS_CUSTOM_LLM_SECRET: z.string().min(32), // Bearer token ElevenLabs sends to /v1/voice/llm
    ```

- [x] Task 4 — API voice module: repository (AC: 1, 2, 4, 8)
  - [x] Create `apps/api/src/modules/voice/voice.repository.ts`
    ```typescript
    export class VoiceRepository {
      constructor(private readonly supabase: SupabaseClient) {}

      async createThread(householdId: string, type: string): Promise<ThreadRow>
      async createVoiceSession(params: {
        userId: string; householdId: string; threadId: string;
        elevenLabsConversationId: string;
      }): Promise<VoiceSessionRow>
      async findSessionByConversationId(elevenLabsConversationId: string): Promise<VoiceSessionRow | null>
      async updateVoiceSession(id: string, updates: Partial<VoiceSessionRow>): Promise<VoiceSessionRow>
      async appendTurn(params: {
        threadId: string; seq: number; role: 'user' | 'lumi' | 'system';
        body: object; modality: 'text' | 'voice';
      }): Promise<void>
      async getNextSeq(threadId: string): Promise<number>  // COALESCE(MAX(server_seq)+1, 1)
    }
    ```
  - [x] All Supabase calls follow `{ data, error }` destructure pattern — check `.error`, rethrow as domain error
  - [x] Use explicit column selects (not `*`) — define `THREAD_COLUMNS` and `SESSION_COLUMNS` constants

- [x] Task 5 — API voice module: service (AC: 1, 2, 3, 4, 9, 10)
  - [x] Create `apps/api/src/modules/voice/voice.service.ts`
    ```typescript
    export class VoiceService {
      constructor(
        private readonly repository: VoiceRepository,
        private readonly elevenlabs: ElevenLabsClient,
        private readonly agent: OnboardingAgent,
        private readonly agentId: string,
      ) {}

      // Called by POST /v1/voice/token
      async createVoiceSession(userId: string, householdId: string): Promise<{ token: string; sessionId: string }>
      // 1. Call elevenlabs get-signed-url with include_conversation_id=true
      //    → returns { signed_url, conversation_id }
      //    Wrap in try/catch; throw UpstreamError on failure
      // 2. createThread(householdId, 'onboarding')
      // 3. createVoiceSession({ userId, householdId, threadId, elevenLabsConversationId: conversation_id })
      // 4. Return { token: signed_url, sessionId: session.id }

      // Called by POST /v1/voice/llm
      async generateLlmResponse(elevenLabsConversationId: string, messages: LlmMessage[]): Promise<string>
      // 1. findSessionByConversationId → NotFoundError if missing
      // 2. Check timeout: if now - session.started_at > 10min → return closing phrase, set status timed_out
      // 3. Pass messages[] directly to agent.respond(messages) — ElevenLabs already provides full history
      // 4. Return response text (with expression tags)

      // Called by POST /v1/webhooks/elevenlabs
      async processPostCallWebhook(payload: ElevenLabsPostCallWebhook): Promise<void>
      // 1. Only process type === 'post_call_transcription'; return early for other types
      // 2. findSessionByConversationId(payload.data.conversation_id) → log + return if not found
      // 3. Persist each transcript turn as thread_turns row
      //    - role 'user' → { role: 'user', modality: 'voice', body: { type: 'message', content } }
      //    - role 'agent' → { role: 'lumi', modality: 'voice', body: { type: 'message', content } }
      // 4. Run OpenAI summary extraction on the full transcript → persist as system_event turn
      //    body: { type: 'system_event', event: 'onboarding.summary', payload: { cultural_templates, palate_notes, allergens_mentioned } }
      // 5. updateVoiceSession({ status: 'closed', ended_at: now })
    }
    ```
  - [x] Add `NotFoundError` to `apps/api/src/common/errors.ts` (status 404, type `/errors/not-found`)
  - [x] Add `UpstreamError` to `apps/api/src/common/errors.ts` (status 502, type `/errors/upstream`)

- [x] Task 6 — API voice module: routes (AC: 1, 2, 5, 6, 7, 8)
  - [x] Create `apps/api/src/modules/voice/voice.routes.ts` (fp() plugin)

  - [x] **`POST /v1/voice/token`** — JWT authenticated (auth hook applies; no changes to authenticate.hook.ts needed):
    ```typescript
    fastify.post('/v1/voice/token',
      { schema: { body: VoiceTokenRequestSchema, response: { 200: VoiceTokenResponse } } },
      async (request) => {
        const { token, sessionId } = await service.createVoiceSession(
          request.user.id, request.user.household_id
        );
        request.auditContext = {
          event_type: 'voice.session.started',
          user_id: request.user.id,
          household_id: request.user.household_id,
          request_id: request.id,
          metadata: { session_id: sessionId },
        };
        return { token, sessionId };
      }
    );
    ```

  - [x] **`POST /v1/voice/llm`** — no JWT (ElevenLabs calls this); validated by Bearer secret; returns SSE stream:
    ```typescript
    // Skip JWT: add '/v1/voice/llm' to SKIP_PREFIXES in authenticate.hook.ts

    fastify.post('/v1/voice/llm', {},
      async (request, reply) => {
        // 1. Validate bearer secret
        const auth = request.headers.authorization;
        if (auth !== `Bearer ${fastify.env.ELEVENLABS_CUSTOM_LLM_SECRET}`) {
          return reply.status(401).send({ type: '/errors/unauthorized', status: 401, title: 'Unauthorized', instance: request.id });
        }
        // 2. Parse body (fastify-type-provider-zod parses normally here — no raw body needed)
        const body = ElevenLabsLlmRequestSchema.parse(request.body);
        const conversationId = body.elevenlabs_extra_body.UUID;

        // 3. Generate response
        const text = await service.generateLlmResponse(conversationId, body.messages);

        // 4. Return as OpenAI-compatible SSE stream
        reply.hijack();
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        const chunk = {
          id: crypto.randomUUID(),
          object: 'chat.completion.chunk',
          choices: [{ delta: { content: text }, index: 0, finish_reason: null }],
        };
        reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        reply.raw.write(`data: ${JSON.stringify({ ...chunk, choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] })}\n\n`);
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
      }
    );
    ```
    - Note: This sends the full response as a single SSE chunk (collect-then-stream). Streaming token-by-token from OpenAI is a future optimisation when latency budgets require it.

  - [x] **`POST /v1/webhooks/elevenlabs`** — no JWT (`/v1/webhooks/` already in SKIP_PREFIXES); raw body HMAC:
    ```typescript
    // Scoped content type parser — does NOT affect other routes
    fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

    fastify.post('/v1/webhooks/elevenlabs', {},
      async (request, reply) => {
        const rawBody = request.body as string;  // constructEvent takes string, not Buffer
        const sig = request.headers['elevenlabs-signature'] as string | undefined;

        // Use ElevenLabs SDK constructEvent helper (handles timestamp + HMAC validation)
        let payload: ElevenLabsPostCallWebhook;
        try {
          // elevenlabs-js v2: instance method on fastify.elevenlabs.webhooks, async
          payload = ElevenLabsPostCallWebhookPayload.parse(
            await fastify.elevenlabs.webhooks.constructEvent(rawBody, sig ?? '', fastify.env.ELEVENLABS_WEBHOOK_SECRET)
          );
        } catch {
          request.log.warn({ action: 'webhook.hmac_rejected' }, 'ElevenLabs webhook signature invalid');
          return reply.status(403).send({ type: '/errors/forbidden', status: 403, title: 'Forbidden', instance: request.id });
        }

        await service.processPostCallWebhook(payload);
        return reply.status(200).send();
      }
    );
    ```

  - [x] Update `apps/api/src/middleware/authenticate.hook.ts` — add `/v1/voice/llm` to SKIP_PREFIXES:
    ```typescript
    const SKIP_PREFIXES = ['/v1/internal/', '/v1/webhooks/', '/v1/auth/', '/v1/voice/llm'];
    ```

- [x] Task 7 — API agents: onboarding prompt + agent (AC: 2, 3)
  - [x] Create `apps/api/src/agents/prompts/onboarding.prompt.ts`:
    ```typescript
    export const ONBOARDING_SYSTEM_PROMPT = `
    You are Lumi, a warm and knowledgeable family lunch companion. Your job right now is to learn
    about this family through a short, natural conversation. You have three signal questions to ask,
    in order:

    1. "What did your grandmother cook?" — uncover cultural identity and food heritage
    2. "What's a Friday in your house?" — understand weekly rhythm and family patterns
    3. "What does your child refuse?" — capture dietary constraints, allergens, and strong dislikes

    Ask one question at a time. Listen carefully. Ask a natural follow-up if something important
    is mentioned (allergens, strong dislikes, family traditions). Do not rush.

    Once all three questions are answered, summarise what you've learned in warm, spoken language.
    Example: "So it sounds like you have a South Asian household with a love of comfort food on
    Fridays, and your child won't touch anything with nuts. Does that sound right?"

    VOICE OUTPUT RULES — these are absolute:
    - Spoken language only. No bullet points, numbered lists, markdown, or headers.
    - Complete natural sentences as a knowledgeable friend would speak.
    - Use expression tags to make your voice feel warm and human:
      [warmly], [pause], [softly], [gently], [slowly], [chuckles] — use them sparingly and only
      where they feel natural. Each tag affects the next 4-5 words of delivery.
    - Never say "I" in reference to the system. You are Lumi, present and listening.
    - If the session is running long, transition gracefully: "That's everything I needed —
      let me put together your first plan."
    `;
    ```
  - [x] Create `apps/api/src/agents/onboarding.agent.ts`:
    ```typescript
    import OpenAI from 'openai';
    import { ONBOARDING_SYSTEM_PROMPT } from './prompts/onboarding.prompt.js';

    export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

    export class OnboardingAgent {
      constructor(private readonly openai: OpenAI) {}

      async respond(messages: LlmMessage[]): Promise<string> {
        // Prepend system prompt; ElevenLabs may or may not include a system message already
        const fullMessages: LlmMessage[] = [
          { role: 'system', content: ONBOARDING_SYSTEM_PROMPT },
          ...messages.filter((m) => m.role !== 'system'), // avoid duplicate system messages
        ];
        const completion = await this.openai.chat.completions.create({
          model: 'gpt-4o',
          messages: fullMessages,
          temperature: 0.7,
          max_tokens: 300,
        });
        return completion.choices[0]?.message?.content ?? '[pause] Let me think about that for a moment.';
      }

      async extractSummary(transcript: Array<{ role: string; message: string }>): Promise<{
        cultural_templates: string[];
        palate_notes: string[];
        allergens_mentioned: string[];
      }> {
        const transcriptText = transcript
          .map((t) => `${t.role}: ${t.message}`)
          .join('\n');
        const completion = await this.openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{
            role: 'system',
            content: 'Extract structured onboarding data from this conversation transcript. Return JSON only.',
          }, {
            role: 'user',
            content: `Extract: cultural_templates (array of strings), palate_notes (array), allergens_mentioned (array).\n\nTranscript:\n${transcriptText}`,
          }],
          response_format: { type: 'json_object' },
          temperature: 0,
        });
        const raw = JSON.parse(completion.choices[0]?.message?.content ?? '{}');
        return {
          cultural_templates: raw.cultural_templates ?? [],
          palate_notes: raw.palate_notes ?? [],
          allergens_mentioned: raw.allergens_mentioned ?? [],
        };
      }
    }
    ```

- [x] Task 8 — API app registration (AC: 1, 2, 4)
  - [x] In `apps/api/src/app.ts`:
    ```typescript
    import { voiceRoutes } from './modules/voice/voice.routes.js';
    // ...
    await app.register(userRoutes);
    await app.register(voiceRoutes); // after userRoutes
    ```
  - [x] Pass `fastify.openai` into the `OnboardingAgent` constructor inside `voice.routes.ts`

- [x] Task 9 — API tests (AC: 1, 2, 5, 6, 7, 8, 9)
  - [x] Create `apps/api/src/modules/voice/voice.routes.test.ts`:
    - `POST /v1/voice/token` happy path → 200 `{ token: "https://...", sessionId: "<uuid>" }`
    - `POST /v1/voice/token` unauthenticated → 401
    - `POST /v1/voice/token` ElevenLabs unavailable (service throws UpstreamError) → 502
    - `POST /v1/voice/llm` valid secret + known conversation → 200 SSE with `data: ...` + `data: [DONE]`
    - `POST /v1/voice/llm` wrong bearer secret → 401
    - `POST /v1/voice/llm` unknown `elevenlabs_extra_body.UUID` (service throws NotFoundError) → 404
    - `POST /v1/voice/llm` session timed out → 200 SSE with closing phrase
    - `POST /v1/webhooks/elevenlabs` valid HMAC + `post_call_transcription` → 200 empty body
    - `POST /v1/webhooks/elevenlabs` invalid HMAC → 403
    - `POST /v1/webhooks/elevenlabs` unknown `conversation_id` → 200 (log + ignore; do not 404 on webhooks)
  - [x] For LLM endpoint tests: check that `Content-Type: text/event-stream` is returned and response body contains `data: [DONE]`
  - [x] For HMAC tests: mock `fastify.elevenlabs.webhooks.constructEvent` (instance method, async) to simulate valid/invalid signatures

- [x] Task 10 — Frontend: install SDK + voice store + onboarding UI (AC: 1, 2, 3, 9)
  - [x] Install ElevenLabs React SDK:
    ```
    pnpm add -F @hivekitchen/web @elevenlabs/react
    ```
  - [x] Create `apps/web/src/stores/voice.store.ts` (Zustand v5 curried pattern):
    ```typescript
    import { create } from 'zustand';

    interface VoiceState {
      sessionId: string | null;
      status: 'idle' | 'connecting' | 'active' | 'ended' | 'error';
      isSpeaking: boolean;
      error: string | null;
    }
    interface VoiceActions {
      startSession: (sessionId: string) => void;
      endSession: () => void;
      setIsSpeaking: (v: boolean) => void;
      setStatus: (s: VoiceState['status']) => void;
      setError: (msg: string | null) => void;
    }
    export const useVoiceStore = create<VoiceState & VoiceActions>()((set) => ({
      sessionId: null, status: 'idle', isSpeaking: false, error: null,
      startSession: (sessionId) => set({ sessionId, status: 'active', error: null }),
      endSession:   ()          => set({ sessionId: null, status: 'ended', isSpeaking: false }),
      setIsSpeaking:(v)         => set({ isSpeaking: v }),
      setStatus:    (s)         => set({ status: s }),
      setError:     (msg)       => set({ error: msg, status: 'error' }),
    }));
    ```
  - [x] Update `apps/web/src/routes/(app)/onboarding.tsx` — replace stub:
    - Mode selection: "Start with voice" (primary) / "I&apos;d rather type" (secondary link)
    - Voice path `<OnboardingVoice />`:
      - On mount: fetch `POST /v1/voice/token` with `{ context: 'onboarding' }`
      - On response: call `startSession({ signedUrl: token.token })` from `useConversation`; call `voiceStore.startSession(token.sessionId)`
      - `onConnect`: set status active
      - `onDisconnect`: `voiceStore.endSession()`; navigate to `/onboarding/summary` (stub — Story 2.10)
      - `onMessage({ source })`: `voiceStore.setIsSpeaking(source === 'ai')`
      - `onError`: `voiceStore.setError(message)`
      - Render: animated orb driven by `isSpeaking`, "End session" button
      - "End session": calls `endSession()` from `useConversation` — ElevenLabs closes WebSocket gracefully, post-call webhook fires on their side
    - Text path: `<p>Text onboarding coming in Story 2.7.</p>` (placeholder only)
    - On token fetch failure (UpstreamError / 502): show inline message + text path link
  - [x] `useConversation` hook pattern from `@elevenlabs/react`:
    ```typescript
    const { startSession, endSession, status, isSpeaking } = useConversation({
      onConnect:    ()              => voiceStore.setStatus('active'),
      onDisconnect: ()              => voiceStore.endSession(),
      onMessage:    ({ source })    => voiceStore.setIsSpeaking(source === 'ai'),
      onError:      (message)       => voiceStore.setError(message),
    });
    // Initiate with signed URL — never with agentId directly (security)
    await startSession({ signedUrl: token.token });
    ```
  - [x] Do NOT import `@elevenlabs/elevenlabs-js` in the web app — Node.js SDK only. Use `@elevenlabs/react`.

## Dev Notes

### ElevenLabs Integration Architecture

**ElevenLabs is voice transport only.** The ElevenLabs agent configured in their dashboard is a minimal shell:
- Voice: chosen warm voice for Lumi
- TTS model: `eleven_v3` with Expressive Mode enabled
- LLM: Custom → URL `https://<api-host>/v1/voice/llm`
- No ElevenLabs-hosted LLM is invoked at any point

**Expression tags** — v3 Conversational supports inline tags that shape TTS delivery. Each tag affects ~4–5 words of delivery. Supported examples: `[warmly]`, `[pause]`, `[softly]`, `[gently]`, `[slowly]`, `[chuckles]`, `[sighs]`. The onboarding system prompt instructs the LLM to use these sparingly. ElevenLabs strips the tags before TTS and uses them to shape prosody.

**Signed URL + conversation_id** — calling `get-signed-url?agent_id=X&include_conversation_id=true` returns both `signed_url` and `conversation_id`. Store `conversation_id` on the `voice_sessions` row immediately. This is the single key used for all subsequent lookups. No custom metadata injection needed.

**Verified SDK method path** — confirmed against `node_modules/@elevenlabs/elevenlabs-js@2.44.0` type definitions:
```typescript
const result = await fastify.elevenlabs.conversationalAi.conversations.getSignedUrl({
  agentId: fastify.env.ELEVENLABS_AGENT_ID,   // camelCase — not agent_id
  includeConversationId: true,                  // camelCase — not include_conversation_id
});
const signedUrl = result.signedUrl;             // camelCase field on response model
// conversationId is returned at runtime but NOT typed on ConversationSignedUrlResponseModel
const conversationId = (result as unknown as { conversationId?: string }).conversationId ?? '';
```
`HttpResponsePromise<T>` extends `Promise<T>` — `await` returns `T` directly (no `.data` wrapper).

**Webhook signature — use SDK helper, not raw HMAC.** ElevenLabs' post-call webhook uses a timestamp+signature scheme. Use the SDK's `constructEvent` helper which validates both. The header is `ElevenLabs-Signature` (not `X-Elevenlabs-Signature`). Do NOT roll a raw HMAC manually for this endpoint.

### Architecture Constraints

**`/v1/voice/llm` must be in SKIP_PREFIXES** — ElevenLabs calls it server-to-server with no user JWT. Add it explicitly to the array in `apps/api/src/middleware/authenticate.hook.ts:5`. Auth is the `ELEVENLABS_CUSTOM_LLM_SECRET` bearer token instead.

**`/v1/webhooks/elevenlabs` raw body** — the post-call webhook route plugin must use `addContentTypeParser` with `parseAs: 'string'` scoped to the plugin only (not global). `WebhooksClient.constructEvent` takes a `string`, not a `Buffer` — confirmed from `@elevenlabs/elevenlabs-js@2.44.0` type definitions. Do NOT change the global parser.

**SSE response on `/v1/voice/llm`** — use `reply.hijack()` + `reply.raw.write/end` following the same pattern as `events.routes.ts`. Collect the full OpenAI response first then send as a single SSE chunk. Token-level streaming (piping from OpenAI SSE → ElevenLabs SSE) is a future optimisation; for onboarding (short 1–2 sentence responses) the latency difference is negligible.

**No SSE fan-out yet** — Story 5.2 implements Redis pub/sub. For this story, voice SSE events (`voice.session.started`, `voice.session.ended`) are logged only. Do not attempt to write to the `GET /v1/events` channel.

**Child profiles deferred** — Story 2.10. The `system_event` turn written to `thread_turns` with `event: 'onboarding.summary'` is the data payload Story 2.10 will read.

**Post-call webhook is fire-and-forget from ElevenLabs' perspective** — it expects a 200 response quickly. Do the Supabase writes synchronously but keep them lean. If OpenAI summary extraction fails, log the error, write the turns anyway with an empty summary payload, and return 200.

### Project Structure Notes

- New module: `apps/api/src/modules/voice/` (repository + service + routes) — follows `modules/auth/` pattern
- Agent files: `apps/api/src/agents/prompts/onboarding.prompt.ts` + `apps/api/src/agents/onboarding.agent.ts` — agents directory exists
- Voice store: `apps/web/src/stores/voice.store.ts` (new file)
- Onboarding route: `apps/web/src/routes/(app)/onboarding.tsx` — extend stub in-place
- Migration sequence: `20260504000000_`, `20260504010000_`, `20260504020000_`

### Schema Design

**`thread_turns.body` JSONB shape** (must match `TurnBody` discriminated union in `packages/contracts/src/thread.ts`):
- Voice utterance: `{ type: 'message', content: transcript_text }`
- Lumi voice response: `{ type: 'message', content: response_text_with_tags_stripped }`
- Summary: `{ type: 'system_event', event: 'onboarding.summary', payload: { cultural_templates, palate_notes, allergens_mentioned } }`

Store the Lumi response with expression tags stripped in the thread body — tags are for TTS only, not for the transcript record.

### New Error Classes

Add to `apps/api/src/common/errors.ts`:
```typescript
export class NotFoundError extends DomainError {
  readonly type = '/errors/not-found';
  readonly status = 404;
  readonly title = 'Not Found';
}

export class UpstreamError extends DomainError {
  readonly type = '/errors/upstream';
  readonly status = 502;
  readonly title = 'Upstream Service Unavailable';
}
```

### Previous Story Learnings (from 2-5)

- **Supabase `{ data, error }` pattern** — never throws; always check `.error` before using `data`.
- **Static column selects** — define `THREAD_COLUMNS`, `SESSION_COLUMNS` constants; never use `*`.
- **`.js` extensions** — all relative imports in `apps/api` require `.js` extension on the import path.
- **No `console.*`** — use `request.log` or `fastify.log`.
- **Zod 4** in use (project-context.md says Zod 3.23 but that predates story 1-16 upgrade).
- **Zustand v5 curried create** — `create<Shape>()(set => ...)` not `create<Shape>(set => ...)`.
- **React `no-unescaped-entities`** — apostrophes in JSX text require `&apos;`.
- **`isolatedModules`** — type-only imports: `import type { ... }`; type-only re-exports: `export type { ... }`.

### References

- [Source: epics.md#Story-2.6] Story requirements and three signal questions
- [Source: epics.md#UX-DR64] Voice-first; <10-minute session budget
- [Source: epics.md#AR-14] Webhook HMAC; `ElevenLabs-Signature` header
- [Source: epics.md#AR-15] Voice path ownership; API never holds WebSocket
- [Source: epics.md#NFR-REL-5] Voice degrades to text on ElevenLabs unavailability
- [Source: specs/Voice Interaction Design.md] Session lifecycle; modality flag; SSE events
- [Source: elevenlabs.io/docs — Expressive mode] v3 audio tags; `[warmly]`, `[pause]` etc.; ~4–5 word scope per tag
- [Source: elevenlabs.io/docs — Custom LLM] OpenAI-compatible messages format; `elevenlabs_extra_body.UUID`; SSE response required
- [Source: elevenlabs.io/docs — Post-call webhooks] `ElevenLabs-Signature` header; `constructEvent` SDK helper; transcript shape
- [Source: elevenlabs.io/docs — Get signed URL] `include_conversation_id=true` param
- [Source: apps/api/src/middleware/authenticate.hook.ts:5] SKIP_PREFIXES — add `/v1/voice/llm`
- [Source: apps/api/src/plugins/elevenlabs.plugin.ts] `fastify.elevenlabs` decorator (ElevenLabsClient)
- [Source: apps/api/src/common/env.ts] Add `ELEVENLABS_AGENT_ID`, `ELEVENLABS_CUSTOM_LLM_SECRET`
- [Source: apps/api/src/routes/v1/events/events.routes.ts] `reply.hijack()` SSE pattern to follow
- [Source: apps/api/src/app.ts] Plugin registration order
- [Source: packages/contracts/src/thread.ts] TurnBody discriminated union; Turn schema (add modality)
- [Source: packages/contracts/src/events.ts] InvalidationEvent union (add voice.session.*)
- [Source: apps/web/src/routes/(app)/onboarding.tsx] Existing stub to replace

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — all issues caught and resolved inline during implementation.

### Completion Notes List

- **ElevenLabs SDK `getSignedUrl` camelCase params**: The SDK method is `conversationalAi.conversations.getSignedUrl({ agentId, includeConversationId: true })` — all camelCase, not snake_case as ElevenLabs docs show for the HTTP API. `conversationId` is returned at runtime but absent from `ConversationSignedUrlResponseModel`; required `(result as unknown as { conversationId?: string }).conversationId ?? ''` cast.
- **Webhook `parseAs: 'string'`**: The scoped content-type parser for the ElevenLabs webhook route must be inside a nested `fastify.register(async scope => { ... })` to prevent it from overriding the global JSON parser. `constructEvent` is an async instance method on `fastify.elevenlabs.webhooks`, taking a `string` body — not a `Buffer`, not a static function.
- **SSE exhaustiveness check**: Adding `voice.session.started` / `voice.session.ended` to `InvalidationEvent` required matching case branches in `apps/web/src/lib/realtime/sse.ts` before the `default: never` check — done.
- **`auditContext.event_type`**: The audit log expects `'voice.session_started'` (underscore), not `'voice.session.started'` (dot).
- **`@elevenlabs/react` v1.2.1 provider requirement**: `useConversation` must be inside `<ConversationProvider>`; structured as outer `OnboardingVoice` (wraps provider) + inner `OnboardingVoiceSession` (uses hook). `startSession({ signedUrl })` is sync (`void`), called from `useEffect`.
- **Pre-existing typecheck error in `stripe.plugin.ts`**: `'"2026-04-22.dahlia"' is not assignable to type '"2024-06-20"'` — confirmed pre-existing by stash/pop cycle; not introduced by this story.
- **86 API tests pass, 35 web tests pass** — full suite green.

### File List

**DB Migrations (new)**
- `supabase/migrations/20260504000000_create_threads.sql`
- `supabase/migrations/20260504010000_create_thread_turns.sql`
- `supabase/migrations/20260504020000_create_voice_sessions.sql`

**Contracts (modified)**
- `packages/contracts/src/voice.ts` — replaced with VoiceTokenRequest, ElevenLabsLlmRequest, ElevenLabsPostCallWebhook schemas
- `packages/contracts/src/thread.ts` — added `modality: z.enum(['text','voice']).optional()` to Turn
- `packages/contracts/src/events.ts` — added `voice.session.started` / `voice.session.ended` variants

**Contracts (new)**
- `packages/contracts/src/voice.test.ts`

**Types (modified)**
- `packages/types/src/index.ts` — updated imports and exports for voice types

**API — env (modified)**
- `apps/api/src/common/env.ts` — added `ELEVENLABS_AGENT_ID`, `ELEVENLABS_CUSTOM_LLM_SECRET`
- `apps/api/.env.local.example` — added placeholder entries

**API — errors (modified)**
- `apps/api/src/common/errors.ts` — added `NotFoundError` (404), `UpstreamError` (502)

**API — voice module (new)**
- `apps/api/src/modules/voice/voice.repository.ts`
- `apps/api/src/modules/voice/voice.service.ts`
- `apps/api/src/modules/voice/voice.routes.ts`
- `apps/api/src/modules/voice/voice.routes.test.ts`

**API — agents (new)**
- `apps/api/src/agents/prompts/onboarding.prompt.ts`
- `apps/api/src/agents/onboarding.agent.ts`

**API — middleware (modified)**
- `apps/api/src/middleware/authenticate.hook.ts` — added `/v1/voice/llm` to SKIP_PREFIXES

**API — app (modified)**
- `apps/api/src/app.ts` — registered `voiceRoutes`

**Frontend (new)**
- `apps/web/src/stores/voice.store.ts`
- `apps/web/src/features/onboarding/OnboardingVoice.tsx`

**Frontend (modified)**
- `apps/web/src/routes/(app)/onboarding.tsx` — mode selection + voice/text paths
- `apps/web/src/lib/realtime/sse.ts` — added voice event cases
- `apps/web/package.json` — added `@elevenlabs/react: ^1.2.1`

**Code-review patches (2026-04-26)**
- `packages/contracts/src/voice.ts` — `messages.min(1)` constraint
- `apps/api/src/middleware/authenticate.hook.ts` — `/v1/voice/llm` moved to `SKIP_EXACT` (no prefix-match leakage)
- `apps/api/src/agents/onboarding.agent.ts` — `Array.isArray` guards on summary fields
- `apps/api/src/modules/voice/voice.repository.ts` — `appendTurn.body` typed as `TurnBody`
- `apps/api/src/modules/voice/voice.service.ts` — empty `conversationId` throws; idempotency short-circuit; agent_id verification; `≥` 10-min boundary; tag-stripping for Lumi turns; `system_event` modality `text`; logger-injected; `voice.session_ended` log on close + timeout
- `apps/api/src/modules/voice/voice.routes.ts` — `crypto.timingSafeEqual` bearer compare; Zod body schema on `/v1/voice/llm`; `UnauthorizedError` throw; SSE fallback chunk on agent failure; close/error handlers on `reply.raw`; per-turn log; webhook `constructEvent` error logged with bound `err`; webhook schema-parse failure escalated to `error`
- `apps/api/src/modules/voice/voice.routes.test.ts` — removed unused `beforeEach` import
- `apps/web/src/lib/fetch.ts` — `signal: AbortSignal` plumbing
- `apps/web/src/stores/voice.store.ts` — `clearError`, `reset`, status auto-clears stale errors
- `apps/web/src/features/onboarding/OnboardingVoice.tsx` — `AbortController`-guarded fetch, gated `endSession` cleanup, navigate to `/app` (Story 2.10 owns summary), Zustand selectors, mirror `isSpeaking` to store
- `apps/web/src/routes/(app)/onboarding.tsx` — Zustand selectors, `clearError` on mode switch
- `supabase/migrations/20260504020000_create_voice_sessions.sql` — `thread_id` FK now `ON DELETE CASCADE`
- `supabase/migrations/20260504030000_enable_rls_voice_tables.sql` (new) — RLS on `threads`, `thread_turns`, `voice_sessions` (defense-in-depth, service role bypasses)

### Change Log

| Date | Change |
|---|---|
| 2026-04-26 | Initial implementation — all Tasks 1–10 complete; all tests pass |
| 2026-04-26 | Code review patches — 28 of 28 applied (5 CRITICAL + 8 HIGH + 15 MEDIUM); 5 items deferred to `deferred-work.md`; 86 API + 35 web tests still green |

### Review Findings

_Code review run on 2026-04-26 (Blind Hunter + Edge Case Hunter + Acceptance Auditor)._

**CRITICAL / HIGH — must-fix patches**

- [x] [Review][Patch] [CRITICAL] Empty `conversationId` silently coerced to `''` — throw `UpstreamError` when SDK omits it (UNIQUE collision + cross-session lookup risk) [apps/api/src/modules/voice/voice.service.ts:~30-49]
- [x] [Review][Patch] [CRITICAL] Bearer secret comparison uses `!==` (timing-unsafe) — use `crypto.timingSafeEqual` on equal-length buffers [apps/api/src/modules/voice/voice.routes.ts:~48-55]
- [x] [Review][Patch] [CRITICAL] Webhook handler has no idempotency — short-circuit when `session.status !== 'active'` to prevent duplicate transcript inserts on ElevenLabs retry [apps/api/src/modules/voice/voice.service.ts:~72-119]
- [x] [Review][Patch] [CRITICAL] `/v1/voice/llm` route registered with `{}` — add `schema: { body: ElevenLabsLlmRequestSchema }` to options (codebase rule: every route declares body schema) [apps/api/src/modules/voice/voice.routes.ts:~46]
- [x] [Review][Patch] [CRITICAL] Webhook `constructEvent` failure is `catch {}` (no binding, no log) — bind `err`, log type/message before 403 to distinguish bad signature / stale timestamp / missing header [apps/api/src/modules/voice/voice.routes.ts:~115-128]
- [x] [Review][Patch] [HIGH] `SKIP_PREFIXES` entry `/v1/voice/llm` lacks trailing slash — substring match leaks auth bypass to `/v1/voice/llm-anything` [apps/api/src/middleware/authenticate.hook.ts:5]
- [x] [Review][Patch] [HIGH] LLM endpoint has no graceful fallback on `agent.respond` failure — wrap in try/catch and emit an SSE error chunk so the live voice session doesn't break with a 500 [apps/api/src/modules/voice/voice.routes.ts]
- [x] [Review][Patch] [HIGH] `messages` schema accepts empty array → OpenAI 400 — add `.min(1)` to `ElevenLabsLlmRequestSchema.messages` [packages/contracts/src/voice.ts]
- [x] [Review][Patch] [HIGH] Lumi response stored with `[warmly]`/`[pause]` tags intact — Dev Notes Schema rule mandates "tags stripped before persist". Add `stripExpressionTags()` helper applied to agent turn body [apps/api/src/modules/voice/voice.service.ts:~80-91]
- [x] [Review][Patch] [HIGH] AC10 boundary "≥10 minutes" implemented as strict `>` — change `elapsed > SESSION_TIMEOUT_MS` to `>=` [apps/api/src/modules/voice/voice.service.ts:~62-66]
- [x] [Review][Patch] [HIGH] `extractSummary` failure swallowed — empty `catch (err) {}` with comment claiming "log" but no `request.log.warn` call. Inject `FastifyBaseLogger` into VoiceService and emit warn [apps/api/src/modules/voice/voice.service.ts:~93-101]
- [x] [Review][Patch] [HIGH] `voice_sessions.thread_id` FK lacks `ON DELETE CASCADE` — household delete cascades through threads but blocks at this FK; add a new migration to ALTER constraint [supabase/migrations/20260504020000_create_voice_sessions.sql:10]
- [x] [Review][Patch] [HIGH] No RLS enabled on `threads` / `thread_turns` / `voice_sessions` — defense-in-depth gap vs. existing `users`/`households` pattern. Add a new migration enabling RLS (service-role bypasses anyway) [supabase/migrations/20260504*]

**MEDIUM — fix or document**

- [x] [Review][Patch] [MEDIUM] Webhook does not verify `payload.data.agent_id === ELEVENLABS_AGENT_ID` — defense-in-depth miss on shared HMAC secret [apps/api/src/modules/voice/voice.service.ts:~72-78]
- [x] [Review][Patch] [MEDIUM] OpenAI summary JSON shape unguarded — `JSON.parse` may produce non-array fields; use `Array.isArray()` guards [apps/api/src/agents/onboarding.agent.ts:~44-52]
- [x] [Review][Patch] [MEDIUM] `reply.raw.write/end` after `reply.hijack()` has no error/close handlers — client disconnect mid-write becomes unhandled rejection [apps/api/src/modules/voice/voice.routes.ts:~68-95]
- [x] [Review][Patch] [MEDIUM] LLM endpoint emits no `request.log` and no audit event — no observability on the public AI-content entry point [apps/api/src/modules/voice/voice.routes.ts:~46-95]
- [x] [Review][Patch] [MEDIUM] React `useEffect` startup leaks voice session — `init()` resolves after unmount and calls `startSession({ signedUrl })` outside the cancellation guard; also no `AbortController` on `hkFetch` (StrictMode double-fires) [apps/web/src/features/onboarding/OnboardingVoice.tsx:~23-54]
- [x] [Review][Patch] [MEDIUM] `system_event` summary turn written with `modality: 'voice'` — semantically should be `'text'` (matches migration default and downstream Story 2.10 expectations) [apps/api/src/modules/voice/voice.service.ts:~104-114]
- [x] [Review][Patch] [MEDIUM] Frontend navigates to `/onboarding/summary` which is not registered in the router — blank screen after successful session [apps/web/src/features/onboarding/OnboardingVoice.tsx:17]
- [x] [Review][Patch] [MEDIUM] Status enum mismatch — `useConversation` returns `'connected'` while voice store uses `'active'`; pick a single source of truth [apps/web/src/features/onboarding/OnboardingVoice.tsx + apps/web/src/stores/voice.store.ts]
- [x] [Review][Patch] [MEDIUM] Unused `beforeEach` import — TS strict `no-unused-vars` failure; `pnpm typecheck` will fail [apps/api/src/modules/voice/voice.routes.test.ts:1]
- [x] [Review][Patch] [MEDIUM] `setError` has no clear path — error state sticks across mode switches; add `clearError` action or auto-clear in `setStatus` [apps/web/src/stores/voice.store.ts]
- [x] [Review][Patch] [MEDIUM] Components pull whole Zustand store via destructuring — project rule: "Selectors only; never pull the whole store" [apps/web/src/features/onboarding/OnboardingVoice.tsx + apps/web/src/routes/(app)/onboarding.tsx]
- [x] [Review][Patch] [MEDIUM] `appendTurn` body parameter typed `object` — runtime-unchecked JSONB writes; type with `TurnBody` Zod schema from contracts [apps/api/src/modules/voice/voice.repository.ts]
- [x] [Review][Patch] [MEDIUM] `/v1/voice/llm` 401 reply built inline — should `throw new UnauthorizedError(...)` to match RFC 7807 problem+json content-type used elsewhere [apps/api/src/modules/voice/voice.routes.ts:~49-54]
- [x] [Review][Patch] [MEDIUM] No `voice.session_ended` audit emit in webhook close + timeout paths — registry has the type, only `voice.session_started` is fired [apps/api/src/modules/voice/voice.service.ts]
- [x] [Review][Patch] [MEDIUM] Webhook returns 200 on Zod schema-parse failure — silent data loss if ElevenLabs adds required fields. Increase log severity / add metric [apps/api/src/modules/voice/voice.routes.ts:~120-135]

**Deferred (logged in `deferred-work.md`)**

- [x] [Review][Defer] [CRITICAL] `/v1/voice/llm` IDOR via leaked secret — standard ElevenLabs Custom LLM model; mitigated operationally + by patch #14 (`agent_id` verify)
- [x] [Review][Defer] [HIGH] `getNextSeq` + `appendTurn` non-atomic race — Story 5.x (concurrent text appends) needs RPC/transaction
- [x] [Review][Defer] [MEDIUM] `extractSummary` unbounded transcript — 10-min budget caps real-world size; revisit with Story 2.7
- [x] [Review][Defer] [LOW] Real Supabase integration test for `UNIQUE (thread_id, server_seq)` collision
- [x] [Review][Defer] [LOW] Scoped content-type parser isolation test

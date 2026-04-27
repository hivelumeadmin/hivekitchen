# Story 2.7: Text-equivalent onboarding path

Status: review

## Story

As a Primary Parent who declines voice,
I want a text-based conversational onboarding with equivalent outcome to the voice interview,
so that I get identical product capabilities and tier access whether I used voice or text (FR3, FR4).

## Architecture Overview

Story 2.6 stood up the conversational onboarding stack — `OnboardingAgent` (gpt-4o), `onboarding.prompt.ts` (the three signal questions), `threads` / `thread_turns` schema, and an `OnboardingVoice` mode-selector front end. **Story 2.7 reuses every piece of that stack except the ElevenLabs voice transport.** Text-mode swaps the WebSocket+TTS edge for a plain JSON request/response: parent types → API persists the user turn → `OnboardingAgent.respond()` runs → API persists the Lumi turn → response returns the reply. Same agent, same three questions, same summary extraction, same `system_event` turn that downstream stories (2.10 child profile, 2.11 cultural inference) read.

```
Browser textarea → POST /v1/onboarding/text/turn  →  HiveKitchen API
                          ↓                                ↓
                     thread_turns (modality='text')   OnboardingAgent → OpenAI gpt-4o
                          ↑                                ↓
                     reply JSON  ←  thread_turns (modality='text', role='lumi')
```

Two new HTTP endpoints (both JWT-auth, body validated by Zod):

| Endpoint | Purpose |
|---|---|
| `POST /v1/onboarding/text/turn` | One conversational turn — persists user message, runs agent, persists reply, returns Lumi's text |
| `POST /v1/onboarding/text/finalize` | Closes the onboarding thread — extracts summary, writes `system_event` turn, marks thread `closed` |

A small refactor splits the thread/turn primitives out of `voice.repository.ts` into a new `thread.repository.ts` so both modules share one source of truth without one feature owning the other's namespace.

## Acceptance Criteria

1. **Given** I am authenticated at `/onboarding` and tap "I'd rather type", **When** the client posts the first turn to `POST /v1/onboarding/text/turn` with `{ message: <my opening text> }`, **Then** the API creates a `threads` row (`type='onboarding'`, `status='active'`), appends both my user turn and Lumi's reply to `thread_turns` with `modality='text'`, and returns `200 { thread_id, turn_id, lumi_response, lumi_turn_id, is_complete: false }`. Subsequent calls reuse the existing active onboarding thread for the household.

2. **Given** my active text onboarding thread exists, **When** I submit a follow-up turn, **Then** the API loads the full turn history from `thread_turns` (ordered by `server_seq`), passes it to `OnboardingAgent.respond(history, { modality: 'text' })`, persists my turn (then) and Lumi's reply (then), and returns the reply text. The agent runs the same `onboarding.prompt.ts` core logic but with the text-mode output style (no `[warmly]` expression tags, plain conversational prose).

3. **Given** all three signal questions have been answered and the agent has produced the inferred-summary confirmation turn, **When** I post a turn that confirms the summary (the agent decides this from context), **Then** the response includes `is_complete: true` and the client offers a "Finish onboarding" affordance that calls `POST /v1/onboarding/text/finalize`.

4. **Given** I post `POST /v1/onboarding/text/finalize`, **Then** the API runs `OnboardingAgent.extractSummary` on the full transcript, appends a `system_event` turn with body `{ type: 'system_event', event: 'onboarding.summary', payload: { cultural_templates, palate_notes, allergens_mentioned } }` (modality `'text'`), sets `threads.status = 'closed'`, and returns `200 { summary }`. This is the same `system_event` shape Story 2.6 writes via the post-call webhook — Story 2.10's profile reader does not care which modality produced it.

5. **Given** an unauthenticated request to either endpoint, **Then** 401.

6. **Given** an authenticated request to `POST /v1/onboarding/text/turn` with `message` empty/whitespace or longer than 4,000 characters, **Then** 400 with a Zod validation error — protects token budget and the agent contract.

7. **Given** the agent call fails (OpenAI 500, network error), **Then** the API returns 502 with `type: '/errors/upstream'` and persists the user turn but **not** a placeholder Lumi turn (the client retries the same content). This avoids "ghost" Lumi turns in the transcript.

8. **Given** I post `POST /v1/onboarding/text/finalize` while the thread has zero turns OR the agent has not yet produced a summary turn, **Then** 409 `'/errors/conflict'` — finalize is only valid after the conversation has run its course.

9. **Given** a household already has a `closed` onboarding thread with a persisted `onboarding.summary` system_event, **When** I post `POST /v1/onboarding/text/turn`, **Then** the API returns 409 `'/errors/conflict'` with detail `"onboarding already complete"`. Re-onboarding is out of scope for this story (Story 7.4 Reset Flavor Journey owns it).

10. **Given** the parent declines voice (chooses text mode at the selector), **Then** there is **no degradation** — the same `OnboardingAgent`, the same three signal questions, the same summary extraction, and the same downstream contract for Story 2.10 child-profile and Story 2.11 cultural inference. Voice can be enabled later via account preferences (out of scope here — Story 2.10 onwards) without any re-onboarding.

## Tasks / Subtasks

- [x] Task 1 — Refactor: extract thread/turn primitives into shared repository (AC: 1, 2, 4)
  - [x] Create `apps/api/src/modules/threads/thread.repository.ts`
    - Move from `voice.repository.ts`: `ThreadRow` interface, `THREAD_COLUMNS`, `createThread`, `appendTurn`, `getNextSeq`
    - Add `findActiveThreadByHousehold(householdId: string, type: string): Promise<ThreadRow | null>` — returns the most recent `status='active'` thread of the given type
    - Add `findThreadById(threadId: string): Promise<ThreadRow | null>`
    - Add `closeThread(threadId: string): Promise<void>` — `UPDATE threads SET status='closed' WHERE id=$1`
    - Add `listTurns(threadId: string): Promise<TurnRow[]>` — `SELECT * FROM thread_turns WHERE thread_id=$1 ORDER BY server_seq ASC`
  - [x] Update `voice.repository.ts` to compose / delegate to `ThreadRepository` for the shared methods (or re-export the types). Keep voice-specific methods (`createVoiceSession`, `findSessionByConversationId`, `updateVoiceSession`) in place.
  - [x] Update `voice.service.ts` and `voice.routes.ts` imports; tests stay green (no behaviour change).

- [x] Task 2 — Contracts: text-onboarding schemas (AC: 1, 2, 3, 4)
  - [x] Create `packages/contracts/src/onboarding.ts`:
    ```typescript
    import { z } from 'zod';

    export const TextOnboardingTurnRequestSchema = z.object({
      message: z.string().trim().min(1).max(4000),
    });

    export const TextOnboardingTurnResponseSchema = z.object({
      thread_id: z.string().uuid(),
      turn_id: z.string().uuid(),       // the user-turn id
      lumi_turn_id: z.string().uuid(),
      lumi_response: z.string(),
      is_complete: z.boolean(),
    });

    export const TextOnboardingFinalizeResponseSchema = z.object({
      thread_id: z.string().uuid(),
      summary: z.object({
        cultural_templates: z.array(z.string()),
        palate_notes: z.array(z.string()),
        allergens_mentioned: z.array(z.string()),
      }),
    });
    ```
  - [x] Re-export inferred types from `packages/types/src/index.ts`: `TextOnboardingTurnRequest`, `TextOnboardingTurnResponse`, `TextOnboardingFinalizeResponse`.
  - [x] Add `packages/contracts/src/onboarding.test.ts` — round-trip tests for the three schemas (valid/invalid edges, message length cap, message trim).

- [x] Task 3 — Agent: prompt split + modality parameter (AC: 2, 3)
  - [x] Update `apps/api/src/agents/prompts/onboarding.prompt.ts`:
    ```typescript
    const ONBOARDING_CORE = `
    You are Lumi, a warm and knowledgeable family lunch companion. Your job right now is to learn
    about this family through a short, natural conversation. You have three signal questions to ask,
    in order:

    1. "What did your grandmother cook?" — uncover cultural identity and food heritage
    2. "What's a Friday in your house?" — understand weekly rhythm and family patterns
    3. "What does your child refuse?" — capture dietary constraints, allergens, and strong dislikes

    Ask one question at a time. Listen carefully. Ask a natural follow-up if something important
    is mentioned (allergens, strong dislikes, family traditions). Do not rush.

    After all three questions are answered, summarise what you've learned in warm language.
    Example: "So it sounds like you have a South Asian household with a love of comfort food on
    Fridays, and your child won't touch anything with nuts. Does that sound right?"

    Once the parent has confirmed or corrected the summary, transition gracefully: "That's
    everything I needed — let me put together your first plan."
    `;

    const VOICE_RULES = `
    VOICE OUTPUT RULES — these are absolute:
    - Spoken language only. No bullet points, numbered lists, markdown, or headers.
    - Complete natural sentences as a knowledgeable friend would speak.
    - Use expression tags to make your voice feel warm and human:
      [warmly], [pause], [softly], [gently], [slowly], [chuckles] — use them sparingly and only
      where they feel natural. Each tag affects the next 4-5 words of delivery.
    - Never say "I" in reference to the system. You are Lumi, present and listening.
    `;

    const TEXT_RULES = `
    TEXT OUTPUT RULES — these are absolute:
    - Plain conversational prose. No expression tags ([warmly], [pause], etc.) — they only render in voice.
    - No markdown headings, no bullet lists. A single short paragraph per turn is ideal.
    - You may use a single em-dash or ellipsis for warmth. Avoid emoji.
    - Never say "I" in reference to the system. You are Lumi, present and listening.
    `;

    export type OnboardingModality = 'voice' | 'text';

    export function getOnboardingSystemPrompt(modality: OnboardingModality): string {
      const rules = modality === 'voice' ? VOICE_RULES : TEXT_RULES;
      return `${ONBOARDING_CORE}\n${rules}`;
    }

    // Back-compat re-export for Story 2.6 voice consumers — defaults to voice.
    export const ONBOARDING_SYSTEM_PROMPT = getOnboardingSystemPrompt('voice');
    ```
  - [x] Update `apps/api/src/agents/onboarding.agent.ts`:
    - `respond(messages: LlmMessage[], opts?: { modality?: OnboardingModality }): Promise<string>` — defaults to `'voice'` for back-compat with Story 2.6 voice flow; selects prompt via `getOnboardingSystemPrompt(modality)`
    - Add `isSummaryConfirmed(history: LlmMessage[]): Promise<boolean>` — small classification call (gpt-4o `temperature: 0`, `max_tokens: 5`) returning whether the most recent assistant turn was the summary AND the parent's most recent user turn was an affirmative ("yes", "that's right", "looks good", etc.). Used by `OnboardingService` to set `is_complete` on the response.
    - **Do NOT mock the OpenAI client** in tests — fake at the network boundary per project-context.md test rules.

- [x] Task 4 — Backend: `OnboardingService` + routes (AC: 1, 2, 3, 4, 5, 6, 7, 8, 9)
  - [x] Create `apps/api/src/modules/onboarding/onboarding.service.ts`:
    ```typescript
    export class OnboardingService {
      constructor(deps: {
        threads: ThreadRepository;
        agent: OnboardingAgent;
        logger: FastifyBaseLogger;
      });

      // POST /v1/onboarding/text/turn
      async submitTextTurn(input: {
        userId: string;
        householdId: string;
        message: string;
      }): Promise<{ thread_id, turn_id, lumi_turn_id, lumi_response, is_complete }>;
      // 1. findActiveThreadByHousehold(household_id, 'onboarding') → existing thread
      //    OR if a 'closed' onboarding thread exists with a system_event 'onboarding.summary' → throw ConflictError ("onboarding already complete")
      //    OR createThread(household_id, 'onboarding')
      // 2. listTurns(threadId) → previous history → map to LlmMessage[]
      //    user turns: { role: 'user', content }
      //    lumi turns: { role: 'assistant', content }
      //    system_event turns: skipped
      // 3. getNextSeq + appendTurn — user turn (role='user', body { type:'message', content }, modality='text')
      // 4. agent.respond(history + new user turn, { modality: 'text' }) — wrap in try/catch:
      //    on failure → log err, throw UpstreamError. The user turn is already persisted (per AC7).
      // 5. getNextSeq + appendTurn — lumi turn (role='lumi', body { type:'message', content: lumi_response }, modality='text')
      // 6. agent.isSummaryConfirmed(updatedHistory) → is_complete
      // 7. return shaped response

      // POST /v1/onboarding/text/finalize
      async finalizeTextOnboarding(input: {
        userId: string;
        householdId: string;
      }): Promise<{ thread_id, summary }>;
      // 1. findActiveThreadByHousehold(household_id, 'onboarding') → if none, throw ConflictError
      // 2. listTurns(threadId)
      //    if there is no Lumi turn whose content reads as a summary, throw ConflictError ("not yet ready to finalize")
      //    (heuristic: at least 6 turns AND agent.isSummaryConfirmed(history) is true)
      // 3. agent.extractSummary(transcript) — log + persist empty summary on failure (same pattern as Story 2.6 webhook)
      // 4. getNextSeq + appendTurn — system_event turn (role='system', body { type:'system_event', event:'onboarding.summary', payload:summary }, modality='text')
      // 5. closeThread(threadId)
      // 6. emit log: { module:'onboarding', action:'onboarding.completed', modality:'text', household_id, user_id }
      // 7. return { thread_id, summary }
    }
    ```
  - [x] Create `apps/api/src/modules/onboarding/onboarding.routes.ts` (`fp` plugin, `name: 'onboarding-routes'`):
    - `POST /v1/onboarding/text/turn` — JWT-auth, `schema: { body: TextOnboardingTurnRequestSchema, response: { 200: TextOnboardingTurnResponseSchema } }`
    - `POST /v1/onboarding/text/finalize` — JWT-auth, no body, `schema: { response: { 200: TextOnboardingFinalizeResponseSchema } }`
    - Error mapping is handled by the global error handler — let `ConflictError` / `UpstreamError` / `UnauthorizedError` propagate.
  - [x] Register in `apps/api/src/app.ts`: `await app.register(onboardingRoutes);` (after `voiceRoutes`).
  - [x] No new audit event types needed for this story — `audit.types.ts` does not currently enumerate an onboarding-completed event. If telemetry needs one, file a separate Story 2.14 dependency note.

- [x] Task 5 — Backend tests (AC: 1, 2, 3, 4, 5, 6, 7, 8, 9)
  - [x] Create `apps/api/src/modules/onboarding/onboarding.routes.test.ts` covering:
    - `POST /v1/onboarding/text/turn`:
      - first turn → 200, creates thread, persists user + lumi turns, `is_complete=false`
      - subsequent turn → 200, reuses existing thread, `server_seq` increments
      - missing/whitespace `message` → 400
      - `message` > 4000 chars → 400
      - unauthenticated → 401
      - OpenAI fails → 502, user turn persisted, no lumi turn persisted
      - household has closed onboarding thread with summary → 409 ("onboarding already complete")
    - `POST /v1/onboarding/text/finalize`:
      - happy path → 200, summary returned, system_event turn appended, thread closed
      - no active thread → 409
      - active thread with no summary turn yet → 409
      - extractSummary fails → 200 (per Story 2.6 contract — empty summary persisted, log emitted)
      - unauthenticated → 401
  - [x] Mock OpenAI at the network boundary (do not mock `OnboardingAgent` itself) — use the same shape as Story 2.6 tests (`vi.fn().mockResolvedValue({ choices: [{ message: { content: ... } }] })`).
  - [x] Use the same supabase mock pattern as `voice.routes.test.ts` (chain mocks). Do NOT mock `@hivekitchen/contracts` — source-imported and deterministic.

- [x] Task 6 — Frontend: text onboarding UI (AC: 1, 2, 3, 4, 10)
  - [x] Create `apps/web/src/features/onboarding/OnboardingText.tsx`:
    - Local state: `turns: Array<{ role: 'user' | 'lumi'; content: string; id: string }>`, `pending: boolean`, `isComplete: boolean`, `error: string | null`
    - Render a vertical conversation: Lumi turns left-aligned (cream tile), user turns right-aligned (oat tile); editorial-serif name label "Lumi" above each Lumi turn; soft fade-in on new turns
    - Bottom: a `<textarea>` (resizes to 1–6 rows) with submit button. Disabled while `pending`.
    - On submit: `hkFetch<TextOnboardingTurnResponse>('/v1/onboarding/text/turn', { method: 'POST', body: { message } })`. Append user turn to local state immediately on send (optimistic), then append Lumi turn from response. On failure (502 / network), show inline error and **leave the user turn in place** (server already persisted it; client state mirrors server).
    - When response carries `is_complete: true`, render a single `<button>` "Finish onboarding" below the conversation. Click → `POST /v1/onboarding/text/finalize` → on success, navigate to `/app`.
    - Empty state on mount: render a single greeting Lumi turn from a hard-coded constant `OPENING_GREETING` (matches the agent's first signal-question phrasing — keeps the screen non-empty before the first server round-trip). Mark this as a presentation-only turn (not persisted). The first user turn triggers the actual server-side conversation.
    - Use Zustand selector pattern only (project rule). No top-level store destructure.
  - [x] Update `apps/web/src/routes/(app)/onboarding.tsx`:
    - Replace the `mode === 'text'` placeholder branch with `<OnboardingText />`
    - Drop the "Story 2.7" placeholder copy
  - [x] Style:
    - Tailwind utilities only — no `style={{}}`, no CSS modules
    - Warm-neutral palette only (honey-amber for the submit button, oat/cream for tiles, charcoal for text)
    - No SaaS-chat-app chrome (no avatars, no online indicators, no timestamps, no "typing…" dots)
    - Reduced-motion fallback: replace fade-in with no transition (use `motion-reduce:` Tailwind variant)

- [x] Task 7 — Frontend tests (AC: 1, 6, 7)
  - [x] Create `apps/web/src/features/onboarding/OnboardingText.test.tsx`:
    - Renders the opening greeting on mount
    - Submitting a message disables the input until response returns; appends user turn then Lumi turn
    - Server 502 → input re-enabled, inline error shown, user turn still rendered
    - `is_complete=true` → "Finish onboarding" button appears
    - Clicking "Finish onboarding" → calls finalize, navigates to `/app`
  - [x] Use `@testing-library/react` + `msw` for the two POST endpoints. Test behaviour, not markup structure.

## Dev Notes

### Why a separate `onboarding` module instead of folding into `voice`?

Story 2.6's voice module handles ElevenLabs pipeline mechanics (signed URLs, conversation_id mapping, HMAC webhooks) — none of those concerns apply to the text path. Adding a "modality switch" inside `voice.service.ts` would force voice-specific dependencies (ElevenLabsClient, agent_id) into a code path that doesn't need them. A dedicated `modules/onboarding/` keeps the surfaces aligned with their actual transport realities while sharing the agent + thread storage. The shared-thread refactor (Task 1) is the seam.

### Modality-aware prompt vs. per-modality prompt files

Two prompt strings would duplicate the three-signal-question core and risk drift. A single core + appended modality rules keeps the conversational logic identical and isolates only what changes. The runtime cost of string concat per request is negligible.

### `is_complete` detection

The agent itself decides when the conversation has wrapped (it produces the closing line). The classification call (`agent.isSummaryConfirmed`) is a small post-hoc check that gates the front-end "Finish onboarding" button. Doing this server-side keeps the UI state machine simple: the client just renders what the response says.

An alternative considered: have the agent emit a structured tool-call ("onboarding-complete") when ready. Rejected for this story — adds tool-manifest scope (Story 1.9 / 3.4) and isn't worth the complexity for a binary signal.

### Re-entry and resume — out of scope

If the parent closes the tab mid-conversation and reopens, this story does NOT load the in-progress thread. The frontend starts fresh; the backend continues to find the existing active thread on the next turn POST and the conversation continues from where Lumi left off. The transcript is intact — only the client view is reset. Building a "GET /v1/onboarding/text/thread" endpoint to hydrate the UI on reload is deferred (Story 5.1 thread hydration owns the general primitive).

### What about the existing `voice.repository.ts`?

Task 1 splits the thread/turn methods out, but `voice.repository.ts` keeps `createVoiceSession`, `findSessionByConversationId`, `updateVoiceSession`. The voice service composes `ThreadRepository` + voice-specific repository for the parts each actually uses. The Story 2.6 review patches will remain green — only the import path changes for the affected methods.

### Schema design — `system_event` JSONB stays identical to Story 2.6

The text-finalize path writes the **same** `body` shape as the voice post-call webhook:
```json
{ "type": "system_event", "event": "onboarding.summary", "payload": { "cultural_templates": [...], "palate_notes": [...], "allergens_mentioned": [...] } }
```
Story 2.10's child-profile reader queries `thread_turns WHERE body->>'event' = 'onboarding.summary'` — modality-agnostic. Don't fork the shape.

### Modality on the `system_event` summary turn

Voice path persists summary with `modality='text'` (per Story 2.6 review patch — system events aren't really voice). Text path also writes `modality='text'`. Consistent.

### Error mapping reminders

- `ConflictError` (already exists, status 409, `/errors/conflict`)
- `UpstreamError` (added in Story 2.6, status 502, `/errors/upstream`)
- `UnauthorizedError` (existing)

No new error classes needed.

### Token budget

`OnboardingAgent.respond` already runs at `max_tokens: 300`, which is fine for text replies. The full history grows roughly 100–200 tokens per turn pair; a 10-turn conversation is well under the 8k context window. No truncation required for this story.

### CSP / privacy

Text turns contain PII (cultural identity, child food preferences). Per project-context.md:
- Don't log message content. Log lengths and IDs only.
- The agent's OpenAI call ships the messages to OpenAI — that's the design. Don't add additional logging that captures content.
- The contract response carries `lumi_response` for the client; don't retain it server-side beyond the `thread_turns` row.

### Project Structure Notes

- New module dir: `apps/api/src/modules/onboarding/` (new)
- New shared module: `apps/api/src/modules/threads/thread.repository.ts` (new — Task 1 refactor target)
- New contracts file: `packages/contracts/src/onboarding.ts`
- New types re-exports in `packages/types/src/index.ts`
- New web feature: `apps/web/src/features/onboarding/OnboardingText.tsx`
- Touchpoints in existing files: `voice.repository.ts` (delegate), `voice.service.ts` (import path), `voice.routes.ts` (import path), `app.ts` (register new route plugin), `agents/onboarding.agent.ts` + `agents/prompts/onboarding.prompt.ts` (modality split), `routes/(app)/onboarding.tsx` (text branch)

### Previous Story Learnings (from 2.6)

- **Selectors only on Zustand stores** — components subscribe with `useStore(s => s.slice)`, never destructure the full store.
- **`UnauthorizedError` throw, not inline reply** — let the global error handler emit `application/problem+json`.
- **Logger injection via deps object** — `VoiceService` constructor takes a deps object including `logger: FastifyBaseLogger`; mirror that pattern for `OnboardingService` so `extractSummary` failures and `respond` failures are observable.
- **Don't mock @hivekitchen/contracts** — source-imported, deterministic.
- **`.js` extensions on relative imports in apps/api** — required by `tsx`/`tsc` ESM resolution.
- **TS strict + isolatedModules** — `import type` on type-only imports; `export type` on type-only re-exports.
- **React 18 StrictMode + AbortController** — already learned in 2.6 review; same applies here. Use an AbortController on the `hkFetch` call inside the text-onboarding submit handler if the component unmounts.
- **Conventional commits with scope** — `feat(api,web,contracts): story 2-7 — text-equivalent onboarding path`.

### Architecture Constraints

- **One conversation thread model.** Text and voice share `threads` + `thread_turns` schema. The thread ID is the join key. This story enforces that — same table, just a different `modality` value on the rows.
- **Agent layer is stateless.** `OnboardingService` (in the API) persists; `OnboardingAgent` returns text only. Don't shortcut.
- **No SSE for text turns in 2.7.** Each turn is request/response. Story 5.1+ (shared family thread with server-assigned monotonic seq + thread.resync) introduces SSE fan-out for cross-tab consistency. Out of scope here.
- **JWT auth via existing preHandler.** Both new endpoints sit under JWT. No new SKIP_PREFIXES entries.
- **No DB calls from web, no DB calls from agent** — both endpoints stay on the API path.

### References

- [Source: epics.md#Story-2.7] AC source for this story
- [Source: ux-design-specification.md#Onboarding-Voice-Interview (line 1454+)] Mode-choice fork; same Q1/Q2/Q3 path for text
- [Source: ux-design-specification.md#86, 163, 231, 1490] No-form-fields invariant; warmth-of-questions principle
- [Source: _bmad-output/implementation-artifacts/2-6-voice-first-onboarding-interview-via-elevenlabs-three-signal-questions.md] Prior art — agent, prompt, threads schema, summary contract
- [Source: apps/api/src/agents/onboarding.agent.ts] `OnboardingAgent.respond` + `extractSummary` — reuse as-is, plus add modality + `isSummaryConfirmed`
- [Source: apps/api/src/agents/prompts/onboarding.prompt.ts] Single-prompt-string today; split per Task 3
- [Source: apps/api/src/modules/voice/voice.repository.ts] Source of `createThread`, `appendTurn`, `getNextSeq` to extract per Task 1
- [Source: apps/api/src/modules/voice/voice.service.ts] Pattern for deps-object constructor + logger injection — mirror for `OnboardingService`
- [Source: apps/api/src/modules/voice/voice.routes.ts] Pattern for `fp()` plugin + JWT-protected schema-typed POST handler
- [Source: apps/api/src/app.ts] Plugin registration order
- [Source: apps/api/src/common/errors.ts] `ConflictError`, `UpstreamError`, `UnauthorizedError` already defined
- [Source: apps/web/src/features/onboarding/OnboardingVoice.tsx] Pattern for selector use, `hkFetch` invocation, AbortController hygiene
- [Source: apps/web/src/routes/(app)/onboarding.tsx] Text-mode placeholder branch this story replaces
- [Source: project-context.md] Test rules, frontend rules, framework rules — read before implementing

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

None — all task validations succeeded inline.

### Completion Notes List

- **Repository refactor**: Extracted `createThread`, `appendTurn`, `getNextSeq` from `voice.repository.ts` into a new `apps/api/src/modules/threads/thread.repository.ts` and added `findActiveThreadByHousehold`, `findClosedThreadByHousehold`, `findThreadById`, `closeThread`, `listTurns`. `VoiceRepository` now composes `ThreadRepository` and delegates the shared methods — voice-specific tests required updating one mock to add the new `.select().single()` chain after `appendTurn` (it now returns the persisted row).
- **Prompt split with back-compat**: Added `getOnboardingSystemPrompt(modality)` plus retained `ONBOARDING_SYSTEM_PROMPT` (defaults to voice) so Story 2.6 callers continue to work without touching their imports.
- **`OnboardingAgent.respond` modality opt-in**: Defaults to `'voice'` for back-compat; text mode passes `{ modality: 'text' }`. Fallback string ("[pause] Let me think…") becomes "Let me think for a moment." when in text mode.
- **`isSummaryConfirmed` classifier**: Small `temperature:0` `max_tokens:5` gpt-4o call that returns "yes"/"no". Used both to set `is_complete` on each turn response and as the gate for `finalize`. Errors are best-effort and default to `false` (logged at warn).
- **Idempotency / completion gate (AC9)**: `householdHasCompletedOnboarding` reads the most recent closed onboarding thread and checks for the `system_event onboarding.summary` turn. Both `submitTextTurn` and `finalize` call it.
- **AC7 user-turn-without-lumi-turn**: When `agent.respond` throws, `submitTextTurn` has already persisted the user turn but bails before persisting Lumi's reply, returning `UpstreamError → 502`. The client retries the same content; the server has the user turn intact.
- **Schema continuity with Story 2.6**: The system_event summary turn body is identical (`{ type: 'system_event', event: 'onboarding.summary', payload: {...} }`) and `modality='text'` matches the Story 2.6 review-patch decision.
- **No new audit events**: `audit.types.ts` does not currently enumerate an onboarding-completed event. Logged via `request.log.info({ action: 'onboarding.completed', modality: 'text', ... })` instead — added as a deferred follow-up if telemetry needs an audit row later.
- **Frontend pattern follows 2.6 review patches**: AbortController on the fetch (cancellation on unmount), Zod-parse the response, optimistic user-turn render, `useNavigate` to `/app` on finalize success.
- **jsdom gap**: `scrollIntoView` is not implemented in jsdom — guarded the call with `typeof === 'function'` check so it works in browser and is a no-op in tests.
- **Tests**: 99 API tests (was 86 — +13), 40 web tests (was 35 — +5), 161 contract tests (was 148 — +13). All green; pre-existing `stripe.plugin.ts` typecheck error remains untouched.

### File List

**API — new**
- `apps/api/src/modules/threads/thread.repository.ts`
- `apps/api/src/modules/onboarding/onboarding.service.ts`
- `apps/api/src/modules/onboarding/onboarding.routes.ts`
- `apps/api/src/modules/onboarding/onboarding.routes.test.ts`

**API — modified**
- `apps/api/src/modules/voice/voice.repository.ts` — composes `ThreadRepository`, delegates shared methods
- `apps/api/src/modules/voice/voice.routes.test.ts` — updated `thread_turns.insert` mock to include `.select().single()` chain
- `apps/api/src/agents/prompts/onboarding.prompt.ts` — split into core + modality rules; back-compat re-export
- `apps/api/src/agents/onboarding.agent.ts` — added `respond` modality option, `isSummaryConfirmed`, Array.isArray guards on extractSummary
- `apps/api/src/app.ts` — registered `onboardingRoutes`

**Contracts — new**
- `packages/contracts/src/onboarding.ts`
- `packages/contracts/src/onboarding.test.ts`

**Contracts / Types — modified**
- `packages/contracts/src/index.ts` — re-export onboarding schemas
- `packages/types/src/index.ts` — re-export inferred types

**Web — new**
- `apps/web/src/features/onboarding/OnboardingText.tsx`
- `apps/web/src/features/onboarding/OnboardingText.test.tsx`

**Web — modified**
- `apps/web/src/routes/(app)/onboarding.tsx` — replaced the text-mode placeholder with `<OnboardingText />` plus heading

### Change Log

| Date | Change |
|---|---|
| 2026-04-26 | Initial implementation — Tasks 1–7 complete; 99 API + 40 web + 161 contract tests pass |
| 2026-04-26 | Review patches F01, F03–F11/12, F14, F16, F17 applied; tests still green at 99 API + 40 web + 161 contract |

### Review Findings

#### Decision-Needed (resolved)

- [x] [Review][Decision→Patch] F04 — Voice-completed households invisible to completion gate → **Decision: patch voice.service.ts to call `closeThread` on the onboarding thread after persisting the summary turn**
- [x] [Review][Decision→Patch] F08 — Orphaned user turns corrupt agent history on retry → **Decision: detect and resume from the orphaned user turn in `submitTextTurn` rather than re-appending**
- [x] [Review][Decision→Patch] F09 — `MIN_TURNS_BEFORE_FINALIZE = 6` magic number → **Decision: replace with `turns.length === 0` fast-fail only; let `isSummaryConfirmed` be the sole gate**
- [x] [Review][Decision→Patch] F11/F12 — Optimistic turn not rolled back on non-502 errors; draft cleared → **Decision: roll back optimistic turn and restore draft on all non-502 errors**

#### Patches

- [x] [Review][Patch] F01 — `getNextSeq` race → duplicate `server_seq` under concurrent requests [apps/api/src/modules/threads/thread.repository.ts:120]
- [x] [Review][Patch] F03 — `closeThread` has no `status='active'` precondition — silent re-close on retry [apps/api/src/modules/threads/thread.repository.ts:80]
- [x] [Review][Patch] F04 — `voice.service.ts` `processPostCallWebhook` must call `closeThread` on the onboarding thread after appending the summary turn [apps/api/src/modules/voice/voice.service.ts]
- [x] [Review][Patch] F05 — Concurrent `finalizeTextOnboarding` can append two `system_event` turns on same thread [apps/api/src/modules/onboarding/onboarding.service.ts:139]
- [x] [Review][Patch] F06 — `isSummaryConfirmed` throw during finalize silently becomes 409 instead of upstream error [apps/api/src/modules/onboarding/onboarding.service.ts:163]
- [x] [Review][Patch] F07 — `isComplete && !error` hides "Finish onboarding" button on finalize failure; textarea permanently locked [apps/web/src/features/onboarding/OnboardingText.tsx:147]
- [x] [Review][Patch] F08 — `submitTextTurn` must detect and skip/resume from orphaned user turns before re-appending [apps/api/src/modules/onboarding/onboarding.service.ts:66]
- [x] [Review][Patch] F09 — Replace `MIN_TURNS_BEFORE_FINALIZE = 6` guard with `turns.length === 0` fast-fail only [apps/api/src/modules/onboarding/onboarding.service.ts:158]
- [x] [Review][Patch] F10 — `isSummaryConfirmed` OpenAI call fires on every turn with no service-layer turn-count guard [apps/api/src/modules/onboarding/onboarding.service.ts:114]
- [x] [Review][Patch] F11/F12 — Roll back optimistic turn and restore draft on non-502 errors [apps/web/src/features/onboarding/OnboardingText.tsx:68]
- [x] [Review][Patch] F14 — `VoiceRepository.appendTurn` declares `Promise<unknown>` instead of `Promise<TurnRow>` [apps/api/src/modules/voice/voice.repository.ts:40]
- [x] [Review][Patch] F16 — Active onboarding thread with an appended `system_event` still accepts new turns via `submitTextTurn` [apps/api/src/modules/onboarding/onboarding.service.ts:50]
- [x] [Review][Patch] F17 — Two distinct finalize failure modes (too few turns vs. classifier said no) share identical `ConflictError` message [apps/api/src/modules/onboarding/onboarding.service.ts:159]

#### Deferred

- [x] [Review][Defer] F02 — `getNextSeq` starts at 1: off-by-one if DB schema uses 0-based server_seq [apps/api/src/modules/threads/thread.repository.ts:130] — deferred, pre-existing pattern from Story 2-6
- [x] [Review][Defer] F15 — `onboarding.routes.ts` instantiates service/repository directly without Fastify DI pattern [apps/api/src/modules/onboarding/onboarding.routes.ts:13] — deferred, consistent with existing route patterns in this codebase

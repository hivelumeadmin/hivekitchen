---
title: 'ADR-002: Ambient Lumi — Persistent Context-Aware Companion'
status: 'approved'
author: 'Winston (Architect)'
date: '2026-04-29'
deciders: ['Menon']
open-questions: 'none — all resolved 2026-04-29'
relates-to:
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/prd.md'
---

# ADR-002: Ambient Lumi — Persistent Context-Aware Companion

## Context

HiveKitchen's current architecture treats Lumi as a feature of the onboarding flow. The voice
contract is `z.literal('onboarding')`. Thread type is hardcoded to `'onboarding'` everywhere.
There is no global Lumi store — each surface manages its own local state.

The product vision is different: **Lumi is a friend and companion who lives throughout the
application.** She is aware of what the user is doing, remembers their conversations, and is
always reachable. She is not a chatbot on a dedicated screen — she is the ambient intelligence
behind the experience.

This ADR establishes the architecture for that vision. All open questions were resolved with
Menon on 2026-04-29.

---

## Principles Governing This Design

1. **No chat-first layouts.** Lumi is a companion, not a chat application. The UI presents ready
   answers; it does not build an interface for the user to construct one.
2. **System-led experience.** The majority of reasoning happens in the background. Lumi surfaces
   outcomes, not process.
3. **One thread model.** Text and voice share the same thread per surface. Modality is a property
   of a turn, not a separate data store.
4. **Agent layer stays stateless.** The agent takes input, returns a response. It never reads the
   DB directly.
5. **SSE for proactive delivery; WebSocket only for ElevenLabs voice.**
6. **HiveKitchen never handles raw audio.** Only text crosses the HiveKitchen boundary.
   ElevenLabs connections are browser-direct.

---

## Decision 1 — Persistent Lumi UI Surface

### Decision
Lumi lives as a **floating, always-mounted companion affordance** in the root app layout — a
small interactive orb anchored bottom-right, expanding to a compact conversation panel.

### Behaviour

| State | Visual | User action |
|---|---|---|
| `collapsed` | Small animated orb; breathes when a proactive nudge is waiting | Tap to open |
| `text` | Compact panel, last 5–8 turns + text input, 320px max width | Dismiss or switch to voice |
| `voice` | Orb pulses during active talk session; panel shows live transcript | Tap to end talk session |

### Exclusions
- Not shown during onboarding — onboarding owns its dedicated Lumi surface.
- Not shown on child-facing surfaces (Lunch Link, child tap-rating). These are read-only,
  intentionally simple surfaces designed for children.

### Affected files
- `apps/web/src/components/LumiOrb.tsx` — new
- `apps/web/src/components/LumiPanel.tsx` — new
- `apps/web/src/routes/(app)/layout.tsx` — mount in root layout

---

## Decision 2 — Context Signal Layer

### Decision
The frontend broadcasts Lumi's context. Each route registers a **context signal** when it mounts.
Every Lumi turn (voice or text) carries the current context signal in its request payload. The
API assembles the agent prompt from it.

### Context signal contract

```typescript
// packages/contracts/src/lumi.ts  (new file)

export const LumiSurfaceSchema = z.enum([
  'onboarding',        // onboarding flow (existing — not ambient)
  'planning',          // weekly plan view
  'meal-detail',       // specific meal inspection
  'child-profile',     // child settings / preferences
  'grocery-list',      // grocery and pantry view
  'evening-check-in',  // evening check-in flow
  'heart-note',        // heart note composition
  'general',           // home / fallback
]);

export const LumiContextSignalSchema = z.object({
  surface: LumiSurfaceSchema,
  entity_type: z.string().optional(),            // e.g. 'plan', 'meal', 'child'
  entity_id: z.string().uuid().optional(),        // e.g. the plan ID being viewed
  entity_summary: z.string().max(500).optional(), // "Thursday's lunch for Emma — pasta primavera"
  recent_actions: z.array(z.string()).max(5).optional(), // last N user actions on this surface
});
```

### How context is assembled on the frontend

1. Each route calls `lumiStore.setContext(signal)` on mount.
2. User actions (approving a meal, flagging an allergen) call `lumiStore.appendAction(description)`.
3. `recent_actions` rolls as a fixed-length queue of 5.
4. Every Lumi turn POST and every voice session creation includes the current `context_signal`.

### Why frontend-driven, not server-inferred
The server only knows which endpoint was called. The frontend knows what is rendered — the entity
ID, the displayed data, what the user just did. Frontend-driven context is cheaper and more precise.

---

## Decision 3 — Thread Model for Ambient Lumi

### Decision
**One active thread per (household, surface type).** Thread `type` equals the surface name.
Voice and text share the same thread per surface — modality is stored on the turn, not the thread.

### Resolved: OQ-1 — Merge voice/text into one thread per surface
Voice and text use the same thread per surface. The existing DB constraint
`threads_one_active_per_household_type_modality` enforces modality separation, which was
appropriate for onboarding (two distinct paths) but breaks Lumi's conversational continuity
post-onboarding. **Decision: drop the modality discriminator from the constraint for
non-onboarding thread types.**

### Why not one global thread per household
A single thread mixing planning + grocery + profile + check-in dilutes Lumi's context window
and produces worse responses. Focused per-surface threads let Lumi stay on topic.

### Why not one thread per session
Too granular. A thread per surface accumulates the relationship over time — Lumi remembers
what was discussed about planning last Monday when the parent returns on Wednesday.

### Resolved: OQ-3 — Onboarding thread after onboarding completes
The onboarding thread is kept as a **permanent audit record**. It is never merged into the
`general` surface thread. The outcomes of onboarding (allergens, cultural templates, palate
notes, child profiles) are persisted to structured household data and injected into every future
Lumi prompt via the household snapshot. Lumi reads the outcomes, not the conversation.

### Resolved: OQ-2 — Cross-surface Lumi memory
Conversation history is **surface-scoped**. The planning thread does not include evening
check-in conversations, and vice versa. Cross-surface awareness is provided by the **household
data snapshot** (allergens, preferences, plan state, child profiles) which is injected into every
surface prompt on every turn. If a conversation on one surface produces a data change (e.g. a new
allergen flagged), that change is in the household snapshot and Lumi knows about it on every
surface.

### Thread lifecycle
- **Creation:** lazy — created on first Lumi interaction on a surface.
- **Expiry:** none. Threads accumulate indefinitely, giving Lumi long-term per-surface memory.
- **Agent context window:** last 20 turns injected into each prompt. Full history in DB for audit.

### DB migration required
```sql
-- Drop the modality-partitioned constraint
ALTER TABLE threads
  DROP CONSTRAINT threads_one_active_per_household_type_modality;

-- New constraint: one active thread per (household, type) — modality-agnostic
-- Scoped to non-onboarding types to preserve onboarding's existing separation
CREATE UNIQUE INDEX threads_one_active_per_household_type
  ON threads (household_id, type)
  WHERE status = 'active' AND type != 'onboarding';
```

---

## Decision 4 — Voice Pipeline (Tap-to-Talk, Browser-as-Hub)

### Session distinction

| Session type | Lifetime | Scope | Auth |
|---|---|---|---|
| **HiveKitchen User Session** | Long-lived. Survives page refreshes and tab switches. | Owns thread history, household data, all persistent state. | JWT — all HiveKitchen API calls |
| **ElevenLabs Talk Session** | Short-lived. One per tap-to-talk interaction. Closed on tap-to-end or 20s inactivity. | Two WebSocket connections (STT + TTS). Stateless from HiveKitchen's perspective — no auth, no persistence of its own. | Single-use tokens — never the permanent ElevenLabs API key |

### Resolved: OQ-1 — Voice pipeline sequence (tap-to-talk)

```
VOICE MODE — TAP TO TALK
────────────────────────────────────────────────────────────────

Browser                  HiveKitchen API           ElevenLabs
───────                  ───────────────           ──────────

─── USER TAPS "START" ──────────────────────────────────────

[1]  POST /v1/lumi/voice/sessions (JWT) ──────────────────►
                         [2] POST /v1/tokens (stt) ─────────► ElevenLabs
                             POST /v1/tokens (tts) ─────────► ElevenLabs
                             link both tokens to talk session
                         ◄── { stt_token, tts_token,
                                voice_id, talk_session_id }
[3]  Open ElevenLabs STT WS (stt_token) ─────────────────────►
[4]  Open ElevenLabs TTS WS (tts_token, voice_id) ───────────►

─── CONVERSATION TURNS (repeats) ───────────────────────────

[5]  audio ──────────────────────────────────────────────────► STT WS
[6]  ◄────────────────────────────────────── transcript        STT WS
[7]  append transcript to chat (user turn)
[8]  transcript ──────────────────────────►  (HiveKitchen WS)
                         [9] OpenAI call (context + transcript)
                             ◄── streamed text response
                             persist both turns to thread
◄─── { type: 'response.text', text } [10] (HiveKitchen WS)
[10] append text to chat (Lumi turn)
[11] forward text chunks ────────────────────────────────────► TTS WS
     ◄───────────────────────────────────── audio → play       TTS WS

─── USER TAPS "END" (or 20s inactivity) ───────────────────

[12] close STT WS + close TTS WS
[13] DELETE /v1/lumi/voice/sessions/:talk_session_id ─────────►
                         [14] mark talk session closed in DB
                              HiveKitchen user session unaffected


TEXT MODE (voice modality closed)
────────────────────────────────────────────────────────────────

No ElevenLabs. No WebSocket. User types →
POST /v1/lumi/turns (JWT, context signal) →
OpenAI → text response → chat panel.
Same thread. Same persistence. Different input channel.
```

### Key constraints
- HiveKitchen never handles raw audio. Only text crosses the HiveKitchen boundary.
- Both ElevenLabs WebSocket connections are browser-direct using single-use tokens. The
  permanent ElevenLabs API key never reaches the browser.
- One token pair per tap-to-talk session (not per response). Both tokens requested at session
  start; both WebSocket connections held open for the duration of the talk session.
- STT → transcript only flows to HiveKitchen API. Text response only flows to ElevenLabs TTS.
  No audio on the HiveKitchen channel; no raw transcript on the ElevenLabs channel.
- 20s inactivity closes both WebSocket connections. Same outcome as tap-to-end.

### Chat sync — zero polling
Transcript (step 6→7) and Lumi text (step 10) arrive in the browser via their respective channels
and are appended directly to the chat panel. No round-trip to the API is needed for display during
an active talk session. Server persistence (step 9) happens in parallel and is independent of the
UI update.

The `GET /v1/lumi/threads/:threadId/turns` endpoint is the **resync fallback** — called on panel
open, on reconnect after disconnect, or on explicit user refresh. Server is always the source of
truth; the live channels are the fast path.

---

## Decision 5 — Global Lumi Store

### Decision
A new `lumi.store.ts` replaces `voice.store.ts` and all scattered component-local conversation
state. It is the single source of truth for Lumi interactions across the app.

### Store shape

```typescript
// apps/web/src/stores/lumi.store.ts

import type { LumiSurface, LumiContextSignal, Turn } from '@hivekitchen/types';

interface LumiState {
  // Context
  surface: LumiSurface;
  contextSignal: LumiContextSignal | null;

  // Thread per surface — lazy, populated on first interaction or on panel open
  threadIds: Partial<Record<LumiSurface, string>>;
  turns: Turn[];
  isHydrating: boolean;

  // Talk session (ElevenLabs, short-lived)
  talkSessionId: string | null;
  voiceStatus: 'idle' | 'connecting' | 'active' | 'ended' | 'error';
  isSpeaking: boolean;

  // UI
  isPanelOpen: boolean;
  panelMode: 'text' | 'voice';

  // Proactive
  pendingNudge: Turn | null;

  // Actions
  setContext: (signal: LumiContextSignal) => void;
  appendAction: (description: string) => void;
  openPanel: (mode: 'text' | 'voice') => void;
  closePanel: () => void;
  hydrateThread: (threadId: string, turns: Turn[]) => void;
  appendTurn: (turn: Turn) => void;
  setTalkSession: (sessionId: string, status: LumiState['voiceStatus']) => void;
  setVoiceStatus: (status: LumiState['voiceStatus']) => void;
  setNudge: (turn: Turn | null) => void;
}
```

### Surface switching
When `setContext()` is called on route change:
1. `surface` and `contextSignal` update.
2. Look up `threadIds[newSurface]`.
   - Found → fetch turns via `GET /v1/lumi/threads/:threadId/turns` → `hydrateThread()`.
   - Not found → `turns = []` (new conversation; thread created lazily on first message).
3. Active talk session is not interrupted. It continues executing against the thread it was
   opened on; the user must explicitly tap to end it.

### Migration from voice.store.ts
`voice.store.ts` is deleted. `OnboardingVoice.tsx` and `OnboardingText.tsx` continue using
component-local state (they are self-contained onboarding flows). `lumi.store.ts` backs the
ambient panel only.

---

## Decision 6 — Agent Prompt Assembly

### Decision
Introduce a `LumiAgent` class as the general-purpose Lumi agent. `OnboardingAgent` is refactored
to share the base persona from it. System prompts are assembled modularly.

### Prompt assembly

```
[SYSTEM — assembled per turn]
{lumi_base_persona}          ← who Lumi is, her tone, her relationship with this family
{surface_instructions}       ← loaded from agents/prompts/surfaces/{surface}.ts
{household_snapshot}         ← family name, children, active dietary rules (fetched by API)
{context_signal_block}       ← "User is viewing Thursday's lunch for Emma — pasta primavera"
{recent_actions_block}       ← "User just approved the main meal. User flagged strawberry."

[CONVERSATION HISTORY]
{last_20_turns}              ← from this surface's thread
```

### Household snapshot
Fetched by the API before the agent call. Contains: household name, children (first names, ages,
key dietary rules), active allergens. Injected as a system message. The agent never reads the DB.

### Surface prompt files

```
apps/api/src/agents/prompts/
  lumi-base.prompt.ts          ← base persona (extracted from onboarding.prompt.ts)
  surfaces/
    onboarding.prompt.ts       ← existing (refactored to use base)
    planning.prompt.ts
    meal-detail.prompt.ts
    child-profile.prompt.ts
    grocery-list.prompt.ts
    evening-check-in.prompt.ts
    heart-note.prompt.ts
    general.prompt.ts
```

---

## Decision 7 — Proactive Lumi

### Decision
Proactive nudges are **text-only, SSE-delivered, rate-limited, globally opt-out-able**.
Lumi does not initiate voice. The orb's ambient animation is the proactive signal — the user
chooses when to open the panel.

### Mechanism
1. Specific API mutations register as proactive trigger events.
2. After mutation resolves, API asynchronously invokes `LumiAgent.generateNudge()`.
3. Nudge persisted as a Lumi turn in the appropriate surface thread.
4. API emits SSE event `lumi.nudge` on the household event stream.
5. Frontend: `setNudge(turn)` → orb breathes → user taps → panel opens showing nudge.

### Rate limiting
Max 1 proactive nudge per household per 30 minutes. Enforced via Redis TTL key
`lumi:nudge:household:{id}`. Suppressed nudges are still persisted to the thread; only the SSE
event is withheld.

### Initial trigger events

| Trigger | Surface | Example nudge |
|---|---|---|
| Plan generation complete | `planning` | "Emma's week is set. Thursday has a new pasta — she tends to love those." |
| Child meal rating received | `planning` | "Mia gave Tuesday's lunch 4 stars. Want me to lock that one in?" |
| New allergen flagged | `child-profile` | "I've noted the strawberry flag for Emma. I'll keep it out of her plans." |
| Evening check-in complete | `evening-check-in` | "Good notes tonight. I'll adjust next week based on what you told me." |

### Resolved: OQ-5 — Opt-out granularity
Global opt-out only for now — a single toggle in notification preferences (maps to FR105).
Per-surface granularity is deferred to a later iteration.

---

## Decision 8 — Role Access

### Resolved: OQ-4 — Which roles get the Lumi panel

All adult roles (primary parent, secondary parent, grandparent) get the ambient Lumi panel with
both text and voice modalities. Voice modality follows the existing tier model — Premium only,
consistent with the PRD's treatment of voice features.

Lumi's **capabilities are role-scoped**. She understands what each role can and cannot change.
A grandparent can ask questions; she cannot instruct Lumi to modify the plan if the role doesn't
have that permission. The agent prompt receives the caller's role as part of the household
snapshot.

No Lumi panel on child-facing surfaces (Lunch Link, child tap-rating). These surfaces are
read-only and designed for children.

---

## New API Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/lumi/voice/sessions` | Start a talk session — returns `stt_token`, `tts_token`, `voice_id`, `talk_session_id` |
| DELETE | `/v1/lumi/voice/sessions/:id` | End a talk session (tap-to-end or inactivity close) |
| POST | `/v1/lumi/turns` | Submit a text turn with context signal |
| GET | `/v1/lumi/threads/:threadId/turns` | Hydrate surface thread for panel display |
| GET | `/v1/lumi/events` | SSE channel for proactive nudges (or shared household SSE stream) |

**Onboarding routes are NOT migrated.** `/v1/onboarding/text/turn`, `/v1/onboarding/text/finalize`,
and the existing `/v1/voice/sessions` remain as-is for the onboarding flow only.

---

## Contract Changes

| File | Change |
|---|---|
| `packages/contracts/src/lumi.ts` | **New.** `LumiSurfaceSchema`, `LumiContextSignalSchema`, `LumiTurnRequestSchema`, `LumiNudgeEventSchema`, `VoiceTalkSessionSchema` |
| `packages/contracts/src/voice.ts` | Add new message type `{ type: 'response.text'; text: string }` to WS message union. Existing onboarding schemas unchanged. |
| `packages/contracts/src/thread.ts` | No schema change. Thread `type` is already `string`. |
| `packages/contracts/src/index.ts` | Export new `lumi.ts` |

---

## Implementation Sequencing

**Phase 1 — Foundation**
- `packages/contracts/src/lumi.ts` with surface and context schemas
- `apps/web/src/stores/lumi.store.ts` (replaces `voice.store.ts` for ambient usage)
- `GET /v1/lumi/threads/:threadId/turns` endpoint
- DB migration: drop modality discriminator from thread constraint for non-onboarding types
- `POST /v1/lumi/voice/sessions` + `DELETE /v1/lumi/voice/sessions/:id` (talk session lifecycle)

**Phase 2 — Ambient UI Shell**
- `LumiOrb` + `LumiPanel` in root layout
- Route context registration pattern (`lumiStore.setContext()`) for all existing routes
- Thread hydration on panel open
- Tap-to-talk WebSocket flow (browser-direct ElevenLabs STT + TTS)

**Phase 3 — Surface-Specific Agent Prompts**
- Extract `lumi-base.prompt.ts` from `OnboardingAgent`
- Build `LumiAgent` with surface prompt dispatch
- `POST /v1/lumi/turns` text turn endpoint
- Household snapshot assembly before agent calls

**Phase 4 — Proactive Lumi**
- SSE nudge infrastructure
- Trigger events wired to plan generation + evening check-in
- Redis rate limiting
- Notification preferences global opt-out

---

*Status: APPROVED. All open questions resolved 2026-04-29. Ready for Phase 1 story creation.*

# HiveKitchen — Overall Technical Architecture

### System Design & Stack Reference

| Field | Value |
| --- | --- |
| Version | 1.2 |
| Status | Draft |
| Author | HiveLume Engineering |
| Last Updated | 2026-04-13 |

---

## Overview
HiveKitchen is an AI school lunch planning app. Its AI companion, Lumi, learns each 
family's constraints (allergies, school policies, cultural identity, child preferences) 
and generates a personalized weekly lunch plan. Voice interaction is handled by 
ElevenLabs V3; agent intelligence by OpenAI.
---

## High-Level Architecture

┌──────────────────────────────────────────────────────┐
│                     Lumi Client                      │
│                  Web — React / Next.js               │
│     Shadcn/Tailwind │ Zustand │ ElevenLabs SDK       │
└─────┬────────────────────────────────┬───────────────┘
      │ REST   ▲SSE                    │ WebSocket (voice + transcript)
      ▼        │                       ▼
┌──────────────┸───────┐    ┌─────────────────────────┐
│   HiveKitchen API    │◄───│       ElevenLabs        │
│   (Fastify / Node)   │    │  STT · TTS · WebSocket  │
└──────┬───────┬─────┬─┘    └─────────────────────────┘
       │       │     │
       │       │     ▼
       │       │     ┌──────────┐  
       │       │     │ Auth JWT │  
       │       │     │ Supabase │
	   │       │	 └──────────┘
       ▼       ▼
┌──────────┐  ┌─────────────────────────────────────┐
│ AI Agent │  │             Data Layer              │
│  Layer   │  │   PostgreSQL/Supabase· Redis        │
│          │  │   · Object Store                    │
└────┬─────┘  └─────────────────────────────────────┘
     │      
     ▼ 
┌──────────┐  
│OPENAI API│  
│  Chat+   │
│   Tool   │  
│          │  
└──────────┘  


The HiveKitchen API is the sole entry point to both the AI Agent Layer and the Data Layer. The AI Agent Layer does not interact with the Data Layer directly — all reads and writes are coordinated through the API.

---

## Monorepo Structure (Turborepo + pnpm)`

hivekitchen/

├── apps/

│   ├── web/          # React + Vite + Shadcn + Tailwind + Zustand

│   └── api/          # Fastify + Node.js + Zod + Pino

├── packages/

│   ├── contracts/    # Shared Zod schemas — API request/response shapes ONLY

│   ├── types/        # TypeScript types inferred from contracts (z.infer<>)

│   └── tsconfig/     # Shared base tsconfig

├── turbo.json

└── package.json

angelscript

``packages/contracts` is the API boundary. It contains only the public interface —
request/response shapes that cross the wire. Internal types (DB rows, service types, 
form state) stay inside their respective app. Nothing internal leaks into contracts.

---
## Frontend

The Lumi client is a React web application. There is no mobile client in the current version. The frontend is the sole consumer of the HiveKitchen API and the ElevenLabs WebSocket during voice sessions.

### Stack

| Layer 			| Technology |
| --- 				| --- |
| Framework 		| React — Next.js |
| State management 	| Zustand |
| Styling 			| Tailwind CSS |
| Real-time 		| SSE stream from HiveKitchen API |
| Voice 			| ElevenLabs client SDK — WebSocket managed by the 						SDK |
| Auth tokens 		| Stored in secure in-memory state; refresh 					 handled transparently |

### Design Philosophy

The frontend is built around one principle: the system thinks first. Lumi generates a complete weekly plan before the parent ever opens the app. The interface presents that plan as a ready, confident answer — not a blank canvas or a configuration surface. Users review, optionally adjust, and confirm. They do not construct.

This means the frontend is deliberately minimal. It does not behave like a dashboard, a chatbot, or a recipe browsing platform. It behaves like a calm household system — a trusted weekly ritual with invisible intelligence behind it. The aesthetic reflects this: warm neutrals, editorial typography, soft transitions, strong hierarchy, and generous whitespace. Motion is subtle. Color is drawn from food-grounded tones — honey, olive, clay, oat, charcoal — never AI purples or neon accents.

### Key UI Surfaces

The frontend is composed of a small, focused set of surfaces, each designed around a single user intent.

**Auth Screen** — a single focused surface. Email and password, a quiet line of context, and a warm returning-user tone. No marketing copy, no social login, no SaaS-style hero layout.

**Session-Aware Landing** — returning users with a valid session bypass any intermediary screen and land directly on the current weekly plan. The plan is the home. If the week is already confirmed, it is visible and calm. If a new plan awaits review, there is one prompt and one action.

**Weekly Plan** — the primary screen. A five-day lunch plan presented as complete, confident, and ready to accept. Each day has a clear structure. The parent can accept the full plan, swap individual days, or request a Lumi adjustment. The screen must never feel like an editable spreadsheet.

**Plan Review** — optimised for quick scan and trust. Each item carries quiet trust signals such as "kid favourite", "fits school rules", and "uses leftovers". An optional "Why this?" interaction surfaces Lumi's reasoning without demanding attention.

**Swap Flow** — a guided, low-choice replacement experience. Options are drawn from history, known favourites, and Lumi-suggested alternatives. Presented step by step, never as a large grid or an overwhelming modal.

**Onboarding** — the most emotionally significant surface in the product. Lumi guides the parent through a structured conversation — voice-first, with text always available — to establish the children's identities, allergies, school rules, cultural and religious food identity, and known preferences. One topic at a time. Allergies are treated with gravity, never as a quick-tap option.

**Calendar View** — lightweight and informational. Communicates which days have lunches planned. Not a scheduling tool.

**Grocery Output** — grouped items, easy to export or share. Reliable and complete. No complexity.

**Lunch Link** — a child-facing surface. Minimal, warm, and single-action. The child responds to their lunch via a single emoji reaction. This is not a sub-app; it is one frictionless screen.

### Voice Interaction

Voice exists as a persistent, optional input area — not a full-screen or conversation-first interface. The ElevenLabs SDK manages the WebSocket. The frontend calls `POST /v1/voice/token` to obtain a session token, opens the SDK, and then listens on the SSE stream for real-time events. The voice overlay shows session state and can expand to show the live transcript on user tap. When a voice session ends, the parent can continue by text on the same thread with no loss of context.

### Real-Time UI Behaviour

The frontend is SSE-driven. During both voice sessions and text interaction, Lumi's progress is communicated through the event stream rather than client-side polling or spinners. `ui.tool.active` and `ui.tool.complete` events drive inline loading states. `transcript.updated` populates the thread in real time. `plan.created` and `list.updated` surface new resources without requiring navigation.

### System States

Loading and error states are treated as first-class design concerns. The session bootstrap — the moment the app checks for a valid session on load — shows a minimal, centred state. There is no flash to the login screen before the check completes. Returning users feel continuity. Error states are inline, plain-language, and calm. There are no red alert boxes, no full-page error screens, and no toast notifications for background events.

---

## Backend — HiveKitchen API

HiveKitchen is a REST API with a Server-Sent Events (SSE) gateway for real-time delivery. It is the sole orchestrator of the system — it handles auth, conversation threading, AI agent dispatch, resource persistence, and inbound ElevenLabs webhooks. All access to the Data Layer is owned exclusively by this layer.

### Stack

| Layer 					| Technology 						|
| --- 						| --- 								|
| Runtime 					| Node.js (TypeScript) 				|
| Framework 				| Fastify 							|
| Auth 						| JWT — short-lived access tokens + refresh 						token rotation 					|
| API style 				| REST, versioned under `/v1/` 		|
| Real-time 				| Server-Sent Events (SSE) — user-scoped 							stream at `GET /v1/events` 			|
| Caching / rate limiting 	| Redis 							|
| Primary database 			| Supabase 							|
| CI/CD 					| GitHub Actions 					|
| Monitoring 				| OpenTelemetry  					|
| Logging 					| Structured JSON → centralised log sink |

### Core Services

| Service 					| Responsibility |
| --- 						| --- |
| **Auth Service** 			| JWT issuance, validation, refresh 							rotation |
| **Voice Token Service** 	| ElevenLabs session token provisioning |
| **Thread Service** 		| Conversation history, turn storage, 								modality tagging |
| **Agent Orchestrator** 	| Intent routing, tool dispatch, response 								composition |
| **Resource Service** 		| Meal plans, shopping lists, saved 								recipes, preferences |
| **SSE Gateway** 			| Real-time event fan-out to connected 								clients |
| **Webhook Handler** 		| Inbound ElevenLabs voice turn processing |

### AI Agent Layer

The Agent Orchestrator is invoked by the HiveKitchen API and does not read from or write to the database directly. Once the orchestrator returns a response and any resource payloads, the API layer handles all persistence. This keeps the agent layer stateless and independently testable.

Every turn passes through the same fixed pipeline: context load → intent classification → agent routing → tool execution → response returned to API → API persists resource → API composes response → API writes both turns to thread. Agents cover four domains: Recipe, Nutrition, Meal Planning, and Inventory.

### Security

All traffic runs over TLS. JWT access tokens carry a short TTL with refresh token rotation on every use. Inbound ElevenLabs webhooks are validated against a shared secret on every call. Rate limiting is enforced at the gateway layer using Redis. Resources are strictly user-scoped — no cross-user data access is possible.

---

## ElevenLabs Integration

ElevenLabs owns the entire audio pipeline — capture, speech-to-text, text-to-speech, and WebSocket turn management. HiveKitchen owns everything else.

### Stack & Configuration

| Setting 						| Value |
| --- 							| --- |
| Transport 					| WebSocket — managed by ElevenLabs 									client SDK |
| STT 							| ElevenLabs built-in |
| TTS 							| ElevenLabs built-in — non-streaming, 									full audio per turn |
| Turn detection 				| ElevenLabs silence detection; no 										client turn-end signals |
| Agent role 					| Relay transcript to HiveKitchen; 									relay plain text response to TTS |

### Voice Session Flow

`User activates voice  →  Client calls POST /v1/voice/token
                      →  HiveKitchen creates session using ElevenLabs API (status: active), returns token
                      →  Client SDK opens WebSocket with token
                      →  ElevenLabs captures audio, runs STT
                      →  ElevenLabs POSTs transcript to POST /v1/voice/webhook/elevenlabs
                      →  HiveKitchen runs agent pipeline, persists resource, returns plain text
                      →  ElevenLabs runs TTS, streams audio to client
                      →  HiveKitchen emits transcript.updated SSE to client`

### Webhook Contract

**Endpoint:** `POST /v1/voice/webhook/elevenlabs`

Inbound fields include `session_id`, `user_id`, `thread_id`, `turn_id`, `transcript`, and `timestamp`. HiveKitchen returns plain spoken-language text with no markdown, bullets, or structured formatting. Action confirmations are woven naturally into the spoken response.

### Session Lifecycle

A session opens when the client calls the token endpoint and closes either cleanly — when the user ends the session and the SDK closes the WebSocket — or via disconnection, where ElevenLabs sends a session-end webhook and HiveKitchen marks the session `disconnected`. In either case, persisted resources are retained and the transcript remains readable in the unified thread.

---

## Real-Time Events (SSE)

All events are scoped to the authenticated user's SSE stream.  Examples:

| Event 						| Trigger |
| --- 							| --- |
| `voice.session.started` 		| Voice session record created |
| `voice.session.ended` 		| Clean session close |
| `voice.session.disconnected` 	| Unexpected disconnection |
| `ui.tool.active` 				| Agent begins a tool call |
| `ui.tool.complete` 			| Tool call returns |
| `transcript.updated` 			| Voice turn written to thread |
| `plan.created` / `plan.updated` | Meal plan saved or modified |
| `list.updated` 				| Shopping list modified |

---

## Out of Scope — Current Version

- Mobile client (iOS / Android)
- Third-party OAuth / social login
- Push notifications
- Wake word and ambient listening
- Streaming TTS
- Offline mode
- Non-kitchen query handling
- Multi-tenancy and team accounts
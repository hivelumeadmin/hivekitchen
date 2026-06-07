Before implementing, read _bmad-output/project-context.md.
# HiveKitchen — Claude Code Instructions

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## Project
HiveKitchen is the full-stack AI-driven school lunch planning system powering the Lumi kitchen companion. Lumi is the AI agent.The platform spans a React web frontend, a Node.js backend API, an AI agent orchestration layer, and a real-time voice pipeline built on ElevenLabs. All layers share a unified conversation thread model, allowing users to move seamlessly between text and voice without losing context.

HiveKitchen is not a traditional UI-heavy planner. It is a system-led weekly planning experience where the majority of reasoning and decision-making happens in the background via Lumi. The frontend reflects that reality — its job is to present a ready answer, not to provide an interface for constructing one.

## High-Level Architecture

┌──────────────────────────────────────────────────────┐
│                     Web — Client                     │
│                   React / Next.js                    │
│     Shadcn/Tailwind │ Zustand │ ElevenLabs SDK       │
└─────┬────────────────────────────────┬───────────────┘
      │ REST   ▲SSE                    │ WebSocket(voice + transcript)
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

##Frontend
The Lumi client is a React web application. There is no mobile client in the current version. The frontend is the sole consumer of the HiveKitchen API and the ElevenLabs WebSocket during voice sessions.

## Backend — HiveKitchen API
Backend is the brain of the application. HiveKitchen backend is a REST API with a Server-Sent Events (SSE) gateway for real-time delivery. It is the sole orchestrator of the system — it handles auth, conversation threading, AI agent dispatch, resource persistence, and inbound ElevenLabs webhooks. All access to the Data Layer is owned exclusively by this layer.

### AI Agent Layer
The Agent Orchestrator is invoked by the HiveKitchen API and does not read from or write to the database directly. Once the orchestrator returns a response and any resource payloads, the API layer handles all persistence. This keeps the agent layer stateless and independently testable. 

## ElevenLabs Integration
ElevenLabs is used as **two stateless audio services only — STT and TTS** (updated 2026-06-07). HiveKitchen owns the realtime transport (its own `GET /v1/voice/ws` WebSocket), session lifecycle, and turn management; the browser does client-side VAD and sends complete utterances.
- **STT:** ElevenLabs Scribe (`scribe_v1`) via REST `POST /v1/speech-to-text` — synchronous request/response, NOT a webhook.
- **TTS:** ElevenLabs `/v1/text-to-speech/{voice}/stream` (server-side) or the browser-direct `/stream-input` WebSocket for narration.
- The conversational reply is always generated by HiveKitchen's OpenAI agent (LumiAgent / OnboardingAgent), never by ElevenLabs.
- **No ElevenLabs Conversational AI ("ConvAI") Agent**: no `agent_id` / `get_signed_url`, no ElevenLabs-hosted LLM, no ElevenLabs webhook or signing secret. Reference implementation: story 2.6b.

## Monorepo Structure (Turborepo + pnpm)
- `apps/web` — React + Vite frontend (Lumi Client): Shadcn, Tailwind, Zustand
- `apps/api` — Fastify + Node.js backend (HiveKitchen API): Zod, Pino
- `packages/contracts` — Shared Zod schemas (API request/response shapes ONLY)
- `packages/types` — TypeScript types inferred from contracts (z.infer<>)
- `packages/tsconfig` — Shared base tsconfig presets

## Specs (read before generating code)
- `docs/DESIGN.md` — canonical v2.0 design system spec (tokens, components, button taxonomy, StickyBottomBar pattern, Honey rule). **READ FIRST before any UI work.**
- `docs/Technical Architecture.md` — system architecture and stack reference
- `docs/Voice Interaction Design.md` — ElevenLabs voice pipeline design
- `docs/AI Principles.md` — AI agent design principles
- `docs/Product Concept .md` — product vision and concept
- `docs/Backend_Architecture.md` — backend service architecture
- `docs/OnboardingPrompt.md` — onboarding agent prompt reference


## Conventions
- TypeScript everywhere — strict mode
- Fastify for API, Vite + React for web
- Tailwind CSS for styling — no CSS modules, no styled-components
- Zustand for client state
- SSE for real-time (not WebSocket, except ElevenLabs voice)
- All database access goes through the API layer only — never from agents
- pnpm for package management

## Git
- Conventional commits: feat:, fix:, docs:, refactor:, chore:
- Branch naming: feat/<name>, fix/<name>, docs/<name>
- Never commit secrets, .env files, or node_modules

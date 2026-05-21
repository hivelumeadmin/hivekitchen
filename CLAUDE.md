Before implementing, read _bmad-output/project-context.md.
# HiveKitchen — Claude Code Instructions
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
ElevenLabs owns the entire audio pipeline — capture, speech-to-text, text-to-speech, and WebSocket turn management. HiveKitchen owns everything else.

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
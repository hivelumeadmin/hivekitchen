---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-04-22'
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/product-brief-2026-04-18.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
  - _bmad-output/brainstorming/brainstorming-session-2026-04-17-1940.md
guidanceDocuments:
  - docs/Technical Architecture.md
  - docs/Backend_Architecture.md
  - docs/Voice Interaction Design.md
excludedDocuments:
  - docs/Design System.md
  - docs/Product Concept .md
  - docs/AI Principles.md
inputDocumentsUsage: |
  Planning-artifacts (PRD, Brief, UX Spec, Brainstorming) are authoritative.
  docs/ architecture files are guidance only — inherited where sound, overridden
  where the PRD/UX Spec point to a better architecture. Per user instruction:
  "use it as a guidance document but do what's best for HiveKitchen based on
   planning-artifacts. If you feel there is better architecture don't hesitate."
amendmentsApplied:
  - 'A-M (Step 4 party-mode review by Winston/Mary/John/Sally/Amelia)'
  - 'N-Q (cost-discipline pass)'
  - 'R-T (Step 4 Occam''s Razor pass)'
  - 'V-MM (Step 6 critique-and-refine pass)'
project_name: 'HiveKitchen'
user_name: 'Menon'
date: '2026-04-22'
---

# Architecture Decision Document — HiveKitchen

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

**Posture:** Challenger. Planning-artifacts lead. Existing `docs/` architecture is a starting reference, not a spec to rubber-stamp. Where PRD/UX Spec expose a better architecture, we take it.

## Pre-Step-1 Rulings (locked before context analysis)

### Safety Architecture — Two-Layer Allergy Model

The Allergy Guardrail Service is the sole authority on whether a plan may render to any user. It is a deterministic, rule-based post-filter that runs outside the Agent Orchestrator's process boundary and cannot be bypassed or prompt-injected. The presentation layer reads only from guardrail-cleared plan records, never from agent output directly (Journey 5 contract; PRD FR76, FR77).

The OpenAI Agents SDK planner agent may call an advisory `allergy.check` tool during plan generation to self-correct before the guardrail sees the plan. This reduces regeneration rate, protects the <90s plan-generation SLO, and protects the <$0.25/plan LLM cost ceiling — but a tool-cleared plan is **not** a guardrail-cleared plan. The tool is defense-in-depth, not the gate.

The `allergy.check` tool and the Allergy Guardrail Service call the **same allergy rule engine** (shared library). Two codepaths, one set of rules — no drift.

The `audit_log` records both tool invocations and guardrail verdicts so "why this recommendation?" and "what the LLM knew" remain answerable (PRD FR78, FR80).

## Project Context Analysis

### Requirements Overview

**Functional Requirements (127 total across 12 groups).**

| Group | FR range | Count | Architectural load |
|---|---|---|---|
| Family Profile & Onboarding | FR1–FR14 | 14 | Auth (Supabase), RBAC, VPC two-phase (soft → credit-card), voice-first onboarding → thread |
| Lunch Bag Composition | FR107–FR120 | 14 | Per-child bag-composition model; Main/Snack/Extra as first-class; policy scoping |
| Weekly Plan Lifecycle | FR15–FR26, FR118 | 12 | Agent-generated weekly plans, silent mutation, freshness contract, plan-as-scaffold |
| Household Coordination | FR27–FR31 | 5 | Shared thread, packer-of-the-day, presence (Figma), owner-transfer |
| Heart Note & Lunch Link | FR32–FR47, FR121–FR127 | 22 | Sacred-channel delivery (unmodified), one-time signed URLs, child 4-emoji tap, two-layer rating, Premium voice playback |
| Grocery & Pantry-Plan-List | FR48–FR55 | 8 | Silent pantry state (tap-to-purchase IS the update), store-mode, multi-store cultural-supplier split |
| Evening Check-in | FR56–FR64 | 9 | Voice (Premium unlimited / Standard 10-min cap) + unlimited text; passive enrichment; caption fallback; pull-initiated only |
| Visible Memory & Trust | FR65–FR75 | 11 | Editable/forgettable graph; soft vs hard forget; provenance ledger; authored prose (not panel); reset-flavor-journey |
| Allergy Safety & Guardrails | FR76–FR83 | 8 | Independent deterministic guardrail + presentation-layer contract + advisory agent tool |
| Billing & Tiers | FR84–FR94 | 11 | Stripe; school-year auto-pause; gift subs; credit-card VPC; A/B cohort assignment; 14-day refund |
| Ops & Incident Response | FR95–FR104 | 10 | Allergy anomaly dashboard; three-stage audit log; SLA escalation; survey instrumentation |
| Cross-cutting | FR105–FR106 | 2 | Notification preferences; user-vs-household profile split |

**Non-Functional Requirements — the hard constraints.**

- **Performance (p95):** first plan <90s; Evening Check-in text first-token <500ms, voice <800ms, voice turn-to-turn <600ms; Lunch Link delivery ≥99.5% by 7:30am local.
- **Core Web Vitals (p75):** Lunch Link LCP <1.0s target/<1.2s SLO, INP <100ms, CLS <0.02 — the strictest surface (child-facing).
- **Availability:** API 99.9% during school hours (6am–9pm local per user TZ); voice 99.5% with graceful text fallback; profile durability 99.999%.
- **Scalability:** 150 concurrent HH beta → 5,000 at public launch → 50,000 EOH1-2027; 3× school-morning peak (6–8am local across US TZs); weekend plan-generation batch in 36h, no HH >4h queue wait.
- **Security/Privacy:** TLS 1.3 only + HSTS preload; AES-256 at rest + application-layer encryption for allergen profile and Heart Note content; 15-min access / 30-day refresh rotation; strict CSP + COOP/COEP on authenticated surfaces; ElevenLabs the **only** third-party origin for voice; no third-party analytics/ad SDKs on any surface.
- **Compliance:** COPPA (16 CFR Part 312) + California AADC (AB 2273) + state minor-privacy patchwork + FDA FALCPA/FASTER Act allergens; GDPR/UK Children's Code readiness via architecture (not retrofit).
- **Accessibility:** WCAG 2.1/2.2 AA; readability CI check (Lunch Link ≤ grade 4, parent ≤ grade 8); TTS caption fallback; multilingual content rendering (Devanagari, Hebrew, Arabic RTL, Tamil, etc.) content-layer.
- **Cost SLOs:** <$0.25/plan LLM; <$1/mo/HH Standard voice; <$4/mo/HH Premium voice p95; <$0.50/HH infra at beta scale, <$0.20 at 10k+.
- **Reliability:** RPO ≤1h; RTO ≤4h for critical path (Lunch Link delivery, plan view, allergy guardrail); reconnect with exp backoff 1s × 2× ±20% jitter, cap 60s; multi-provider LLM failover within 15min.

### Scale & Complexity

- **Primary domain:** Regulated consumer AI — web application with voice pipeline. Multi-audience (parent SPA, child no-install link, grandparent gift flow, ops dashboard).
- **Complexity level:** **Medium-High.** Drivers:
  1. Unified voice↔text thread under one auth context with server-authoritative state and multi-client fan-out.
  2. Longitudinal, editable, forgettable family-intelligence graph (Visible Memory) as product-doctrine surface, not feature.
  3. Composable cultural-identity model (layered/additive/weighted — not categorical) propagating through plan generation, grocery routing, recipe sourcing.
  4. COPPA/AADC compliance posture with two-phase VPC and payload-scrubbing discipline.
  5. Non-negotiable allergy safety (two-layer: deterministic authoritative guardrail + advisory agent tool).
  6. School-morning peak traffic and weekend plan-generation batch scheduling across US timezones.
  7. Four-scope UX enforced at design-system + lint level.
- **Estimated architectural components:** ~20–25 modules (auth, households, children, profiles, visible-memory, plans, lunch-bag, pantry, grocery, cultural-templates, cultural-suppliers, heart-notes, lunch-links, thread, evening-checkin, allergy-guardrail, allergy-rules, voice-sessions, webhooks, billing, gifts, ops-dashboard, audit, agent-orchestrator, agent-tools, compliance).

### Technical Constraints & Dependencies

**Locked technology decisions (inherited from Brief, PRD, UX Spec, CLAUDE.md):**
- Monorepo: Turborepo + pnpm. Apps: `apps/web` (Vite SPA, **not Next.js** — PRD overrides `docs/Technical Architecture.md`), `apps/marketing` (Astro or vite-ssg pre-auth static), `apps/api` (Fastify/Node TypeScript strict). Shared: `packages/contracts` (Zod, API boundary), `packages/types` (z.infer), `packages/ui` (shared components), `packages/tsconfig`.
- Frontend: React + Vite + TypeScript; Shadcn/UI (copy-in) + Tailwind + Radix; **Zustand for UI state**; **TanStack Query for server state**; **SSE as invalidation bus** (not data channel); ElevenLabs client SDK for voice only.
- Backend: Fastify with strict Zod schemas at every route boundary; Supabase (Postgres + Auth + Storage); Redis (rate-limit, SSE fan-out buffer, session store, plan-generation queue); Pino structured logging; OpenTelemetry; OpenAPI/Swagger generated from Zod.
- AI: OpenAI Agents SDK (triage/router + specialist planner/nutrition/support agents, tool-based); tool boundary owned by API layer — agents never touch DB directly.
- Voice: ElevenLabs used exclusively for STT and TTS via **browser-direct WebSocket connections** with single-use tokens (per ADR-002 — Ambient Lumi, 2026-04-29). HiveKitchen owns the LLM layer (OpenAI), turn management, thread persistence, and token issuance. No ElevenLabs Conversational AI SDK. Two separate browser-direct WebSocket connections per tap-to-talk session: STT (`wss://api.elevenlabs.io/v1/Speech-to-Text/?single_use_token={token}`) and TTS (`wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input?single_use_token={token}`). HiveKitchen API issues one STT token + one TTS token per talk session (`POST /v1/lumi/voice/sessions`); the permanent ElevenLabs API key never reaches the browser. Raw audio never transits the HiveKitchen API — only text crosses the HiveKitchen boundary. No inbound ElevenLabs webhook.
- Billing: Stripe (SAQ-A; credit-card VPC; school-year auto-pause).
- Delivery: SendGrid (email Lunch Link + Heart Note), Twilio (SMS/WhatsApp Lunch Link).
- CDN: Cloudflare or equivalent with explicit SSE config (`Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, ≤30s heartbeat, ≥6h event-log retention for `Last-Event-ID` replay).

**External dependencies with executed DPAs required:** ElevenLabs, SendGrid, Twilio, Supabase, Stripe, OpenAI/Anthropic (zero data retention flag), internal analytics (first-party only).

**Hard constraints the architecture must honor:**
- **Agents never touch the Data Layer directly.** All reads/writes flow through the API's repository layer.
- **Allergy Guardrail sits outside the Agent Orchestrator's process boundary** and is the sole authority for "renderable." Agent may call a shared `allergy.check` tool for defense-in-depth; tool-cleared ≠ guardrail-cleared.
- **Presentation layer reads only from guardrail-cleared plan records** (Journey 5 contract; race caused a 94-second stale render).
- **Safety-Classified Field Model** enforced at the write path — server-authoritative fields (allergy, Heart Note send, billing, VPC, memory-forget, template changes) cannot be optimistically rendered as committed; non-safety fields use TanStack Query optimistic-with-rollback.
- **Strict module boundaries** — each feature owns routes/service/repository/schema; services throw domain errors; repositories are the only files that import Supabase SDK; no file outside `plugins/` imports an SDK directly.
- **SSE is invalidation-only** (with one streaming exception for thread turns via `setQueryData`).
- **Multi-client fan-out with server-assigned monotonic sequence IDs** for thread ordering (voice STT lands late; client clocks cannot be trusted).
- **One-time signed Lunch Link URLs** with session-scoped RBAC (child view, no account, no cookies, no fingerprinting, 24h IP abuse log max).
- **No third-party scripts on authenticated or child-facing surfaces.**
- **API versioning via URL path** (`/v1/`); ≥90-day parallel-serve overlap before removing a versioned endpoint.

### Cross-Cutting Concerns

These affect multiple components and must be designed centrally, not per-module:

1. **Conversation thread as system spine.** Voice turns, text turns, and tap-initiated system events are peers in one append-only log with server-assigned monotonic sequence IDs. Thread state must survive modality switches, multi-client fan-out, ElevenLabs webhook latency (STT arrives after tap emissions), and resume tokens.
2. **Safety-Classified Field Model.** A single authoritative enumeration (already in PRD §10) governs optimistic-vs-authoritative write discipline across every feature module.
3. **Audit log as compliance + ops + explainability substrate.** Immutable append-only, covers allergy decisions, plan generation stages, Heart Note authorship/delivery, Visible Memory edits, billing, VPC events, account deletions. Three-stage plan-generation audit (guardrail verdict + LLM regeneration + presentation cache state) per Journey 5.
4. **Audit / telemetry / logging / SSE fan-out as a single observable backbone.** Request ID spans Pino logs, audit rows, SSE events, and agent-run traces so every user-visible surface is reconstructable.
5. **Visible Memory as doctrine + compliance + product surface.** The parental review dashboard (COPPA/AADC) and the Visible Memory prose panel are the **same surface**; architecture cannot split compliance-view from product-view without drift.
6. **Cultural-template composition.** Layered/additive/weighted — propagates through plan generation, grocery routing (cultural-supplier directory), Seed Library, and child-facing flavor passport. Cannot be retrofitted to a categorical model.
7. **Cost observability per household per tier.** Voice cost, LLM cost per plan, per-HH dashboards with 95th-percentile soft caps — must be live day-1 of beta or the <$1/mo Standard and <$4/mo Premium SLOs are unmeasurable.
8. **School-morning peak load management.** Lunch Link delivery surge 6–8am across US TZs; 3× baseline; SendGrid/Twilio per-channel fallback within 30 minutes.
9. **Weekend plan-generation batch scheduling.** Fri PM → Sun AM generation window; queue with per-household scheduling across TZs; no HH waits >4h; cost and LLM-provider capacity pre-reserved.
10. **Multilingual content rendering.** Heart Notes contain Devanagari, Hebrew, Arabic (RTL), Tamil, etc. Content layer, not UI-i18n layer.
11. **Connectivity-loss degradation (store mode + voice pipeline + SSE).** Honest fail states per PRD; optimistic check-offs preserve as pending; voice→text fallback; reconnect storm prevention.
12. **Payload scrubbing.** Any future recipe-sharing surface strips child-identifying fields before egress; must be wired as a boundary filter, not per-call discipline.
13. **Scoped runtime enforcement.** Four UX scopes (`.app-scope`, `.child-scope`, `.grandparent-scope`, `.ops-scope`) enforced via Tailwind variants + ESLint component allowlists + route layout — architectural, not convention.
14. **Idempotency and eventual consistency at the plan edge.** Sick-day pause + school-policy diff + leftover-swap + cultural-calendar injection can all mutate future plans concurrently; needs per-plan revision versioning and conflict resolution rules.

## Starter Template Evaluation

### Primary Technology Domain

Multi-app monorepo: web SPA (authenticated) + marketing SSG + Node.js REST API + four internal packages. No single starter template spans this architecture. The repository is already scaffolded and partially built; this section codifies the **delta between the existing scaffold and the target architecture**, not a fresh bootstrap.

### Starter Options Considered

| Option | Verdict | Rationale |
|---|---|---|
| **T3 Stack / create-t3-app** | Rejected | Couples Next.js + tRPC + Prisma + NextAuth. Our PRD locks Vite SPA (not Next), Fastify REST with Zod contracts (not tRPC), Supabase (not Prisma), Supabase Auth (not NextAuth). Adopting T3 would require ripping out ~60% of what ships. |
| **RedwoodJS / Blitz** | Rejected | Full-stack framework opinions that conflict with the Agent Orchestrator boundary (agents never touch DB), the Safety-Classified Field Model, and SSE-as-invalidation-bus. |
| **Next.js + Vercel starter** | Rejected | `docs/Technical Architecture.md` references Next.js, but the PRD and UX Spec lock **Vite SPA + separate Astro marketing app**. Next's server+client overlap dilutes the SSE-as-invalidation-bus model and the hard authenticated-vs-marketing split. |
| **Turborepo `create-turbo` examples** | Informative, not adopted | Good reference for Turborepo conventions, but our monorepo layout is already in place and hand-tuned (`apps/web`, `apps/api`, `packages/{contracts,types,tsconfig}`). A fresh scaffold would regress. |
| **Existing repo + targeted CLIs** | **Selected** | Honor the existing scaffold. Close the delta with CLIs for the components that have authoritative bootstrappers (shadcn/ui, Astro, TanStack Query addition, Supabase client, OpenAI Agents, ElevenLabs). Manually scaffold what lacks a CLI (`packages/ui`, additional Fastify plugin wiring, test infra). |

### Selected Approach: Existing Monorepo + Targeted Scaffolds

**Rationale for selection:**

The existing scaffold already encodes the locked architectural decisions from PRD §6 and the UX Spec: Turborepo + pnpm workspaces; Vite SPA with React 19 + TypeScript strict; Fastify 5 + Zod + Pino; shared `packages/contracts` as the Zod-first API boundary. A fresh starter would discard this work for no architectural gain.

What's missing is layered on top via targeted CLIs:

| Gap | Resolution |
|---|---|
| `apps/marketing` does not exist | `pnpm create astro@latest apps/marketing --template minimal --typescript strict` — Astro chosen over vite-ssg because its islands model + zero-JS-by-default + MDX-native content match the UX Spec's demand for <1.5s LCP on landing/pre-login-demo and no third-party scripts on authenticated-adjacent surfaces. |
| `packages/ui` does not exist | Manual scaffold — empty workspace package configured as shadcn/ui's component output target so both `apps/web` and `apps/marketing` consume the same components. Registered in `pnpm-workspace.yaml` (already covered by `packages/*` glob). |
| Shadcn/UI components not installed in `apps/web` | Run shadcn CLI v4: `pnpm dlx shadcn@latest init --base radix --template vite` from `apps/web/`, then `pnpm dlx shadcn@latest add <component>` incrementally per epic story. **Do not install Shadcn's Toast, Sonner, or Dialog-for-confirmation-gates** (banned per UX Spec Evolution 3/4). |
| Server state layer not present | Add `@tanstack/react-query` (v5.99+) + `@tanstack/react-query-devtools`. Central `QueryClient` + SSE→queryClient dispatcher in `apps/web/src/lib/sse.ts`. |
| Supabase client not present | Add `@supabase/supabase-js` (v2.103+) to `apps/api`. Wrapped as a Fastify plugin (`apps/api/src/plugins/supabase.plugin.ts`). No direct imports outside `plugins/` and `repository/` (hard constraint). |
| OpenAI Agents SDK not present | Add `@openai/agents` + `@openai/agents-openai` to `apps/api` as the **internal agent runtime**, wrapped behind a domain-specific orchestrator interface. SDK types confined to `apps/api/src/agents/*`; never imported from `services/` or `routes/`. The SDK's own session and guardrail features are deliberately not used — thread identity and allergy safety belong to HiveKitchen services, not the SDK. Provider adapter pattern in place from day 1 so a second LLM provider (Anthropic SDK) can slot in for the NFR-mandated 15-minute failover capability. |
| ElevenLabs integration not present | Add `@elevenlabs/react` to `apps/web` (client-side SDK, WS managed by SDK per PRD § Voice). Add `@elevenlabs/elevenlabs-js` to `apps/api` (server-side token provisioning and webhook signature verification). |
| Fastify security + docs plugins not installed | Install `@fastify/cors`, `@fastify/helmet`, `@fastify/jwt`, `@fastify/rate-limit`, `@fastify/swagger`, `@fastify/swagger-ui`, `@fastify/cookie`, `@fastify/csrf-protection`, `@fastify/sensible`, `fastify-sse-v2`, `@fastify/multipart` (for memory export; FR71). |
| Redis client not present | Add `ioredis` to `apps/api` (SSE fan-out buffer + rate-limit store + plan-generation job queue via BullMQ). |
| Billing + delivery clients not present | Add `stripe`, `@sendgrid/mail`, `twilio` to `apps/api`. Each wrapped as a plugin; never imported outside `plugins/`. |
| Test infrastructure not present (PRD flags 4 required packages) | Add `vitest`, `@vitest/ui`, `@vitest/browser-playwright` to workspace root. Add `@playwright/test`, `@axe-core/playwright`, `@lhci/cli` to workspace root. Add `eventsource-mock` (or equivalent) for SSE integration harness. |
| Dev tooling gaps | Add `eslint` + `@typescript-eslint/*` + `eslint-plugin-boundaries` (for enforcing the agents-don't-import-Fastify rule and the scoped-component-allowlist rule at CI time). Add `prettier` with the project's existing conventions. Add `pino-pretty` as a dev-only dependency in `apps/api`. |
| Supabase migration tooling | `supabase` CLI (installed globally or via `pnpm dlx`) with migrations committed under `supabase/migrations/` at repo root. |

**Architectural decisions the existing scaffold provides (honored, not rescaffolded):**

- **Language & runtime:** TypeScript strict across all apps and packages. Node 22+ target. ESM only (`"type": "module"`).
- **Monorepo build tool:** Turborepo 2.4 with per-app `dev`/`build`/`lint`/`typecheck`/`clean` tasks.
- **Package manager:** pnpm 9.15 with workspace protocol (`workspace:*`) for internal deps.
- **Frontend build:** Vite 6 with `@vitejs/plugin-react`; PostCSS + Tailwind 3.4 + Autoprefixer.
- **Backend runtime:** Fastify 5 with `tsx watch` for dev hot-reload; `tsc` for production build.
- **Schema-first API boundary:** `packages/contracts` holds Zod schemas for every request/response shape; `packages/types` exports `z.infer<>` derivations.

**Architectural decisions the scaffolds add:**

- **Component library:** shadcn/ui v4 via copy-in (owned in `packages/ui`), Radix primitives under the hood. Scope-aware allowlists enforced via ESLint.
- **Styling:** Tailwind (already present) + semantic token evolution per UX Spec Evolution 1 (`sacred-*`, `lumi-*`, `safety-cleared-*`, `memory-provenance-*` token groups).
- **Client state split:** Zustand (UI state) + TanStack Query (server state) + SSE (invalidation bus). Central dispatcher in `apps/web/src/lib/sse.ts` routes typed `InvalidationEvent` to `queryClient.invalidateQueries()`/`setQueryData()`.
- **Auth:** Supabase Auth (email/password + Google/Apple OAuth for Primary Parents) with server-managed session exchange on OAuth callback.
- **Agent orchestration (locked):** OpenAI Agents SDK is an implementation detail behind a domain orchestrator. No SDK type escapes `apps/api/src/agents/`. Thread state, session identity, audit logging, and allergy safety are owned by HiveKitchen services. Provider adapter pattern from day 1 so a second LLM provider (Anthropic SDK) can slot in behind the same interface for the NFR-mandated 15-minute failover capability. Each plan generation writes four audit rows: context-loaded, tool-calls (one per call), llm-output, guardrail-verdict.
- **Voice:** ElevenLabs client SDK for the WebSocket (client-side only); `@elevenlabs/elevenlabs-js` on the server for token provisioning and inbound webhook signature verification.
- **Real-time:** SSE via `fastify-sse-v2`; WebSocket is ElevenLabs-only.
- **Billing/delivery/cache/queue:** Stripe, SendGrid, Twilio, ioredis, BullMQ — each behind a Fastify plugin.

### Initialization Commands

```bash
# Marketing app (new)
pnpm create astro@latest apps/marketing -- --template minimal --typescript strict --no-git --no-install --skip-houston
# Then edit apps/marketing/package.json name → "@hivekitchen/marketing" and add to turbo.json tasks

# Web app: add Shadcn scaffolding + TanStack Query + ElevenLabs React
cd apps/web
pnpm dlx shadcn@latest init --base radix --template vite --yes
pnpm add @tanstack/react-query @tanstack/react-query-devtools @elevenlabs/react react-router-dom react-hook-form

# API: add all server-side dependencies
cd apps/api
pnpm add @supabase/supabase-js @openai/agents @openai/agents-openai \
         @elevenlabs/elevenlabs-js stripe @sendgrid/mail twilio ioredis bullmq \
         @fastify/cors @fastify/helmet @fastify/jwt @fastify/rate-limit \
         @fastify/swagger @fastify/swagger-ui @fastify/cookie \
         @fastify/csrf-protection @fastify/sensible @fastify/multipart \
         fastify-sse-v2

# Shared UI package (new, empty)
mkdir -p packages/ui/src
# hand-write packages/ui/package.json, tsconfig.json, src/index.ts (empty barrel)

# Test infrastructure (workspace root)
pnpm add -D -w vitest @vitest/ui @vitest/browser-playwright \
                @playwright/test @axe-core/playwright @lhci/cli \
                eventsource-mock msw

# Lint/format tooling (workspace root)
pnpm add -D -w eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser \
                eslint-plugin-boundaries eslint-plugin-react eslint-plugin-react-hooks \
                eslint-plugin-jsx-a11y prettier pino-pretty

# Supabase CLI (global install, for migrations)
# Install per-platform; the project ships supabase/migrations/ at repo root

# Playwright browsers (one-time)
pnpm exec playwright install --with-deps
```

**Note:** Project bootstrap and dependency-install should be the **first implementation story** of the first Epic. Each subsequent Epic story adds components/modules into the existing scaffolds, not new top-level starters.

### Gaps Deferred to Later Architecture Steps

The following starter-level gaps are intentionally not closed here — they belong in Step 4 (decisions) or Step 6 (structure):

- Deployment target choice (Vercel vs. Railway vs. Fly.io vs. self-managed). Impacts SSE behavior through CDN (Cloudflare buffering config is already PRD-mandated regardless).
- CI/CD platform (GitHub Actions already named in `docs/`; ADR needed for deploy triggers, visual regression gates, Lighthouse CI budgets per route).
- Observability backend (OpenTelemetry is named; collector + backend target is not).
- Object storage layout under Supabase (Heart Note voice artifacts, cultural-template assets, backup/archive separation).
- Feature-flag mechanism (cohort assignment per FR103 needs durable store with audit).
- **Provider adapter contract shape (Step 5 Patterns):** what does `LLMProvider.complete(prompt, tools, options)` look like such that OpenAI Agents SDK, hand-rolled OpenAI client, and a future Anthropic client all implement it without leaking vendor types? This is the interface that makes the 15-minute failover NFR practically achievable.

## Core Architectural Decisions

Amendments from Step 4 Party Mode (Winston / Mary / John / Sally / Amelia) are integrated inline below. Decisions marked **[amended]** carry a one-line note naming the source; unannotated decisions passed the party review unchanged.

### Decision Priority Analysis

**Already decided (inherited from PRD / UX Spec / Step 3 starter):**
- Monorepo Turborepo + pnpm. Apps: `apps/web` (Vite SPA), `apps/marketing` (Astro SSG, new), `apps/api` (Fastify 5). Packages: `contracts` (Zod), `types` (z.infer), `ui` (new, shadcn-copied-in), `tsconfig`.
- Language: TypeScript strict, Node 22+, ESM only.
- Frontend: React 19 + Vite 6 + Tailwind 3.4 + shadcn/ui v4 + Zustand (UI) + TanStack Query (server state) + SSE invalidation dispatcher.
- Backend: Fastify 5 + Zod + Pino + OpenAPI/Swagger.
- Data: Supabase Postgres + Supabase Auth + Supabase Storage + Redis (via ioredis + BullMQ).
- AI: OpenAI Agents SDK as internal runtime behind a domain orchestrator + LLMProvider adapter (Branch-C hybrid, Step 3 ruling).
- Voice: ElevenLabs (client SDK WS + server token + webhook).
- Billing/Delivery: Stripe + SendGrid + Twilio.
- Safety: Allergy Guardrail Service outside agent boundary (authoritative); advisory `allergy.check` agent tool (defense-in-depth); shared rule engine; **single-row plan audit with multi-stage `stages JSONB[]`**, `correlation_id = plan_id`, `event_type` discriminator, composite index `(household_id, event_type, correlation_id, created_at)` **[amended — Amelia: needs correlation_id for FR78/FR80 query plannability; Occam's pass: collapsed from four-rows-per-plan to one-row to drop ~75% audit volume at 50k HH × 5k plans/wk]**.
- Transport: REST for state changes; SSE as invalidation bus; WebSocket for voice only.
- URL versioning: `/v1/` with ≥90-day parallel-serve.

**Critical decisions (block implementation):** multi-tenancy / household scoping; Visible Memory data model; session / cookie posture; Lunch Link URL signing; error response shape; SSE channel model; webhook auth; hosting target; feature flags.

**Important decisions (shape architecture):** envelope encryption scope; caching tier semantics; routing lib; form lib; animation; observability backend; migration tooling; backup/DR model; env/secret management.

**Deferred:** Supabase Edge Functions for RAG retrieval (revisit if in-process latency exceeds 15s); pgvector index tuning beyond initial params (revisit at 5k HH); multi-region DB (not needed until 50k HH); GrowthBook (deferred to post-launch per amendment K).

---

### 1. Data Architecture

**1.1 Multi-tenancy / scoping — `household_id` on every row + Postgres Row-Level Security policies + `current_household_id` JWT claim.**
- Supabase RLS enforces at the DB boundary — defense-in-depth if service-layer code forgets to scope. Household is the unit of data ownership (not user; multi-parent households share).
- Every table carries `household_id NOT NULL` (exceptions: `users`, `audit_log`, `allergy_rules`, cross-household reference tables).

**1.2 Visible Memory data model — hybrid relational core + JSONB provenance sidecar + pre-composed prose on the Brief projection [amended — Sally + Amelia].**
- Core table `memory_nodes`: `(id uuid pk, household_id uuid not null, node_type enum('preference','rhythm','cultural_rhythm','allergy','child_obsession','school_policy','other') not null, facet text not null, subject_child_id uuid null, prose_text text not null, soft_forget_at timestamptz null, hard_forgotten boolean not null default false, created_at timestamptz not null, updated_at timestamptz not null)`.
- Sidecar `memory_provenance` (1-to-many): `(id uuid pk, memory_node_id uuid fk, source_type enum('onboarding','turn','tool','user_edit','plan_outcome','import') not null, source_ref jsonb not null, captured_at timestamptz not null, captured_by uuid null, confidence numeric(3,2) not null, superseded_by uuid null)`.
- **Pre-composed prose on projection:** the per-household `brief_state` projection (1.5) carries a `memory_prose` snapshot column populated by an upstream composer at plan-compose time. The Brief never joins core + sidecar at render. Sidecar is for audits, source-ledger chips on tap, and plan-generation context loads — not for the ambient-memory render path (Sally: "ambient memory must not become uncanny-valley memory").
- Forget semantics: `soft_forget_at` keeps the row inactive-retained; nightly job promotes soft → hard at `soft_forget_at + 30d`. Hard forget writes a tombstone row to `audit_log` then purges `memory_nodes` + cascades to `memory_embeddings` row + `memory_provenance` rows. Both routes audit-logged with `category='memory.forget'`.
- Rejected: pure JSONB blob (forget semantics complex, indexable facets lost); event-sourced log-only (rebuild on read hurts <90s plan-generation SLO).

**1.3 pgvector — `hnsw` for append-only writes, `ivfflat` for static catalogue [amended — Winston].**
- `memory_embeddings` and `thread_turn_embeddings` use **`hnsw`** index (pgvector 0.5+). Append-only growth with 50k HH makes ivfflat's reindex treadmill a 12-month operational tax.
- `recipe_embeddings` uses **`ivfflat`** with `lists = 100` at beta; Seed Library writes are rare, tuning once is fine.
- Embedding model per table (Amelia): `text-embedding-3-small` → 1536 dim for memory + recipe; `text-embedding-3-small` → 1536 dim for thread turns. Single model, single dim, no coin-flip.

**1.4 Migration tooling — Supabase CLI migrations, file-per-change, committed to `supabase/migrations/`. No ORM.**
- Types via `supabase gen types typescript`. CI gate: `supabase db diff` against migration history; drift fails CI.

**1.5 Caching strategy — three explicit tiers [amended — Winston: projection table not materialized view].**
- **Tier A (Redis, short-lived, cross-instance):** plan records (key `plan:{plan_id}`, 15-min TTL, invalidated on plan mutation), allergy-guardrail verdicts (key `guardrail:{plan_id}`, no TTL until plan mutation — a verdict is a fact), ElevenLabs session records, rate-limit counters.
- **Tier B (Postgres projection table, app-writer-maintained):** `brief_state` per household — Moment + Note + Thread composition + `memory_prose` snapshot. **Not** a `MATERIALIZED VIEW` (PG MVs don't refresh incrementally without extensions; refresh storms at 5pm local cross-TZ are real). Maintained by the application writer on `plan.updated`, `memory.updated`, `thread.turn` events. Writes idempotent; reads are a single-row SELECT by `household_id`.
- **Tier C (Cloudflare CDN, long-lived):** cultural-template assets, Seed Library recipe thumbnails, Astro marketing output, static images. No authenticated content ever caches at CDN.
- TanStack Query stale-while-revalidate sits on top of Tier B for the <3s Brief-render SLO (UX Spec M3).

**1.6 Audit log — monthly partitions; 90d hot + cold archive; billing/tax 10y, COPPA categories 12-month minimum [amended — Mary + Amelia].**
- Partition key: `DATE_TRUNC('month', created_at)`. Hot categories: `allergy.*`, `billing.*`, `vpc.*`, `account.*` stay in hot storage 90d then archive as gzipped JSON with SHA-256 to Supabase Storage cold bucket. Other categories rotate to cold after 30d.
- **Retention [amended]:** billing/tax categories **10 years** (Mary: CA FTB + TX franchise tax look-back exceed federal 7y IRS floor; Brief names CA/TX/FL as primary markets). COPPA categories 12-month minimum; safety-audit categories 7y.
- **Schema [amended — Amelia + Occam R]:** `(id uuid pk, household_id uuid null, user_id uuid null, event_type audit_event_type not null, correlation_id uuid null, request_id uuid not null, stages jsonb null, metadata jsonb not null, created_at timestamptz not null)`. **One row per logical action.** For plan generation, the row carries `event_type='plan.generated'` + `correlation_id=plan_id` + `stages=[{stage:'context_loaded',...}, {stage:'tool_call',name:'allergy.check',...}, {stage:'llm_output',...}, {stage:'guardrail_verdict',verdict:'cleared',...}]` (preserves Journey 5 three-stage timeline + guardrail verdict). For non-multi-stage actions (memory edit, billing change, Heart Note send) `stages` is null; `metadata` carries the payload.
- Composite index `(household_id, event_type, correlation_id, created_at)`. FR78/FR80 timeline reconstruction is a single-row read; `correlation_id = session_id` for voice flows; `correlation_id = thread_id` for Heart Note flows.
- **Cross-cutting queries** (e.g., "all guardrail rejections in March") served by a partial index `ON audit_log (created_at) WHERE event_type='plan.generated' AND stages @> '[{"verdict":"rejected"}]'` OR a denormalized side table `guardrail_rejections` written alongside the audit row when rejection occurs. Either works; chosen at implementation time per ops query patterns.
- **Why one row, not four:** Occam's pass found four-rows-per-plan paid 75% extra audit volume at 50k HH × 5k plans/wk for the convenience of `WHERE category = 'guardrail.rejection'` over `stages @> '[{"verdict":"rejected"}]'`. Partial-index alternative closes the convenience gap with negligible overhead. Single-row writes also reduce audit-write failure surface from four points to one.

---

### 2. Authentication & Security

**2.1 Session cookie posture — access bearer (15m) + refresh cookie (30d) rotating-on-use.**
- Access token: `Authorization: Bearer` header, client-side in Zustand (not localStorage).
- Refresh token: httpOnly + Secure + SameSite=Lax + Path=/v1/auth/refresh + rotation-on-use (reused token → revoke-all for user).
- CSRF: double-submit-cookie on state-changing POST/PATCH/DELETE.

**2.2 Secondary Caregiver / Guest Author invites — signed JWT invite tokens, single-use via jti + `invites` table [amended TTL — Mary].**
- **Secondary Caregiver invites: 14-day TTL** (Mary: multi-generational household stakeholder — grandparent-as-Secondary-Caregiver case; 7d under-serves weekly-email users).
- **Guest Author invites: 7-day TTL** (sacredness cap; higher-frequency rotation acceptable).
- JWT claims: `household_id`, `role` (secondary_caregiver | guest_author), `invite_id`, `exp`, `jti`. Redemption atomically writes `invites.redeemed_at`; reuse → 410 Gone.

**2.3 Lunch Link URL signing — HMAC-SHA256(child_id, date, nonce, exp=8pm_local) + server-side redemption state [amended AC — Amelia].**
- URL: `/lunch/{base64url(payload)}.{hex(hmac)}`. HMAC key rotates daily; previous-day key retained 24h for clock-skew.
- `lunch_link_sessions(child_id, date, nonce, first_opened_at, rating_submitted_at, rating, reopened_after_exp_count)`.
- **Post-8pm semantics [amended]:** GET after `exp` returns **410 Gone** with `Problem+JSON { type: "/errors/link-expired", last_state_snapshot: {heart_note_excerpt, bag_preview, rating_if_submitted} }`. Ratings frozen; re-open attempts increment `reopened_after_exp_count` (ops anomaly signal).
- **Grace window [amended]:** submission within **60 seconds after `exp`** accepted (offline-device clock drift); submission beyond grace → 410.
- Sibling-device: separate `nonce` per `(child, device-open-event)`. No cross-child signal leakage.

**2.4 Envelope encryption — extended scope to Safety-Classified-Sensitive fields [amended — Mary].**
- Encrypted field set: `children.declared_allergens` (JSONB), `children.cultural_identifiers` (JSONB), `children.dietary_preferences` (JSONB), `heart_notes.content` (text), `households.caregiver_relationships` (JSONB).
- Rationale (Mary): California AB 2273 most-protective-defaults doesn't distinguish allergen vs. other child-sensitive data; the Brief centers culturally-identified households as a stakeholder voice. Narrowing to allergens alone fails the AADC DPIA standard.
- DEK per household, wrapped by Supabase Vault KEK. KEK rotation operational; DEK rotation triggers offline re-encryption job.
- Access to any encrypted field goes through an audit-logged decryption endpoint; ops/eng cannot casually read.

**2.5 Secret management — per-environment Zod-validated env config; `.env.local` for dev; Supabase Vault for staging and prod.**
- Startup fails loudly on missing/invalid env vars (`apps/api/src/common/env.ts`).
- **Dev:** `.env.local` gitignored. No managed secret store — local-only. Engineer copies a sanitized `.env.local.example` (committed) and fills in non-shared dev keys (or shared dev keys passed out-of-band).
- **Staging:** Supabase Vault. Bootstraps the app via a single `SUPABASE_SERVICE_ROLE_KEY` env var; everything else (Stripe test keys, SendGrid sandbox, Twilio test creds, ElevenLabs/OpenAI keys, GrowthBook key, HMAC signing keys) reads from Vault at startup and on rotation. Synthetic-data posture (§5.4) means the staging Vault holds **no real-user-data-decrypting** keys — it holds processor credentials only.
- **Prod:** Supabase Vault. Bootstraps the app the same way. Additionally holds runtime-rotating DEK wrap-keys for envelope encryption (§2.4).
- Rotation: quarterly for processor credentials; ad-hoc on suspected compromise. Vault rotation is operational; app reads on next process boot or on a `SIGHUP`-triggered reload.
- **Cost knock-on:** Supabase Vault is a Pro-plan feature. Staging therefore moves from Supabase Free to Supabase Pro (≈ +$25/mo). Staging cost envelope updated in §5.7.

---

### 3. API & Communication Patterns

**3.1 Error response shape — RFC 7807 Problem+JSON.**
- Shape: `{ type, title, status, detail, instance, request_id, ...extensions }`. Domain errors map to well-known `type` URIs (`/errors/validation`, `/errors/not-found`, `/errors/unauthorized`, `/errors/conflict`, `/errors/allergy-uncertainty`, `/errors/link-expired`, `/errors/idempotency-required`).
- Global Fastify error handler translates `common/errors.ts` domain error classes.

**3.2 Idempotency — required on all state-changing endpoints via `Idempotency-Key` header [amended AC — Amelia].**
- **Missing header [amended]:** gateway preHandler returns `400 Problem+JSON { type: "/errors/idempotency-required" }`. No per-route opt-out; exemption allowlist lives in `apps/api/src/plugins/idempotency.ts` config (auth endpoints only).
- **Key format:** UUIDv4, 16–128 chars.
- **Conflict semantics:** same key + different body hash → `409 Problem+JSON { type: "/errors/idempotency-conflict" }`.
- 24h Redis replay cache keyed by `(user_id, endpoint, key)`.
- Voice webhook: ElevenLabs `turn_id` serves as the idempotency key. Stripe webhook: Stripe event `id` serves.

**3.3 SSE channel model — one long-lived channel per `(user_id, client_id-per-tab)`.**
- `GET /v1/events?client_id={uuid}`; `client_id` in `sessionStorage` (independent per tab — supports Figma-style multi-parent presence).
- Resume: `Last-Event-ID` from Redis event-log (≥6h retention).
- Events typed via `InvalidationEvent` union in `packages/contracts`.

**3.4 ElevenLabs webhook auth — HMAC-SHA256 `X-Elevenlabs-Signature` header.**
- Validated on every call; mismatch → 401 + `category='voice.webhook.auth_failed'` audit row.
- Ops tracks signature-failure rate as a security signal.

**3.5 Tool-latency manifest + early-ack as default for agent-orchestrator chains [amended — Winston + John + Sally + Amelia, four-voice convergence; Occam T: declarations are the contract, sampling is the audit].**
- **`tools.manifest.ts` declares `maxLatencyMs` per tool.** Orchestrator computes estimated tool-chain budget up front.
- **Synchronous webhook response** only when `sum(estimated) ≤ 6000ms` (Sally + John: tight budget protects Lumi's calm-waits-on-parent character; <800ms first-token SLO demands it).
- **Early-ack fallback** when estimated chain > 6000ms OR actual runtime crosses 8000ms mid-execution.
- **Early-ack copy [amended — Sally]:** `"one sec"` (parent-authored-feeling). **Not** `"Let me pull that up..."` (chirpy, assistant-theatrical, violates Principle 1). For estimated 1.5–4s chains, emit a **non-verbal orb pulse** via SSE presence signal — no speech.
- **Payload [amended — Amelia]:** early-ack to ElevenLabs returns `{ response: "one sec.", continuation: { resume_token, expected_within_ms } }`. Continuation handler runs async, emits final spoken response via the thread's SSE channel; ElevenLabs plays acknowledgement first, then the continuation.
- Budget composition: 200ms thread load + 300ms intent classification + `sum(tool estimates)` + 500ms audit + persist. Any tool without a `maxLatencyMs` declaration fails CI.
- **Runtime audit of declarations [amended — Occam T]:** every tool invocation records actual latency to a Redis sliding-window histogram (`tool_latency:{tool_name}` with 24h window). A Grafana alert fires when sampled p95 > declared `maxLatencyMs × 1.5` for ≥1h sustained. Declarations are the **contract**; sampling is the **early-warning audit**. Without runtime sampling, a tool can drift slow without triggering the budget logic until the static `maxLatencyMs` is updated by a human — which won't happen if the contract isn't being looked at. With sampling, drift is alarmed in <2h.

**3.6 Rate limiting — `@fastify/rate-limit` + Redis store.**
- Per-household + per-endpoint + per-tier (Standard voice 10min/week per FR58; plan regen 5/week/HH; Lunch Link per-channel vendor caps).
- 429 in Problem+JSON with `Retry-After`.

---

### 4. Frontend Architecture

**4.1 Routing — React Router v7 data mode.**
- Loader/action primitives for session-bootstrap → Brief-land pattern. TanStack Router rejected: Query already owns server state; double ownership is drift.
- Route tree mirrors UX scopes: `/` → `/app/*` (app-scope); `/lunch/*` (child-scope); `/gift/*`, `/guest-author/*` (grandparent-scope); `/ops/*` (ops-scope, role-gated).

**4.2 Forms — react-hook-form + Zod resolver.**
- Every form imports schema from `@hivekitchen/contracts`. Server and client validate identically.

**4.3 Animation — CSS + Tailwind `animate-*` + View Transitions API; Framer Motion rejected [amended AC — Amelia + Sally].**
- `@keyframes` handles Heart Note warm-fade (600ms opacity+translate). View Transitions API handles quiet-diff slide-in on supported browsers.
- **Fallback [amended]:** feature-detect `document.startViewTransition`; fallback wraps in `flushSync` + Tailwind `animate-fade-in`. Playwright + Lighthouse CI enforce `CLS ≤ 0.05` on unsupported browsers (Firefox desktop, Safari < 18).
- **Sacred-channel motion curve [amended — Sally]:** the `sacred-*` token group owns not just color but motion — a dedicated `--sacred-ease` cubic-bezier. A dev reaching for `ease-out` on a Heart Note animation is doing something wrong by the token's semantics.
- ESLint rule bans `framer-motion` imports.

**4.4 Client-side monitoring — first-party via single `/v1/internal/client-anomaly` endpoint + compensating invariant telemetry [amended — Mary + Occam S].**
- No Sentry SDK (CSP posture + no-third-party-SDK-on-authenticated-surfaces).
- **Single endpoint [amended — Occam]:** `/v1/internal/client-anomaly` accepts a Zod-discriminated payload `{ kind: 'error' | 'thread_integrity' | 'guardrail_mismatch', ...kindSpecificFields }`. Server fans out to three backing tables (`client_errors`, `thread_integrity_anomalies`, `guardrail_mismatches`) with kind-specific schemas and Grafana dashboards. One client helper `reportAnomaly({kind, ...})`; one CSP allowlist entry; one rate-limit config; one Pino route.
- `client_errors` (kind='error'): `window.onerror` + `window.onunhandledrejection` payloads. PII scrubbed (no Heart Note content, no child names). 90d retention.
- **Compensating controls [amended — Mary]:**
  - `thread_integrity_anomalies` (kind='thread_integrity'): client detects missing SSE sequence IDs in a thread and reports `(thread_id, expected_seq, received_seq)`. Catches Journey-5-class silent state divergence between client and server thread state.
  - `guardrail_mismatches` (kind='guardrail_mismatch'): plan records carry the `guardrail_version` that cleared them; if the client renders a plan whose `guardrail_version` differs from the server's current published version, the client reports the mismatch. Catches stale-cache-renders-pre-guardrail-plan (the literal Journey 5 failure mode).
- These two beacons catch the silent-state-divergence failures that Sentry wouldn't have caught anyway. Compensating-control set is FTC-defensible: telemetry exists, scoped to the actual failure mode.

**4.5 Bundle — route-based code splits; voice chunk lazy-loaded on first voice-overlay open.**
- Standard-tier users who never tap voice don't pay the `@elevenlabs/react` bytes.
- CI fails if critical-path JS > 200kB gzipped on first load.

**4.6 Service Worker — minimal read-only SW for `/lunch/*` route only; parent-app SW deferred [amended — John + Sally].**
- **Lunch Link SW [amended]:** caches last successful GET by child token; on fetch failure, serves stale with a `last synced at HH:MM` timestamp. Scope: `/lunch/*` route only. Stale cache TTL: 24h (school-day window + overnight).
- Parent-app SW: still deferred per PRD §Connectivity (offline-read caching out of scope for MVP).
- Rationale: 7:30am local + 99.5% Lunch Link delivery + hostile cellular on school buses. Failure mode is emotional (child sees nothing, parent isn't there to recover). SW scope is small (~50 lines of Workbox); failure mode without it is invisible until a parent reports it.

---

### 5. Infrastructure & Deployment

**5.1 Hosting — Fly.io API (iad primary, dfw standby) + Cloudflare Pages web/marketing + Supabase managed + Upstash Redis [amended AC — Winston + Amelia].**
- **Region co-location [amended — Winston]:** Fly `iad` must co-locate with Supabase's us-east region. Verify end-to-end latency budget on the 6am PT → 9am ET Lunch-Link-delivery path before beta cutover. `dfw` standby is an RTO mechanism, not a peak-latency mechanism — labeled as such.
- **SSE routing [amended — Amelia]:** SSE must terminate at Fly.io API directly via `api.hivekitchen.*` subdomain. **Not** through Cloudflare Pages proxy (Pages Functions buffer/cap SSE on free tier; Last-Event-ID resume becomes theatre). Configure Cloudflare proxy as gray-cloud (DNS-only) for `api.hivekitchen.*` or disable orange-cloud for the SSE host. Keepalive `:ping\n\n` every 20s.
- Rationale for Fly over serverless: persistent-process SSE + ElevenLabs webhook budget + OTEL instrumentation. Rationale for Cloudflare Pages: CDN for static output, same vendor as API's required SSE buffering config.

**5.2 CI/CD — GitHub Actions + Turborepo filters.**
- Stages: install → lint → typecheck → unit (Vitest) → integration (Vitest + eventsource-mock + MSW) → E2E + a11y (Playwright + @axe-core/playwright) → LH budgets per route → deploy on merge to `main`.
- Visual regression: Chromatic or Playwright screenshots on `packages/ui`.

**5.3 Observability — Grafana Cloud (Loki + Tempo + Prometheus) via OpenTelemetry.**
- OTEL contract lets us swap backends without re-instrumenting. Grafana Cloud's cost curve to 50k HH is tighter than Datadog; Honeycomb is a viable backup.
- On-call via PagerDuty integration.

**5.4 Environments — three envs: dev, staging, prod [cost-aware tier split].**
- **Dev (local-only):** `supabase start` (Docker) for DB/Auth/Storage; `docker run redis:7-alpine` for cache; Fastify via `tsx watch`; Vite/Astro dev servers. No managed services touched. Synthetic fixtures. See §5.7.
- **Staging (shared):** Supabase **Pro** project (Vault required per §2.5; PITR therefore included as a Pro byproduct — used for staging-data restore convenience, not relied on for compliance); Upstash Redis Free; Fly auto-stop API; Cloudflare Pages preview deploys; Grafana Cloud Free tier shared with prod, tagged `env=staging`. **Synthetic fixtures only — no real child data** (PRD §10 compliance posture unchanged). Primary recovery path remains "reseed from migrations + fixtures"; PITR is opportunistic.
- **Prod (paid tiers):** Supabase Pro (PITR + Vault), Upstash Fixed, Fly always-on with autoscale, Cloudflare Pages + DNS.
- Cost posture and non-prod decisions consolidated in §5.7 below.

**5.5 Backup / DR — Supabase PITR 30d on prod + weekly full backup to separate cold bucket.**
- RPO ≤1h, RTO ≤4h for critical path (Lunch Link delivery, plan view, allergy guardrail) per PRD NFR.
- DR runbook: primary Fly region `iad` fails → failover to `dfw` within 30 min.
- **Staging recovery:** Supabase Pro includes PITR; staging therefore has PITR available as a convenience. Primary recovery path remains "reseed from migrations + committed fixtures" (synthetic-data posture per §5.4 makes deterministic reseed preferable to non-deterministic PITR for test repeatability).
- **Dev recovery:** `supabase db reset` — local, instant.
- Mary flagged "tight for public-launch billing surface — revisit in September 2026." Accepted; revisit item logged.

**5.6 Feature flags — DB column at beta; GrowthBook deferred to post-launch [amended — John].**
- **Beta [amended]:** month-5 Standard-vs-Premium A/B (FR103) ships via `households.tier_variant` column + server-side cohort check at the billing/UI boundary. Cohort assignment audit-logged.
- **Post-launch:** revisit GrowthBook at 5k HH when segmentation complexity justifies the ops overhead. GrowthBook avoided at beta scale because (a) 150 HH fits a spreadsheet, (b) self-hosting during launch window is an avoidable ops risk, (c) CSP posture means client-side SDK isn't an option — server-rendered flag bundle adds latency for no beta-phase value.

---

### 5.7 Non-Prod Cost Discipline

Infrastructure-only targets (excludes any non-infrastructure costs). LLM and voice API usage for dev/staging is kept deliberately minimal via cassette-heavy tests and sandbox models; it is called out per-line but not amortized into a fixed monthly estimate because it is controllable at the call site.

**Target envelopes:**

| Environment | Fixed infra | Notes |
|---|---|---|
| **Dev** | **$0/mo** | Fully local. No managed services consumed. `.env.local` for secrets. |
| **Staging** | **~$25–32/mo** | Supabase **Pro** $25 (Vault required per §2.5) + Upstash Free $0 + Fly auto-stop $0–2 + Cloudflare Pages $0 + Grafana Free $0. Cassette-heavy E2E. |
| **Prod (beta, 150 HH)** | **~$50/mo** fixed + usage | Fly API $15–30 + Supabase Pro $25 + Upstash Fixed $10. Usage (OpenAI + ElevenLabs) tracked against PRD cost SLOs. |
| **Prod (launch, 5k HH)** | **~$140/mo** fixed + usage | Fly scale + same managed tiers. Usage scales linearly per PRD unit economics. |

**N. Dev — fully local, zero managed-service cost.**
- Supabase: `supabase start` (Docker) runs local Postgres + Auth + Storage + Studio. Per-developer isolation via `supabase db reset`; no shared DB.
- Redis: `docker run redis:7-alpine` local. No Upstash.
- API: Fastify via `tsx watch` against local Supabase + local Redis. No Fly dev app.
- Frontend: `pnpm dev:web` (Vite) and `pnpm dev:marketing` (Astro) serve locally. No Cloudflare dev deploy.
- Observability: Pino → stdout + `pino-pretty` in dev. No OTEL export, no Grafana Cloud ingress from dev.
- Secrets: `.env.local` gitignored (per §2.5). No Vault, no managed secret store. Engineer copies `.env.local.example` and fills in.
- External APIs (OpenAI / ElevenLabs): shared dev keys with cassette-heavy test pattern (`msw` fixtures + recorded ElevenLabs transcripts). Live-key calls are intentional, not default.

**O. Staging — single shared env with Supabase Pro (Vault-gated), aggressive Fly idle-down elsewhere.**
- Supabase: one shared **Pro** project (Vault required per §2.5; PITR therefore available). Staging is the first env where the Vault code path and Pro-tier features are exercised — guards against "works in dev with `.env.local`, breaks in prod." Synthetic fixtures only; no real child data (§5.4, preserves PRD §10 compliance posture).
- Redis: Upstash Free tier (10k commands/day). Integration-test runs spin up ephemeral local Redis in the test container; do not burn the Upstash quota on CI.
- API: Fly `shared-cpu-1x-256mb`, `auto_stop_machines = true`, `min_machines_running = 0`. Cold-start 1–3s acceptable for E2E smoke tests.
- Frontend: Cloudflare Pages preview deploys (`staging--hivekitchen.pages.dev`). Free.
- Observability: Grafana Cloud Free-tier tenant shared with prod, `env=staging` tag. 50GB logs / 14d retention covers both envs at beta scale.
- Secrets: Supabase Vault (`staging` project). Single bootstrap env var `SUPABASE_SERVICE_ROLE_KEY`; everything else in Vault.
- External APIs: OpenAI `gpt-4o-mini` for E2E runs (~$0.15/1M input tokens) where sandbox keys aren't available. ElevenLabs uses cassette tests for deterministic E2E; live canary runs once/day on cron, not per-PR.

**P. CI — within free tiers; no paid observability services for tests.**
- GitHub Actions: free tier (2000 min/mo private; unlimited public). Turborepo cache-hit early-exit keeps typical PR runs under 5 min.
- Playwright + `@axe-core/playwright`: run in GHA runners. No third-party visual-regression service at beta.
- Visual regression: committed Playwright screenshots in `packages/ui`; diffs reviewed in PR. Chromatic deferred to post-launch if volume demands.
- Lighthouse CI: `@lhci/cli` with GHA artifact uploads; trend analysis via committed JSON reports. No paid LHCI server.

**Q. Prod — preserved; beta fits inside decisions already made.**
- Fixed infra ~$50/mo at beta (Fly API + Supabase Pro + Upstash Fixed). Usage costs governed by PRD NFR Cost SLOs (<$0.25/plan LLM; <$1/mo Standard voice; <$4/mo Premium voice p95). PRD unit economics hold: ~$3.50/HH cost vs $6.99 Standard price leaves headroom.
- No changes to decisions 5.1–5.6. §5.7 constrains dev/staging only.

**Cross-cutting rules:**
- **No single engineer can unilaterally upgrade a service to a paid tier in dev or staging** — tier upgrades require an architecture-doc amendment and the corresponding budget line acknowledged.
- **Usage-based service keys carry per-environment monthly soft caps** (OpenAI dashboard budget alert, ElevenLabs org-level spending alert). Alert threshold for dev/staging combined: $50/mo. Crossing threshold triggers cassette-usage review, not silent payment.
- **Upstash command quota (dev/staging):** integration tests must stub Redis via local Docker, not hit Upstash Free-tier. CI job fails if any test imports the Upstash client against the staging endpoint.
- **Observability data:** dev emits nothing to Grafana Cloud; staging tags all signals `env=staging`; no dev/staging PII ever reaches managed observability (Free tier retention is 14d; synthetic fixtures posture preserved).

---

### Decision Impact Analysis

**Implementation sequence (first-epic bootstrap → feature work):**
1. Bootstrap: scaffold `apps/marketing`, `packages/ui`; install plugins; wire Fastify plugins (supabase, openai, elevenlabs, redis, stripe, sendgrid, twilio); env Zod validation; Pino + OTEL skeleton; `tools.manifest.ts` scaffold with latency-declaration lint.
2. Auth epic: Supabase Auth, RBAC preHandler, invite JWTs (14d/7d TTL split), session cookie posture, CSRF wiring, audit.
3. Data foundation: initial migrations (users, households, children, memory_nodes, memory_provenance, audit_log with category enum + correlation_id + composite index + monthly partitions, allergy_rules, cultural_templates, Seed Library, lunch_link_sessions, plans with revision versioning, brief_state projection table); RLS policies.
4. Plan-generation: agent orchestrator skeleton (LLMProvider interface, OpenAI adapter, Anthropic stub), allergy-guardrail service, plan repository, SSE InvalidationEvent dispatcher, brief_state projection writer.
5. Thread / Evening Check-in: thread service with server-assigned sequence IDs + thread-sequence-gap beacon endpoint, SSE thread-turn streaming exception, voice token + webhook, tool-latency manifest enforcement, non-verbal orb-pulse presence event, captions.
6. Lunch Link: signed URL, redemption state, rating + Layer 2 swipes, flavor passport, Heart Note delivery, **minimal read-only SW for `/lunch/*`**.
7. Household coordination: packer-of-the-day, Figma-style presence (per-tab SSE), partner handoff, invite flow.
8. Visible Memory: authored-prose composer into projection, soft/hard forget + nightly promotion job, provenance chips, reset-flavor-journey, export.
9. Billing: Stripe, credit-card VPC, school-year auto-pause, gift subs, `households.tier_variant` cohort column, beta-to-paid transition.
10. Grocery / Pantry: list derivation, store-mode, cultural-supplier routing, pantry inference.
11. Ops: allergy anomaly dashboard, three-stage + guardrail-verdict audit timeline (via `correlation_id` index), survey instrumentation, compliance export.

**Cross-component dependencies (blockers):**
- Allergy Guardrail Service before any plan-generation render code (Journey 5 contract).
- Thread service + sequence IDs before voice webhook persist.
- `brief_state` projection + `memory_prose` composer before The Brief ships (UX M3 <3s SLO).
- `audit_log` schema with correlation_id + category + composite index before any write (FR78/FR80 query-plannability).
- SSE dispatcher + `InvalidationEvent` contract before any TanStack Query invalidation path.
- `LLMProvider` adapter interface before planner agent (NFR-mandated 15-min failover capability).
- `tools.manifest.ts` with `maxLatencyMs` declarations before the voice webhook route ships (3.5 budget computation depends on it).

**Deferred (still open):**
- Supabase Edge Functions for RAG retrieval (revisit if in-process retrieval exceeds 15s).
- pgvector hnsw tuning beyond defaults (revisit at 5k HH).
- Multi-region DB (50k HH trigger).
- GrowthBook self-host (5k HH trigger).
- Public-launch backup-retention revisit (September 2026, per Mary).

## Implementation Patterns & Consistency Rules

These patterns prevent the most common drift modes when multiple agents (and humans) work in the same codebase. Each rule traces back to an architectural decision in §1–5.

### Pattern Categories Defined

Eighteen rule clusters spanning naming, structure, format, communication, and process. Patterns are enforced by the order: **(1) lint or CI gate where mechanizable; (2) PR template checklist where not; (3) code review as the floor.**

---

### 1. Naming Patterns

**1.1 Database naming.**
- **Tables:** `snake_case`, plural — `households`, `children`, `memory_nodes`, `lunch_link_sessions`, `audit_log` (singular only when the table is a log/journal). No camelCase, no PascalCase, no acronyms split (e.g., `vpc_consents`, not `VPCConsents`).
- **Columns:** `snake_case` — `household_id`, `created_at`, `soft_forget_at`, `prose_text`. `id` always uuid v4 primary key. Foreign keys: `<referenced_table_singular>_id` — `household_id`, `child_id`, `memory_node_id`. Timestamps always end with `_at` and are `timestamptz`.
- **Booleans:** present-tense predicates — `hard_forgotten`, `is_active`, `auto_paused`. Never `is_not_*` (use the inverse).
- **Enums:** `<table>_<column>` Postgres enum types — `audit_event_type`, `node_type`, `source_type`, `lunch_link_status`. Enum values are `snake_case` strings.
- **Indexes:** `<table>_<columns>_idx` — `audit_log_household_event_correlation_created_idx`. Partial indexes carry the predicate suffix — `audit_log_guardrail_rejections_idx`.
- **RLS policies:** `<table>_<role>_<action>_policy` — `memory_nodes_primary_parent_select_policy`. Policy names are checked into migrations.

**1.2 API endpoint naming.**
- **Resource roots:** plural nouns — `/v1/households`, `/v1/children`, `/v1/plans`, `/v1/lunch-link-sessions`. Hyphenated multi-word resources, never `lunchLinkSessions` or `lunch_link_sessions`.
- **Path parameters:** `:resource_id` colon-prefix per Fastify convention — `/v1/children/:child_id/heart-notes/:heart_note_id`. UUIDs everywhere; no incrementing integer IDs in URLs.
- **Internal endpoints:** `/v1/internal/*` — never exposed in OpenAPI public schema; always require service-internal auth (not user JWT). `/v1/internal/client-anomaly`, `/v1/internal/thread-integrity-anomaly` are reachable from the browser; rate-limit per-IP.
- **Webhook endpoints:** `/v1/webhooks/<vendor>` — `/v1/webhooks/elevenlabs`, `/v1/webhooks/stripe`. HMAC signature header validation in a Fastify preHandler; never user JWT.
- **Auth endpoints:** `/v1/auth/<verb>` — `/v1/auth/login`, `/v1/auth/refresh`, `/v1/auth/logout`. Bearer/cookie posture per §2.1.
- **Verbs:** standard REST. `GET` collection / `GET` item / `POST` create / `PATCH` update / `DELETE` remove. No `PUT` (PATCH is idempotent for partial updates with `Idempotency-Key`).

**1.3 TypeScript naming.**
- **Files:** `kebab-case.ts` for modules — `plan.service.ts`, `allergy-guardrail.service.ts`, `memory-prose.composer.ts`. PascalCase only for React components — `LumiNote.tsx`, `BriefCanvas.tsx`. No `index.ts` re-exports beyond a package's barrel — internal imports go to the file directly.
- **Module suffixes:** `.routes.ts`, `.service.ts`, `.repository.ts`, `.schema.ts`, `.tools.ts`, `.composer.ts`, `.adapter.ts`, `.plugin.ts`, `.hook.ts`. Suffix is mandatory and structural — a file without a suffix isn't placed.
- **Types:** PascalCase. Schemas are PascalCase + `Schema` suffix in `packages/contracts` — `PlanSchema`, `MemoryNodeSchema`. Inferred TS types drop the suffix in `packages/types` — `export type Plan = z.infer<typeof PlanSchema>`.
- **Functions:** `camelCase`, verb-first — `composePlan`, `clearByGuardrail`, `recordAnomaly`. Service methods take a single typed object argument when ≥2 params — `service.swapPlanItem({ planId, dayKey, slot, newRecipeId })`.
- **React components:** `PascalCase` — `<LumiNote>`, `<AllergyClearedBadge>`. Hooks: `useLowerCamelCase` — `useBriefState`, `useThreadStream`, `useGuardrailVerdict`.
- **Constants:** `SCREAMING_SNAKE_CASE` only for compile-time constants — `MAX_TOOL_LATENCY_MS`. Runtime config from Zod env is `camelCase` properties on the env object.

**1.4 Event naming (SSE InvalidationEvent + audit_log event_type).**
- **SSE events:** `<resource>.<verb>` — `plan.updated`, `memory.updated`, `thread.turn`, `packer.assigned`, `pantry.delta`, `allergy.verdict`, `presence.partner-active`. Verbs are past-tense for state changes (`updated`, `assigned`) and present-tense imperative for streaming exceptions (`turn`, `delta`).
- **Audit event_type:** matching shape — `plan.generated`, `memory.forgotten`, `heart_note.sent`, `vpc.consented`, `billing.subscribed`, `account.deleted`. Single dot, lowercase, snake_case parts.
- **Tool names:** `<domain>.<verb>` — `allergy.check`, `memory.recall`, `recipe.search`, `pantry.read`. Declared in `tools.manifest.ts` with `maxLatencyMs`; CI fails on missing declaration (§3.5).

---

### 2. Structure Patterns

**2.1 Monorepo layout (locked).**
```
hivekitchen/
├── apps/
│   ├── web/             Vite SPA
│   ├── marketing/       Astro SSG
│   └── api/             Fastify
├── packages/
│   ├── contracts/       Zod schemas, only public API shapes
│   ├── types/           z.infer<> exports
│   ├── ui/              Shadcn-copied-in components
│   └── tsconfig/        Shared base presets
└── supabase/
    └── migrations/      Sequential SQL files
```
No new top-level apps or packages without an architecture-doc amendment.

**2.2 `apps/api` internal layout (per Backend_Architecture.md §4 + Step 3 amendments).**
```
apps/api/src/
├── plugins/             SDK clients as Fastify plugins (supabase, openai, elevenlabs, stripe, sendgrid, twilio, ioredis, growthbook-future)
├── agents/              Agent runtime — orchestrator + LLMProvider adapters + tools.manifest.ts. SDK types CONFINED here.
│   ├── orchestrator.ts
│   ├── providers/       openai.adapter.ts | anthropic.adapter.ts (future stub)
│   ├── tools/           plan.tools.ts | allergy.tools.ts | memory.tools.ts | recipe.tools.ts
│   └── tools.manifest.ts
├── modules/             One vertical-slice folder per feature — routes/service/repository/schema/composer
│   ├── auth/
│   ├── households/
│   ├── children/
│   ├── plans/
│   ├── memory/
│   ├── thread/
│   ├── voice/
│   ├── lunch-links/
│   ├── heart-notes/
│   ├── grocery/
│   ├── pantry/
│   ├── billing/
│   ├── ops/
│   └── allergy-guardrail/   Standalone — outside agents/, called by services
├── repository/          base.repository.ts + repository.types.ts only
├── audit/               audit.service.ts + audit.repository.ts + audit.types.ts (single-row schema per §1.6)
├── middleware/          authenticate.hook.ts | authorize.hook.ts | request-id.hook.ts | audit.hook.ts | idempotency.hook.ts
├── common/              errors.ts | logger.ts | env.ts (Zod-validated)
├── types/               fastify.d.ts | supabase.types.ts (generated)
├── app.ts               plugin + module registration
└── server.ts            entry point
```
- **Hard rules (lint-enforced via `eslint-plugin-boundaries`):**
  - Files in `agents/` cannot import from `fastify`, `routes/`, or any `.routes.ts` file.
  - Files outside `plugins/` cannot import an SDK client directly (`@supabase/*`, `@openai/*`, `@elevenlabs/*`, `stripe`, `@sendgrid/*`, `twilio`, `ioredis`).
  - Files outside `modules/<feature>/repository.ts` and `repository/` cannot import a Supabase client.
  - Files outside `audit/` cannot write to `audit_log` table directly — must call `audit.service.write()`.
  - `modules/<feature>/routes.ts` handlers have no business logic — they extract request, call `service`, serialize response. Handlers > 30 lines fail PR review.

**2.3 `apps/web` internal layout.**
```
apps/web/src/
├── app.tsx
├── main.tsx
├── routes/              React Router v7 file-based or routeTree, scope-aware:
│   ├── (app)/           .app-scope (authenticated parent)
│   ├── (child)/lunch/   .child-scope (Lunch Link)
│   ├── (grandparent)/   .grandparent-scope (gift, guest-author)
│   └── (ops)/           .ops-scope (role-gated)
├── features/            Per-feature folders mirroring API modules: feature-specific components + queries + stores
│   ├── brief/
│   ├── plan/
│   ├── memory/
│   ├── thread/
│   ├── lunch-link/
│   ├── heart-note/
│   ├── grocery/
│   ├── billing/
│   └── ops/
├── components/          Cross-feature components consumed via packages/ui re-export
├── hooks/               Cross-feature hooks (useSseChannel, useReportAnomaly)
├── lib/                 Cross-feature utilities (sse.ts dispatcher, query-client.ts, fetch.ts)
├── stores/              Zustand slices (UI state ONLY)
├── styles/              tailwind.css + token CSS custom properties
└── types/
```
- **Hard rules:**
  - `stores/` slices contain ONLY ephemeral UI state per §UX-Spec-Step-5; no server data, no API responses.
  - `features/<feature>/queries.ts` is the only place TanStack Query hooks are defined for that feature.
  - Cross-scope imports forbidden — a `(child)` route file cannot import from `(app)` features or `apps/web/src/features/billing/`. Enforced by `eslint-plugin-boundaries`.
  - Component-allowlist per scope (UX Spec Evolution 5) — `(child)` cannot import `<Command>`, `<Toast>`, `<AlertDialog>`. ESLint rule references the allowlist config.

**2.4 `apps/marketing` internal layout.**
- Astro file-based routing under `src/pages/`. Components in `src/components/` consume `@hivekitchen/ui` for shared primitives. Zero JavaScript by default; islands only where interactivity is required (pricing toggle, gift-flow form).

**2.5 Test colocation.**
- Unit tests: `*.test.ts` adjacent to source — `plan.service.ts` ↔ `plan.service.test.ts`. Run via `vitest`.
- Integration tests: `apps/api/test/integration/<feature>.int.test.ts`. Run with local Supabase + local Redis; never against staging.
- E2E + a11y: `apps/web/test/e2e/*.spec.ts` (Playwright) + `*.a11y.spec.ts` (`@axe-core/playwright`). Per UX scope.
- Performance: `apps/web/test/perf/*.lh.json` Lighthouse budgets per route per UX Spec performance table. CI fails on regression.

**2.6 Migration files.**
- `supabase/migrations/<timestamp>_<verb>_<subject>.sql` — `20260501120000_create_memory_nodes.sql`, `20260512090000_add_audit_event_type_enum.sql`. Sequential timestamps. Reversible where mechanizable; rollback steps as a comment header otherwise.
- One concept per migration. No mega-migrations.

---

### 3. Format Patterns

**3.1 API request format.**
- Body: `application/json`, UTF-8.
- All requests carry `Idempotency-Key: <uuidv4>` for POST/PATCH/DELETE per §3.2.
- Auth: `Authorization: Bearer <access_jwt>` per §2.1.
- Tracing: `X-Request-Id: <uuidv4>` (server generates and echoes if missing).
- Field names: `snake_case` for JSON wire format — matches DB column names; minimizes wire-↔-DB translation in repositories.

**3.2 API response format.**
- Successful state-changing response: `200 OK` (item update), `201 Created` (item created with `Location` header), `204 No Content` (delete or accepted-with-no-body).
- Successful read: `200 OK` with `Cache-Control: private, no-cache` for authenticated; aggressive `Cache-Control: public, max-age=N` for static via Cloudflare CDN per §1.5 Tier C.
- **Error responses: RFC 7807 Problem+JSON** per §3.1:
  ```json
  {
    "type": "/errors/validation",
    "title": "Request validation failed",
    "status": 422,
    "detail": "households.timezone must be a valid IANA zone",
    "instance": "/v1/households/3a7f.../timezone",
    "request_id": "9f2e..."
  }
  ```
  Domain-error type URIs catalogued in `apps/api/src/common/errors.ts`. New errors require a new `type` URI in the catalog before merge.
- No envelope wrapping (`{data: ..., error: ...}`) — direct payload on success, Problem+JSON on error.

**3.3 JSON field conventions.**
- `snake_case` everywhere on the wire. Frontend `camelCase` translation lives at the TanStack Query selector layer if needed (default: pass-through).
- Dates: ISO 8601 strings with timezone — `"2026-04-22T19:42:00-04:00"`. Never Unix epoch in API payloads.
- Booleans: `true`/`false`, never `1`/`0` or `"yes"`/`"no"`.
- Null vs missing: server returns `null` for explicitly-cleared fields; omitted entirely when not set. Frontend treats both identically.
- Money: integer cents — `subscription_cents: 699` not `subscription: 6.99`. Currency code separate field — `currency: "USD"`.
- Enums: lowercase snake_case strings matching DB enum values.

**3.4 SSE event format.**
- `event: <type>\ndata: <json>\nid: <monotonic_seq>\n\n` per `text/event-stream` spec.
- `id` is server-assigned monotonic sequence ID per `(user_id, client_id)` channel; client uses `Last-Event-ID` for resume.
- `data` is `InvalidationEvent` JSON per `packages/contracts/events.ts`.
- Heartbeat: `:ping\n\n` comment frame every 20s (Cloudflare config tolerance per §5.1).

**3.5 Voice webhook payload (ElevenLabs → API).**
- Request: per `docs/Voice Interaction Design.md` §6.2.
- Response: `{ response: "...", continuation?: { resume_token: "...", expected_within_ms: N } }` per §3.5 amendment T (early-ack shape).

---

### 4. Communication Patterns

**4.1 SSE InvalidationEvent contract.**
- All events typed via Zod-discriminated union in `packages/contracts/events.ts`:
  ```ts
  export const InvalidationEvent = z.discriminatedUnion('type', [
    z.object({ type: z.literal('plan.updated'), week_id: z.string().uuid() }),
    z.object({ type: z.literal('memory.updated'), node_id: z.string().uuid() }),
    z.object({ type: z.literal('thread.turn'), thread_id: z.string().uuid(), turn: ThreadTurnSchema }),
    z.object({ type: z.literal('packer.assigned'), date: z.string().date(), packer_id: z.string().uuid() }),
    z.object({ type: z.literal('pantry.delta'), delta: PantryDeltaSchema }),
    z.object({ type: z.literal('allergy.verdict'), plan_id: z.string().uuid(), verdict: AllergyVerdictSchema }),
    z.object({ type: z.literal('presence.partner-active'), thread_id: z.string().uuid(), user_id: z.string().uuid() }),
  ]);
  ```
- Adding an event requires (1) extending the union in `contracts`, (2) handling it in the central `apps/web/src/lib/sse.ts` dispatcher, (3) emitting it from the relevant service's mutation path. Anything less = dead event = silent bug.
- **One streaming exception:** `thread.turn` events use `setQueryData` to append to the cached `['thread', threadId]` infinite-query data. All other events use `invalidateQueries` per §UX-Spec-Step-5.

**4.2 Audit event_type taxonomy.**
- Categories: `plan.*`, `memory.*`, `heart_note.*`, `lunch_link.*`, `voice.*`, `billing.*`, `vpc.*`, `account.*`, `auth.*`, `allergy.*` (rejections), `agent.*` (orchestrator runs), `webhook.*`.
- Adding an event_type requires extending the `audit_event_type` Postgres enum (a migration) AND extending the TypeScript enum mirror in `apps/api/src/audit/audit.types.ts`. Both ship together.
- Stages array shape (for multi-stage events like `plan.generated` per Occam-R amendment): `stages: [{ stage: string, ...stage_specific }, ...]`. Stage names are documented per event_type in `audit.types.ts`.

**4.3 Tool call shape (agent ↔ tool).**
- Tool input/output: Zod-defined schemas in `apps/api/src/agents/tools/<tool>.tools.ts`. Tool registers `{ name, description, inputSchema, outputSchema, maxLatencyMs, fn }` — all five required.
- Tools call services (which call repositories) — never repositories or Supabase directly. Hard-rule via lint.
- Tool errors throw domain errors from `common/errors.ts`; orchestrator catches and feeds back to LLM for retry. Tool latency recorded to Redis sliding window per §3.5 amendment T.

**4.4 Frontend state update pattern.**
- **Server state:** TanStack Query mutation with `onMutate` (optimistic update for non-safety fields per §Safety-Classified Field Model), `onError` (rollback), `onSettled` (refetch). Mutation key is `[<feature>, '<verb>', ...identifiers]`.
- **Server-authoritative writes (allergy, Heart Note send, VPC, billing, memory.forget, template change):** NO optimistic update. Mutation renders pending state via `isPending`; success awaits server confirmation. Per Safety-Classified Field Model.
- **UI state:** Zustand slice with named selectors. No `useState` for state shared across more than one component.
- **Action naming:** verb-first, present-tense for setters, past-tense for events — `setVoiceOverlayOpen(true)`, `markBriefRead(briefId)`. Slice name + action: `useUiStore(s => s.setVoiceOverlayOpen)`.

---

### 5. Process Patterns

**5.1 Error handling.**
- **Domain errors** in `apps/api/src/common/errors.ts`: `NotFoundError`, `UnauthorizedError`, `ForbiddenError`, `ValidationError`, `ConflictError`, `IdempotencyConflictError`, `LinkExpiredError`, `AllergyUncertaintyError`, `GuardrailRejectionError`, `RateLimitError`. Each carries a `type` URI (Problem+JSON `type`).
- **Services throw domain errors only.** Never throw raw `Error`, never `throw new Error('foo')`. Lint rule.
- **Repositories normalize DB errors** to domain errors — `pgErr.code === '23505'` (unique violation) → `ConflictError`. Never let a Supabase error type leak into the service.
- **Global Fastify error handler** maps domain → Problem+JSON status. Unknown errors → 500 Problem+JSON with `request_id`; full stack to Pino at `error` level; never to client body in prod.
- **Frontend error handling:** TanStack Query `onError` shows inline error UI per UX Spec Principle 4 (errors are accountable, not apologetic). No toast (Toast component banned per UX Spec Evolution 3). Error copy follows the format: what happened + what we're doing + what you can do.

**5.2 Loading state.**
- Server state: TanStack Query `isLoading` (initial fetch only), `isFetching` (background refetch), `isPending` (mutation in flight). Use the most specific.
- UI: stale-while-revalidate is the default — render cached data with a subtle freshness indicator (timestamp), never a spinner.
- **Spinners are forbidden on the Brief, the Plan view, and the Lunch Link.** UX Spec hard rule (Critical Success Moments S1, M3, M5).
- Acceptable spinner surfaces: Evening Check-in voice "thinking" state (orb pulse, not spinner), Visible Memory export download.

**5.3 Retry and reconnect.**
- TanStack Query: default retry 3 with exponential backoff; safety-classified mutations retry 0 (server-authoritative, never silently retry).
- SSE reconnect: client uses `EventSource` reconnect with the §Observability backoff curve — 1s × 2× ±20% jitter, cap 60s. Implemented in `apps/web/src/lib/sse.ts`.
- ElevenLabs WebSocket: same backoff. SDK manages most of it; HiveKitchen surfaces graceful-degradation copy per §UX-Spec-Step-5.
- LLM provider: orchestrator catches `provider.unavailable` errors, swaps `LLMProvider` instance per the adapter per §Branch-C; fail-over budget 15min per NFR.

**5.4 Authentication flow.**
- Login: `POST /v1/auth/login` → `{ access_token, expires_in }` + Set-Cookie `refresh_token`.
- Refresh: `POST /v1/auth/refresh` reads cookie, returns new access + rotates cookie. Reused refresh token → `revoke-all` for that user + 401.
- Logout: `POST /v1/auth/logout` clears cookie + invalidates session in Supabase Auth.
- All authenticated routes carry `authenticate.hook` first, `authorize.hook` second (when role/permission needed). Per Backend_Architecture.md §5.5.

**5.5 Validation timing.**
- **Client-side:** react-hook-form + Zod resolver per §4.2. Validation runs on blur for individual fields, on submit for the form.
- **Server-side:** Fastify route schema (Zod via `@fastify/zod` or hand-wired) validates request body/query/params at the route boundary. **Same Zod schemas as client** — single source of truth via `packages/contracts`.
- **Database-side:** constraints (NOT NULL, CHECK, UNIQUE, FK) are the floor. Repositories rely on them; services do not duplicate validation that the DB already enforces.

**5.6 Logging conventions.**
- Pino structured JSON. Every log line carries `{ requestId, userId?, householdId?, module, action, ...payload }`. Request-scoped child logger created in `request-id.hook.ts`; `request.log` used everywhere downstream.
- Levels: `trace` (verbose dev), `debug` (dev/staging), `info` (default prod), `warn` (recoverable anomaly), `error` (handled exception), `fatal` (process termination). No `console.log` anywhere — lint rule.
- PII discipline: never log Heart Note content, child names, declared allergens, billing card details. Logger has a redaction allowlist; payloads must opt in to logging.

**5.7 Audit write pattern.**
- All audit writes go through `audit.service.write({ event_type, household_id?, user_id?, correlation_id?, request_id, stages?, metadata })`.
- Fire-and-forget via Fastify `onResponse` hook for route-level audits (§Backend_Architecture §5.6) — never blocks the user response.
- Single-row pattern per §1.6 + Occam R: multi-stage events populate `stages JSONB[]`, single-action events leave `stages` null.
- Audit failures: log at `error` level with the full payload; never propagate to user response.

---

### 6. Enforcement Guidelines

**All AI agents (and humans) MUST:**
1. Add a Zod schema to `packages/contracts` before adding any new API route or SSE event.
2. Run `pnpm typecheck && pnpm lint && pnpm test` locally before pushing. CI re-runs all three.
3. Update `docs/Design System.md` (or relevant runbook) when adding a `packages/ui` component, semantic token, or scope-allowlist entry.
4. Add a migration file for every DB schema change. Never alter a table from application code at runtime.
5. Declare `maxLatencyMs` for every new agent tool in `tools.manifest.ts` (CI lint enforces).
6. Extend `audit_event_type` enum + TS mirror in the same PR as a new audit category (CI lint enforces).
7. Use `audit.service.write()` for any state change visible to the user, billing, or compliance — never raw `INSERT INTO audit_log`.
8. Trace every new architectural exception back to a section in this document, OR amend this document in the same PR.

**Pattern enforcement mechanisms:**
- **`eslint-plugin-boundaries`** for module-boundary rules: agents/ no fastify, modules/* respect routes/service/repository layering, scope-cross imports forbidden.
- **Tailwind plugin variant** for scope-allowlists: `.app-scope`, `.child-scope`, `.grandparent-scope`, `.ops-scope` enforced as Tailwind variants tied to ESLint component-import allowlists.
- **CI gates:** `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:a11y`, `pnpm lh:budget`, `supabase db diff`, `pnpm contracts:check` (verifies all Zod schemas in `contracts` are imported by at least one route OR explicitly marked unused).
- **PR template checklist** for non-mechanizable rules: PII redaction reviewed, error type catalogued, audit event_type added, design system updated, scope-allowlist updated.

**Pattern violation handling:**
- **Lint failure:** PR blocked. Fix before merge.
- **CI failure:** PR blocked.
- **Code review catch:** request changes; document the pattern reference in the review comment.
- **Post-merge violation discovered:** open a follow-up issue tagged `pattern-violation`; fix in next sprint, no blame.
- **Repeated violations of the same pattern:** the pattern is wrong or the lint is missing — amend this document or add the lint, don't keep catching it manually.

---

### 7. Pattern Examples

**Good — service throwing a domain error:**
```ts
// apps/api/src/modules/plans/plans.service.ts
import { NotFoundError, GuardrailRejectionError } from '../../common/errors';

export class PlansService {
  async getPlan({ planId, householdId }: GetPlanInput): Promise<Plan> {
    const row = await this.repo.findById({ planId, householdId });
    if (!row) throw new NotFoundError('plan', planId);
    if (!row.guardrail_cleared_at) throw new GuardrailRejectionError(planId);
    return toDomain(row);
  }
}
```

**Bad — leaking Supabase error:**
```ts
// DO NOT WRITE THIS
async getPlan(planId: string) {
  const { data, error } = await this.supabase.from('plans').select().eq('id', planId).single();
  if (error) throw error;  // <-- leaks PostgrestError to caller
  return data;              // <-- returns Supabase row type, not domain Plan
}
```

**Good — typed SSE event handling in dispatcher:**
```ts
// apps/web/src/lib/sse.ts
import { InvalidationEvent } from '@hivekitchen/contracts/events';

eventSource.addEventListener('message', (e) => {
  const event = InvalidationEvent.parse(JSON.parse(e.data));
  switch (event.type) {
    case 'plan.updated':
      queryClient.invalidateQueries({ queryKey: ['plan', event.week_id] });
      break;
    case 'thread.turn':
      queryClient.setQueryData(['thread', event.thread_id], (old) => append(old, event.turn));
      break;
    // ...exhaustive switch — TypeScript compile-time check
  }
});
```

**Anti-pattern — adding a Toast notification:**
```tsx
// DO NOT WRITE THIS
import { useToast } from '@/components/ui/toast'; // banned import per UX Spec Evolution 3

function PlanSwap() {
  const { toast } = useToast();
  // ...
  toast({ title: 'Plan saved!' }); // violates "no toast notifications" rule
}
```
The correct pattern is inline at-point-of-action feedback — the swapped tile re-renders instantly via TanStack optimistic update; nothing else.

**Anti-pattern — agent importing Supabase directly:**
```ts
// apps/api/src/agents/tools/memory.tools.ts
import { createClient } from '@supabase/supabase-js'; // LINT ERROR
// agents/* cannot import an SDK directly; route via memory.service through orchestrator's tool injection
```
The correct pattern: the tool receives a `MemoryService` instance (or a constrained interface) from the orchestrator's DI; it calls `memoryService.recall(...)`.

**Anti-pattern — variable-shape audit row:**
```ts
// DO NOT WRITE THIS
await audit.write({ category: 'plan_done', extras: { plan, llm_output, guardrail } });
// Wrong: 'plan_done' isn't in audit_event_type enum; 'extras' isn't the schema field;
// loses correlation_id; fails composite-index queries.
```
The correct pattern:
```ts
await audit.service.write({
  event_type: 'plan.generated',
  household_id,
  correlation_id: planId,
  request_id: req.id,
  stages: [
    { stage: 'context_loaded', context_size: ctx.tokens },
    { stage: 'tool_call', name: 'allergy.check', latency_ms: 142 },
    { stage: 'llm_output', tokens_in: 4200, tokens_out: 1100 },
    { stage: 'guardrail_verdict', verdict: 'cleared', version: 'v3.1' },
  ],
  metadata: { plan_revision: 1 },
});
```

## Project Structure & Boundaries

This section is the definitive map: every directory, key file, FR-to-location mapping, and integration boundary. AI agents and humans implementing stories should be able to answer "where does this code live?" by pointing to exactly one path. Amendments from Step 6 Critique pass (V–MM) are integrated inline.

### Complete Project Directory Structure

```
hivekitchen/
├── README.md
├── CLAUDE.md                       Project-level instructions for Claude Code
├── package.json                    Workspace root — supabase:* and seed:* scripts MUST exist [amendment MM]
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── turbo.json
├── .gitignore
├── .npmrc
├── .nvmrc                          Node 22+
├── .editorconfig
├── .prettierrc
├── .prettierignore
├── eslint.config.js                Flat config; references eslint-plugin-boundaries + scope-allowlist.config.ts
├── tsconfig.base.json              Re-exported by packages/tsconfig
│
├── .github/
│   ├── PULL_REQUEST_TEMPLATE.md    Patterns checklist per Step 5 §6
│   ├── CODEOWNERS
│   ├── dependabot.yml
│   └── workflows/
│       ├── ci.yml                  install + lint + typecheck + unit + integration
│       ├── e2e.yml                 Playwright + @axe-core/playwright per UX scope
│       ├── perf.yml                Lighthouse CI budgets per route
│       ├── deploy-staging.yml      Triggered on merge to staging branch
│       ├── deploy-prod.yml         Triggered on merge to main
│       └── migrations.yml          supabase db diff + apply against staging on merge
│
├── docs/
│   ├── Technical Architecture.md         Guidance (preserved per Step 1 ruling)
│   ├── Backend_Architecture.md           Guidance
│   ├── Voice Interaction Design.md       Guidance
│   ├── Design System.md                  Living token + component reference (UX Spec mandated)
│   ├── Product Concept .md               Reference
│   ├── AI Principles.md                  Reference
│   └── runbooks/
│       ├── allergy-incident.md           Journey 5 SLA pathway
│       ├── secret-rotation.md
│       ├── voice-cost-anomaly.md
│       ├── plan-generation-stuck.md
│       └── beta-to-paid-transition.md
│
├── _bmad-output/
│   └── planning-artifacts/
│       ├── prd.md
│       ├── product-brief-2026-04-18.md
│       ├── ux-design-specification.md
│       └── architecture.md               THIS DOCUMENT
│
├── supabase/
│   ├── config.toml
│   ├── seed.sql                          Synthetic-data seed for staging + dev
│   ├── migrations/
│   │   # Rule [amendment V]: enum migrations carry a timestamp at least 5000 ms before the first table that references them.
│   │   ├── 20260501110000_create_audit_event_type_enum.sql            # enum FIRST
│   │   ├── 20260501115000_create_node_type_enum.sql                   # enum FIRST
│   │   ├── 20260501116000_create_source_type_enum.sql                 # enum FIRST
│   │   ├── 20260501117000_create_lunch_link_status_enum.sql           # enum FIRST
│   │   ├── 20260501120000_create_users_and_households.sql
│   │   ├── 20260501130000_create_children_and_school_policies.sql
│   │   ├── 20260501140000_create_audit_log_partitioned.sql            # uses audit_event_type
│   │   ├── 20260502090000_create_memory_nodes_and_provenance.sql      # uses node_type, source_type
│   │   ├── 20260502100000_enable_pgvector_and_create_embedding_tables.sql
│   │   ├── 20260502110000_create_plans_and_plan_items.sql
│   │   ├── 20260502120000_create_brief_state_projection.sql
│   │   ├── 20260502130000_create_threads_and_turns.sql
│   │   ├── 20260502140000_create_lunch_link_sessions.sql              # uses lunch_link_status
│   │   ├── 20260502150000_create_heart_notes.sql
│   │   ├── 20260502160000_create_pantry_and_grocery.sql
│   │   ├── 20260502170000_create_cultural_templates_and_suppliers.sql
│   │   ├── 20260502180000_create_billing_and_subscriptions.sql
│   │   ├── 20260502190000_create_invites.sql
│   │   ├── 20260502200000_create_allergy_rules_and_guardrail_decisions.sql
│   │   ├── 20260503090000_create_rls_policies.sql
│   │   ├── 20260503100000_create_envelope_encryption_setup.sql        # Vault DEK setup
│   │   └── ...                          One concept per migration; sequential timestamps
│   └── functions/                       (deferred — Edge Functions only if RAG retrieval moves out-of-process)
│
├── apps/
│   ├── web/                             Vite SPA — Lumi authenticated client
│   │   ├── package.json
│   │   ├── vite.config.ts               Code-splitting + voice chunk lazy-load config
│   │   ├── tailwind.config.ts           sacred-* / lumi-* / safety-cleared-* / memory-provenance-* tokens
│   │   ├── postcss.config.js
│   │   ├── tsconfig.json
│   │   ├── index.html
│   │   ├── .env.local.example                   [amendment W] Sanitized template — VITE_API_BASE_URL, VITE_SSE_BASE_URL
│   │   ├── public/
│   │   │   ├── favicon.svg
│   │   │   └── fonts/                   Inter + Sora local fonts (no Google Fonts CDN)
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── app.tsx                  Router root + providers (QueryClient, Auth, SSE)
│   │       ├── routes/
│   │       │   ├── _root.tsx            Session bootstrap; redirects authenticated → /app
│   │       │   ├── invite/$token.tsx    [amendment Y] INTENTIONALLY CROSS-SCOPE; role resolved at redemption,
│   │       │   │                         then redirects into the appropriate scope (.app for Secondary
│   │       │   │                         Caregiver, .grandparent for Guest Author).
│   │       │   ├── (app)/               .app-scope routes
│   │       │   │   ├── _layout.tsx
│   │       │   │   ├── index.tsx        The Brief — defining UX surface
│   │       │   │   ├── plan/
│   │       │   │   │   ├── index.tsx
│   │       │   │   │   └── $weekId.tsx
│   │       │   │   ├── memory/
│   │       │   │   │   └── index.tsx    Visible Memory authored prose
│   │       │   │   ├── thread/
│   │       │   │   │   └── index.tsx    Evening Check-in
│   │       │   │   ├── grocery/
│   │       │   │   │   ├── list.tsx
│   │       │   │   │   └── store.tsx    Store-mode
│   │       │   │   ├── heart-note/
│   │       │   │   │   └── compose.tsx
│   │       │   │   ├── household/
│   │       │   │   │   └── settings.tsx Invite Secondary Caregiver, packer-of-the-day
│   │       │   │   └── billing/
│   │       │   │       └── manage.tsx
│   │       │   ├── (child)/lunch/$token.tsx          .child-scope — Lunch Link, no auth
│   │       │   ├── (grandparent)/                    .grandparent-scope
│   │       │   │   ├── gift/
│   │       │   │   │   └── purchase.tsx
│   │       │   │   └── guest-author/
│   │       │   │       └── compose.tsx
│   │       │   ├── (ops)/                            .ops-scope (role-gated)
│   │       │   │   ├── allergy-anomalies.tsx
│   │       │   │   ├── plan-audit/$planId.tsx        Stages-from-audit-log timeline
│   │       │   │   └── households/$id.tsx
│   │       │   └── auth/
│   │       │       ├── login.tsx
│   │       │       └── callback.tsx     OAuth provider return
│   │       ├── features/                One folder per API module
│   │       │   ├── brief/
│   │       │   │   ├── BriefCanvas.tsx
│   │       │   │   ├── MomentSlot.tsx
│   │       │   │   ├── NoteSlot.tsx
│   │       │   │   ├── ThreadSlot.tsx
│   │       │   │   ├── QuietDiff.tsx
│   │       │   │   └── queries.ts
│   │       │   ├── plan/
│   │       │   │   ├── PlanTile.tsx
│   │       │   │   ├── SwapFlow.tsx
│   │       │   │   ├── AllergyClearedBadge.tsx
│   │       │   │   ├── FreshnessState.tsx
│   │       │   │   ├── queries.ts
│   │       │   │   └── mutations.ts
│   │       │   ├── memory/
│   │       │   │   ├── VisibleMemorySentence.tsx
│   │       │   │   ├── ProvenanceChip.tsx
│   │       │   │   ├── ForgetMenu.tsx
│   │       │   │   └── queries.ts
│   │       │   ├── thread/
│   │       │   │   ├── ThreadTurn.tsx
│   │       │   │   ├── VoiceOverlay.tsx           Lazy-loaded chunk per §4.5
│   │       │   │   ├── PresenceIndicator.tsx
│   │       │   │   ├── EarlyAckPulse.tsx          Non-verbal orb pulse per §3.5
│   │       │   │   └── queries.ts
│   │       │   ├── lunch-link/
│   │       │   │   ├── LunchLinkPage.tsx          .child-scope only
│   │       │   │   ├── HeartNoteRender.tsx        sacred-* tokens
│   │       │   │   ├── EmojiRater.tsx             4-emoji Layer 1
│   │       │   │   ├── BagItemSwipe.tsx           Layer 2 swipe
│   │       │   │   └── FlavorPassport.tsx         Read-only accretion
│   │       │   ├── heart-note/
│   │       │   │   ├── HeartNoteComposer.tsx
│   │       │   │   └── HoldToTalk.tsx
│   │       │   ├── grocery/
│   │       │   │   ├── ShoppingList.tsx
│   │       │   │   ├── StoreMode.tsx
│   │       │   │   └── queries.ts
│   │       │   ├── household/
│   │       │   │   ├── PackerOfTheDay.tsx
│   │       │   │   ├── InviteCaregiver.tsx
│   │       │   │   └── queries.ts
│   │       │   ├── billing/
│   │       │   │   ├── TierManager.tsx
│   │       │   │   ├── GiftPurchase.tsx           .grandparent-scope
│   │       │   │   └── queries.ts
│   │       │   └── ops/
│   │       │       ├── AllergyAnomalyDashboard.tsx
│   │       │       ├── PlanStagesTimeline.tsx     Reads stages JSONB[] from audit_log
│   │       │       └── queries.ts
│   │       ├── components/              Cross-feature primitives re-exported from packages/ui
│   │       │   └── index.ts
│   │       ├── hooks/
│   │       │   ├── useSseChannel.ts
│   │       │   ├── useReportAnomaly.ts            Single /v1/internal/client-anomaly endpoint
│   │       │   ├── useViewTransition.ts           View Transitions API + fallback
│   │       │   └── useFreshnessContract.ts        Freshness states per §UX-Spec
│   │       ├── lib/
│   │       │   ├── sse.ts                         SSE → queryClient dispatcher (THE central bus)
│   │       │   ├── query-client.ts                TanStack Query QueryClient + global config
│   │       │   ├── fetch.ts                       Auth header + Idempotency-Key + Problem+JSON parsing
│   │       │   ├── auth.ts                        Token store + refresh
│   │       │   ├── thread-integrity.ts            Sequence-gap detection + beacon
│   │       │   ├── guardrail-mismatch.ts          Version-mismatch detection + beacon
│   │       │   └── scope.ts                       Scope-detection helper for runtime fallback
│   │       ├── stores/
│   │       │   ├── ui.store.ts                    Zustand UI state (voice overlay, modality, drafts)
│   │       │   └── auth.store.ts                  Access token in-memory only
│   │       ├── styles/
│   │       │   ├── tailwind.css
│   │       │   ├── tokens.css                     CSS custom properties for sacred/lumi/safety-cleared/memory-provenance
│   │       │   └── view-transitions.css           Sacred-channel motion curves
│   │       ├── service-worker.ts                  Lunch Link route only — minimal read-only SW per §4.6
│   │       └── types/
│   │
│   ├── marketing/                       Astro SSG — pre-auth public surfaces
│   │   ├── package.json
│   │   ├── astro.config.mjs
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   ├── .env.local.example                   [amendment W] Build-time SITE_URL, etc.
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── index.astro                  Landing
│   │       │   ├── pricing.astro                Standard $6.99 / Premium $12.99
│   │       │   ├── gift.astro                   Pre-login gift flow (links to /gift/purchase in app)
│   │       │   ├── pain-point-demo.astro        Pre-login interactive demo
│   │       │   ├── faq.astro
│   │       │   ├── cultural-partners.astro      Halal, Kosher, Hindu-vegetarian, etc.
│   │       │   ├── blog/[...slug].astro
│   │       │   ├── legal/
│   │       │   │   ├── terms.astro
│   │       │   │   ├── privacy.astro
│   │       │   │   └── coppa-aadc.astro
│   │       │   └── 404.astro
│   │       ├── components/
│   │       │   ├── PricingToggle.astro          Island
│   │       │   ├── GiftFlowForm.astro           Island
│   │       │   └── ...                          Most are zero-JS
│   │       ├── content/                         MDX collections for blog + cultural-partner pages
│   │       └── styles/
│   │
│   └── api/                             Fastify — HiveKitchen API (sole orchestrator)
│       ├── package.json
│       ├── tsconfig.json
│       ├── .env.local.example                   Sanitized template for dev (per §2.5)
│       ├── fly.toml                             Fly.io deploy config
│       ├── Dockerfile                           [amendment KK] Node 22 multi-stage build for Fly.io
│       └── src/
│           ├── server.ts                Entry — create app, bind port
│           ├── app.ts                   Plugin + module + middleware registration
│           ├── plugins/                 SDK clients as Fastify plugins
│           │   ├── supabase.plugin.ts
│           │   ├── openai.plugin.ts
│           │   ├── elevenlabs.plugin.ts
│           │   ├── stripe.plugin.ts
│           │   ├── sendgrid.plugin.ts
│           │   ├── twilio.plugin.ts
│           │   ├── ioredis.plugin.ts
│           │   ├── bullmq.plugin.ts
│           │   ├── vault.plugin.ts              Supabase Vault client (staging + prod)
│           │   ├── swagger.plugin.ts
│           │   └── otel.plugin.ts
│           ├── agents/                  AI runtime — SDK types CONFINED here
│           │   ├── orchestrator.ts              Domain orchestrator (Branch-C wrapper); constructor takes { memory, recipe, pantry, allergyGuardrail } services bundle from app.ts; tools receive bundle via closure at registration time [amendment DD]
│           │   ├── providers/
│           │   │   ├── llm-provider.interface.ts   Abstract contract
│           │   │   ├── openai.adapter.ts            Wraps @openai/agents
│           │   │   └── anthropic.adapter.ts         Stub for failover (15-min NFR)
│           │   ├── tools/
│           │   │   ├── allergy.tools.ts             allergy.check (advisory tool)
│           │   │   ├── memory.tools.ts              memory.recall, memory.note
│           │   │   ├── recipe.tools.ts              recipe.search, recipe.fetch
│           │   │   ├── pantry.tools.ts              pantry.read
│           │   │   ├── plan.tools.ts                plan.compose, plan.swap
│           │   │   └── cultural.tools.ts            cultural-template lookup
│           │   ├── tools.manifest.ts             Registers all tools + maxLatencyMs (CI lint enforces — see config inventory)
│           │   ├── prompts/                      Versioned system prompts per agent
│           │   │   ├── planner.prompt.ts
│           │   │   ├── nutrition.prompt.ts
│           │   │   ├── support.prompt.ts
│           │   │   └── onboarding.prompt.ts
│           │   └── agent.types.ts
│           ├── modules/                 Vertical-slice features
│           │   ├── auth/
│           │   ├── households/
│           │   ├── children/
│           │   ├── plans/
│           │   ├── memory/
│           │   ├── thread/
│           │   ├── voice/
│           │   ├── lunch-links/
│           │   ├── heart-notes/
│           │   ├── grocery/
│           │   ├── pantry/
│           │   ├── cultural/                    Cross-cutting: composable cultural-identity service
│           │   ├── billing/
│           │   ├── ops/
│           │   ├── compliance/                  Owns FR8/FR9/FR14/FR69/FR70/FR71/FR72/FR101 (consolidated)
│           │   ├── allergy-guardrail/           Standalone — outside agents/, called by services
│           │   └── internal/                    /v1/internal/* browser-reachable beacons (no FR; serves §4.4 doctrine)
│           ├── repository/
│           │   ├── base.repository.ts             Constructor-injects supabase client
│           │   └── repository.types.ts
│           ├── audit/
│           │   ├── audit.service.ts               Single-row write per §1.6 + Occam R
│           │   ├── audit.repository.ts
│           │   └── audit.types.ts                 audit_event_type TS mirror + stages shapes
│           ├── middleware/
│           │   ├── authenticate.hook.ts
│           │   ├── authorize.hook.ts              4-role RBAC (Primary, Secondary, Guest, Ops)
│           │   ├── request-id.hook.ts
│           │   ├── audit.hook.ts                  onResponse fire-and-forget
│           │   ├── idempotency.hook.ts            Required key per §3.2
│           │   └── household-scope.hook.ts        Sets current_household_id JWT claim
│           ├── common/
│           │   ├── errors.ts                      Domain error classes + Problem+JSON type URIs
│           │   ├── logger.ts                      Pino factory with redaction allowlist
│           │   ├── env.ts                         Zod-validated env schema
│           │   ├── encryption.ts                  Envelope encryption helpers per §2.4
│           │   └── time.ts                        IANA TZ helpers for school-year + 8pm-local
│           ├── observability/
│           │   ├── otel.ts                        OpenTelemetry init
│           │   ├── tool-latency.histogram.ts      Redis sliding window per §3.5 amendment T
│           │   └── slo-counters.ts                plan-gen p95, voice cost per HH, etc.
│           ├── jobs/                              BullMQ job definitions
│           │   ├── plan-generation.job.ts          Weekend Fri PM → Sun AM batch
│           │   ├── memory-forget.job.ts            Soft → hard promotion
│           │   ├── audit-archive.job.ts            90d hot → cold migration
│           │   ├── lunch-link-delivery.job.ts      School-morning fanout
│           │   └── billing-school-year-pause.job.ts
│           └── types/
│               ├── fastify.d.ts                   Fastify instance decoration types
│               └── supabase.types.ts              Generated by supabase gen types
│
├── packages/
│   ├── contracts/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── auth.ts | households.ts | children.ts | plans.ts | memory.ts | threads.ts | voice.ts
│   │       ├── lunch-links.ts | heart-notes.ts | grocery.ts | pantry.ts | cultural.ts | billing.ts
│   │       ├── ops.ts | compliance.ts | allergy.ts | invites.ts | lists.ts
│   │       ├── events.ts                InvalidationEvent discriminated union (the SSE contract)
│   │       └── client-anomaly.ts        Single endpoint payload union per §4.4 amendment S
│   ├── types/
│   │   └── src/
│   │       └── index.ts                z.infer<> exports for every contract schema
│   ├── ui/
│   │   └── src/
│   │       ├── index.ts
│   │       ├── primitives/             Shadcn-copied-in (Button, Input, Form, Tooltip, etc.)
│   │       ├── tokens/                 sacred-* / lumi-* / safety-cleared-* / memory-provenance-*
│   │       ├── BriefCanvas.tsx | PlanTile.tsx | LumiNote.tsx | QuietDiff.tsx
│   │       ├── VisibleMemorySentence.tsx | AllergyClearedBadge.tsx | HeartNoteComposer.tsx
│   │       ├── ThreadTurn.tsx | PackerOfTheDay.tsx | PresenceIndicator.tsx | FlavorPassport.tsx
│   │       └── scope-allowlist.config.ts   [amendment X] Consumed by eslint-plugin-boundaries to enforce per-scope component-import rules
│   └── tsconfig/
│       ├── base.json | react.json | node.json | astro.json
│
└── test/                               Workspace-level test fixtures and helpers
    ├── fixtures/
    │   ├── households.json             Synthetic data — Priya HH, Mike+Devon HH, Nani-gift HH
    │   ├── allergens.json
    │   ├── cultural-templates.json
    │   └── recipes.json
    ├── cassettes/                      Recorded LLM + ElevenLabs responses (msw + custom)
    │   ├── openai/
    │   └── elevenlabs/
    └── helpers/
        ├── make-household.ts
        ├── seed-dev.ts                 [amendment LL] Companion to seed-staging.ts; called by `pnpm seed:dev`
        ├── seed-staging.ts
        └── reset-supabase.ts
```

### Functional Requirements → Module Mapping

Every FR group lands in exactly one primary module path. Cross-cutting concerns are noted.

| FR Group | FR range | Primary location | Frontend route(s) | Notes |
|---|---|---|---|---|
| Family Profile & Onboarding | FR1–FR14 | `apps/api/src/modules/auth/` + `households/` + `children/` | `/auth/*`, `/app/household/settings`, onboarding via `(app)/index` first-run | Voice onboarding goes through `voice/` + `agents/orchestrator.onboardHousehold`. FR8/FR9/FR14 owned by `compliance/` (see cross-cutting block). |
| Lunch Bag Composition | FR107–FR120 | `apps/api/src/modules/children/` (slot config) + `plans/` (slot fill) | `/app/plan/$weekId` (composition pinning) | Slot types live in `children.schema.ts`; allergy bag-wide rule lives in `allergy-guardrail/`. **FR118** (day-level context overrides — sick-day, half-day, field-trip, etc.) owned here, NOT in Plan Lifecycle [amendment Z]. |
| Weekly Plan Lifecycle | FR15–FR26 | `apps/api/src/modules/plans/` + `agents/orchestrator.planWeek` + `allergy-guardrail/` + `cultural/` | `/app/plan/*`, `/app/index` (Brief) | Generation queue: `apps/api/src/jobs/plan-generation.job.ts`. Brief reads from `brief-state.composer` projection. |
| Household Coordination | FR27–FR31 | `apps/api/src/modules/households/` + `thread/` (presence) + `auth/invite.service` | `/app/household/settings`, `/app/thread`, `/invite/$token` (cross-scope) | Packer-of-the-day on `households` table; presence via SSE. |
| Heart Note & Lunch Link | FR32–FR47, FR121–FR127 | `apps/api/src/modules/heart-notes/` + `lunch-links/` | `/app/heart-note/compose`, `/lunch/$token` (.child-scope), `/guest-author/compose` (.grandparent-scope) | Heart Note content envelope-encrypted (§2.4). Lunch Link signed URL via `url-signing.ts`. |
| Grocery & Pantry-Plan-List | FR48–FR55 | `apps/api/src/modules/grocery/` + `pantry/` + `cultural/` (supplier routing) | `/app/grocery/list`, `/app/grocery/store` | Tap-to-purchase IS the pantry update — silent inference in `pantry.service`. |
| Evening Check-in | FR56–FR64 | `apps/api/src/modules/thread/` + `voice/` + `agents/orchestrator.replyToTurn` | `/app/thread` | Voice tier cap enforcement in `voice.service`. Caption fallback in `apps/web/src/features/thread/VoiceOverlay`. |
| Visible Memory & Trust | FR65–FR68, FR73–FR75 | `apps/api/src/modules/memory/` | `/app/memory` | Soft/hard forget per §1.2; nightly job `memory-forget.job`. **FR69 (account deletion), FR70 (parental review dashboard), FR71 (data export), FR72 (consent history) consolidated under `compliance/`** [amendment AA]. |
| Allergy Safety & Guardrails | FR76–FR83 | `apps/api/src/modules/allergy-guardrail/` (AUTHORITATIVE) + `agents/tools/allergy.tools` (advisory) | `/app/plan/*` (badge), `/app/ops/allergy-anomalies` (.ops-scope) | Shared `allergy-rules.engine` per §Pre-Step-1 ruling. Three-stage audit via `audit.service` with `stages JSONB[]`. |
| Billing, Tiers & Gifts | FR84–FR94 | `apps/api/src/modules/billing/` + `auth/invite.service` (gift Heart Note guest) | `/app/billing/manage`, `/gift/purchase` (.grandparent-scope) | Stripe webhook `/v1/webhooks/stripe`. Tier cohort assignment in `tier-cohort.service`. |
| Ops, Support & Incident | FR95–FR100, FR102–FR104 | `apps/api/src/modules/ops/` | `/app/ops/*` (.ops-scope, role-gated) | Reads audit_log via `(household_id, event_type, correlation_id)` composite index. **FR101 (compliance audit-log export) consolidated under `compliance/`**. |
| Cross-cutting Account | FR105–FR106 | `apps/api/src/modules/auth/` + `households/` | `/app/household/settings` | Notification preferences live on `users` table; cultural-language preference on `users` separate from household. |

**Cross-cutting infrastructure modules [amendment AA]** — these exist in the tree but serve no single FR; they implement architectural doctrine:

| Module | Doctrine / FRs served | Source |
|---|---|---|
| `apps/api/src/modules/internal/` | §4.4 client-anomaly compensating-control infrastructure (no FR; FTC-defensible silent-state-divergence telemetry) | Step 4 amendment S |
| `apps/api/src/modules/cultural/` | Composable Cultural Identity Model (no single FR; consumed by FR6, FR7, FR26, FR37, FR50 across multiple feature modules) | PRD Innovation §3 |
| `apps/api/src/modules/compliance/` | FR8 (signed consent), FR9 (credit-card VPC), FR14 (parental notice), FR69 (account deletion), FR70 (parental review dashboard), FR71 (data export), FR72 (consent history), FR101 (audit export) | PRD §Compliance & Regulatory |

### Architectural Boundaries

**API boundary.**
- External consumers: only `apps/web` and `apps/marketing`. No third-party API consumers. No public OpenAPI publication; Swagger UI exposed at `/v1/internal/docs` behind ops auth in prod.
- All routes under `/v1/`. `/v1/internal/*` reachable from browser (anomaly beacons, internal docs); never user-JWT-authed; rate-limited per IP.
- **`/v1/internal/*` auth posture [amendment BB]:** no user JWT, no HMAC signature; per-IP rate-limit (10 req/min/IP); CORS allowlisted to authenticated app origins only; CSP-internal endpoints — never exposed in OpenAPI public schema. The browser sends with no auth header; the rate limit + CORS + path-prefix is the perimeter.
- `/v1/webhooks/<vendor>` validated by HMAC signature, never user JWT.

**Service boundary.**
- Routes call services. Services call repositories + other services + `agents/orchestrator`. Services NEVER import Supabase directly (lint).
- Cross-module service calls allowed (e.g., `plans.service` calls `memory.service.composeProse`); cross-module repository imports forbidden.

**Repository boundary.**
- Only `repository/` files import the Supabase client. Each `modules/<feature>/repository.ts` extends `base.repository.ts`. Maps DB row → domain type on the way out.
- RLS policies are the second line of defense — even if a repository forgets to scope, RLS blocks (§1.1).

**Agent boundary.**
- `agents/` cannot import from `fastify`, `routes/`, or any `.routes.ts`. Lint-enforced.
- **Orchestrator DI wiring [amendment DD]:** `apps/api/src/agents/orchestrator.ts` constructor takes a `{ memory, recipe, pantry, allergyGuardrail }` services bundle from `app.ts` registration. Tools receive the bundle via closure when registered in `tools.manifest.ts`. No tool ever imports a service directly.
- LLM SDK types (`@openai/agents`) confined to `agents/providers/openai.adapter.ts`. Other agent files use the `LLMProvider` interface from `agents/providers/llm-provider.interface.ts`.

**Allergy Guardrail boundary [consolidated — amendment CC].**
- `modules/allergy-guardrail/` runs **outside the agent module** (in-process but architecturally separate; never invoked through the agent orchestrator). `plans.service` calls `allergyGuardrail.clearOrReject(plan)` after orchestrator returns and before persistence.
- `agents/tools/allergy.tools.ts` calls the **same** `allergy-rules.engine` via shared library import — single source of allergen truth.
- **Presentation contract (single source of truth):** the presentation layer never reads `plans` rows where `guardrail_cleared_at IS NULL`. This is enforced at three layers — (1) `plans.repository.findById` adds the `WHERE guardrail_cleared_at IS NOT NULL` clause for any read intended for presentation; (2) the allergy guardrail writes `guardrail_cleared_at` and `guardrail_version` in the same transaction as the plan commit; (3) lint rule on `plans.repository.ts` forbids `SELECT *` from `plans` without that clause OR an explicit `// presentation-bypass: <reason>` comment for ops/audit reads.

**Audit boundary.**
- All audit writes through `audit.service.write()`. Lint rule forbids raw `audit_log` table writes outside `audit/`.
- Audit reads in `ops.repository` (and only there) for the dashboard and export flows.

**SSE boundary.**
- Single endpoint `/v1/events` in `thread.routes.ts` (housed in thread module since thread streaming is the largest consumer).
- Events fan-out via Redis Pub/Sub — emitters are services that call `sseGateway.emit(householdId, event)`.
- Client dispatcher in `apps/web/src/lib/sse.ts` routes typed `InvalidationEvent` to `queryClient`.

**Voice boundary.**
- Token issuance: `voice.routes.ts` `POST /v1/voice/token`. Calls ElevenLabs to create session, returns token to client.
- Webhook ingestion: `voice.routes.ts` `POST /v1/webhooks/elevenlabs`. HMAC-validated; calls `voice.service.handleTurn` which calls `agents/orchestrator.replyToTurn`.
- **Client SDK manages WebSocket; HiveKitchen API never opens or holds a WebSocket to ElevenLabs.** The WS lives entirely between the parent's browser and ElevenLabs platform.

**Scope boundary (frontend).**
- `apps/web/src/routes/(app|child|grandparent|ops)/` segmentation. Each scope has a layout that applies its Tailwind variant.
- ESLint rule via `eslint-plugin-boundaries`: `(child)` route files cannot import from `(app|grandparent|ops)` features.
- Component allowlist in `packages/ui/src/scope-allowlist.config.ts` consumed by ESLint to enforce per-scope component usage (e.g., no `<Command>` in `(child)`).
- **Cross-scope intentional exception:** `apps/web/src/routes/invite/$token.tsx` lives outside the four scopes by design — invite redemption establishes the user's role, which determines the destination scope. The route resolves the JWT, redeems via `auth.service.redeemInvite`, then redirects.

### Integration Points

**Internal communication paths.**

| Trigger | Path | Notes |
|---|---|---|
| Parent opens The Brief | `routes/(app)/index.tsx` → `features/brief/queries.ts` → `GET /v1/households/:id/brief` → `plans.service.getBrief` → reads `brief_state` projection row | Cached by TanStack staleWhileRevalidate. SW serves stale on offline (Lunch Link only — Brief is online-required at MVP). |
| Plan mutation (swap) | `features/plan/mutations.ts` → `PATCH /v1/plans/:planId/items/:itemId` → `plans.service.swapItem` → `plans.repository.update` → `audit.service.write({event_type:'plan.item_swapped'})` → fires SSE `plan.updated` → `lib/sse.ts` invalidates `['plan', planId]` query | Optimistic for non-allergen swaps; pending for allergen-affecting swaps (Safety-Classified). |
| Voice turn [amendment EE] | `Client opens WS to ElevenLabs (client-side only) → ElevenLabs platform processes audio + STT → POST /v1/webhooks/elevenlabs (HMAC-validated) → voice.service.handleTurn → orchestrator.replyToTurn → tools → response → ElevenLabs TTS → client.` HiveKitchen API never opens or holds the WS. | Tool-latency manifest gates sync vs. early-ack per §3.5. |
| Memory forget | `features/memory/mutations.ts` → `DELETE /v1/memory/:nodeId` (soft) or `?hard=true` (hard) → `memory.service.forget` → repository updates `soft_forget_at` or tombstones+purges → cascades to embeddings + provenance via FK ON DELETE CASCADE → `audit.service.write({event_type:'memory.forgotten', stages:[{stage:'cascade', tables:['memory_embeddings','memory_provenance'], rows_affected:N}]})` → SSE `memory.updated` → invalidates `['memory']` and `['brief']` queries | No optimistic; server-authoritative. |
| Allergy guardrail rejection | Agent returns plan → `plans.service.commit` calls `allergyGuardrail.clearOrReject` → if rejected, regenerates with rejection in context → on success, `plans.repository.commit` writes plan with `guardrail_cleared_at = now()` and `guardrail_version = 'v3.1'` → audit writes single row with stages array including `[..., {stage:'guardrail_verdict', verdict:'cleared'}]` | Presentation reads only `WHERE guardrail_cleared_at IS NOT NULL`. |
| Lunch Link tap | Child opens `/lunch/$token` → SW checks cache → if online, `GET /v1/lunch-links/:token` → `lunch-links.service.resolveAndOpen` → updates `first_opened_at` if first → returns Heart Note + bag preview → child taps emoji → `POST /v1/lunch-links/:token/rate` → `audit.service.write({event_type:'lunch_link.rated'})` | Daily HMAC key rotation with 24h overlap. |
| **Invite redemption [amendment FF]** | Invite link click → `routes/invite/$token.tsx` (cross-scope) → `POST /v1/auth/invites/redeem` → `auth.service.redeemInvite` verifies JWT + jti + records redemption in `invites` table → returns `{ role, scope_target }` → React Router redirect to `(app)/household/settings` (Secondary Caregiver) or `(grandparent)/guest-author/compose` (Guest Author) → `audit.service.write({event_type:'invite.redeemed', metadata:{invite_id, redeemer_user_id}})` | jti reuse → 410 Gone. |
| **LLM provider failover [amendment GG]** | Orchestrator wraps every `LLMProvider.complete()` call in a circuit-breaker → on N consecutive failures (default: 5 in 60s), provider marked unhealthy → orchestrator swaps to next provider in chain (OpenAI → Anthropic) → `audit.service.write({event_type:'llm.provider.failover', metadata:{from,to,reason}})` → ops dashboard alert via Grafana → Recovery: passive health-check resumes provider after 15 min if it succeeds on a probe call | Satisfies NFR "secondary-provider failover within 15 minutes." |
| School-morning Lunch Link delivery | `jobs/lunch-link-delivery.job` runs at TZ-shifted schedule → fans out to SendGrid + Twilio per parent's preferred channel → updates `lunch_link_sessions.delivered_at` | 3× peak provisioning per PRD NFR. |
| Weekend plan-generation batch | `jobs/plan-generation.job` enqueues per household Fri PM → Sun AM → BullMQ workers consume, call `orchestrator.planWeek` → `allergyGuardrail.clearOrReject` → commit → `brief-state.composer` updates projection → SSE `plan.updated` to any connected clients | Worker concurrency tuned to LLM provider quota; <4h queue wait per HH. |

**External integrations.**

| Vendor | Direction | Path | Auth |
|---|---|---|---|
| ElevenLabs | Outbound (token issuance) + Inbound (webhook) | `apps/api/src/modules/voice/` via `plugins/elevenlabs.plugin` | API key (outbound), HMAC signature (inbound) |
| OpenAI | Outbound | `apps/api/src/agents/providers/openai.adapter` via `plugins/openai.plugin` | API key, zero-data-retention header |
| Supabase | Outbound | `apps/api/src/repository/` and `plugins/supabase.plugin` + `plugins/vault.plugin` (Vault on staging+prod) | Service role key (server) + user JWT (RLS context) |
| Stripe | Outbound + Inbound webhook | `apps/api/src/modules/billing/` via `plugins/stripe.plugin` | API key (outbound), webhook signing secret (inbound) |
| SendGrid | Outbound | `apps/api/src/jobs/lunch-link-delivery.job` via `plugins/sendgrid.plugin` | API key |
| Twilio | Outbound | Same as SendGrid | API key + auth token |
| **Upstash Redis** [amendment HH] | Outbound (TLS to managed instance) | `apps/api` via `plugins/ioredis.plugin` | Username/password TLS auth | Prod: Upstash Fixed; staging: Upstash Free; dev: local docker `redis:7-alpine`. |
| Cloudflare CDN | Static asset serving | `apps/marketing` build output + Lunch Link static images | None (public) |
| Grafana Cloud | Telemetry export | `apps/api/src/observability/otel.ts` | OTLP token |

**Deliberately not used [amendment II]** — these third-party services are intentionally absent. Do not propose adding them without an architecture-doc amendment.

| Vendor | Why not | Reference |
|---|---|---|
| **Sentry** (or any third-party error tracker) | Forbidden third-party SDK on authenticated/child surfaces (CSP + COPPA/AADC posture). Replaced by first-party `/v1/internal/client-anomaly` endpoint + invariant-telemetry beacons. | §4.4 + amendment S |
| **LaunchDarkly** (or any third-party feature-flag SDK) | Same CSP + no-third-party-SDK posture. Replaced by `households.tier_variant` column + server-side cohort check at beta scale; GrowthBook OSS revisited at 5k HH. | §5.6 + amendment K |
| **Chromatic / Percy** | Visual regression handled by committed Playwright screenshots in `packages/ui` at beta scale. Revisit if PR review volume justifies. | Step 5 §6 + Step 4 amendment P |
| **Doppler / 1Password Secrets Automation** | Secrets posture: dev = `.env.local`; staging+prod = Supabase Vault. Single tool family per environment family. | §2.5 |

### Configuration File Inventory

| File | Purpose |
|---|---|
| `package.json` (root) | Workspace + Turborepo scripts. **MUST include**: `dev`, `build`, `lint`, `typecheck`, `test`, `supabase:start`, `supabase:stop`, `supabase:reset`, `seed:dev`, `seed:reset` [amendment MM]. |
| `pnpm-workspace.yaml` | Workspace globs |
| `turbo.json` | Per-task pipeline config |
| `eslint.config.js` (root) | Flat config with `eslint-plugin-boundaries` rules per app + scope allowlist |
| `.prettierrc` (root) | Format config |
| `apps/web/vite.config.ts` | SPA build, code splits, voice chunk lazy-load |
| `apps/web/tailwind.config.ts` | Token + scope variant config |
| `apps/web/.env.local.example` [amendment W] | Sanitized template — `VITE_API_BASE_URL`, `VITE_SSE_BASE_URL` |
| `apps/marketing/astro.config.mjs` | SSG output, content collections |
| `apps/marketing/.env.local.example` [amendment W] | Build-time `SITE_URL`, etc. |
| `apps/api/fly.toml` | Fly.io machine sizing, autoscale, region pinning (`iad` primary, `dfw` standby) |
| `apps/api/Dockerfile` [amendment KK] | Node 22 multi-stage build for Fly.io. Choice rationale: explicit reproducible build vs. Nixpacks auto-detection — Dockerfile wins because the container is what runs in prod and we want to control it. |
| `apps/api/src/common/env.ts` | Zod schema for ALL env vars |
| `apps/api/.env.local.example` | Sanitized template (committed; real values in `.env.local`) |
| `apps/api/src/agents/tools.manifest.ts` [amendment JJ] | Source-of-truth for agent tool registry + `maxLatencyMs` declarations; CI lint blocks PRs that add a tool without a manifest entry. |
| `packages/ui/src/scope-allowlist.config.ts` [amendment X] | Consumed by `eslint-plugin-boundaries` to enforce per-scope component-import rules; updated when adding a component or a scope. |
| `supabase/config.toml` | Local Supabase config |
| `supabase/migrations/*.sql` | Sequential SQL migrations; enums precede tables by ≥5000ms timestamp [amendment V] |
| `tsconfig.base.json` | Root TS preset, extended by `packages/tsconfig` variants |
| `.github/PULL_REQUEST_TEMPLATE.md` | Patterns checklist per Step 5 §6 |
| `.github/workflows/*.yml` | CI/CD pipelines |

### Development Workflow

**Local dev startup (engineer first-run) [amendment LL/MM]:**
```bash
pnpm install
pnpm supabase:start              # docker-compose under the hood
docker run -d --name hk-redis -p 6379:6379 redis:7-alpine
cp apps/api/.env.local.example apps/api/.env.local       # fill in dev keys
cp apps/web/.env.local.example apps/web/.env.local
cp apps/marketing/.env.local.example apps/marketing/.env.local
pnpm seed:dev                    # loads test/helpers/seed-dev.ts → synthetic households, allergens, cultural templates, recipes
pnpm dev                         # turbo runs api + web + marketing in parallel
```

Reset / re-seed during dev:
```bash
pnpm supabase:reset              # equivalent to `supabase db reset` — wipes local DB
pnpm seed:reset                  # re-seeds from test/helpers/seed-dev.ts
```

**Build process:**
- `pnpm build` — Turborepo runs `tsc` for API, `vite build` for web, `astro build` for marketing. Output: `apps/api/dist/`, `apps/web/dist/`, `apps/marketing/dist/`.
- Build cache shared across CI via Turborepo remote cache (Cloudflare or Vercel-free).

**Deployment:**
- API: GitHub Action `deploy-prod.yml` runs `flyctl deploy --dockerfile apps/api/Dockerfile` from repo root. Health-check on `/v1/health` before machine swap.
- Web: GitHub Action deploys `apps/web/dist/` to Cloudflare Pages.
- Marketing: same — `apps/marketing/dist/` to Cloudflare Pages (separate project).
- Migrations: GitHub Action `migrations.yml` runs `supabase db push` on merge to `main` (staging first, then prod gated by manual approval).

## Architecture Validation Results

### Coherence Validation ✅

**Decision compatibility.** All technology choices integrate cleanly:
- TanStack Query + SSE invalidation bus + Safety-Classified Field Model align — optimistic-vs-pending split is structurally enforceable via the Query mutation API + the field-classification rule.
- OpenAI Agents SDK (Branch-C hybrid) + LLMProvider adapter + Allergy Guardrail Service (outside agent boundary) → safety contract is preserved without coupling agent code to one vendor; failover NFR achievable.
- Supabase Postgres + RLS + JWT claim + envelope encryption (extended scope) → defense-in-depth at four layers (encryption, RLS, application service, domain validation) without regressing the <90s plan-gen SLO.
- Fly.io API + Cloudflare Pages + SSE-direct-to-API (gray-cloud subdomain) → SSE doesn't traverse buffering CDN; resume tokens work; multi-tab presence works.
- Single-row audit + correlation_id + composite/partial indexes → FR78/FR80 timeline reads are O(1) row lookups; cross-cutting queries served by partial indexes.

**Pattern consistency.** Implementation patterns (§Step 5) trace back to decisions:
- Naming patterns (snake_case DB, kebab-case files, camelCase TS) align with chosen tooling and `packages/contracts` Zod-first boundary.
- Module-boundary lint rules (`eslint-plugin-boundaries`) directly enforce the boundaries described in §6.
- Scope-allowlist config + Tailwind variants enforce the four UX scopes mechanically, not by review discipline.
- Audit write pattern (`audit.service.write()`) is the single allowed path; lint forbids raw `audit_log` writes outside `audit/`.

**Structure alignment.** §6 file tree implements every decision:
- `modules/allergy-guardrail/` lives outside `agents/` — matches the Pre-Step-1 ruling.
- `modules/internal/` exists for the §4.4 client-anomaly endpoint with three backing tables — matches Occam-S amendment.
- Migrations are sequenced enums-before-tables (§V) — applies cleanly.
- `tools.manifest.ts` is named in inventory with CI-lint enforcement — matches §3.5.
- Dockerfile + Fly.io config + Cloudflare Pages + Upstash Redis + Supabase Pro (staging+prod) — matches §5 hosting + §2.5 secrets posture.

### Requirements Coverage Validation ✅

**Functional Requirements coverage.** All 127 FRs are mapped to a primary module in §6:

| FR Group | Primary owner module(s) | Coverage |
|---|---|---|
| FR1–FR14 Family Profile & Onboarding | `auth/` + `households/` + `children/` + `compliance/` (FR8/9/14) | ✅ |
| FR15–FR26 Weekly Plan Lifecycle | `plans/` + `agents/orchestrator` + `allergy-guardrail/` + `cultural/` | ✅ |
| FR27–FR31 Household Coordination | `households/` + `thread/` + `auth/invite.service` | ✅ |
| FR32–FR47, FR121–FR127 Heart Note & Lunch Link | `heart-notes/` + `lunch-links/` | ✅ |
| FR48–FR55 Grocery & Pantry-Plan-List | `grocery/` + `pantry/` + `cultural/` | ✅ |
| FR56–FR64 Evening Check-in | `thread/` + `voice/` + `agents/orchestrator.replyToTurn` | ✅ |
| FR65–FR68, FR73–FR75 Visible Memory | `memory/` | ✅ |
| FR69–FR72, FR101 Compliance | `compliance/` (consolidated per §AA) | ✅ |
| FR76–FR83 Allergy Safety | `allergy-guardrail/` (authoritative) + `agents/tools/allergy.tools` (advisory) | ✅ |
| FR84–FR94 Billing | `billing/` + `auth/invite.service` (gift Heart Note) | ✅ |
| FR95–FR100, FR102–FR104 Ops & Incident | `ops/` | ✅ |
| FR105–FR106 Cross-cutting Account | `auth/` + `households/` | ✅ |
| FR107–FR120 Lunch Bag Composition | `children/` + `plans/` + `allergy-guardrail/` | ✅ (FR118 sole owner: this group) |

**Non-Functional Requirements coverage:**

| NFR axis | Architectural surface | Coverage |
|---|---|---|
| Performance (plan <90s, voice <800ms, etc.) | §3.5 tool-latency manifest + §1.5 brief_state projection + §4.5 code splits + §integration paths budget composition | ✅ |
| Security (TLS 1.3, AES-256, CSP, COOP/COEP, RBAC) | §2.1–§2.5 + §3.4 HMAC + §4.4 first-party telemetry + §6 boundary lint rules | ✅ |
| Privacy & data handling (COPPA/AADC, retention, payload scrubbing) | §2.4 envelope encryption + §1.6 audit retention + §compliance module + Doctrine: Visible Memory + Doctrine: Internal-use during beta | ✅ |
| Scalability (150 → 5k → 50k HH; 3× peak; weekend batch) | §1.5 cache tiers + §1.3 hnsw pgvector + §integration paths queue + §5.1 Fly autoscale | ✅ |
| Accessibility (WCAG 2.1/2.2 AA, readability, captions, multilingual) | §4.3 View Transitions + fallback + §packages/ui scope-allowlist + §5.2 a11y CI gate | ✅ (with multilingual font gap — see Important Gaps) |
| Reliability (99.9% API school-hours, RPO 1h/RTO 4h, reconnect storms) | §5.5 PITR + §5.1 Fly multi-region + §5.3 reconnect backoff + §integration GG provider failover | ✅ |
| Observability (MVP-grade beta → Growth-grade launch; product telemetry day-1) | §5.3 Grafana Cloud + §3.5 latency sampling + §observability/ module + §integration paths emit audit + telemetry | ✅ |
| Integration (DPAs, processor list, rate limits) | §6 external integrations table + §3.6 rate-limit + §5.7 cost discipline | ✅ |
| Cost (<$0.25/plan, <$1/mo Standard voice, <$4/mo Premium) | §5.7 envelopes + §3.5 tool-latency budget + §1.5 cost-aware caching | ✅ |
| Compliance (COPPA, AADC, FALCPA, state patchwork, GDPR readiness) | §compliance module + §1.1 RLS + §2.4 envelope encryption + §5.4 staging synthetic-data posture | ✅ (with state-patchwork architectural surface gap — see Important Gaps) |

**Cross-cutting concerns coverage** (the 14 named in §Step 2 §Cross-Cutting):
1. ✅ Conversation thread as system spine — `thread/` + sequence IDs + SSE
2. ✅ Safety-Classified Field Model — §3.5 + §4.4 frontend pattern
3. ✅ Audit log as compliance + ops + explainability — single-row schema + correlation_id
4. ✅ Single observable backbone — request_id spans Pino + audit + SSE + agent runs
5. ✅ Visible Memory as doctrine + compliance + product — `memory/` module + parental review consolidated under `compliance/`
6. ✅ Cultural-template composition — `cultural/` module + Brief + grocery + lunch-link
7. ✅ Cost observability per HH per tier — §observability/slo-counters + §3.5 sampling
8. ✅ School-morning peak load — §integration paths Lunch Link delivery + §5.1 Fly autoscale
9. ✅ Weekend plan-generation batch — `jobs/plan-generation.job` + BullMQ + per-TZ scheduling (gap: schedule cadence per TZ — see Important Gaps)
10. ⚠️ Multilingual content rendering — fonts named (Inter + Sora) but non-Latin font fallbacks not specified (see Important Gaps)
11. ✅ Connectivity-loss degradation — §4.6 minimal SW (Lunch Link) + §UX-Spec graceful-degradation copy
12. ✅ Payload scrubbing — `compliance/` boundary filter when sharing surface ships
13. ✅ Scoped runtime enforcement — Tailwind variants + ESLint allowlist + route segmentation
14. ✅ Idempotency + revision versioning at plan edge — §3.2 Idempotency-Key + plans table revision column

### Implementation Readiness Validation ✅

**Decision completeness.**
- All critical decisions are versioned (technology + amendment + rationale traced).
- Lint-enforceable rules: 8 (boundary, scope, audit-write, raw-SQL forbid, agent-imports, tool-manifest, no-Sentry, Toast-banned).
- CI gates: 9 (typecheck, lint, unit, integration, e2e, a11y, lh:budget, db diff, contracts:check).
- PR-template-only rules: 5 (PII redaction, error type catalog, audit event_type, design-system update, scope-allowlist update).

**Structure completeness.**
- Complete file-level tree per §6 across all three apps + four packages + supabase + .github + docs + test.
- All boundaries documented (API, service, repository, agent, allergy-guardrail, audit, SSE, voice, scope-frontend).
- All load-bearing integration paths traced (Brief open, plan mutation, voice turn, memory forget, allergy rejection, Lunch Link tap, invite redemption, LLM failover, school-morning delivery, weekend batch).

**Pattern completeness.**
- Naming, structure, format, communication, process — all five categories covered in §Step 5.
- Concrete examples (good + anti-pattern) provided for: domain errors, SSE event handling, Toast (banned), agent imports (boundary lint), audit row shape.
- Scope-allowlist config exists at `packages/ui/src/scope-allowlist.config.ts` and is named in lint config.

### Gap Analysis Results

**Critical gaps (block implementation): NONE.**

The architecture is implementation-ready. The first epic (Bootstrap) can be written and executed against the current document without further amendment.

**Important gaps (smooth implementation; resolve during early epic/story creation):**

1. **Weekend plan-generation cron schedule per US timezone.** The architecture names `jobs/plan-generation.job` and the Fri PM → Sun AM window, but does not specify the actual cron cadence per TZ (Pacific kicks earlier than Eastern). Per-TZ trigger schedule should land in the Plan-generation epic story.
2. **School-year + holiday calendar source for billing auto-pause (FR84, FR85, FR93).** Architecture names auto-pause as a billing service responsibility but does not specify the calendar source (parent-declared per §FR93, US federal holiday API, NCES district lookup). Likely parent-declared per FR93 — but the data shape and validation rules are not architecturally specified.
3. **Multilingual font fallbacks for non-Latin scripts.** §6 lists Inter + Sora as local fonts but PRD NFR Accessibility requires Devanagari, Hebrew, Arabic (RTL), Tamil rendering in Heart Notes. Engineer will discover the gap on the first Hindi Heart Note. Decide font stack: Noto Sans (full coverage, large download — split per-script via `unicode-range`) vs. system-font fallback. Lands in the Heart Note epic.
4. **State-level minor-privacy patchwork architectural surface (CT, UT, TX, FL, VA).** PRD NFR §Compliance names quarterly monitoring + changelog. The `compliance/` module owns FR8/9/14/69/70/71/72/101 but has no surface for "state-specific opt-in/opt-out variation" if a state requires a delta beyond COPPA/AADC baseline. A `state_compliance_overrides` table or a per-state policy enum on `households` may be needed. Land during the Compliance epic.
5. **Data-portability export format (FR71).** Architecture names the `compliance/` module as owner and references `@fastify/multipart` for the export route, but does not specify the JSON shape or whether export includes encrypted fields decrypted to the parent. Land during the Compliance epic.

**Minor gaps (nice-to-have; defer to refactor backlog):**

6. BullMQ scheduler implementation choice (`bullmq` Repeatable Jobs vs. external cron triggering BullMQ enqueue) — pick during Bootstrap epic.
7. DR runbook drill cadence — PRD NFR says "backups tested quarterly" but the runbook is named under `docs/runbooks/` without a CI-enforced drill schedule. Add to ops cadence post-launch.
8. Mid-beta to credit-card VPC transition flow (Sept 2026) — billing module owns it but the user-facing UX flow is not specified in architecture (correctly — that's epic territory).
9. ElevenLabs voice cost dashboard refresh cadence — mentioned in §observability but not specified (real-time? hourly? daily?). Tune during Bootstrap epic observability story.
10. `packages/types` vs `packages/contracts` separation — both exist; the boundary "contracts holds Zod schemas; types holds z.infer<>" is documented but not lint-enforced. If both packages drift, fix with a consolidation amendment post-launch.

### Validation Issues Addressed

All issues found during Steps 4–6 party-mode and advanced-elicitation passes were addressed via amendments A–MM. No unresolved issues from prior steps remain.

### Architecture Completeness Checklist

**✅ Requirements Analysis (Step 2)**
- [x] Project context thoroughly analyzed (12 FR groups, 10 NFR axes, 14 cross-cutting concerns, 5 user journeys)
- [x] Scale and complexity assessed (Medium-High, 7 drivers named)
- [x] Technical constraints identified (10 hard constraints + 13 locked tech decisions)
- [x] Cross-cutting concerns mapped (14 → architectural surfaces)

**✅ Starter Templates & Architectural Decisions (Steps 3–4)**
- [x] Starter approach chosen (existing monorepo + targeted scaffolds; Branch-C hybrid orchestrator locked)
- [x] Critical decisions documented with versions (web-verified April 2026)
- [x] Technology stack fully specified (locked components named; deferred tracked)
- [x] Integration patterns defined (REST + SSE + WS-voice-only)
- [x] Performance / cost / safety / compliance considerations addressed

**✅ Implementation Patterns (Step 5)**
- [x] Naming conventions established (DB, API, TS, events, tools)
- [x] Structure patterns defined (monorepo + per-app boundaries + lint enforcement)
- [x] Format patterns specified (Problem+JSON, snake_case wire, ISO 8601, integer-cents money)
- [x] Communication patterns specified (InvalidationEvent contract, audit taxonomy, tool shape, frontend state)
- [x] Process patterns documented (errors, loading, retry, auth, validation, logging, audit)
- [x] Enforcement guidelines + lint rules + CI gates + PR template

**✅ Project Structure (Step 6)**
- [x] Complete directory structure defined (every key file + purpose)
- [x] Component boundaries established (8 boundary types named + lint-enforced)
- [x] Integration points mapped (10 load-bearing flows traced)
- [x] Requirements to structure mapping complete (all 127 FRs + cross-cutting modules)
- [x] External integrations table + deliberately-not-used list
- [x] Configuration file inventory + dev workflow

**✅ Validation (Step 7)**
- [x] Decision compatibility checked
- [x] Pattern consistency verified
- [x] Structure alignment confirmed
- [x] FR + NFR + cross-cutting coverage validated
- [x] Critical gaps: zero
- [x] Important gaps: 5 (all deferable to early epics)
- [x] Minor gaps: 5 (defer to refactor backlog)

### Architecture Readiness Assessment

**Overall Status: READY FOR IMPLEMENTATION**

**Confidence Level: HIGH.**
- 17 amendments applied across 4 review passes (1× Occam Step 3, 1× Party-mode Step 4, 1× Occam Step 4, 1× Critique Step 6) — every load-bearing decision has been independently pressure-tested.
- No critical gaps. All amendments traceable to evidence (planning artifacts, NFRs, journeys, agent perspectives).
- Lint-enforceable rules + CI gates make the patterns mechanizable, not just aspirational.

**Key strengths.**
- **Safety doctrine is structurally enforced**, not document-only: Allergy Guardrail outside agent boundary + presentation-contract lint + four-layer defense in depth (encryption, RLS, service, domain). Journey 5's failure mode cannot recur without breaking three independent rules.
- **Provider portability and cost discipline are architectural, not afterthoughts.** LLMProvider adapter from day 1; tool-latency manifest + runtime sampling; per-tier cost SLOs with telemetry; Vault scoped to where it actually adds security value.
- **Scoped UX enforcement** prevents the most common consumer-AI drift mode (parent surface bleeds into child surface) at the lint layer, not at code review.
- **Single-row audit + correlation_id** scales to 50k HH × 5k plans/wk without becoming a hot-path bottleneck while preserving FR78/FR80 query plannability.
- **Cost discipline at every env tier** ($0 dev, ~$25–32/mo staging, ~$50/mo beta prod, ~$140/mo launch prod fixed) leaves the per-HH unit economics intact at PRD-mandated levels.

**Areas for future enhancement (post-launch).**
- Multi-region DB at 50k HH (currently single-region us-east).
- Supabase Edge Functions for RAG retrieval if in-process exceeds budget.
- GrowthBook self-host at 5k HH for richer cohort segmentation.
- Chromatic visual regression at PR review volume threshold.
- Sentry-equivalent SDK only if compensating telemetry proves insufficient under FTC audit.
- Public-launch backup retention revisit (September 2026, per Mary).

### Implementation Handoff

**AI Agent guidelines (and human equivalent):**
1. Read this document before writing the first line of code in any feature.
2. Trace every change back to a section here — if you can't, amend this document in the same PR.
3. Prefer lint and CI to code review for pattern enforcement; if a rule is being violated repeatedly, the rule is wrong or the lint is missing.
4. Safety doctrine (Allergy Guardrail, Heart Note sacredness, Visible Memory user-sovereignty, COPPA/AADC posture) is non-negotiable — no shortcuts, no "we'll add it later."
5. Cost discipline (<$0.25/plan, voice tier ceilings, $0 dev, ~$25–32/mo staging) is an SLO, not a guideline. Tool-latency declarations + runtime sampling enforce it.

**First implementation priority — Bootstrap epic (per §Decision Impact Analysis):**
1. Scaffold `apps/marketing` (Astro), `packages/ui` (empty + shadcn init).
2. Install plugin/SDK dependencies; wire Fastify plugins.
3. Zod env validation + `.env.local.example` per app.
4. Pino + OpenTelemetry skeleton in `apps/api`.
5. `tools.manifest.ts` scaffold with CI lint enforcement.
6. ESLint flat config with `eslint-plugin-boundaries` rules + scope-allowlist.
7. Initial migrations: enums, `users`, `households`, `audit_log` partitioned, `audit_event_type` enum (sequenced first).
8. Local dev workflow scripts (`supabase:start`, `seed:dev`, `dev`) wired in root `package.json`.

After Bootstrap, follow the Implementation Sequence in §Decision Impact Analysis (Auth → Data Foundation → Plan Generation → Thread/Voice → Lunch Link → Coordination → Visible Memory → Billing → Grocery → Ops).

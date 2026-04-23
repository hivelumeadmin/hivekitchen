---
name: frontend-design-hivekitchen
description: Design and build production-grade frontend interfaces for HiveKitchen, a calm, AI-driven school lunch planning system centered around trust, family identity, and weekly automation. Use this skill for building HiveKitchen web pages, dashboards, planning flows, and family interfaces that minimize cognitive load and avoid generic AI or SaaS patterns.

---

> **Implementation rules live in `_bmad-output/project-context.md`.** Read that first for stack versions, framework rules, and invariants. This file covers design intent and UX principles only.

## Stack
- Vite ^6 + React ^19 (SPA — not Next.js, not SSR)
- TypeScript ^5.5 (strict, ESM, `moduleResolution: "bundler"`)
- Tailwind CSS ^3.4
- Zustand ^5 (curried `create<Shape>()(set => ...)`)
- ElevenLabs client SDK (voice only)
- Native `EventSource` for SSE
- Shared contracts via `@hivekitchen/contracts` (Zod) and `@hivekitchen/types` (`z.infer<>`)

## Design Rules
- This is a calm household system, not a SaaS dashboard
- Warm neutrals: honey, olive, clay, oat, charcoal
- Editorial serif + refined sans typography (no Inter, no Roboto)
- Soft transitions, no flashy animation
- One intent per screen
- The system thinks first — UI presents ready answers

## File Structure
src/
  app/            # Vite SPA entry, top-level routes, providers (folder name is historical — not Next.js App Router)
  components/     # Shared UI primitives (no business logic)
  features/       # Feature-scoped modules (plan, onboarding, swap, etc.) — own their hooks, components, and local state
  hooks/          # Cross-feature React hooks
  stores/         # Zustand stores (one per concern, e.g. planStore, voiceStore)
  lib/            # API client, SSE client, utilities
  types/          # Frontend-only types (shared types come from @hivekitchen/types)

Path alias: `@/*` → `./src/*` (web only — not available in `apps/api` or shared packages).

HiveKitchen is NOT a traditional UI-heavy planner.  
It is a **system-led weekly planning experience** where most thinking is done in the background by Lumi which is HiveKitchens AI Agent.

The frontend must reflect:
- trust
- clarity
- low cognitive effort
- emotional warmth (family connection)
- invisible intelligence

---

## Product Context
Each week:
- Lumi generates a **complete weekly plan**
- The parent reviews, adjusts if needed, and confirms
- The plan becomes the **source of truth**
- The child participates via a **Lunch Link**, not the main UI

This is NOT a system for constant interaction.  
It is a system for **reducing decisions**.

---

## Design Thinking

### Purpose
Each screen must answer:
- What decision is being removed?
- What reassurance is being provided?
- What is the ONE thing the user needs to do here?

### Tone
Avoid:
- futuristic AI aesthetics
- startup SaaS dashboards
- overly playful food-app visuals
- gamified interfaces

---

## Core UX Principles

### 1. The System Thinks First
- AI recommends, User Decides
- UI is not the primary decision-maker
- The system presents a **ready answer**
- Users refine, not construct

---

### 2. Trust Over Control
- Users should feel confident accepting a plan
- Not forced to manually configure everything
- Adjustments are optional, not required

---

### 3. Weekly Rhythm, Not Daily Interaction
- UI optimized for:
  - **weekly review**
  - **light daily glance**
  - **Help with preparing meal**

---

### 4. Emotional Layer Matters
- Heart Note is central
- Child experience influences system learning
- UI should reflect **care**, not just efficiency

---

### 5. Invisible Intelligence
- Lumi should feel present but not dominant
- Avoid chat-first layouts
- AI is a background capability, not the interface

## Final Instruction

Design HiveKitchen as:

- a **calm system**
- a **weekly ritual**
- a **trusted planner**
- a **family-aware assistant**

Not as an interface that demands attention.

---

> The best HiveKitchen UI is one the user barely has to use.
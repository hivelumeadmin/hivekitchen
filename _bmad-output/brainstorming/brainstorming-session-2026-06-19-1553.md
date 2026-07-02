---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: []
session_topic: 'Wiring kitchen-profile edits: PATCH /v1/memory model vs Lumi-thread composite'
session_goals: 'Compare tradeoffs of the two edit-wiring approaches and reach a decision'
selected_approach: 'ai-recommended'
techniques_used: ['First Principles Thinking', 'Failure Analysis', 'Concept Blending']
ideas_generated: ['per-data-class editor-of-record split', 'phased delivery (safety deterministic now, soft conversational later)', 'reuse Epic 7 pattern not endpoint', 'allergen add/remove action-chips', 'cultural enforcement reuse of cultural-priors PATCH']
session_active: false
workflow_completed: true
context_file: ''
---

# Brainstorming Session Results

**Facilitator:** Menon
**Date:** 2026-06-19

## Session Overview

**Topic:** Wiring kitchen-profile edits — Option A (reuse Epic 7's `PATCH /v1/memory` structured-edit model) vs Option B (post a natural-language "composite" to a Lumi conversation thread that re-extracts into the kitchen map).

**Goals:** Surface the real tradeoffs of each approach (and any hybrids), then decide which to build.

### Session Setup

_Fresh session started 2026-06-19. Topic carried in from the prior diagnostic conversation: the `/app/kitchen-profile` edit panels are read-only stubs (slice 2.5-s11); Epic 7 wired editing on a different surface (`/app/memory`), leaving kitchen-profile orphaned._

## Technique Execution Results

### Phase 1 — First Principles

**Fundamentals established:**
1. The kitchen map is a *projection* over source tables (`child_allergens`, `food_preferences`, `cultural_priors`, `favorite_lunches`, `bag_composition`) + 1hr Redis cache. Any edit must land in a specific source table and re-compose.
2. Epic 7's `PATCH /v1/memory/:nodeId` edits `memory_nodes.prose_text` (free-text sentences) — a *different substance* from the structured records the kitchen-profile cards render. Literal reuse is a category error.
3. The already-built `EditConversation` UI emits a *natural-language composite*, which is inherently Option-B-shaped.

**DECISION (Menon, first principles):** Parent is the **editor of record**. Edits are precise, deterministic, parent-controlled structured changes. Lumi-as-editor (interpretation/reconciliation) is deferred to a later phase. → points to a **structured-PATCH** path (Option A flavored), NOT literal reuse of `PATCH /v1/memory`, and NOT the NL-composite path (Option B) for now.

### Phase 2 — Failure Analysis (pre-mortem)

Steelmanned Lumi-as-editor (on-brand: "system thinks first / refine not construct / no form-builders"; reuses built `EditConversation` UI; handles fuzzy intent). Pre-mortem killer: **allergens are medical-safety data** — a non-deterministic LLM between parent intent and a safety record means the 1% misread = a child eats an allergen. Secondary failures: silent reconcile/override ("edited it but it bounced back"), per-edit OpenAI latency+cost, untestable safety path.

**Conclusion:** the "editor of record" question is **not global — it is per-data-class.**

### Phase 3 — Concept Blend (the hybrid we chose)

**DECISION (Menon): per-data-class split.**

| Data | Stakes | Editor of record | UI |
|---|---|---|---|
| Allergens | Medical safety | **Parent — deterministic, no LLM in write path** | small structured control |
| Non-negotiable cultural rules (halal/kosher) | Trust / belief | Parent-confirmed, deterministic | structured control |
| Cultural flavor, shared-tastes, identity "quote" | Soft | **Lumi — conversational** | keep `EditConversation` |
| Starting-line favorites | Soft | Lumi — conversational | keep `EditConversation` |

**Elegant reconciliation with the opening instinct:** this maps directly onto a **phased delivery** —
- **Phase 1 (now):** parent-deterministic structured edits for safety data (allergens, hard rules). Parent is editor of record. No Lumi in the path. Reuses Epic 7's *pattern* (auth, household-scope, provenance row, contract shape) — new endpoints against source tables, NOT `PATCH /v1/memory`.
- **Phase 2 (later):** Lumi-conversational edits for the soft/narrative sections, reusing the already-built `EditConversation` composite UI → Lumi thread → structured writes.

This is exactly "parents as primary editor now, introduce Lumi later" — now with a principled boundary (safety vs soft) instead of an arbitrary one.

### Phase 3 (deep dive) — concrete Phase-1 design, grounded in code

**Correction:** `child_allergens` table was DROPPED. Allergens now live in `household_allergens` (AES-256-GCM encrypted); its `source` enum already includes `parent_edited`. Cache invalidation for all relevant tables is automatic via DB triggers — no manual bump needed.

**A. Child allergens (highest stakes):**
- Add: reuse `HouseholdAllergensRepository.declareIfNew({household_id, child_id, allergen, source:'parent_edited'})` (handles encrypt + dedupe + cache bump).
- Remove one: GAP — only `deleteByChild()` exists (deletes all per-child rows). Add new `deleteOneByHash(householdId, childId, allergenHash)`.
- New endpoints: `POST /v1/children/:childId/allergens` + `DELETE /v1/children/:childId/allergens/:allergenHash`, mirroring `PATCH /v1/children/:id/bag-composition` (child-scoped, household from JWT, `requirePrimaryParent`, `auditContext`, 404-on-null).
- Cache: free (trigger on `household_allergens`, migration `20261008000200`).
- Provenance/audit: `source:'parent_edited'` + best-effort `audit.write`, mirror memory `editProse`.

**B. Hard cultural rules / enforcement:**
- Likely REUSE existing `PATCH /v1/households/:id/cultural-priors/:priorId` (ratify flow, `requirePrimaryParent`). Verify at build time whether `RatifyCulturalPriorBodySchema` sets `enforcement` directly or needs a small new set-enforcement route. Target column `cultural_priors.enforcement`. Cache free (trigger, migration `20260820000000`).

**C. UI consequence (the real work):** replace ONLY the allergen + enforcement controls (currently conversational `EditConversation`) with deterministic structured controls:
- `ChildProfileCard` → allergen add/remove action chips (no free-text, no LLM).
- `KitchenIdentityCard` → inline enforcement control on cultural-rule chips; quote + shared-tastes stay read-only until Phase 2.

**Scope verdict:** single clean slice — 2 new allergen endpoints + 1 new repo method + 1 enforcement endpoint (likely reuse) + 2 contract schemas + 2 UI controls. No migrations, no cache work, fully testable (no LLM in path). Reuses Epic 7's *pattern* (auth/household-scope/provenance/404-on-null), not its endpoint.

**Open items to verify at build time:**
1. `RatifyCulturalPriorBodySchema` — can it set enforcement directly?
2. Allergen vocabulary for the add-chips (FALCPA list? free-text? — safety implications).
3. Whether `household_cultural_identifiers.enforcement` also needs editing or `cultural_priors` alone covers the displayed chips.

---

## Idea Organization and Decision Record

### The decision (one line)
Wire kitchen-profile edits as a **per-data-class hybrid, phased**: parent-deterministic structured edits for safety data now (Phase 1), Lumi-conversational edits for soft/narrative data later (Phase 2). Neither original option (literal `PATCH /v1/memory` reuse, nor NL-composite-to-Lumi) is adopted wholesale.

### Why (the through-line)
- The kitchen map is a projection; edits land in source tables. (First principles)
- Epic 7's endpoint edits *prose*, not structured records → "reuse" means reuse the **pattern**, not the endpoint. (First principles)
- Allergens are medical-safety data; an LLM in the write path makes the 1% misread a child-safety failure. (Pre-mortem)
- "Editor of record" is therefore **not global** — it's per-data-class. (Concept blend)
- The split maps cleanly onto phased delivery, reconciling the opening instinct ("parents now, Lumi later") with a principled boundary.

### Themes
- **Theme 1 — Determinism where it's unsafe to guess:** allergens + hard cultural rules → structured, parent-authoritative, no LLM, fully testable.
- **Theme 2 — Conversation where it's on-brand and low-stakes:** identity quote, shared tastes, favorites → reuse built `EditConversation` → Lumi → structured writes (Phase 2).
- **Theme 3 — Reuse over rebuild:** mirror Epic 7's auth/household-scope/provenance/404-on-null; reuse existing repo writes + cultural-prior PATCH; cache invalidation is free via DB triggers.

### Prioritized next slice — Phase 1 (safety edits)
**Highest value, lowest risk, safety-critical.** Single slice:
- New repo method `HouseholdAllergensRepository.deleteOneByHash(...)`.
- New endpoints `POST /v1/children/:childId/allergens`, `DELETE /v1/children/:childId/allergens/:allergenHash`.
- Cultural enforcement edit — reuse/extend `PATCH /v1/households/:id/cultural-priors/:priorId`.
- 2 contract schemas; 2 UI controls (allergen action-chips in `ChildProfileCard`; enforcement control in `KitchenIdentityCard`).
- No migrations, no cache work. Tests: route happy-path + 404 + cross-household + remove-one-leaves-others; web interaction tests.

### Deferred — Phase 2 (soft edits)
Lumi-conversational edits via the existing `EditConversation` composite UI → Lumi thread → structured writes, for identity quote / shared tastes / starting-line favorites. Carries its own design work (how Lumi maps an NL composite to deterministic structured writes; reconcile/override transparency).

### Immediate next action
Draft Phase 1 as an implementation-ready BMAD story (`bmad-create-story`), resolving the 3 open items during story authoring.

---

_Session complete. Workflow: First Principles → Failure Analysis (pre-mortem) → Concept Blend → grounded deep-dive → decision record._

# Story 2.13: Visible Memory write primitives (memory_nodes seed)

Status: done

## Story

As a developer,
I want the `memory_nodes` and `memory_provenance` tables seeded with initial nodes from onboarding,
So that Epic 7's Visible Memory panel has data to render and Epic 5's conversation enrichment has a write target from day 1.

## Architecture Overview

### Memory Data Model (architecture.md §1.2)

**`memory_nodes` table:**
```
id                uuid pk, default gen_random_uuid()
household_id      uuid not null
node_type         node_type enum not null   -- 'preference','rhythm','cultural_rhythm','allergy','child_obsession','school_policy','other'
facet             text not null             -- short identifying label (max 200 chars at service layer)
subject_child_id  uuid null                 -- null for household-level nodes
prose_text        text not null             -- human-readable label for Visible Memory panel
soft_forget_at    timestamptz null          -- null = active
hard_forgotten    boolean not null default false
created_at        timestamptz not null default now()
updated_at        timestamptz not null default now()
```

**`memory_provenance` table (1-to-many sidecar, CASCADE DELETE on node):**
```
id               uuid pk, default gen_random_uuid()
memory_node_id   uuid fk → memory_nodes(id) ON DELETE CASCADE not null
source_type      source_type enum not null  -- 'onboarding','turn','tool','user_edit','plan_outcome','import'
source_ref       jsonb not null             -- { "thread_id": "...", "turn_id": "..." } for onboarding
captured_at      timestamptz not null default now()
captured_by      uuid null                  -- user_id for human-sourced; null for agent
confidence       numeric(3,2) not null      -- CHECK(confidence BETWEEN 0 AND 1)
superseded_by    uuid null                  -- FK to newer provenance row (nullable self-ref)
```

### Seeding Logic (Onboarding Completion)

On onboarding finalize (both text and voice paths), write one `memory_nodes` row per disclosed signal:

| Source array | `node_type` | `facet` | `prose_text` |
|---|---|---|---|
| `allergens_mentioned[]` | `'allergy'` | allergen string | `"Declared allergy: {allergen}"` |
| `cultural_templates[]` | `'cultural_rhythm'` | template string | `"Cultural identity: {template}"` |
| `palate_notes[]` | `'preference'` | note (≤200 chars) | note string |
| `family_rhythms[]` | `'rhythm'` | rhythm (≤200 chars) | rhythm string |

**Provenance for all seeded nodes:**
- `source_type = 'onboarding'`
- `source_ref = { "thread_id": thread.id, "turn_id": summaryTurn.id }` — summary system_event turn id
- `captured_by = userId`
- `confidence = 0.80` (high confidence: direct onboarding disclosure)
- `subject_child_id = null` (household-level; no per-child linkage at seed stage)

**Empty arrays produce zero nodes** — the entire operation is a no-op if all arrays are empty.

### Hook Points in Existing Services

Both services must call `memoryService.seedFromOnboarding(...)` **after** the cultural prior inference step, wrapped in the same silence-mode try/catch pattern:

**Text path** (`onboarding.service.ts#finalizeTextOnboarding`):
```
→ extract summary
→ appendTurnNext summary   ← MUST capture return: const summaryTurn = await ...
→ inferFromSummary (cultural priors)   ← already exists
→ seedFromOnboarding(...)  ← NEW, try/catch silence-mode
→ closeThread
```

**Voice path** (`voice.service.ts#closeSession`, `reason === 'completed'` branch):
```
→ extractSummary
→ appendTurnNext summary   ← MUST capture return: const summaryTurn = await ...
→ inferFromSummary (cultural priors)   ← already exists
→ seedFromOnboarding(...)  ← NEW, try/catch silence-mode
→ closeThread + updateVoiceSession
```

### `memory.note` Agent Tool

Registered in `tools.manifest.ts` with `maxLatencyMs: 200` and a stub `fn` that throws `NotImplementedError` until Story 3.2 wires the orchestrator DI. The factory function `createMemoryNoteSpec(memoryService)` in `memory.tools.ts` is what Story 3.2 calls to swap in the real implementation.

## Acceptance Criteria

1. **Given** migration `20260601000000_create_memory_nodes_and_provenance.sql` has run, **Then** `node_type` and `source_type` Postgres enums exist; `memory_nodes` and `memory_provenance` tables exist with all columns, FK constraints, indexes, and RLS enabled.

2. **Given** text onboarding completes (`POST /v1/onboarding/text/finalize`) with at least one disclosed signal, **Then** one `memory_nodes` row is written per disclosed allergen, cultural template, palate note, or family rhythm, each with a matching `memory_provenance` row: `source_type='onboarding'`, `source_ref={ thread_id, turn_id }` (summary turn), `confidence=0.80`, `captured_by=userId`, `subject_child_id=null`.

3. **Given** voice onboarding completes (agent emits `SESSION_COMPLETE`, `closeSession` fires with `reason='completed'`), **When** the summary contains disclosures, **Then** the same seeding logic runs and produces identical row shapes to AC #2.

4. **Given** onboarding summary has all empty arrays (no allergens, no templates, no palate notes, no family rhythms), **Then** zero memory rows are written and onboarding finalize/close still returns success.

5. **Given** `memoryService.seedFromOnboarding` throws any error (e.g., DB unavailable), **Then** onboarding finalize/close still succeeds (silence-mode) and a warning is logged via Pino; the error is never propagated to the caller.

6. **Given** `tools.manifest.ts` loads, **Then** `TOOL_MANIFEST.get('memory.note')` returns a `ToolSpec` with `name: 'memory.note'` and `maxLatencyMs: 200`; its `fn` throws a `NotImplementedError`-style error until the orchestrator DI replaces it.

7. **Given** `seedFromOnboarding` succeeds in writing at least one node, **Then** a `memory.seeded` audit event is written with `metadata: { node_count, source_type: 'onboarding', thread_id }`; audit write failure is best-effort (logged, never blocking).

8. **Given** `onboarding.agent.ts#extractSummary` is called, **Then** the return value includes `family_rhythms: string[]` in addition to the existing `allergens_mentioned`, `cultural_templates`, and `palate_notes` fields; existing callers receive an empty array if no rhythms are extracted.

## Tasks / Subtasks

- [x] Task 1 — DB migration: enums + tables + indexes + RLS (AC: #1)
  - [x] Create `supabase/migrations/20260601000000_create_memory_nodes_and_provenance.sql`
  - [x] CREATE TYPE `node_type` AS ENUM: `'preference','rhythm','cultural_rhythm','allergy','child_obsession','school_policy','other'`
  - [x] CREATE TYPE `source_type` AS ENUM: `'onboarding','turn','tool','user_edit','plan_outcome','import'`
  - [x] CREATE TABLE `memory_nodes` with all columns; add `updated_at` trigger (mirror `20260515000200_cultural_priors_updated_at_trigger.sql` pattern)
  - [x] CREATE TABLE `memory_provenance` with `REFERENCES memory_nodes(id) ON DELETE CASCADE`; add `CHECK (confidence BETWEEN 0 AND 1)`
  - [x] CREATE INDEX `memory_nodes_household_type_forgotten_idx ON memory_nodes(household_id, node_type, hard_forgotten)` — needed by Epic 7 panel queries
  - [x] CREATE INDEX `memory_provenance_node_idx ON memory_provenance(memory_node_id)` — sidecar join performance
  - [x] ENABLE RLS on both tables; add policy `memory_nodes_primary_parent_select_policy` scoping selects to `household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())`

- [x] Task 2 — Audit type: add `memory.seeded` (AC: #7)
  - [x] Add `'memory.seeded'` to the `AUDIT_EVENT_TYPES` array in `apps/api/src/audit/audit.types.ts`
  - [x] Create `supabase/migrations/20260601000100_add_memory_seeded_audit_type.sql` — `ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'memory.seeded';` (mirrors `20260520000100_add_child_bag_updated_audit_type.sql`)

- [x] Task 3 — Contracts: expand `packages/contracts/src/memory.ts` (AC: #2, #6, #8)
  - [x] Add `NodeTypeSchema = z.enum(['preference','rhythm','cultural_rhythm','allergy','child_obsession','school_policy','other'])`
  - [x] Add `SourceTypeSchema = z.enum(['onboarding','turn','tool','user_edit','plan_outcome','import'])`
  - [x] Add `MemoryNodeSchema` mirroring all DB columns (use `z.string().datetime()` for timestamps)
  - [x] Add `MemoryProvenanceSchema`
  - [x] Add `MemoryNoteInputSchema = z.object({ household_id: z.string().uuid(), node_type: NodeTypeSchema, facet: z.string().min(1).max(200), prose_text: z.string().min(1).max(2000), subject_child_id: z.string().uuid().nullable(), confidence: z.number().min(0).max(1).default(0.75) })`
  - [x] Add `MemoryNoteOutputSchema = z.object({ node_id: z.string().uuid(), created_at: z.string().datetime() })`
  - [x] Update `packages/contracts/src/memory.test.ts` — add round-trip tests for `NodeTypeSchema`, `SourceTypeSchema`, `MemoryNoteInputSchema`, `MemoryNoteOutputSchema`; keep existing `ForgetRequest`/`ForgetCompletedEvent` tests intact

- [x] Task 4 — Types: update `packages/types/src/index.ts` (AC: #2, #6)
  - [x] Add inferred types: `NodeType`, `SourceType`, `MemoryNode`, `MemoryProvenance`, `MemoryNoteInput`, `MemoryNoteOutput`
  - [x] Use `import type` for type-only re-exports (`export type { NodeType, ... }`)

- [x] Task 5 — Agent extension: add `family_rhythms` to `extractSummary` (AC: #8)
  - [x] Update `extractSummary` in `apps/api/src/agents/onboarding.agent.ts`:
    - Extend the OpenAI prompt to also extract `family_rhythms: string[]` (e.g., meal timing, weekly food traditions, school-day lunch patterns)
    - Update return type to include `family_rhythms: string[]`
  - [x] Update `TextOnboardingFinalizeResponseSchema.summary` in `packages/contracts/src/onboarding.ts` — add `family_rhythms: z.array(z.string()).optional()` (backward-compatible optional field)
  - [x] Update `FinalizeTextOnboardingResult['summary']` type in `onboarding.service.ts`
  - [x] Update `OnboardingSummary` interface in `voice.service.ts` to include `family_rhythms?: string[]`

- [x] Task 6 — Repository: create `apps/api/src/modules/memory/memory.repository.ts` (AC: #2, #3)
  - [x] Define `MemoryNodeRow` interface matching DB columns
  - [x] Define `MemoryProvenanceRow` interface
  - [x] Define `InsertNodeInput` and `InsertProvenanceInput` param interfaces
  - [x] `class MemoryRepository extends BaseRepository`:
    - `insertNode(input: InsertNodeInput): Promise<MemoryNodeRow>` — single INSERT with `.select().single()`; throws raw Supabase error on failure
    - `insertProvenance(input: InsertProvenanceInput): Promise<MemoryProvenanceRow>` — same pattern

- [x] Task 7 — Service: create `apps/api/src/modules/memory/memory.service.ts` (AC: #2–#5, #7)
  - [x] Define `MemoryServiceDeps { repository: MemoryRepository; logger: FastifyBaseLogger; audit?: AuditService }`
  - [x] Implement `seedFromOnboarding(input: SeedFromOnboardingInput): Promise<{ nodeCount: number }>`:
    - Build node list by mapping each non-empty array (allergens, cultural_templates, palate_notes, family_rhythms)
    - Use `insertNode` + `insertProvenance` for each node sequentially (no transaction needed — insertions are independent; partial seeding is acceptable)
    - `source_ref = { thread_id: input.threadId, turn_id: input.summaryTurnId }`
    - `confidence = 0.80`, `captured_by = input.userId`, `subject_child_id = null`
    - After all insertions: call `audit?.write({ event_type: 'memory.seeded', ... })` in its own try/catch
    - Return `{ nodeCount }` for caller logging
  - [x] Implement `noteFromAgent(input: NoteFromAgentInput): Promise<{ node_id: string; created_at: string }>`:
    - `insertNode` + `insertProvenance(source_type='tool', captured_by=null, confidence=input.confidence)`
    - Returns `MemoryNoteOutput`-shaped object

- [x] Task 8 — Agent tool: create `apps/api/src/agents/tools/memory.tools.ts` (AC: #6)
  - [x] Export `createMemoryNoteSpec(memoryService: MemoryService): ToolSpec`
  - [x] `inputSchema: MemoryNoteInputSchema`, `outputSchema: MemoryNoteOutputSchema`, `maxLatencyMs: 200`
  - [x] `fn`: parse input with `MemoryNoteInputSchema.parse()`, call `memoryService.noteFromAgent(...)`, return `MemoryNoteOutputSchema.parse(result)`
  - [x] Tool file does NOT import Supabase or any DB client — only `MemoryService` (dependency injection via factory argument)

- [x] Task 9 — Manifest: register `memory.note` stub (AC: #6)
  - [x] In `apps/api/src/agents/tools.manifest.ts`, import schemas from `@hivekitchen/contracts`
  - [x] Add `memory.note` entry alongside `_placeholder`:
    ```ts
    TOOL_MANIFEST.set('memory.note', {
      name: 'memory.note',
      description: 'Write a new memory node from agent context. Story 3.2 injects the real fn via createMemoryNoteSpec(service).',
      inputSchema: MemoryNoteInputSchema,
      outputSchema: MemoryNoteOutputSchema,
      maxLatencyMs: 200,
      fn: async (_input: unknown): Promise<unknown> => {
        throw new Error('memory.note not yet wired — orchestrator DI injects fn in Story 3.2');
      },
    });
    ```
  - [x] Keep `_placeholder` entry (CI lint placeholder pattern; do not remove)

- [x] Task 10 — Text onboarding hook (AC: #2, #4, #5)
  - [x] Add `memoryService?: MemoryService` to `OnboardingServiceDeps` interface and constructor
  - [x] In `finalizeTextOnboarding`, change summary turn write from `await` to capture:
    ```ts
    const summaryTurn = await this.threads.appendTurnNext({ role: 'system', ... });
    ```
  - [x] After the cultural prior try/catch block, add:
    ```ts
    if (this.memoryService) {
      try {
        const { nodeCount } = await this.memoryService.seedFromOnboarding({
          householdId: input.householdId,
          userId: input.userId,
          threadId: thread.id,
          summaryTurnId: summaryTurn.id,
          summary,
        });
        this.logger.info({ module: 'onboarding', action: 'onboarding.memory_seeded', household_id: input.householdId, node_count: nodeCount }, 'memory nodes seeded from onboarding');
      } catch (err) {
        this.logger.warn({ err, module: 'onboarding', action: 'onboarding.memory_seed_failed', household_id: input.householdId }, 'memory seed failed during finalize — silence-mode fallback');
      }
    }
    ```

- [x] Task 11 — Voice service hook (AC: #3, #4, #5)
  - [x] Add `memoryService?: MemoryService` to `VoiceServiceDeps` interface and constructor
  - [x] In `closeSession` (`reason === 'completed'` branch), change the summary turn `await` to a captured variable (line ~481 currently: `await this.repository.appendTurnNext({ role: 'system', ... })`)
  - [x] After cultural prior try/catch block, add the same silence-mode seed block using `session.householdId`, `session.userId`, `session.threadId`, and the captured summary turn id

- [x] Task 12 — App wiring: instantiate and inject memory module (AC: #2, #3)
  - [x] In `apps/api/src/app.ts`, import `MemoryRepository` and `MemoryService`
  - [x] Instantiate: `const memoryRepository = new MemoryRepository(fastify.supabase); const memoryService = new MemoryService({ repository: memoryRepository, logger: fastify.log, audit: auditService });`
  - [x] Pass `memoryService` into `OnboardingService` deps and `VoiceService` deps
  - [x] `auditService` is already instantiated in `app.ts` — pass the existing instance into `MemoryServiceDeps`

- [x] Task 13 — Tests (AC: #1–#8)
  - [x] `packages/contracts/src/memory.test.ts` — add schema tests: `NodeTypeSchema` rejects unknown strings; `MemoryNoteInputSchema` rejects missing required fields; `MemoryNoteOutputSchema` round-trips a valid object
  - [x] `apps/api/src/modules/memory/memory.repository.test.ts` — mock supabase client; test `insertNode` and `insertProvenance` happy paths and error propagation (follow `children.routes.test.ts` mock pattern)
  - [x] `apps/api/src/modules/memory/memory.service.test.ts` — test `seedFromOnboarding`: empty summary → zero calls to repo; non-empty → correct node types + provenance; repo throws → silence-mode (returns `{ nodeCount: 0 }`)
  - [x] Update `apps/api/src/modules/onboarding/onboarding.service.ts` test or create `onboarding.service.test.ts` — verify `memoryService.seedFromOnboarding` is called on finalize success and NOT called on finalize failure paths
  - [x] `pnpm typecheck` must pass; `pnpm --filter @hivekitchen/contracts test`, `pnpm --filter @hivekitchen/api test` must be green

## Dev Notes

### Silence-mode is mandatory for memory seeding
The cultural prior inference at `onboarding.service.ts:386-408` and `voice.service.ts:499-511` wraps the call in try/catch/warn with silence-mode fallback. Memory seeding MUST use the exact same pattern. Any exception from `seedFromOnboarding` must be caught, logged at WARN level via Pino, and not re-thrown. The onboarding flow must never fail because the memory tier is unavailable.

### Migration timestamp: use 20260601, NOT 20260502
The architecture file tree references `20260502090000_create_memory_nodes_and_provenance.sql` as the planned filename, but that slot is already used by the RLS migration. The last actual migration is `20260530000000_add_disconnected_voice_session_status.sql`. Use `20260601000000` for the main migration and `20260601000100` for the audit type migration. Do NOT attempt to use the 20260502 slot — it will cause migration drift.

### No envelope encryption on `memory_nodes` or `memory_provenance`
Encrypted fields in this project are ONLY: `children.declared_allergens`, `children.cultural_identifiers`, `children.dietary_preferences`, `heart_notes.content`, `households.caregiver_relationships` (architecture §2.4). Memory node `prose_text` contains derived/summarized data and must NOT be encrypted. Do not pass a `kek` to any memory repository method.

### `subject_child_id = null` for all onboarding seed nodes
The onboarding summary is household-level; it does not attribute specific disclosures to specific children. Set `subject_child_id = null` on ALL seed rows. Epic 7 will refine child-level attribution when building the visible memory panel.

### Capturing the summary turn id
The current code in both services writes the summary system_event turn but discards the returned `TurnRow`. You MUST capture it:
```ts
// BEFORE (current code, both services):
await this.threads.appendTurnNext({ role: 'system', body: { type: 'system_event', ... } });

// AFTER (required change):
const summaryTurn = await this.threads.appendTurnNext({ role: 'system', body: { type: 'system_event', ... } });
// then pass summaryTurn.id to seedFromOnboarding as summaryTurnId
```
In `voice.service.ts` the method is on `this.repository` (not `this.threads`): `const summaryTurn = await this.repository.appendTurnNext(...)`.

### ESM `.js` extensions on all relative imports in `apps/api`
Every relative import in `apps/api/src` must use `.js` extension:
```ts
import { MemoryRepository } from './memory.repository.js';   // correct
import { MemoryRepository } from './memory.repository';       // WRONG — breaks Node.js ESM
```

### No barrel `index.ts` in `apps/api/src/modules/memory/`
The project rules prohibit barrel files inside `apps/*/src` (project-context.md). Import from the specific file:
```ts
import { MemoryService } from '../modules/memory/memory.service.js';   // correct
import { MemoryService } from '../modules/memory';                       // WRONG — no barrel
```

### Zod 3.23 (NOT Zod 4)
The project uses `zod: "^3.23"`. In Zod 3, `z.enum([...])` requires an array literal. Avoid Zod 4 APIs. In Zod 3, enum schema is:
```ts
const NodeTypeSchema = z.enum(['preference', 'rhythm', 'cultural_rhythm', 'allergy', 'child_obsession', 'school_policy', 'other']);
```

### `BaseRepository` pattern for MemoryRepository
```ts
import { BaseRepository } from '../../repository/base.repository.js';
export class MemoryRepository extends BaseRepository {
  // constructor inherits: constructor(protected readonly client: SupabaseClient)
}
```
Never import `@supabase/supabase-js` directly in the service or tool files.

### RLS policy naming convention (architecture naming §1.1)
Format: `<table>_<role>_<action>_policy`. Both tables need policies:
- `memory_nodes_primary_parent_select_policy` — SELECT scoped to household
- Future: `memory_nodes_primary_parent_insert_policy` when user-edit nodes land (Epic 7)

### `memory.note` tool: stub fn pattern for manifest
```ts
TOOL_MANIFEST.set('memory.note', {
  name: 'memory.note',
  description: '...',
  inputSchema: MemoryNoteInputSchema,
  outputSchema: MemoryNoteOutputSchema,
  maxLatencyMs: 200,
  fn: async (_input: unknown): Promise<unknown> => {
    throw new Error('memory.note not yet wired — Story 3.2 injects fn via createMemoryNoteSpec(memoryService)');
  },
});
```
The `_placeholder` entry MUST remain; only add `memory.note` alongside it.

### Audit writes from background service (not route handler)
`seedFromOnboarding` runs outside a request-response cycle; `request.auditContext` is unavailable. Use `AuditService.write()` directly with a synthesized `request_id`:
```ts
await this.audit?.write({
  event_type: 'memory.seeded',
  household_id: input.householdId,
  request_id: crypto.randomUUID(),
  metadata: { node_count: nodeCount, source_type: 'onboarding', thread_id: input.threadId },
});
```
`crypto` is available from `node:crypto` (Node 22). Wrap in try/catch — audit failure must never block.

### `family_rhythms` extraction in `onboarding.agent.ts`
Extend the `extractSummary` system prompt to also extract meal timing, weekly food traditions, and weekday lunch patterns as `family_rhythms: string[]`. The return type must be updated:
```ts
async extractSummary(...): Promise<{
  cultural_templates: string[];
  palate_notes: string[];
  allergens_mentioned: string[];
  family_rhythms: string[];    // NEW
}>
```
Keep the same extraction style (returns empty array `[]` if nothing is identified — no null/undefined).

### `OnboardingFinalizeResponseSchema` backward compat
Add `family_rhythms` as optional to preserve existing web client compatibility:
```ts
summary: z.object({
  cultural_templates: z.array(z.string()),
  palate_notes: z.array(z.string()),
  allergens_mentioned: z.array(z.string()),
  family_rhythms: z.array(z.string()).optional(),  // backward-compat optional
}),
```

### `insertNode` + `insertProvenance` are separate calls (not transactional)
Supabase-js does not support multi-statement transactions via the API client (no `BEGIN`/`COMMIT`). For each node, call `insertNode` → `insertProvenance` sequentially. Partial seeding (node written, provenance fails) is acceptable — the node exists without a provenance row, which is better than losing the node entirely. Epic 7 can reconcile orphaned nodes during the forget job.

### Pino logger — no `console.*`
All logging in `memory.service.ts` must use the injected `FastifyBaseLogger` (`this.logger.info`, `.warn`, `.error`). No `console.log` or `console.error` allowed in `apps/api` (project-context.md critical rule).

### Project Structure Notes

**New files:**
- `supabase/migrations/20260601000000_create_memory_nodes_and_provenance.sql`
- `supabase/migrations/20260601000100_add_memory_seeded_audit_type.sql`
- `apps/api/src/modules/memory/memory.repository.ts`
- `apps/api/src/modules/memory/memory.service.ts`
- `apps/api/src/agents/tools/memory.tools.ts`
- `apps/api/src/modules/memory/memory.repository.test.ts` (or `.service.test.ts`)

**Modified files:**
- `packages/contracts/src/memory.ts` — add NodeTypeSchema, SourceTypeSchema, MemoryNodeSchema, MemoryProvenanceSchema, MemoryNoteInputSchema, MemoryNoteOutputSchema
- `packages/contracts/src/memory.test.ts` — add tests for new schemas
- `packages/types/src/index.ts` — add inferred types
- `apps/api/src/audit/audit.types.ts` — add `'memory.seeded'`
- `apps/api/src/agents/tools.manifest.ts` — add `memory.note` entry
- `apps/api/src/agents/onboarding.agent.ts` — extend `extractSummary` to return `family_rhythms`
- `packages/contracts/src/onboarding.ts` — add optional `family_rhythms` to summary schema
- `apps/api/src/modules/onboarding/onboarding.service.ts` — add memoryService dep + seed hook
- `apps/api/src/modules/voice/voice.service.ts` — add memoryService dep + seed hook
- `apps/api/src/app.ts` — instantiate MemoryRepository + MemoryService, inject into both services

**No web-layer changes.** This is a backend-only developer story. No `apps/web` modifications.

**`memory.tools.ts` location:** Lives in `apps/api/src/agents/tools/`, NOT in `modules/memory/` — the agents boundary separates tool declarations from module implementations.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.13]
- [Source: _bmad-output/planning-artifacts/architecture.md §1.2] — memory_nodes + memory_provenance schema (exact column definitions)
- [Source: _bmad-output/planning-artifacts/architecture.md §1.4] — migration naming convention
- [Source: _bmad-output/planning-artifacts/architecture.md §2.4] — envelope encryption scope (memory NOT encrypted)
- [Source: _bmad-output/planning-artifacts/architecture.md §3.4] — tool maxLatencyMs declarations (memory.recall=200)
- [Source: _bmad-output/planning-artifacts/architecture.md naming §1.1] — RLS policy naming, table naming conventions
- [Source: _bmad-output/planning-artifacts/architecture.md structure §2.1 file tree] — `agents/tools/memory.tools.ts` location
- [Source: apps/api/src/modules/voice/voice.service.ts:499-511] — silence-mode try/catch pattern to mirror
- [Source: apps/api/src/modules/onboarding/onboarding.service.ts:386-408] — cultural prior hook point + pattern
- [Source: apps/api/src/modules/cultural-priors/cultural-prior.service.ts] — `inferFromSummary` as the behavioral model for `seedFromOnboarding`
- [Source: apps/api/src/agents/tools.manifest.ts] — current manifest structure + ToolSpec interface
- [Source: apps/api/src/audit/audit.types.ts] — AUDIT_EVENT_TYPES array to extend
- [Source: apps/api/src/repository/base.repository.ts] — BaseRepository pattern
- [Source: apps/api/src/modules/children/children.repository.ts] — repository pattern (insertNode follows same CHILD_COLUMNS / type-cast approach)
- [Source: supabase/migrations/20260520000100_add_child_bag_updated_audit_type.sql] — audit type migration pattern
- [Source: supabase/migrations/20260515000200_cultural_priors_updated_at_trigger.sql] — updated_at trigger pattern to reuse
- [Source: _bmad-output/project-context.md §Technology Stack] — Zod 3.23, ESM, no barrel files, no console.*, Pino, strict TS
- [Source: _bmad-output/implementation-artifacts/2-12-per-child-lunch-bag-slot-declaration.md#Completion Notes] — JSONB + audit pattern learnings

## Dev Agent Record

### Agent Model Used

claude-opus-4-7

### Debug Log References

- `pnpm --filter @hivekitchen/contracts vitest run src/memory.test.ts` — 22/22 passing (NodeType, SourceType, MemoryNoteInput/Output, MemoryNode, MemoryProvenance round-trips + ForgetRequest/ForgetCompletedEvent retained)
- `pnpm --filter @hivekitchen/api vitest run src/modules/memory/` — 13/13 passing (repository insert paths + service seed/note flows + audit + silence-mode + truncation)
- `pnpm --filter @hivekitchen/api vitest run` — 194 passing, 11 skipped, no regressions
- `pnpm typecheck` — only failures are pre-existing (cultural.test.ts 6 failures + voice.service.test.ts `RequestInfo` 3 errors), confirmed on main without these changes via temporary stash

### Completion Notes List

- DB migration uses the 20260601000000 timestamp slot (not 20260502 — that slot is occupied by an RLS migration; see Dev Notes). Audit type migration follows at 20260601000100.
- `memory.tools.ts` is registered alongside the existing `_placeholder` entry in `tools.manifest.ts` with a `NotImplementedError`-style stub (`fn` throws). Story 3.2 will swap in the real fn via the `createMemoryNoteSpec(memoryService)` factory exported from `apps/api/src/agents/tools/memory.tools.ts`.
- Silence-mode: both onboarding and voice hooks wrap `seedFromOnboarding` in try/catch that logs WARN via Pino. The service itself is also tolerant per-row (insertNode/insertProvenance failures are logged and skipped) so partial seeding is acceptable per architecture §1.2.
- `subject_child_id = null` for all onboarding seed rows — household-level disclosures only at this stage. Epic 7 will refine child-level attribution when building the Visible Memory panel.
- `memory.seeded` audit event is best-effort: failure is logged WARN, never blocks. Audit context is synthesized via `crypto.randomUUID()` since seeding runs outside a request-response cycle.
- `family_rhythms` added to `extractSummary` (onboarding agent) and to `TextOnboardingFinalizeResponseSchema.summary` as an optional field for backward web-client compatibility. `OnboardingSummary` interface in `voice.service.ts` also marked the field optional.
- `auditService` is now decorated on the Fastify instance from inside `audit.hook.ts` so route plugins (onboarding, voice) can reach the same instance without re-instantiating it. This adapts the story's "auditService is already instantiated in app.ts" guidance to the current per-plugin instantiation pattern in the codebase.
- RLS policies follow `<table>_<role>_<action>_policy` naming: `memory_nodes_primary_parent_select_policy` and `memory_provenance_primary_parent_select_policy`. INSERT policies are deferred to Epic 7 (user-edit nodes); for now all writes go through the API service-role client (bypasses RLS).
- Pre-existing failures in this repo (NOT caused by this story, confirmed via stash): `packages/contracts/src/cultural.test.ts` 6 failures and `apps/api/src/modules/voice/voice.service.test.ts` 3 type-only `RequestInfo` errors.

### File List

**New files:**
- `supabase/migrations/20260601000000_create_memory_nodes_and_provenance.sql`
- `supabase/migrations/20260601000100_add_memory_seeded_audit_type.sql`
- `apps/api/src/modules/memory/memory.repository.ts`
- `apps/api/src/modules/memory/memory.repository.test.ts`
- `apps/api/src/modules/memory/memory.service.ts`
- `apps/api/src/modules/memory/memory.service.test.ts`
- `apps/api/src/agents/tools/memory.tools.ts`

**Modified files:**
- `apps/api/src/audit/audit.types.ts` — added `'memory.seeded'`
- `apps/api/src/agents/tools.manifest.ts` — registered `memory.note` stub spec
- `apps/api/src/agents/onboarding.agent.ts` — extended `extractSummary` to return `family_rhythms`
- `apps/api/src/middleware/audit.hook.ts` — decorated `fastify.auditService`
- `apps/api/src/modules/onboarding/onboarding.service.ts` — added optional `MemoryService` dep, captured summary turn id, silence-mode seed call after cultural priors, surface `family_rhythms`
- `apps/api/src/modules/onboarding/onboarding.routes.ts` — instantiate `MemoryRepository` + `MemoryService`, inject into service
- `apps/api/src/modules/voice/voice.service.ts` — added optional `MemoryService` dep, captured summary turn id, silence-mode seed call after cultural priors, summary type now includes `family_rhythms?`
- `apps/api/src/modules/voice/voice.routes.ts` — instantiate `MemoryRepository` + `MemoryService`, inject into service
- `apps/api/src/types/fastify.d.ts` — added `auditService: AuditService` decoration type
- `packages/contracts/src/memory.ts` — added `NodeTypeSchema`, `SourceTypeSchema`, `MemoryNodeSchema`, `MemoryProvenanceSchema`, `MemoryNoteInputSchema`, `MemoryNoteOutputSchema`
- `packages/contracts/src/memory.test.ts` — added round-trip tests for the new schemas
- `packages/contracts/src/onboarding.ts` — added optional `family_rhythms: z.array(z.string()).optional()` to summary schema
- `packages/types/src/index.ts` — re-exported `NodeType`, `SourceType`, `MemoryNode`, `MemoryProvenance`, `MemoryNoteInput`, `MemoryNoteOutput`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Story 2-13 marked in-progress (will flip to review)

### Change Log

- 2026-04-30 — Story 2.13 implemented: visible memory write primitives. New `memory_nodes` + `memory_provenance` tables (20260601000000), `memory.seeded` audit type (20260601000100), `MemoryRepository` + `MemoryService` (silence-mode seed loop, best-effort audit, partial-seed tolerance), `memory.note` agent tool factory + manifest stub, `family_rhythms` extraction in onboarding agent + contract, hooks in both text and voice onboarding finalize paths, expanded contract schemas + types, full unit-test coverage for repository, service, and contract layers.

### Review Findings

- [x] [Review][Decision → Patch] Duplicate memory nodes — resolved: add DB unique constraint on `(household_id, node_type, facet)` + `ON CONFLICT DO NOTHING` in a new migration; add intra-call dedup `Set` in `buildNodeSpecs`. [`memory.service.ts:167-210`, `migration`]

- [x] [Review][Decision → Patch] MemoryService wiring: per-plugin instances vs. spec-mandated app.ts singleton — resolved: move instantiation to `app.ts` and register as a Fastify decorator (`fastify.decorate('memoryService', ...)`) consistent with `auditService` pattern. Remove per-plugin instantiation from `onboarding.routes.ts` and `voice.routes.ts`. [`onboarding.routes.ts:27-32`, `voice.routes.ts:32-38`, `app.ts`]

- [x] [Review][Decision → Patch] Voice path silently skips seeding when summary turn DB write fails — resolved: add one retry on `appendTurnNext` in the voice path before giving up. If retry succeeds seed normally; if it fails twice fall through to the existing silence-mode skip. [`voice.service.ts:482-502`]

- [x] [Review][Patch] `summaryTurn` declared as non-nullable `TurnRow` without initializer — latent definite-assignment defect [`onboarding.service.ts:372`] — TypeScript only passes because the catch block always re-throws; any future silence-mode conversion would break. Fix: change to `let summaryTurn: TurnRow | null = null` and add `if (summaryTurn)` guard before seed call (mirrors voice path).

- [x] [Review][Patch] Supabase `.single()` null data not guarded in `MemoryRepository` [`memory.repository.ts:56-58, 65-67`] — `insertNode` and `insertProvenance` only check `if (error)`. Supabase can return `data: null, error: null` (e.g., silent RLS block). The `data as MemoryNodeRow` cast produces a null crash downstream. Fix: add `if (!data) throw new Error('insertNode returned no data')` after each `.single()`.

- [x] [Review][Patch] `noteFromAgent` does not cap `proseText` [`memory.service.ts:152`] — `seedFromOnboarding` uses `truncate()` for facet; `noteFromAgent` truncates `facet` but passes `proseText` uncapped. Direct calls bypass Zod validation. Fix: apply `truncate(input.proseText, 2000)` in `noteFromAgent`.

- [x] [Review][Patch] Misleading info log fires when `nodeCount === 0` [`onboarding.service.ts:423-432`, `voice.service.ts:530-543`] — both callers always log `'memory nodes seeded from onboarding'` regardless of `nodeCount`. Fix: add `if (nodeCount > 0)` guard before the info log in both callers.

- [x] [Review][Patch] `audit.hook.ts` decorates without `hasDecorator` guard [`middleware/audit.hook.ts:9`] — `fastify.decorate('auditService', service)` throws `FST_ERR_DEC_ALREADY_PRESENT` if the plugin registers twice (test environments, scope re-use). Fix: wrap with `if (!fastify.hasDecorator('auditService'))` before decorating.

- [x] [Review][Patch] `nodeCount` incremented before provenance insert — audit event over-reports [`memory.service.ts:70-117`] — `nodeCount += 1` fires immediately after `insertNode` succeeds; if `insertProvenance` then throws, the audit event reports the orphaned node in its count. Fix: move `nodeCount += 1` after the provenance block (outside the provenance catch), so only fully-provenanced nodes are counted.

- [x] [Review][Patch] `family_rhythms` optional in `OnboardingSeedSummary` despite agent always returning it [`memory.service.ts:17`, `voice.service.ts:23`] — `onboarding.agent.ts#extractSummary` declares return type `family_rhythms: string[]` (non-optional). Both the memory service's `OnboardingSeedSummary` and the voice service's local `OnboardingSummary` declare it optional, creating unnecessary optionality at the call site. Fix: made `family_rhythms` non-optional in `voice.service.ts#OnboardingSummary`; `OnboardingSeedSummary` kept optional to avoid cascade into contracts schema (deferred until contracts schema is updated).

- [x] [Review][Defer] Orphaned `memory_nodes` when `insertProvenance` fails in seeding path — pre-existing by design; spec §Dev Notes explicitly says "partial seeding is acceptable" and Epic 7 reconciles orphaned nodes. [`memory.service.ts:104-117`]
- [x] [Review][Defer] `noteFromAgent` orphaned node when `insertProvenance` throws — `noteFromAgent` is not in silence-mode; exception propagates to the tool caller as expected. Epic 7 reconciliation handles orphans. [`memory.service.ts:157-163`]
- [x] [Review][Defer] Prose text prefix format (`"Declared allergy: X"`, `"Cultural identity: X"`) — spec-mandated seeding table format; not a free design choice. [`memory.service.ts:174-186`]
- [x] [Review][Defer] RLS INSERT/UPDATE/DELETE policies missing from `memory_nodes` and `memory_provenance` — spec explicitly defers write policies to Epic 7; all writes via API service-role client which bypasses RLS. [`migration:72-86`]
- [x] [Review][Defer] `memory_provenance` SELECT RLS policy uses correlated subquery — O(n×m) performance concern at scale; no correctness impact at current scale. [`migration:80-86`]
- [x] [Review][Defer] `memory_provenance` has no `updated_at` column or trigger — not in spec schema definition; Epic 7 can add timestamped supersession when the forget job lands. [`migration:44-53`]
- [x] [Review][Defer] `facet` column has no DB-level length constraint (text, uncapped) — application-layer enforcement via Zod is the consistent project pattern across all repositories. [`migration:34`]
- [x] [Review][Defer] `set_updated_at` function re-declared with `CREATE OR REPLACE` — documented intentional in migration header; function body is identical to prior migrations; independently runnable by design. [`migration:60-66`]
- [x] [Review][Defer] `memory.note` stub throws plain `Error`, not a typed `NotImplementedError` — spec says "style"; no `NotImplementedError` class exists in the codebase. Intentional stub per AC6. [`tools.manifest.ts:37`]
- [x] [Review][Defer] Tool-written provenance rows always have `source_ref: {}` — `sourceRef` is not in `MemoryNoteInputSchema`; all agent-written nodes have empty source context in provenance. Not required by spec; Epic 5's tool wiring story can address traceability. [`memory.tools.ts:21`]

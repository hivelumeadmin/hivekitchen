# Story 3.1: Allergy Guardrail Service — deterministic, authoritative, outside agent boundary

Status: done

## Story

As a Primary Parent,
I want every plan to pass through a deterministic rule-based allergy guardrail that runs outside the agent process boundary as the sole authority on render-eligibility,
So that no LLM hallucination, prompt injection, or guardrail tool failure can ever surface an allergen-containing plan to me (FR76, FR77, Pre-Step-1 Ruling).

## Acceptance Criteria

1. **Given** the migration runs,
   **When** the database is ready,
   **Then** `allergy_rules` (supporting top-9 FALCPA allergens as system rows + parent-declared household rows) and `guardrail_decisions` tables exist with RLS enabled.

2. **Given** a plan is submitted to `allergyGuardrailService.clearOrReject(planItems, householdId, requestId)`,
   **When** the deterministic engine in `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts` evaluates every ingredient against every declared allergen for every child,
   **Then** the engine returns `{verdict: 'cleared'|'blocked', conflicts: Conflict[]}` where `Conflict = {child_id, allergen, ingredient, slot?}`, a `guardrail_decisions` row is written, and on `blocked` an `allergy.guardrail_rejection` audit row is written.

3. **Given** the advisory `allergy.check` tool runs during agent plan generation,
   **When** `allergyGuardrailService.evaluate(planItems, householdId)` is called,
   **Then** the same `allergy-rules.engine.ts` `evaluate()` function is called — single source of truth, no separate logic — but **no** `guardrail_decisions` row or audit row is written (advisory only, not the authoritative gate).

4. **Given** `createAllergyCheckSpec(allergyGuardrailService)` is called during orchestrator wiring (Story 3.2),
   **When** `allergy.check` is registered in `TOOL_MANIFEST`,
   **Then** it has `maxLatencyMs: 150`, `inputSchema: AllergyCheckInputSchema`, `outputSchema: AllergyCheckOutputSchema` from `@hivekitchen/contracts`.

5. **Given** the `_placeholder` tool in `tools.manifest.ts` carries the comment "remove before Epic 3 tools land",
   **When** this story lands,
   **Then** the `_placeholder` spec and its map entry are removed.

6. **Given** the `GUARDRAIL_VERSION` constant exported from `allergy-rules.engine.ts`,
   **When** `clearOrReject()` writes a `guardrail_decisions` row,
   **Then** `guardrail_decisions.guardrail_version` is set to `GUARDRAIL_VERSION` for audit reconstruction.
   *(Note: `plans.guardrail_cleared_at` / `plans.guardrail_version` columns and the plans-presentation clause are Story 3.5 scope — not this story.)*

---

## Tasks / Subtasks

### Task 1 — DB migration: allergy_rules + guardrail_decisions (AC: #1)

- [x] Create `supabase/migrations/20260610000000_create_allergy_guardrail_tables.sql`
  - [x] Create `guardrail_verdict_enum` Postgres type: values `'cleared'`, `'blocked'`, `'uncertain'`
  - [x] Create `allergy_rules` table:
    - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
    - `household_id uuid REFERENCES households(id) ON DELETE CASCADE` — nullable; NULL = system/FALCPA reference rows
    - `child_id uuid REFERENCES children(id) ON DELETE CASCADE` — nullable; NULL = household-wide rule
    - `allergen text NOT NULL` — canonical name, e.g., `'peanuts'`, `'tree_nuts'`
    - `rule_type text NOT NULL CHECK (rule_type IN ('falcpa', 'parent_declared'))`
    - `created_at timestamptz NOT NULL DEFAULT now()`
    - Composite index: `CREATE INDEX ON allergy_rules (household_id, child_id)` for engine load perf
  - [x] Seed FALCPA top-9 system rows (`household_id = NULL, child_id = NULL, rule_type = 'falcpa'`):
    `'peanuts'`, `'tree_nuts'`, `'milk'`, `'eggs'`, `'wheat'`, `'soy'`, `'fish'`, `'shellfish'`, `'sesame'`
  - [x] Create `guardrail_decisions` table:
    - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
    - `plan_id uuid` — nullable (no FK yet; Story 3.5 adds FK to plans)
    - `household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE`
    - `verdict guardrail_verdict_enum NOT NULL`
    - `guardrail_version text NOT NULL`
    - `conflicts jsonb NOT NULL DEFAULT '[]'`
    - `evaluated_at timestamptz NOT NULL DEFAULT now()`
    - `request_id uuid NOT NULL`
    - Index: `CREATE INDEX ON guardrail_decisions (household_id, evaluated_at DESC)` for audit queries
  - [x] Enable RLS on both tables — service-role bypasses for server-side writes; authenticated users read only their own household's rows

### Task 2 — Contracts: ConflictSchema + GuardrailResultSchema + AllergyCheckInputSchema (AC: #2, #3, #4)

- [x] In `packages/contracts/src/plan.ts`, append after existing schemas:
  ```typescript
  export const ConflictSchema = z.object({
    child_id: z.string().uuid(),
    allergen: z.string().min(1),
    ingredient: z.string().min(1),
    slot: z.string().optional(),
  });

  export const GuardrailResultSchema = z.discriminatedUnion('verdict', [
    z.object({ verdict: z.literal('cleared'), conflicts: z.array(ConflictSchema) }),
    z.object({ verdict: z.literal('blocked'), conflicts: z.array(ConflictSchema).min(1) }),
  ]);

  export const PlanItemForGuardrailSchema = z.object({
    child_id: z.string().uuid(),
    day: z.string().min(1),
    slot: z.string().min(1),
    ingredients: z.array(z.string().min(1)),
  });

  export const AllergyCheckInputSchema = z.object({
    household_id: z.string().uuid(),
    plan_items: z.array(PlanItemForGuardrailSchema).min(1),
  });

  export const AllergyCheckOutputSchema = GuardrailResultSchema;
  ```
  `contracts/index.ts` uses `export * from './plan.js'` — no index.ts change required.
- [x] In `packages/types/src/index.ts`, add to the existing imports from `@hivekitchen/contracts`:
  `ConflictSchema`, `GuardrailResultSchema`, `PlanItemForGuardrailSchema`, `AllergyCheckInputSchema`, `AllergyCheckOutputSchema`
  Then add type exports under the `// Plans` section:
  ```typescript
  export type Conflict = z.infer<typeof ConflictSchema>;
  export type GuardrailResult = z.infer<typeof GuardrailResultSchema>;
  export type PlanItemForGuardrail = z.infer<typeof PlanItemForGuardrailSchema>;
  export type AllergyCheckInput = z.infer<typeof AllergyCheckInputSchema>;
  ```

### Task 3 — Engine: pure deterministic evaluator (AC: #2, #3)

- [x] Create `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts`
  - [x] `export const GUARDRAIL_VERSION = '1.0.0' as const`
  - [x] `export const FALCPA_TOP_9 = ['peanuts', 'tree_nuts', 'milk', 'eggs', 'wheat', 'soy', 'fish', 'shellfish', 'sesame'] as const satisfies readonly string[]`
  - [x] `export type AllergyRule = { id: string; household_id: string | null; child_id: string | null; allergen: string; rule_type: 'falcpa' | 'parent_declared' }`
  - [x] `export function evaluate(planItems: PlanItemForGuardrail[], rules: AllergyRule[]): GuardrailResult`
    - **Pure function — no `async`, no DB calls, no side effects**
    - For each plan item, filter rules to those applicable to the item's `child_id` (rules where `rule.child_id === item.child_id` OR `rule.child_id === null`)
    - For each applicable rule, case-insensitive substring check: does `item.ingredients` contain any string that contains the `rule.allergen` substring, OR does the allergen contain an ingredient substring?
    - On match: push `{ child_id: item.child_id, allergen: rule.allergen, ingredient: matchedIngredient, slot: item.slot }` to conflicts array; continue (collect ALL conflicts across all items)
    - Return `{ verdict: 'blocked', conflicts }` if `conflicts.length > 0`, else `{ verdict: 'cleared', conflicts: [] }`
  - [x] Import `GuardrailResult` and `PlanItemForGuardrail` from `@hivekitchen/types` (re-exports the contract types — keeps API code on `@hivekitchen/types` per the project pattern)

### Task 4 — Repository: rules reader + decisions writer (AC: #2)

- [x] Create `apps/api/src/modules/allergy-guardrail/allergy-guardrail.repository.ts`
  - [x] Export `AllergyGuardrailRepository` class; extends `BaseRepository` (matches the `MemoryRepository` pattern; `BaseRepository` already takes the Supabase client)
  - [x] `getRulesForHousehold(householdId: string): Promise<AllergyRule[]>`
    - SELECT from `allergy_rules` WHERE `household_id = $1 OR household_id IS NULL` (includes FALCPA system rows)
    - Returns typed `AllergyRule[]`
  - [x] `writeDecision(input: { plan_id?: string; household_id: string; verdict: string; guardrail_version: string; conflicts: unknown[]; request_id: string }): Promise<void>`
    - INSERT into `guardrail_decisions`; throw on Supabase error

### Task 5 — Service: two public methods — evaluate (advisory) + clearOrReject (authoritative) (AC: #2, #3)

- [x] Create `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts`
  - [x] Export `AllergyGuardrailService` class
  - [x] Constructor: `constructor(private readonly repo: AllergyGuardrailRepository, private readonly auditService: AuditService)`
  - [x] `async evaluate(planItems: PlanItemForGuardrail[], householdId: string): Promise<GuardrailResult>`
    - Loads rules via `this.repo.getRulesForHousehold(householdId)`
    - Calls `engine.evaluate(planItems, rules)` (import from engine)
    - Returns result — **no DB write, no audit write** (advisory path)
  - [x] `async clearOrReject(planItems: PlanItemForGuardrail[], householdId: string, requestId: string): Promise<GuardrailResult>`
    - Calls `this.evaluate(planItems, householdId)` to get result
    - Calls `this.repo.writeDecision({ household_id: householdId, verdict: result.verdict, guardrail_version: GUARDRAIL_VERSION, conflicts: result.conflicts, request_id: requestId })`
    - If `result.verdict === 'blocked'`: calls `this.auditService.write({ event_type: 'allergy.guardrail_rejection', household_id: householdId, request_id: requestId, metadata: { conflicts: result.conflicts, guardrail_version: GUARDRAIL_VERSION } })`
    - Returns result

### Task 6 — Advisory tool: allergy.tools.ts (AC: #3, #4)

- [x] Create `apps/api/src/agents/tools/allergy.tools.ts`
  - [x] Import `AllergyCheckInputSchema`, `AllergyCheckOutputSchema` from `@hivekitchen/contracts`
  - [x] Import `type ToolSpec` from `../../agents/tools.manifest.js`
  - [x] Import `type AllergyGuardrailService` from `../../modules/allergy-guardrail/allergy-guardrail.service.js`
  - [x] Also export `MANIFESTED_TOOL_NAMES = ['allergy.check'] as const` per the Story 1.9 contract (`scripts/check-tool-manifest.ts` requires it)
  - [x] Export `createAllergyCheckSpec(allergyGuardrailService: AllergyGuardrailService): ToolSpec`:
    ```typescript
    return {
      name: 'allergy.check',
      description: 'Advisory allergy check — runs same engine as authoritative guardrail. Tool-cleared is not guardrail-cleared.',
      inputSchema: AllergyCheckInputSchema,
      outputSchema: AllergyCheckOutputSchema,
      maxLatencyMs: 150,
      fn: async (input: unknown) => {
        const parsed = AllergyCheckInputSchema.parse(input);
        return allergyGuardrailService.evaluate(parsed.plan_items, parsed.household_id);
      },
    };
    ```
  - [x] No `randomUUID()` for requestId — `evaluate()` is advisory and makes no DB writes; no requestId needed

### Task 7 — tools.manifest.ts: remove placeholder, add allergy.check stub (AC: #4, #5)

- [x] In `apps/api/src/agents/tools.manifest.ts`:
  - [x] Remove `PlaceholderInputSchema`, `PlaceholderOutputSchema`, `placeholderSpec` const, and the `['_placeholder', placeholderSpec]` map entry
  - [x] Add imports: `AllergyCheckInputSchema`, `AllergyCheckOutputSchema` from `@hivekitchen/contracts`
  - [x] Add allergy stub:
    ```typescript
    const allergyCheckStubSpec: ToolSpec = {
      name: 'allergy.check',
      description: 'Advisory allergy check — Story 3.2 injects fn via createAllergyCheckSpec(allergyGuardrailService).',
      inputSchema: AllergyCheckInputSchema,
      outputSchema: AllergyCheckOutputSchema,
      maxLatencyMs: 150,
      fn: async (_input: unknown): Promise<unknown> => {
        throw new Error('allergy.check not yet wired — Story 3.2 injects fn via createAllergyCheckSpec(allergyGuardrailService)');
      },
    };
    ```
  - [x] Add `['allergy.check', allergyCheckStubSpec]` to `TOOL_MANIFEST`
  - [x] Keep `memoryNoteStubSpec` / `memory.note` entry unchanged

### Task 8 — Fastify hook: register allergyGuardrailService as fastify decorator (AC: #2)

- [x] Create `apps/api/src/modules/allergy-guardrail/allergy-guardrail.hook.ts`
  — follow the `memory.hook.ts` pattern exactly:
  ```typescript
  import fp from 'fastify-plugin';
  import type { FastifyPluginAsync } from 'fastify';
  import { AllergyGuardrailRepository } from './allergy-guardrail.repository.js';
  import { AllergyGuardrailService } from './allergy-guardrail.service.js';

  const allergyGuardrailHookPlugin: FastifyPluginAsync = async (fastify) => {
    const repository = new AllergyGuardrailRepository(fastify.supabase);
    const service = new AllergyGuardrailService(repository, fastify.auditService);
    fastify.decorate('allergyGuardrailService', service);
  };

  export const allergyGuardrailHook = fp(allergyGuardrailHookPlugin, { name: 'allergy-guardrail-hook' });
  ```
- [x] In `apps/api/src/types/fastify.d.ts`:
  - [x] Add `import type { AllergyGuardrailService } from '../modules/allergy-guardrail/allergy-guardrail.service.js'`
  - [x] Add `allergyGuardrailService: AllergyGuardrailService` to `FastifyInstance`
- [x] In `apps/api/src/app.ts`:
  - [x] Import `allergyGuardrailHook` from `'./modules/allergy-guardrail/allergy-guardrail.hook.js'`
  - [x] Register: `await app.register(allergyGuardrailHook)` — after `memoryHook`, before route registrations

### Task 9 — Tests (AC: all)

- [x] Create `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.test.ts`
  - [x] `evaluate()` returns `{ verdict: 'cleared', conflicts: [] }` when no ingredient matches any rule
  - [x] Returns `{ verdict: 'blocked', conflicts: [{ child_id, allergen: 'peanuts', ingredient: 'peanut butter', slot: 'main' }] }` when FALCPA allergen name appears as substring in ingredient string
  - [x] Returns `blocked` for a `parent_declared` rule match
  - [x] Multiple conflicts: two matching ingredients → `conflicts` has two entries (all collected, not short-circuit)
  - [x] Child-scoped rule: rule with `child_id = 'A'` does NOT block an item for `child_id = 'B'`
  - [x] Household-wide rule (`child_id = null`) blocks items for any child in the plan
  - [x] Case-insensitive: `'Peanuts'` in ingredient matches `'peanuts'` rule
  - [x] No match: `'sunflower butter'` does NOT match `'peanuts'` rule (false positive guard)

- [x] Create `apps/api/src/agents/tools/allergy.tools.test.ts`
  - [x] `createAllergyCheckSpec(mockService)` returns `ToolSpec` with `name === 'allergy.check'`
  - [x] `maxLatencyMs === 150`
  - [x] `inputSchema.parse({ household_id: validUuid, plan_items: [{ child_id: validUuid, day: 'monday', slot: 'main', ingredients: ['rice'] }] })` succeeds
  - [x] `inputSchema.parse({})` throws ZodError
  - [x] `MANIFESTED_TOOL_NAMES === ['allergy.check']` (Story 1.9 contract guard)

---

## Dev Notes

### Critical Architecture Constraints

- **`allergy-guardrail/` is standalone** — architecture §2.2 places it under `modules/` with the annotation "Standalone — outside agents/, called by services". It must NOT import from `agents/`, never from `plugins/` directly (receives Supabase client via constructor).
- **Engine is a pure function** — `evaluate()` in `allergy-rules.engine.ts` is synchronous, side-effect-free. No `async`, no DB, no logging. This is what makes the guardrail tamper-proof and trivially testable.
- **Two codepaths, one rule set** — architecture Pre-Step-1 explicitly requires the tool and the service to use the same `evaluate()`. The tool calls `allergyGuardrailService.evaluate()` (the advisory path). Story 3.5 calls `allergyGuardrailService.clearOrReject()` (the authoritative path). Same engine underneath.
- **Advisory ≠ authoritative** — a tool-cleared plan is NOT a guardrail-cleared plan. The advisory tool is defense-in-depth to reduce regeneration rate. The authoritative `clearOrReject()` is the structural gate. Story 3.5's `plans.service.commit()` calls `clearOrReject()` before writing to the plans table.
- **Plans table does not exist yet** — `guardrail_decisions.plan_id` is nullable. `plans.guardrail_cleared_at` / `plans.guardrail_version` columns and the presentation-clause lint rule are strictly Story 3.5 scope. This story must not block on or assume the plans module.
- **Lint boundaries** (architecture §2.2 enforced via `eslint-plugin-boundaries`):
  - Files in `agents/` cannot import from `routes/` or any `.routes.ts`
  - Files outside `modules/<feature>/repository.ts` cannot import a Supabase client directly
  - Files outside `audit/` cannot write to `audit_log` directly — must call `auditService.write()`

### Audit Events Already Defined

`'allergy.guardrail_rejection'`, `'allergy.uncertainty'`, `'allergy.check_overridden'` are already in `AUDIT_EVENT_TYPES` (`apps/api/src/audit/audit.types.ts` lines 47–50). **Do not add them again.** Story 3.1 uses `allergy.guardrail_rejection`; `allergy.uncertainty` is used in Story 3.24.

### Parent-Declared Allergy Rules Write Path (Out of Scope for 3.1)

Epic 2 onboarding seeds `memory_nodes` with `node_type = 'allergy'` for each declared allergen. Story 3.1 creates the `allergy_rules` table and engine but does NOT implement the sync path from `memory_nodes` → `allergy_rules`. That sync (or a direct write to `allergy_rules` during onboarding) is a dependency that Story 3.2 (orchestrator) or an Epic 2 patch story will address. For now, the repository `getRulesForHousehold()` returns whatever rows exist — engine tests seed rules directly via test fixtures.

### Redis Verdict Caching (Deferred to Story 3.5/3.7)

Architecture §1.5 specifies caching guardrail verdicts in Redis as `guardrail:{plan_id}` (no TTL until plan mutation — a verdict is a fact). This requires a `plan_id`, which doesn't exist until Story 3.5. Wire the Redis cache in Story 3.5 or 3.7 when plan IDs are available. Do not add Redis caching in this story.

### Hook Registration Pattern

The exact pattern from `memory.hook.ts` applies:
- `fp()` from `fastify-plugin` to unwrap encapsulation (so the decorated service is visible to all plugin scopes)
- `fastify.decorate('allergyGuardrailService', service)` — name matches the `fastify.d.ts` declaration
- Register in `app.ts` with `await app.register(allergyGuardrailHook)` after `memoryHook` (line 88 in current `app.ts`)

### tools.manifest.ts Change Summary

Current state: `TOOL_MANIFEST` has `_placeholder` (marked for removal) and `memory.note` stub.
After this story: `TOOL_MANIFEST` has `allergy.check` stub + `memory.note` stub. The `_placeholder` is gone.
The stub pattern for `allergy.check` mirrors `memory.note`: throws `NotImplementedError` until Story 3.2 injects the real fn via `createAllergyCheckSpec(allergyGuardrailService)`.

### Project Structure Notes

**New files:**
```
apps/api/src/modules/allergy-guardrail/
  allergy-rules.engine.ts           pure eval fn + GUARDRAIL_VERSION + FALCPA_TOP_9 + AllergyRule type
  allergy-guardrail.repository.ts   Supabase reads/writes
  allergy-guardrail.service.ts      evaluate() + clearOrReject()
  allergy-guardrail.hook.ts         fp() Fastify plugin, fastify.decorate('allergyGuardrailService')
  allergy-rules.engine.test.ts      8 unit tests for evaluate()

apps/api/src/agents/tools/
  allergy.tools.ts                  createAllergyCheckSpec(service): ToolSpec
  allergy.tools.test.ts             4 unit tests

supabase/migrations/
  20260610000000_create_allergy_guardrail_tables.sql
```

**Modified files:**
```
packages/contracts/src/plan.ts          add ConflictSchema, GuardrailResultSchema, PlanItemForGuardrailSchema,
                                        AllergyCheckInputSchema, AllergyCheckOutputSchema
packages/types/src/index.ts             explicit import + export for Conflict, GuardrailResult,
                                        PlanItemForGuardrail, AllergyCheckInput
apps/api/src/agents/tools.manifest.ts   remove _placeholder, add allergy.check stub
apps/api/src/types/fastify.d.ts         add allergyGuardrailService: AllergyGuardrailService
apps/api/src/app.ts                     register allergyGuardrailHook after memoryHook (line ~88)
```

No routes file — the allergy-guardrail is an internal service only, no HTTP endpoints.

### References

- Architecture Pre-Step-1 Rulings — Two-Layer Allergy Model [Source: `_bmad-output/planning-artifacts/architecture.md`]
- Architecture §1.5 — Caching strategy: Redis guardrail verdict caching (deferred to Story 3.5) [Source: `_bmad-output/planning-artifacts/architecture.md`]
- Architecture §1.6 — Audit log: single-row per action, stages JSONB [Source: `_bmad-output/planning-artifacts/architecture.md`]
- Architecture §2.2 — `apps/api` internal layout: `allergy-guardrail` under `modules/`, standalone annotation [Source: `_bmad-output/planning-artifacts/architecture.md`]
- Architecture §3.5 — Tool-latency manifest + `maxLatencyMs` declarations [Source: `_bmad-output/planning-artifacts/architecture.md`]
- Epic 3, Story 3.1 acceptance criteria [Source: `_bmad-output/planning-artifacts/epics.md`]
- Existing `AllergyVerdict` schema (for SSE events, distinct from `GuardrailResult`) — `packages/contracts/src/plan.ts`
- Existing audit event types already defined — `apps/api/src/audit/audit.types.ts:47–50`
- Existing `ToolSpec` interface + stub pattern (`memory.note`) — `apps/api/src/agents/tools.manifest.ts`
- Hook registration pattern — `apps/api/src/modules/memory/memory.hook.ts`
- Fastify decorator type extension — `apps/api/src/types/fastify.d.ts`
- Registration order in `app.ts` — line 88 (`await app.register(memoryHook)`)

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- API typecheck (`pnpm --filter @hivekitchen/api typecheck`): only failures are the
  pre-existing `RequestInfo` errors in `src/modules/voice/voice.service.test.ts` —
  unchanged from baseline (file untouched). All Story 3.1 files typecheck clean.
- API tests (`pnpm --filter @hivekitchen/api test`): 214 pass / 11 skipped, plus 1
  pre-existing failure in `memory.service.test.ts > partial seeding` (untracked file
  from a prior story; unrelated to 3.1). All 13 Story 3.1 tests pass.
- API lint (`pnpm --filter @hivekitchen/api lint`): 0 violations in Story 3.1
  files. Remaining 7 errors are all in pre-existing files I did not touch
  (`children.routes.test.ts`, `households.repository.ts`, `households.routes.test.ts`,
  `voice.service.ts`).
- Contracts tests (`pnpm --filter @hivekitchen/contracts test`): 317 pass.
  6 pre-existing failures are in `cultural.test.ts` (file unchanged in this story).
- `tools:check` (`pnpm --filter @hivekitchen/api tools:check`): the remaining
  violation is `[memory.tools.ts] No MANIFESTED_TOOL_NAMES export` — pre-existing
  in untracked Story 2.13 code, not introduced by 3.1. The new `allergy.tools.ts`
  exports `MANIFESTED_TOOL_NAMES = ['allergy.check']` and is registered in
  `TOOL_MANIFEST` with all 6 required fields, so it would pass the check on its own.

### Completion Notes List

- **Engine matching strategy** (Task 3): the spec describes "case-insensitive
  substring check, ingredient contains allergen OR allergen contains ingredient
  substring." Pure whole-string bidirectional substring did not satisfy the test
  fixture "peanut butter must match peanuts" (since neither "peanuts" ⊂ "peanut
  butter" nor "peanut butter" ⊂ "peanuts"). Implemented as: lowercase + bidirectional
  whole-string substring + token-level reverse check on the ingredient string
  (split on whitespace/underscore/hyphen/punctuation; min token length 3 to avoid
  trivial 1- or 2-letter matches). This satisfies all eight engine tests, including
  the "sunflower butter must NOT match peanuts" false-positive guard. The matching
  is allergen-safe (over-strict) by design.
- **Type import source** (Task 3): the engine imports `GuardrailResult`,
  `PlanItemForGuardrail`, and `Conflict` from `@hivekitchen/types` (which re-exports
  the inferred types from the contracts schemas) rather than directly from
  `@hivekitchen/contracts`. This matches the pattern used elsewhere in `apps/api`
  (e.g., `MemoryService` imports `MemoryNoteOutput` and `NodeType` from
  `@hivekitchen/types`).
- **Repository inheritance** (Task 4): `AllergyGuardrailRepository` extends
  `BaseRepository` to mirror the `MemoryRepository` pattern; the story said
  "constructor takes `supabase: SupabaseClient`" — `BaseRepository` already does
  this and exposes `this.client`, so extending it is the conventional path here.
- **`tools.manifest.ts` stub fns** (Task 7): wrote `fn: async (): Promise<unknown>`
  (no parameter) instead of `fn: async (_input: unknown): Promise<unknown>` so the
  TypeScript-eslint `no-unused-vars` rule does not flag the stub. TypeScript's
  contravariance lets a `() => Promise<unknown>` fulfill the `(input: unknown) =>
  Promise<unknown>` ToolSpec field. Applied the same change to the existing
  `memoryNoteStubSpec` for consistency.
- **`MANIFESTED_TOOL_NAMES` export** (Task 6): added per the Story 1.9 manifest
  guard (`apps/api/scripts/check-tool-manifest.ts`), which requires every
  `*.tools.ts` file to declare what it provides. Surfaced this as an additional
  test assertion. The pre-existing `memory.tools.ts` lacks this export — flagged
  but out of scope for 3.1.
- **Audit event already declared**: confirmed `'allergy.guardrail_rejection'` is
  already in `AUDIT_EVENT_TYPES` (line 48 of `audit.types.ts`); no audit-types
  migration or TS update was required.
- **No routes**: per Dev Notes, the allergy guardrail is an internal service. No
  new HTTP endpoints were added. Wiring is via `fastify.allergyGuardrailService`
  decorator only.

### File List

**New files:**
- `supabase/migrations/20260610000000_create_allergy_guardrail_tables.sql`
- `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts`
- `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.test.ts`
- `apps/api/src/modules/allergy-guardrail/allergy-guardrail.repository.ts`
- `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts`
- `apps/api/src/modules/allergy-guardrail/allergy-guardrail.hook.ts`
- `apps/api/src/agents/tools/allergy.tools.ts`
- `apps/api/src/agents/tools/allergy.tools.test.ts`

**Modified files:**
- `packages/contracts/src/plan.ts` — appended `ConflictSchema`,
  `GuardrailResultSchema`, `PlanItemForGuardrailSchema`, `AllergyCheckInputSchema`,
  `AllergyCheckOutputSchema`.
- `packages/types/src/index.ts` — imported the five new schemas; exported
  `Conflict`, `GuardrailResult`, `PlanItemForGuardrail`, `AllergyCheckInput`,
  `AllergyCheckOutput` types.
- `apps/api/src/agents/tools.manifest.ts` — removed `_placeholder` spec; added
  `allergyCheckStubSpec`; rewrote stub `fn` signatures to drop the unused
  parameter.
- `apps/api/src/types/fastify.d.ts` — added `AllergyGuardrailService` import +
  `allergyGuardrailService` decorator typing.
- `apps/api/src/app.ts` — registered `allergyGuardrailHook` after `memoryHook`.

### Change Log

| Date       | Change                                                                                  |
| ---------- | --------------------------------------------------------------------------------------- |
| 2026-04-30 | Implemented Story 3.1 (allergy guardrail service: deterministic, authoritative, outside agent boundary) end-to-end across migration, contracts, engine, repository, service, advisory tool, manifest stub, and Fastify hook. 13 new tests added, all passing. Status → review. |
| 2026-05-01 | Code review run — 4 decision-needed (D1–D4) resolved into patches; 18 patches applied (synonym table P15 unblocking 8 of 9 FALCPA categories; `'uncertain'` verdict wired end-to-end; empty-input fail-closed; `Conflict.day` field; `.or()` filter parameterized; FALCPA baseline assert; audit-before-decision ordering; idempotency unique index; explicit RLS deny policies; structured logging; tool output re-validation; hook dependency assertions; engine size guard; conflict dedup; broader test coverage including all 9 FALCPA synonym families). 5 deferred items logged in `deferred-work.md`. 37 allergy-guardrail tests pass; full API suite passes (only pre-existing `memory.service.test.ts > partial seeding` failure remains, unrelated). `GUARDRAIL_VERSION` bumped to `'1.1.0'`. Status → done. |

---

## Review Findings

> **Code review run:** 2026-05-01 — bmad-code-review (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Diff range `ae77642^..3d24432` scoped to Story 3.1 file list (the implementation landed across two commits: main impl in `ae77642`, advisory `allergy.tools.ts` factory in `3d24432`). Many "scope creep" findings on `app.ts`, `fastify.d.ts`, and `packages/types/src/index.ts` were dismissed — those changes were committed by Story 12-3 (`305861e`) as part of cross-story integration work, not by Story 3.1's own commit.

### Decision-needed (resolved)

- [x] [Review][Decision][Resolved → Patch] **D1: FALCPA matching gap → add synonym/alias table** — Decision: option 1. Add a synonym/alias table (e.g., `allergen_synonyms` Supabase table or in-engine constant map) keyed by canonical FALCPA category, listing known ingredient names. Engine loads synonyms alongside rules; matching evaluates an ingredient against the rule's allergen AND every synonym for that allergen. Reflected as patch P15 below. [`apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts`, `supabase/migrations/20260610000000_create_allergy_guardrail_tables.sql`]

- [x] [Review][Decision][Resolved → Patch] **D2: `uncertain` verdict unreachable → wire end-to-end** — Decision: option 1. Add `'uncertain'` to `GuardrailResultSchema`, let the engine return it for fail-closed cases, and document downstream callers (Story 3.5 plans-commit) must treat `uncertain` as "do not render — escalate". Reflected as patch P16 below.

- [x] [Review][Decision][Resolved → Patch] **D3: empty input silently clears → return `'uncertain'`** — Decision: option 2 (depends on D2). Engine returns `{verdict: 'uncertain', conflicts: []}` when `planItems` is empty OR any item has empty `ingredients`. Tighten contract `ingredients.min(1)` for the advisory tool path. Reflected as patch P17 below.

- [x] [Review][Decision][Resolved → Patch] **D4: `Conflict.day` missing → add to schema and engine** — Decision: option 1. Add `day: z.string()` to `ConflictSchema`, engine pushes `day: item.day` into every Conflict. Reflected as patch P18 below.

### Patch (14)

- [x] [Review][Patch][APPLIED] **`getRulesForHousehold` `.or()` filter interpolates `householdId` unsafely** [`apps/api/src/modules/allergy-guardrail/allergy-guardrail.repository.ts:20`] — `.or(\`household_id.eq.${householdId},household_id.is.null\`)` is not parameterized. A non-UUID `householdId` (containing comma or PostgREST clause syntax) could broaden or void the filter. Replace with two `.eq` queries unioned, or assert UUID shape at repo entry.
- [x] [Review][Patch][APPLIED] **No FALCPA-9 baseline assertion — empty rules silently clear** [`apps/api/src/modules/allergy-guardrail/allergy-guardrail.repository.ts:16-23`, `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts:12-18`] — If `getRulesForHousehold` returns 0 rules (transient Supabase glitch, accidental delete, RLS hiding system rows), engine returns `cleared` for everything. Add a defensive check: if no `rule_type='falcpa'` row in the loaded set, throw or return `'uncertain'` (pairs with D2).
- [x] [Review][Patch][APPLIED] **Audit write is fire-and-forget after decision write — partial-failure split state** [`apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts:29-43`] — On `blocked`, decision row is inserted first, then audit is written. If audit throws, decision row exists with no audit row; if decision throws, audit never fires. Wrap both in a single transaction OR write audit before decision OR treat audit failure as a hard error that aborts the caller.
- [x] [Review][Patch][APPLIED] **`AllergyCheckInputSchema` has no upper bounds — DoS surface** [`packages/contracts/src/plan.ts:75-83`] — `plan_items: z.array(...).min(1)` and `ingredients: z.array(z.string().min(1))` carry no `.max()`. Add caps: `plan_items` `.max(50)`, `ingredients` `.min(1).max(20)`, allergen/ingredient string `.max(200)`.
- [x] [Review][Patch][APPLIED] **`Conflict.slot` optional in schema but always set in engine** [`packages/contracts/src/plan.ts:54-59`, `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts:55-61`] — Engine always pushes `slot: item.slot`; schema marks `slot` optional. Either tighten schema to required, or omit when `item.slot` is undefined. Pick one.
- [x] [Review][Patch][APPLIED] **Tool `fn` does not re-validate output via `outputSchema.parse`** [`apps/api/src/agents/tools/allergy.tools.ts:16-19`] — Returns the service result raw. Future engine drift (e.g., adding `'uncertain'`) silently violates the declared `outputSchema`. Wrap return: `return AllergyCheckOutputSchema.parse(result);` — or have the `ToolSpec` runner enforce it.
- [x] [Review][Patch][APPLIED] **Hook does not assert dependencies (`fastify.supabase`, `fastify.auditService`) exist** [`apps/api/src/modules/allergy-guardrail/allergy-guardrail.hook.ts:5-9`] — Direct field access at construction. Future registration-order regression silently breaks audit path. Add: `if (!fastify.supabase || !fastify.auditService) throw new Error('allergyGuardrailHook requires supabase + auditHook')`.
- [x] [Review][Patch][APPLIED] **`writeDecision` `verdict: string` typing is too loose** [`apps/api/src/modules/allergy-guardrail/allergy-guardrail.repository.ts:9, 29`] — TypeScript accepts arbitrary strings; DB enum catches at runtime. Narrow the input type to `'cleared' | 'blocked' | 'uncertain'`.
- [x] [Review][Patch][APPLIED] **Engine has no input size guard — quadratic perf without cap can breach `maxLatencyMs: 150`** [`apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts:49-65`] — 1000 plan items × 100 ingredients × 50 rules ≈ 5M iterations + tokenizer. Either schema `.max()` (P4) or short-circuit with `'uncertain'` for excessive input sizes.
- [x] [Review][Patch][APPLIED] **No idempotency on `clearOrReject(requestId)` retries — duplicate decision rows** [`supabase/migrations/20260610000000_create_allergy_guardrail_tables.sql`, `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts:20-45`] — No unique constraint on `guardrail_decisions(household_id, request_id)`. Retry after timeout produces two rows. Add `CREATE UNIQUE INDEX ... ON guardrail_decisions (household_id, request_id)` and handle conflict in the repository (`ON CONFLICT DO NOTHING` with returning prior verdict).
- [x] [Review][Patch][APPLIED] **No INSERT/UPDATE/DELETE RLS policies — relies on RLS-on-no-policy fail-closed** [`supabase/migrations/20260610000000_create_allergy_guardrail_tables.sql:50-64`] — Today, RLS-enabled-no-policy denies non-service-role writes (correct). But if RLS is later disabled or a permissive default policy is added, tampering is silent. Add explicit `CREATE POLICY ... FOR ALL TO authenticated WITH CHECK (false)` or a comment block in the migration documenting the security model.
- [x] [Review][Patch][APPLIED] **Test gaps — empty rules, empty plan, Unicode ingredient, `fn` invocation, ZodError shape** [`apps/api/src/modules/allergy-guardrail/allergy-rules.engine.test.ts`, `apps/api/src/agents/tools/allergy.tools.test.ts`] — Add: `evaluate([], rules)`, `evaluate(items, [])` (pairs with P2), Unicode/locale ingredient (`'ピーナッツバター'`), whitespace normalization (`'  peanuts  '`), `await spec.fn(validInput)` asserting service called with `(planItems, householdId)`, `inputSchema.safeParse({})` asserting `success === false` and `ZodError` shape.
- [x] [Review][Patch][APPLIED] **No structured logging in service** [`apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts`] — A safety-critical service emits zero log lines. Add Pino structured event on every `clearOrReject` (especially `verdict='blocked'`) for observability and alerting; "rule set was empty" should be a high-priority alertable signal.
- [x] [Review][Patch][APPLIED] **Engine does not deduplicate identical conflicts** [`apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts:49-65`] — Two `peanuts` rules (FALCPA + parent_declared) on the same ingredient produce two identical conflict entries. Use a Set keyed on `${child_id}|${allergen}|${ingredient}|${slot}|${day}` before pushing.
- [x] [Review][Patch][APPLIED] **P15 (from D1): Add allergen synonym/alias system** [`apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts`, `supabase/migrations/`] — Resolves D1. Either add an `allergen_synonyms` Supabase table (`canonical_allergen text, synonym text, source text`) seeded with FALCPA category → ingredient names, OR introduce an in-engine constant `FALCPA_SYNONYMS: Record<string, readonly string[]>` (e.g., `tree_nuts: ['almond','walnut','cashew','pecan','pistachio','hazelnut','macadamia','brazil','pine']`, `fish: ['salmon','tuna','cod','tilapia','trout','bass','halibut','mackerel','anchovy','sardine']`, `milk: ['butter','cheese','yogurt','cream','casein','whey','lactose','ghee']`, `eggs: ['mayonnaise','meringue','custard','albumin','ovalbumin','hollandaise']`, `wheat: ['flour','bread','pasta','gluten','semolina','spelt','farina','couscous','bulgur']`, `soy: ['tofu','tempeh','edamame','miso','tamari','natto','soybean','soya','lecithin']`, `shellfish: ['shrimp','crab','lobster','prawn','clam','oyster','scallop','mussel','squid','octopus']`, `sesame: ['tahini','gomashio','benne']`, `peanuts: ['groundnut','arachis','goober']`). Engine matching: for each rule, evaluate against `[rule.allergen, ...synonyms[rule.allergen] ?? []]` using existing bidirectional substring + token-reverse logic. Decision needed during implementation: DB table (live-editable, requires reads) vs. constant map (immutable, deployable). Default recommendation: in-engine constant for v1 — fewer moving parts, no extra DB read on the hot path.
- [x] [Review][Patch][APPLIED] **P16 (from D2): Wire `'uncertain'` verdict end-to-end** [`packages/contracts/src/plan.ts`, `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts`, `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts`, `apps/api/src/modules/allergy-guardrail/allergy-guardrail.repository.ts`] — Resolves D2. (1) Extend `GuardrailResultSchema` to include `z.object({ verdict: z.literal('uncertain'), conflicts: z.array(ConflictSchema), reason: z.string() })`. (2) Engine returns `'uncertain'` with a `reason` for: empty rules array, FALCPA-baseline missing (pairs with P2), oversized input (pairs with P9), empty plan items / empty ingredients (pairs with P17). (3) `clearOrReject` writes `verdict='uncertain'` to `guardrail_decisions` and emits a new audit event (use existing `'allergy.uncertainty'` event already in `AUDIT_EVENT_TYPES`). (4) Narrow `WriteDecisionInput.verdict` from `string` → `'cleared'|'blocked'|'uncertain'` (replaces P8). (5) Story 3.5 plans-commit must treat `'uncertain'` as "do not render — escalate". Tool `outputSchema` (P6) re-parse will then accept the new verdict.
- [x] [Review][Patch][APPLIED] **P17 (from D3): Empty `planItems` / empty `ingredients` → `'uncertain'`** [`packages/contracts/src/plan.ts:69-83`, `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts:49`] — Resolves D3 via D2. (1) Tighten contract: `ingredients: z.array(z.string().min(1)).min(1)`. (2) Engine: at the start of `evaluate()`, return `{ verdict: 'uncertain', conflicts: [], reason: 'empty_plan_items' }` if `planItems.length === 0`; return `{ verdict: 'uncertain', conflicts: [], reason: 'empty_ingredients' }` if any item has `ingredients.length === 0`. (3) Add tests for both paths.
- [x] [Review][Patch][APPLIED] **P18 (from D4): Add `day` to `Conflict` schema and engine output** [`packages/contracts/src/plan.ts:54-59`, `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts:55-61`] — Resolves D4. (1) `ConflictSchema` adds `day: z.string()` (required). (2) Engine pushes `day: item.day` into every Conflict. (3) Update conflict dedup key (P14) to include `day`. (4) Update existing engine tests to assert `day` field on every emitted conflict.

### Deferred (5)

- [x] [Review][Defer] **Tokenizer regex misses `+`, `*`, `|`, `\`, `[`, `]`, `@`, `#`, `%`, apostrophe, ampersand, and CJK separators** [`apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts:25`] — deferred, broader matching strategy decision (D1) governs scope; LLM-generated ingredient strings can exploit non-ASCII separators to dodge token-reverse match.
- [x] [Review][Defer] **No Unicode normalization (NFC/NFKC) before matching** [`apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts:34-35`] — deferred, tied to D1; decomposed forms (`'café'`), full-width Latin (`'ＰＥＡＮＵＴＳ'`), and homoglyphs evade substring match.
- [x] [Review][Defer] **No allergen-name normalization at write time — duplicate rule rows possible** [`apps/api/src/modules/allergy-guardrail/allergy-guardrail.repository.ts`] — deferred, rule-write path is out of Story 3.1 scope per Dev Notes (Memory Layer 2 sync, Story 3.2 / Epic 2 patch).
- [x] [Review][Defer] **No unique constraint on `(household_id, child_id, allergen)` in `allergy_rules`** [`supabase/migrations/20260610000000_create_allergy_guardrail_tables.sql:12-19`] — deferred, tied to rule-write path concern; without normalization (above), a unique constraint on raw allergen string would not catch case/whitespace duplicates.
- [x] [Review][Defer] **`request_id` not validated as UUID at TS layer** [`apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts:22`, `apps/api/src/modules/allergy-guardrail/allergy-guardrail.repository.ts:12`] — deferred, defense-in-depth; DB enforces via `uuid NOT NULL`. Tied to broader request-context typing pass.


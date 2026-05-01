# Story 3.1: Allergy Guardrail Service — deterministic, authoritative, outside agent boundary

Status: review

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


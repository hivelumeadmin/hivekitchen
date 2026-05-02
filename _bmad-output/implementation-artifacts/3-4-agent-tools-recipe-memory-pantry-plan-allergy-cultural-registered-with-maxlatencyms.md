# Story 3.4: Agent Tools — recipe/memory/pantry/plan/allergy/cultural — registered with maxLatencyMs

Status: done

## Story

As a developer,
I want all seven planner agent tools (`recipe.search`, `recipe.fetch`, `memory.recall`, `pantry.read`, `plan.compose`, `allergy.check`, `cultural.lookup`) implemented and registered in `tools.manifest.ts` with declared `maxLatencyMs`,
So that the orchestrator's sync-vs-early-ack split (per architecture §3.5) is computable and the runtime sampling alarm catches latency drift.

## Acceptance Criteria

1. **Given** Story 1.9 (manifest CI lint) is complete,
   **When** Story 3.4 is complete,
   **Then** each tool exists in `apps/api/src/agents/tools/` with input/output Zod schemas and an implementation that calls its corresponding service (never a repository or Supabase client directly).

2. **And** `tools.manifest.ts` declares `maxLatencyMs` per tool:

   | Tool | maxLatencyMs |
   |------|-------------|
   | recipe.search | 300 |
   | recipe.fetch | 100 |
   | memory.recall | 200 |
   | pantry.read | 80 |
   | plan.compose | 2000 |
   | allergy.check | 150 |
   | cultural.lookup | 80 |

3. **And** `recordToolLatency` from Story 1.9 is invoked on every tool call (including the existing `allergy.check` — see Task 2); Grafana alert configured to fire when sampled p95 > declared × 1.5 for ≥1h (non-code config — note in PR description).

---

## Tasks / Subtasks

### Task 1 — Add Zod I/O schemas in `packages/contracts` (AC: #1, #2)

- [x] Create `packages/contracts/src/recipe.ts`:
  ```typescript
  import { z } from 'zod/v4';

  export const RecipeSearchInputSchema = z.object({
    query: z.string().min(1).max(200),
    household_id: z.string().uuid(),
    max_results: z.number().int().min(1).max(20).default(5),
  });
  export type RecipeSearchInput = z.infer<typeof RecipeSearchInputSchema>;

  export const RecipePreviewSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    tags: z.array(z.string()),
    allergen_flags: z.array(z.string()),
    prep_time_minutes: z.number().int(),
  });

  export const RecipeSearchOutputSchema = z.object({
    results: z.array(RecipePreviewSchema),
  });
  export type RecipeSearchOutput = z.infer<typeof RecipeSearchOutputSchema>;

  export const RecipeFetchInputSchema = z.object({
    recipe_id: z.string().uuid(),
    household_id: z.string().uuid(),
  });
  export type RecipeFetchInput = z.infer<typeof RecipeFetchInputSchema>;

  export const RecipeIngredientSchema = z.object({
    name: z.string(),
    quantity: z.string(),
    allergens: z.array(z.string()),
  });

  export const RecipeDetailSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string(),
    ingredients: z.array(RecipeIngredientSchema),
    prep_time_minutes: z.number().int(),
    instructions: z.string(),
    tags: z.array(z.string()),
    allergen_flags: z.array(z.string()),
  });

  export const RecipeFetchOutputSchema = RecipeDetailSchema;
  export type RecipeFetchOutput = z.infer<typeof RecipeFetchOutputSchema>;
  ```

- [x] Create `packages/contracts/src/pantry.ts`:
  ```typescript
  import { z } from 'zod/v4';

  export const PantryReadInputSchema = z.object({
    household_id: z.string().uuid(),
  });
  export type PantryReadInput = z.infer<typeof PantryReadInputSchema>;

  export const PantryItemSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    quantity: z.string(),
    unit: z.string().optional(),
    expires_at: z.string().datetime().optional(),
    tags: z.array(z.string()),
  });

  export const PantryReadOutputSchema = z.object({
    items: z.array(PantryItemSchema),
  });
  export type PantryReadOutput = z.infer<typeof PantryReadOutputSchema>;
  ```

- [x] Update `packages/contracts/src/memory.ts` — add memory.recall schemas:
  ```typescript
  // Add after existing MemoryNoteOutput schemas:
  export const MemoryRecallInputSchema = z.object({
    household_id: z.string().uuid(),
    facets: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  });
  export type MemoryRecallInput = z.infer<typeof MemoryRecallInputSchema>;

  export const MemoryRecallNodeSchema = z.object({
    node_id: z.string().uuid(),
    node_type: NodeTypeSchema,    // NodeTypeSchema is already defined in this file
    facet: z.string(),
    prose_text: z.string(),
    subject_child_id: z.string().uuid().nullable(),
    confidence: z.number(),
  });

  export const MemoryRecallOutputSchema = z.object({
    nodes: z.array(MemoryRecallNodeSchema),
  });
  export type MemoryRecallOutput = z.infer<typeof MemoryRecallOutputSchema>;
  ```

- [x] Update `packages/contracts/src/plan.ts` — add plan.compose schemas:
  ```typescript
  // Add after existing WeeklyPlan schema:
  export const PlanComposeInputSchema = z.object({
    household_id: z.string().uuid(),
    week_of: z.string().date(),
    days: z.array(DayPlan),
    prompt_version: z.string(),
  });
  export type PlanComposeInput = z.infer<typeof PlanComposeInputSchema>;

  export const PlanComposeOutputSchema = WeeklyPlan;
  export type PlanComposeOutput = z.infer<typeof PlanComposeOutputSchema>;
  ```

- [x] Update `packages/contracts/src/cultural.ts` — add cultural.lookup schemas:
  ```typescript
  // Add after existing CulturalPrior schemas:
  export const CulturalLookupInputSchema = z.object({
    household_id: z.string().uuid(),
  });
  export type CulturalLookupInput = z.infer<typeof CulturalLookupInputSchema>;

  const CulturalLookupPriorSchema = CulturalPriorSchema.pick({
    id: true, key: true, state: true, tier: true,
  }).extend({ label: z.string() });

  export const CulturalLookupOutputSchema = z.object({
    priors: z.array(CulturalLookupPriorSchema),
  });
  export type CulturalLookupOutput = z.infer<typeof CulturalLookupOutputSchema>;
  ```

- [x] Re-export all new schemas from `packages/contracts/src/index.ts` (check existing export pattern and follow it)

- [x] Add `packages/contracts/src/recipe.test.ts` and `packages/contracts/src/pantry.test.ts` with basic round-trip parse tests following the pattern in `plan.test.ts`

### Task 2 — Retrofit `recordToolLatency` into existing `allergy.tools.ts` (AC: #3)

`allergy.check` was implemented in Story 3.2 WITHOUT latency recording. Story 3.4 closes this gap.

- [x] Update `apps/api/src/agents/tools/allergy.tools.ts`:
  - Add `import { recordToolLatency } from '../../observability/tool-latency.histogram.js';`
  - Add `import type { Redis } from 'ioredis';`
  - Change factory signature to `createAllergyCheckSpec(allergyGuardrailService: AllergyGuardrailService, redis: Redis): ToolSpec`
  - Wrap `fn` with `start` timer and `finally` block:
    ```typescript
    fn: async (input: unknown) => {
      const start = Date.now();
      try {
        const parsed = AllergyCheckInputSchema.parse(input);
        const result = await allergyGuardrailService.evaluate(parsed.plan_items, parsed.household_id);
        return AllergyCheckOutputSchema.parse(result);
      } finally {
        await recordToolLatency(redis, 'allergy.check', Date.now() - start);
      }
    },
    ```

- [x] Update `apps/api/src/agents/orchestrator.ts` — the `createAllergyCheckSpec` call in the constructor now needs `redis`. See Task 6 for the full constructor change.

### Task 3 — Create service stubs for recipe, pantry, plan (AC: #1)

These services do not exist. Create minimal stubs that compile, satisfy the tool layer's type contract, and throw `NotImplementedError` when called. Their real implementations land in later stories.

- [x] Create `apps/api/src/modules/recipe/recipe.service.ts`:
  ```typescript
  import { NotImplementedError } from '../../common/errors.js';
  import type { RecipeSearchInput, RecipeSearchOutput, RecipeFetchInput, RecipeFetchOutput } from '@hivekitchen/contracts';

  export class RecipeService {
    async search(_input: RecipeSearchInput): Promise<RecipeSearchOutput> {
      throw new NotImplementedError('recipe.search — real service is a future story');
    }
    async fetch(_input: RecipeFetchInput): Promise<RecipeFetchOutput> {
      throw new NotImplementedError('recipe.fetch — real service is a future story');
    }
  }
  ```

- [x] Create `apps/api/src/modules/pantry/pantry.service.ts`:
  ```typescript
  import { NotImplementedError } from '../../common/errors.js';
  import type { PantryReadInput, PantryReadOutput } from '@hivekitchen/contracts';

  export class PantryService {
    async read(_input: PantryReadInput): Promise<PantryReadOutput> {
      throw new NotImplementedError('pantry.read — real service lands in Epic 6');
    }
  }
  ```

- [x] Create `apps/api/src/modules/plans/plan.service.ts`:
  ```typescript
  import { NotImplementedError } from '../../common/errors.js';
  import type { PlanComposeInput, PlanComposeOutput } from '@hivekitchen/contracts';

  export class PlanService {
    async compose(_input: PlanComposeInput): Promise<PlanComposeOutput> {
      throw new NotImplementedError('plan.compose — real service lands in Story 3.5');
    }
  }
  ```

### Task 4 — Add `recall()` to existing `MemoryService` (AC: #1)

`memory.recall` is a read operation. `MemoryService` currently has write-only methods. Add a `recall()` method that calls the repository.

- [x] Check `apps/api/src/modules/memory/memory.repository.ts` for an existing `findNodes()` or `findByHousehold()` method. If it doesn't exist, add it:
  ```typescript
  async findNodes(opts: { household_id: string; facets?: string[]; limit: number }): Promise<MemoryNodeRow[]>
  // Implementation: SELECT from memory_nodes WHERE household_id = opts.household_id
  // AND (opts.facets is undefined OR facet = ANY(opts.facets))
  // ORDER BY created_at DESC LIMIT opts.limit
  ```

- [x] Add to `apps/api/src/modules/memory/memory.service.ts`:
  ```typescript
  async recall(input: MemoryRecallInput): Promise<MemoryRecallOutput> {
    const rows = await this.repository.findNodes({
      household_id: input.household_id,
      facets: input.facets,
      limit: input.limit ?? 20,
    });
    return {
      nodes: rows.map(n => ({
        node_id: n.id,
        node_type: n.node_type,
        facet: n.facet,
        prose_text: n.prose_text,
        subject_child_id: n.subject_child_id ?? null,
        confidence: n.confidence ?? 1.0,
      })),
    };
  }
  ```
  Import `MemoryRecallInput` and `MemoryRecallOutput` from `@hivekitchen/types` (not contracts — types derives from contracts via `z.infer<>`; follow the pattern used by `MemoryNoteOutput` in the same file).

### Task 5 — Create tool files (AC: #1, #2, #3)

Follow the exact factory pattern from `allergy.tools.ts`: parse input, call service, re-parse output, wrap with `recordToolLatency` in `finally`.

- [x] Create `apps/api/src/agents/tools/recipe.tools.ts`:
  ```typescript
  import type { Redis } from 'ioredis';
  import { RecipeSearchInputSchema, RecipeSearchOutputSchema, RecipeFetchInputSchema, RecipeFetchOutputSchema } from '@hivekitchen/contracts';
  import { recordToolLatency } from '../../observability/tool-latency.histogram.js';
  import type { ToolSpec } from '../tools.manifest.js';
  import type { RecipeService } from '../../modules/recipe/recipe.service.js';

  export function createRecipeSearchSpec(recipeService: RecipeService, redis: Redis): ToolSpec {
    return {
      name: 'recipe.search',
      description: 'Search recipes by natural-language query. Returns previews with allergen flags for up to max_results recipes.',
      inputSchema: RecipeSearchInputSchema,
      outputSchema: RecipeSearchOutputSchema,
      maxLatencyMs: 300,
      fn: async (input: unknown) => {
        const start = Date.now();
        try {
          const parsed = RecipeSearchInputSchema.parse(input);
          const result = await recipeService.search(parsed);
          return RecipeSearchOutputSchema.parse(result);
        } finally {
          await recordToolLatency(redis, 'recipe.search', Date.now() - start);
        }
      },
    };
  }

  export function createRecipeFetchSpec(recipeService: RecipeService, redis: Redis): ToolSpec {
    return {
      name: 'recipe.fetch',
      description: 'Fetch full recipe detail including all ingredients with allergen annotations.',
      inputSchema: RecipeFetchInputSchema,
      outputSchema: RecipeFetchOutputSchema,
      maxLatencyMs: 100,
      fn: async (input: unknown) => {
        const start = Date.now();
        try {
          const parsed = RecipeFetchInputSchema.parse(input);
          const result = await recipeService.fetch(parsed);
          return RecipeFetchOutputSchema.parse(result);
        } finally {
          await recordToolLatency(redis, 'recipe.fetch', Date.now() - start);
        }
      },
    };
  }
  ```

- [x] Update `apps/api/src/agents/tools/memory.tools.ts` — add `createMemoryRecallSpec()`:
  ```typescript
  import type { Redis } from 'ioredis';
  import { MemoryRecallInputSchema, MemoryRecallOutputSchema } from '@hivekitchen/contracts';
  import { recordToolLatency } from '../../observability/tool-latency.histogram.js';

  export function createMemoryRecallSpec(memoryService: MemoryService, redis: Redis): ToolSpec {
    return {
      name: 'memory.recall',
      description: 'Read memory nodes for the household. Optionally filter by facet. Used by the planner to retrieve preferences, rhythms, and constraints.',
      inputSchema: MemoryRecallInputSchema,
      outputSchema: MemoryRecallOutputSchema,
      maxLatencyMs: 200,
      fn: async (input: unknown) => {
        const start = Date.now();
        try {
          const parsed = MemoryRecallInputSchema.parse(input);
          const result = await memoryService.recall(parsed);
          return MemoryRecallOutputSchema.parse(result);
        } finally {
          await recordToolLatency(redis, 'memory.recall', Date.now() - start);
        }
      },
    };
  }
  ```

- [x] Create `apps/api/src/agents/tools/pantry.tools.ts`:
  ```typescript
  import type { Redis } from 'ioredis';
  import { PantryReadInputSchema, PantryReadOutputSchema } from '@hivekitchen/contracts';
  import { recordToolLatency } from '../../observability/tool-latency.histogram.js';
  import type { ToolSpec } from '../tools.manifest.js';
  import type { PantryService } from '../../modules/pantry/pantry.service.js';

  export function createPantryReadSpec(pantryService: PantryService, redis: Redis): ToolSpec {
    return {
      name: 'pantry.read',
      description: 'Read current pantry inventory for the household. Used by the planner to prefer ingredients already on hand.',
      inputSchema: PantryReadInputSchema,
      outputSchema: PantryReadOutputSchema,
      maxLatencyMs: 80,
      fn: async (input: unknown) => {
        const start = Date.now();
        try {
          const parsed = PantryReadInputSchema.parse(input);
          const result = await pantryService.read(parsed);
          return PantryReadOutputSchema.parse(result);
        } finally {
          await recordToolLatency(redis, 'pantry.read', Date.now() - start);
        }
      },
    };
  }
  ```

- [x] Create `apps/api/src/agents/tools/plan.tools.ts`:
  ```typescript
  import type { Redis } from 'ioredis';
  import { PlanComposeInputSchema, PlanComposeOutputSchema } from '@hivekitchen/contracts';
  import { recordToolLatency } from '../../observability/tool-latency.histogram.js';
  import type { ToolSpec } from '../tools.manifest.js';
  import type { PlanService } from '../../modules/plans/plan.service.js';

  export function createPlanComposeSpec(planService: PlanService, redis: Redis): ToolSpec {
    return {
      name: 'plan.compose',
      description: 'Assemble the final weekly plan structure from the planner\'s day-level meal decisions. Returns a validated WeeklyPlan ready for guardrail evaluation.',
      inputSchema: PlanComposeInputSchema,
      outputSchema: PlanComposeOutputSchema,
      maxLatencyMs: 2000,
      fn: async (input: unknown) => {
        const start = Date.now();
        try {
          const parsed = PlanComposeInputSchema.parse(input);
          const result = await planService.compose(parsed);
          return PlanComposeOutputSchema.parse(result);
        } finally {
          await recordToolLatency(redis, 'plan.compose', Date.now() - start);
        }
      },
    };
  }
  ```

- [x] Create `apps/api/src/agents/tools/cultural.tools.ts`:
  ```typescript
  import type { Redis } from 'ioredis';
  import { CulturalLookupInputSchema, CulturalLookupOutputSchema } from '@hivekitchen/contracts';
  import { recordToolLatency } from '../../observability/tool-latency.histogram.js';
  import type { ToolSpec } from '../tools.manifest.js';
  import type { CulturalPriorService } from '../../modules/cultural-priors/cultural-prior.service.js';

  export function createCulturalLookupSpec(culturalPriorService: CulturalPriorService, redis: Redis): ToolSpec {
    return {
      name: 'cultural.lookup',
      description: 'Look up confirmed and active cultural templates for the household. Used by the planner to honour cultural constraints when composing meals.',
      inputSchema: CulturalLookupInputSchema,
      outputSchema: CulturalLookupOutputSchema,
      maxLatencyMs: 80,
      fn: async (input: unknown) => {
        const start = Date.now();
        try {
          const parsed = CulturalLookupInputSchema.parse(input);
          const priors = await culturalPriorService.listByHousehold(parsed.household_id);
          const result = { priors: priors.map(p => ({ id: p.id, key: p.key, label: p.label, state: p.state, tier: p.tier })) };
          return CulturalLookupOutputSchema.parse(result);
        } finally {
          await recordToolLatency(redis, 'cultural.lookup', Date.now() - start);
        }
      },
    };
  }
  ```

### Task 6 — Update `tools.manifest.ts`, `orchestrator.ts`, and `orchestrator.hook.ts` (AC: #1, #2, #3)

- [x] Update `apps/api/src/agents/tools.manifest.ts`:
  - Import all 6 new schemas from `@hivekitchen/contracts`
  - Add stub entries for each new tool (`name`, `description`, `inputSchema`, `outputSchema`, `maxLatencyMs`, stub `fn` throwing `Error('... wired via create*Spec()')`)
  - Update the `allergy.check` stub description (remove the "Story 3.2 injects fn" language — it's wired now)
  - Remove the `memory.note` stub's "Story 3.2 injects fn" language too
  - Add all new stubs to `TOOL_MANIFEST` map

  New tool names to add: `'recipe.search'`, `'recipe.fetch'`, `'memory.recall'`, `'pantry.read'`, `'plan.compose'`, `'cultural.lookup'`

- [x] Update `apps/api/src/agents/orchestrator.ts`:
  - Expand `OrchestratorServices` interface:
    ```typescript
    export interface OrchestratorServices {
      memory: MemoryService;
      allergyGuardrail: AllergyGuardrailService;
      recipe: RecipeService;
      pantry: PantryService;
      plan: PlanService;
      culturalPrior: CulturalPriorService;
    }
    ```
  - Add new imports: `createRecipeSearchSpec`, `createRecipeFetchSpec` from `'./tools/recipe.tools.js'`; `createMemoryRecallSpec` from `'./tools/memory.tools.js'`; `createPantryReadSpec` from `'./tools/pantry.tools.js'`; `createPlanComposeSpec` from `'./tools/plan.tools.js'`; `createCulturalLookupSpec` from `'./tools/cultural.tools.js'`
  - Import `RecipeService`, `PantryService`, `PlanService` from their module paths
  - Import `CulturalPriorService` from `'../modules/cultural-priors/cultural-prior.service.js'`
  - Add `redis: Redis` as a constructor parameter (after `services`, before `auditService`):
    ```typescript
    constructor(
      private readonly providers: LLMProvider[],
      services: OrchestratorServices,
      private readonly redis: Redis,
      private readonly auditService: AuditService,
      private readonly logger: FastifyBaseLogger,
    )
    ```
  - In the constructor body, add 6 new `TOOL_MANIFEST.set()` calls after the existing two:
    ```typescript
    TOOL_MANIFEST.set('allergy.check', createAllergyCheckSpec(services.allergyGuardrail, redis));
    TOOL_MANIFEST.set('memory.note', createMemoryNoteSpec(services.memory));
    TOOL_MANIFEST.set('recipe.search', createRecipeSearchSpec(services.recipe, redis));
    TOOL_MANIFEST.set('recipe.fetch', createRecipeFetchSpec(services.recipe, redis));
    TOOL_MANIFEST.set('memory.recall', createMemoryRecallSpec(services.memory, redis));
    TOOL_MANIFEST.set('pantry.read', createPantryReadSpec(services.pantry, redis));
    TOOL_MANIFEST.set('plan.compose', createPlanComposeSpec(services.plan, redis));
    TOOL_MANIFEST.set('cultural.lookup', createCulturalLookupSpec(services.culturalPrior, redis));
    ```
  - **Update `memory.note` call too**: `createMemoryNoteSpec` does NOT currently take `redis` — keep it that way for now (memory.note is a write tool not in the planner's allowed set; its latency recording can be added separately). Do NOT add redis to `createMemoryNoteSpec` in this story.

- [x] Update `apps/api/src/agents/orchestrator.hook.ts`:
  - Import `RecipeService`, `PantryService`, `PlanService` from their modules
  - Import `CulturalPriorService` from `'../modules/cultural-priors/cultural-prior.service.js'`
  - Instantiate stub services:
    ```typescript
    const recipeService = new RecipeService();
    const pantryService = new PantryService();
    const planService = new PlanService();
    ```
  - For `CulturalPriorService`: check if `fastify.culturalPriorService` is decorated (look at `cultural-prior.hook.ts` or `app.ts`). If it is, use `fastify.culturalPriorService`; if not, construct it inline with the existing `culturalPriorRepository` (same pattern as other services in the hook).
  - Expand the services bundle passed to `DomainOrchestrator`:
    ```typescript
    const services: OrchestratorServices = {
      memory: fastify.memoryService,
      allergyGuardrail: fastify.allergyGuardrailService,
      recipe: recipeService,
      pantry: pantryService,
      plan: planService,
      culturalPrior: /* fastify.culturalPriorService or inline instance */,
    };
    ```
  - Add `fastify.redis` as the third argument to `new DomainOrchestrator(providers, services, fastify.redis, ...)`. Check `fastify.d.ts` for the decorator name — it may be `fastify.redis` or `fastify.ioredis`.

- [x] Update orchestrator tests in `apps/api/src/agents/orchestrator.test.ts`:
  - The constructor now takes a `redis` parameter before `auditService` — update all `new DomainOrchestrator(...)` calls in tests to pass a mock redis (e.g., `{ pipeline: vi.fn().mockReturnValue({ zadd: vi.fn(), zremrangebyscore: vi.fn(), expire: vi.fn(), exec: vi.fn().mockResolvedValue(null) }) }` as unknown as `Redis`)

### Task 7 — Tests (AC: all)

- [x] Create `apps/api/src/agents/tools/recipe.tools.test.ts`:
  - `createRecipeSearchSpec` — input schema rejects missing `household_id`
  - `createRecipeSearchSpec` — `fn` calls `recipeService.search()` with parsed input
  - `createRecipeSearchSpec` — `recordToolLatency` called in `finally` even when service throws
  - `createRecipeFetchSpec` — same three patterns

- [x] Create `apps/api/src/agents/tools/pantry.tools.test.ts`:
  - `createPantryReadSpec` — input schema rejects non-UUID
  - `createPantryReadSpec` — `fn` calls service; `recordToolLatency` called in `finally`

- [x] Create `apps/api/src/agents/tools/plan.tools.test.ts`:
  - `createPlanComposeSpec` — input schema validation
  - `createPlanComposeSpec` — `fn` propagates `NotImplementedError`; `recordToolLatency` still called

- [x] Create `apps/api/src/agents/tools/cultural.tools.test.ts`:
  - `createCulturalLookupSpec` — maps `listByHousehold()` result to `CulturalLookupOutputSchema` shape
  - `createCulturalLookupSpec` — `recordToolLatency` called in `finally`

- [x] Update `apps/api/src/agents/tools/allergy.tools.test.ts` (if it exists) or add tests:
  - `recordToolLatency` called in `finally` block even when `evaluate()` throws

- [x] Run: `pnpm --filter @hivekitchen/contracts test` — all schema tests must pass
- [x] Run: `pnpm --filter @hivekitchen/api typecheck` — no new type errors
- [x] Verify all existing orchestrator tests still pass after constructor signature change

---

## Dev Notes

### Critical — `recordToolLatency` MUST be in a `finally` block

Latency must be recorded whether the tool call succeeds or throws. The pattern is mandatory:
```typescript
fn: async (input: unknown) => {
  const start = Date.now();
  try {
    // ... implementation
    return result;
  } finally {
    await recordToolLatency(redis, 'tool.name', Date.now() - start);
  }
}
```
Import path: `import { recordToolLatency } from '../../observability/tool-latency.histogram.js'`

### Critical — Retrofit allergy.check in this story

`allergy.tools.ts` was written in Story 3.2 without `recordToolLatency`. Story 3.4 is the mandatory retrofit point — after this story, ALL tools record latency. The allergy.check factory signature changes from:
```typescript
createAllergyCheckSpec(service: AllergyGuardrailService): ToolSpec
```
to:
```typescript
createAllergyCheckSpec(service: AllergyGuardrailService, redis: Redis): ToolSpec
```
Update the call site in `orchestrator.ts` constructor accordingly.

### Critical — Orchestrator constructor gains a `redis` parameter

The current constructor signature is `(providers, services, auditService, logger)`. After this story it is `(providers, services, redis, auditService, logger)`. Update every `new DomainOrchestrator(...)` instantiation — there is one in `orchestrator.hook.ts` (production) and potentially several in `orchestrator.test.ts` (tests). Do not skip the test updates — TypeScript strict mode will catch missing args but review manually.

### Critical — `cultural.lookup` uses EXISTING `CulturalPriorService`

`CulturalPriorService` already exists at `apps/api/src/modules/cultural-priors/cultural-prior.service.ts` with a `listByHousehold(householdId: string): Promise<CulturalPrior[]>` method. Do NOT create a new cultural service. The tool maps from the existing `CulturalPrior` domain object (which has `id`, `key`, `label`, `state`, `tier`, etc.) to the `CulturalLookupOutputSchema` shape.

Note: `CulturalPrior.label` is in the domain object (see `toCulturalPrior()` in cultural-prior.service.ts). If `CulturalPriorSchema` in contracts doesn't have a `label` field, add it — or derive it from `key`. Check the actual schema before deciding.

### Critical — `memory.recall` ≠ `memory.note`

These are distinct operations:
- `memory.recall` (READ): NEW tool added in this story. Calls `memoryService.recall()`.
- `memory.note` (WRITE): Existing tool from Story 3.2. Calls `memoryService.noteFromAgent()`.

Do not confuse them. `memory.recall` is in `PLANNER_PROMPT.toolsAllowed`; `memory.note` is NOT (the planner reads memory, it does not write it).

### Critical — Service stubs throw `NotImplementedError`, not generic Error

```typescript
// Correct
throw new NotImplementedError('recipe.search — implemented in a future story');

// Wrong — would not serialize as RFC 7807
throw new Error('not implemented');
```
Import `NotImplementedError` from `'../../common/errors.js'`.

### Critical — Tool names use dotted format, not underscore

The `TOOL_MANIFEST` key and the `name` field in `ToolSpec` must be `'recipe.search'`, `'pantry.read'`, etc. The `OpenAIAdapter` handles `.` → `__` rewriting on the wire. Confirmed in Story 3.3 dev notes:
> "By the time `LLMResponse.toolCalls` reaches the orchestrator, names are already converted back to internal dotted form."

### Critical — Do NOT add `recordToolLatency` to `memory.note`

`memory.note` is a write tool used outside the planner flow (it's in `TOOL_MANIFEST` but NOT in `PLANNER_PROMPT.toolsAllowed`). Leave `createMemoryNoteSpec` with its current signature for now — adding redis to it is a separate concern and is not in this story's scope.

### Critical — Check `fastify.redis` decorator name

The ioredis plugin is registered in `apps/api/src/plugins/ioredis.plugin.ts` and decorates the Fastify instance. Check `apps/api/src/types/fastify.d.ts` for the exact decorator property name (it may be `redis`, `ioredis`, or another name). Use whatever the type declaration says.

### Critical — `PlanComposeOutputSchema` = `WeeklyPlan` (existing contract)

`WeeklyPlan` is already defined in `packages/contracts/src/plan.ts` (with `promptVersion: z.string()` added by Story 3.3). The `plan.compose` output IS a `WeeklyPlan`. The `PlanComposeOutputSchema = WeeklyPlan` alias makes intent explicit without duplicating the schema.

### Pattern — Schema parse + re-parse in every `fn`

This is the established allergy.tools.ts pattern — always re-parse the service output through `OutputSchema.parse(result)` before returning. This makes future service contract drift fail loudly at the tool boundary rather than silently violating the tool's advertised schema.

### Architecture §4.3 — ToolSpec shape (all 5 fields required)

```typescript
// All five fields required — CI lint blocks missing maxLatencyMs
{ name, description, inputSchema, outputSchema, maxLatencyMs, fn }
```

The CI lint from Story 1.9 enforces that every entry in `TOOL_MANIFEST` has `maxLatencyMs`. Do not omit it.

### Architecture §2.2 — Agent boundary lint rules

Files in `agents/` cannot import from `fastify`, `routes/`, or any SDK client directly (`@supabase/*`, `@openai/*`, etc.). Tools receive service instances via factory function closure — they never import a service file directly. This is already the established pattern.

### Architecture §3.5 — Grafana alert (non-code deliverable)

The AC requires a Grafana alert: p95 tool latency > `maxLatencyMs × 1.5` for ≥1h. This is a monitoring configuration, not code. Note this in the PR description with the tool thresholds:
- recipe.search: p95 > 450ms for ≥1h → alert
- recipe.fetch: p95 > 150ms for ≥1h → alert
- memory.recall: p95 > 300ms for ≥1h → alert
- pantry.read: p95 > 120ms for ≥1h → alert
- plan.compose: p95 > 3000ms for ≥1h → alert
- allergy.check: p95 > 225ms for ≥1h → alert
- cultural.lookup: p95 > 120ms for ≥1h → alert

### Project Structure — New and Modified Files

**New files:**
```
packages/contracts/src/
  recipe.ts                     recipe.search + recipe.fetch I/O schemas
  recipe.test.ts                round-trip parse tests
  pantry.ts                     pantry.read I/O schemas
  pantry.test.ts                round-trip parse tests

apps/api/src/modules/recipe/
  recipe.service.ts             stub — throws NotImplementedError

apps/api/src/modules/pantry/
  pantry.service.ts             stub — throws NotImplementedError

apps/api/src/modules/plans/
  plan.service.ts               stub — throws NotImplementedError (compose only)

apps/api/src/agents/tools/
  recipe.tools.ts               createRecipeSearchSpec + createRecipeFetchSpec
  pantry.tools.ts               createPantryReadSpec
  plan.tools.ts                 createPlanComposeSpec
  cultural.tools.ts             createCulturalLookupSpec
  recipe.tools.test.ts
  pantry.tools.test.ts
  plan.tools.test.ts
  cultural.tools.test.ts
```

**Modified files:**
```
packages/contracts/src/
  memory.ts                     + MemoryRecallInputSchema, MemoryRecallOutputSchema
  plan.ts                       + PlanComposeInputSchema, PlanComposeOutputSchema
  cultural.ts                   + CulturalLookupInputSchema, CulturalLookupOutputSchema
  index.ts                      + re-exports for all new schemas

apps/api/src/modules/memory/
  memory.service.ts             + recall() method
  memory.repository.ts          + findNodes() method (if absent)

apps/api/src/agents/tools/
  allergy.tools.ts              + recordToolLatency (retrofit); redis param added to factory
  memory.tools.ts               + createMemoryRecallSpec factory

apps/api/src/agents/
  tools.manifest.ts             + 6 new stub entries; updated allergy/memory stub descriptions
  orchestrator.ts               + OrchestratorServices expansion; + redis constructor param; + 6 new TOOL_MANIFEST.set() calls
  orchestrator.hook.ts          + stub service instantiation; + culturalPriorService wiring; + redis pass-through
  orchestrator.test.ts          + mock redis in all DomainOrchestrator constructor calls
```

**Unchanged:**
- `circuit-breaker.ts`
- `llm-provider.interface.ts`
- `providers/openai.adapter.ts`, `anthropic.adapter.ts`
- `app.ts` — orchestrator hook handles all wiring
- `prompts/planner.prompt.ts` — toolsAllowed list is already correct from Story 3.3
- `common/errors.ts` — all error types already present

### Story 3.5 Handoff

When Story 3.5 implements `PlanService.compose()` for real:
- Only `apps/api/src/modules/plans/plan.service.ts` changes (stub → real impl)
- `plan.tools.ts` does not change — the factory pattern isolates the tool from the service implementation
- Story 3.5 must also add `prompt_version VARCHAR(32) NOT NULL` to the plans migration and populate it from `PLANNER_PROMPT.version`

### References

- Architecture §3.5 — Tool-latency manifest + early-ack: `_bmad-output/planning-artifacts/architecture.md`
- Architecture §4.3 — Tool call shape (all 5 fields required): same file
- Architecture §2.2 — Agent layer boundaries and lint rules: same file
- Story 3.3 dev notes — `_bmad-output/implementation-artifacts/3-3-planner-specialist-agent-planner-prompt-ts-versioned.md` (tool name format, allergy.check retrofit note)
- Story 3.2 dev notes — same file `_bmad-output/implementation-artifacts/3-2-domain-orchestrator-*.md` (orchestrator constructor positional params; allergy.tools.ts factory pattern baseline)
- `tools.manifest.ts` current state: `apps/api/src/agents/tools.manifest.ts`
- `allergy.tools.ts` pattern reference: `apps/api/src/agents/tools/allergy.tools.ts`
- `memory.tools.ts` pattern reference: `apps/api/src/agents/tools/memory.tools.ts`
- `recordToolLatency` function: `apps/api/src/observability/tool-latency.histogram.ts`
- `CulturalPriorService.listByHousehold()`: `apps/api/src/modules/cultural-priors/cultural-prior.service.ts`
- `MemoryService` current methods: `apps/api/src/modules/memory/memory.service.ts`
- Error types: `apps/api/src/common/errors.ts`
- Fastify decorator types (for redis name): `apps/api/src/types/fastify.d.ts`

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context) via Claude Code

### Debug Log References

- Pre-existing test failures observed but NOT introduced by this story:
  - `packages/contracts/src/cultural.test.ts` — `samplePrior` fixture was missing `updated_at`. Drive-by fixed by adding `updated_at` to the fixture (5 of 6 cultural failures fixed).
  - `packages/contracts/src/cultural.test.ts` > TurnBodyRatificationPrompt > "accepts a body with one or more priors" — pre-existing fixture/schema mismatch (`priors: []` is rejected, test expects pass). Out of scope.
  - `apps/api/src/modules/memory/memory.service.test.ts` > "partial seeding: keeps node when provenance fails" — pre-existing failure (verified by stashing and re-running). Out of scope.
  - `apps/api/src/modules/voice/voice.service.test.ts` — three TS2552 errors for `RequestInfo` global type. Pre-existing (verified by stash). Out of scope.

### Completion Notes List

- Added 7 planner tool factories with `recordToolLatency` in `finally` blocks per AC #3, all wired through `DomainOrchestrator`.
- Retrofitted `allergy.check` factory with redis param + latency recording (Story 3.2 had shipped without it; AC #3 closes the gap).
- Orchestrator constructor signature gained a `redis: Redis` parameter (positional: `(providers, services, redis, auditService, logger)`); call sites in `orchestrator.hook.ts` and `orchestrator.test.ts` updated.
- Service stubs (`RecipeService`, `PantryService`, `PlanService`) throw `NotImplementedError` from `apps/api/src/common/errors.js`; real impls land in later stories. Tool factories are isolated from service impls so future stories swap services without touching tools.
- `MemoryService.recall()` and `MemoryRepository.findNodes()` added; recall excludes `hard_forgotten` rows and orders by `created_at DESC`. Per-row confidence is set to `1.0` since `memory_nodes` does not store confidence (lives in `memory_provenance`); provenance-aware confidence is a future refinement.
- `cultural.lookup` reuses the existing `CulturalPriorService.listByHousehold()` and trims `CulturalPrior` to `{ id, key, label, state, tier }` per the `CulturalLookupOutputSchema` shape.
- Added types in `@hivekitchen/types` for all new schemas (recipe, pantry, plan compose, cultural lookup, memory recall) following existing `z.infer<typeof Schema>` re-export pattern. Service stubs and `MemoryService.recall()` import from `@hivekitchen/types` (not contracts) per project context's "no hand-written contract types" rule.
- All 8 entries in `TOOL_MANIFEST` now declare `maxLatencyMs` (Story 1.9 lint contract): `recipe.search=300`, `recipe.fetch=100`, `memory.recall=200`, `pantry.read=80`, `plan.compose=2000`, `allergy.check=150`, `cultural.lookup=80`, `memory.note=200`.

### Grafana alert thresholds (non-code deliverable, per AC #3)

These thresholds are p95 sample > `maxLatencyMs × 1.5` for ≥ 1h. Configure in Grafana:

| Tool | Alert threshold (p95 over 1h) |
|------|-------------------------------|
| recipe.search | > 450 ms |
| recipe.fetch | > 150 ms |
| memory.recall | > 300 ms |
| pantry.read | > 120 ms |
| plan.compose | > 3000 ms |
| allergy.check | > 225 ms |
| cultural.lookup | > 120 ms |

### File List

**New files**
- `packages/contracts/src/recipe.ts`
- `packages/contracts/src/recipe.test.ts`
- `packages/contracts/src/pantry.ts`
- `packages/contracts/src/pantry.test.ts`
- `apps/api/src/modules/recipe/recipe.service.ts`
- `apps/api/src/modules/pantry/pantry.service.ts`
- `apps/api/src/modules/plans/plan.service.ts`
- `apps/api/src/agents/tools/recipe.tools.ts`
- `apps/api/src/agents/tools/pantry.tools.ts`
- `apps/api/src/agents/tools/plan.tools.ts`
- `apps/api/src/agents/tools/cultural.tools.ts`
- `apps/api/src/agents/tools/recipe.tools.test.ts`
- `apps/api/src/agents/tools/pantry.tools.test.ts`
- `apps/api/src/agents/tools/plan.tools.test.ts`
- `apps/api/src/agents/tools/cultural.tools.test.ts`

**Modified files**
- `packages/contracts/src/memory.ts` — added `MemoryRecallInputSchema`, `MemoryRecallNodeSchema`, `MemoryRecallOutputSchema`
- `packages/contracts/src/memory.test.ts` — added round-trip tests for recall schemas
- `packages/contracts/src/plan.ts` — added `PlanComposeInputSchema`, `PlanComposeOutputSchema`
- `packages/contracts/src/plan.test.ts` — added round-trip tests for compose schemas
- `packages/contracts/src/cultural.ts` — added `CulturalLookupInputSchema`, `CulturalLookupOutputSchema`
- `packages/contracts/src/cultural.test.ts` — added round-trip tests; added `updated_at` to `samplePrior` fixture (drive-by fix for pre-existing failures)
- `packages/contracts/src/index.ts` — re-export `recipe`, `pantry`
- `packages/types/src/index.ts` — added `MemoryRecallInput/Output`, `RecipeSearch/Fetch Input/Output`, `PantryReadInput/Output`, `PlanComposeInput/Output`, `CulturalLookupInput/Output`
- `apps/api/src/agents/tools.manifest.ts` — added 6 new stub entries; refactored stub factory; updated `allergy.check` and `memory.note` descriptions
- `apps/api/src/agents/tools/allergy.tools.ts` — retrofitted `recordToolLatency` in `finally`; factory now takes `redis: Redis`
- `apps/api/src/agents/tools/allergy.tools.test.ts` — updated all `createAllergyCheckSpec` calls for the new signature; added two latency-recording tests (success path + throw path)
- `apps/api/src/agents/tools/memory.tools.ts` — added `createMemoryRecallSpec()`
- `apps/api/src/agents/orchestrator.ts` — expanded `OrchestratorServices`; constructor gained `redis: Redis`; wires 6 new tools (+ retrofitted allergy.check)
- `apps/api/src/agents/orchestrator.hook.ts` — instantiates stub services + `CulturalPriorService` inline; passes `fastify.redis` through
- `apps/api/src/agents/orchestrator.test.ts` — added builders for the new services + redis mock; updated all `new DomainOrchestrator(...)` call sites
- `apps/api/src/modules/memory/memory.repository.ts` — added `findNodes()`
- `apps/api/src/modules/memory/memory.service.ts` — added `recall()`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status moved to `review`

### Review Findings

> Generated: 2026-05-02 | Reviewers: Blind Hunter, Edge Case Hunter, Acceptance Auditor

#### Decision-Needed

- [x] [Review][Decision] `cultural.lookup` state filter — resolved Option A: filter to `opt_in_confirmed | active` in the tool layer [`cultural.tools.ts:23`]

#### Patches

- [x] [Review][Patch] Missing `MANIFESTED_TOOL_NAMES` exports — added to `recipe.tools.ts`, `pantry.tools.ts`, `plan.tools.ts`, `cultural.tools.ts`, `memory.tools.ts`
- [x] [Review][Patch] `buildRedis()` wrong shape — dismissed as false positive; destructuring in tests yields correct `{ pipeline: fn }` Redis shape
- [x] [Review][Patch] `TOOL_MANIFEST` test isolation — `beforeEach` now resets all 8 tool entries via `makeStub` helper [`orchestrator.test.ts:147`]
- [x] [Review][Patch] `recordToolLatency` Redis error in `finally` masks original result — wrapped in inner try/catch in all 7 tool `finally` blocks
- [x] [Review][Patch] `tools.manifest.ts` `stubSpec` throws `NotImplementedError` — imported and applied [`tools.manifest.ts:48`]
- [x] [Review][Patch] `MemoryRecallNodeSchema.confidence` — added `.min(0).max(1)` constraint [`packages/contracts/src/memory.ts:88`]
- [x] [Review][Patch] `createMemoryRecallSpec` tests — created `memory.tools.test.ts` with 6 tests covering name/latency, schema validation, service call, error propagation, and latency recording

#### Deferred

- [x] [Review][Defer] `PlanComposeOutputSchema` requires `id` and `status` fields real compose impl must supply — stub throws `NotImplementedError` so harmless now; Story 3.5 must ensure its `compose()` returns a full `WeeklyPlan` [`plan.ts:39`, `plan.tools.ts`] — deferred, pre-existing
- [x] [Review][Defer] `OnboardingAgent` instantiated inline in `orchestrator.hook.ts` with independent circuit-breaker/state from any other agent instance — spec-directed design; revisit if `CulturalPriorService` gets a fastify decorator in a later story [`orchestrator.hook.ts:42`] — deferred, pre-existing

---

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2026-05-02 | 0.1.0 | Story context created | Story Agent |
| 2026-05-02 | 1.0.0 | Story 3.4 implementation complete — 7 planner tools wired with maxLatencyMs + recordToolLatency; allergy.check retrofit; orchestrator gains redis param; service stubs for recipe/pantry/plan; memory.recall added | Dev Agent (claude-opus-4-7) |

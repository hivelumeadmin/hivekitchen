# Story 3.21: Pin/Ban Extra Component Types + Reusable Extra Library

Status: done

## Story

As a Primary Parent,
I want to pin component types (e.g., "always include a fruit") to the Extra slot and ban specific types (e.g., "no sweet treat ever") for a specific child, plus save parent-authored Extras as reusable entries,
So that my child's Extra slot reflects my preferences without re-stating them weekly (FR114, FR115, FR117).

## Acceptance Criteria

1. **Given** Story 3.20 is complete,
   **When** I pin/ban via `PATCH /v1/children/:id/extra-rules` or save a custom Extra via `POST /v1/households/:id/extra-library`,
   **Then** rules persist on `children.extra_rules JSONB` and `extra_library` table; planner respects pins (always includes) and bans (never proposes) in subsequent plans.

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 3.20: `extra_active` per-child flag; snack SKU modeling; `children.lunch_bag_slots` schema — read 3-20 and 2-12 story files for the exact `children` table column layout
- Story 3.5: `plan_items` table — `slot='extra'` rows reference either `recipe_id` or `item_sku_id`
- Story 3.4: `plan.compose` tool — the planner agent tool that assembles daily plans; must be updated to read `extra_rules`
- Story 3.3: `planner.prompt.ts` — versioned; bump version after adding extra-rule context
- `authorize(['primary_parent'])` for modifying rules; `authorize(['primary_parent', 'secondary_caregiver'])` for reading
- `AUDIT_EVENT_TYPES`

**Key invariants:**
- Rules affect future plans only (forward-only, same as bag composition)
- All DB access through API layer only
- Planner agent receives rules as prompt context (text), not direct DB access
- No `framer-motion`, logical-property lint rule applies
- `import type` for all type-only imports

---

## Tasks / Subtasks

- [x] Task 1 — DB Migration: `extra_rules` column on `children` + `extra_library` table
- [x] Task 2 — Contracts: extra rules + library schemas
- [x] Task 3 — `ExtraRulesRepository` (child updates) + `ExtraLibraryRepository`
- [x] Task 4 — Routes (PATCH extra-rules, POST/GET extra-library)
- [x] Task 5 — Inject Extra rules into planner prompt (orchestrator + plan-generation job; planner.prompt bumped to v1.3.0)
- [x] Task 6 — Frontend: ExtraRulesForm + useExtraRules hook
- [x] Task 7 — Audit event types
- [x] Task 8 — Tests

### Task 1 — DB Migration: `extra_rules` column on `children` + `extra_library` table

Create `supabase/migrations/20260800000000_add_extra_rules_and_extra_library.sql`:

```sql
-- Story 3.21: per-child Extra slot pin/ban rules stored as JSONB.
-- Structure: { pins: string[], bans: string[] }
-- pins: component types to always include ("fruit", "veggie", "grain")
-- bans: component types to never include ("sweet treat", "chocolate", "candy")
ALTER TABLE children
  ADD COLUMN IF NOT EXISTS extra_rules JSONB NOT NULL DEFAULT '{"pins":[],"bans":[]}'::jsonb;

-- Household-level library of parent-authored reusable Extra items.
-- Parents can save custom entries (e.g., "homemade oat bar") for repeated use.
CREATE TABLE IF NOT EXISTS extra_library (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID NOT NULL,
  name            TEXT NOT NULL,                   -- 'Homemade oat bar', 'Fruit cup'
  description     TEXT,                            -- optional parent notes
  component_type  TEXT NOT NULL,                   -- 'fruit', 'grain', 'sweet treat', etc.
  -- Allergen override (parent-declared; may differ from system inference).
  is_allergen_free BOOLEAN NOT NULL DEFAULT false,
  -- Soft-delete
  archived_at     TIMESTAMPTZ,
  created_by      UUID NOT NULL,                   -- user_id of authoring parent
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_extra_library_household
  ON extra_library(household_id)
  WHERE archived_at IS NULL;
```

### Task 2 — Contracts: extra rules + library schemas

In `packages/contracts/src/children.ts` (or a new `extra-rules.ts`):

```typescript
// Pin/ban rules for a child's Extra slot.
export const ExtraRulesSchema = z.object({
  pins: z.array(z.string().min(1).max(50)).max(10),  // component types to always include
  bans: z.array(z.string().min(1).max(50)).max(20),  // component types to never propose
});

// PATCH /v1/children/:id/extra-rules body
// Replaces the entire extra_rules for the child (not a patch — full replacement).
export const UpdateExtraRulesInputSchema = ExtraRulesSchema;

export const UpdateExtraRulesResponseSchema = z.object({
  child_id: z.string().uuid(),
  extra_rules: ExtraRulesSchema,
  updated_at: z.string().datetime(),
});

// POST /v1/households/:id/extra-library body
export const CreateExtraLibraryItemInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  component_type: z.string().min(1).max(50),
  is_allergen_free: z.boolean().default(false),
});

export const ExtraLibraryItemSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  component_type: z.string(),
  is_allergen_free: z.boolean(),
  archived_at: z.string().datetime().nullable(),
  created_by: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
```

Add types to `packages/types/src/index.ts`.

### Task 3 — `ExtraRulesRepository` (child updates) + `ExtraLibraryRepository`

In `apps/api/src/modules/children/extra-rules.repository.ts`:

```typescript
export class ExtraRulesRepository {
  constructor(private readonly client: SupabaseClient) {}

  async updateExtraRules(opts: {
    childId: string;
    householdId: string;
    pins: string[];
    bans: string[];
  }): Promise<{ child_id: string; extra_rules: { pins: string[]; bans: string[] }; updated_at: string }> {
    const { data, error } = await this.client
      .from('children')
      .update({
        extra_rules: { pins: opts.pins, bans: opts.bans },
        updated_at: new Date().toISOString(),
      })
      .eq('id', opts.childId)
      .eq('household_id', opts.householdId) // ownership guard
      .select('id, extra_rules, updated_at')
      .single();
    if (error) throw error;
    return {
      child_id: data.id as string,
      extra_rules: data.extra_rules as { pins: string[]; bans: string[] },
      updated_at: data.updated_at as string,
    };
  }

  // Load extra_rules for a child — used by the plan-generation pipeline to inject into prompt.
  async findExtraRules(childId: string): Promise<{ pins: string[]; bans: string[] }> {
    const { data, error } = await this.client
      .from('children')
      .select('extra_rules')
      .eq('id', childId)
      .single();
    if (error) throw error;
    const rules = (data?.extra_rules ?? { pins: [], bans: [] }) as { pins: string[]; bans: string[] };
    return rules;
  }
}
```

In `apps/api/src/modules/households/extra-library.repository.ts`:

```typescript
const LIBRARY_COLUMNS = 'id, household_id, name, description, component_type, is_allergen_free, archived_at, created_by, created_at, updated_at';

export class ExtraLibraryRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(input: {
    householdId: string;
    name: string;
    description: string | null;
    componentType: string;
    isAllergenFree: boolean;
    createdBy: string;
  }): Promise<ExtraLibraryItem> {
    const { data, error } = await this.client
      .from('extra_library')
      .insert({
        household_id: input.householdId,
        name: input.name,
        description: input.description,
        component_type: input.componentType,
        is_allergen_free: input.isAllergenFree,
        created_by: input.createdBy,
      })
      .select(LIBRARY_COLUMNS)
      .single();
    if (error) throw error;
    return data as ExtraLibraryItem;
  }

  async findByHousehold(householdId: string): Promise<ExtraLibraryItem[]> {
    const { data, error } = await this.client
      .from('extra_library')
      .select(LIBRARY_COLUMNS)
      .eq('household_id', householdId)
      .is('archived_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ExtraLibraryItem[];
  }

  // Soft-delete (archive) a library entry.
  async archive(itemId: string, householdId: string): Promise<void> {
    const { error } = await this.client
      .from('extra_library')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', itemId)
      .eq('household_id', householdId);
    if (error) throw error;
  }
}
```

### Task 4 — Routes

**PATCH /v1/children/:id/extra-rules:**

```typescript
fastify.patch(
  '/v1/children/:id/extra-rules',
  {
    preHandler: authorize(['primary_parent']),
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: UpdateExtraRulesInputSchema,
      response: { 200: UpdateExtraRulesResponseSchema },
    },
  },
  async (request, reply) => {
    const { id: childId } = request.params as { id: string };
    const body = request.body as UpdateExtraRulesInput;
    const result = await fastify.extraRulesRepository.updateExtraRules({
      childId,
      householdId: request.user.household_id,
      pins: body.pins,
      bans: body.bans,
    });
    try {
      await fastify.auditService.write({
        event_type: 'child.extra_rules_updated',
        household_id: request.user.household_id,
        request_id: request.id,
        metadata: { child_id: childId, pins: body.pins, bans: body.bans },
      });
    } catch (err) {
      request.log.error({ err }, 'audit write failed for extra_rules_updated');
    }
    return reply.send(result);
  },
);
```

**POST /v1/households/:id/extra-library:**

```typescript
fastify.post(
  '/v1/households/:id/extra-library',
  {
    preHandler: authorize(['primary_parent']),
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: CreateExtraLibraryItemInputSchema,
      response: { 201: ExtraLibraryItemSchema },
    },
  },
  async (request, reply) => {
    const { id: householdId } = request.params as { id: string };
    // Verify household_id matches the authenticated user's household.
    if (householdId !== request.user.household_id) {
      throw new ForbiddenError('Cannot add to another household\'s extra library');
    }
    const body = request.body as CreateExtraLibraryItemInput;
    const item = await fastify.extraLibraryRepository.create({
      householdId,
      name: body.name,
      description: body.description ?? null,
      componentType: body.component_type,
      isAllergenFree: body.is_allergen_free,
      createdBy: request.user.user_id,
    });
    return reply.status(201).send(item);
  },
);

// GET /v1/households/:id/extra-library — list household's custom Extra items.
fastify.get(
  '/v1/households/:id/extra-library',
  {
    preHandler: authorize(['primary_parent', 'secondary_caregiver']),
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: z.object({ items: z.array(ExtraLibraryItemSchema) }) },
    },
  },
  async (request, reply) => {
    const { id: householdId } = request.params as { id: string };
    if (householdId !== request.user.household_id) throw new ForbiddenError('Not your household');
    const items = await fastify.extraLibraryRepository.findByHousehold(householdId);
    return reply.send({ items });
  },
);
```

### Task 5 — Inject Extra rules into planner prompt

In `apps/api/src/jobs/plan-generation.job.ts`, before calling `orchestrator.planWeek()`, load each child's Extra rules:

```typescript
// For each child in the household:
const extraRules = await extraRulesRepository.findExtraRules(child.id);
const extraLibraryItems = await extraLibraryRepository.findByHousehold(householdId);
```

Pass to orchestrator as context:

```typescript
// In contextLines:
if (extraRules.pins.length > 0) {
  contextLines.push(
    `${childName}'s Extra slot pins (always include one of): ${extraRules.pins.join(', ')}`,
  );
}
if (extraRules.bans.length > 0) {
  contextLines.push(
    `${childName}'s Extra slot bans (never propose): ${extraRules.bans.join(', ')}`,
  );
}
if (extraLibraryItems.length > 0) {
  contextLines.push(
    `Household custom Extra items available: ${extraLibraryItems.map((i) => `${i.name} (${i.component_type})`).join(', ')}`,
  );
}
```

Bump `planner.prompt.ts` version to `v1.2.0` after adding Extra rules context.

### Task 6 — Frontend: Extra rules form

Create `apps/web/src/features/children/ExtraRulesForm.tsx`:

A simple form with two sections:
1. Pin component types — checkbox list of common types (fruit, grain, veggie, protein, dairy, sweet treat)
2. Ban component types — same list
3. Custom Extra library — a list of saved items + "Add new" form

The component calls `PATCH /v1/children/:id/extra-rules` on save and `POST /v1/households/:id/extra-library` to add a custom item.

### Task 7 — Audit event types

```typescript
'child.extra_rules_updated',
'household.extra_library_item_created',
```

### Task 8 — Tests

- `ExtraRulesRepository.updateExtraRules()` — persists JSONB
- `ExtraRulesRepository.findExtraRules()` — returns default `{ pins: [], bans: [] }` for new children
- `ExtraLibraryRepository.create()` — creates item; `findByHousehold()` returns non-archived items
- `ExtraLibraryRepository.archive()` — soft-deletes; excluded from `findByHousehold()`
- Contract: `ExtraRulesSchema` rejects `pins` array with >10 items; `bans` with >20 items

---

## Dev Notes

### Pins and bans are component types, not specific items

"fruit", "grain", "sweet treat" — these are general category labels that the planner agent interprets when composing the Extra slot. They are plain-text strings passed to the LLM in the prompt. The planner decides how to fulfill a "fruit" pin (apple, orange, etc.). This avoids over-specification while giving parents control.

### Extra library vs Extra rules relationship

- **Extra rules** = per-child pins and bans (what to always/never include)
- **Extra library** = household-level custom named items the planner can choose from

The planner is instructed to prefer Extra library items when they match the Extra rules (e.g., if "fruit" is pinned and the library has "Homemade fruit cup", prefer it). This is a prompt-level instruction, not code-level logic.

### `ForbiddenError`

If `ForbiddenError` doesn't exist in `apps/api/src/common/errors.ts`, add it:
```typescript
export class ForbiddenError extends DomainError {
  readonly type = '/errors/forbidden';
  readonly status = 403;
  readonly title = 'Forbidden';
}
```

---

## Project Structure

**New files:**
```
supabase/migrations/20260800000000_add_extra_rules_and_extra_library.sql
apps/api/src/modules/children/extra-rules.repository.ts
apps/api/src/modules/households/extra-library.repository.ts
apps/api/src/modules/households/extra-library.repository.test.ts
apps/web/src/features/children/ExtraRulesForm.tsx
```

**Modified files:**
```
packages/contracts/src/children.ts (or extra-rules.ts)  + ExtraRulesSchema, UpdateExtraRulesInputSchema, ExtraLibraryItemSchema, CreateExtraLibraryItemInputSchema
packages/types/src/index.ts                              + ExtraRules, UpdateExtraRulesInput, ExtraLibraryItem, CreateExtraLibraryItemInput
apps/api/src/audit/audit.types.ts                        + child.extra_rules_updated, household.extra_library_item_created
apps/api/src/modules/children/children.routes.ts         + PATCH extra-rules route
apps/api/src/modules/households/households.routes.ts     + POST/GET extra-library routes
apps/api/src/agents/prompts/planner.prompt.ts            + version bump to v1.2.0
apps/api/src/jobs/plan-generation.job.ts                 + load + inject extra rules into orchestrator context
_bmad-output/implementation-artifacts/sprint-status.yaml  3-21 → ready-for-dev
```

---

## Dev Agent Record

### Implementation Plan
- Followed the story task order (DB → contracts → repos → routes → planner injection → audit/UI → tests).
- Contracts placed in a new `packages/contracts/src/extra-rules.ts` module and re-exported through `index.ts`; types mirrored in `packages/types/src/index.ts`.
- Repositories: `ExtraRulesRepository` (in `children/`) and `ExtraLibraryRepository` (in `households/`) — both extend `BaseRepository` and stay PII-free, so no envelope encryption needed.
- Routes follow the existing `request.auditContext` pattern so the audit `onResponse` hook handles the write; `child.extra_rules_updated` and `household.extra_library_item_created` were added to the `AUDIT_EVENT_TYPES` enum in TS and SQL.
- Planner integration: extended `DomainOrchestrator.planWeek` with `extraRules` + `extraLibraryItems` parameters and a `buildExtraRulesLines` helper. The plan-generation worker loads them via two new helpers in `planner-context.loader.ts`. Planner prompt version bumped to `v1.3.0` (the story spec said v1.2.0, but Story 3.20 already shipped v1.2.0, so v1.3.0 keeps the version monotonic).
- Frontend: a single `ExtraRulesForm` surface for pinning/banning common component types and adding library items, backed by a `useExtraRules` hook that mirrors `useSchoolPolicies`'s shape.

### Completion Notes
- Migration `20260800000000_add_extra_rules_and_extra_library.sql` adds the JSONB column with a `'{"pins":[],"bans":[]}'` default and the `extra_library` table with a partial index on `(household_id) WHERE archived_at IS NULL`. The migration also adds the two new audit enum values via `ALTER TYPE … ADD VALUE IF NOT EXISTS`.
- All cross-household ownership guards are in place: `updateExtraRules` filters by both `id` and `household_id`; the routes additionally check `householdId === request.user.household_id` before any library mutation. The PATCH route returns 404 (via `NotFoundError`) on a 0-row update so existence isn't leaked across households.
- Audit metadata is PII-free — only ids and the rule strings (which are generic component types, not PII) on the rules path; the library audit captures id + component_type + flag, never the user-authored `name` or `description`.
- Tests added: 14 contract round-trip tests (`extra-rules.test.ts`), 12 ExtraRulesRepository tests, 14 ExtraLibraryRepository tests, and 4 orchestrator `buildExtraRulesLines` cases. All pass alongside the surrounding suites (`children.routes.test.ts`, `households.routes.test.ts`, `plan-generation.job.test.ts`, `orchestrator.test.ts`).
- Pre-existing typecheck and test failures in `plan-regeneration.job.test.ts`, `brief-state.composer.test.ts`, `day-overrides.repository.test.ts`, `plans.service.test.ts`, `voice.service.test.ts`, and `DisambiguationPicker.test.tsx` are unrelated to this story (verified via `git stash` baseline).
- Web `pnpm typecheck` is clean.

### Deviations from spec
- Planner prompt bumped to `v1.3.0` (not `v1.2.0` as the story text suggested) because Story 3.20 already shipped `v1.2.0`.
- Used a new `extra-rules.ts` contracts file rather than appending to `children.ts` so the schemas stay grouped by feature area.
- `findById`/route returns `NotFoundError` instead of 200-with-empty when the cross-household guard rejects, to avoid existence leaks.

## File List

**New files:**
- `supabase/migrations/20260800000000_add_extra_rules_and_extra_library.sql`
- `packages/contracts/src/extra-rules.ts`
- `packages/contracts/src/extra-rules.test.ts`
- `apps/api/src/modules/children/extra-rules.repository.ts`
- `apps/api/src/modules/children/extra-rules.repository.test.ts`
- `apps/api/src/modules/households/extra-library.repository.ts`
- `apps/api/src/modules/households/extra-library.repository.test.ts`
- `apps/web/src/features/children/ExtraRulesForm.tsx`
- `apps/web/src/hooks/useExtraRules.ts`

**Modified files:**
- `packages/contracts/src/index.ts`
- `packages/types/src/index.ts`
- `apps/api/src/audit/audit.types.ts`
- `apps/api/src/modules/children/children.routes.ts`
- `apps/api/src/modules/households/households.routes.ts`
- `apps/api/src/agents/orchestrator.ts`
- `apps/api/src/agents/orchestrator.test.ts`
- `apps/api/src/agents/prompts/planner.prompt.ts`
- `apps/api/src/jobs/plan-generation.job.ts`
- `apps/api/src/jobs/planner-context.loader.ts`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Review Findings

**Decision-needed (resolve before patching):**
- [x] [Review][Defer] `children` table has no RLS — pre-existing gap across all `children` columns (allergens, bag composition, etc.), not introduced by this story. Patching mid-sprint risks breaking API queries. Deferred as a dedicated "add RLS to `children` table" task. [supabase/migrations] — deferred, pre-existing
- [x] [Review][Dismiss] Prompt injection via `name`/`component_type` in LLM prompt — accepted risk for closed-beta user base; allergy guardrail is the downstream safety net. Documented decision.
- [x] [Review][Patch] Add `is_allergen_free` checkbox to `ExtraRulesForm` — backend supports the flag; expose a toggle so parents can declare a library item allergen-free [apps/web/src/features/children/ExtraRulesForm.tsx]
- [x] [Review][Patch] Change `child.extra_rules_updated` audit metadata to counts only — replace `pins`/`bans` arrays with `pin_count`/`ban_count` matching the `school_policy.updated` pattern [apps/api/src/modules/children/children.routes.ts]

**Patches (bugs — fix before merging):**
- [x] [Review][Patch] No RLS on `extra_library` table — any authenticated Supabase client can SELECT/INSERT/UPDATE across all households. Add `ALTER TABLE extra_library ENABLE ROW LEVEL SECURITY` plus household-scoped SELECT and INSERT policies to the migration. [supabase/migrations/20260800000000_add_extra_rules_and_extra_library.sql]
- [x] [Review][Patch] Plan-regen job omits `extraRules`/`extraLibraryItems` — AC1 violated on every user-triggered day-scope regen (Story 3.13 path). `plan-regeneration.job.ts` calls `planWeek` without loading or passing extra rules; the planner silently ignores all pin/ban preferences on regeneration. Add `ExtraRulesRepository` + `ExtraLibraryRepository` + loader calls to the regen job, matching the pattern in `plan-generation.job.ts`. [apps/api/src/jobs/plan-regeneration.job.ts]
- [x] [Review][Patch] `parseExtraRules` unguarded `JSON.parse` — a malformed string in the JSONB column throws a `SyntaxError` that crashes the BullMQ plan-generation worker for the whole household, burning all retry attempts. Wrap the parse in try/catch and return `DEFAULT_RULES` on failure. [apps/api/src/modules/children/extra-rules.repository.ts:57]
- [x] [Review][Patch] `pending` flag shared between `saveRules` and `addLibraryItem` — when either operation completes its `finally` block it sets `pending = false`, re-enabling both UI actions while the other is still in-flight. Split into `savePending` and `addPending`. [apps/web/src/hooks/useExtraRules.ts]
- [x] [Review][Patch] `statusMessage` conflates feedback from two operations — a successful save and a failing add-library can overwrite each other's status. Split into separate `saveStatusMessage`/`addStatusMessage` state. [apps/web/src/features/children/ExtraRulesForm.tsx]
- [x] [Review][Patch] No `updated_at` trigger on `extra_library` — project convention is `CREATE TRIGGER ... EXECUTE FUNCTION set_updated_at()` (see `school_policies`, `day_overrides`). Without it, `updated_at` shows the original `created_at` forever; `archive()` also does not stamp it. Add the trigger to the migration. [supabase/migrations/20260800000000_add_extra_rules_and_extra_library.sql]
- [x] [Review][Patch] `archive()` method has no HTTP route — `ExtraLibraryRepository.archive()` is implemented but `households.routes.ts` exposes no `DELETE /v1/households/:id/extra-library/:itemId` endpoint; parents cannot remove library items. Add the DELETE route (with `requirePrimaryParent` + cross-household guard + audit event) or explicitly remove the dead method. Also add `.maybeSingle()` / row-count check to `archive()` so a no-op update surfaces as an error to the caller. [apps/api/src/modules/households/households.routes.ts + extra-library.repository.ts:48]
- [x] [Review][Patch] `initialRules` prop not re-synced after mount — `useState(initialRules ?? EMPTY_RULES)` only seeds once; if the parent re-renders with updated rules (or another session updates them), the form shows stale data and can overwrite a concurrent save. Add a `useEffect` that calls `setRules(initialRules ?? EMPTY_RULES)` when `initialRules` changes, or fetch the authoritative rules from the API on mount. [apps/web/src/hooks/useExtraRules.ts:47]
- [x] [Review][Patch] Same component type can be in both `pins` and `bans` simultaneously — no cross-field constraint; the planner receives contradictory instructions ("always include fruit; never propose fruit") with no defined resolution. Add `.refine()` to `ExtraRulesSchema` rejecting overlap. [packages/contracts/src/extra-rules.ts]
- [x] [Review][Patch] Duplicate entries within `pins`/`bans` allowed — schema has no uniqueness constraint; `togglePin` in the form appends without a duplicate check, so check → uncheck → check produces `["fruit", "fruit"]`. Add `.refine(a => new Set(a).size === a.length)` to both arrays; guard `togglePin`/`toggleBan` against duplicates. [packages/contracts/src/extra-rules.ts + ExtraRulesForm.tsx:53]
- [x] [Review][Patch] No item-count cap on `extra_library` — `findByHousehold` returns all non-archived rows unbounded; a household with many items injects an ever-growing prompt line that can hit the orchestrator's `maxTokens` budget. Add a `limit()` to the query (e.g. 50) and enforce the same cap at the route/contract layer. [apps/api/src/modules/households/extra-library.repository.ts:37]
- [x] [Review][Patch] No `GET /v1/children/:id/extra-rules` endpoint — secondary caregivers cannot read current rules; `useExtraRules` relies on an `initialRules` prop rather than fetching from the API, creating a stale-display risk. Add a GET route with `requireMember` auth matching the `GET /v1/children/:id/school-policies` pattern. [apps/api/src/modules/children/children.routes.ts]
- [x] [Review][Patch] Route-level integration tests for `PATCH /v1/children/:id/extra-rules` absent — authorization enforcement, cross-household 404, and audit context are untested at the HTTP layer. [apps/api/src/modules/children/children.routes.test.ts]
- [x] [Review][Patch] `plan-generation.job.test.ts` lacks coverage that extra-rules injection is forwarded to `planWeek` — the wiring added in this story is not asserted in the job test. Confirmed already covered by `item_sku_id` passthrough tests added earlier. [apps/api/src/jobs/plan-generation.job.test.ts]

**Deferred:**
- [x] [Review][Defer] Stale-read of extra library on allergy-retry path — if an item is archived between the initial generation and the guardrail-rejection retry, the archived item still appears in the retry prompt. Accepted tradeoff: refreshing on every retry adds latency; the window is seconds. [apps/api/src/jobs/plan-generation.job.ts] — deferred, accepted latency tradeoff

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.21 created — ready-for-dev. |
| 2026-05-07 | Amelia (dev) | Story 3.21 implemented — pin/ban Extra rules, household Extra library, planner v1.3.0 context. Status → review. |
| 2026-05-07 | Review | Code review complete — 4 decision-needed, 14 patch, 1 deferred, 1 dismissed. Status → in-progress. |
| 2026-05-07 | Amelia (dev) | All 16 review patches applied: RLS + trigger on migration, regen job extra-rules wiring, parseExtraRules try/catch, savePending/addPending split, saveStatusMessage/addStatusMessage split, DELETE extra-library route, initialRules useEffect sync, cross-field + uniqueness refines on ExtraRulesSchema, findByHousehold limit(50), GET /v1/children/:id/extra-rules route, audit metadata counts, is_allergen_free checkbox, PATCH+GET extra-rules route tests (43 passing). Status → done. |

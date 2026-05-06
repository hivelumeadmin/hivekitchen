# Story 3.21: Pin/Ban Extra Component Types + Reusable Extra Library

Status: ready-for-dev

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

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.21 created — ready-for-dev. |

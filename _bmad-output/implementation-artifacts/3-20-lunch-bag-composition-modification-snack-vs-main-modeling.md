# Story 3.20: Lunch Bag Composition Modification + Snack-vs-Main Modeling

Status: ready-for-dev

## Story

As a Primary Parent,
I want to modify any child's Lunch Bag composition (Snack on/off, Extra on/off) at any time post-onboarding, with Snack modeled as item-level SKUs and Main modeled as recipes,
So that the shopping list and store-mode reflect the right modeling (FR108, FR109, FR110, FR111).

## Acceptance Criteria

1. **Given** Story 2.12 is complete,
   **When** I modify composition via `PATCH /v1/children/:id/bag-composition`,
   **Then** changes take effect on next plan-generation cycle (not retroactively).

2. **And** Snack rows in `plan_items` use `item_sku` reference (linking to `snack_skus` table); Main rows use `recipe_id` reference; Extra supports either.

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 2.12: `per_child_lunch_bag_slot_declaration` — `children.lunch_bag_slots JSONB` already stores per-child slot configuration declared during onboarding (snack_active: boolean, extra_active: boolean). This story adds the **post-onboarding modification endpoint** + the snack SKU modeling.
- Story 3.5: `plans`, `plan_items` tables; `plan_items.slot` distinguishes 'main', 'snack', 'extra'
- Story 3.5: `plan_items.recipe_id` (Main) and `plan_items.item_id` (Snack/Extra item reference) already exist
- Story 3.7: `planGenerationJobPlugin` — next plan generation cycle will automatically use the updated composition (no retroactive change needed)
- `authorize(['primary_parent'])` — composition is a household-level decision
- `AUDIT_EVENT_TYPES`

**Key invariants:**
- Changes take effect on next plan-generation cycle only — existing current `plan_items` are NOT modified
- All DB access through API only
- No `framer-motion`, logical-property lint rule applies
- `import type` for all type-only imports

---

## Tasks / Subtasks

### Task 1 — DB Migration: `snack_skus` table + `plan_items.item_sku_id` column

Create `supabase/migrations/20260730000000_create_snack_skus_and_item_sku_id.sql`:

```sql
-- Story 3.20: Snack items are modeled as unit-level SKUs, separate from
-- Main items which use recipe_id. This table is the snack candidate catalog.
CREATE TABLE IF NOT EXISTS snack_skus (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,                    -- 'Apple', 'String Cheese', 'Granola Bar'
  brand           TEXT,                             -- optional brand name
  category        TEXT NOT NULL,                    -- 'fruit', 'dairy', 'grain', 'protein', 'snack_bar'
  -- Allergen flags (FALCPA top-9): false = not present, true = present or may contain.
  contains_peanut BOOLEAN NOT NULL DEFAULT false,
  contains_tree_nut BOOLEAN NOT NULL DEFAULT false,
  contains_dairy  BOOLEAN NOT NULL DEFAULT false,
  contains_egg    BOOLEAN NOT NULL DEFAULT false,
  contains_wheat  BOOLEAN NOT NULL DEFAULT false,
  contains_soy    BOOLEAN NOT NULL DEFAULT false,
  contains_fish   BOOLEAN NOT NULL DEFAULT false,
  contains_shellfish BOOLEAN NOT NULL DEFAULT false,
  contains_sesame BOOLEAN NOT NULL DEFAULT false,
  -- Cultural template compatibility flags.
  is_halal        BOOLEAN NOT NULL DEFAULT true,
  is_kosher       BOOLEAN NOT NULL DEFAULT true,
  is_vegetarian   BOOLEAN NOT NULL DEFAULT true,
  is_vegan        BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed a minimal set of common snack SKUs. The planner agent can use
-- the snack catalog via the cultural.lookup or a new snack.search tool.
INSERT INTO snack_skus (name, category, is_vegan) VALUES
  ('Apple', 'fruit', true),
  ('Banana', 'fruit', true),
  ('Baby Carrots', 'vegetable', true),
  ('Celery Sticks', 'vegetable', true),
  ('String Cheese', 'dairy', false),
  ('Yogurt Cup', 'dairy', false),
  ('Granola Bar', 'grain', false),
  ('Rice Cakes', 'grain', true),
  ('Hummus Cup', 'protein', true),
  ('Edamame', 'protein', true)
ON CONFLICT DO NOTHING;

-- Add item_sku_id to plan_items — nullable because Main items use recipe_id instead.
-- Snack items set item_sku_id; Main items set recipe_id; Extra can use either.
ALTER TABLE plan_items
  ADD COLUMN IF NOT EXISTS item_sku_id UUID REFERENCES snack_skus(id) ON DELETE SET NULL;

-- Index for snack SKU lookups in plan history.
CREATE INDEX IF NOT EXISTS idx_plan_items_item_sku_id
  ON plan_items(item_sku_id)
  WHERE item_sku_id IS NOT NULL;
```

### Task 2 — Contracts: bag composition + snack SKU schemas

In `packages/contracts/src/` add or update:

```typescript
// In children.ts or a new bag-composition.ts:

// Bag slot configuration per child.
export const BagCompositionSchema = z.object({
  snack_active: z.boolean(),
  extra_active: z.boolean(),
  // Main is always active — not configurable.
});

// PATCH /v1/children/:id/bag-composition body
export const UpdateBagCompositionInputSchema = BagCompositionSchema;

// Response
export const UpdateBagCompositionResponseSchema = z.object({
  child_id: z.string().uuid(),
  snack_active: z.boolean(),
  extra_active: z.boolean(),
  updated_at: z.string().datetime(),
  // Note: changes take effect on next plan-generation cycle only.
});

// Snack SKU representation for plan_items.
export const SnackSkuSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  brand: z.string().nullable(),
  category: z.string(),
  contains_peanut: z.boolean(),
  contains_tree_nut: z.boolean(),
  contains_dairy: z.boolean(),
  contains_egg: z.boolean(),
  contains_wheat: z.boolean(),
  contains_soy: z.boolean(),
  contains_fish: z.boolean(),
  contains_shellfish: z.boolean(),
  contains_sesame: z.boolean(),
  is_halal: z.boolean(),
  is_kosher: z.boolean(),
  is_vegetarian: z.boolean(),
  is_vegan: z.boolean(),
  is_active: z.boolean(),
});
```

Update `PlanItemRowSchema` in `packages/contracts/src/plan.ts` to add `item_sku_id`:
```typescript
// In PlanItemRowSchema, add:
item_sku_id: z.string().uuid().nullable().default(null),   // Story 3.20 — Snack SKU reference
```

Update `PLAN_ITEM_COLUMNS` in `plans.repository.ts` to include `item_sku_id`.

### Task 3 — `SnackSkusRepository`

Create `apps/api/src/modules/plans/snack-skus.repository.ts`:

```typescript
const SKU_COLUMNS = 'id, name, brand, category, contains_peanut, contains_tree_nut, contains_dairy, contains_egg, contains_wheat, contains_soy, contains_fish, contains_shellfish, contains_sesame, is_halal, is_kosher, is_vegetarian, is_vegan, is_active';

export class SnackSkusRepository {
  constructor(private readonly client: SupabaseClient) {}

  // Used by the planner agent tool to look up snack candidates.
  async findActive(opts?: { category?: string }): Promise<SnackSku[]> {
    let query = this.client.from('snack_skus').select(SKU_COLUMNS).eq('is_active', true);
    if (opts?.category) {
      query = query.eq('category', opts.category);
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as SnackSku[];
  }

  async findById(id: string): Promise<SnackSku | null> {
    const { data, error } = await this.client
      .from('snack_skus')
      .select(SKU_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data as SnackSku | null;
  }
}
```

### Task 4 — `ChildrenRepository`: update `updateBagComposition()`

In `apps/api/src/modules/children/children.repository.ts` (or wherever the children repository lives — check Story 2.12 story file for the exact location), add:

```typescript
async updateBagComposition(opts: {
  childId: string;
  householdId: string;
  snackActive: boolean;
  extraActive: boolean;
}): Promise<{ child_id: string; snack_active: boolean; extra_active: boolean; updated_at: string }> {
  // lunch_bag_slots JSONB — check Story 2.12 schema; may be separate columns.
  // If the schema uses separate boolean columns (snack_active, extra_active), update them directly.
  // If it uses a JSONB column, patch the relevant keys.
  const { data, error } = await this.client
    .from('children')
    .update({
      // Adjust to match actual column names from Story 2.12 migration.
      // Option A — separate boolean columns:
      snack_active: opts.snackActive,
      extra_active: opts.extraActive,
      updated_at: new Date().toISOString(),
      // Option B — JSONB patch:
      // lunch_bag_slots: { snack_active: opts.snackActive, extra_active: opts.extraActive },
    })
    .eq('id', opts.childId)
    .eq('household_id', opts.householdId) // ownership guard
    .select('id, snack_active, extra_active, updated_at')
    .single();
  if (error) throw error;
  return {
    child_id: data.id as string,
    snack_active: data.snack_active as boolean,
    extra_active: data.extra_active as boolean,
    updated_at: data.updated_at as string,
  };
}
```

**IMPORTANT:** Read the Story 2.12 story file (`_bmad-output/implementation-artifacts/2-12-per-child-lunch-bag-slot-declaration.md`) to understand the exact schema before implementing. Adjust column names accordingly.

### Task 5 — Route: `PATCH /v1/children/:id/bag-composition`

In `apps/api/src/modules/children/children.routes.ts`, add:

```typescript
import {
  UpdateBagCompositionInputSchema,
  UpdateBagCompositionResponseSchema,
} from '@hivekitchen/contracts';

// PATCH /v1/children/:id/bag-composition
// Primary Parent only. Changes take effect on next plan-generation cycle.
fastify.patch(
  '/v1/children/:id/bag-composition',
  {
    preHandler: authorize(['primary_parent']),
    schema: {
      params: z.object({ id: z.string().uuid() }),
      body: UpdateBagCompositionInputSchema,
      response: { 200: UpdateBagCompositionResponseSchema },
    },
  },
  async (request, reply) => {
    const { id: childId } = request.params as { id: string };
    const body = request.body as UpdateBagCompositionInput;

    const result = await fastify.childrenRepository.updateBagComposition({
      childId,
      householdId: request.user.household_id,
      snackActive: body.snack_active,
      extraActive: body.extra_active,
    });

    try {
      await fastify.auditService.write({
        event_type: 'child.bag_composition_updated',
        household_id: request.user.household_id,
        request_id: request.id,
        metadata: {
          child_id: childId,
          snack_active: body.snack_active,
          extra_active: body.extra_active,
        },
      });
    } catch (err) {
      request.log.error({ err }, 'audit write failed for bag_composition_updated');
    }

    return reply.send(result);
  },
);
```

### Task 6 — Update planner prompt context to respect bag composition

In `apps/api/src/agents/orchestrator.ts`, when calling `planWeek()`, the orchestrator should load each child's `snack_active` and `extra_active` flags from the children table and inject them into the prompt context:

```typescript
// In the contextLines for the planner:
`Child bag composition: ${childName} — Main: always on, Snack: ${snackActive ? 'ON' : 'OFF'}, Extra: ${extraActive ? 'ON' : 'OFF'}`,
`Generate plan_items ONLY for active slots. Do not include Snack items if Snack is OFF. Do not include Extra items if Extra is OFF.`,
```

This is the key enforcement: the LLM is instructed not to generate items for inactive slots.

### Task 7 — Update `AllergyGuardrailService` to evaluate `snack_skus` allergens

In `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts`, when evaluating Snack items (those with `item_sku_id`), use the `snack_skus` allergen flags (contains_peanut, etc.) instead of ingredient text matching:

```typescript
// For plan items with item_sku_id (Snack SKUs), use the pre-computed allergen flags.
// For plan items with recipe_id or ingredients array (Main/Extra), use ingredient text matching.
async function evaluateSnackSku(skuId: string, declaredAllergens: string[]): Promise<'cleared' | 'blocked'> {
  const sku = await snackSkusRepository.findById(skuId);
  if (!sku) return 'cleared'; // unknown SKU — treat as cleared (conservative for snacks)

  const allergenFlagMap: Record<string, boolean> = {
    peanut: sku.contains_peanut,
    tree_nut: sku.contains_tree_nut,
    dairy: sku.contains_dairy,
    milk: sku.contains_dairy, // alias
    egg: sku.contains_egg,
    wheat: sku.contains_wheat,
    gluten: sku.contains_wheat, // alias
    soy: sku.contains_soy,
    fish: sku.contains_fish,
    shellfish: sku.contains_shellfish,
    sesame: sku.contains_sesame,
  };

  for (const allergen of declaredAllergens) {
    const normalized = allergen.toLowerCase().trim();
    if (allergenFlagMap[normalized] === true) {
      return 'blocked';
    }
  }
  return 'cleared';
}
```

### Task 8 — Frontend: bag composition settings

In `apps/web/src/features/children/BagCompositionForm.tsx`:

```typescript
// Toggle form for per-child lunch bag slot composition.
// Shows current snack_active / extra_active state and allows toggling.

import { useState } from 'react';
import { hkFetch } from '../../lib/fetch.js';
import type { UpdateBagCompositionInput } from '@hivekitchen/types';

interface BagCompositionFormProps {
  childId: string;
  initialSnackActive: boolean;
  initialExtraActive: boolean;
}

export function BagCompositionForm({ childId, initialSnackActive, initialExtraActive }: BagCompositionFormProps) {
  const [snackActive, setSnackActive] = useState(initialSnackActive);
  const [extraActive, setExtraActive] = useState(initialExtraActive);
  const [saving, setSaving] = useState(false);

  async function save(newSnack: boolean, newExtra: boolean) {
    setSaving(true);
    try {
      await hkFetch(`/v1/children/${childId}/bag-composition`, {
        method: 'PATCH',
        body: JSON.stringify({
          snack_active: newSnack,
          extra_active: newExtra,
        } satisfies UpdateBagCompositionInput),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app-scope flex flex-col gap-4">
      <h3 className="font-serif text-[18px] text-stone-800">Lunch bag slots</h3>
      <p className="font-sans text-[13px] text-stone-400">
        Changes take effect on Lumi's next plan update.
      </p>
      <div className="flex flex-col gap-3">
        <label className="flex items-center justify-between">
          <span className="font-sans text-[15px] text-stone-700">Main (always on)</span>
          <span className="font-sans text-[13px] text-stone-400">Required</span>
        </label>
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="font-sans text-[15px] text-stone-700">Snack</span>
            <p className="font-sans text-[12px] text-stone-400">Apple, string cheese, etc.</p>
          </div>
          <input
            type="checkbox"
            checked={snackActive}
            disabled={saving}
            onChange={(e) => {
              setSnackActive(e.target.checked);
              void save(e.target.checked, extraActive);
            }}
            className="h-5 w-5 rounded border-stone-300 text-stone-800 focus:ring-stone-400"
          />
        </label>
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="font-sans text-[15px] text-stone-700">Extra</span>
            <p className="font-sans text-[12px] text-stone-400">Treat, fruit, custom item</p>
          </div>
          <input
            type="checkbox"
            checked={extraActive}
            disabled={saving}
            onChange={(e) => {
              setExtraActive(e.target.checked);
              void save(snackActive, e.target.checked);
            }}
            className="h-5 w-5 rounded border-stone-300 text-stone-800 focus:ring-stone-400"
          />
        </label>
      </div>
    </div>
  );
}
```

### Task 9 — Audit event type

In `apps/api/src/audit/audit.types.ts`, add:
```typescript
'child.bag_composition_updated',
```

### Task 10 — Update `PLAN_ITEM_COLUMNS`

In `apps/api/src/modules/plans/plans.repository.ts`, add `item_sku_id` to `PLAN_ITEM_COLUMNS`:
```typescript
const PLAN_ITEM_COLUMNS =
  'id, plan_id, child_id, day, slot, recipe_id, item_id, item_sku_id, ingredients, paused_at, replaced_by_plan_id, created_at, updated_at';
```

### Task 11 — Contract + type tests

- `UpdateBagCompositionInputSchema` accepts `{ snack_active: true, extra_active: false }`
- `SnackSkuSchema` round-trips correctly
- `PlanItemRowSchema` parses with `item_sku_id: null` and with a valid UUID

### Task 12 — Typecheck and tests

- `pnpm --filter @hivekitchen/contracts typecheck && pnpm --filter @hivekitchen/contracts test`
- `pnpm --filter @hivekitchen/api typecheck`
- `pnpm --filter @hivekitchen/web typecheck`

---

## Dev Notes

### Read Story 2.12 before implementing children repo changes

Story 2.12 defines the `children` table schema and the `lunch_bag_slots` column structure. The exact column names are critical. Do not guess — read the 2-12 story file and the migration SQL before implementing `updateBagComposition()`.

### Snack SKU allergen evaluation in guardrail

The allergy guardrail currently evaluates ingredients as text strings. Snack SKUs have structured allergen flags (`contains_peanut`, etc.) which are more reliable than text matching. Task 7 adds a separate evaluation path for `item_sku_id` items. The guardrail must import `SnackSkusRepository` to do this. Avoid creating a circular dependency (guardrail → snack SKUs repository → supabase client is fine; guardrail should not import from planner).

### Plan items: which column identifies the content?

- Main slot: `recipe_id IS NOT NULL`, `item_sku_id IS NULL`, `ingredients JSONB` has full ingredient list
- Snack slot: `item_sku_id IS NOT NULL`, `recipe_id IS NULL`, `ingredients` may be empty or contain a single item name
- Extra slot: either `recipe_id` or `item_sku_id`, depending on whether it's recipe-based or item-based

This three-way model is enforced by the planner agent prompt — the LLM is instructed to use the appropriate field per slot type. The API's `plan.compose` tool call validates this.

### Changes are forward-only

"Changes take effect on next plan-generation cycle" means existing current `plan_items` rows are NOT modified. A child who deactivates Snack will still have Snack items in their current week's plan. Only the next generated plan will omit Snack items. This is the intended behavior per FR108.

---

## Project Structure

**New files:**
```
supabase/migrations/20260730000000_create_snack_skus_and_item_sku_id.sql
apps/api/src/modules/plans/snack-skus.repository.ts
apps/web/src/features/children/BagCompositionForm.tsx
apps/web/src/features/children/BagCompositionForm.test.tsx
```

**Modified files:**
```
packages/contracts/src/plan.ts                  + item_sku_id in PlanItemRowSchema; SnackSkuSchema
packages/contracts/src/children.ts (or new)     + BagCompositionSchema, UpdateBagCompositionInputSchema, UpdateBagCompositionResponseSchema
packages/types/src/index.ts                     + BagComposition, UpdateBagCompositionInput, UpdateBagCompositionResponse, SnackSku
apps/api/src/audit/audit.types.ts               + child.bag_composition_updated
apps/api/src/modules/plans/plans.repository.ts  + item_sku_id in PLAN_ITEM_COLUMNS
apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts  + Snack SKU allergen evaluation path
apps/api/src/modules/children/children.repository.ts  + updateBagComposition()
apps/api/src/modules/children/children.routes.ts      + PATCH bag-composition route
apps/api/src/agents/orchestrator.ts             + inject bag composition per-child into prompt context
_bmad-output/implementation-artifacts/sprint-status.yaml  3-20 → ready-for-dev
```

---

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.20 created — ready-for-dev. |

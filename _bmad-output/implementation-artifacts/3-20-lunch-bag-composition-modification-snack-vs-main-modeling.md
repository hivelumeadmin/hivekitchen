# Story 3.20: Lunch Bag Composition Modification + Snack-vs-Main Modeling

Status: done

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

## Tasks / Subtasks — Status

- [x] Task 1 — DB migration: `snack_skus` table + seed rows + `plan_items.item_sku_id` column + `commit_plan()` updated to persist `item_sku_id`.
- [x] Task 2 — Contracts: `SnackSkuSchema` added; `item_sku_id` added to `PlanItemRowSchema`, `PlanItemWriteSchema`, and `PlanComposeItemSchema`. Inferred `SnackSku` exported from `@hivekitchen/types`.
- [x] Task 3 — `SnackSkusRepository` with `findActive(category?)` and `findById(id)`.
- [x] Task 4 — `ChildrenRepository.updateBagComposition()` already implemented in Story 2.12 (with `{snack, extra}` shape). Added a lightweight `findBagCompositionsByHousehold()` for the planner workers; existing PATCH endpoint reused unchanged.
- [x] Task 5 — `PATCH /v1/children/:id/bag-composition` already implemented in Story 2.12. Verified AC #1 satisfied.
- [x] Task 6 — Orchestrator: `PlannerBagComposition` interface + `buildBagCompositionLines()` helper; `planWeek()` takes a 7th optional `bagCompositions` param and renders per-child Snack/Extra ON/OFF lines plus the explicit "skip inactive slots" instruction. Wired into both `plan-generation.job` and `plan-regeneration.job`. Planner prompt bumped to v1.2.0.
- [x] Task 7 — `evaluateSnackSku(sku, declaredAllergens)` exported from `allergy-rules.engine.ts`. Maps declared allergens (incl. `milk`/`gluten` aliases) to FALCPA `contains_*` flags; returns `{ verdict, matched }`. Pure helper consumable by future deeper guardrail integration.
- [x] Task 8 — `BagCompositionForm` (settings-style edit form) + `/app/children/:childId/bag-composition` route mounted via `App` router. Reuses Story 2.12's `useSetBagComposition` hook so the wire shape stays a single source of truth.
- [x] Task 9 — Audit type `child.bag_updated` already exists from Story 2.12; verified PATCH route writes the audit context with old/new composition.
- [x] Task 10 — `PLAN_ITEM_COLUMNS` extended with `item_sku_id`; `buildCommitInput()` propagates `item_sku_id` from `PlanComposeOutput` to `CommitPlanInput`; `plan-regeneration.job`'s `otherDayItems` also forwards `item_sku_id` so day-scope regen preserves SKU references on untouched days.
- [x] Task 11 — Tests: `SnackSkuSchema` round-trip + `PlanItemRowSchema.item_sku_id` parsing in `plan.test.ts`; `evaluateSnackSku` in `allergy-rules.engine.test.ts`; `buildBagCompositionLines` + planWeek injection in `orchestrator.test.ts`; `SnackSkusRepository` (chainable supabase mock); `BagCompositionForm` component test; `buildCommitInput` propagation test for `item_sku_id`.
- [x] Task 12 — Typecheck clean across `contracts`, `types`, `api`, `web` for all Story 3.20 surfaces. Existing pre-Story-3.20 fixtures updated to include `item_sku_id: null` so the new required-output property is satisfied without any runtime behavior change.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Implementation Notes

- **Story spec vs. Story 2.12 reality.** The story 3.20 tasks described a `{snack_active, extra_active}` body shape and a fresh PATCH endpoint. Story 2.12 had already shipped `bag_composition JSONB = {main:true, snack, extra}` with a CHECK constraint and a working PATCH route + `child.bag_updated` audit type. AC #1 is therefore satisfied by existing code; this story adds the snack-vs-main *modeling* (AC #2) and threads bag composition into the planner so inactive slots produce no items. The story spec's explicit instruction "Read Story 2.12 before implementing children repo changes — adjust column names accordingly" was honoured by *not* introducing a parallel `{snack_active, extra_active}` shape.
- **`commit_plan()` updated in the same migration.** Without amending the RPC the new `plan_items.item_sku_id` column would always be `NULL` even when the planner emits a SKU reference. The migration ships an idempotent `CREATE OR REPLACE FUNCTION` that keeps the Story 3.13 archive-on-recommit behaviour and only adds the SKU insert column. No existing call sites had to change.
- **Bag composition load path uses kek=null.** `findBagCompositionsByHousehold()` only reads non-encrypted columns (`id, name, bag_composition`). Both BullMQ workers construct `ChildrenRepository(supabase, null, log)` — they never need the household DEK because they don't decrypt allergens or cultural identifiers.
- **Snack SKU evaluation kept pure.** Task 7 was implemented as a stand-alone exported helper rather than monkey-patching `AllergyGuardrailService`, so the existing engine stays sync + deterministic and the SKU-aware path can be threaded through `PlanItemForGuardrail` in a focused follow-up story without rewriting `evaluate()`.
- **BagCompositionForm vs. BagCompositionCard.** Two distinct components — the card (Story 2.12) renders inline after `AddChildForm.onSuccess` and defaults snack/extra to ON; the form (this story) is a settings-style page reached via `/app/children/:childId/bag-composition` that pre-loads the current composition and confirms the change took effect. They share `useSetBagComposition` so the wire contract has a single source.
- **Saturday/Sunday day enum carryover.** Existing pre-Story-3.20 type errors in `plan-regeneration.job.test.ts` and `brief-state.composer.test.ts` reference `PlanComposeDay`'s mon-fri enum; these are pre-existing and unrelated to this story.

### Completion Notes

- ✅ Migration ships table + seed + column + RPC update in a single forward-only migration.
- ✅ Contracts: `SnackSkuSchema` round-trip + `PlanItemRowSchema.item_sku_id` accepted as null/uuid/missing.
- ✅ Repository: `SnackSkusRepository` covers `findActive` (with category filter), `findById`, and error-propagation paths.
- ✅ Orchestrator: per-child bag composition lines render in the planner user message; explicit "do not produce items for inactive slots" instruction included; both fresh-plan and regeneration paths plumb the same context.
- ✅ Allergy engine: `evaluateSnackSku()` blocks on declared-allergen → contains_* flag matches with `milk→dairy`, `gluten→wheat` aliases.
- ✅ Web: `BagCompositionForm` settings page + `/app/children/:childId/bag-composition` route registered. Component pre-selects supplied initial values and surfaces a status message after save.
- ✅ Audit: existing `child.bag_updated` type covers post-onboarding changes (Story 2.12).

### Test Results

- `pnpm --filter @hivekitchen/contracts test src/plan.test.ts` — 153/153 pass (includes the new `SnackSkuSchema` and `PlanItemRowSchema — item_sku_id` describe blocks).
- `pnpm --filter @hivekitchen/api test src/modules/plans/snack-skus.repository.test.ts src/modules/allergy-guardrail/allergy-rules.engine.test.ts src/agents/orchestrator.test.ts src/jobs/plan-generation.job.test.ts` — 74/74 pass.
- `pnpm --filter @hivekitchen/web test src/features/children/BagCompositionForm.test.tsx` — 4/4 pass.
- `pnpm --filter @hivekitchen/web test src/features/plan/PlanPage.test.tsx src/features/plan/PlanHistoryPage.test.tsx` — 20/20 pass after `item_sku_id: null` fixture additions.
- `pnpm --filter @hivekitchen/contracts typecheck`, `pnpm --filter @hivekitchen/types typecheck`, `pnpm --filter @hivekitchen/web typecheck` — all clean.
- `pnpm --filter @hivekitchen/api typecheck` — Story 3.20 surfaces clean. Pre-existing failures in `day-overrides.repository.test.ts` (Story 3.19, missing argument), `households.routes.test.ts`, `voice.service.test.ts` (`RequestInfo`), `plans.service.test.ts:432` (uncertain verdict missing `reason`), and `brief-state.composer.test.ts:333` (`'sunday'`) are unrelated to this story.

### File List

**New files**

- `supabase/migrations/20260730000000_create_snack_skus_and_item_sku_id.sql`
- `apps/api/src/modules/plans/snack-skus.repository.ts`
- `apps/api/src/modules/plans/snack-skus.repository.test.ts`
- `apps/web/src/features/children/BagCompositionForm.tsx`
- `apps/web/src/features/children/BagCompositionForm.test.tsx`
- `apps/web/src/routes/(app)/child-bag-composition.tsx`

**Modified files**

- `packages/contracts/src/plan.ts` — added `SnackSkuSchema`; added `item_sku_id` to `PlanItemRowSchema`, `PlanItemWriteSchema`, `PlanComposeItemSchema`.
- `packages/contracts/src/plan.test.ts` — added `SnackSkuSchema` round-trip describe block + `PlanItemRowSchema — item_sku_id (Story 3.20)` describe block.
- `packages/types/src/index.ts` — re-exported `SnackSkuSchema` and the `SnackSku` inferred type.
- `apps/api/src/modules/plans/plans.repository.ts` — `PLAN_ITEM_COLUMNS` extended with `item_sku_id`.
- `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts` — added `evaluateSnackSku()` + `FALCPA_FLAG_MAP` + `SnackSkuVerdict` type.
- `apps/api/src/modules/allergy-guardrail/allergy-rules.engine.test.ts` — added `evaluateSnackSku (Story 3.20)` describe block.
- `apps/api/src/modules/children/children.repository.ts` — added `findBagCompositionsByHousehold()` non-decrypting read.
- `apps/api/src/agents/orchestrator.ts` — added `PlannerBagComposition` interface + `buildBagCompositionLines()`; `planWeek()` accepts and renders bag composition lines.
- `apps/api/src/agents/orchestrator.test.ts` — added `buildBagCompositionLines` describe block + planWeek bag-composition injection test.
- `apps/api/src/agents/prompts/planner.prompt.ts` — version bumped from `v1.1.0` to `v1.2.0` for the bag-composition prompt augmentation.
- `apps/api/src/jobs/plan-generation.job.ts` — instantiates `ChildrenRepository`, loads bag compositions, threads them through `planWeek` (initial + retry); `buildCommitInput` propagates `item_sku_id`.
- `apps/api/src/jobs/plan-generation.job.test.ts` — added `item_sku_id` propagation test + extended an existing test to assert `item_sku_id` is omitted when not provided.
- `apps/api/src/jobs/plan-regeneration.job.ts` — same plumbing as plan-generation; `otherDayItems` mapper forwards `item_sku_id` so day-scope regen does not drop SKU references on untouched days.
- `apps/api/src/jobs/plan-regeneration.job.test.ts` — pre-existing fixture updated with `item_sku_id: null`.
- `apps/api/src/modules/plans/brief-state.composer.test.ts` — pre-existing `makeItem` fixture extended with `item_sku_id: null`.
- `apps/api/src/modules/plans/day-overrides.service.test.ts` — pre-existing `planItem` fixture extended with `item_sku_id: null`.
- `apps/api/src/modules/plans/plans.service.test.ts` — three pre-existing `makeItem*` fixtures extended with `item_sku_id: null`.
- `apps/web/src/app.tsx` — registered `/app/children/:childId/bag-composition` route.
- `apps/web/src/features/plan/PlanHistoryPage.test.tsx` — pre-existing `makeItem` fixture extended with `item_sku_id: null`.
- `apps/web/src/features/plan/PlanPage.test.tsx` — two pre-existing `plan_items` fixtures extended with `item_sku_id: null`.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `3-20` set to `review`; `last_updated` bumped.

## Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-05-05 | Menon | Story 3.20 created — ready-for-dev. |
| 2026-05-07 | Menon (code review) | Code review applied: 11 patches (P1–P11) + 3 decision items (DN3 superRefine, DN5 suspension guard, DN6 nav link). DN1/DN2 deferred to deferred-work.md. DN4 accepted (UTC tradeoff documented). Status → done. |
| 2026-05-06 | Menon (Amelia, dev) | Story 3.20 implemented end-to-end. AC #1 was already satisfied by Story 2.12; this commit ships AC #2 (Snack ↔ SKU, Main ↔ recipe modeling), threads per-child bag composition into the planner prompt, adds the snack SKU catalog + repository, augments the allergy guardrail with a structured-flag SKU evaluator, and adds a settings-style web edit surface. Status → review. |

---

### Review Findings

_Code review run 2026-05-06 — 3 layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor)_

#### Decision-Needed

- [x] [Review][Deferred] **DN1 — evaluateSnackSku not wired into guardrail pipeline: snack allergen bypass** — `evaluateSnackSku` is exported and tested but never called from `evaluate()`. Snack-slot items with `item_sku_id` bypass allergen checking entirely since ingredient text like "Apple" won't match declared allergens. Dev notes mark Task 7 as intentionally deferred, but AC2 + FR108/109 imply the guardrail should evaluate snack SKUs. Decide: (a) wire it now, (b) formally defer with story ref. [`apps/api/src/modules/allergy-guardrail/allergy-rules.engine.ts`]
- [x] [Review][Deferred] **DN2 — Planner has no tool or prompt instruction to populate `item_sku_id` on snack rows** — The planner receives ON/OFF slot signals via `buildBagCompositionLines` but no snack catalog tool exists in `TOOL_MANIFEST` and `PLANNING_CORE` (v1.2.0) contains no instruction to emit `item_sku_id`. Snack rows will be composed with `item_sku_id = null`. Decide: (a) add `snack.search` tool + prompt instruction now, (b) defer with story ref — AC2 is partially satisfied by schema only. [`apps/api/src/agents/orchestrator.ts`, `apps/api/src/agents/prompts/planner.prompt.ts`]
- [x] [Review][Applied] **DN3 — No schema or runtime enforcement that snack rows use `item_sku_id` and main rows use `recipe_id`** — `PlanComposeItemSchema` and `PlanItemWriteSchema` make both fields fully optional on all slots. Nothing rejects a main-slot item carrying `item_sku_id` or a snack item with neither. Decide: (a) add `.superRefine()` cross-field validation per slot, (b) defer — enforce via planner prompt and audit only. [`packages/contracts/src/plan.ts:152–167`]
- [x] [Review][Accepted] **DN4 — `override_date` validation uses UTC server clock; rejects valid same-day overrides for UTC+ households** — `SetDayOverrideInputSchema`'s `.refine()` computes `new Date().toISOString().slice(0,10)` (UTC) at parse time. A UTC+12 parent at 01:00 Tuesday (local) sends `override_date = TUESDAY` but the server sees Monday UTC and rejects it. `deriveOverrideDate` on the frontend uses local time. Decide: (a) accept and document the UTC-boundary tradeoff, (b) pass `client_timezone` in the request body and validate in household-local time. [`packages/contracts/src/day-override.ts`, `apps/web/src/features/plan/DisambiguationPicker.tsx`]
- [x] [Review][Applied] **DN5 — `revertOverride` unconditionally un-pauses the slot, clearing independent Story 3.12 day-pauses** — When reverting a `bag_suspended` or `sick_day` override, `unpauseItemById` is called even if the slot was also paused by a separate user action (the Story 3.12 `pauseDay` flow). The Story 3.12 pause is silently cleared with no audit trail entry. Decide: (a) acceptable — override revert implies full slot restore, (b) check whether a `pauseDay` record also exists before unpause. [`apps/api/src/modules/plans/day-overrides.service.ts`]
- [x] [Review][Applied] **DN6 — No navigation path from the existing UI to `/app/children/:childId/bag-composition`** — The route is registered in `app.tsx` but no link, button, or menu item in the codebase routes to it. The form is unreachable except by direct URL. Decide: (a) add a settings link from the child profile or plan tile (required for AC1), (b) intentionally accessible by deep link only for this sprint. [`apps/web/src/app.tsx`]

#### Patch

- [x] [Review][Applied] **P1 — `setOverride` partial failure: slot paused with no override row (stuck permanently)** — `pauseItemById` succeeds before `repo.upsert` is called. If `upsert` throws, the slot's `paused_at` is set but no `day_overrides` row exists. `revertOverride` requires a valid `overrideId` so the parent can never undo the pause. Fix: swap execution order (upsert first, then pause) or wrap in a transaction. [`apps/api/src/modules/plans/day-overrides.service.ts`]
- [x] [Review][Applied] **P2 — `revertOverride` stuck-pause: `repo.revert` succeeds but `unpauseItemById` throws** — If DB fails after `repo.revert` marks the override as reverted, the override row is gone but the slot remains paused. A subsequent retry 404s (row already reverted), leaving the slot stuck. Fix: catch `unpauseItemById` error and surface it as a 500, or perform both writes in one transaction. [`apps/api/src/modules/plans/day-overrides.service.ts`]
- [x] [Review][Applied] **P3 — `deriveOverrideDate` computes previous week when called on Sunday** — `todayDow === 0 ? 6 : todayDow - 1` sets `daysSinceMonday = 6` on Sunday, deriving last week's Monday. All resulting override dates are in the past and fail the server's date validation. Fix: Sunday should map to the upcoming week's Monday (add 1 day) or the current week's Mon–Sat should be disabled on Sunday. [`apps/web/src/features/plan/DisambiguationPicker.tsx:685–690`]
- [x] [Review][Applied] **P4 — `findByIdForPresentation` excludes non-guardrail-cleared plans; valid overrides return 404 during the async guardrail window** — The query filters `.not('guardrail_cleared_at', 'is', null)`. A freshly-regenerated plan not yet cleared will cause every `setOverride` call to 404 for seconds to minutes. Fix: load the plan directly without the guardrail-cleared filter for the override path (ownership + existence check is sufficient), or use a separate lighter-weight `findPlanById` query. [`apps/api/src/modules/plans/day-overrides.service.ts:71`]
- [x] [Review][Applied] **P5 — `SnackSkusRepository.findById` does not filter `is_active`; retired SKUs reach the guardrail** — A deactivated SKU (`is_active = false`) still resolves for existing `plan_items.item_sku_id` references. The guardrail would evaluate stale allergen flags. Fix: add `.eq('is_active', true)` to `findById`, or return the full row and let callers decide based on `is_active`. [`apps/api/src/modules/plans/snack-skus.repository.ts`]
- [x] [Review][Applied] **P6 — `PlanAdjustmentService.triggerAdjustment` swallows `findActiveFuturePlanIds` DB errors as "no regen"** — A DB failure returns `{ plansQueued: 0, enqueuedPlanIds: [], failedPlanIds: [] }` and logs at error level, but `SchoolPoliciesService` returns `regenerationTriggered: false` to the HTTP caller, masking the failure. Fix: propagate the error or include a `dbError` flag in the return type. [`apps/api/src/modules/plans/plan-adjustment.service.ts`]
- [x] [Review][Applied] **P7 — `loadCulturalContext` and `loadBagCompositions` duplicated verbatim in both job files** — Character-for-character identical closures across `plan-generation.job.ts` and `plan-regeneration.job.ts`. A fix to either must be manually applied to both. Fix: extract to `apps/api/src/jobs/planner-context.loader.ts` and import. [`apps/api/src/jobs/plan-generation.job.ts:130–176`, `apps/api/src/jobs/plan-regeneration.job.ts:51–101`]
- [x] [Review][Applied] **P8 — `SnackSkusRepository` is instantiated and tested but never registered in any Fastify decorator or plugin** — Nothing in `plans.hook.ts`, `app.ts`, or any service consumes it at runtime. Fix: decorate it via `plansHook` (alongside `PlansRepository`) or at minimum wire it into the job files that will eventually call `evaluateSnackSku`. [`apps/api/src/modules/plans/snack-skus.repository.ts`]
- [x] [Review][Applied] **P9 — `TOOL_MANIFEST` global mutation in orchestrator tests leaks between suites** — `planWeek cultural context injection` tests call `TOOL_MANIFEST.set('plan.compose', { fn: vi.fn() })` without restoring the original in an `afterEach`. Any downstream suite consuming the real `plan.compose` handler silently gets the mock. Fix: save original spec in `beforeEach` and restore in `afterEach`. [`apps/api/src/agents/orchestrator.test.ts:202–205, 250–253, 297–300`]
- [x] [Review][Applied] **P10 — `useSchoolPolicies` discards valid data on reload: `setPolicies([])` called before fetch resolves** — If the reload fetch fails, `policies` is left empty (stale data discarded). Fix: move `setPolicies([])` to the success branch only, so a failed reload preserves the previously-loaded list alongside the error banner. [`apps/web/src/hooks/useSchoolPolicies.ts:929`]
- [x] [Review][Applied] **P11 — Dead `?name=` query param in `child-bag-composition.tsx` — unset by any navigator, potential trust issue** — `searchParams.get('name')` is used as the display heading but no navigation path sets this param. The fallback `child.name` from the API is always used. Fix: remove the `searchParams.get('name')` path entirely and always derive from the API response. [`apps/web/src/routes/(app)/child-bag-composition.tsx:59`]

#### Deferred

- [x] [Review][Defer] **W1 — `DayOverridesRepository.upsert` conflict-update doesn't re-assert `household_id`** [`apps/api/src/modules/plans/day-overrides.repository.ts`] — deferred; `plan_item_id` is a UUID scoped to the FK chain; cross-household collision requires UUID collision (practically impossible). Revisit if any non-FK-constrained uniqueness is ever added.
- [x] [Review][Defer] **W2 — `PlanAdjustmentService` dedup `jobId` excludes `slotScope`; two rapid policy changes with different slot scopes collapse to one job with misleading audit metadata** [`apps/api/src/modules/plans/plan-adjustment.service.ts`] — deferred; regen is week-scope superset so correctness is unaffected; audit metadata gap is cosmetic.
- [x] [Review][Defer] **W3 — Composition-changing override shows stale plan items until async regen lands** [`apps/api/src/modules/plans/day-overrides.service.ts`] — deferred; by design — regen is async; an in-flight indicator is out of scope for this story.
- [x] [Review][Defer] **W4 — `DayOverridesService.setOverride` silently skips regen when `plan.week_of` is null** [`apps/api/src/modules/plans/day-overrides.service.ts:144`] — deferred; `week_of` is NOT NULL at schema level; guard is defensive. Add explicit throw if the invariant ever breaks.
- [x] [Review][Defer] **W5 — `DayOverridesRepository.revertExpired` bulk UPDATE has no row limit** [`apps/api/src/modules/plans/day-overrides.repository.ts:121`] — deferred; low daily volume in practice; add chunking if post-outage sweep latency is ever observed.

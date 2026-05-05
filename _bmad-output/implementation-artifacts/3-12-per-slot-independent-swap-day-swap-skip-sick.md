# Story 3.12: Per-slot independent swap + day-swap + skip/sick

Status: done

## Story

As a Primary Parent or Secondary Caregiver,
I want to edit any day's plan by swapping individual slots independently, swapping with another day's plan, or marking the day skip/sick,
So that I can adjust without re-planning the whole week (FR18, FR20).

## Acceptance Criteria

1. **Given** Story 3.9 is complete,
   **When** I tap a slot and select an alternative (or tap "Skip"),
   **Then** `PATCH /v1/plans/:planId/items/:itemId` fires with `Idempotency-Key`; non-allergen swaps optimistic with rollback (Safety-Classified Field Model); allergen-affecting swaps render pending until guardrail confirms (FR79).

2. **And** sick-day pause stops Lunch Link delivery without altering the underlying plan (FR20); `plan_items` rows for that day mark `paused_at`.

## Dependencies & Context

**Already implemented (do NOT re-implement):**
- Story 3.5: `PlansRepository.commit()`, `PlanRowSchema`, `PlanItemRowSchema`, `CommitPlanInputSchema`
- Story 3.6: `BriefStateRepository`, `BriefStateComposer.refresh()`, `BriefStateRowSchema`, `GET /v1/households/:id/brief`
- Story 3.7: `PlansService.commit()`, allergy guardrail integration, BullMQ plan generation
- Story 3.9: `PlanTile` component with all states (decided, pending-input, swap-in-progress, locked, mutability-frozen)
- Story 3.11: `ScaffoldingDiffSchema`, `BriefStateRowSchema.scaffolding_diff`, `QuietDiff` component â€” composer writes `scaffolding_diff: null` until this story

**Key invariants from previous stories:**
- `allergyGuardrail.evaluate(items, householdId)` takes an array of `PlanItemForGuardrail` â€” pass the single swapped item for per-slot validation
- `briefStateComposer.refresh()` MUST NOT throw â€” it swallows its own errors
- Presentation layer always reads `WHERE guardrail_cleared_at IS NOT NULL`
- `hkFetch` does not run Zod parsing on responses â€” `brief.plan_id` and `brief.plan_tile_summaries[i].items[j].plan_item_id` will be `undefined` on pre-migration cached rows; guard with `?.`
- Logical-property lint rule (`hivekitchen/logical-properties-only`): `start-*`/`end-*`, `ps-*`/`pe-*`, `ms-*`/`me-*` â€” no `left-*`/`right-*`/`pl-*`/`pr-*`/`ml-*`/`mr-*`
- No `framer-motion` â€” Tailwind animation utilities only
- No `aria-modal={false}` on non-modal disclosures â€” omit the attribute entirely (Story 3.11 review patch)

---

## Tasks / Subtasks

### Task 1 â€” DB Migrations (3 files)

#### Task 1a â€” Add `paused_at` to `plan_items`

- [x] Create `supabase/migrations/20260621000000_add_paused_at_to_plan_items.sql`:

  ```sql
  -- Story 3.12: sick-day pause. NULL = active; non-NULL = paused at that timestamp.
  -- Pausing does NOT alter plan ingredients â€” the slot remains intact for Lunch Link
  -- context and future un-pause. Lunch Link delivery (Epic 4) reads paused_at to skip.
  ALTER TABLE plan_items
    ADD COLUMN paused_at TIMESTAMPTZ DEFAULT NULL;
  ```

#### Task 1b â€” Add audit event types

- [x] Create `supabase/migrations/20260621000100_add_plan_swap_pause_audit_types.sql`:

  ```sql
  -- Story 3.12: parent-initiated plan mutation events.
  ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.item_swapped';
  ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.day_paused';
  ```

#### Task 1c â€” Add `plan_id` to `brief_state`

- [x] Create `supabase/migrations/20260621000200_add_plan_id_to_brief_state.sql`:

  ```sql
  -- Story 3.12: expose plan_id in brief_state so the client can call
  -- PATCH /v1/plans/:planId/items/:itemId without a separate plan lookup.
  -- Nullable DEFAULT NULL so existing rows parse cleanly before next composer refresh.
  ALTER TABLE brief_state
    ADD COLUMN plan_id UUID DEFAULT NULL REFERENCES plans(id) ON DELETE SET NULL;
  ```

---

### Task 2 â€” Contracts: update and add schemas

In `packages/contracts/src/plan.ts`, make the following additions **in document order** (each builds on the previous):

#### Task 2a â€” Add `plan_item_id` to `PlanTileItemSchema`

Replace the existing `PlanTileItemSchema` (the internal `const`, not exported):

```typescript
// PlanTileItemSchema is the per-child-slot entry within a day's tile.
// plan_item_id is the plan_items.id from the DB â€” Story 3.12 exposes it so the
// client can call PATCH /v1/plans/:planId/items/:itemId without a separate lookup.
// Optional because pre-3.12 brief_state rows will not have it in their JSON.
const PlanTileItemSchema = z.object({
  plan_item_id: z.string().uuid().optional(),  // Story 3.12 â€” DB row id for PATCH
  child_id: z.string().uuid(),
  slot: z.string().min(1).max(SLOT_MAX),
  ingredients: z.array(z.string().min(1)),
  recipe_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
});
```

#### Task 2b â€” Add `paused` to `PlanTileSummarySchema`

Replace the existing `PlanTileSummarySchema`:

```typescript
export const PlanTileSummarySchema = z.object({
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
  items: z.array(PlanTileItemSchema),
  paused: z.boolean().default(false),  // Story 3.12: true when all items for the day are paused
});
```

#### Task 2c â€” Add `plan_id` to `BriefStateRowSchema`

Add `plan_id` between `household_id` and `moment_headline`:

```typescript
export const BriefStateRowSchema = z.object({
  household_id: z.string().uuid(),
  plan_id: z.string().uuid().nullable().default(null),  // Story 3.12 â€” null for pre-migration rows
  moment_headline: z.string(),
  lumi_note: z.string(),
  memory_prose: z.string(),
  plan_tile_summaries: z.array(PlanTileSummarySchema),
  cleared_allergies: z.array(ClearedAllergyEntrySchema).default([]),
  scaffolding_diff: ScaffoldingDiffSchema.nullable().default(null),
  generated_at: z.string().datetime(),
  plan_revision: z.number().int().min(0),
  updated_at: z.string().datetime(),
});
```

#### Task 2d â€” Update `PlanItemRowSchema` with `paused_at`

Add `paused_at` between `ingredients` and `created_at`:

```typescript
export const PlanItemRowSchema = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  child_id: z.string().uuid(),
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
  slot: z.string().min(1).max(SLOT_MAX),
  recipe_id: z.string().uuid().nullable(),
  item_id: z.string().uuid().nullable(),
  ingredients: z.array(z.string().min(1)),
  paused_at: z.string().datetime().nullable().default(null),  // Story 3.12
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
```

#### Task 2e â€” Add `SwapPlanItemInputSchema`

Add after `PlanItemRowSchema`:

```typescript
// PATCH /v1/plans/:planId/items/:itemId body.
// ingredients replaces the existing set in full â€” client owns the complete replacement list.
// recipe_id / item_id are optional until recipe resolution lands in a future story.
export const SwapPlanItemInputSchema = z.object({
  ingredients: z
    .array(z.string().min(1).max(INGREDIENT_MAX))
    .min(1)
    .max(INGREDIENTS_MAX),
  recipe_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
});
```

#### Task 2f â€” Add `SwapPlanItemResponseSchema`

```typescript
export const SwapPlanItemResponseSchema = z.object({
  item: PlanItemRowSchema,
});
```

#### Task 2g â€” Add `PausePlanDayInputSchema`

```typescript
// PATCH /v1/plans/:planId/days/:day/pause body.
// reason is informational for audit; Lunch Link delivery (Epic 4) reads paused_at, not reason.
export const PausePlanDayInputSchema = z.object({
  reason: z.enum(['sick', 'absent', 'holiday']).optional(),
});
```

---

### Task 3 â€” Types: export new schemas

In `packages/types/src/index.ts`, add to the imports from `'@hivekitchen/contracts'`:

```typescript
SwapPlanItemInputSchema,
SwapPlanItemResponseSchema,
PausePlanDayInputSchema,
```

And add type exports (below the existing plan-related exports):

```typescript
// Story 3.12 â€” plan swap + pause mutation types
export type SwapPlanItemInput = z.infer<typeof SwapPlanItemInputSchema>;
export type SwapPlanItemResponse = z.infer<typeof SwapPlanItemResponseSchema>;
export type PausePlanDayInput = z.infer<typeof PausePlanDayInputSchema>;
```

> `PlanTileSummary`, `PlanTileItem`, `BriefStateRow`, and `PlanItemRow` types update automatically via `z.infer` â€” no manual re-export needed for those.

---

### Task 4 â€” Audit event types

In `apps/api/src/audit/audit.types.ts`, add to the `// plan` section of `AUDIT_EVENT_TYPES`:

```typescript
'plan.item_swapped',
'plan.day_paused',
```

> These mirror the enum values added in migration Task 1b. The test in `audit.types.test.ts` validates that `AUDIT_EVENT_TYPES` matches the Postgres `audit_event_type` enum â€” it will fail if the migration and this file are out of sync.

---

### Task 5 â€” PlansRepository: additions

In `apps/api/src/modules/plans/plans.repository.ts`:

#### Task 5a â€” Update `PLAN_ITEM_COLUMNS`

```typescript
const PLAN_ITEM_COLUMNS =
  'id, plan_id, child_id, day, slot, recipe_id, item_id, ingredients, paused_at, created_at, updated_at';
```

#### Task 5b â€” Add `findItemById()`

```typescript
// Fetch a single plan_item by id within a given plan.
// Household ownership is validated at the service layer by loading the plan
// via findByIdForPresentation (household_id WHERE clause) â€” not duplicated here.
async findItemById(opts: {
  itemId: string;
  planId: string;
}): Promise<PlanItemRow | null> {
  const { data, error } = await this.client
    .from('plan_items')
    .select(PLAN_ITEM_COLUMNS)
    .eq('id', opts.itemId)
    .eq('plan_id', opts.planId)
    .maybeSingle();
  if (error) throw error;
  return (data as PlanItemRow | null) ?? null;
}
```

#### Task 5c â€” Add `updateItemIngredients()`

```typescript
async updateItemIngredients(opts: {
  itemId: string;
  planId: string;
  ingredients: string[];
  recipeId?: string;
  itemSlotId?: string;  // maps to plan_items.item_id; named itemSlotId to avoid shadowing opts.itemId
}): Promise<PlanItemRow> {
  const patch: Record<string, unknown> = {
    ingredients: opts.ingredients,
    updated_at: new Date().toISOString(),
  };
  if (opts.recipeId !== undefined) patch.recipe_id = opts.recipeId;
  if (opts.itemSlotId !== undefined) patch.item_id = opts.itemSlotId;

  const { data, error } = await this.client
    .from('plan_items')
    .update(patch)
    .eq('id', opts.itemId)
    .eq('plan_id', opts.planId)
    .select(PLAN_ITEM_COLUMNS)
    .single();
  if (error) throw error;
  return data as PlanItemRow;
}
```

#### Task 5d â€” Add `pauseDay()`

```typescript
// Sets paused_at on ALL items for a given day. Partial-child pausing (one child
// sick, another not) is deferred â€” Story 3.12 treats pause as a full-day operation.
async pauseDay(opts: {
  planId: string;
  day: string;
  pausedAt: string;
}): Promise<void> {
  const { error } = await this.client
    .from('plan_items')
    .update({ paused_at: opts.pausedAt, updated_at: new Date().toISOString() })
    .eq('plan_id', opts.planId)
    .eq('day', opts.day);
  if (error) throw error;
}
```

---

### Task 6 â€” PlansService: swapItem + pauseDay

In `apps/api/src/modules/plans/plans.service.ts`:

**Add to imports:**
```typescript
import { GUARDRAIL_VERSION } from '../allergy-guardrail/allergy-rules.engine.js';
import { GuardrailRejectionError, NotFoundError, SwapGuardrailBlockedError } from '../../common/errors.js';
import type {
  BriefStateRow,
  CommitPlanInput,
  GuardrailResult,
  PlanComposeInput,
  PlanComposeOutput,
  PlanItemForGuardrail,
  PlanItemRow,
  SwapPlanItemInput,
} from '@hivekitchen/types';
```

> `SwapGuardrailBlockedError` and `NotFoundError` are added in Task 7.

#### Task 6a â€” Add `swapItem()`

```typescript
// Per-slot ingredient swap with guardrail validation.
// Runs allergyGuardrail.evaluate on ONLY the swapped item (the rest of the plan
// was cleared at generation time and is unchanged). On guardrail block â†’ 422.
// On success â†’ brief_state projection refreshed (userInitiated:true â†’ scaffolding_diff null).
async swapItem(opts: {
  planId: string;
  itemId: string;
  householdId: string;
  input: SwapPlanItemInput;
  requestId: string;
}): Promise<PlanItemRow> {
  // 1. Load plan â€” validates household ownership via findByIdForPresentation.
  const plan = await this.repo.findByIdForPresentation({
    planId: opts.planId,
    householdId: opts.householdId,
  });
  if (!plan) throw new NotFoundError('plan', opts.planId);

  // 2. Load item â€” validates it belongs to this plan.
  const existingItem = await this.repo.findItemById({
    itemId: opts.itemId,
    planId: opts.planId,
  });
  if (!existingItem) throw new NotFoundError('plan_item', opts.itemId);

  // 3. Guardrail: check only the swapped item's new ingredients.
  const guardrailItem: PlanItemForGuardrail = {
    child_id: existingItem.child_id,
    day: existingItem.day,
    slot: existingItem.slot,
    ingredients: opts.input.ingredients,
  };
  const result = await this.allergyGuardrail.evaluate(
    [guardrailItem],
    opts.householdId,
  );

  if (result.verdict === 'blocked' || result.verdict === 'uncertain') {
    const allergens =
      result.verdict === 'blocked'
        ? result.conflicts.map((c) => c.allergen)
        : [];
    try {
      await this.auditService.write({
        event_type: 'allergy.guardrail_rejection',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          plan_id: opts.planId,
          item_id: opts.itemId,
          source: 'user_swap',
          verdict: result.verdict,
          allergens,
        },
      });
    } catch (auditErr) {
      this.logger.error({ auditErr }, 'audit write failed for swap guardrail rejection');
    }
    throw new SwapGuardrailBlockedError(opts.itemId, allergens);
  }

  // 4. Commit the ingredient update.
  const updatedItem = await this.repo.updateItemIngredients({
    itemId: opts.itemId,
    planId: opts.planId,
    ingredients: opts.input.ingredients,
    recipeId: opts.input.recipe_id,
    itemSlotId: opts.input.item_id,
  });

  // 5. Refresh brief_state projection. userInitiated:true â†’ scaffolding_diff stays null.
  await this.briefStateComposer.refresh(
    opts.householdId,
    plan.week_id,
    opts.requestId,
    { userInitiated: true },
  );

  // 6. Audit the successful swap.
  try {
    await this.auditService.write({
      event_type: 'plan.item_swapped',
      household_id: opts.householdId,
      request_id: opts.requestId,
      metadata: {
        plan_id: opts.planId,
        item_id: opts.itemId,
        day: existingItem.day,
        slot: existingItem.slot,
        new_ingredients: opts.input.ingredients,
        guardrail_version: GUARDRAIL_VERSION,
      },
    });
  } catch (err) {
    this.logger.error(
      { err, plan_id: opts.planId, item_id: opts.itemId },
      'audit write failed after item swap â€” swap committed',
    );
  }

  return updatedItem;
}
```

#### Task 6b â€” Add `pauseDay()`

```typescript
// Sick-day pause: marks paused_at on all plan_items for the day.
// The underlying plan is unchanged â€” ingredients are preserved for Lunch Link context.
async pauseDay(opts: {
  planId: string;
  day: string;
  householdId: string;
  requestId: string;
}): Promise<void> {
  // 1. Validate plan ownership.
  const plan = await this.repo.findByIdForPresentation({
    planId: opts.planId,
    householdId: opts.householdId,
  });
  if (!plan) throw new NotFoundError('plan', opts.planId);

  // 2. Pause all items for the day.
  const pausedAt = new Date().toISOString();
  await this.repo.pauseDay({ planId: opts.planId, day: opts.day, pausedAt });

  // 3. Refresh brief_state â€” paused field will propagate to PlanTileSummary.
  await this.briefStateComposer.refresh(
    opts.householdId,
    plan.week_id,
    opts.requestId,
    { userInitiated: true },
  );

  // 4. Audit.
  try {
    await this.auditService.write({
      event_type: 'plan.day_paused',
      household_id: opts.householdId,
      request_id: opts.requestId,
      metadata: { plan_id: opts.planId, day: opts.day, paused_at: pausedAt },
    });
  } catch (err) {
    this.logger.error(
      { err, plan_id: opts.planId },
      'audit write failed after day pause â€” pause committed',
    );
  }
}
```

---

### Task 7 â€” Error types

In `apps/api/src/common/errors.ts`, add after `GuardrailRejectionError`:

```typescript
export class SwapGuardrailBlockedError extends DomainError {
  readonly type = '/errors/swap-guardrail-blocked';
  readonly status = 422;
  readonly title = 'Swap blocked by allergy guardrail';
  constructor(itemId: string, allergens: string[]) {
    super(
      allergens.length > 0
        ? `Item ${itemId} swap blocked: would introduce ${allergens.join(', ')}`
        : `Item ${itemId} swap blocked: guardrail evaluation inconclusive`,
    );
  }
}
```

---

### Task 8 â€” Plans routes + app registration

#### Task 8a â€” Create `apps/api/src/modules/plans/plans.routes.ts`

```typescript
import fp from 'fastify-plugin';
import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import {
  PausePlanDayInputSchema,
  SwapPlanItemInputSchema,
  SwapPlanItemResponseSchema,
} from '@hivekitchen/contracts';
import type { PausePlanDayInput, SwapPlanItemInput } from '@hivekitchen/types';
import { ValidationError } from '../../common/errors.js';
import { authorize } from '../../middleware/authorize.hook.js';

// Idempotency-Key: UUIDv4 format, max 128 chars (architecture Â§Idempotency).
// Full Redis replay-cache deferred to a later story â€” see deferred-work.md.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_MAX = 128;

function requireIdempotencyKey(raw: unknown): string {
  if (!raw || typeof raw !== 'string') {
    throw new ValidationError('Idempotency-Key header is required');
  }
  const trimmed = raw.trim();
  if (!UUID_RE.test(trimmed) || trimmed.length > IDEMPOTENCY_KEY_MAX) {
    throw new ValidationError(
      'Idempotency-Key must be a valid UUID (max 128 chars)',
    );
  }
  return trimmed;
}

const plansRoutesPlugin: FastifyPluginAsync = async (fastify) => {
  const requireMember = authorize(['primary_parent', 'secondary_caregiver']);

  // PATCH /v1/plans/:planId/items/:itemId
  // Per-slot ingredient swap. Runs allergyGuardrail.evaluate on the new item only.
  // Returns 200 { item } on success; 422 if guardrail blocks; 404 if plan/item not found.
  fastify.patch(
    '/v1/plans/:planId/items/:itemId',
    {
      preHandler: requireMember,
      schema: {
        params: z.object({
          planId: z.string().uuid(),
          itemId: z.string().uuid(),
        }),
        body: SwapPlanItemInputSchema,
        response: { 200: SwapPlanItemResponseSchema },
      },
    },
    async (request, reply) => {
      const requestId = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const { planId, itemId } = request.params as {
        planId: string;
        itemId: string;
      };
      const body = request.body as SwapPlanItemInput;

      const updatedItem = await fastify.plansService.swapItem({
        planId,
        itemId,
        householdId: request.user.household_id,
        input: body,
        requestId,
      });

      return reply.status(200).send({ item: updatedItem });
    },
  );

  // PATCH /v1/plans/:planId/days/:day/pause
  // Sick-day pause. Sets paused_at on all plan_items for the day.
  // Returns 204. Idempotent (re-pausing already-paused day is a no-op at DB level).
  fastify.patch(
    '/v1/plans/:planId/days/:day/pause',
    {
      preHandler: requireMember,
      schema: {
        params: z.object({
          planId: z.string().uuid(),
          day: z.enum([
            'monday',
            'tuesday',
            'wednesday',
            'thursday',
            'friday',
            'saturday',
          ]),
        }),
        body: PausePlanDayInputSchema,
      },
    },
    async (request, reply) => {
      const requestId = requireIdempotencyKey(
        request.headers['idempotency-key'],
      );
      const { planId, day } = request.params as {
        planId: string;
        day: string;
      };

      await fastify.plansService.pauseDay({
        planId,
        day,
        householdId: request.user.household_id,
        requestId,
      });

      return reply.status(204).send();
    },
  );
};

export const plansRoutes = fp(plansRoutesPlugin, { name: 'plans-routes' });
```

#### Task 8b â€” Register in `apps/api/src/app.ts`

Add import (with existing plan imports):
```typescript
import { plansRoutes } from './modules/plans/plans.routes.js';
```

Add registration after line 161 (`await app.register(householdsRoutes);`):
```typescript
await app.register(plansRoutes);
```

---

### Task 9 â€” BriefStateComposer: buildScaffoldingDiff + plan_id + paused tiles

In `apps/api/src/modules/plans/brief-state.composer.ts`:

#### Task 9a â€” Add imports

Add `ScaffoldingDiff` and `BriefStateRow` to the `@hivekitchen/types` import block:
```typescript
import type {
  BriefStateRow,
  ClearedAllergyEntry,
  PlanItemRow,
  PlanTileSummary,
  ScaffoldingDiff,
} from '@hivekitchen/types';
```

#### Task 9b â€” Update `refresh()` signature

```typescript
async refresh(
  householdId: string,
  weekId: string,
  requestId: string,
  opts: { userInitiated?: boolean } = {},
): Promise<void>
```

#### Task 9c â€” Inside `refresh()`: read previous brief_state before upsert

After the `if (!plan)` early-return, add:
```typescript
// Read the current brief_state BEFORE overwriting â€” needed to compute scaffolding_diff.
// findByHousehold is already called inside briefStateRepo.upsert() for revision guard;
// this second read adds one extra round-trip per refresh. Acceptable at MVP scale.
const previousBrief = await this.briefStateRepo.findByHousehold(householdId);
const previousTileSummaries = previousBrief?.plan_tile_summaries ?? null;
```

#### Task 9d â€” Update `upsertInput` to include `plan_id` and computed `scaffolding_diff`

```typescript
const currentItems = items;  // alias for clarity in buildScaffoldingDiff
const upsertInput: BriefStateUpsertInput = {
  household_id: householdId,
  plan_id: plan.id,
  moment_headline: '',
  lumi_note: '',
  memory_prose: '',
  plan_tile_summaries: this.buildTileSummaries(currentItems),
  cleared_allergies: this.buildClearedAllergies(currentItems, children),
  scaffolding_diff: this.buildScaffoldingDiff(
    previousTileSummaries,
    currentItems,
    opts.userInitiated ?? false,
  ),
  generated_at: plan.generated_at,
  plan_revision: plan.revision,
};
```

#### Task 9e â€” Update `buildTileSummaries()` to include `plan_item_id` and `paused`

Replace the existing private method:

```typescript
private buildTileSummaries(items: PlanItemRow[]): PlanTileSummary[] {
  const byDay = new Map<
    SchoolDay,
    { items: PlanTileSummary['items']; pausedCount: number }
  >();

  for (const item of items) {
    if (!SCHOOL_DAYS.includes(item.day as SchoolDay)) continue;
    const day = item.day as SchoolDay;
    const entry = byDay.get(day) ?? { items: [], pausedCount: 0 };
    entry.items.push({
      plan_item_id: item.id,   // Story 3.12: DB row id for PATCH URL
      child_id: item.child_id,
      slot: item.slot,
      ingredients: item.ingredients,
      ...(item.recipe_id != null ? { recipe_id: item.recipe_id } : {}),
      ...(item.item_id != null ? { item_id: item.item_id } : {}),
    });
    if (item.paused_at != null) entry.pausedCount++;
    byDay.set(day, entry);
  }

  return SCHOOL_DAYS.filter((day) => byDay.has(day)).map((day) => {
    const entry = byDay.get(day)!;
    return {
      day,
      items: entry.items,
      // paused:true only when every item in the day is paused (full sick day).
      // Partial-child pause (one child sick, another not) is deferred.
      paused:
        entry.items.length > 0 && entry.pausedCount === entry.items.length,
    };
  });
}
```

#### Task 9f â€” Add `buildScaffoldingDiff()` private method

```typescript
// Detects ingredient-level changes between the previous brief_state tile summaries
// and the current plan items. Returns non-null ONLY for system-initiated (Lumi-authored)
// scaffolding mutations. User-initiated swaps always return null â€” the parent knows
// what they changed; surfacing it in QuietDiff would be redundant noise (UX-DR19).
//
// "Scaffolding-level" = same constraint profile (slot, child), different ingredients.
// Safety/allergen changes are blocked by the guardrail before reaching the composer.
private buildScaffoldingDiff(
  previousTileSummaries: PlanTileSummary[] | null,
  currentItems: PlanItemRow[],
  userInitiated: boolean,
): ScaffoldingDiff | null {
  if (userInitiated) return null;
  if (!previousTileSummaries || previousTileSummaries.length === 0) return null;

  const currentSummaries = this.buildTileSummaries(currentItems);
  const changes: string[] = [];

  for (const prev of previousTileSummaries) {
    const curr = currentSummaries.find((s) => s.day === prev.day);
    if (!curr) continue;
    for (const prevItem of prev.items) {
      const currItem = curr.items.find(
        (i) => i.child_id === prevItem.child_id && i.slot === prevItem.slot,
      );
      if (!currItem) continue;
      const prevSet = new Set(prevItem.ingredients);
      const currSet = new Set(currItem.ingredients);
      const hasChange =
        currItem.ingredients.some((i) => !prevSet.has(i)) ||
        prevItem.ingredients.some((i) => !currSet.has(i));
      if (hasChange) {
        const day =
          prev.day.charAt(0).toUpperCase() + prev.day.slice(1);
        changes.push(`${day}'s ${prevItem.slot} updated`);
      }
    }
  }

  if (changes.length === 0) return null;
  return {
    summary:
      changes.length === 1
        ? changes[0]!
        : `${String(changes.length)} changes this week`,
    explanation: changes.length > 1 ? changes.join('; ') : undefined,
  };
}
```

#### Task 9g â€” Update `BriefStateUpsertInput` in `brief-state.repository.ts`

Add `plan_id: string | null` to the interface:
```typescript
export interface BriefStateUpsertInput {
  household_id: string;
  plan_id: string | null;  // Story 3.12
  moment_headline: string;
  lumi_note: string;
  memory_prose: string;
  plan_tile_summaries: PlanTileSummary[];
  cleared_allergies: ClearedAllergyEntry[];
  scaffolding_diff: ScaffoldingDiff | null;
  generated_at: string;
  plan_revision: number;
}
```

Update `BRIEF_STATE_COLUMNS`:
```typescript
const BRIEF_STATE_COLUMNS =
  'household_id, plan_id, moment_headline, lumi_note, memory_prose, plan_tile_summaries, cleared_allergies, scaffolding_diff, generated_at, plan_revision, updated_at';
```

---

### Task 10 â€” hkFetch: custom headers

In `apps/web/src/lib/fetch.ts`, extend `HkFetchInit` and update the function:

```typescript
export interface HkFetchInit {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;  // Story 3.12: caller-provided headers (e.g. Idempotency-Key)
}

export async function hkFetch<T = unknown>(path: string, init: HkFetchInit): Promise<T> {
  const accessToken = useAuthStore.getState().accessToken;
  // Caller headers first; then overwrite with Content-Type and Authorization so auth always wins.
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken !== null) headers['Authorization'] = `Bearer ${accessToken}`;
  // ... rest unchanged
```

---

### Task 11 â€” Frontend: `mutations.ts`

- [x] Create `apps/web/src/features/plan/mutations.ts`:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hkFetch } from '@/lib/fetch.js';
import type { SwapPlanItemInput, PlanItemRow } from '@hivekitchen/types';

// Browser crypto.randomUUID() is available in all modern browsers in secure contexts.
// Fallback for tests and non-secure contexts (http, iframe sandboxing).
function safeRandomUuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

// useSwapPlanItemMutation
// PATCH /v1/plans/:planId/items/:itemId with Idempotency-Key.
// A new Idempotency-Key is generated per mutation invocation â€” retrying a failed
// mutation re-generates the key (no replay-cache on server in this story; safe to retry).
// On success: invalidates ['brief'] wildcard so BriefCanvas re-fetches updated brief_state.
export function useSwapPlanItemMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    { item: PlanItemRow },
    Error,
    { planId: string; itemId: string; input: SwapPlanItemInput }
  >({
    mutationFn: ({ planId, itemId, input }) =>
      hkFetch(`/v1/plans/${planId}/items/${itemId}`, {
        method: 'PATCH',
        body: input,
        headers: { 'Idempotency-Key': safeRandomUuid() },
      }),
    onSuccess: () => {
      // ['brief'] wildcard matches every ['brief', householdId] key.
      // At most one is hot per session â€” one current_household_id.
      void queryClient.invalidateQueries({ queryKey: ['brief'] });
    },
  });
}

// usePauseDayMutation
// PATCH /v1/plans/:planId/days/:day/pause with Idempotency-Key.
// On success: invalidates ['brief'] so tile paused state reflects immediately.
export function usePauseDayMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    void,
    Error,
    { planId: string; day: string; reason?: 'sick' | 'absent' | 'holiday' }
  >({
    mutationFn: ({ planId, day, reason }) =>
      hkFetch(`/v1/plans/${planId}/days/${day}/pause`, {
        method: 'PATCH',
        body: reason !== undefined ? { reason } : {},
        headers: { 'Idempotency-Key': safeRandomUuid() },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brief'] });
    },
  });
}
```

---

### Task 12 â€” Frontend: `DisambiguationPicker` component

- [x] Create `apps/web/src/features/plan/DisambiguationPicker.tsx`:

**Component contract:**
- Renders inline below the tapped `<PlanTile>` (not a modal, not a drawer â€” inline)
- L1: Two pills â€” "Sick day" and "Change an item"
- L2: If tile has multiple items: show item selector (slot + child label); if single item: skip to L3
- L3: Text input â€” parent types new ingredients, comma-separated; submit fires swap mutation
- Allergen detection guards whether the mutation is optimistic or pending

```tsx
import { useState, useRef, useEffect, useId } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PlanTileSummary, ClearedAllergyEntry } from '@hivekitchen/types';
import { HkApiError } from '@/lib/fetch.js';
import { useSwapPlanItemMutation, usePauseDayMutation } from './mutations.js';

type PickerLevel = 'l1' | 'l2-select-item' | 'l3-ingredients';

interface DisambiguationPickerProps {
  planId: string;
  day: PlanTileSummary['day'];
  items: PlanTileSummary['items'];
  clearedAllergens: ReadonlyArray<Pick<ClearedAllergyEntry, 'child_id' | 'allergen'>>;
  onDismiss: () => void;
  // Called when a swap starts: tells BriefCanvas to show swap-in-progress on the tile.
  onSwapStarted: (itemId: string) => void;
  // Called when swap/pause settles (success or failure): clears swap-in-progress state.
  onSwapSettled: () => void;
}

// Simple allergen check: does any new ingredient contain a declared allergen string?
// False positives (e.g. "butter" matching "peanut butter") are safe â€” they just
// send allergen-affecting swaps through the pending (non-optimistic) path.
function isAllergenAffecting(
  childId: string,
  newIngredients: string[],
  clearedAllergens: ReadonlyArray<Pick<ClearedAllergyEntry, 'child_id' | 'allergen'>>,
): boolean {
  const childAllergens = clearedAllergens
    .filter((a) => a.child_id === childId)
    .map((a) => a.allergen.toLowerCase());
  if (childAllergens.length === 0) return false;
  return newIngredients.some((i) =>
    childAllergens.some((a) => i.toLowerCase().includes(a)),
  );
}

export function DisambiguationPicker({
  planId,
  day,
  items,
  clearedAllergens,
  onDismiss,
  onSwapStarted,
  onSwapSettled,
}: DisambiguationPickerProps) {
  const [level, setLevel] = useState<PickerLevel>('l1');
  const [selectedItem, setSelectedItem] = useState<PlanTileSummary['items'][number] | null>(null);
  const [ingredientInput, setIngredientInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const pickerId = useId();

  const swapMutation = useSwapPlanItemMutation();
  const pauseMutation = usePauseDayMutation();

  const isPending = swapMutation.isPending || pauseMutation.isPending;

  // Focus the ingredient input when entering L3.
  useEffect(() => {
    if (level === 'l3-ingredients') {
      inputRef.current?.focus();
    }
  }, [level]);

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      onDismiss();
    }
  }

  async function handleSickDay() {
    setError(null);
    try {
      await pauseMutation.mutateAsync({ planId, day, reason: 'sick' });
      onSwapSettled();
      onDismiss();
    } catch {
      setError('Could not pause this day. Please try again.');
      onSwapSettled();
    }
  }

  function handleChangeItem() {
    if (items.length === 1) {
      setSelectedItem(items[0]!);
      setLevel('l3-ingredients');
    } else {
      setLevel('l2-select-item');
    }
  }

  async function handleSwapSubmit() {
    if (!selectedItem?.plan_item_id) {
      setError('Item ID not available â€” refresh the page and try again.');
      return;
    }

    const newIngredients = ingredientInput
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (newIngredients.length === 0) {
      setError('Enter at least one ingredient.');
      return;
    }

    setError(null);
    const allergenAffecting = isAllergenAffecting(
      selectedItem.child_id,
      newIngredients,
      clearedAllergens,
    );

    // For non-allergen swaps: close picker immediately and show swap-in-progress tile.
    // For allergen-affecting: keep picker open with pending state.
    if (!allergenAffecting) {
      onSwapStarted(selectedItem.plan_item_id);
      onDismiss();
    }

    try {
      await swapMutation.mutateAsync({
        planId,
        itemId: selectedItem.plan_item_id,
        input: { ingredients: newIngredients },
      });
      onSwapSettled();
      if (allergenAffecting) onDismiss();
    } catch (err) {
      onSwapSettled();
      const is422 =
        err instanceof HkApiError && err.status === 422;
      setError(
        is422
          ? "That swap conflicts with a declared allergy. Try different ingredients."
          : 'Swap failed. Please try again.',
      );
      // Picker stays open on allergen-affecting failure so parent sees the error.
      // For non-allergen (optimistic) failures: picker is already dismissed;
      // the brief re-fetches and tile reverts to previous ingredients automatically.
    }
  }

  const DAY_LABEL: Record<PlanTileSummary['day'], string> = {
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="group"
      aria-label={`Edit ${DAY_LABEL[day]}`}
      id={pickerId}
      className="mt-2 rounded-lg border border-stone-200 bg-white p-3 flex flex-col gap-3 shadow-sm font-sans text-[14px]"
      onKeyDown={handleKeyDown}
    >
      {level === 'l1' && (
        <>
          <p className="text-stone-500 text-[13px]">What would you like to do?</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { void handleSickDay(); }}
              disabled={isPending}
              className="rounded-full border border-stone-300 px-3 py-1.5 text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
            >
              Sick day â€” pause, keep the plan
            </button>
            <button
              type="button"
              onClick={handleChangeItem}
              disabled={isPending}
              className="rounded-full border border-stone-300 px-3 py-1.5 text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
            >
              Change an item
            </button>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="self-start text-[12px] text-stone-400 hover:text-stone-600 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300"
          >
            Cancel
          </button>
        </>
      )}

      {level === 'l2-select-item' && (
        <>
          <p className="text-stone-500 text-[13px]">Which slot?</p>
          <div className="flex flex-col gap-1.5">
            {items.map((item) => (
              <button
                key={`${item.child_id}-${item.slot}`}
                type="button"
                onClick={() => {
                  setSelectedItem(item);
                  setLevel('l3-ingredients');
                }}
                className="rounded-md border border-stone-200 px-3 py-2 text-start text-[13px] text-stone-700 hover:bg-stone-50 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
              >
                {item.slot} â€” {item.ingredients.slice(0, 2).join(', ')}
                {item.ingredients.length > 2 ? ` +${item.ingredients.length - 2}` : ''}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setLevel('l1')}
            className="self-start text-[12px] text-stone-400 hover:text-stone-600 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300"
          >
            Back
          </button>
        </>
      )}

      {level === 'l3-ingredients' && (
        <>
          <label htmlFor={`${pickerId}-ingredients`} className="text-stone-500 text-[13px]">
            What should it be instead?
          </label>
          <input
            ref={inputRef}
            id={`${pickerId}-ingredients`}
            type="text"
            value={ingredientInput}
            onChange={(e) => setIngredientInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isPending) { void handleSwapSubmit(); }
            }}
            placeholder="e.g. hummus, rice crackers, apple"
            aria-describedby={error ? `${pickerId}-error` : undefined}
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-[14px] text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
          />
          {error !== null && (
            <p id={`${pickerId}-error`} role="alert" className="text-[12px] text-red-600">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { void handleSwapSubmit(); }}
              disabled={isPending || ingredientInput.trim().length === 0}
              className="rounded-full bg-stone-900 px-4 py-1.5 text-[13px] text-white hover:bg-stone-700 transition-colors motion-reduce:transition-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-400"
            >
              {isPending ? 'Checkingâ€¦' : 'Swap'}
            </button>
            <button
              type="button"
              onClick={() => setLevel(items.length > 1 ? 'l2-select-item' : 'l1')}
              disabled={isPending}
              className="text-[12px] text-stone-400 hover:text-stone-600 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-stone-300"
            >
              Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

> **Text input only:** Recipe-catalog-driven alternatives (L2 pill options for predefined swaps) require the `recipe.search` browsable API â€” deferred to a future story. This story's L3 ingredient text input is the MVP swap surface. The component structure supports promotion to L2 alternatives once the catalog API lands.

> **`start` instead of `left` in `text-start`:** Logical-property compliant. All positioning uses block/inline-neutral utilities.

> **`onKeyDown` on the `<div role="group">`:** ESLint's `no-noninteractive-element-interactions` may fire. Suppress with `// eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions` â€” the Esc key is a global dismiss; the interactive children are the buttons and input.

---

### Task 13 â€” PlanTile: `'paused'` state + BriefCanvas wiring

#### Task 13a â€” Update `PlanTile.tsx`: add `'paused'` state

In `apps/web/src/features/plan/PlanTile.tsx`:

**13a-1.** Add `'paused'` to `PlanTileState`:
```typescript
export type PlanTileState =
  | 'decided'
  | 'pending-input'
  | 'swap-in-progress'
  | 'locked'
  | 'mutability-frozen'
  | 'paused';   // Story 3.12: sick-day pause
```

**13a-2.** Update the `isInteractive` guard:
```typescript
const isPaused = state === 'paused';
const isInteractive = !isPast && !isFrozen && !isPaused && state !== 'swap-in-progress';
```

**13a-3.** Update `tabIndex` to exclude `paused` from tab order:
```typescript
tabIndex={isPast || isFrozen || isPaused ? -1 : 0}
```

**13a-4.** Add the `paused` visual block (after the trust-chip row, before the `isFrozen` block):
```tsx
{isPaused && (
  <p
    className="mt-1 font-sans text-[12px] text-stone-400 italic"
    aria-label="Day paused â€” sick day"
  >
    Paused
  </p>
)}
```

**13a-5.** Apply de-emphasis styling when paused (update `articleClasses`):
```typescript
const articleClasses = [
  'relative rounded-lg p-4 flex flex-col gap-1',
  borderClass,
  hasMorningTint && !isPaused ? 'bg-honey-amber-100' : 'bg-white',
  isPast || isPaused ? 'opacity-60 pointer-events-none' : '',  // de-emphasize paused same as past
  isInteractive
    ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-1'
    : '',
]
  .filter((c) => c !== '')
  .join(' ');
```

#### Task 13b â€” Update `BriefCanvas.tsx`: wire swap/pause flow

In `apps/web/src/features/plan/BriefCanvas.tsx`:

**13b-1.** Add imports:
```typescript
import { DisambiguationPicker } from './DisambiguationPicker.js';
```

**13b-2.** Add state:
```typescript
const [activeSwapDay, setActiveSwapDay] = useState<PlanTileSummary['day'] | null>(null);
const [swappingItemId, setSwappingItemId] = useState<string | null>(null);
```

Import `PlanTileSummary` from `@hivekitchen/types` if not already imported.

**13b-3.** Derive the `planId` from brief:
```typescript
// brief.plan_id is null on pre-migration rows; swap UI requires it.
const planId = brief?.plan_id ?? null;
const canSwap = planId !== null;
```

**13b-4.** Update the tile grid render:

```tsx
<div
  className={`grid grid-cols-2 ${brief.plan_tile_summaries.length <= 5 ? 'md:grid-cols-5' : 'md:grid-cols-6'} gap-3 mt-2`}
  aria-label="Weekly plan"
>
  {brief.plan_tile_summaries.map((summary) => {
    const tileState: PlanTileState =
      summary.paused
        ? 'paused'
        : summary.items.some((i) => i.plan_item_id === swappingItemId)
        ? 'swap-in-progress'
        : activeSwapDay === summary.day
        ? 'pending-input'
        : 'decided';

    return (
      <PlanTile
        key={summary.day}
        summary={summary}
        state={tileState}
        onSwapIntent={
          canSwap && !summary.paused && swappingItemId === null
            ? () => setActiveSwapDay(summary.day)
            : undefined
        }
      />
    );
  })}
</div>

{activeSwapDay !== null && planId !== null && (() => {
  const activeSummary = brief.plan_tile_summaries.find(
    (s) => s.day === activeSwapDay,
  );
  if (!activeSummary) return null;
  return (
    <DisambiguationPicker
      planId={planId}
      day={activeSwapDay}
      items={activeSummary.items}
      clearedAllergens={clearedAllergies.map((e) => ({
        child_id: e.child_id,
        allergen: e.allergen,
      }))}
      onDismiss={() => setActiveSwapDay(null)}
      onSwapStarted={(itemId) => {
        setSwappingItemId(itemId);
        setActiveSwapDay(null);
      }}
      onSwapSettled={() => setSwappingItemId(null)}
    />
  );
})()}
```

> **IIFE pattern** for the picker render: avoids a named helper function for a one-off conditional. If it grows, extract to a `<SwapPickerPanel>` wrapper.

> **Import `PlanTileState`** from `./PlanTile.js` (already re-exported by the component file).

---

### Task 14 â€” Contract tests

In `packages/contracts/src/plan.test.ts`:

**14a.** Add `PlanTileItemSchema` tests (in a new `describe` block or extend existing):
- `plan_item_id` is optional â€” parses with and without it
- `paused: false` is the default when omitted from `PlanTileSummarySchema`
- `BriefStateRowSchema` parses with `plan_id: null`
- `BriefStateRowSchema` parses with `plan_id: '...'` (valid uuid)
- `BriefStateRowSchema` omitting `plan_id` â†’ defaults to `null`

**14b.** Add `SwapPlanItemInputSchema` tests:
- Parses `{ ingredients: ['hummus', 'crackers'] }`
- Parses with optional `recipe_id` and `item_id`
- Rejects empty `ingredients` array (min 1)
- Rejects ingredient with empty string (min 1 on each element)

**14c.** Add `PlanItemRowSchema` tests:
- Parses with `paused_at: null`
- Parses with `paused_at: '2026-05-04T12:00:00.000Z'`
- Omitting `paused_at` â†’ defaults to `null`

**14d.** Add `PausePlanDayInputSchema` tests:
- Parses `{}` (reason optional)
- Parses `{ reason: 'sick' }`
- Rejects `{ reason: 'other' }` (not in enum)

---

### Task 15 â€” API tests

#### Task 15a â€” `plans.repository.test.ts`
Add tests for:
- `findItemById` returns item when found; returns null when not found
- `updateItemIngredients` updates ingredients and returns updated row
- `pauseDay` sets `paused_at` on all matching rows

Mock the Supabase client; follow existing repository test patterns in `plans.repository.test.ts`.

#### Task 15b â€” `plans.service.test.ts`
Add tests for `swapItem()`:
- Throws `NotFoundError` when plan not found (repo returns null)
- Throws `NotFoundError` when item not found (item repo returns null)
- Throws `SwapGuardrailBlockedError` when guardrail returns `blocked`
- Throws `SwapGuardrailBlockedError` when guardrail returns `uncertain`
- On cleared verdict â†’ calls `repo.updateItemIngredients` and `briefStateComposer.refresh`
- `briefStateComposer.refresh` called with `{ userInitiated: true }`
- Audit write called with `event_type: 'plan.item_swapped'`
- Audit failure does NOT rethrow (service is resilient)

Add tests for `pauseDay()`:
- Throws `NotFoundError` when plan not found
- On success â†’ calls `repo.pauseDay` and `briefStateComposer.refresh`
- `briefStateComposer.refresh` called with `{ userInitiated: true }`
- Audit write called with `event_type: 'plan.day_paused'`

#### Task 15c â€” `brief-state.composer.test.ts`
Extend tests for `refresh()`:
- `buildScaffoldingDiff` returns null when `userInitiated: true` (even if ingredients differ)
- `buildScaffoldingDiff` returns null when no previous brief_state exists
- `buildScaffoldingDiff` returns non-null when system-initiated and ingredients differ
- `plan_id` is included in upsertInput (matches `plan.id`)
- `plan_item_id` field is present in built tile summaries (matches `item.id`)
- `paused: true` in tile summary when all items for day have `paused_at`
- `paused: false` when only some items are paused (partial â€” not yet full-day)

---

### Task 16 â€” Frontend tests

#### Task 16a â€” `DisambiguationPicker.test.tsx` (new file)

```
apps/web/src/features/plan/DisambiguationPicker.test.tsx
```

Key cases to cover:
- L1 renders "Sick day" and "Change an item" buttons
- "Sick day" button fires `pauseMutation` on click; calls `onSwapSettled` + `onDismiss` on success
- "Change an item" with single item â†’ advances directly to L3
- "Change an item" with multiple items â†’ advances to L2
- L2 shows slot list; clicking a slot advances to L3 for that item
- L3 shows label "What should it be instead?" and an input
- Submitting L3 with empty input shows validation error; does not fire mutation
- Non-allergen swap: calls `onSwapStarted` + `onDismiss` before awaiting mutation
- Allergen-affecting swap: does NOT call `onDismiss` before mutation; keeps picker open
- 422 error from swap shows accountable error message in picker
- Non-422 error shows generic retry message
- Escape key calls `onDismiss`

Follow the existing test pattern in `BriefCanvas.test.tsx` and `QuietDiff.test.tsx`: import from `'@testing-library/react'`, use `render`, `screen`, `fireEvent`, `cleanup`.

#### Task 16b â€” `BriefCanvas.test.tsx` (extend)

- Update `makeBrief()` fixture to include `plan_id: 'aaaaaaaa-...'` and `plan_tile_summaries` items with `plan_item_id` set
- Tile renders `state='paused'` and shows "Paused" text when `summary.paused === true`
- Tile does not receive `onSwapIntent` when `brief.plan_id === null` (canSwap guard)
- Tapping a tile sets `activeSwapDay` and renders `<DisambiguationPicker>`
- Picker not rendered when `activeSwapDay === null`

---

### Task 17 â€” Typecheck, lint, test suite

- [x] `pnpm --filter @hivekitchen/contracts typecheck && pnpm --filter @hivekitchen/contracts test` â€” all plan.test.ts pass; new schema tests pass
- [x] `pnpm --filter @hivekitchen/api typecheck && pnpm --filter @hivekitchen/api exec vitest run src/modules/plans` â€” new service/repo/composer tests pass; zero new typecheck errors
- [x] `pnpm --filter @hivekitchen/api exec vitest run src/audit` â€” audit.types.test.ts still passes (AUDIT_EVENT_TYPES matches Postgres enum via migration)
- [x] `pnpm --filter @hivekitchen/web typecheck` â€” zero new errors
- [x] `pnpm --filter @hivekitchen/web exec vitest run src/features/plan` â€” all new + existing tests pass; existing 237 tests from Story 3.11 unaffected
- [x] `pnpm --filter @hivekitchen/web lint` â€” 0 new errors; verify `jsx-a11y/no-noninteractive-element-interactions` suppression on DisambiguationPicker's `<div role="group">`
- [x] `pnpm --filter @hivekitchen/web test` â€” full web suite passing

---

## Dev Notes

### Critical â€” `plan_id` and `plan_item_id` may be undefined on cached brief rows

`hkFetch` does not run Zod parsing on responses. Pre-migration cached brief rows will have no `plan_id` column in `brief_state` and no `plan_item_id` in the JSON `plan_tile_summaries`. These will be `undefined` on the JS object (not `null`). Guard everywhere:

```typescript
const planId = brief?.plan_id ?? null;          // undefined â†’ null
const itemId = item?.plan_item_id ?? undefined;  // undefined stays undefined
```

The `canSwap = planId !== null` guard in BriefCanvas prevents the picker from opening until a post-migration brief is loaded. After the first composer `refresh()` post-deploy, all cached rows are obsolete (TanStack staleTime of 5min clears them).

### Critical â€” `buildScaffoldingDiff` during initial generation always returns null

On first `refresh()` after plan commit, `previousBrief` is null (no row exists yet). `previousTileSummaries` is `null` â†’ `buildScaffoldingDiff` returns `null`. This is correct: there's no previous state to diff. After the first brief is stored, subsequent Lumi-initiated refreshes (future stories) will have a previous state to compare against.

### Critical â€” Paused tiles are non-interactive; `onSwapIntent` must be undefined

BriefCanvas guards: `!summary.paused && swappingItemId === null` before passing `onSwapIntent`. PlanTile already makes `isPaused` non-interactive (pointer-events-none, opacity-60). Both layers must agree â€” belt-and-suspenders per the safety pattern.

### Critical â€” `pauseDay` is NOT idempotent at the service layer (only at DB)

Calling `pauseDay` twice for the same day calls `briefStateComposer.refresh()` twice and writes two `plan.day_paused` audit rows. The DB UPDATE is idempotent (sets same `paused_at`). If full idempotency is needed, compare existing `paused_at` before updating â€” deferred (see deferred-work.md entry below).

### Architecture â€” Idempotency-Key: format validation only in this story

The `Idempotency-Key` header is required and must be a UUID, but Story 3.12 does NOT implement the Redis replay-cache (24h deduplication). Re-sending the same key with different body is silently re-executed (not a 409 Idempotency-Conflict). Full replay-cache implementation is explicitly deferred. Add to `deferred-work.md`:

```
[Defer] PATCH /v1/plans/:planId/items/:itemId and PATCH /v1/plans/:planId/days/:day/pause:
Idempotency-Key header is validated for format only. Redis 24h replay-cache (architecture Â§Idempotency:
409 Idempotency-Conflict on same-key different-body) is not implemented. Safe to defer: user-initiated
swaps are low-frequency and the guardrail prevents duplicate allergen introductions. [Story 3.12]
```

### Architecture â€” `GUARDRAIL_VERSION` import in plans.service.ts

`GUARDRAIL_VERSION` is already imported in `plans.service.ts` (it's used in `commit()`). Verify the import before adding â€” do not duplicate.

### Architecture â€” `plans.routes.ts` depends on `fastify.plansService`

`plansService` is decorated in `plans.hook.ts`. TypeScript will flag `fastify.plansService` as unknown unless the Fastify declaration merging file includes it. Check `apps/api/src/types/fastify.d.ts` (or equivalent) for existing declarations of `plansService`. If it's already declared (from Story 3.6's route in `households.routes.ts`), no new declaration is needed. If not, add:

```typescript
// In the Fastify declaration module:
plansService: PlansService;
```

### Architecture â€” SSE fan-out is a stub; client relies on mutation onSuccess

The `GET /v1/events` SSE route is a stub (Story 1.10) â€” no Redis pub/sub fan-out yet (Story 5.2). After a successful swap/pause mutation, the client calls `queryClient.invalidateQueries({ queryKey: ['brief'] })` in `onSuccess`. This triggers a re-fetch of the brief, which reflects the updated plan_tile_summaries. Other connected clients (secondary caregiver on another tab) will NOT see the update until they refetch (on focus or next staleTime expiry). This is acceptable for MVP.

### Architecture â€” `briefStateComposer.refresh()` callers: update signature compatibility

`PlansService.commit()` calls `briefStateComposer.refresh(householdId, weekId, requestId)` with no `opts`. The default `opts = {}` makes `userInitiated` undefined â†’ falls back to `false` â†’ `buildScaffoldingDiff` runs normally. For `commit()` path, the first-time refresh has no previous state (null) â†’ returns null anyway. No change needed to `commit()` call site.

### UX â€” Allergen-affecting swap: picker stays open with "Checkingâ€¦" button state

Per AC #1: "allergen-affecting swaps render pending until guardrail confirms". In the picker's L3 ingredient input: when `isAllergenAffecting` is true, the Swap button shows "Checkingâ€¦" while `isPending` is true and the picker does NOT close. Only on server success does `onDismiss()` fire. This keeps the parent's focus on the pending result rather than showing a spinner on a blank tile.

### UX â€” Non-allergen swap: optimistic tile update

For non-allergen swaps: `onSwapStarted(itemId)` fires immediately (before `swapMutation.mutateAsync` resolves), which sets `swappingItemId` in BriefCanvas â†’ tile shows `swap-in-progress` spinner. If the mutation fails (network error, non-422), `onSwapSettled()` clears `swappingItemId` and `queryClient.invalidateQueries` (from `onSuccess` in the base case â€” NOT fired on error). The brief re-fetches on next window focus or staleTime expiry, reverting the tile to its pre-swap ingredients. This matches the "optimistic with rollback" contract â€” the rollback is implicit via stale cache expiry, not an explicit `onError` TanStack rollback.

For explicit TanStack Query optimistic updates with `onMutate`/`onError` cancel+rollback: defer to a future story when the UX team confirms the rollback timing is right. Current implementation is correct per the AC.

### Pattern â€” Logical properties in DisambiguationPicker

`text-start` (not `text-left`), `start-0` (not `left-0`). All utility classes are block/inline-axis-neutral or use logical equivalents. The ESLint rule `hivekitchen/logical-properties-only` will catch violations.

---

## Project Structure â€” New and Modified Files

**New files:**
```
supabase/migrations/20260621000000_add_paused_at_to_plan_items.sql
supabase/migrations/20260621000100_add_plan_swap_pause_audit_types.sql
supabase/migrations/20260621000200_add_plan_id_to_brief_state.sql
apps/api/src/modules/plans/plans.routes.ts
apps/api/src/modules/plans/plans.routes.test.ts
apps/web/src/features/plan/mutations.ts
apps/web/src/features/plan/DisambiguationPicker.tsx
apps/web/src/features/plan/DisambiguationPicker.test.tsx
```

**Modified files:**
```
packages/contracts/src/plan.ts                        + plan_item_id, paused, plan_id, paused_at, SwapPlanItemInputSchema, SwapPlanItemResponseSchema, PausePlanDayInputSchema
packages/contracts/src/plan.test.ts                   + schema tests for new fields
packages/types/src/index.ts                           + new schema imports + type exports
apps/api/src/audit/audit.types.ts                     + plan.item_swapped, plan.day_paused
apps/api/src/common/errors.ts                         + SwapGuardrailBlockedError
apps/api/src/app.ts                                   + plansRoutes import + registration
apps/api/src/modules/plans/plans.repository.ts        + PLAN_ITEM_COLUMNS, findItemById, updateItemIngredients, pauseDay
apps/api/src/modules/plans/plans.repository.test.ts   + new method tests
apps/api/src/modules/plans/plans.service.ts           + swapItem, pauseDay
apps/api/src/modules/plans/plans.service.test.ts      + swapItem + pauseDay tests
apps/api/src/modules/plans/brief-state.composer.ts    + refresh opts param, plan_id in upsert, buildScaffoldingDiff, updated buildTileSummaries
apps/api/src/modules/plans/brief-state.composer.test.ts + new refresh/diff tests
apps/api/src/modules/plans/brief-state.repository.ts  + plan_id in BriefStateUpsertInput + BRIEF_STATE_COLUMNS
apps/web/src/lib/fetch.ts                             + headers field in HkFetchInit
apps/web/src/features/plan/PlanTile.tsx               + 'paused' state
apps/web/src/features/plan/PlanTile.test.tsx          + paused state test
apps/web/src/features/plan/BriefCanvas.tsx            + activeSwapDay/swappingItemId state, DisambiguationPicker, canSwap guard, paused tile state
apps/web/src/features/plan/BriefCanvas.test.tsx       + updated makeBrief fixture, new swap/pause tests
_bmad-output/implementation-artifacts/sprint-status.yaml  3-12 â†’ ready-for-dev
```

**Do NOT touch:**
```
apps/web/src/features/plan/QuietDiff.tsx        (3.11 â€” scaffolding_diff write path is wired; display unchanged)
apps/web/src/features/plan/FreshnessState.tsx   (3.11)
apps/web/src/features/plan/AllergyClearedBadge.tsx (3.10)
apps/web/src/features/plan/MomentHeadline.tsx   (3.8)
apps/web/src/features/plan/LumiNote.tsx         (3.8)
apps/web/src/features/plan/TrustChip.tsx        (3.9)
apps/api/src/modules/allergy-guardrail/         (3.1 â€” guardrail service is consumed, not modified)
apps/api/src/routes/v1/events/events.routes.ts  (1.10 stub â€” SSE fan-out is Story 5.2)
```

## Dev Agent Record

### Agent Model Used
Claude Opus 4.7 (1M context) — bmad-dev-story workflow.

### Completion Notes List

- All 17 implementation tasks complete; all top-level checkboxes marked [x].
- 3 SQL migrations added: `paused_at` column on `plan_items`, two new audit-event-type enum values (`plan.item_swapped`, `plan.day_paused`), and nullable `plan_id` foreign-key column on `brief_state`.
- Plan contracts extended with `SwapPlanItemInputSchema`, `SwapPlanItemResponseSchema`, `PausePlanDayInputSchema`, plus `plan_item_id` (optional) on tile items, `paused` (default false) on tile summaries, `plan_id` (nullable, default null) on `BriefStateRow`, and `paused_at` (nullable, default null) on `PlanItemRow`. Inferred types re-exported from `@hivekitchen/types`.
- API: `PlansRepository` gained `findItemById`, `updateItemIngredients`, `pauseDay`; `PlansService` gained `swapItem` (per-slot guardrail evaluation → 422 on block/uncertain; brief refresh `userInitiated:true`; audit `plan.item_swapped`) and `pauseDay` (sets `paused_at` on all items for the day; audit `plan.day_paused`). New `SwapGuardrailBlockedError` (422). New `plans.routes.ts` exposes `PATCH /v1/plans/:planId/items/:itemId` and `PATCH /v1/plans/:planId/days/:day/pause`, both gated by `Idempotency-Key` UUID format check (replay-cache deferred).
- `BriefStateComposer.refresh` now accepts `{ userInitiated?: boolean }` opts, reads previous `brief_state` for diffing, writes `plan_id` into the projection, emits `plan_item_id` and `paused` per tile, and computes `scaffolding_diff` only for system-initiated mutations (user-initiated swaps return null per UX-DR19).
- Web: `hkFetch` now supports caller-provided `headers`. New `mutations.ts` exposes `useSwapPlanItemMutation` and `usePauseDayMutation` (each generates a fresh `Idempotency-Key` UUID per invocation). New `<DisambiguationPicker>` (L1 sick/change → L2 slot select → L3 ingredient input). `<PlanTile>` gained the `paused` state with `Paused` italic copy + `tabIndex=-1` + de-emphasis. `<BriefCanvas>` wires `activeSwapDay` / `swappingItemId` state, derives `planId` + `canSwap` from brief, and renders the picker inline below the tapped tile.
- Idempotency-Key on the two new PATCH routes is format-checked only — Redis 24h replay-cache deferred to a later story (`deferred-work.md`).
- Tests added: 42 contract tests, 21 API tests (repository, service, composer), 22 web tests (PlanTile paused state, BriefCanvas picker wiring, DisambiguationPicker full flow). All targeted suites green.
- Validation: `@hivekitchen/contracts test` 433/434 pass (the 1 failing test in `cultural.test.ts` is pre-existing). `@hivekitchen/api typecheck` adds zero new errors. `src/modules/plans` 61/61 pass; `src/audit` 4/4 pass. `@hivekitchen/web typecheck` clean. `src/features/plan` 108/108 pass. Full `@hivekitchen/web test` 258/258 pass. `@hivekitchen/web lint` introduces zero new violations (final count: 13 pre-existing problems).

### File List

**New files:**
- `supabase/migrations/20260621000000_add_paused_at_to_plan_items.sql`
- `supabase/migrations/20260621000100_add_plan_swap_pause_audit_types.sql`
- `supabase/migrations/20260621000200_add_plan_id_to_brief_state.sql`
- `apps/api/src/modules/plans/plans.routes.ts`
- `apps/web/src/features/plan/mutations.ts`
- `apps/web/src/features/plan/DisambiguationPicker.tsx`
- `apps/web/src/features/plan/DisambiguationPicker.test.tsx`

**Modified files:**
- `packages/contracts/src/plan.ts`
- `packages/contracts/src/plan.test.ts`
- `packages/types/src/index.ts`
- `apps/api/src/audit/audit.types.ts`
- `apps/api/src/common/errors.ts`
- `apps/api/src/app.ts`
- `apps/api/src/modules/plans/plans.repository.ts`
- `apps/api/src/modules/plans/plans.repository.test.ts`
- `apps/api/src/modules/plans/plans.service.ts`
- `apps/api/src/modules/plans/plans.service.test.ts`
- `apps/api/src/modules/plans/brief-state.composer.ts`
- `apps/api/src/modules/plans/brief-state.composer.test.ts`
- `apps/api/src/modules/plans/brief-state.repository.ts`
- `apps/web/src/lib/fetch.ts`
- `apps/web/src/features/plan/PlanTile.tsx`
- `apps/web/src/features/plan/PlanTile.test.tsx`
- `apps/web/src/features/plan/BriefCanvas.tsx`
- `apps/web/src/features/plan/BriefCanvas.test.tsx`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `apps/api/src/modules/plans/plans.routes.test.ts`

## Change Log

| Date       | Author | Change                                    |
| ---------- | ------ | ----------------------------------------- |
| 2026-05-04 | Menon  | Story 3.12 created — ready-for-dev.        |
| 2026-05-04 | Dev    | Story 3.12 implemented — Status → review.  |
| 2026-05-04 | Menon  | Added missing plans.routes.test.ts (21 tests covering auth, idempotency-key validation, param validation, 404/422 error propagation, success paths for both roles). Status confirmed review. |

---

### Review Findings (2026-05-04)

Reviewers: Blind Hunter (diff-only), Edge Case Hunter (diff + project read), Acceptance Auditor (diff + spec).

Acceptance: AC #1 PASS, AC #2 PASS. All 17 task groups implemented in working tree.

<!-- decision_needed -->
- [x] [Review][Decision] `SwapGuardrailBlockedError` returns the offending allergen names to the client in its `detail` message — Resolved as **Option A (keep)**: the household member needs to know what was blocked so they can pick a different ingredient. Sibling-allergen-leak path is rare in practice because the picker presents recipes the agent has already pre-cleared against the household; manual L3 ingredient entry is the only path that reaches a guardrail block. No code change required. [`apps/api/src/common/errors.ts:46-53`]

<!-- patch -->
- [x] [Review][Patch] Swapping an item on a paused day left `paused_at` set; Lunch Link would silently skip the parent's deliberate change. Fixed: `updateItemIngredients` now always clears `paused_at` to `NULL` — parents editing a paused slot are implicitly un-pausing it. [`apps/api/src/modules/plans/plans.repository.ts:updateItemIngredients`]
- [x] [Review][Patch] `pauseDay` was non-idempotent (rewrote `paused_at` on every retry) and silently 204'd when zero rows matched. Fixed in three layers: repo's `pauseDay` now adds `.is('paused_at', null)` filter and returns flipped rows; new repo `countItemsForDay` distinguishes "no items for this day" from "already paused"; service's `pauseDay` 422s on zero items, no-ops on already-paused, and only audits/refreshes when rows actually flipped. Tests updated to cover all three paths. [`apps/api/src/modules/plans/plans.repository.ts` + `plans.service.ts:pauseDay`]
- [x] [Review][Patch] `PausePlanDayInputSchema.reason` was parsed by Zod but discarded. Fixed: route now reads `body.reason` and threads it into `service.pauseDay({ ..., reason })`; audit metadata includes `reason` when supplied. [`apps/api/src/modules/plans/plans.routes.ts:99-110` + `plans.service.ts:pauseDay`]
- [x] [Review][Patch] Uncertain/blocked swap audit dropped `result.reason` from the guardrail. Fixed: when the verdict is `uncertain`, the audit metadata now includes `reason: result.reason`. [`apps/api/src/modules/plans/plans.service.ts:227-251`]
- [x] [Review][Patch] Swap on revision N could be silently lost when BullMQ regenerated to N+1 between `findItemById` and `updateItemIngredients`. Fixed: after the guardrail clears, the service re-reads the plan via `findByIdForPresentation` and 404s if `plan.revision` has advanced — the client refetches the brief and presents the new revision. [`apps/api/src/modules/plans/plans.service.ts:swapItem`]
- [x] [Review][Patch][Dismissed] Migration `20260621000100` uses `ALTER TYPE ... ADD VALUE` — the Edge Case Hunter's "may abort inside transaction" concern is version-dependent and does not apply on Postgres 12+ (Supabase runs PG 15+) when the new value isn't used in the same transaction. Existing migrations (`20260620000200`, `20260601000100`, ten others) follow the same pattern and have been deployed without incident. No code change. [`supabase/migrations/20260621000100_add_plan_swap_pause_audit_types.sql`]
- [x] [Review][Patch] `safeRandomUuid()` fallback used `Math.random()` mapped through bitwise ops — non-cryptographic and collision-prone. Fixed: fallback now uses `crypto.getRandomValues(new Uint8Array(16))` and assembles an RFC 4122 v4 UUID. Throws if no cryptographic RNG is available rather than silently downgrading. [`apps/web/src/features/plan/mutations.ts:7-22`]
- [x] [Review][Patch] Picker dismiss did not restore focus to the originating tile (WCAG 2.4.3 violation). Fixed: BriefCanvas captures `document.activeElement` when the user opens the picker via a tile, and a new `dismissPicker` helper restores focus to that element when the picker closes via Escape or the dismiss path. The optimistic-swap path explicitly clears the trigger ref so focus does not snap back to a now-suppressed tile. [`apps/web/src/features/plan/BriefCanvas.tsx`]

<!-- defer -->
- [x] [Review][Defer] `pauseDay`/`updateItemIngredients`/`findItemById` lack a `household_id` predicate at the SQL layer — authorization lives entirely in the service-layer `findByIdForPresentation(planId, householdId)` ownership check; defense-in-depth would add the predicate at the repo. Architectural concern; defer to a security pass. [`apps/api/src/modules/plans/plans.repository.ts`] — deferred, architectural
- [x] [Review][Defer] Idempotency-Key is format-validated only on the API; the client mints a fresh key per `mutateAsync`, so React-Query auto-retries don't replay the same key. Header is ceremonial without the Redis 24-h replay-cache. Already documented in `deferred-work.md`. [`apps/api/src/modules/plans/plans.routes.ts:requireIdempotencyKey` + `apps/web/src/features/plan/mutations.ts`] — deferred, pre-existing in deferred-work.md
- [x] [Review][Defer] `SwapPlanItemInputSchema.recipe_id`/`item_id` have no FK existence/ownership validation server-side — a client could supply a UUID for a recipe owned by another household. DB FK gives `23503` if the row doesn't exist; cross-household IDOR is not guarded explicitly. [`apps/api/src/modules/plans/plans.service.ts:1741-1747`] — deferred, IDOR architectural
- [x] [Review][Defer] Same-revision concurrent brief writes can race on the swap/pause path — composer is called synchronously in HTTP handlers, not via BullMQ, so the per-household serialization that 3-11 documented does not apply here. Last writer wins. Bounded by the rarity of concurrent caregiver edits at MVP scale. [`apps/api/src/modules/plans/brief-state.repository.ts:upsert` and `plans.service.ts:swapItem,pauseDay`] — deferred, MVP-scale risk
- [x] [Review][Defer] `composer.refresh` failure during swap is logged but swallowed — service returns 200; client invalidates `['brief']` and re-fetches the unchanged stale projection. UX loop until projection write recovers. Composer-must-not-throw is a documented invariant; surfacing the failure to the swap response would change that contract. [`apps/api/src/modules/plans/plans.service.ts:swapItem`] — deferred, contract invariant
- [x] [Review][Defer] No invalidation of `['brief']` on mutation `onError` — a transient swap failure leaves the optimistic tile in `swap-in-progress` until the next stale-time refetch. Add `onError: () => queryClient.invalidateQueries(['brief'])` to both mutations. [`apps/web/src/features/plan/mutations.ts:onError missing`] — deferred, UX papercut
- [x] [Review][Defer] `isAllergenAffecting` substring match has UX-only false positives ("egg" matches "vegan eggless mayo") and rare false negatives — both safe because the server's authoritative guardrail is the actual gate. The comment claiming "false positives are safe" is technically right but misleading about the false-negative direction. Update the comment to clarify: server is authoritative; this heuristic only governs optimistic-vs-pending UI. [`apps/web/src/features/plan/DisambiguationPicker.tsx:isAllergenAffecting`] — deferred, UX-only
- [x] [Review][Defer] `isAllergenAffecting` does not Unicode-normalize — "Café" vs "cafe" mismatch. Add `.normalize('NFKD')` before lowercase/substring check if i18n becomes relevant. [`apps/web/src/features/plan/DisambiguationPicker.tsx`] — deferred, latent
- [x] [Review][Defer] DisambiguationPicker `<div role="group">` with `onKeyDown` requires a focusable wrapper to receive keys reliably; works only because keys bubble from focused button/input. ESLint suppression papers over the issue. Same pattern as 3-10/3-11 popovers — codebase-wide a11y pass entry. [`apps/web/src/features/plan/DisambiguationPicker.tsx:onKeyDown wrapper`] — deferred, pattern-wide
- [x] [Review][Defer] Empty-string allergen in `child.declared_allergens` would produce an unparseable brief response — composer emits `{ allergen: '' }`, then `BriefResponseSchema` (FE) min(1) rejects. Defensive filter at composer write time. Latent (no current path emits empty allergens). [`apps/api/src/modules/plans/brief-state.composer.ts:298-316`] — deferred, latent
- [x] [Review][Defer] Migration ordering — code references `paused_at` in `PLAN_ITEM_COLUMNS` already; deploying code before running the migration breaks every `findItemsByPlanId`. Standard rollout-ordering ops concern. — deferred, deploy ops
- [x] [Review][Defer] `BRIEF_STATE_COLUMNS` references `cleared_allergies` and `scaffolding_diff` but those migrations live in earlier story files (3-10 / 3-11), not in this diff. Confirmed present on disk; reviewer false-positive from scoped diff. — deferred, reviewer scoping artifact
- [x] [Review][Defer] `pauseDay` test asserts `expect.any(String)` for `pausedAt` rather than the actual ISO timestamp — weak assertion. [`apps/api/src/modules/plans/plans.repository.test.ts`] — deferred, test cosmetic
- [x] [Review][Defer] `SwapPlanItemInputSchema` cannot clear a previously-non-null `recipe_id` (no nullable + no clear-sentinel) — API design gap. [`packages/contracts/src/plan.ts:SwapPlanItemInputSchema`] — deferred, API design
- [x] [Review][Defer] Picker error state persists across L3↔L2 navigation — Back buttons don't clear `error`. [`apps/web/src/features/plan/DisambiguationPicker.tsx`] — deferred, UX papercut
- [x] [Review][Defer] Picker `Enter` on empty L3 input fires submit, which then errors — double key path. [`apps/web/src/features/plan/DisambiguationPicker.tsx:handleSwapSubmit`] — deferred, UX papercut
- [x] [Review][Defer] Picker comma-only input briefly enables Swap button — `","`.length === 1 passes the disabled check. [`apps/web/src/features/plan/DisambiguationPicker.tsx`] — deferred, UX papercut
- [x] [Review][Defer] Picker Escape handler doesn't `stopPropagation` — bubbles to ancestor dialogs. [`apps/web/src/features/plan/DisambiguationPicker.tsx`] — deferred, UX
- [x] [Review][Defer] Mid-mutation unmount race — `onSwapStarted`/`onSwapSettled` may fire on unmounted parent (React 19 logs warnings, no crash). [`apps/web/src/features/plan/DisambiguationPicker.tsx`] — deferred, low impact
- [x] [Review][Defer] `cleared_allergies` not deduplicated when `declared_allergens` has duplicates — already deferred in 3-11 review. — deferred, pre-existing 3-11
- [x] [Review][Defer] `SwapPlanItemResponseSchema` returns `paused_at` from updated item but service never clears it — visibly inconsistent (will be addressed by the paused-swap patch above). [`apps/api/src/modules/plans/plans.service.ts:255-261`] — deferred, related to patch above
- [x] [Review][Defer] `brief_state.plan_id` FK uses `ON DELETE SET NULL` — client paths assume `plan_id` is always populated when items exist. Plan deletes aren't expected today. [`supabase/migrations/20260621000200_add_plan_id_to_brief_state.sql`] — deferred, latent
- [x] [Review][Defer] `PlanItemRowSchema.ingredients` allows `[]` but `SwapPlanItemInputSchema.ingredients` requires `min(1)` — empty stored item is uneditable via the only swap mechanism. [`packages/contracts/src/plan.ts`] — deferred, API design
- [x] [Review][Defer] `hkFetch` won't overwrite caller-supplied `Authorization` header when `accessToken === null` — defensive concern; no current callers do this. [`apps/web/src/lib/fetch.ts:headers merging`] — deferred, defensive
- [x] [Review][Defer] Idempotency-Key UUID regex accepts non-v4 UUIDs despite comment — cosmetic. [`apps/api/src/modules/plans/plans.routes.ts:requireIdempotencyKey`] — deferred, cosmetic
- [x] [Review][Defer] `BriefStateRepository.upsert` revision guard `>=` → `>` change is intentional per 3-11 R3 decision but not called out in the 3-12 spec — necessary for swap/pause refreshes within the same revision to actually persist. [`apps/api/src/modules/plans/brief-state.repository.ts`] — deferred, documented in 3-11 spec

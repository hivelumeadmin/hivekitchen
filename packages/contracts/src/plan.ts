import { z } from 'zod';

// --- Existing meal-planning schemas (kept unchanged) ---

export const MealItem = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const DayPlan = z.object({
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
  meal: MealItem,
});

export const WeeklyPlan = z.object({
  id: z.string().uuid(),
  weekOf: z.string(),
  status: z.enum(['draft', 'confirmed']),
  days: z.array(DayPlan),
  promptVersion: z.string(),
});

export const CreatePlanResponse = z.object({
  plan: WeeklyPlan,
});

// --- Foundation Gate schemas ---

export const AllergyVerdict = z.discriminatedUnion('verdict', [
  z.object({ verdict: z.literal('cleared') }),
  z.object({
    verdict: z.literal('blocked'),
    allergens: z.array(z.string().min(1)).min(1),
    reason: z.string().optional(),
  }),
  z.object({ verdict: z.literal('pending') }),
  z.object({
    verdict: z.literal('degraded'),
    reason: z.string().min(1),
    suggestion: z.string().optional(),
  }),
]);

export const PlanUpdatedEvent = z.object({
  type: z.literal('plan.updated'),
  week_id: z.string().uuid(),
  guardrail_verdict: AllergyVerdict,
});

// --- Story 3.1: deterministic allergy guardrail ---
// AllergyVerdict above carries the SSE-facing summary; the schemas below are the
// authoritative result shape returned by allergyGuardrailService.evaluate() /
// clearOrReject() and the input/output of the advisory `allergy.check` tool.

const ALLERGEN_MAX = 200;
const INGREDIENT_MAX = 200;
const SLOT_MAX = 64;
const PLAN_ITEMS_MAX = 50;
const INGREDIENTS_MAX = 20;

// --- Story 3.7 — plan.compose tool I/O schemas ---
// Per-child, per-slot item within a single day's plan.
// recipe_id / item_id are optional at compose time; resolver fills them in
// later stories. Schemas are tool-internal — only the inferred types are
// re-exported for consumers (planner agent + BullMQ worker).
// Story 3.20: item_sku_id is the canonical reference for Snack-slot items;
// the planner sets it for the snack_skus catalog row chosen for that slot.
const PlanComposeItemSchema = z.object({
  child_id: z.string().uuid(),
  slot: z.string().min(1).max(SLOT_MAX),
  ingredients: z.array(z.string().min(1).max(INGREDIENT_MAX)).min(1),
  recipe_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
  item_sku_id: z.string().uuid().optional(),
}).superRefine((val, ctx) => {
  if (val.slot === 'main' && val.item_sku_id !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'item_sku_id is only valid for snack/extra slots', path: ['item_sku_id'] });
  }
  if ((val.slot === 'snack' || val.slot === 'extra') && val.recipe_id !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'recipe_id is not valid for snack/extra slots', path: ['recipe_id'] });
  }
});
export type PlanComposeItem = z.infer<typeof PlanComposeItemSchema>;

const PlanComposeDaySchema = z.object({
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
  items: z.array(PlanComposeItemSchema).min(1),
});
export type PlanComposeDay = z.infer<typeof PlanComposeDaySchema>;

export const PlanComposeInputSchema = z.object({
  household_id: z.string().uuid(),
  week_of: z.string().date(),
  days: z.array(PlanComposeDaySchema).min(1),
  prompt_version: z.string().min(1),
});

// plan.compose output — carries plan_id so the BullMQ worker can build CommitPlanInput.
export const PlanComposeOutputSchema = z.object({
  plan_id: z.string().uuid(),
  household_id: z.string().uuid(),
  week_of: z.string().date(),
  days: z.array(PlanComposeDaySchema).min(1),
  prompt_version: z.string().min(1),
});

export const ConflictSchema = z.object({
  child_id: z.string().uuid(),
  allergen: z.string().min(1).max(ALLERGEN_MAX),
  ingredient: z.string().min(1).max(INGREDIENT_MAX),
  slot: z.string().min(1).max(SLOT_MAX),
  day: z.string().min(1).max(SLOT_MAX),
});

export const GuardrailResultSchema = z.discriminatedUnion('verdict', [
  z.object({ verdict: z.literal('cleared'), conflicts: z.array(ConflictSchema) }),
  z.object({ verdict: z.literal('blocked'), conflicts: z.array(ConflictSchema).min(1) }),
  z.object({
    verdict: z.literal('uncertain'),
    conflicts: z.array(ConflictSchema),
    reason: z.string().min(1).max(200),
  }),
]);

export const PlanItemForGuardrailSchema = z.object({
  child_id: z.string().uuid(),
  day: z.string().min(1).max(SLOT_MAX),
  slot: z.string().min(1).max(SLOT_MAX),
  ingredients: z.array(z.string().min(1).max(INGREDIENT_MAX)).min(1).max(INGREDIENTS_MAX),
});

export const AllergyCheckInputSchema = z.object({
  household_id: z.string().uuid(),
  plan_items: z.array(PlanItemForGuardrailSchema).min(1).max(PLAN_ITEMS_MAX),
});

export const AllergyCheckOutputSchema = GuardrailResultSchema;

// --- Story 3.5 — plan repository write/read shapes ---
// The presentation-bind contract requires an atomic write of plan + items +
// guardrail_cleared_at + guardrail_version. CommitPlanInput is the caller's
// payload to PlansRepository.commit(); the repository augments it with the
// guardrailClearedAt timestamp + guardrailVersion string at write time.
//
// PlanItemWriteSchema is intentionally a write-only superset of
// PlanItemForGuardrailSchema (adds recipe_id / item_id). Mapping happens in
// PlansService.commit() before passing items to the guardrail. ingredients
// enforces min(1) because the guardrail returns uncertain('empty_ingredients')
// for zero-ingredient items, which would exhaust all retries without fixing.

const PROMPT_VERSION_MAX = 32;
const GUARDRAIL_VERSION_MAX = 32;

export const PlanItemWriteSchema = z.object({
  child_id: z.string().uuid(),
  day: z.string().min(1).max(SLOT_MAX),
  slot: z.string().min(1).max(SLOT_MAX),
  recipe_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
  item_sku_id: z.string().uuid().optional(),  // Story 3.20 — Snack SKU reference
  ingredients: z.array(z.string().min(1).max(INGREDIENT_MAX)).min(1),
}).superRefine((val, ctx) => {
  if (val.slot === 'main' && val.item_sku_id !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'item_sku_id is only valid for snack/extra slots', path: ['item_sku_id'] });
  }
  if ((val.slot === 'snack' || val.slot === 'extra') && val.recipe_id !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'recipe_id is not valid for snack/extra slots', path: ['recipe_id'] });
  }
});

export const CommitPlanInputSchema = z.object({
  plan_id: z.string().uuid(),
  household_id: z.string().uuid(),
  week_id: z.string().uuid(),
  week_of: z.string().date(),  // Story 3.13 — ISO 8601 date string ('2026-04-28')
  revision: z.number().int().min(1),
  generated_at: z.string().datetime({ offset: true }),
  prompt_version: z.string().min(1).max(PROMPT_VERSION_MAX),
  items: z.array(PlanItemWriteSchema).min(1),
});

export const PlanRowSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  week_id: z.string().uuid(),
  week_of: z.string().date().nullable().default(null),  // Story 3.13 — null for pre-migration rows
  revision: z.number().int().min(1),
  generated_at: z.string().datetime({ offset: true }),
  guardrail_cleared_at: z.string().datetime({ offset: true }).nullable(),
  guardrail_version: z.string().max(GUARDRAIL_VERSION_MAX).nullable(),
  prompt_version: z.string().min(1).max(PROMPT_VERSION_MAX),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

// --- Story 3.6 — brief_state projection schemas ---
// PlanItemRow is the read shape returned by PlansRepository.findItemsByPlanId().
// It differs from PlanItemWriteSchema: recipe_id / item_id are nullable here
// because the DB returns null (not undefined) for unset uuid columns.
export const PlanItemRowSchema = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  child_id: z.string().uuid(),
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
  slot: z.string().min(1).max(SLOT_MAX),
  recipe_id: z.string().uuid().nullable(),
  item_id: z.string().uuid().nullable(),
  item_sku_id: z.string().uuid().nullable().default(null),  // Story 3.20 — Snack SKU reference
  ingredients: z.array(z.string().min(1)),
  paused_at: z.string().datetime({ offset: true }).nullable().default(null),  // Story 3.12
  replaced_by_plan_id: z.string().uuid().nullable().default(null),  // Story 3.13 — null = current
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

// --- Story 3.20 — Snack SKU catalog ---
// Snack items are modeled as unit-level SKUs (Apple, String Cheese, Granola
// Bar). The contains_* flags are the FALCPA top-9 allergen presence markers
// the guardrail consults instead of ingredient text matching. is_halal /
// is_kosher / is_vegetarian / is_vegan are the cultural template
// compatibility flags the planner filters against.
export const SnackSkuSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  brand: z.string().max(200).nullable(),
  category: z.string().min(1).max(64),
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

// Story 3.13 — POST /v1/plans/:planId/regenerate?scope=week|day&day=monday query params.
// day is required when scope='day' and must be absent when scope='week'.
export const RegeneratePlanQuerySchema = z.object({
  scope: z.enum(['week', 'day']),
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']).optional(),
}).refine(
  (val) => val.scope !== 'day' || val.day !== undefined,
  { message: "'day' query param is required when scope=day", path: ['day'] },
).refine(
  (val) => val.scope !== 'week' || val.day === undefined,
  { message: "'day' query param must be omitted when scope=week", path: ['day'] },
);

// Story 3.13 — 202 Accepted response body. job_id correlates to the BullMQ job for
// debugging; rate_limit_remaining tracks how many more regenerations this
// household can request this week.
export const RegeneratePlanResponseSchema = z.object({
  job_id: z.string().min(1),
  rate_limit_remaining: z.number().int().min(0),
});

// PATCH /v1/plans/:planId/items/:itemId body.
// ingredients replaces the existing set in full — client owns the complete replacement list.
// recipe_id / item_id are optional until recipe resolution lands in a future story.
export const SwapPlanItemInputSchema = z.object({
  ingredients: z
    .array(z.string().min(1).max(INGREDIENT_MAX))
    .min(1)
    .max(INGREDIENTS_MAX),
  recipe_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
});

export const SwapPlanItemResponseSchema = z.object({
  item: PlanItemRowSchema,
});

// PATCH /v1/plans/:planId/days/:day/pause body.
// reason is informational for audit; Lunch Link delivery (Epic 4) reads paused_at, not reason.
export const PausePlanDayInputSchema = z.object({
  reason: z.enum(['sick', 'absent', 'holiday']).optional(),
});

// PlanTileItemSchema is the per-child-slot entry within a day's tile.
// plan_item_id is the plan_items.id from the DB — Story 3.12 exposes it so the
// client can call PATCH /v1/plans/:planId/items/:itemId without a separate lookup.
// Optional because pre-3.12 brief_state rows will not have it in their JSON.
const PlanTileItemSchema = z.object({
  plan_item_id: z.string().uuid().nullable().default(null),  // Story 3.12 — DB row id for PATCH; null for pre-3.12 brief_state rows
  child_id: z.string().uuid(),
  slot: z.string().min(1).max(SLOT_MAX),
  ingredients: z.array(z.string().min(1)),
  recipe_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
});

export const PlanTileSummarySchema = z.object({
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
  items: z.array(PlanTileItemSchema),
  paused: z.boolean().default(false),  // Story 3.12: true when all items for the day are paused
});

// Story 3.10 — populated by brief-state.composer; one entry per
// (child_id, allergen) pair the guardrail cleared for the current plan.
// child_name is plain (decrypted) and crosses the wire over the JWT-gated
// brief query (same exposure model as GET /v1/households/:id/children/:childId).
export const ClearedAllergyEntrySchema = z.object({
  child_id: z.string().uuid(),
  child_name: z.string().min(1).max(100),
  allergen: z.string().min(1).max(100),
});

// Story 3.11 — populated by brief-state.composer when scaffolding-level
// mutations exist since the last plan view. null when the plan is unchanged
// or mutations are safety/dietary (those are loud, not quiet per UX-DR19).
export const ScaffoldingDiffSchema = z.object({
  summary: z.string().min(1).max(200),
  explanation: z.string().min(1).max(500).optional(),
});

export const BriefStateRowSchema = z.object({
  household_id: z.string().uuid(),
  plan_id: z.string().uuid().nullable().default(null),  // Story 3.12 — null for pre-migration rows
  moment_headline: z.string(),
  lumi_note: z.string(),
  memory_prose: z.string(),
  plan_tile_summaries: z.array(PlanTileSummarySchema),
  cleared_allergies: z.array(ClearedAllergyEntrySchema).default([]),
  scaffolding_diff: ScaffoldingDiffSchema.nullable().default(null),
  generated_at: z.string().datetime({ offset: true }),
  plan_revision: z.number().int().min(0),
  updated_at: z.string().datetime({ offset: true }),
});

// API response for GET /v1/households/:id/brief.
// brief is null when no projection exists yet (no plan committed for this household).
export const BriefResponseSchema = z.object({
  brief: BriefStateRowSchema.nullable(),
});

// Story 3.14 — GET /v1/plans?week=current|next
// Drives the upcoming-week tab on the brief surface (FR21). week=next is enabled
// from Friday afternoon onward; pre-clearance drafts return plan=null so the
// client can render the "Lumi is drafting next week" loading state.
export const GetPlansQuerySchema = z.object({
  week: z.enum(['current', 'next']).default('current'),
});

// is_draft mirrors the (week === 'next') decision so the frontend doesn't
// recompute date math; week_of is always the ISO Monday for the resolved week.
export const GetPlansResponseSchema = z.object({
  plan: PlanRowSchema.nullable(),
  plan_items: z.array(PlanItemRowSchema),
  is_draft: z.boolean(),
  week_of: z.string().date(),
});

// --- Story 3.15 — historical plans + outcomes view (FR25) ---
// Each archived plan_item row (replaced_by_plan_id IS NOT NULL) is one swap
// event from a slot-swap (Story 3.12) or a day/week regeneration (Story 3.13).
// previous_ingredients are the ingredients that existed BEFORE the swap;
// the route handler derives this directly from the archived row's columns.
// child_id is preserved so multi-child households can attribute each swap.
export const PlanItemSwapSummarySchema = z.object({
  child_id: z.string().uuid(),
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
  slot: z.string().min(1),
  previous_ingredients: z.array(z.string()),
  replaced_at: z.string().datetime({ offset: true }),
});

// Story 3.15 — route param schema for GET /v1/plans/:weekId/history.
export const PlanWeekIdParamSchema = z.object({
  weekId: z.string().uuid(),
});

// Story 3.15 — response shape for GET /v1/plans/:weekId/history.
//   Missing weekId → 404 (service throws NotFoundError); this 200 shape always
//   carries a non-null plan. week_of may be null for pre-3.13 rows that have no
//   stored Monday date.
//   plan_items is the FINAL (current, non-archived) item set — what actually shipped.
//   swap_history is the per-slot audit derived from archived rows.
//   ratings is keyed by child_id → emoji string (Layer 1 from FR36). It is always {}
//   until Epic 4 Story 4.14 populates it from lunch_link_sessions.rating; the field
//   is typed up front so the contract stays stable when Epic 4 ships.
export const PlanHistoryResponseSchema = z.object({
  plan: PlanRowSchema,
  plan_items: z.array(PlanItemRowSchema),
  swap_history: z.array(PlanItemSwapSummarySchema),
  week_of: z.string().date().nullable(),
  ratings: z.record(z.string().uuid(), z.string().min(1).nullable()),
});

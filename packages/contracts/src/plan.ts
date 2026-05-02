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

// Story 3.4 — plan.compose tool I/O. Output IS a WeeklyPlan; aliasing rather
// than duplicating the schema keeps intent explicit while letting future
// WeeklyPlan changes flow through automatically.
export const PlanComposeInputSchema = z.object({
  household_id: z.string().uuid(),
  week_of: z.string().date(),
  days: z.array(DayPlan),
  prompt_version: z.string(),
});

export const PlanComposeOutputSchema = WeeklyPlan;

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
  ingredients: z.array(z.string().min(1).max(INGREDIENT_MAX)).min(1),
});

export const CommitPlanInputSchema = z.object({
  plan_id: z.string().uuid(),
  household_id: z.string().uuid(),
  week_id: z.string().uuid(),
  revision: z.number().int().min(1),
  generated_at: z.string().datetime(),
  prompt_version: z.string().min(1).max(PROMPT_VERSION_MAX),
  items: z.array(PlanItemWriteSchema).min(1),
});

export const PlanRowSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  week_id: z.string().uuid(),
  revision: z.number().int().min(1),
  generated_at: z.string().datetime(),
  guardrail_cleared_at: z.string().datetime().nullable(),
  guardrail_version: z.string().max(GUARDRAIL_VERSION_MAX).nullable(),
  prompt_version: z.string().min(1).max(PROMPT_VERSION_MAX),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

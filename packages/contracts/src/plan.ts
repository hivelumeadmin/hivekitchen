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

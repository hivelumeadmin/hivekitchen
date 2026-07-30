import { z } from 'zod';
import {
  PlanMainAssignmentRowSchema,
  PlanSlotRowSchema,
  PlanSlotVariationRowSchema,
} from './plan.js';

// Epic 13-s9 / routing-spec §4–6 — wire shapes for the conversational
// plan-edit endpoint (POST /v1/plans/:planId/edit).
//
// PLAN_INTENT / PlanIntentResultSchema double as the classifier's structured
// output AND a wire shape: the chip-tap bypass POSTs a pre-built
// PlanIntentResult (confidence 1.0), so a structured affordance costs zero
// LLM calls (routing-spec §5).

export const PLAN_INTENT = {
  // T0 — deterministic downstream (no further LLM)
  INSPECT: 'inspect', // "show me Tuesday"
  EXPLAIN: 'explain', // "why this main?"
  COMMIT: 'commit', // "confirm the week"
  AFFIRM: 'affirm', // "looks great"
  SWAP_SLOT: 'swap_slot', // "swap Tuesday's main" -> CatalogRepo.pickRecipe
  EXCLUDE_FILTER: 'exclude_filter', // "no fish this week" -> pick with constraint
  VARY_SLOT: 'vary_slot', // "less spicy" -> plan_slot_variations write
  SAFETY_WRITE: 'safety_write', // "add a peanut allergy" -> household_allergens write
  // T2 — expensive agentic path
  ADD_DISH: 'add_dish', // net-new dish not in catalog
  RECOMPOSE: 'recompose', // "redo the whole week"
  COMPOSE_NEXT: 'compose_next', // "draft next week"
  // T1 — cheap reply only
  FALLBACK: 'fallback',
} as const;

export type PlanIntent = (typeof PLAN_INTENT)[keyof typeof PLAN_INTENT];

const INTENT_VALUES = Object.values(PLAN_INTENT) as [PlanIntent, ...PlanIntent[]];

// Flat args (simpler + fewer strict-mode pitfalls than a nested `slots`
// object). Slot fields are `.optional()`; the strict adapter emits them as
// `anyOf:[T,null]`, the model returns explicit nulls, and stripNulls drops
// them before parse (the bea6d4b rule).
export const PlanIntentResultSchema = z.object({
  intent: z.enum(INTENT_VALUES),
  confidence: z.number().min(0).max(1),
  // 'sat' included (14-s4): WeekdaySchema admits saturday plan days and the
  // day-detail sheet can arm a Saturday-scoped edit.
  day: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat']).optional(),
  slotKind: z.enum(['main', 'snack', 'extra']).optional(),
  childId: z.string().optional(), // resolved from context ("Maya" -> id)
  allergen: z.string().optional(), // for safety_write: canonical allergen name
  constraint: z.string().optional(), // normalized: "exclude:fish" | "time:down"
  variation: z.string().optional(), // normalized: "spice:down" | "portion:down"
  dishQuery: z.string().optional(), // for add_dish
  scope: z.enum(['slot', 'day', 'week']).optional(),
});

export const PlanEditParamSchema = z.object({
  planId: z.string().uuid(),
});

const UTTERANCE_MAX = 500;

// Either a free-text utterance (routed through the 'mini'-tier classifier) or
// a pre-built intent (chip tap — zero LLM). Exactly one of the two.
export const PlanEditInputSchema = z.union([
  z.object({ utterance: z.string().min(1).max(UTTERANCE_MAX) }).strict(),
  z.object({ intent: PlanIntentResultSchema }).strict(),
]);

export const DispatchTierSchema = z.enum(['T0', 'T1', 'T2']);

export const PlanEditEscalateReasonSchema = z.enum([
  'catalog_miss',
  'add_dish',
  'recompose',
  'compose_next',
]);

const PlanEditTargetSchema = z.object({
  day: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat']).optional(),
  slotKind: z.enum(['main', 'snack', 'extra']).optional(),
  childId: z.string().optional(),
});

// Epic 13-s10 — a slot the safety_write week re-screen deterministically
// re-picked to clear the newly-declared allergen. Carries the authoritative
// row (main assignment or plan slot) so the client can reconcile immediately;
// the plan.updated SSE invalidate remains the authoritative reconciler.
export const PlanEditFixedSlotSchema = z.object({
  main_assignment: PlanMainAssignmentRowSchema.optional(),
  slot: PlanSlotRowSchema.optional(),
});

// The typed outcome of route → dispatch → execute. 'applied' carries the row
// the existing swap/vary services returned; 'escalate' is the confirm gate —
// the expensive path has NOT fired (13-s10 wires the confirm-then-fire UX).
export const PlanEditResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('applied'),
    action: z.enum(['swap_main', 'swap_slot', 'swap_snack', 'vary', 'safety_write']),
    main_assignment: PlanMainAssignmentRowSchema.optional(),
    slot: PlanSlotRowSchema.optional(),
    variation: PlanSlotVariationRowSchema.optional(),
    allergen: z.string().optional(),
    inserted: z.boolean().optional(),
    // Epic 13-s10 (AC7) — placed slots the safety_write re-screen re-picked to
    // clear the new allergen. Omitted/empty when nothing needed fixing.
    fixed_slots: z.array(PlanEditFixedSlotSchema).optional(),
  }),
  z.object({
    status: z.literal('acknowledged'),
    action: z.enum(['noop', 'commit']),
    // Epic 13-s10 — 'commit' carries the confirmed timestamp so the surface can
    // reflect the confirmed state immediately (re-confirm returns the existing
    // timestamp with the same shape). Absent on 'noop' (affirm).
    confirmed_at: z.string().datetime({ offset: true }).optional(),
  }),
  z.object({
    status: z.literal('read'),
    target: PlanEditTargetSchema,
  }),
  z.object({
    status: z.literal('clarify'),
    reason: z.string(),
  }),
  z.object({
    status: z.literal('escalate'),
    reason: PlanEditEscalateReasonSchema,
    dishQuery: z.string().optional(),
  }),
]);

export const PlanEditResponseSchema = z.object({
  intent: PlanIntentResultSchema,
  tier: DispatchTierSchema,
  result: PlanEditResultSchema,
});

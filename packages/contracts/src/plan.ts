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

// Story 3-DM-C1 Phase 9b part 4 step 5 — flat plan.compose schemas
// (PlanComposeItemSchema / PlanComposeDaySchema / PlanComposeInputSchema /
// PlanComposeOutputSchema) retired with the plan_items array. The canonical
// tree-shape replacements live further down: PlanComposeTreeInputSchema /
// PlanComposeTreeOutputSchema (main_assignments + days[].slots[].variations).

// Story 3.27 — Lumi-proposed preparation-method variant. The planner may
// include ONE proposal per plan output when at least one child has
// `variant_eligible=true`. Variants are method changes (baked vs pan-fried),
// not ingredient swaps — that is Story 3.24. The (child_id, day, slot) tuple
// uniquely identifies the plan item being varied — the service layer maps it
// to the committed plan_items row id at persist time.
export const PlanVariantProposalOutputSchema = z.object({
  child_id: z.string().uuid(),
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']),
  slot: z.string().min(1).max(SLOT_MAX),
  base_method: z.string().min(1),
  variant_method: z.string().min(1),
  variant_description: z.string().min(1),
});

// Story 3-DM-C1 Phase 9b part 4 step 5 — flat PlanComposeOutputSchema
// retired with the plan_items array. The canonical replacement is
// PlanComposeTreeOutputSchema further down.

// Story 3.27 — DB row + confirm endpoint shapes.
export const VariantProposalSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  child_id: z.string().uuid(),
  plan_item_id: z.string().uuid(),
  plan_id: z.string().uuid(),
  base_recipe_name: z.string(),
  base_method: z.string(),
  variant_description: z.string(),
  variant_method: z.string(),
  proposed_at: z.string().datetime({ offset: true }),
  confirmed_at: z.string().datetime({ offset: true }).nullable(),
  rejected_at: z.string().datetime({ offset: true }).nullable(),
});

// POST /v1/plans/:planId/variant-proposals/:proposalId/confirm body.
export const ConfirmVariantProposalInputSchema = z.object({
  choice: z.enum(['try_variant', 'keep_original']),
});

export const ConflictSchema = z.object({
  child_id: z.string().uuid(),
  allergen: z.string().min(1).max(ALLERGEN_MAX),
  ingredient: z.string().min(1).max(INGREDIENT_MAX),
  slot: z.string().min(1).max(SLOT_MAX),
  day: z.string().min(1).max(SLOT_MAX),
});

// Story 3.24 — compound-ingredient flagged items. Emitted by the guardrail
// engine when a child's plan item contains a compound/processed product whose
// allergen content cannot be determined from the ingredient string alone
// (e.g., "garam masala", "ranch dressing"). Distinct from `ConflictSchema`
// because there is no known matched allergen — only the suspect ingredient
// and the slot it occupies.
export const FlaggedCompoundItemSchema = z.object({
  child_id: z.string().uuid(),
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
    // Story 3.24 — populated when `reason === 'compound_ingredient_unverified'`.
    // Empty/omitted for infrastructure-uncertain variants (empty_ingredients,
    // no_rules_loaded, falcpa_baseline_missing, etc.) — those are not
    // recoverable via substitution.
    flagged_items: z.array(FlaggedCompoundItemSchema).optional(),
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

// Story 3-DM-C1 Phase 9b part 4 step 5 — flat plan repository schemas
// (PlanItemWriteSchema / CommitPlanInputSchema / flat PlanRowSchema /
// PlanItemRowSchema) retired with the plan_items table. The canonical
// PlanRowSchema (no week_id, +state fields) takes over via the rename of
// PlanRowSchema further down; CommitPlanTreeInputSchema is the
// commit payload; the row reads land via PlanMainAssignmentRowSchema /
// PlanDayRowSchema / PlanSlotRowSchema / PlanSlotVariationRowSchema.

const PROMPT_VERSION_MAX = 32;
const GUARDRAIL_VERSION_MAX = 32;

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

// Story 3-DM-C1 Phase 9b part 4 step 5 — the flat swap + pause schemas
// (SwapPlanItemInputSchema / SwapPlanItemResponseSchema /
// PausePlanDayInputSchema) retired with PATCH /items/:itemId. The canonical
// replacements are SwapMainInputSchema / UpdateVariationInputSchema /
// SwapSlotRecipeInputSchema / PausePlanDayTreeInputSchema, defined
// further down.

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
  // Story 3-S40 — snack-SKU slots carry snack_sku_id instead of recipe_id.
  snack_sku_id: z.string().uuid().optional(),
  // Story 3-S40 (AC6) — resolved display label for the tile dish line. Today
  // only snack-SKU slots populate it (snack_skus.name); recipe-name projection
  // for mains/extras is a separate follow-up.
  name: z.string().optional(),
});

export const PlanTileSummarySchema = z.object({
  day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
  items: z.array(PlanTileItemSchema),
  paused: z.boolean().default(false),  // Story 3.12: true when all items for the day are paused
  // Story 3.28: child UUIDs whose lunch_link_sessions row for this day has suppressed_at set.
  lunch_link_suppressed_children: z.array(z.string().uuid()).default([]),
  // Story 4-S4: keyed by child_id UUID; only children who have submitted a
  // rating for this day appear in the map. Absent key = no rating yet.
  child_ratings: z.record(z.string().uuid(), z.enum(['loved', 'ok', 'not-really'])).default({}),
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

// Story 3-DM-D1 — single payload column shape for brief_state. Consolidates
// the four loose JSONB columns (tile_summaries / cleared_allergies /
// scaffolding_diff) plus the plan_state mirror into one validated object.
// Source of truth for plan state lives on plans.state; the plan_state* fields
// here are a mirror for routes that read brief_state only (the Brief route at
// GET /v1/households/:id/brief). All sub-fields carry defaults so parsing the
// column default '{}' (a brand-new, content-less row) succeeds cleanly.
// Slice 5-S8 — "I noticed" learning moment. Surfaced in the Brief footer when
// Lumi has noticed ≥3 turn-sourced memory nodes about the household. node_ids
// references the memory_nodes that contributed; surfaced_at marks when the
// callout was composed.
export const LearningMomentCalloutSchema = z.object({
  prose: z.string().min(1).max(400),
  node_ids: z.array(z.string().uuid()).min(1).max(5),
  surfaced_at: z.string().datetime({ offset: true }),
});

// Slice 5-S8 — respond-action for POST /v1/households/:id/brief/learning-moment.
export const LearningMomentActionSchema = z.enum(['confirm', 'tell_more', 'dismiss']);
export const RespondToLearningMomentRequestSchema = z.object({
  action: LearningMomentActionSchema,
});

export const BriefStatePayloadSchema = z.object({
  tile_summaries: z.array(PlanTileSummarySchema).default([]),
  cleared_allergies: z.array(ClearedAllergyEntrySchema).default([]),
  scaffolding_diff: ScaffoldingDiffSchema.nullable().default(null),
  // plan_state mirror — source of truth is plans.state. Null when no
  // degradation/failure.
  plan_state: z.enum(['hard_failed', 'degraded']).nullable().default(null),
  plan_state_set_at: z.string().datetime({ offset: true }).nullable().default(null),
  plan_state_message: z.string().max(500).nullable().default(null),
  // 5-S8 — "I noticed" learning moment callout. Null when below threshold or suppressed.
  learning_moment_callout: LearningMomentCalloutSchema.nullable().default(null),
  // 5-S8 — suppress window after dismiss action. Null means no active suppress.
  learning_moment_suppressed_until: z.string().datetime({ offset: true }).nullable().default(null),
  // 5-S9 — "Why this?" plan reasoning, cached from the planner at commit time.
  // Carries forward on non-commit refreshes (swap/variation/pause). Null when
  // no plan has set it yet. Lives entirely in this JSONB payload — no migration.
  plan_reasoning: z.string().nullable().default(null),
});

export const BriefStateRowSchema = z.object({
  household_id: z.string().uuid(),
  plan_id: z.string().uuid().nullable().default(null),  // Story 3.12 — null for pre-migration rows
  moment_headline: z.string(),
  lumi_note: z.string(),
  memory_prose: z.string(),
  // Story 3-DM-D1 — the four loose JSONB columns + the plan_state mirror now
  // live inside one validated payload object (see BriefStatePayloadSchema).
  payload: BriefStatePayloadSchema,
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

// Story 3.25 — hard-fail status payload. Present in GetPlansResponse only when
// plan===null && !isDraft && a plan.hard_fail audit row exists for the
// (household, week_of). Drives the AccountableError UX on the brief surface.
export const HardFailStatusSchema = z.object({
  week_of: z.string().date(),
  failed_at: z.string().datetime(),
});

// Story 3-DM-C1 Phase 9b part 4 step 5 — flat GetPlansResponseSchema /
// PlanItemSwapSummarySchema / PlanHistoryResponseSchema retired with
// plan_items. The canonical replacements live further down:
// GetPlansResponseSchema, PlanHistoryResponseSchema (carrying
// main_assignments + days + slots + variations). PlanWeekIdParamSchema
// stays — it's just a route param schema, shape-neutral.

// Story 3.15 — route param schema for GET /v1/plans/:weekOf/history.
// week_id dropped (migration 20261010000000); canonical param is now the
// Monday date string (YYYY-MM-DD) that the client derives from its local date.
export const PlanWeekIdParamSchema = z.object({
  weekOf: z.string().date(),
});

// ===========================================================================
// Story 3-DM-C1 — Plan structure canonical (tree shape).
//
// Phase 2 (this file): ADD the tree-shape schemas alongside the flat ones so
// the codebase keeps compiling during the cutover window. The flat schemas
// above (PlanComposeItemSchema, PlanComposeOutputSchema, PlanItemRowSchema,
// PlanItemWriteSchema, CommitPlanInputSchema) stay in place until Phase 9.
//
// Phase 3 (PlansRepository) + Phase 4 (BriefStateComposer) swap consumers
// from the flat schemas to the tree schemas below.
// Phase 5 (orchestrator + planner prompt) swaps the agent tool to use
// PlanComposeTreeInputSchema / PlanComposeTreeOutputSchema.
// Phase 7 (plan-generation.job) swaps the RPC call to CommitPlanTreeInputSchema.
// Phase 9 deletes the legacy flat schemas + applies the migration.
//
// Migration target: supabase/migrations/20261010000000_plan_structure_canonical.sql
// Canonical reference: _bmad-output/planning-artifacts/canonical-data-model-design.md §3.
// ===========================================================================

const VARIATION_TEXT_MAX = 280;
const VARIATION_CUTTING_MAX = 80;
const VARIATION_CONTAINER_MAX = 60;
const VARIATION_ADDON_MAX = 64;
const VARIATION_REMOVAL_MAX = 64;
const PAUSED_NOTE_MAX = 200;
const STATE_MESSAGE_MAX = 500;
const MAIN_ASSIGNMENT_SEQ_MAX = 6;     // Mon-Sat ceiling per Q3.
const VARIATIONS_PER_SLOT_MAX = 12;    // Soft upper bound; real households have <=5.
const SLOTS_PER_DAY_MAX = 3;           // main + snack + extra.
const DAYS_PER_PLAN_MAX = 6;           // Mon-Sat.
const MAIN_ASSIGNMENTS_PER_PLAN_MAX = 6;

// ---- Enums (mirror the DB enums declared in §3.2 of the migration) -------

export const WeekdaySchema = z.enum([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]);

export const SlotKindSchema = z.enum(['main', 'snack', 'extra']);

export const ExtraKindSchema = z.enum([
  'drink',
  'extra_snack',
  'protein_boost',
  'sports_add',
  'sweet',
  'toddler_safe',
  'allergy_substitute',
  'custom',
]);

export const PortionSizeSchema = z.enum(['small', 'regular', 'large']);

export const TextureLevelSchema = z.enum(['soft', 'normal', 'diced', 'finger']);

export const SpiceLevelSchema = z.enum(['mild', 'regular', 'spicy']);

export const PauseReasonSchema = z.enum([
  'sick_day',
  'holiday',
  'snow_day',
  'field_trip',
  'half_day',
  'other',
]);

// ---- DB row shapes (what PlansRepository.find* returns post-cutover) -----

export const PlanMainAssignmentRowSchema = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  sequence: z.number().int().min(1).max(MAIN_ASSIGNMENT_SEQ_MAX),
  recipe_id: z.string().uuid(),
  created_at: z.string().datetime({ offset: true }),
});

export const PlanDayRowSchema = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  day: WeekdaySchema,
  paused_at: z.string().datetime({ offset: true }).nullable().default(null),
  paused_reason: PauseReasonSchema.nullable().default(null),
  paused_note: z.string().max(PAUSED_NOTE_MAX).nullable().default(null),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).superRefine((val, ctx) => {
  // Mirrors plan_days_pause_consistency CHECK constraint at the contract layer
  // so a malformed read fails loudly rather than silently rendering a half-
  // paused day. The DB CHECK is the source of truth; this is defense-in-depth.
  const anyPaused = val.paused_at !== null || val.paused_reason !== null || val.paused_note !== null;
  const allPauseRequired = val.paused_at !== null && val.paused_reason !== null;
  if (anyPaused && !allPauseRequired) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'paused_at + paused_reason must both be set when any pause field is set',
      path: ['paused_at'],
    });
  }
});

export const PlanSlotRowSchema = z.object({
  id: z.string().uuid(),
  plan_day_id: z.string().uuid(),
  slot_kind: SlotKindSchema,
  main_assignment_id: z.string().uuid().nullable().default(null),
  recipe_id: z.string().uuid().nullable().default(null),
  extra_kind: ExtraKindSchema.nullable().default(null),
  // Story 3-S40: snack slots may carry snack_sku_id instead of recipe_id.
  snack_sku_id: z.string().uuid().nullable().default(null),
  paused_at: z.string().datetime({ offset: true }).nullable().default(null),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).superRefine((val, ctx) => {
  // Mirrors the three plan_slots_* CHECK constraints from the migration.
  // Catches malformed reads OR malformed in-memory constructions before they
  // reach the DB.
  if (val.slot_kind === 'main') {
    if (val.main_assignment_id === null || val.recipe_id !== null || val.extra_kind !== null || val.snack_sku_id !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'slot_kind=main requires main_assignment_id; recipe_id, extra_kind, snack_sku_id must be null',
        path: ['slot_kind'],
      });
    }
  } else if (val.slot_kind === 'snack') {
    // Exactly one of recipe_id / snack_sku_id must be set.
    const hasRecipe = val.recipe_id !== null;
    const hasSku = val.snack_sku_id !== null;
    if (!(hasRecipe !== hasSku) || val.main_assignment_id !== null || val.extra_kind !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'slot_kind=snack requires exactly one of recipe_id or snack_sku_id; main_assignment_id and extra_kind must be null',
        path: ['slot_kind'],
      });
    }
  } else {
    // 'extra'
    if (val.recipe_id === null || val.main_assignment_id !== null || val.extra_kind === null || val.snack_sku_id !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'slot_kind=extra requires recipe_id + extra_kind; main_assignment_id and snack_sku_id must be null',
        path: ['slot_kind'],
      });
    }
  }
});

export const PlanSlotVariationRowSchema = z.object({
  id: z.string().uuid(),
  plan_slot_id: z.string().uuid(),
  child_id: z.string().uuid(),
  portion_size: PortionSizeSchema,
  texture: TextureLevelSchema,
  spice_level: SpiceLevelSchema,
  cutting_style: z.string().max(VARIATION_CUTTING_MAX).nullable().default(null),
  container: z.string().max(VARIATION_CONTAINER_MAX).nullable().default(null),
  add_ons: z.array(z.string().min(1).max(VARIATION_ADDON_MAX)).default([]),
  removals: z.array(z.string().min(1).max(VARIATION_REMOVAL_MAX)).default([]),
  notes: z.string().max(VARIATION_TEXT_MAX).nullable().default(null),
  paused_at: z.string().datetime({ offset: true }).nullable().default(null),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

// Canonical plans row post-cutover. The legacy PlanRowSchema above stays in
// place until Phase 9 — that one still includes week_id (current DB shape)
// and a nullable week_of. This canonical shape drops week_id and requires
// week_of; absorbs state / state_set_at / state_message from brief_state.
export const PlanRowSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  week_of: z.string().date(),
  revision: z.number().int().min(1),
  generated_at: z.string().datetime({ offset: true }),
  guardrail_cleared_at: z.string().datetime({ offset: true }).nullable(),
  guardrail_version: z.string().max(GUARDRAIL_VERSION_MAX).nullable(),
  prompt_version: z.string().min(1).max(PROMPT_VERSION_MAX),
  state: z.enum(['hard_failed', 'degraded']).nullable().default(null),
  state_set_at: z.string().datetime({ offset: true }).nullable().default(null),
  state_message: z.string().max(STATE_MESSAGE_MAX).nullable().default(null),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

// ---- Planner tree input shapes (what plan.compose tool I/O carries) -------

// One per-child Variation as emitted by the planner. Defaults match the
// DB column defaults so an omitted field round-trips cleanly through the RPC.
export const PlannerVariationInputSchema = z.object({
  child_id: z.string().uuid(),
  portion_size: PortionSizeSchema.optional(),
  texture: TextureLevelSchema.optional(),
  spice_level: SpiceLevelSchema.optional(),
  cutting_style: z.string().max(VARIATION_CUTTING_MAX).optional(),
  container: z.string().max(VARIATION_CONTAINER_MAX).optional(),
  add_ons: z.array(z.string().min(1).max(VARIATION_ADDON_MAX)).max(20).optional(),
  removals: z.array(z.string().min(1).max(VARIATION_REMOVAL_MAX)).max(20).optional(),
  notes: z.string().max(VARIATION_TEXT_MAX).optional(),
  paused_at: z.string().datetime({ offset: true }).optional(),
});

// One slot as emitted by the planner. main_assignment_sequence is the
// SYMBOLIC handle the planner uses to point at the right M1/M2/M3 row —
// the RPC resolves it against the just-inserted plan_main_assignments.
// XOR enforcement mirrors the DB's plan_slots_* CHECK constraints so bad
// output is caught at parse time, not at INSERT.
export const PlannerSlotInputSchema = z.object({
  slot_kind: SlotKindSchema,
  main_assignment_sequence: z.number().int().min(1).max(MAIN_ASSIGNMENT_SEQ_MAX).optional(),
  // Accepts UUID or recipe name — plan.compose resolves non-UUIDs via name lookup.
  recipe_id: z.string().min(1).optional(),
  recipe_candidate_id: z.string().uuid().optional(),
  extra_kind: ExtraKindSchema.optional(),
  // Story 3-S40: snack slots injected by SnackRotationService carry snack_sku_id
  // instead of recipe_id. Mutually exclusive with recipe_id / recipe_candidate_id.
  snack_sku_id: z.string().uuid().optional(),
  variations: z.array(PlannerVariationInputSchema).max(VARIATIONS_PER_SLOT_MAX).default([]),
}).superRefine((val, ctx) => {
  if (val.slot_kind === 'main') {
    if (val.main_assignment_sequence === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'slot_kind=main requires main_assignment_sequence',
        path: ['main_assignment_sequence'],
      });
    }
    if (val.recipe_id !== undefined || val.extra_kind !== undefined || val.snack_sku_id !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'slot_kind=main must not carry recipe_id, extra_kind, or snack_sku_id',
        path: ['slot_kind'],
      });
    }
  } else if (val.slot_kind === 'snack') {
    // Story 3-S40: snack slots accept recipe_id / recipe_candidate_id (legacy LLM
    // path) OR snack_sku_id (SnackRotationService path). Exactly one must be set.
    const hasRecipe = val.recipe_id !== undefined || val.recipe_candidate_id !== undefined;
    const hasSku = val.snack_sku_id !== undefined;
    if (!hasRecipe && !hasSku) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'slot_kind=snack requires recipe_id, recipe_candidate_id, or snack_sku_id',
        path: ['recipe_id'],
      });
    }
    if (hasRecipe && hasSku) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'slot_kind=snack: snack_sku_id is mutually exclusive with recipe_id / recipe_candidate_id',
        path: ['snack_sku_id'],
      });
    }
    if (val.main_assignment_sequence !== undefined || val.extra_kind !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'slot_kind=snack must not carry main_assignment_sequence or extra_kind',
        path: ['slot_kind'],
      });
    }
  } else {
    // 'extra'
    const hasRecipe = val.recipe_id !== undefined || val.recipe_candidate_id !== undefined;
    if (!hasRecipe || val.extra_kind === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'slot_kind=extra requires both recipe_id (or recipe_candidate_id) and extra_kind',
        path: ['slot_kind'],
      });
    }
    if (val.main_assignment_sequence !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'slot_kind=extra must not carry main_assignment_sequence',
        path: ['main_assignment_sequence'],
      });
    }
    if (val.snack_sku_id !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'slot_kind=extra must not carry snack_sku_id',
        path: ['snack_sku_id'],
      });
    }
  }
  if (val.recipe_id !== undefined && val.recipe_candidate_id !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'recipe_id and recipe_candidate_id are mutually exclusive',
      path: ['recipe_candidate_id'],
    });
  }
});

// One day as emitted by the planner. paused_at + paused_reason CHECK
// consistency mirrors plan_days_pause_consistency. paused_note is optional.
export const PlannerDayInputSchema = z.object({
  day: WeekdaySchema,
  paused_at: z.string().datetime({ offset: true }).optional(),
  paused_reason: PauseReasonSchema.optional(),
  paused_note: z.string().max(PAUSED_NOTE_MAX).optional(),
  slots: z.array(PlannerSlotInputSchema).min(1).max(SLOTS_PER_DAY_MAX),
}).superRefine((val, ctx) => {
  const anyPaused = val.paused_at !== undefined || val.paused_reason !== undefined;
  const bothPaused = val.paused_at !== undefined && val.paused_reason !== undefined;
  if (anyPaused && !bothPaused) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'paused_at + paused_reason must both be set when either is set',
      path: ['paused_at'],
    });
  }
});

// One M1/M2/M3 main assignment as emitted by the planner. Sequence is the
// symbolic handle the slot rows reference via main_assignment_sequence.
export const PlannerMainAssignmentInputSchema = z.object({
  sequence: z.number().int().min(1).max(MAIN_ASSIGNMENT_SEQ_MAX),
  // Accepts either a UUID (from id field) or a recipe name string.
  // plan.compose tool resolves non-UUID values to UUIDs via catalog name lookup.
  recipe_id: z.string().min(1),
});

// Full planner tree input — what the agent emits and the orchestrator passes
// to the RPC. plan.compose's input schema reshapes from flat to tree here.
// main_assignments allows empty (min:0) for the swap agent, which only changes
// variations and doesn't need to re-declare main recipes. The orchestrator
// injects prompt_version before calling this tool from the swap path.
// CommitPlanTreeInputSchema re-enforces main_assignments.min(1) at commit time.
export const PlanComposeTreeInputSchema = z.object({
  household_id: z.string().uuid(),
  week_of: z.string().date(),
  main_assignments: z
    .array(PlannerMainAssignmentInputSchema)
    .min(0)
    .max(MAIN_ASSIGNMENTS_PER_PLAN_MAX),
  days: z.array(PlannerDayInputSchema).min(1).max(DAYS_PER_PLAN_MAX),
  prompt_version: z.string().min(1).max(PROMPT_VERSION_MAX),
  // Slice 3.5-s2 — "Why this?" planner reasoning. Mirrors
  // PlanComposeTreeOutputSchema.reasoning. Present on the INPUT schema so that
  // OpenAI strict structured output (which strips out-of-schema fields) keeps
  // it, letting plan.tools.ts recover it from the parsed input rather than the
  // raw tool args. Independent string field — does not interact with the
  // structural cross-reference checks in .superRefine() below.
  reasoning: z.string().max(600).optional(),
}).superRefine((val, ctx) => {
  // Cross-validate slot.main_assignment_sequence against the assignments
  // array. This is contract-layer defense; the RPC also fails if the lookup
  // map misses, but parser-level rejection produces a cleaner error.
  const declaredSeqs = new Set(val.main_assignments.map((a) => a.sequence));
  for (const [dayIdx, day] of val.days.entries()) {
    for (const [slotIdx, slot] of day.slots.entries()) {
      if (slot.slot_kind === 'main' && slot.main_assignment_sequence !== undefined) {
        if (!declaredSeqs.has(slot.main_assignment_sequence)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `slot main_assignment_sequence=${String(slot.main_assignment_sequence)} not declared in main_assignments`,
            path: ['days', dayIdx, 'slots', slotIdx, 'main_assignment_sequence'],
          });
        }
      }
    }
  }
  // Sequence uniqueness within main_assignments (matches DB UNIQUE).
  const seenSeqs = new Set<number>();
  for (const [i, a] of val.main_assignments.entries()) {
    if (seenSeqs.has(a.sequence)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `main_assignments.sequence=${String(a.sequence)} appears more than once`,
        path: ['main_assignments', i, 'sequence'],
      });
    }
    seenSeqs.add(a.sequence);
  }
});

// Planner tree output — input plus plan_id and the optional variant_proposal /
// degraded_reason fields that the existing flat output carries.
export const PlanComposeTreeOutputSchema = z.object({
  plan_id: z.string().uuid(),
  household_id: z.string().uuid(),
  week_of: z.string().date(),
  main_assignments: z
    .array(PlannerMainAssignmentInputSchema)
    .min(0)
    .max(MAIN_ASSIGNMENTS_PER_PLAN_MAX),
  days: z.array(PlannerDayInputSchema).min(1).max(DAYS_PER_PLAN_MAX),
  prompt_version: z.string().min(1).max(PROMPT_VERSION_MAX),
  // Story 3.27 carry-through.
  variant_proposal: PlanVariantProposalOutputSchema.optional(),
  // Story 3.29 carry-through.
  degraded_reason: z.enum(['CULTURAL_INTERSECTION_EMPTY']).nullable().optional(),
  // Slice 5-S9 — "Why this?" plan reasoning. The planner emits a short prose
  // rationale (2-3 sentences) for the week's choices; cached into
  // brief_state.payload.plan_reasoning at commit time (never LLM-on-scroll).
  reasoning: z.string().max(600).optional(),
});

// ---- Repository commit input (what PlansRepository.commit() passes to RPC) -

// Mirrors the new commit_plan() signature in the migration. Repository wraps
// this for callers; the inferred type is CommitPlanTreeInput in @hivekitchen/types.
export const CommitPlanTreeInputSchema = z.object({
  plan_id: z.string().uuid(),
  household_id: z.string().uuid(),
  week_of: z.string().date(),
  revision: z.number().int().min(1),
  generated_at: z.string().datetime({ offset: true }),
  prompt_version: z.string().min(1).max(PROMPT_VERSION_MAX),
  // Story 3-31 — discover candidate materialization namespace, carried through.
  plan_build_id: z.string().min(1).max(128).optional(),
  main_assignments: z
    .array(PlannerMainAssignmentInputSchema)
    .min(1)
    .max(MAIN_ASSIGNMENTS_PER_PLAN_MAX),
  days: z.array(PlannerDayInputSchema).min(1).max(DAYS_PER_PLAN_MAX),
});

// ===========================================================================
// Story 3-DM-C1 Phase 9b part 4 — wire-shape migration (A-full path).
//
// READ-path response shapes flip from flat (plan_items[]) to tree
// (main_assignments + days + slots + variations). MUTATION inputs decompose
// from a single SwapPlanItemInput into three operations matching the
// canonical model: swapMain (M-assignment recipe change), updateVariation
// (per-child tweak), swapSlotRecipe (snack/extra recipe change).
//
// These coexist with the flat counterparts until the delete pass in the
// same coordinated commit. Routes switch consumers from flat to tree
// schemas in plans.routes.ts.
// ===========================================================================

// --- GET /v1/plans — tree-shape response ---
//
// plan_items[] retires; the response carries the four tree arrays directly.
// The client assembles its tile view by walking the arrays. main_assignments
// is plan-level; days are sorted Mon→Sat by the API; slots fan out main /
// snack / extra under each day; variations are per-child. Empty arrays are
// valid (e.g. plan is null on the draft path or the hard-fail path).
export const GetPlansResponseSchema = z.object({
  plan: PlanRowSchema.nullable(),
  main_assignments: z.array(PlanMainAssignmentRowSchema).default([]),
  days: z.array(PlanDayRowSchema).default([]),
  slots: z.array(PlanSlotRowSchema).default([]),
  variations: z.array(PlanSlotVariationRowSchema).default([]),
  is_draft: z.boolean(),
  week_of: z.string().date(),
  hard_fail: HardFailStatusSchema.nullable().optional(),
  // VariantProposalSchema still carries plan_item_id; that field swaps to
  // plan_slot_variation_id in a sibling slice (see Phase-6 carve-out note).
  // Until then this response reuses the existing schema verbatim.
  variant_proposals: z.array(VariantProposalSchema).optional(),
  flagged_items: z.array(FlaggedCompoundItemSchema).optional(),
});

// --- GET /v1/plans/:weekId/history — tree-shape response ---
//
// swap_history shape is deferred. The canonical model has no archived
// plan_items table; mid-week swaps/edits become audit_log entries with
// kind: 'main_swap' | 'variation_edit' | 'slot_recipe_swap'. The first
// pass returns [] and the route builds the array empty; a follow-up slice
// designs the audit-driven derivation and populates the schema. Leaving the
// field present with a stable shape keeps the contract stable from day one.
export const PlanSwapSummaryTreeSchema = z.object({
  kind: z.enum(['main_swap', 'variation_edit', 'slot_recipe_swap']),
  child_id: z.string().uuid().nullable(),
  day: WeekdaySchema.nullable(),
  slot_kind: SlotKindSchema.nullable(),
  at: z.string().datetime({ offset: true }),
});

export const PlanHistoryResponseSchema = z.object({
  plan: PlanRowSchema,
  main_assignments: z.array(PlanMainAssignmentRowSchema).default([]),
  days: z.array(PlanDayRowSchema).default([]),
  slots: z.array(PlanSlotRowSchema).default([]),
  variations: z.array(PlanSlotVariationRowSchema).default([]),
  swap_history: z.array(PlanSwapSummaryTreeSchema).default([]),
  week_of: z.string().date().nullable(),
  // Per-child ratings (Layer 1 / FR36). Keyed by child_id UUID; emoji or
  // qualitative-rating string. Same shape as the flat history response.
  ratings: z.record(z.string().uuid(), z.string().min(1).nullable()),
});

// --- PATCH /v1/plans/:planId/main-assignments/:mainAssignmentId/recipe ---
//
// Replaces the recipe for one M-assignment. Affects every plan_slot whose
// main_assignment_id points at this row — i.e. every day that uses this
// Main. Per the family-first model, this is the dominant swap operation
// when a parent decides "let's swap the Tuesday-Wednesday Main".
export const SwapMainInputSchema = z.object({
  new_recipe_id: z.string().uuid(),
});

export const SwapMainResponseSchema = z.object({
  main_assignment: PlanMainAssignmentRowSchema,
});

// --- PATCH /v1/plans/:planId/variations/:variationId ---
//
// Per-child variation patch. Any combination of attribute fields can be
// supplied; omitted fields are left as-is. nullable for cutting_style /
// container / notes means: omitted = unchanged, null = clear, string = set.
// add_ons / removals replace the arrays in full when supplied.
export const UpdateVariationInputSchema = z.object({
  portion_size: PortionSizeSchema.optional(),
  texture: TextureLevelSchema.optional(),
  spice_level: SpiceLevelSchema.optional(),
  cutting_style: z.string().max(VARIATION_CUTTING_MAX).nullable().optional(),
  container: z.string().max(VARIATION_CONTAINER_MAX).nullable().optional(),
  add_ons: z.array(z.string().min(1).max(VARIATION_ADDON_MAX)).max(20).optional(),
  removals: z.array(z.string().min(1).max(VARIATION_REMOVAL_MAX)).max(20).optional(),
  notes: z.string().max(VARIATION_TEXT_MAX).nullable().optional(),
});

export const UpdateVariationResponseSchema = z.object({
  variation: PlanSlotVariationRowSchema,
});

// --- PATCH /v1/plans/:planId/slots/:planSlotId/recipe ---
//
// Replaces the recipe on a snack or extra slot. Main slots are not editable
// via this route — the M-assignment swap above is the correct path. The
// service rejects slot_kind='main' with a 400.
export const SwapSlotRecipeInputSchema = z.object({
  new_recipe_id: z.string().uuid(),
});

export const SwapSlotRecipeResponseSchema = z.object({
  slot: PlanSlotRowSchema,
});

// --- PATCH /v1/plans/:planId/days/:day/pause — tree shape ---
//
// reason becomes required (the DB CHECK demands paused_at + paused_reason
// both be set when either is set). Reason enum widens from the flat
// 'sick'|'absent'|'holiday' to PauseReasonSchema's six-value set. Existing
// clients sending 'sick' / 'absent' / 'holiday' must migrate to 'sick_day'
// / 'other' / 'holiday' respectively — the rename lands with the route swap.
export const PausePlanDayTreeInputSchema = z.object({
  reason: PauseReasonSchema,
  note: z.string().max(PAUSED_NOTE_MAX).optional(),
});

// --- PATCH /v1/plans/:planId/days/:day/pause-child ---
//
// Per-child day-level pause. Sets paused_at on every plan_slot_variation
// for the (child_id, plan_day_id) pair. Used when one child is sick but
// the rest of the family eats as planned.
export const PauseChildOnDayInputSchema = z.object({
  child_id: z.string().uuid(),
});

// --- Route param schemas (tree shape) ---
export const MainAssignmentParamSchema = z.object({
  planId: z.string().uuid(),
  mainAssignmentId: z.string().uuid(),
});

export const VariationParamSchema = z.object({
  planId: z.string().uuid(),
  variationId: z.string().uuid(),
});

export const PlanSlotParamSchema = z.object({
  planId: z.string().uuid(),
  planSlotId: z.string().uuid(),
});

// plan_day_context is scoped to a slot (not a per-(child,day,slot) flat item):
// the path param is planSlotId.
export const PlanDayContextSlotParamSchema = z.object({
  planId: z.string().uuid(),
  planSlotId: z.string().uuid(),
});

export const PlanDayContextSlotRevertParamSchema = z.object({
  planId: z.string().uuid(),
  planSlotId: z.string().uuid(),
  overrideId: z.string().uuid(),
});

// Slice 5-S12 — conversational swap proposal (L3 DisambiguationPicker). The
// user's free-text intent is captured as a TurnBodyProposal turn in the
// household's family thread; Lumi's resolution (swapMain + plan_diff turn) is
// a deferred agent step.
export const ProposeSwapInputSchema = z.object({
  day: WeekdaySchema,
  // Trim before length-checking so a whitespace-only payload (which passes a raw
  // min(1)) is rejected, and the persisted proposal content is already trimmed.
  content: z.string().trim().min(1).max(500),
});

export const ProposeSwapResponseSchema = z.object({
  proposal_id: z.string().uuid(),
});

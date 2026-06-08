// Story 3-DM-A3 — shared test factories for plan / child / recipe / brief-state
// fixtures. Replaces the ad-hoc inline `buildPlanRow`, `makeItem`, `buildChild`
// helpers that proliferated across test files.
//
// Discipline: every factory accepts Partial<T> overrides and returns a fully-
// populated row with sensible defaults. The defaults match the project's
// stable test UUIDs (TEST_IDS below) so call sites can assert against id
// constants without threading them through every builder call.
//
// Phase C1 will swap buildPlanItem for tree-shape builders (buildPlanMainAssignment,
// buildPlanDay, buildPlanSlot, buildPlanSlotVariation). Until then this file is
// the single point of change when PlanRow / PlanItemRow shapes evolve.

import type {
  BriefStateRow,
  PlanDayRow,
  PlanMainAssignmentRow,
  PlanRow,
  PlanSlotRow,
  PlanSlotVariationRow,
} from '@hivekitchen/types';
import type { DecryptedChildRow } from '../../src/modules/children/children.repository.js';
import type {
  RecipeRow,
  RecipeStepRow,
} from '../../src/modules/recipe/recipes.repository.js';

// Stable test UUIDs. Convention: pad nibble 1+ with the role's repeating digit,
// keep the v4 + variant bits so the strings round-trip through z.string().uuid().
export const TEST_IDS = {
  household: '11111111-1111-4111-8111-111111111111',
  plan: '22222222-2222-4222-8222-222222222222',
  weekId: '33333333-3333-4333-8333-333333333333',
  childA: '44444444-4444-4444-8444-444444444444',
  childB: '55555555-5555-4555-8555-555555555555',
  recipe: '66666666-6666-4666-8666-666666666666',
  planItem: '77777777-7777-4777-8777-777777777777',
  recipeStep: '88888888-8888-4888-8888-888888888888',
  request: '99999999-9999-4999-8999-999999999999',
  // Story 3-DM-C1 Phase 8 — tree-shape row ids.
  mainAssignment: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  planDay: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  planSlot: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  planSlotVariation: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
} as const;

const NOW_ISO = '2026-05-02T11:00:00.000Z';

// ===========================================================================
// PlanRow
// ===========================================================================

export function buildPlan(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: TEST_IDS.plan,
    household_id: TEST_IDS.household,
    week_of: '2026-05-04',
    revision: 1,
    generated_at: NOW_ISO,
    guardrail_cleared_at: '2026-05-02T11:00:01.000Z',
    guardrail_version: '1.1.0',
    prompt_version: 'v1.0.0',
    state: null,
    state_set_at: null,
    state_message: null,
    created_at: NOW_ISO,
    updated_at: '2026-05-02T11:00:01.000Z',
    ...overrides,
  };
}

// Story 3-DM-C1 Phase 9b part 4 step 5 — buildPlanItem retired with the
// PlanItemRow type and the plan_items table. Tree-shape builders below
// (buildPlanMainAssignment, buildPlanDay, buildPlanSlot,
// buildPlanSlotVariation, buildPlanTree) are the canonical replacements.

// ===========================================================================
// BriefStateRow
// ===========================================================================

export function buildBriefState(overrides: Partial<BriefStateRow> = {}): BriefStateRow {
  return {
    household_id: TEST_IDS.household,
    plan_id: TEST_IDS.plan,
    moment_headline: 'This week feels light.',
    lumi_note: '',
    memory_prose: '',
    // Story 3-DM-D1 — consolidated payload column.
    payload: {
      tile_summaries: [],
      cleared_allergies: [],
      scaffolding_diff: null,
      plan_state: null,
      plan_state_set_at: null,
      plan_state_message: null,
      learning_moment_callout: null,
      learning_moment_suppressed_until: null,
    },
    generated_at: NOW_ISO,
    plan_revision: 1,
    updated_at: NOW_ISO,
    ...overrides,
  };
}

// ===========================================================================
// DecryptedChildRow (post-B1 shape: 3 variation-driving enums + pattern enum;
// no bag_composition jsonb, no allergen_rule_version)
// ===========================================================================

export function buildChild(overrides: Partial<DecryptedChildRow> = {}): DecryptedChildRow {
  return {
    id: TEST_IDS.childA,
    household_id: TEST_IDS.household,
    name: 'Aarav',
    age_band: 'child',
    school_policy_notes: null,
    declared_allergens: [],
    cultural_identifiers: [],
    dietary_preferences: [],
    appetite_level: 'normal',
    texture_needs: 'normal',
    spice_tolerance: 'mild',
    bag_composition_pattern: 'main_plus_snack_plus_extra',
    created_at: '2026-04-28T10:00:00.000Z',
    ...overrides,
  };
}

// ===========================================================================
// RecipeRow + RecipeStepRow (post-A1 canonical shape)
// ===========================================================================

export function buildRecipe(overrides: Partial<RecipeRow> = {}): RecipeRow {
  return {
    id: TEST_IDS.recipe,
    canonical_name: 'Lentil dal',
    slug: null,
    ingredients: [],
    ingredient_keys: ['lentil'],
    primary_ingredient_key: 'lentil',
    allergen_flags: [],
    dietary_flags: ['vegetarian'],
    cultural_tags: [],
    cuisine_tags: ['indian'],
    applicable_slots: ['main'],
    prep_time_minutes: 25,
    finish_time_minutes: null,
    source: 'agent_generated',
    created_by_household_id: TEST_IDS.household,
    visibility: 'private',
    community_use_count: 0,
    community_rating_avg: null,
    community_rating_count: 0,
    is_active: true,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    ...overrides,
  };
}

export function buildRecipeStep(overrides: Partial<RecipeStepRow> = {}): RecipeStepRow {
  return {
    id: TEST_IDS.recipeStep,
    recipe_id: TEST_IDS.recipe,
    sequence: 1,
    mode: 'prep',
    text: 'Soak the lentils for 20 minutes.',
    created_at: NOW_ISO,
    ...overrides,
  };
}

// ===========================================================================
// Story 3-DM-C1 Phase 8 — tree-shape row factories.
//
// Additive: the flat buildPlanItem above stays in place for the C1 cutover
// window. Phase 9 removes buildPlanItem along with the migration apply.
//
// Each builder accepts Partial<T> overrides and returns a fully-populated
// row matching the post-migration shape. UUIDs default to TEST_IDS so call
// sites can assert against constants without threading them through every
// builder call.
// ===========================================================================

export function buildPlanMainAssignment(
  overrides: Partial<PlanMainAssignmentRow> = {},
): PlanMainAssignmentRow {
  return {
    id: TEST_IDS.mainAssignment,
    plan_id: TEST_IDS.plan,
    sequence: 1,
    recipe_id: TEST_IDS.recipe,
    created_at: NOW_ISO,
    ...overrides,
  };
}

export function buildPlanDay(overrides: Partial<PlanDayRow> = {}): PlanDayRow {
  return {
    id: TEST_IDS.planDay,
    plan_id: TEST_IDS.plan,
    day: 'monday',
    paused_at: null,
    paused_reason: null,
    paused_note: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    ...overrides,
  };
}

// Default slot is a main slot referencing the default main_assignment.
// Snack / extra callers must override main_assignment_id → null, set
// slot_kind, and supply recipe_id + (extra_kind, for extras). The DB
// CHECK constraint mirror in PlanSlotRowSchema (Phase 2) catches malformed
// fixture combinations at parse time.
export function buildPlanSlot(overrides: Partial<PlanSlotRow> = {}): PlanSlotRow {
  return {
    id: TEST_IDS.planSlot,
    plan_day_id: TEST_IDS.planDay,
    slot_kind: 'main',
    main_assignment_id: TEST_IDS.mainAssignment,
    recipe_id: null,
    extra_kind: null,
    paused_at: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    ...overrides,
  };
}

export function buildPlanSlotVariation(
  overrides: Partial<PlanSlotVariationRow> = {},
): PlanSlotVariationRow {
  return {
    id: TEST_IDS.planSlotVariation,
    plan_slot_id: TEST_IDS.planSlot,
    child_id: TEST_IDS.childA,
    portion_size: 'regular',
    texture: 'normal',
    spice_level: 'mild',
    cutting_style: null,
    container: null,
    add_ons: [],
    removals: [],
    notes: null,
    paused_at: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    ...overrides,
  };
}

// Convenience composer — returns a minimal cleared-plan tree with one
// main_assignment, one day (Monday), one main slot, and one variation for
// childA. Wrappers in plan/composer tests pass overrides to drive specific
// scenarios.
export interface PlanTreeFixture {
  plan: PlanRow;
  mainAssignments: PlanMainAssignmentRow[];
  days: PlanDayRow[];
  slots: PlanSlotRow[];
  variations: PlanSlotVariationRow[];
}

export function buildPlanTree(
  overrides: {
    plan?: Partial<PlanRow>;
    mainAssignments?: PlanMainAssignmentRow[];
    days?: PlanDayRow[];
    slots?: PlanSlotRow[];
    variations?: PlanSlotVariationRow[];
  } = {},
): PlanTreeFixture {
  return {
    plan: buildPlan(overrides.plan ?? {}),
    mainAssignments: overrides.mainAssignments ?? [buildPlanMainAssignment()],
    days: overrides.days ?? [buildPlanDay()],
    slots: overrides.slots ?? [buildPlanSlot()],
    variations: overrides.variations ?? [buildPlanSlotVariation()],
  };
}

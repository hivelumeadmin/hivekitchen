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
  PlanItemRow,
  PlanRow,
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
} as const;

const NOW_ISO = '2026-05-02T11:00:00.000Z';

// ===========================================================================
// PlanRow
// ===========================================================================

export function buildPlan(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: TEST_IDS.plan,
    household_id: TEST_IDS.household,
    week_id: TEST_IDS.weekId,
    week_of: '2026-05-04',
    revision: 1,
    generated_at: NOW_ISO,
    guardrail_cleared_at: '2026-05-02T11:00:01.000Z',
    guardrail_version: '1.1.0',
    prompt_version: 'v1.0.0',
    created_at: NOW_ISO,
    updated_at: '2026-05-02T11:00:01.000Z',
    ...overrides,
  };
}

// ===========================================================================
// PlanItemRow (pre-C1 shape — flat per-(child,day,slot) rows)
// ===========================================================================

export function buildPlanItem(overrides: Partial<PlanItemRow> = {}): PlanItemRow {
  return {
    id: TEST_IDS.planItem,
    plan_id: TEST_IDS.plan,
    child_id: TEST_IDS.childA,
    day: 'monday',
    slot: 'main',
    recipe_id: null,
    item_id: null,
    ingredients: ['rice', 'lentils'],
    paused_at: null,
    replaced_by_plan_id: null,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    ...overrides,
  };
}

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
    plan_tile_summaries: [],
    cleared_allergies: [],
    scaffolding_diff: null,
    plan_state: null,
    plan_state_set_at: null,
    plan_state_message: null,
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

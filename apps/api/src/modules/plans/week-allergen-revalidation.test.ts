import { describe, it, expect, vi } from 'vitest';
import {
  screenWeekForAllergen,
  WeekAllergenRevalidator,
  type ScreenWeekInput,
  type WeekAllergenRevalidatorDeps,
} from './week-allergen-revalidation.js';
import {
  TEST_IDS,
  buildPlanDay,
  buildPlanSlot,
  buildPlanSlotVariation,
  buildPlanMainAssignment,
} from '../../../test/factories/index.js';

// Epic 13-s10 (AC7) — the safety_write week re-screen. screenWeekForAllergen is
// pure and fixture-tested with zero mocks; the revalidator wrapper is tested
// with stubbed pickers + swap services asserting exact call args.

const MAIN_RECIPE = TEST_IDS.recipe;
const EXTRA_RECIPE = '66666666-6666-4666-8666-666666660002';
const SNACK_SKU = 'eeee1111-1111-4111-8111-111111111111';

const DAY = buildPlanDay({ id: TEST_IDS.planDay, day: 'monday' });
const MAIN_ASSIGNMENT = buildPlanMainAssignment({
  id: TEST_IDS.mainAssignment,
  recipe_id: MAIN_RECIPE,
});
const MAIN_SLOT = buildPlanSlot({
  id: 'cccccccc-cccc-4ccc-8ccc-ccccccccc001',
  plan_day_id: DAY.id,
  slot_kind: 'main',
  main_assignment_id: MAIN_ASSIGNMENT.id,
});
const SNACK_SLOT = buildPlanSlot({
  id: 'cccccccc-cccc-4ccc-8ccc-ccccccccc002',
  plan_day_id: DAY.id,
  slot_kind: 'snack',
  main_assignment_id: null,
  snack_sku_id: SNACK_SKU,
});
const EXTRA_SLOT = buildPlanSlot({
  id: 'cccccccc-cccc-4ccc-8ccc-ccccccccc003',
  plan_day_id: DAY.id,
  slot_kind: 'extra',
  main_assignment_id: null,
  recipe_id: EXTRA_RECIPE,
  extra_kind: 'sweet',
});
const MAIN_VAR_A = buildPlanSlotVariation({
  id: 'dddddddd-dddd-4ddd-8ddd-ddddddddd001',
  plan_slot_id: MAIN_SLOT.id,
  child_id: TEST_IDS.childA,
});
const SNACK_VAR_A = buildPlanSlotVariation({
  id: 'dddddddd-dddd-4ddd-8ddd-ddddddddd002',
  plan_slot_id: SNACK_SLOT.id,
  child_id: TEST_IDS.childA,
});

function baseScreenInput(overrides: Partial<ScreenWeekInput> = {}): ScreenWeekInput {
  return {
    newAllergen: 'peanut',
    scopeChildId: null,
    days: [DAY],
    slots: [MAIN_SLOT, SNACK_SLOT, EXTRA_SLOT],
    variations: [MAIN_VAR_A, SNACK_VAR_A],
    mainAssignments: [MAIN_ASSIGNMENT],
    recipeFlagsById: new Map([
      [MAIN_RECIPE, ['peanut']],
      [EXTRA_RECIPE, []],
    ]),
    snackTagsById: new Map([[SNACK_SKU, []]]),
    ...overrides,
  };
}

describe('screenWeekForAllergen (pure)', () => {
  it('flags a main whose recipe carries the new allergen for a served child', () => {
    const conflicts = screenWeekForAllergen(baseScreenInput());
    expect(conflicts).toEqual([
      { kind: 'main', mainAssignmentId: MAIN_ASSIGNMENT.id, planSlotId: MAIN_SLOT.id },
    ]);
  });

  it('flags a snack whose SKU tags carry the new allergen', () => {
    const conflicts = screenWeekForAllergen(
      baseScreenInput({
        recipeFlagsById: new Map([[MAIN_RECIPE, []]]),
        snackTagsById: new Map([[SNACK_SKU, ['peanut']]]),
      }),
    );
    expect(conflicts).toEqual([
      { kind: 'snack', planSlotId: SNACK_SLOT.id, day: 'monday', currentSnackSkuId: SNACK_SKU },
    ]);
  });

  it('flags an extra whose recipe carries the allergen', () => {
    const conflicts = screenWeekForAllergen(
      baseScreenInput({
        recipeFlagsById: new Map([
          [MAIN_RECIPE, []],
          [EXTRA_RECIPE, ['peanut']],
        ]),
        variations: [
          MAIN_VAR_A,
          buildPlanSlotVariation({
            id: 'dddddddd-dddd-4ddd-8ddd-ddddddddd003',
            plan_slot_id: EXTRA_SLOT.id,
            child_id: TEST_IDS.childA,
          }),
        ],
      }),
    );
    expect(conflicts).toEqual([{ kind: 'extra', planSlotId: EXTRA_SLOT.id }]);
  });

  it('returns nothing when no placed item carries the allergen', () => {
    expect(
      screenWeekForAllergen(
        baseScreenInput({ recipeFlagsById: new Map([[MAIN_RECIPE, ['milk']]]) }),
      ),
    ).toEqual([]);
  });

  it('child-scoped allergen only flags slots that child is served on', () => {
    const conflicts = screenWeekForAllergen(
      baseScreenInput({
        scopeChildId: TEST_IDS.childB, // childB is not served on any slot
      }),
    );
    expect(conflicts).toEqual([]);
  });

  it('skips paused days', () => {
    const conflicts = screenWeekForAllergen(
      baseScreenInput({
        days: [buildPlanDay({ id: DAY.id, day: 'monday', paused_at: '2026-06-29T00:00:00Z', paused_reason: 'sick_day' })],
      }),
    );
    expect(conflicts).toEqual([]);
  });

  it('dedups a shared Main to a single conflict across days', () => {
    const day2 = buildPlanDay({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002', day: 'tuesday' });
    const mainSlot2 = buildPlanSlot({
      id: 'cccccccc-cccc-4ccc-8ccc-ccccccccc099',
      plan_day_id: day2.id,
      slot_kind: 'main',
      main_assignment_id: MAIN_ASSIGNMENT.id,
    });
    const var2 = buildPlanSlotVariation({
      id: 'dddddddd-dddd-4ddd-8ddd-ddddddddd099',
      plan_slot_id: mainSlot2.id,
      child_id: TEST_IDS.childA,
    });
    const conflicts = screenWeekForAllergen(
      baseScreenInput({
        days: [DAY, day2],
        slots: [MAIN_SLOT, mainSlot2],
        variations: [MAIN_VAR_A, var2],
        snackTagsById: new Map(),
      }),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'main', mainAssignmentId: MAIN_ASSIGNMENT.id });
  });
});

function makeRevalidatorDeps(overrides: Partial<Record<string, unknown>> = {}) {
  const plansService = {
    swapMain: vi.fn().mockResolvedValue({ id: MAIN_ASSIGNMENT.id, recipe_id: 'new-main' }),
    swapSlotRecipe: vi.fn().mockResolvedValue({ id: EXTRA_SLOT.id }),
    swapSlotSnackSku: vi.fn().mockResolvedValue({ id: SNACK_SLOT.id }),
  };
  const catalog = {
    pickRecipe: vi.fn().mockResolvedValue({ id: 'new-main', kind: 'recipe', title: 'Turkey wrap' }),
  };
  const snackContext = {
    load: vi.fn().mockResolvedValue({
      bagCompositions: [],
      extraRules: [],
      activeSkus: [],
      declaredAllergensByChildId: new Map(),
    }),
  };
  const recipeAllergenFlags = {
    findAllergenFlagsByIds: vi.fn().mockResolvedValue(new Map([[MAIN_RECIPE, ['peanut']]])),
  };
  const snackAllergenTags = {
    findAllergenTagsByIds: vi.fn().mockResolvedValue(new Map([[SNACK_SKU, []]])),
  };
  const deps = {
    plansService,
    catalog,
    snackContext,
    recipeAllergenFlags,
    snackAllergenTags,
    ...overrides,
  } as unknown as WeekAllergenRevalidatorDeps;
  return { deps, plansService, catalog, snackContext, recipeAllergenFlags, snackAllergenTags };
}

const REVAL_CTX = {
  planId: TEST_IDS.plan,
  householdId: TEST_IDS.household,
  requestId: TEST_IDS.request,
  weekOf: '2026-06-29',
  newAllergen: 'peanut',
  scopeChildId: null,
  tree: {
    days: [DAY],
    slots: [MAIN_SLOT, SNACK_SLOT, EXTRA_SLOT],
    variations: [MAIN_VAR_A, SNACK_VAR_A],
    mainAssignments: [MAIN_ASSIGNMENT],
  },
};

describe('WeekAllergenRevalidator.revalidate', () => {
  it('re-picks the conflicting main via swapMain and reports the fixed row', async () => {
    const { deps, plansService, catalog } = makeRevalidatorDeps();
    const revalidator = new WeekAllergenRevalidator(deps);

    const result = await revalidator.revalidate(REVAL_CTX);

    expect(catalog.pickRecipe).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: TEST_IDS.household, slot: 'main' }),
    );
    expect(plansService.swapMain).toHaveBeenCalledWith({
      planId: TEST_IDS.plan,
      mainAssignmentId: MAIN_ASSIGNMENT.id,
      householdId: TEST_IDS.household,
      requestId: TEST_IDS.request,
      input: { new_recipe_id: 'new-main' },
    });
    expect(result).toEqual({
      status: 'ok',
      fixedSlots: [{ main_assignment: { id: MAIN_ASSIGNMENT.id, recipe_id: 'new-main' } }],
    });
  });

  it('escalates (no writes) when a conflicting slot cannot be re-picked from cache', async () => {
    const { deps, plansService, catalog } = makeRevalidatorDeps();
    catalog.pickRecipe.mockResolvedValue(null);
    const revalidator = new WeekAllergenRevalidator(deps);

    const result = await revalidator.revalidate(REVAL_CTX);

    expect(result).toEqual({ status: 'escalate' });
    expect(plansService.swapMain).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing placed carries the new allergen', async () => {
    const { deps, plansService } = makeRevalidatorDeps({
      recipeAllergenFlags: {
        findAllergenFlagsByIds: vi.fn().mockResolvedValue(new Map([[MAIN_RECIPE, ['milk']]])),
      },
    });
    const revalidator = new WeekAllergenRevalidator(deps);

    const result = await revalidator.revalidate(REVAL_CTX);

    expect(result).toEqual({ status: 'ok', fixedSlots: [] });
    expect(plansService.swapMain).not.toHaveBeenCalled();
  });
});

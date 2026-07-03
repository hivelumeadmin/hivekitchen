import { describe, it, expect, vi } from 'vitest';
import {
  executePlanEdit,
  variationPatchOf,
  shouldEmitPlanUpdated,
  type PlanEditExecutorDeps,
  type PlanEditOutcome,
} from './plan-edit.service.js';
import {
  TEST_IDS,
  buildPlanDay,
  buildPlanSlot,
  buildPlanSlotVariation,
} from '../../../test/factories/index.js';

// Epic 13-s9 — executePlanEdit maps T0 DispatchResult actions onto the
// existing services. It resolves the concrete row via resolvePlanEditTarget,
// never mutates on a miss, and passes non-T0 results through as typed outcomes.

const DAY_MON = buildPlanDay({ id: 'aaaa1111-1111-4111-8111-111111111111', day: 'monday' });
const MAIN_SLOT = buildPlanSlot({
  id: 'cccc1111-1111-4111-8111-111111111111',
  plan_day_id: DAY_MON.id,
  slot_kind: 'main',
  main_assignment_id: TEST_IDS.mainAssignment,
});
const SNACK_SLOT = buildPlanSlot({
  id: 'cccc2222-2222-4222-8222-222222222222',
  plan_day_id: DAY_MON.id,
  slot_kind: 'snack',
  main_assignment_id: null,
  snack_sku_id: 'eeee1111-1111-4111-8111-111111111111',
});
const EXTRA_SLOT = buildPlanSlot({
  id: 'cccc3333-3333-4333-8333-333333333333',
  plan_day_id: DAY_MON.id,
  slot_kind: 'extra',
  main_assignment_id: null,
  recipe_id: TEST_IDS.recipe,
  extra_kind: 'sweet',
});
const MAIN_VARIATION = buildPlanSlotVariation({
  id: 'dddd1111-1111-4111-8111-111111111111',
  plan_slot_id: MAIN_SLOT.id,
  child_id: TEST_IDS.childA,
  spice_level: 'regular',
  portion_size: 'regular',
});

const TREE = {
  days: [DAY_MON],
  slots: [MAIN_SLOT, SNACK_SLOT, EXTRA_SLOT],
  variations: [MAIN_VARIATION],
};

const CTX = {
  planId: TEST_IDS.plan,
  householdId: TEST_IDS.household,
  requestId: TEST_IDS.request,
  weekOf: '2026-06-29',
  tree: TREE,
};

const CANDIDATE = { id: TEST_IDS.recipe, kind: 'recipe' as const, title: 'Veggie wraps' };

function makeDeps(overrides: Partial<Record<string, unknown>> = {}) {
  const plansService = {
    swapMain: vi.fn().mockResolvedValue({ id: TEST_IDS.mainAssignment }),
    swapSlotRecipe: vi.fn().mockResolvedValue({ id: EXTRA_SLOT.id }),
    swapSlotSnackSku: vi.fn().mockResolvedValue({ id: SNACK_SLOT.id, snack_sku_id: 'new-sku' }),
    updateVariation: vi.fn().mockResolvedValue({ id: MAIN_VARIATION.id }),
    confirmWeek: vi
      .fn()
      .mockResolvedValue({ confirmedAt: '2026-06-29T10:00:00Z', changed: true }),
  };
  const householdAllergens = {
    declareIfNew: vi.fn().mockResolvedValue({ inserted: true }),
  };
  const snackContext = {
    load: vi.fn().mockResolvedValue({
      bagCompositions: [
        { child_id: TEST_IDS.childA, child_name: 'Aarav', snack: true, extra: false },
      ],
      extraRules: [],
      activeSkus: [
        {
          id: 'eeee2222-2222-4222-8222-222222222222',
          name: 'Apple slices',
          brand: null,
          category: 'fruit',
          allergen_tags: [],
          dietary_tags: [],
          is_active: true,
          in_stock: true,
          created_by_household_id: null,
          archived_at: null,
          created_at: '2026-06-01T00:00:00Z',
          upc_code: null,
          package_type: null,
        },
      ],
      declaredAllergensByChildId: new Map<string, string[]>(),
    }),
  };
  const deps = {
    plansService,
    householdAllergens,
    snackContext,
    ...overrides,
  } as unknown as PlanEditExecutorDeps;
  return { deps, plansService, householdAllergens, snackContext };
}

describe('executePlanEdit — pass-through outcomes', () => {
  it('noop → acknowledged', async () => {
    const { deps } = makeDeps();
    const r = await executePlanEdit({ tier: 'T0', action: 'noop' }, CTX, deps);
    expect(r).toEqual({ status: 'acknowledged', action: 'noop' });
  });

  it('commit → confirmWeek fires and the outcome carries the confirmed timestamp (Epic 13-s10)', async () => {
    const { deps, plansService } = makeDeps();
    const r = await executePlanEdit({ tier: 'T0', action: 'commit' }, CTX, deps);
    expect(plansService.confirmWeek).toHaveBeenCalledWith({
      planId: TEST_IDS.plan,
      householdId: TEST_IDS.household,
      requestId: TEST_IDS.request,
    });
    expect(r).toEqual({
      status: 'acknowledged',
      action: 'commit',
      confirmedAt: '2026-06-29T10:00:00Z',
      changed: true,
    });
  });

  it('commit re-confirm no-op → changed:false (idempotent)', async () => {
    const { deps, plansService } = makeDeps();
    plansService.confirmWeek.mockResolvedValueOnce({
      confirmedAt: '2026-06-29T10:00:00Z',
      changed: false,
    });
    const r = await executePlanEdit({ tier: 'T0', action: 'commit' }, CTX, deps);
    expect(r).toEqual({
      status: 'acknowledged',
      action: 'commit',
      confirmedAt: '2026-06-29T10:00:00Z',
      changed: false,
    });
  });

  it('read → read with target', async () => {
    const { deps } = makeDeps();
    const r = await executePlanEdit(
      { tier: 'T0', action: 'read', intent: 'inspect', target: { day: 'mon' } },
      CTX,
      deps,
    );
    expect(r).toEqual({ status: 'read', target: { day: 'mon' } });
  });

  it('reply → clarify', async () => {
    const { deps } = makeDeps();
    const r = await executePlanEdit({ tier: 'T1', action: 'reply', intent: 'fallback' }, CTX, deps);
    expect(r).toEqual({ status: 'clarify', reason: 'unclear' });
  });

  it('escalate → escalate with reason and dishQuery', async () => {
    const { deps } = makeDeps();
    const r = await executePlanEdit(
      { tier: 'T2', action: 'escalate', intent: 'add_dish', reason: 'add_dish', dishQuery: 'bibimbap' },
      CTX,
      deps,
    );
    expect(r).toEqual({ status: 'escalate', reason: 'add_dish', dishQuery: 'bibimbap' });
  });
});

describe('executePlanEdit — swaps', () => {
  it('swap on a main resolves the assignment and calls swapMain with the candidate', async () => {
    const { deps, plansService } = makeDeps();
    const r = await executePlanEdit(
      {
        tier: 'T0',
        action: 'swap',
        intent: 'swap_slot',
        candidate: CANDIDATE,
        target: { day: 'mon', slotKind: 'main' },
      },
      CTX,
      deps,
    );
    expect(plansService.swapMain).toHaveBeenCalledWith({
      planId: TEST_IDS.plan,
      mainAssignmentId: TEST_IDS.mainAssignment,
      householdId: TEST_IDS.household,
      requestId: TEST_IDS.request,
      input: { new_recipe_id: CANDIDATE.id },
    });
    expect(r).toMatchObject({ status: 'applied', action: 'swap_main' });
  });

  it('swap on an extra calls swapSlotRecipe on the slot', async () => {
    const { deps, plansService } = makeDeps();
    const r = await executePlanEdit(
      {
        tier: 'T0',
        action: 'swap',
        intent: 'swap_slot',
        candidate: CANDIDATE,
        target: { day: 'mon', slotKind: 'extra' },
      },
      CTX,
      deps,
    );
    expect(plansService.swapSlotRecipe).toHaveBeenCalledWith({
      planId: TEST_IDS.plan,
      planSlotId: EXTRA_SLOT.id,
      householdId: TEST_IDS.household,
      requestId: TEST_IDS.request,
      input: { new_recipe_id: CANDIDATE.id },
    });
    expect(r).toMatchObject({ status: 'applied', action: 'swap_slot' });
  });

  it('swap with an unresolvable day clarifies without mutating', async () => {
    const { deps, plansService } = makeDeps();
    const r = await executePlanEdit(
      { tier: 'T0', action: 'swap', intent: 'swap_slot', candidate: CANDIDATE, target: {} },
      CTX,
      deps,
    );
    expect(r).toEqual({ status: 'clarify', reason: 'day_required' });
    expect(plansService.swapMain).not.toHaveBeenCalled();
    expect(plansService.swapSlotRecipe).not.toHaveBeenCalled();
  });

  it('swap_snack picks a replacement SKU deterministically and calls swapSlotSnackSku', async () => {
    const { deps, plansService, snackContext } = makeDeps();
    const r = await executePlanEdit(
      { tier: 'T0', action: 'swap_snack', intent: 'swap_slot', target: { day: 'mon', slotKind: 'snack' } },
      CTX,
      deps,
    );
    expect(snackContext.load).toHaveBeenCalledWith(TEST_IDS.household);
    expect(plansService.swapSlotSnackSku).toHaveBeenCalledWith({
      planId: TEST_IDS.plan,
      planSlotId: SNACK_SLOT.id,
      householdId: TEST_IDS.household,
      requestId: TEST_IDS.request,
      input: { new_snack_sku_id: 'eeee2222-2222-4222-8222-222222222222' },
    });
    expect(r).toMatchObject({ status: 'applied', action: 'swap_snack' });
  });

  it('swap_snack escalates (confirm-gated) when the replacement pool is empty', async () => {
    const { deps, plansService, snackContext } = makeDeps();
    snackContext.load.mockResolvedValue({
      bagCompositions: [
        { child_id: TEST_IDS.childA, child_name: 'Aarav', snack: true, extra: false },
      ],
      extraRules: [],
      activeSkus: [],
      declaredAllergensByChildId: new Map<string, string[]>(),
    });
    const r = await executePlanEdit(
      { tier: 'T0', action: 'swap_snack', intent: 'swap_slot', target: { day: 'mon', slotKind: 'snack' } },
      CTX,
      deps,
    );
    expect(r).toEqual({ status: 'escalate', reason: 'catalog_miss' });
    expect(plansService.swapSlotSnackSku).not.toHaveBeenCalled();
  });
});

describe('executePlanEdit — vary + safety_write', () => {
  it('vary steps the child variation down and calls updateVariation', async () => {
    const { deps, plansService } = makeDeps();
    const r = await executePlanEdit(
      {
        tier: 'T0',
        action: 'vary',
        intent: 'vary_slot',
        variation: 'spice:down',
        target: { day: 'mon', slotKind: 'main', childId: TEST_IDS.childA },
      },
      CTX,
      deps,
    );
    expect(plansService.updateVariation).toHaveBeenCalledWith({
      planId: TEST_IDS.plan,
      variationId: MAIN_VARIATION.id,
      householdId: TEST_IDS.household,
      requestId: TEST_IDS.request,
      input: { spice_level: 'mild' },
    });
    expect(r).toMatchObject({ status: 'applied', action: 'vary' });
  });

  it('vary with an unknown variation string clarifies without mutating', async () => {
    const { deps, plansService } = makeDeps();
    const r = await executePlanEdit(
      {
        tier: 'T0',
        action: 'vary',
        intent: 'vary_slot',
        variation: 'color:blue',
        target: { day: 'mon', slotKind: 'main', childId: TEST_IDS.childA },
      },
      CTX,
      deps,
    );
    expect(r).toEqual({ status: 'clarify', reason: 'unknown_variation' });
    expect(plansService.updateVariation).not.toHaveBeenCalled();
  });

  it('vary without a resolvable variation row clarifies', async () => {
    const { deps } = makeDeps();
    const r = await executePlanEdit(
      {
        tier: 'T0',
        action: 'vary',
        intent: 'vary_slot',
        variation: 'spice:down',
        target: { day: 'mon', slotKind: 'main', childId: TEST_IDS.childB },
      },
      CTX,
      deps,
    );
    expect(r).toEqual({ status: 'clarify', reason: 'variation_not_found' });
  });

  it('safety_write declares the allergen (child-scoped) via declareIfNew', async () => {
    const { deps, householdAllergens } = makeDeps();
    const r = await executePlanEdit(
      {
        tier: 'T0',
        action: 'safety_write',
        intent: 'safety_write',
        allergen: 'peanut',
        target: { childId: TEST_IDS.childA },
      },
      CTX,
      deps,
    );
    expect(householdAllergens.declareIfNew).toHaveBeenCalledWith({
      household_id: TEST_IDS.household,
      child_id: TEST_IDS.childA,
      allergen: 'peanut',
      source: 'plan_edit',
    });
    expect(r).toEqual({ status: 'applied', action: 'safety_write', allergen: 'peanut', inserted: true });
  });

  it('safety_write without a childId declares household-wide (child_id null)', async () => {
    const { deps, householdAllergens } = makeDeps();
    await executePlanEdit(
      { tier: 'T0', action: 'safety_write', intent: 'safety_write', allergen: 'milk', target: {} },
      CTX,
      deps,
    );
    expect(householdAllergens.declareIfNew).toHaveBeenCalledWith(
      expect.objectContaining({ child_id: null, allergen: 'milk' }),
    );
  });
});

describe('variationPatchOf', () => {
  it.each([
    ['spice:down', { spice_level: 'regular' }, { spice_level: 'mild' }],
    ['spice:up', { spice_level: 'regular' }, { spice_level: 'spicy' }],
    ['portion:down', { portion_size: 'regular' }, { portion_size: 'small' }],
    ['portion:up', { portion_size: 'regular' }, { portion_size: 'large' }],
    ['texture:soft', {}, { texture: 'soft' }],
  ] as const)('%s steps correctly', (variation, current, expected) => {
    const row = buildPlanSlotVariation(current as Record<string, never>);
    expect(variationPatchOf(variation, row)).toEqual(expected);
  });

  it('clamps at the boundary (already mild + spice:down stays mild)', () => {
    const row = buildPlanSlotVariation({ spice_level: 'mild' });
    expect(variationPatchOf('spice:down', row)).toEqual({ spice_level: 'mild' });
  });

  it('returns null for an unknown variation string', () => {
    expect(variationPatchOf('color:blue', buildPlanSlotVariation())).toBeNull();
  });
});

describe('PlanEditTurnService.run', () => {
  function makeTurnDeps() {
    const base = makeDeps();
    const provider = {
      complete: vi.fn().mockResolvedValue({
        toolCalls: [
          {
            name: 'plan.route',
            arguments: { intent: 'swap_slot', confidence: 0.9, day: 'mon', slotKind: 'main' },
          },
        ],
      }),
    };
    const catalog = { pickRecipe: vi.fn().mockResolvedValue(CANDIDATE) };
    const planTree = {
      getCurrentPlanTree: vi.fn().mockResolvedValue({
        plan: { id: TEST_IDS.plan, week_of: '2026-06-29' },
        mainAssignments: [{ id: TEST_IDS.mainAssignment, recipe_id: TEST_IDS.recipe }],
        days: TREE.days,
        slots: TREE.slots,
        variations: TREE.variations,
      }),
    };
    const kitchenMapForContext = {
      get: vi.fn().mockResolvedValue({
        household: { declared_allergens: [] },
        children: [{ id: TEST_IDS.childA, name: 'Aarav', declared_allergens: [] }],
      }),
    };
    const deps = {
      ...(base.deps as unknown as Record<string, unknown>),
      provider,
      catalog,
      planTree,
      kitchenMapForContext,
    };
    return { ...base, provider, catalog, planTree, kitchenMapForContext, deps };
  }

  it('chip bypass: a pre-built intent skips the classifier entirely (zero LLM)', async () => {
    const t = makeTurnDeps();
    const { PlanEditTurnService } = await import('./plan-edit.service.js');
    const service = new PlanEditTurnService(t.deps as never);

    const result = await service.run({
      planId: TEST_IDS.plan,
      householdId: TEST_IDS.household,
      requestId: TEST_IDS.request,
      body: { intent: { intent: 'affirm', confidence: 1 } },
    });

    expect(t.provider.complete).not.toHaveBeenCalled();
    expect(result.utterance).toBeNull();
    expect(result.outcome).toEqual({ status: 'acknowledged', action: 'noop' });
  });

  it('utterance path: classifies, dispatches with the week dedup set, executes the swap', async () => {
    const t = makeTurnDeps();
    const { PlanEditTurnService } = await import('./plan-edit.service.js');
    const service = new PlanEditTurnService(t.deps as never);

    const result = await service.run({
      planId: TEST_IDS.plan,
      householdId: TEST_IDS.household,
      requestId: TEST_IDS.request,
      body: { utterance: 'swap monday main' },
    });

    expect(t.provider.complete).toHaveBeenCalledTimes(1);
    expect(t.catalog.pickRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: TEST_IDS.household,
        slot: 'main',
        excludeRecipeIds: expect.arrayContaining([TEST_IDS.recipe]),
      }),
    );
    expect(result.outcome).toMatchObject({ status: 'applied', action: 'swap_main' });
    expect(result.utterance).toBe('swap monday main');
    expect(result.weekOf).toBe('2026-06-29');
  });

  it('degrades to context-free classification when the kitchen map read fails', async () => {
    const t = makeTurnDeps();
    t.kitchenMapForContext.get.mockRejectedValue(new Error('redis down'));
    const { PlanEditTurnService } = await import('./plan-edit.service.js');
    const service = new PlanEditTurnService(t.deps as never);

    const result = await service.run({
      planId: TEST_IDS.plan,
      householdId: TEST_IDS.household,
      requestId: TEST_IDS.request,
      body: { utterance: 'swap monday main' },
    });

    expect(result.outcome).toMatchObject({ status: 'applied' });
  });

  it('chip safety_write with a foreign childId clarifies without writing', async () => {
    const t = makeTurnDeps();
    const { PlanEditTurnService } = await import('./plan-edit.service.js');
    const service = new PlanEditTurnService(t.deps as never);

    const result = await service.run({
      planId: TEST_IDS.plan,
      householdId: TEST_IDS.household,
      requestId: TEST_IDS.request,
      body: {
        intent: {
          intent: 'safety_write',
          confidence: 1,
          allergen: 'peanut',
          childId: 'ffff9999-9999-4999-8999-999999999999',
        },
      },
    });

    expect(result.outcome).toEqual({ status: 'clarify', reason: 'unknown_child' });
    expect(t.householdAllergens.declareIfNew).not.toHaveBeenCalled();
  });

  it('chip safety_write with a known household child writes the allergen', async () => {
    const t = makeTurnDeps();
    const { PlanEditTurnService } = await import('./plan-edit.service.js');
    const service = new PlanEditTurnService(t.deps as never);

    const result = await service.run({
      planId: TEST_IDS.plan,
      householdId: TEST_IDS.household,
      requestId: TEST_IDS.request,
      body: {
        intent: { intent: 'safety_write', confidence: 1, allergen: 'peanut', childId: TEST_IDS.childA },
      },
    });

    expect(result.outcome).toMatchObject({ status: 'applied', action: 'safety_write' });
    expect(t.householdAllergens.declareIfNew).toHaveBeenCalledWith(
      expect.objectContaining({ child_id: TEST_IDS.childA, allergen: 'peanut' }),
    );
  });

  it('child-ownership check degrades softly: a failed roster read does not block the write', async () => {
    const t = makeTurnDeps();
    t.kitchenMapForContext.get.mockRejectedValue(new Error('redis down'));
    const { PlanEditTurnService } = await import('./plan-edit.service.js');
    const service = new PlanEditTurnService(t.deps as never);

    const result = await service.run({
      planId: TEST_IDS.plan,
      householdId: TEST_IDS.household,
      requestId: TEST_IDS.request,
      body: {
        intent: {
          intent: 'safety_write',
          confidence: 1,
          allergen: 'peanut',
          childId: 'ffff9999-9999-4999-8999-999999999999',
        },
      },
    });

    expect(result.outcome).toMatchObject({ status: 'applied', action: 'safety_write' });
    expect(t.householdAllergens.declareIfNew).toHaveBeenCalled();
  });

  it('safety_write with inserted:true runs the week revalidator and surfaces fixed_slots (Epic 13-s10)', async () => {
    const t = makeTurnDeps();
    const revalidate = vi
      .fn()
      .mockResolvedValue({ status: 'ok', fixedSlots: [{ main_assignment: { id: 'x' } }] });
    const deps = { ...(t.deps as unknown as Record<string, unknown>), revalidator: { revalidate } };
    const { PlanEditTurnService } = await import('./plan-edit.service.js');
    const service = new PlanEditTurnService(deps as never);

    const result = await service.run({
      planId: TEST_IDS.plan,
      householdId: TEST_IDS.household,
      requestId: TEST_IDS.request,
      body: { intent: { intent: 'safety_write', confidence: 1, allergen: 'peanut' } },
    });

    expect(revalidate).toHaveBeenCalledWith(
      expect.objectContaining({ newAllergen: 'peanut', scopeChildId: null }),
    );
    expect(result.outcome).toMatchObject({
      status: 'applied',
      action: 'safety_write',
      fixedSlots: [{ main_assignment: { id: 'x' } }],
    });
  });

  it('safety_write escalates (catalog_miss) when the revalidator cannot re-pick a slot', async () => {
    const t = makeTurnDeps();
    const revalidate = vi.fn().mockResolvedValue({ status: 'escalate' });
    const deps = { ...(t.deps as unknown as Record<string, unknown>), revalidator: { revalidate } };
    const { PlanEditTurnService } = await import('./plan-edit.service.js');
    const service = new PlanEditTurnService(deps as never);

    const result = await service.run({
      planId: TEST_IDS.plan,
      householdId: TEST_IDS.household,
      requestId: TEST_IDS.request,
      body: { intent: { intent: 'safety_write', confidence: 1, allergen: 'peanut' } },
    });

    expect(result.outcome).toEqual({ status: 'escalate', reason: 'catalog_miss' });
  });

  it('safety_write with inserted:false skips revalidation (no-op re-declaration)', async () => {
    const t = makeTurnDeps();
    t.householdAllergens.declareIfNew.mockResolvedValue({ inserted: false });
    const revalidate = vi.fn();
    const deps = { ...(t.deps as unknown as Record<string, unknown>), revalidator: { revalidate } };
    const { PlanEditTurnService } = await import('./plan-edit.service.js');
    const service = new PlanEditTurnService(deps as never);

    const result = await service.run({
      planId: TEST_IDS.plan,
      householdId: TEST_IDS.household,
      requestId: TEST_IDS.request,
      body: { intent: { intent: 'safety_write', confidence: 1, allergen: 'peanut' } },
    });

    expect(revalidate).not.toHaveBeenCalled();
    expect(result.outcome).toMatchObject({ status: 'applied', action: 'safety_write', inserted: false });
  });
});

describe('toWireResult', () => {
  it('maps applied rows onto snake_case wire keys', async () => {
    const { toWireResult } = await import('./plan-edit.service.js');
    const mainAssignment = { id: TEST_IDS.mainAssignment } as never;
    expect(toWireResult({ status: 'applied', action: 'swap_main', mainAssignment })).toEqual({
      status: 'applied',
      action: 'swap_main',
      main_assignment: mainAssignment,
    });
  });

  it('passes escalate through with dishQuery', async () => {
    const { toWireResult } = await import('./plan-edit.service.js');
    expect(
      toWireResult({ status: 'escalate', reason: 'add_dish', dishQuery: 'bibimbap' }),
    ).toEqual({ status: 'escalate', reason: 'add_dish', dishQuery: 'bibimbap' });
  });

  it('maps read targets onto the wire target shape', async () => {
    const { toWireResult } = await import('./plan-edit.service.js');
    expect(
      toWireResult({ status: 'read', target: { day: 'mon', slotKind: 'main' } }),
    ).toEqual({ status: 'read', target: { day: 'mon', slotKind: 'main' } });
  });

  it('maps a commit acknowledgment carrying confirmed_at (Epic 13-s10)', async () => {
    const { toWireResult } = await import('./plan-edit.service.js');
    expect(
      toWireResult({
        status: 'acknowledged',
        action: 'commit',
        confirmedAt: '2026-06-29T10:00:00Z',
        changed: true,
      }),
    ).toEqual({
      status: 'acknowledged',
      action: 'commit',
      confirmed_at: '2026-06-29T10:00:00Z',
    });
  });

  it('affirm noop maps without a confirmed_at field', async () => {
    const { toWireResult } = await import('./plan-edit.service.js');
    expect(toWireResult({ status: 'acknowledged', action: 'noop' })).toEqual({
      status: 'acknowledged',
      action: 'noop',
    });
  });
});

describe('shouldEmitPlanUpdated (Epic 13-s10 AC6/AC8)', () => {
  it('emits for applied swaps and vary', () => {
    const cases: PlanEditOutcome[] = [
      { status: 'applied', action: 'swap_main', mainAssignment: {} as never },
      { status: 'applied', action: 'swap_slot', slot: {} as never },
      { status: 'applied', action: 'swap_snack', slot: {} as never },
      { status: 'applied', action: 'vary', variation: {} as never },
    ];
    for (const outcome of cases) expect(shouldEmitPlanUpdated(outcome)).toBe(true);
  });

  it('emits for safety_write only when a row was inserted (AC8)', () => {
    expect(
      shouldEmitPlanUpdated({ status: 'applied', action: 'safety_write', allergen: 'peanut', inserted: true }),
    ).toBe(true);
    expect(
      shouldEmitPlanUpdated({ status: 'applied', action: 'safety_write', allergen: 'peanut', inserted: false }),
    ).toBe(false);
  });

  it('emits for commit only on the first confirm (AC6)', () => {
    expect(
      shouldEmitPlanUpdated({ status: 'acknowledged', action: 'commit', confirmedAt: 'x', changed: true }),
    ).toBe(true);
    expect(
      shouldEmitPlanUpdated({ status: 'acknowledged', action: 'commit', confirmedAt: 'x', changed: false }),
    ).toBe(false);
  });

  it('never emits for affirm / read / clarify / escalate', () => {
    const cases: PlanEditOutcome[] = [
      { status: 'acknowledged', action: 'noop' },
      { status: 'read', target: { day: 'mon' } },
      { status: 'clarify', reason: 'day_required' },
      { status: 'escalate', reason: 'recompose' },
    ];
    for (const outcome of cases) expect(shouldEmitPlanUpdated(outcome)).toBe(false);
  });
});

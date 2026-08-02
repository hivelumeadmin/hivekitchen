import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import {
  BriefStateComposer,
  composePlanTree,
} from './brief-state.composer.js';
import type { PlansRepository } from './plans.repository.js';
import type { BriefStateRepository } from './brief-state.repository.js';
import type { LunchLinkSessionRepository } from './lunch-link-session.repository.js';
import type { MemoryRepository } from '../memory/memory.repository.js';
import type {
  ChildrenRepository,
  DecryptedChildRow,
} from '../children/children.repository.js';
import type { AuditService } from '../../audit/audit.service.js';
import type {
  PlanDayRow,
  PlanMainAssignmentRow,
  PlanRow,
  PlanSlotRow,
  PlanSlotVariationRow,
} from '@hivekitchen/types';
import { buildPlan, buildChild } from '../../../test/factories/index.js';

// Story 3-DM-C1 Phase 4 — verifies composePlanTree() shape + refreshTree's
// 8-read parallelism and tree-walk composition.

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const WEEK_OF = '2026-06-16';
const CHILD_A = '44444444-4444-4444-8444-444444444444';
const CHILD_B = '55555555-5555-4555-8555-555555555555';
const REQUEST_ID = '66666666-6666-4666-8666-666666666666';
const MAIN_ASSIGN_1 = '77777777-7777-4777-8777-777777777777';
const RECIPE_1 = '88888888-8888-4888-8888-888888888888';
const RECIPE_SNACK = '99999999-9999-4999-8999-999999999999';
const DAY_MON = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SLOT_MON_MAIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SLOT_MON_SNACK = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const VAR_MON_MAIN_A = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const VAR_MON_MAIN_B = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const NOW = '2026-06-01T12:00:00.000Z';

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
    child: vi.fn().mockReturnThis(), level: 'info', silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function mainAssign(overrides: Partial<PlanMainAssignmentRow> = {}): PlanMainAssignmentRow {
  return {
    id: MAIN_ASSIGN_1,
    plan_id: PLAN_ID,
    sequence: 1,
    recipe_id: RECIPE_1,
    created_at: NOW,
    ...overrides,
  };
}

function dayRow(overrides: Partial<PlanDayRow> = {}): PlanDayRow {
  return {
    id: DAY_MON,
    plan_id: PLAN_ID,
    day: 'monday',
    paused_at: null,
    paused_reason: null,
    paused_note: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function slotRow(overrides: Partial<PlanSlotRow> = {}): PlanSlotRow {
  return {
    id: SLOT_MON_MAIN,
    plan_day_id: DAY_MON,
    slot_kind: 'main',
    main_assignment_id: MAIN_ASSIGN_1,
    recipe_id: null,
    extra_kind: null,
    snack_sku_id: null,
    paused_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function variationRow(overrides: Partial<PlanSlotVariationRow> = {}): PlanSlotVariationRow {
  return {
    id: VAR_MON_MAIN_A,
    plan_slot_id: SLOT_MON_MAIN,
    child_id: CHILD_A,
    portion_size: 'regular',
    texture: 'normal',
    spice_level: 'mild',
    cutting_style: null,
    container: null,
    add_ons: [],
    removals: [],
    notes: null,
    paused_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

describe('composePlanTree (pure helper)', () => {
  it('joins main assignments to main slots by id', () => {
    const tree = composePlanTree({
      days: [dayRow()],
      mainAssignments: [mainAssign()],
      slots: [slotRow()],
      variations: [variationRow()],
    });
    expect(tree.days).toHaveLength(1);
    const day = tree.days[0]!;
    expect(day.slots[0]?.mainAssignment?.id).toBe(MAIN_ASSIGN_1);
    expect(day.slots[0]?.variations).toHaveLength(1);
  });

  it('sorts days Mon→Sat regardless of input order', () => {
    const tree = composePlanTree({
      days: [
        dayRow({ id: 'd-fri', day: 'friday' }),
        dayRow({ id: 'd-mon', day: 'monday' }),
        dayRow({ id: 'd-sat', day: 'saturday' }),
      ],
      mainAssignments: [],
      slots: [],
      variations: [],
    });
    expect(tree.days.map((d) => d.day)).toEqual(['monday', 'friday', 'saturday']);
  });

  it('sorts slots main→snack→extra within each day', () => {
    const tree = composePlanTree({
      days: [dayRow()],
      mainAssignments: [mainAssign()],
      slots: [
        slotRow({ id: 's-snack', slot_kind: 'snack', main_assignment_id: null, recipe_id: RECIPE_SNACK }),
        slotRow({ id: 's-extra', slot_kind: 'extra', main_assignment_id: null, recipe_id: RECIPE_SNACK, extra_kind: 'sweet' }),
        slotRow({ id: 's-main', slot_kind: 'main' }),
      ],
      variations: [],
    });
    const day = tree.days[0]!;
    expect(day.slots.map((s) => s.slot.slot_kind)).toEqual(['main', 'snack', 'extra']);
  });

  it('groups variations by slot id', () => {
    const tree = composePlanTree({
      days: [dayRow()],
      mainAssignments: [mainAssign()],
      slots: [slotRow()],
      variations: [
        variationRow({ id: 'v-a', child_id: CHILD_A }),
        variationRow({ id: 'v-b', child_id: CHILD_B }),
      ],
    });
    const slot = tree.days[0]!.slots[0]!;
    expect(slot.variations.map((v) => v.child_id).sort()).toEqual([CHILD_A, CHILD_B]);
  });

  it('builds main-assignment lookup maps by sequence and id', () => {
    const tree = composePlanTree({
      days: [],
      mainAssignments: [
        mainAssign({ id: 'm1', sequence: 1 }),
        mainAssign({ id: 'm2', sequence: 2, recipe_id: RECIPE_SNACK }),
      ],
      slots: [],
      variations: [],
    });
    expect(tree.mainAssignmentsBySequence.get(1)?.id).toBe('m1');
    expect(tree.mainAssignmentsBySequence.get(2)?.id).toBe('m2');
    expect(tree.mainAssignmentsById.get('m1')?.sequence).toBe(1);
  });
});

describe('BriefStateComposer.refreshTree — 8-read parallelism + composition', () => {
  function buildDeps(opts: {
    plan?: PlanRow | null;
    mainAssignments?: PlanMainAssignmentRow[];
    days?: PlanDayRow[];
    slots?: PlanSlotRow[];
    variations?: PlanSlotVariationRow[];
    children?: DecryptedChildRow[];
    previousBrief?: {
      payload: {
        tile_summaries: [];
        plan_state: null;
        plan_state_set_at: null;
        plan_state_message: null;
        // Slice 5-S9 — carry-forward source for plan_reasoning.
        plan_reasoning?: string | null;
      };
    } | null;
  }) {
    const findCurrentByHousehold = vi.fn().mockResolvedValue(opts.plan ?? null);
    const findMainAssignmentsByPlanId = vi.fn().mockResolvedValue(opts.mainAssignments ?? []);
    const findDaysByPlanId = vi.fn().mockResolvedValue(opts.days ?? []);
    const findSlotsByDayIds = vi.fn().mockResolvedValue(opts.slots ?? []);
    const findVariationsBySlotIds = vi.fn().mockResolvedValue(opts.variations ?? []);
    const findByHousehold = vi.fn().mockResolvedValue(opts.previousBrief ?? null);
    const findByHouseholdId = vi.fn().mockResolvedValue(opts.children ?? []);
    const upsert = vi.fn().mockResolvedValue(undefined);
    const write = vi.fn().mockResolvedValue(undefined);

    const plansRepo = {
      findCurrentByHousehold,
      findMainAssignmentsByPlanId,
      findDaysByPlanId,
      findSlotsByDayIds,
      findVariationsBySlotIds,
    } as unknown as PlansRepository;

    const briefRepo = { upsert, findByHousehold } as unknown as BriefStateRepository;
    const childrenRepo = { findByHouseholdId } as unknown as ChildrenRepository;
    const audit = { write } as unknown as AuditService;
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: childrenRepo,
      auditService: audit,
      logger: buildLogger(),
    });
    return {
      composer,
      mocks: {
        findCurrentByHousehold,
        findMainAssignmentsByPlanId,
        findDaysByPlanId,
        findSlotsByDayIds,
        findVariationsBySlotIds,
        findByHousehold,
        findByHouseholdId,
        upsert,
        write,
      },
    };
  }

  it('no-ops gracefully when no cleared plan exists', async () => {
    const { composer, mocks } = buildDeps({ plan: null });
    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.findMainAssignmentsByPlanId).not.toHaveBeenCalled();
  });

  // Slice 5-S9 — "Why this?" plan reasoning carry-forward.
  it('sets plan_reasoning from opts.planReasoning when provided', async () => {
    const plan = buildPlan({ id: PLAN_ID, household_id: HOUSEHOLD_ID });
    const { composer, mocks } = buildDeps({ plan });
    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID, {
      planReasoning: 'Batch-prep pasta chosen for the week.',
    });
    const upsertCall = mocks.upsert.mock.calls[0]![0] as { payload: { plan_reasoning: string | null } };
    expect(upsertCall.payload.plan_reasoning).toBe('Batch-prep pasta chosen for the week.');
  });

  it('carries forward plan_reasoning from previousBrief when opts has none', async () => {
    const plan = buildPlan({ id: PLAN_ID, household_id: HOUSEHOLD_ID });
    const previousBrief = {
      payload: {
        tile_summaries: [] as [],
        plan_state: null,
        plan_state_set_at: null,
        plan_state_message: null,
        plan_reasoning: 'Carried forward reasoning.',
      },
    };
    const { composer, mocks } = buildDeps({ plan, previousBrief });
    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);
    const upsertCall = mocks.upsert.mock.calls[0]![0] as { payload: { plan_reasoning: string | null } };
    expect(upsertCall.payload.plan_reasoning).toBe('Carried forward reasoning.');
  });

  it('sets plan_reasoning to null when opts has none and previousBrief has none', async () => {
    const plan = buildPlan({ id: PLAN_ID, household_id: HOUSEHOLD_ID });
    const { composer, mocks } = buildDeps({ plan, previousBrief: null });
    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);
    const upsertCall = mocks.upsert.mock.calls[0]![0] as { payload: { plan_reasoning: string | null } };
    expect(upsertCall.payload.plan_reasoning).toBeNull();
  });

  it('fires the 4 tree reads in parallel and upserts when a cleared plan exists', async () => {
    const plan = buildPlan({ id: PLAN_ID, household_id: HOUSEHOLD_ID });
    const days = [dayRow({ id: DAY_MON, day: 'monday' })];
    const slots = [slotRow({ id: SLOT_MON_MAIN, plan_day_id: DAY_MON })];
    const variations = [variationRow({ plan_slot_id: SLOT_MON_MAIN, child_id: CHILD_A })];
    const mainAssignments = [mainAssign({ id: MAIN_ASSIGN_1, plan_id: PLAN_ID })];
    const children = [buildChild({ id: CHILD_A, household_id: HOUSEHOLD_ID, declared_allergens: ['peanut'] })];

    const { composer, mocks } = buildDeps({ plan, mainAssignments, days, slots, variations, children });

    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);

    expect(mocks.findMainAssignmentsByPlanId).toHaveBeenCalledWith(PLAN_ID);
    expect(mocks.findDaysByPlanId).toHaveBeenCalledWith(PLAN_ID);
    expect(mocks.findSlotsByDayIds).toHaveBeenCalledWith([DAY_MON]);
    expect(mocks.findVariationsBySlotIds).toHaveBeenCalledWith([SLOT_MON_MAIN]);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);

    const upsertCall = mocks.upsert.mock.calls[0]![0] as {
      payload: {
        tile_summaries: Array<{ day: string; items: Array<{ child_id: string; slot: string; recipe_id?: string }> }>;
        cleared_allergies: Array<{ child_id: string; allergen: string }>;
      };
    };

    expect(upsertCall.payload.tile_summaries).toHaveLength(1);
    expect(upsertCall.payload.tile_summaries[0]?.day).toBe('monday');
    expect(upsertCall.payload.tile_summaries[0]?.items[0]?.child_id).toBe(CHILD_A);
    expect(upsertCall.payload.tile_summaries[0]?.items[0]?.slot).toBe('main');
    expect(upsertCall.payload.tile_summaries[0]?.items[0]?.recipe_id).toBe(RECIPE_1);
    expect(upsertCall.payload.cleared_allergies).toEqual([
      { child_id: CHILD_A, child_name: expect.any(String), allergen: 'peanut' },
    ]);
  });

  // Story 3-S40 (AC6) — snack-SKU tile name resolution.
  it('resolves snack_sku_id → snack_skus.name onto the snack tile item', async () => {
    const SNACK_SKU_1 = '30000000-0000-4000-8000-000000000001';
    const plan = buildPlan({ id: PLAN_ID, household_id: HOUSEHOLD_ID });
    const days = [dayRow({ id: DAY_MON, day: 'monday' })];
    const slots = [
      slotRow({ id: SLOT_MON_MAIN, plan_day_id: DAY_MON }),
      slotRow({
        id: SLOT_MON_SNACK,
        plan_day_id: DAY_MON,
        slot_kind: 'snack',
        main_assignment_id: null,
        recipe_id: null,
        snack_sku_id: SNACK_SKU_1,
      } as Partial<PlanSlotRow>),
    ];
    const variations = [
      variationRow({ id: VAR_MON_MAIN_A, plan_slot_id: SLOT_MON_MAIN, child_id: CHILD_A }),
      variationRow({ id: VAR_MON_MAIN_B, plan_slot_id: SLOT_MON_SNACK, child_id: CHILD_A }),
    ];
    const mainAssignments = [mainAssign({ id: MAIN_ASSIGN_1, plan_id: PLAN_ID })];

    const findNamesByIds = vi
      .fn()
      .mockResolvedValue(new Map([[SNACK_SKU_1, 'Apple']]));

    const upsert = vi.fn().mockResolvedValue(undefined);
    const composer = new BriefStateComposer({
      plansRepository: {
        findCurrentByHousehold: vi.fn().mockResolvedValue(plan),
        findMainAssignmentsByPlanId: vi.fn().mockResolvedValue(mainAssignments),
        findDaysByPlanId: vi.fn().mockResolvedValue(days),
        findSlotsByDayIds: vi.fn().mockResolvedValue(slots),
        findVariationsBySlotIds: vi.fn().mockResolvedValue(variations),
      } as unknown as PlansRepository,
      briefStateRepository: {
        upsert,
        findByHousehold: vi.fn().mockResolvedValue(null),
      } as unknown as BriefStateRepository,
      childrenRepository: {
        findByHouseholdId: vi.fn().mockResolvedValue([]),
      } as unknown as ChildrenRepository,
      auditService: { write: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
      logger: buildLogger(),
      snackSkuRepository: { findNamesByIds } as unknown as never,
    });

    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);

    expect(findNamesByIds).toHaveBeenCalledWith([SNACK_SKU_1]);
    const upsertCall = upsert.mock.calls[0]![0] as {
      payload: {
        tile_summaries: Array<{
          items: Array<{ slot: string; snack_sku_id?: string; name?: string }>;
        }>;
      };
    };
    const snackItem = upsertCall.payload.tile_summaries[0]?.items.find(
      (i) => i.slot === 'snack',
    );
    expect(snackItem?.snack_sku_id).toBe(SNACK_SKU_1);
    expect(snackItem?.name).toBe('Apple');
  });

  // Main/extra tile name resolution — recipe_id → recipes.canonical_name.
  it('resolves a main slot recipe_id → recipes.canonical_name onto the tile item', async () => {
    const plan = buildPlan({ id: PLAN_ID, household_id: HOUSEHOLD_ID });
    const days = [dayRow({ id: DAY_MON, day: 'monday' })];
    const slots = [slotRow({ id: SLOT_MON_MAIN, plan_day_id: DAY_MON })];
    const variations = [
      variationRow({ id: VAR_MON_MAIN_A, plan_slot_id: SLOT_MON_MAIN, child_id: CHILD_A }),
    ];
    const mainAssignments = [
      mainAssign({ id: MAIN_ASSIGN_1, plan_id: PLAN_ID, recipe_id: RECIPE_1 }),
    ];

    const findNamesByIds = vi
      .fn()
      .mockResolvedValue(new Map([[RECIPE_1, 'Chicken Biriyani']]));
    const upsert = vi.fn().mockResolvedValue(undefined);
    const composer = new BriefStateComposer({
      plansRepository: {
        findCurrentByHousehold: vi.fn().mockResolvedValue(plan),
        findMainAssignmentsByPlanId: vi.fn().mockResolvedValue(mainAssignments),
        findDaysByPlanId: vi.fn().mockResolvedValue(days),
        findSlotsByDayIds: vi.fn().mockResolvedValue(slots),
        findVariationsBySlotIds: vi.fn().mockResolvedValue(variations),
      } as unknown as PlansRepository,
      briefStateRepository: {
        upsert,
        findByHousehold: vi.fn().mockResolvedValue(null),
      } as unknown as BriefStateRepository,
      childrenRepository: {
        findByHouseholdId: vi.fn().mockResolvedValue([]),
      } as unknown as ChildrenRepository,
      auditService: { write: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
      logger: buildLogger(),
      recipesRepository: { findNamesByIds } as unknown as never,
    });

    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);

    expect(findNamesByIds).toHaveBeenCalledWith([RECIPE_1]);
    const upsertCall = upsert.mock.calls[0]![0] as {
      payload: {
        tile_summaries: Array<{ items: Array<{ slot: string; recipe_id?: string; name?: string }> }>;
      };
    };
    const mainItem = upsertCall.payload.tile_summaries[0]?.items.find((i) => i.slot === 'main');
    expect(mainItem?.recipe_id).toBe(RECIPE_1);
    expect(mainItem?.name).toBe('Chicken Biriyani');
  });

  // Story 14-s3 (AC1) — extra slots carry recipe_id directly (no main assignment
  // to dereference), so they must resolve a name the same way mains do.
  it('resolves an extra slot recipe_id → canonical_name onto the tile item', async () => {
    const plan = buildPlan({ id: PLAN_ID, household_id: HOUSEHOLD_ID });
    const days = [dayRow({ id: DAY_MON, day: 'monday' })];
    const slots = [
      slotRow({
        id: SLOT_MON_SNACK,
        plan_day_id: DAY_MON,
        slot_kind: 'extra',
        main_assignment_id: null,
        recipe_id: RECIPE_SNACK,
      }),
    ];
    const variations = [
      variationRow({ id: VAR_MON_MAIN_A, plan_slot_id: SLOT_MON_SNACK, child_id: CHILD_A }),
    ];

    const findNamesByIds = vi
      .fn()
      .mockResolvedValue(new Map([[RECIPE_SNACK, 'Banana Bread']]));
    const upsert = vi.fn().mockResolvedValue(undefined);
    const composer = new BriefStateComposer({
      plansRepository: {
        findCurrentByHousehold: vi.fn().mockResolvedValue(plan),
        findMainAssignmentsByPlanId: vi.fn().mockResolvedValue([]),
        findDaysByPlanId: vi.fn().mockResolvedValue(days),
        findSlotsByDayIds: vi.fn().mockResolvedValue(slots),
        findVariationsBySlotIds: vi.fn().mockResolvedValue(variations),
      } as unknown as PlansRepository,
      briefStateRepository: {
        upsert,
        findByHousehold: vi.fn().mockResolvedValue(null),
      } as unknown as BriefStateRepository,
      childrenRepository: {
        findByHouseholdId: vi.fn().mockResolvedValue([]),
      } as unknown as ChildrenRepository,
      auditService: { write: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
      logger: buildLogger(),
      recipesRepository: { findNamesByIds } as unknown as never,
    });

    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);

    // Review P7 — pin the batch lookup itself, not just the projected output, so
    // a composer that sourced the name elsewhere could not silently pass.
    expect(findNamesByIds).toHaveBeenCalledWith([RECIPE_SNACK]);
    const upsertCall = upsert.mock.calls[0]![0] as {
      payload: { tile_summaries: Array<{ items: Array<{ slot: string; name?: string }> }> };
    };
    const extraItem = upsertCall.payload.tile_summaries[0]?.items.find((i) => i.slot === 'extra');
    expect(extraItem?.name).toBe('Banana Bread');
  });

  // Story 14-s3 AC1 (review P7) — snack slots may carry a recipe_id instead of a
  // snack_sku_id ("snack-recipe slots likewise"); the tileSnackSkuId === null
  // guard is a distinct branch from both the SKU path and the extra path.
  it('resolves a snack slot carrying recipe_id (no snack_sku_id) → canonical_name', async () => {
    const plan = buildPlan({ id: PLAN_ID, household_id: HOUSEHOLD_ID });
    const days = [dayRow({ id: DAY_MON, day: 'monday' })];
    const slots = [
      slotRow({
        id: SLOT_MON_SNACK,
        plan_day_id: DAY_MON,
        slot_kind: 'snack',
        main_assignment_id: null,
        recipe_id: RECIPE_SNACK,
        snack_sku_id: null,
      }),
    ];
    const variations = [
      variationRow({ id: VAR_MON_MAIN_A, plan_slot_id: SLOT_MON_SNACK, child_id: CHILD_A }),
    ];

    const findNamesByIds = vi
      .fn()
      .mockResolvedValue(new Map([[RECIPE_SNACK, 'Oat Energy Bites']]));
    const upsert = vi.fn().mockResolvedValue(undefined);
    const composer = new BriefStateComposer({
      plansRepository: {
        findCurrentByHousehold: vi.fn().mockResolvedValue(plan),
        findMainAssignmentsByPlanId: vi.fn().mockResolvedValue([]),
        findDaysByPlanId: vi.fn().mockResolvedValue(days),
        findSlotsByDayIds: vi.fn().mockResolvedValue(slots),
        findVariationsBySlotIds: vi.fn().mockResolvedValue(variations),
      } as unknown as PlansRepository,
      briefStateRepository: {
        upsert,
        findByHousehold: vi.fn().mockResolvedValue(null),
      } as unknown as BriefStateRepository,
      childrenRepository: {
        findByHouseholdId: vi.fn().mockResolvedValue([]),
      } as unknown as ChildrenRepository,
      auditService: { write: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
      logger: buildLogger(),
      recipesRepository: { findNamesByIds } as unknown as never,
    });

    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);

    expect(findNamesByIds).toHaveBeenCalledWith([RECIPE_SNACK]);
    const upsertCall = upsert.mock.calls[0]![0] as {
      payload: {
        tile_summaries: Array<{ items: Array<{ slot: string; recipe_id?: string; name?: string }> }>;
      };
    };
    const snackItem = upsertCall.payload.tile_summaries[0]?.items.find((i) => i.slot === 'snack');
    expect(snackItem?.recipe_id).toBe(RECIPE_SNACK);
    expect(snackItem?.name).toBe('Oat Energy Bites');
  });

  // Story 14-s3 (AC1) — a recipe row the catalog cannot resolve must not break
  // the projection; the tile keeps its recipe_id and simply carries no name, so
  // the frontend falls back to its ingredient-derived dish line.
  it('tolerates a recipe_id the catalog cannot name', async () => {
    const plan = buildPlan({ id: PLAN_ID, household_id: HOUSEHOLD_ID });
    const days = [dayRow({ id: DAY_MON, day: 'monday' })];
    const slots = [slotRow({ id: SLOT_MON_MAIN, plan_day_id: DAY_MON })];
    const variations = [
      variationRow({ id: VAR_MON_MAIN_A, plan_slot_id: SLOT_MON_MAIN, child_id: CHILD_A }),
    ];
    const mainAssignments = [
      mainAssign({ id: MAIN_ASSIGN_1, plan_id: PLAN_ID, recipe_id: RECIPE_1 }),
    ];

    const upsert = vi.fn().mockResolvedValue(undefined);
    const composer = new BriefStateComposer({
      plansRepository: {
        findCurrentByHousehold: vi.fn().mockResolvedValue(plan),
        findMainAssignmentsByPlanId: vi.fn().mockResolvedValue(mainAssignments),
        findDaysByPlanId: vi.fn().mockResolvedValue(days),
        findSlotsByDayIds: vi.fn().mockResolvedValue(slots),
        findVariationsBySlotIds: vi.fn().mockResolvedValue(variations),
      } as unknown as PlansRepository,
      briefStateRepository: {
        upsert,
        findByHousehold: vi.fn().mockResolvedValue(null),
      } as unknown as BriefStateRepository,
      childrenRepository: {
        findByHouseholdId: vi.fn().mockResolvedValue([]),
      } as unknown as ChildrenRepository,
      auditService: { write: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
      logger: buildLogger(),
      recipesRepository: {
        findNamesByIds: vi.fn().mockResolvedValue(new Map<string, string>()),
      } as unknown as never,
    });

    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);

    const upsertCall = upsert.mock.calls[0]![0] as {
      payload: {
        tile_summaries: Array<{ items: Array<{ slot: string; recipe_id?: string; name?: string }> }>;
      };
    };
    const mainItem = upsertCall.payload.tile_summaries[0]?.items.find((i) => i.slot === 'main');
    expect(mainItem?.recipe_id).toBe(RECIPE_1);
    expect(mainItem?.name).toBeUndefined();
  });

  it('marks a day paused when every variation on it is paused', async () => {
    const plan = buildPlan({ id: PLAN_ID, household_id: HOUSEHOLD_ID });
    const days = [dayRow({ id: DAY_MON, day: 'monday' })];
    const slots = [slotRow({ id: SLOT_MON_MAIN, plan_day_id: DAY_MON })];
    const variations = [
      variationRow({ id: VAR_MON_MAIN_A, plan_slot_id: SLOT_MON_MAIN, child_id: CHILD_A, paused_at: NOW }),
      variationRow({ id: VAR_MON_MAIN_B, plan_slot_id: SLOT_MON_MAIN, child_id: CHILD_B, paused_at: NOW }),
    ];
    const mainAssignments = [mainAssign({ id: MAIN_ASSIGN_1, plan_id: PLAN_ID })];

    const { composer, mocks } = buildDeps({ plan, mainAssignments, days, slots, variations, children: [] });

    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);

    const upsertCall = mocks.upsert.mock.calls[0]![0] as {
      payload: { tile_summaries: Array<{ day: string; paused: boolean }> };
    };
    expect(upsertCall.payload.tile_summaries[0]?.paused).toBe(true);
  });

  it('marks a day paused via day-level paused_at even if variations aren’t', async () => {
    const plan = buildPlan({ id: PLAN_ID, household_id: HOUSEHOLD_ID });
    const days = [dayRow({ id: DAY_MON, day: 'monday', paused_at: NOW, paused_reason: 'snow_day' })];
    const slots = [slotRow({ id: SLOT_MON_MAIN, plan_day_id: DAY_MON })];
    const variations = [variationRow({ plan_slot_id: SLOT_MON_MAIN, child_id: CHILD_A })];
    const mainAssignments = [mainAssign({ id: MAIN_ASSIGN_1, plan_id: PLAN_ID })];

    const { composer, mocks } = buildDeps({ plan, mainAssignments, days, slots, variations, children: [] });

    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);

    const upsertCall = mocks.upsert.mock.calls[0]![0] as {
      payload: { tile_summaries: Array<{ day: string; paused: boolean }> };
    };
    expect(upsertCall.payload.tile_summaries[0]?.paused).toBe(true);
  });

  it('writes an audit failure event when a parallel read throws', async () => {
    const plan = buildPlan({ id: PLAN_ID, household_id: HOUSEHOLD_ID });
    const { composer, mocks } = buildDeps({ plan });
    mocks.findMainAssignmentsByPlanId.mockRejectedValueOnce(new Error('db-down'));
    mocks.findDaysByPlanId.mockResolvedValue([dayRow({ id: DAY_MON })]);

    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);

    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'brief.projection.failure',
        household_id: HOUSEHOLD_ID,
        request_id: REQUEST_ID,
        metadata: expect.objectContaining({ path: 'refreshTree', error: 'db-down' }),
      }),
    );
  });

  it('Lunch Link suppression overlays per day when repository is wired', async () => {
    const plan = buildPlan({ id: PLAN_ID, household_id: HOUSEHOLD_ID, week_of: '2026-06-01' });
    const days = [dayRow({ id: DAY_MON, day: 'monday' })];
    const slots = [slotRow({ id: SLOT_MON_MAIN, plan_day_id: DAY_MON })];
    const variations = [variationRow({ plan_slot_id: SLOT_MON_MAIN, child_id: CHILD_A })];
    const mainAssignments = [mainAssign({ id: MAIN_ASSIGN_1, plan_id: PLAN_ID })];

    const { composer, mocks } = buildDeps({ plan, mainAssignments, days, slots, variations, children: [] });
    const findSuppressedChildrenInRange = vi.fn().mockResolvedValue(
      new Map([['2026-06-01', [CHILD_A]]]),
    );
    const findRatingsInRange = vi.fn().mockResolvedValue(new Map());
    const lunchLink = {
      findSuppressedChildrenInRange,
      findRatingsInRange,
    } as unknown as LunchLinkSessionRepository;

    const composerWithLink = new BriefStateComposer({
      plansRepository: {
        findCurrentByHousehold: mocks.findCurrentByHousehold,
        findMainAssignmentsByPlanId: mocks.findMainAssignmentsByPlanId,
        findDaysByPlanId: mocks.findDaysByPlanId,
        findSlotsByDayIds: mocks.findSlotsByDayIds,
        findVariationsBySlotIds: mocks.findVariationsBySlotIds,
      } as unknown as PlansRepository,
      briefStateRepository: { upsert: mocks.upsert, findByHousehold: mocks.findByHousehold } as unknown as BriefStateRepository,
      childrenRepository: { findByHouseholdId: mocks.findByHouseholdId } as unknown as ChildrenRepository,
      lunchLinkSessionRepository: lunchLink,
      auditService: { write: mocks.write } as unknown as AuditService,
      logger: buildLogger(),
    });
    // Use composerWithLink to access lunch-link path; composer above doesn't.
    void composer; // referenced to keep eslint happy when composer is unused.

    await composerWithLink.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);

    const upsertCall = mocks.upsert.mock.calls[0]![0] as {
      payload: { tile_summaries: Array<{ day: string; lunch_link_suppressed_children: string[] }> };
    };
    expect(upsertCall.payload.tile_summaries[0]?.lunch_link_suppressed_children).toEqual([CHILD_A]);
  });
});

// Slice 5-S8 — "I noticed" learning-moment callout threshold + carry-forward.
describe('BriefStateComposer.refreshTree — 5-S8 learning moment', () => {
  const TURN_NODE_1 = '10000000-0000-4000-8000-000000000001';
  const TURN_NODE_2 = '10000000-0000-4000-8000-000000000002';
  const TURN_NODE_3 = '10000000-0000-4000-8000-000000000003';

  function turnNode(id: string, prose: string) {
    return { id, prose_text: prose, node_type: 'preference', created_at: NOW };
  }

  function buildLMDeps(opts: {
    memoryRepository?: { findRecentTurnSourcedNodes: ReturnType<typeof vi.fn> };
    suppressedUntil?: string | null;
  }) {
    const plan = buildPlan({ id: PLAN_ID, household_id: HOUSEHOLD_ID });
    const days = [dayRow({ id: DAY_MON, day: 'monday' })];
    const slots = [slotRow({ id: SLOT_MON_MAIN, plan_day_id: DAY_MON })];
    const variations = [variationRow({ plan_slot_id: SLOT_MON_MAIN, child_id: CHILD_A })];
    const mainAssignments = [mainAssign({ id: MAIN_ASSIGN_1, plan_id: PLAN_ID })];

    const upsert = vi.fn().mockResolvedValue(undefined);
    const previousBrief =
      opts.suppressedUntil !== undefined
        ? {
            payload: {
              tile_summaries: [],
              plan_state: null,
              plan_state_set_at: null,
              plan_state_message: null,
              learning_moment_suppressed_until: opts.suppressedUntil,
            },
          }
        : null;

    const composer = new BriefStateComposer({
      plansRepository: {
        findCurrentByHousehold: vi.fn().mockResolvedValue(plan),
        findMainAssignmentsByPlanId: vi.fn().mockResolvedValue(mainAssignments),
        findDaysByPlanId: vi.fn().mockResolvedValue(days),
        findSlotsByDayIds: vi.fn().mockResolvedValue(slots),
        findVariationsBySlotIds: vi.fn().mockResolvedValue(variations),
      } as unknown as PlansRepository,
      briefStateRepository: {
        upsert,
        findByHousehold: vi.fn().mockResolvedValue(previousBrief),
      } as unknown as BriefStateRepository,
      childrenRepository: {
        findByHouseholdId: vi.fn().mockResolvedValue([]),
      } as unknown as ChildrenRepository,
      auditService: { write: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
      logger: buildLogger(),
      ...(opts.memoryRepository
        ? { memoryRepository: opts.memoryRepository as unknown as MemoryRepository }
        : {}),
    });
    return { composer, upsert };
  }

  function calloutFromUpsert(upsert: ReturnType<typeof vi.fn>) {
    const call = upsert.mock.calls[0]![0] as {
      payload: {
        learning_moment_callout: { prose: string; node_ids: string[] } | null;
        learning_moment_suppressed_until: string | null;
      };
    };
    return call.payload;
  }

  it('sets learning_moment_callout when ≥3 turn-sourced nodes exist', async () => {
    const findRecentTurnSourcedNodes = vi
      .fn()
      .mockResolvedValue([
        turnNode(TURN_NODE_1, 'your family loves spicy food'),
        turnNode(TURN_NODE_2, 'you pack on Sundays'),
        turnNode(TURN_NODE_3, 'the twins share a Main'),
      ]);
    const { composer, upsert } = buildLMDeps({ memoryRepository: { findRecentTurnSourcedNodes } });

    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);

    const payload = calloutFromUpsert(upsert);
    expect(payload.learning_moment_callout).not.toBeNull();
    expect(payload.learning_moment_callout?.prose).toContain('your family loves spicy food');
    expect(payload.learning_moment_callout?.node_ids).toEqual([
      TURN_NODE_1,
      TURN_NODE_2,
      TURN_NODE_3,
    ]);
  });

  it('leaves learning_moment_callout null when < 3 nodes', async () => {
    const findRecentTurnSourcedNodes = vi
      .fn()
      .mockResolvedValue([turnNode(TURN_NODE_1, 'a'), turnNode(TURN_NODE_2, 'b')]);
    const { composer, upsert } = buildLMDeps({ memoryRepository: { findRecentTurnSourcedNodes } });

    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);

    expect(calloutFromUpsert(upsert).learning_moment_callout).toBeNull();
  });

  it('respects the suppress window — null callout when suppressedUntil is in the future', async () => {
    const future = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
    const findRecentTurnSourcedNodes = vi
      .fn()
      .mockResolvedValue([
        turnNode(TURN_NODE_1, 'a'),
        turnNode(TURN_NODE_2, 'b'),
        turnNode(TURN_NODE_3, 'c'),
        turnNode('10000000-0000-4000-8000-000000000004', 'd'),
        turnNode('10000000-0000-4000-8000-000000000005', 'e'),
      ]);
    const { composer, upsert } = buildLMDeps({
      memoryRepository: { findRecentTurnSourcedNodes },
      suppressedUntil: future,
    });

    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);

    expect(calloutFromUpsert(upsert).learning_moment_callout).toBeNull();
    // The threshold query is short-circuited when suppressed.
    expect(findRecentTurnSourcedNodes).not.toHaveBeenCalled();
  });

  it('carries forward learning_moment_suppressed_until unchanged', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const findRecentTurnSourcedNodes = vi
      .fn()
      .mockResolvedValue([
        turnNode(TURN_NODE_1, 'a'),
        turnNode(TURN_NODE_2, 'b'),
        turnNode(TURN_NODE_3, 'c'),
      ]);
    const { composer, upsert } = buildLMDeps({
      memoryRepository: { findRecentTurnSourcedNodes },
      suppressedUntil: past,
    });

    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);

    const payload = calloutFromUpsert(upsert);
    expect(payload.learning_moment_suppressed_until).toBe(past);
    // Past suppress window does not block — callout still forms.
    expect(payload.learning_moment_callout).not.toBeNull();
  });

  it('skips buildLearningMomentCallout when memoryRepository is absent', async () => {
    const { composer, upsert } = buildLMDeps({});

    await composer.refreshTree(HOUSEHOLD_ID, WEEK_OF, REQUEST_ID);

    expect(calloutFromUpsert(upsert).learning_moment_callout).toBeNull();
  });
});

// Slice 5-S9 (P4) — AC3 coverage: respondToLearningMoment must preserve plan_reasoning.
describe('BriefStateComposer.respondToLearningMoment — preserves plan_reasoning (5-S9)', () => {
  it('carries plan_reasoning forward through the payload spread on confirm', async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const currentBrief = {
      household_id: HOUSEHOLD_ID,
      plan_id: PLAN_ID,
      moment_headline: null,
      lumi_note: null,
      memory_prose: null,
      payload: {
        tile_summaries: [],
        plan_state: null,
        plan_state_set_at: null,
        plan_state_message: null,
        learning_moment_callout: { prose: 'I noticed something.', node_ids: [], surfaced_at: NOW },
        learning_moment_suppressed_until: null,
        plan_reasoning: 'Pasta for batch-prep this week.',
      },
      generated_at: NOW,
      plan_revision: 1,
    };

    const composer = new BriefStateComposer({
      plansRepository: {} as unknown as PlansRepository,
      briefStateRepository: {
        upsert,
        findByHousehold: vi.fn().mockResolvedValue(currentBrief),
      } as unknown as BriefStateRepository,
      childrenRepository: {} as unknown as ChildrenRepository,
      auditService: { write: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
      logger: buildLogger(),
    });

    await composer.respondToLearningMoment(HOUSEHOLD_ID, 'confirm', REQUEST_ID);

    const upsertPayload = (upsert.mock.calls[0]![0] as { payload: { plan_reasoning: string | null; learning_moment_callout: unknown } }).payload;
    expect(upsertPayload.plan_reasoning).toBe('Pasta for batch-prep this week.');
    expect(upsertPayload.learning_moment_callout).toBeNull();
  });
});

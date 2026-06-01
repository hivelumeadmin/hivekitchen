import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { BriefStateComposer } from './brief-state.composer.js';
import type { PlansRepository } from './plans.repository.js';
import type { BriefStateRepository } from './brief-state.repository.js';
import type { LunchLinkSessionRepository } from './lunch-link-session.repository.js';
import type {
  ChildrenRepository,
  DecryptedChildRow,
} from '../children/children.repository.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { PlanItemRow, PlanRow } from '@hivekitchen/types';
import { buildPlan, buildPlanItem } from '../../../test/factories/index.js';

// Story 3-DM-A3: aligned with shared factory convention
// (household=1's, plan=2's) to keep buildPlan / buildPlanItem defaults compatible.
const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const WEEK_ID = '33333333-3333-4333-8333-333333333333';
const CHILD_A = '44444444-4444-4444-8444-444444444444';
const CHILD_B = '55555555-5555-4555-8555-555555555555';
const REQUEST_ID = '66666666-6666-4666-8666-666666666666';

function buildLogger(): FastifyBaseLogger & {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
} {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  const debug = vi.fn();
  return {
    info,
    warn,
    error,
    debug,
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'info',
    silent: vi.fn(),
  } as unknown as FastifyBaseLogger & {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
}


function buildPlansRepo(opts: {
  currentPlan?: PlanRow | null;
  items?: PlanItemRow[];
  findItemsThrows?: Error;
  findCurrentThrows?: Error;
} = {}): PlansRepository & {
  findCurrentByHousehold: ReturnType<typeof vi.fn>;
  findItemsByPlanId: ReturnType<typeof vi.fn>;
} {
  const findCurrentByHousehold = vi.fn(async () => {
    if (opts.findCurrentThrows) throw opts.findCurrentThrows;
    return opts.currentPlan ?? null;
  });
  const findItemsByPlanId = vi.fn(async () => {
    if (opts.findItemsThrows) throw opts.findItemsThrows;
    return opts.items ?? [];
  });
  return { findCurrentByHousehold, findItemsByPlanId } as unknown as PlansRepository & {
    findCurrentByHousehold: ReturnType<typeof vi.fn>;
    findItemsByPlanId: ReturnType<typeof vi.fn>;
  };
}

function buildBriefStateRepo(opts: { upsertThrows?: Error } = {}): BriefStateRepository & {
  upsert: ReturnType<typeof vi.fn>;
  findByHousehold: ReturnType<typeof vi.fn>;
} {
  const upsert = vi.fn(async () => {
    if (opts.upsertThrows) throw opts.upsertThrows;
  });
  return {
    upsert,
    findByHousehold: vi.fn().mockResolvedValue(null),
  } as unknown as BriefStateRepository & {
    upsert: ReturnType<typeof vi.fn>;
    findByHousehold: ReturnType<typeof vi.fn>;
  };
}

function buildAudit(opts: { writeThrows?: Error } = {}): AuditService & {
  write: ReturnType<typeof vi.fn>;
} {
  const write = vi.fn(async () => {
    if (opts.writeThrows) throw opts.writeThrows;
  });
  return { write } as unknown as AuditService & { write: ReturnType<typeof vi.fn> };
}

function makeChild(overrides: Partial<DecryptedChildRow> = {}): DecryptedChildRow {
  return {
    id: CHILD_A,
    household_id: HOUSEHOLD_ID,
    name: 'Asha',
    age_band: 'child',
    school_policy_notes: null,
    declared_allergens: [],
    cultural_identifiers: [],
    dietary_preferences: [],
    appetite_level: 'normal',
    texture_needs: 'normal',
    spice_tolerance: 'mild',
    bag_composition_pattern: 'main_plus_snack_plus_extra',
    created_at: '2026-05-02T11:00:00.000Z',
    ...overrides,
  };
}

function buildChildrenRepo(opts: {
  children?: DecryptedChildRow[];
  findThrows?: Error;
} = {}): ChildrenRepository & {
  findByHouseholdId: ReturnType<typeof vi.fn>;
} {
  const findByHouseholdId = vi.fn(async () => {
    if (opts.findThrows) throw opts.findThrows;
    return opts.children ?? [];
  });
  return { findByHouseholdId } as unknown as ChildrenRepository & {
    findByHouseholdId: ReturnType<typeof vi.fn>;
  };
}

describe('BriefStateComposer.refresh', () => {
  it('reads cleared plan, builds tile summaries, and calls upsert with the plan revision', async () => {
    const plan = buildPlan({ revision: 3 });
    const items = [
      buildPlanItem({ id: 'a', child_id: CHILD_A, day: 'monday', slot: 'main', ingredients: ['rice'] }),
      buildPlanItem({ id: 'b', child_id: CHILD_B, day: 'monday', slot: 'main', ingredients: ['quinoa'] }),
    ];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepo();
    const audit = buildAudit();
    const logger = buildLogger();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      auditService: audit,
      logger,
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    expect(plansRepo.findCurrentByHousehold).toHaveBeenCalledWith({
      householdId: HOUSEHOLD_ID,
      weekId: WEEK_ID,
    });
    expect(plansRepo.findItemsByPlanId).toHaveBeenCalledWith(PLAN_ID);
    expect(briefRepo.upsert).toHaveBeenCalledTimes(1);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg).toMatchObject({
      household_id: HOUSEHOLD_ID,
      plan_id: PLAN_ID,
      moment_headline: '',
      lumi_note: '',
      memory_prose: '',
      scaffolding_diff: null,
      plan_revision: 3,
    });
    expect(upsertArg.plan_tile_summaries).toEqual([
      {
        day: 'monday',
        items: [
          { plan_item_id: 'a', child_id: CHILD_A, slot: 'main', ingredients: ['rice'] },
          { plan_item_id: 'b', child_id: CHILD_B, slot: 'main', ingredients: ['quinoa'] },
        ],
        paused: false,
        lunch_link_suppressed_children: [],
        child_ratings: {},
      },
    ]);
    // No children supplied → no cleared_allergies entries; default to [].
    expect(upsertArg.cleared_allergies).toEqual([]);
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('returns early without writing the projection when no cleared plan exists', async () => {
    const plansRepo = buildPlansRepo({ currentPlan: null });
    const briefRepo = buildBriefStateRepo();
    const audit = buildAudit();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      auditService: audit,
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    expect(plansRepo.findItemsByPlanId).not.toHaveBeenCalled();
    expect(briefRepo.upsert).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('does NOT throw when findItemsByPlanId fails — logs error, audits brief.projection.failure', async () => {
    const plan = buildPlan();
    const plansRepo = buildPlansRepo({
      currentPlan: plan,
      findItemsThrows: new Error('plan_items query failed'),
    });
    const briefRepo = buildBriefStateRepo();
    const audit = buildAudit();
    const logger = buildLogger();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      auditService: audit,
      logger,
    });

    await expect(composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID)).resolves.toBeUndefined();

    expect(briefRepo.upsert).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ household_id: HOUSEHOLD_ID, week_id: WEEK_ID }),
      expect.stringContaining('brief_state projection refresh failed'),
    );
    expect(audit.write).toHaveBeenCalledTimes(1);
    expect(audit.write.mock.calls[0]?.[0]).toMatchObject({
      event_type: 'brief.projection.failure',
      household_id: HOUSEHOLD_ID,
      request_id: REQUEST_ID,
      metadata: expect.objectContaining({
        week_id: WEEK_ID,
        error: 'plan_items query failed',
      }),
    });
  });

  it('does NOT throw when upsert fails — logs error, audits brief.projection.failure', async () => {
    const plan = buildPlan();
    const plansRepo = buildPlansRepo({ currentPlan: plan, items: [buildPlanItem()] });
    const briefRepo = buildBriefStateRepo({ upsertThrows: new Error('upsert failed') });
    const audit = buildAudit();
    const logger = buildLogger();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      auditService: audit,
      logger,
    });

    await expect(composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID)).resolves.toBeUndefined();

    expect(audit.write).toHaveBeenCalledTimes(1);
    expect(audit.write.mock.calls[0]?.[0]).toMatchObject({
      event_type: 'brief.projection.failure',
      metadata: expect.objectContaining({ error: 'upsert failed' }),
    });
  });

  it('logs a secondary error and does not rethrow when audit write also fails', async () => {
    const plan = buildPlan();
    const plansRepo = buildPlansRepo({
      currentPlan: plan,
      findItemsThrows: new Error('primary failure'),
    });
    const briefRepo = buildBriefStateRepo();
    const audit = buildAudit({ writeThrows: new Error('audit DB down') });
    const logger = buildLogger();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      auditService: audit,
      logger,
    });

    await expect(composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledTimes(2);
    const calls = logger.error.mock.calls.map((c) => c[1]);
    expect(calls).toContain('brief_state projection refresh failed');
    expect(calls).toContain('audit write failed for brief.projection.failure');
  });

  it('groups items by day, skips non-school days (sun), and emits days in Mon→Sat order', async () => {
    const plan = buildPlan();
    const items = [
      buildPlanItem({ id: 'sat', day: 'saturday' }),
      buildPlanItem({ id: 'fri', day: 'friday', child_id: CHILD_B, ingredients: ['pasta'] }),
      buildPlanItem({ id: 'tue', day: 'tuesday', child_id: CHILD_A, ingredients: ['oats'] }),
      buildPlanItem({ id: 'tue2', day: 'tuesday', child_id: CHILD_B, ingredients: ['oats'] }),
      buildPlanItem({
        id: 'mon',
        day: 'monday',
        recipe_id: '00000000-0000-4000-8000-000000000020',
        item_id: '00000000-0000-4000-8000-000000000021',
      }),
      buildPlanItem({ id: 'sun', day: 'sunday' }),
    ];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepo();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.plan_tile_summaries.map((s: { day: string }) => s.day)).toEqual([
      'monday',
      'tuesday',
      'friday',
      'saturday',
    ]);
    expect(upsertArg.plan_tile_summaries[0].items[0]).toMatchObject({
      child_id: CHILD_A,
      slot: 'main',
      recipe_id: '00000000-0000-4000-8000-000000000020',
      item_id: '00000000-0000-4000-8000-000000000021',
    });
    expect(upsertArg.plan_tile_summaries[1].items).toHaveLength(2);
  });

  it('produces plan_tile_summaries: [] when items array is empty', async () => {
    const plan = buildPlan();
    const plansRepo = buildPlansRepo({ currentPlan: plan, items: [] });
    const briefRepo = buildBriefStateRepo();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.plan_tile_summaries).toEqual([]);
    expect(briefRepo.upsert).toHaveBeenCalledTimes(1);
  });

  it('emits scaffolding_diff: null unconditionally until Story 3.12', async () => {
    const plan = buildPlan();
    const plansRepo = buildPlansRepo({ currentPlan: plan, items: [buildPlanItem()] });
    const briefRepo = buildBriefStateRepo();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.scaffolding_diff).toBeNull();
  });
});

describe('BriefStateComposer.refresh — cleared_allergies (Story 3.10)', () => {
  it('emits cleared_allergies entries for children-with-allergens whose plan items appear', async () => {
    const plan = buildPlan();
    const items = [buildPlanItem({ child_id: CHILD_A, day: 'monday', slot: 'main' })];
    const children = [
      makeChild({ id: CHILD_A, name: 'Asha', declared_allergens: ['peanut'] }),
    ];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepo();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo({ children }),
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.cleared_allergies).toEqual([
      { child_id: CHILD_A, child_name: 'Asha', allergen: 'peanut' },
    ]);
  });

  it('omits children whose declared_allergens is empty', async () => {
    const plan = buildPlan();
    const items = [buildPlanItem({ child_id: CHILD_A })];
    const children = [makeChild({ id: CHILD_A, declared_allergens: [] })];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepo();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo({ children }),
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.cleared_allergies).toEqual([]);
  });

  it('omits children not present in plan_items', async () => {
    const plan = buildPlan();
    const items = [buildPlanItem({ child_id: CHILD_A })];
    const children = [
      makeChild({ id: CHILD_A, name: 'Asha', declared_allergens: ['peanut'] }),
      makeChild({ id: CHILD_B, name: 'Rohan', declared_allergens: ['gluten'] }),
    ];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepo();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo({ children }),
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.cleared_allergies).toEqual([
      { child_id: CHILD_A, child_name: 'Asha', allergen: 'peanut' },
    ]);
  });

  it('emits empty array when no household child has declared allergens', async () => {
    const plan = buildPlan();
    const items = [buildPlanItem({ child_id: CHILD_A })];
    const children = [
      makeChild({ id: CHILD_A, declared_allergens: [] }),
      makeChild({ id: CHILD_B, declared_allergens: [] }),
    ];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepo();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo({ children }),
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.cleared_allergies).toEqual([]);
  });

  it('emits one entry per (child, allergen) pair when a child has multiple allergens', async () => {
    const plan = buildPlan();
    const items = [buildPlanItem({ child_id: CHILD_A })];
    const children = [
      makeChild({
        id: CHILD_A,
        name: 'Asha',
        declared_allergens: ['peanut', 'tree nut', 'sesame'],
      }),
    ];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepo();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo({ children }),
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.cleared_allergies).toEqual([
      { child_id: CHILD_A, child_name: 'Asha', allergen: 'peanut' },
      { child_id: CHILD_A, child_name: 'Asha', allergen: 'tree nut' },
      { child_id: CHILD_A, child_name: 'Asha', allergen: 'sesame' },
    ]);
  });

  it('does NOT throw when childrenRepository.findByHouseholdId fails — audits brief.projection.failure', async () => {
    const plan = buildPlan();
    const plansRepo = buildPlansRepo({ currentPlan: plan, items: [buildPlanItem()] });
    const briefRepo = buildBriefStateRepo();
    const audit = buildAudit();
    const childrenRepo = buildChildrenRepo({
      findThrows: new Error('children query failed'),
    });
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: childrenRepo,
      auditService: audit,
      logger: buildLogger(),
    });

    await expect(composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID)).resolves.toBeUndefined();

    expect(briefRepo.upsert).not.toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledTimes(1);
    expect(audit.write.mock.calls[0]?.[0]).toMatchObject({
      event_type: 'brief.projection.failure',
      metadata: expect.objectContaining({ error: 'children query failed' }),
    });
  });
});

describe('BriefStateComposer.refresh — Story 3.12 (plan_id, paused, scaffolding_diff)', () => {
  function buildBriefStateRepoWithPrevious(
    previousTileSummaries: ReadonlyArray<{
      day: string;
      items: ReadonlyArray<{ child_id: string; slot: string; ingredients: string[] }>;
      paused?: boolean;
    }> | null,
  ): BriefStateRepository & {
    upsert: ReturnType<typeof vi.fn>;
    findByHousehold: ReturnType<typeof vi.fn>;
  } {
    const previous =
      previousTileSummaries === null
        ? null
        : { plan_tile_summaries: previousTileSummaries };
    return {
      upsert: vi.fn().mockResolvedValue(undefined),
      findByHousehold: vi.fn().mockResolvedValue(previous),
    } as unknown as BriefStateRepository & {
      upsert: ReturnType<typeof vi.fn>;
      findByHousehold: ReturnType<typeof vi.fn>;
    };
  }

  it('exposes plan.id as plan_id in upsertInput', async () => {
    const plan = buildPlan();
    const plansRepo = buildPlansRepo({ currentPlan: plan, items: [buildPlanItem()] });
    const briefRepo = buildBriefStateRepoWithPrevious(null);
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.plan_id).toBe(PLAN_ID);
  });

  it('emits plan_item_id on each tile item (matches plan_items.id)', async () => {
    const plan = buildPlan();
    const items = [buildPlanItem({ id: 'item-1', child_id: CHILD_A, day: 'monday' })];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepoWithPrevious(null);
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.plan_tile_summaries[0].items[0]).toMatchObject({
      plan_item_id: 'item-1',
    });
  });

  it('emits paused: true when ALL items for a day have paused_at set', async () => {
    const plan = buildPlan();
    const pausedAt = '2026-05-04T12:00:00.000Z';
    const items = [
      buildPlanItem({ id: 'a', child_id: CHILD_A, day: 'tuesday', paused_at: pausedAt }),
      buildPlanItem({ id: 'b', child_id: CHILD_B, day: 'tuesday', paused_at: pausedAt }),
    ];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepoWithPrevious(null);
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.plan_tile_summaries[0]).toMatchObject({
      day: 'tuesday',
      paused: true,
    });
  });

  it('emits paused: false when only some items for a day are paused (partial)', async () => {
    const plan = buildPlan();
    const items = [
      buildPlanItem({
        id: 'a',
        child_id: CHILD_A,
        day: 'tuesday',
        paused_at: '2026-05-04T12:00:00.000Z',
      }),
      buildPlanItem({ id: 'b', child_id: CHILD_B, day: 'tuesday', paused_at: null }),
    ];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepoWithPrevious(null);
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.plan_tile_summaries[0]).toMatchObject({
      day: 'tuesday',
      paused: false,
    });
  });

  it('scaffolding_diff stays null when userInitiated:true even if ingredients differ', async () => {
    const plan = buildPlan();
    const previousTileSummaries = [
      {
        day: 'monday',
        items: [{ child_id: CHILD_A, slot: 'main', ingredients: ['rice'] }],
      },
    ];
    const items = [
      buildPlanItem({ id: 'item-1', child_id: CHILD_A, day: 'monday', ingredients: ['hummus'] }),
    ];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepoWithPrevious(previousTileSummaries);
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID, {
      userInitiated: true,
    });

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.scaffolding_diff).toBeNull();
  });

  it('scaffolding_diff stays null when no previous brief_state exists', async () => {
    const plan = buildPlan();
    const items = [buildPlanItem({ ingredients: ['hummus'] })];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepoWithPrevious(null);
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.scaffolding_diff).toBeNull();
  });

  it('scaffolding_diff non-null when system-initiated and ingredients differ', async () => {
    const plan = buildPlan();
    const previousTileSummaries = [
      {
        day: 'monday',
        items: [{ child_id: CHILD_A, slot: 'main', ingredients: ['rice'] }],
      },
    ];
    const items = [
      buildPlanItem({ id: 'item-1', child_id: CHILD_A, day: 'monday', ingredients: ['hummus'] }),
    ];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepoWithPrevious(previousTileSummaries);
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    // No opts → userInitiated defaults to false → diff is computed.
    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.scaffolding_diff).not.toBeNull();
    expect(upsertArg.scaffolding_diff.summary).toMatch(/Monday/);
  });

  it('scaffolding_diff null when system-initiated and ingredients are unchanged', async () => {
    const plan = buildPlan();
    const previousTileSummaries = [
      {
        day: 'monday',
        items: [{ child_id: CHILD_A, slot: 'main', ingredients: ['rice', 'lentils'] }],
      },
    ];
    const items = [
      buildPlanItem({ id: 'item-1', child_id: CHILD_A, day: 'monday', ingredients: ['rice', 'lentils'] }),
    ];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepoWithPrevious(previousTileSummaries);
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.scaffolding_diff).toBeNull();
  });
});

// Slice 4-S4 — per-child ratings overlay
describe('BriefStateComposer.refresh — Story 4-S4 (child_ratings)', () => {
  function buildLunchLinkSessionRepo(opts: {
    suppressionByDate?: Map<string, string[]>;
    ratingsByDate?: Map<string, Map<string, 'loved' | 'ok' | 'not-really'>>;
    findRatingsThrows?: Error;
  }): LunchLinkSessionRepository & {
    findSuppressedChildrenInRange: ReturnType<typeof vi.fn>;
    findRatingsInRange: ReturnType<typeof vi.fn>;
  } {
    return {
      findSuppressedChildrenInRange: vi
        .fn()
        .mockResolvedValue(opts.suppressionByDate ?? new Map()),
      findRatingsInRange: vi.fn(async () => {
        if (opts.findRatingsThrows) throw opts.findRatingsThrows;
        return opts.ratingsByDate ?? new Map();
      }),
    } as unknown as LunchLinkSessionRepository & {
      findSuppressedChildrenInRange: ReturnType<typeof vi.fn>;
      findRatingsInRange: ReturnType<typeof vi.fn>;
    };
  }

  it('populates child_ratings on a tile when findRatingsInRange returns a rating', async () => {
    // 2026-05-04 is a Monday.
    const plan = buildPlan({ week_of: '2026-05-04' });
    const items = [buildPlanItem({ id: 'mon-a', child_id: CHILD_A, day: 'monday' })];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepo();
    const lunchLinkRepo = buildLunchLinkSessionRepo({
      ratingsByDate: new Map([['2026-05-04', new Map([[CHILD_A, 'loved']])]]),
    });
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      lunchLinkSessionRepository: lunchLinkRepo,
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    expect(lunchLinkRepo.findRatingsInRange).toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      '2026-05-04',
      '2026-05-09',
    );
    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.plan_tile_summaries[0]).toMatchObject({
      day: 'monday',
      child_ratings: { [CHILD_A]: 'loved' },
    });
  });

  it('leaves child_ratings as {} when no ratings exist for the week', async () => {
    const plan = buildPlan({ week_of: '2026-05-04' });
    const items = [buildPlanItem({ id: 'mon-a', child_id: CHILD_A, day: 'monday' })];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepo();
    const lunchLinkRepo = buildLunchLinkSessionRepo({});
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      lunchLinkSessionRepository: lunchLinkRepo,
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.plan_tile_summaries[0].child_ratings).toEqual({});
  });

  it('emits {} for child_ratings when the lunchLinkSessionRepository is not wired', async () => {
    const plan = buildPlan({ week_of: '2026-05-04' });
    const items = [buildPlanItem({ id: 'mon-a', child_id: CHILD_A, day: 'monday' })];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepo();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.plan_tile_summaries[0].child_ratings).toEqual({});
  });

  it('calls findRatingsInRange in parallel with findSuppressedChildrenInRange', async () => {
    const plan = buildPlan({ week_of: '2026-05-04' });
    const items = [buildPlanItem({ id: 'mon-a', child_id: CHILD_A, day: 'monday' })];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepo();
    const lunchLinkRepo = buildLunchLinkSessionRepo({});
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      lunchLinkSessionRepository: lunchLinkRepo,
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    expect(lunchLinkRepo.findSuppressedChildrenInRange).toHaveBeenCalledTimes(1);
    expect(lunchLinkRepo.findRatingsInRange).toHaveBeenCalledTimes(1);
  });

  it('does NOT throw when findRatingsInRange fails — audits brief.projection.failure', async () => {
    const plan = buildPlan({ week_of: '2026-05-04' });
    const items = [buildPlanItem({ id: 'mon-a', child_id: CHILD_A, day: 'monday' })];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepo();
    const audit = buildAudit();
    const lunchLinkRepo = buildLunchLinkSessionRepo({
      findRatingsThrows: new Error('ratings query failed'),
    });
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      childrenRepository: buildChildrenRepo(),
      lunchLinkSessionRepository: lunchLinkRepo,
      auditService: audit,
      logger: buildLogger(),
    });

    await expect(
      composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID),
    ).resolves.toBeUndefined();
    expect(briefRepo.upsert).not.toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledTimes(1);
    expect(audit.write.mock.calls[0]?.[0]).toMatchObject({
      event_type: 'brief.projection.failure',
      metadata: expect.objectContaining({ error: 'ratings query failed' }),
    });
  });
});

import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { BriefStateComposer } from './brief-state.composer.js';
import type { PlansRepository } from './plans.repository.js';
import type { BriefStateRepository } from './brief-state.repository.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { PlanItemRow, PlanRow } from '@hivekitchen/types';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
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

function buildPlanRow(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: PLAN_ID,
    household_id: HOUSEHOLD_ID,
    week_id: WEEK_ID,
    revision: 1,
    generated_at: '2026-05-02T11:00:00.000Z',
    guardrail_cleared_at: '2026-05-02T11:00:01.000Z',
    guardrail_version: '1.1.0',
    prompt_version: 'v1.0.0',
    created_at: '2026-05-02T11:00:00.000Z',
    updated_at: '2026-05-02T11:00:01.000Z',
    ...overrides,
  };
}

function makeItem(overrides: Partial<PlanItemRow> = {}): PlanItemRow {
  return {
    id: '99999999-9999-4999-8999-999999999990',
    plan_id: PLAN_ID,
    child_id: CHILD_A,
    day: 'monday',
    slot: 'main',
    recipe_id: null,
    item_id: null,
    ingredients: ['rice', 'lentils'],
    created_at: '2026-05-02T11:00:00.000Z',
    updated_at: '2026-05-02T11:00:00.000Z',
    ...overrides,
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

describe('BriefStateComposer.refresh', () => {
  it('reads cleared plan, builds tile summaries, and calls upsert with the plan revision', async () => {
    const plan = buildPlanRow({ revision: 3 });
    const items = [
      makeItem({ id: 'a', child_id: CHILD_A, day: 'monday', slot: 'main', ingredients: ['rice'] }),
      makeItem({ id: 'b', child_id: CHILD_B, day: 'monday', slot: 'main', ingredients: ['quinoa'] }),
    ];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepo();
    const audit = buildAudit();
    const logger = buildLogger();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
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
      moment_headline: '',
      lumi_note: '',
      memory_prose: '',
      plan_revision: 3,
    });
    expect(upsertArg.plan_tile_summaries).toEqual([
      {
        day: 'monday',
        items: [
          { child_id: CHILD_A, slot: 'main', ingredients: ['rice'] },
          { child_id: CHILD_B, slot: 'main', ingredients: ['quinoa'] },
        ],
      },
    ]);
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('returns early without writing the projection when no cleared plan exists', async () => {
    const plansRepo = buildPlansRepo({ currentPlan: null });
    const briefRepo = buildBriefStateRepo();
    const audit = buildAudit();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      auditService: audit,
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    expect(plansRepo.findItemsByPlanId).not.toHaveBeenCalled();
    expect(briefRepo.upsert).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('does NOT throw when findItemsByPlanId fails — logs error, audits brief.projection.failure', async () => {
    const plan = buildPlanRow();
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
    const plan = buildPlanRow();
    const plansRepo = buildPlansRepo({ currentPlan: plan, items: [makeItem()] });
    const briefRepo = buildBriefStateRepo({ upsertThrows: new Error('upsert failed') });
    const audit = buildAudit();
    const logger = buildLogger();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
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
    const plan = buildPlanRow();
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
    const plan = buildPlanRow();
    const items = [
      makeItem({ id: 'sat', day: 'saturday' }),
      makeItem({ id: 'fri', day: 'friday', child_id: CHILD_B, ingredients: ['pasta'] }),
      makeItem({ id: 'tue', day: 'tuesday', child_id: CHILD_A, ingredients: ['oats'] }),
      makeItem({ id: 'tue2', day: 'tuesday', child_id: CHILD_B, ingredients: ['oats'] }),
      makeItem({
        id: 'mon',
        day: 'monday',
        recipe_id: '00000000-0000-4000-8000-000000000020',
        item_id: '00000000-0000-4000-8000-000000000021',
      }),
      makeItem({ id: 'sun', day: 'sunday' }),
    ];
    const plansRepo = buildPlansRepo({ currentPlan: plan, items });
    const briefRepo = buildBriefStateRepo();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
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
    const plan = buildPlanRow();
    const plansRepo = buildPlansRepo({ currentPlan: plan, items: [] });
    const briefRepo = buildBriefStateRepo();
    const composer = new BriefStateComposer({
      plansRepository: plansRepo,
      briefStateRepository: briefRepo,
      auditService: buildAudit(),
      logger: buildLogger(),
    });

    await composer.refresh(HOUSEHOLD_ID, WEEK_ID, REQUEST_ID);

    const upsertArg = briefRepo.upsert.mock.calls[0]?.[0];
    expect(upsertArg.plan_tile_summaries).toEqual([]);
    expect(briefRepo.upsert).toHaveBeenCalledTimes(1);
  });
});

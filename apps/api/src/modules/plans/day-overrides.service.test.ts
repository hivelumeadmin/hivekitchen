import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { Queue } from 'bullmq';
import type { AuditService } from '../../audit/audit.service.js';
import type { PlansRepository } from './plans.repository.js';
import type { BriefStateComposer } from './brief-state.composer.js';
import type { DayOverridesRepository } from './day-overrides.repository.js';
import type { DayOverride, PlanItemRow, PlanRow, SetDayOverrideInput } from '@hivekitchen/types';
import { NotFoundError } from '../../common/errors.js';
import { DayOverridesService } from './day-overrides.service.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const CHILD_ID = '44444444-4444-4444-8444-444444444444';
const OVERRIDE_ID = '55555555-5555-4555-8555-555555555555';
const REQUEST_ID = '66666666-6666-4666-8666-666666666666';

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
    child: vi.fn().mockReturnThis(), level: 'info', silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

interface Mocks {
  repo: DayOverridesRepository & {
    upsert: ReturnType<typeof vi.fn>;
    revert: ReturnType<typeof vi.fn>;
  };
  plansRepo: PlansRepository & {
    findByIdForPresentation: ReturnType<typeof vi.fn>;
    findItemById: ReturnType<typeof vi.fn>;
    pauseItemById: ReturnType<typeof vi.fn>;
  };
  briefStateComposer: BriefStateComposer & { refreshTree: ReturnType<typeof vi.fn> };
  regenQueue: Queue & { add: ReturnType<typeof vi.fn> };
  auditService: AuditService & { write: ReturnType<typeof vi.fn> };
}

function buildMocks(): Mocks {
  return {
    repo: {
      upsert: vi.fn(),
      revert: vi.fn(),
    } as unknown as Mocks['repo'],
    plansRepo: {
      findByIdForPresentation: vi.fn(),
      findItemById: vi.fn(),
      pauseItemById: vi.fn(),
    } as unknown as Mocks['plansRepo'],
    briefStateComposer: { refreshTree: vi.fn().mockResolvedValue(undefined) } as unknown as Mocks['briefStateComposer'],
    regenQueue: { add: vi.fn().mockResolvedValue({ id: 'job-1' }) } as unknown as Mocks['regenQueue'],
    auditService: { write: vi.fn().mockResolvedValue(undefined) } as unknown as Mocks['auditService'],
  };
}

function buildService(mocks: Mocks): DayOverridesService {
  return new DayOverridesService({
    repository: mocks.repo,
    plansRepository: mocks.plansRepo,
    briefStateComposer: mocks.briefStateComposer,
    regenQueue: mocks.regenQueue,
    auditService: mocks.auditService,
    logger: buildLogger(),
  });
}

const planRow: PlanRow = {
  id: PLAN_ID,
  household_id: HOUSEHOLD_ID,
  week_id: 'week-2026-19',
  week_of: '2026-05-04',
  revision: 3,
  generated_at: '2026-05-04T12:00:00.000Z',
  guardrail_cleared_at: '2026-05-04T12:00:01.000Z',
  guardrail_version: 'g-1',
  prompt_version: 'p-1',
  created_at: '2026-05-04T12:00:00.000Z',
  updated_at: '2026-05-04T12:00:01.000Z',
};

const planItem: PlanItemRow = {
  id: ITEM_ID,
  plan_id: PLAN_ID,
  child_id: CHILD_ID,
  day: 'wednesday',
  slot: 'main',
  recipe_id: null,
  item_id: null,
  ingredients: ['rice', 'lentils'],
  paused_at: null,
  replaced_by_plan_id: null,
  created_at: '2026-05-04T12:00:00.000Z',
  updated_at: '2026-05-04T12:00:00.000Z',
};

function buildOverride(partial: Partial<DayOverride> = {}): DayOverride {
  return {
    id: OVERRIDE_ID,
    plan_item_id: ITEM_ID,
    child_id: CHILD_ID,
    household_id: HOUSEHOLD_ID,
    override_date: '2026-05-06',
    override_type: 'sport_practice',
    is_lumi_proposed: false,
    confirmed_at: '2026-05-06T08:00:00.000Z',
    reverted_at: null,
    created_at: '2026-05-06T08:00:00.000Z',
    updated_at: '2026-05-06T08:00:00.000Z',
    ...partial,
  };
}

function input(overrideType: SetDayOverrideInput['override_type']): SetDayOverrideInput {
  return {
    override_type: overrideType,
    override_date: '2026-05-06',
    child_id: CHILD_ID,
    is_lumi_proposed: false,
  };
}

describe('DayOverridesService.setOverride', () => {
  let mocks: Mocks;
  let service: DayOverridesService;

  beforeEach(() => {
    mocks = buildMocks();
    service = buildService(mocks);
    mocks.plansRepo.findByIdForPresentation.mockResolvedValue(planRow);
    mocks.plansRepo.findItemById.mockResolvedValue(planItem);
  });

  it('throws NotFoundError when the plan does not belong to the household', async () => {
    mocks.plansRepo.findByIdForPresentation.mockResolvedValueOnce(null);

    await expect(
      service.setOverride({
        planId: PLAN_ID,
        planItemId: ITEM_ID,
        householdId: HOUSEHOLD_ID,
        input: input('sport_practice'),
        requestId: REQUEST_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(mocks.repo.upsert).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the plan item does not belong to the plan', async () => {
    mocks.plansRepo.findItemById.mockResolvedValueOnce(null);

    await expect(
      service.setOverride({
        planId: PLAN_ID,
        planItemId: ITEM_ID,
        householdId: HOUSEHOLD_ID,
        input: input('field_trip'),
        requestId: REQUEST_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('pauses the slot and refreshes the brief for sick_day; does not enqueue regen', async () => {
    mocks.plansRepo.pauseItemById.mockResolvedValueOnce({
      ...planItem,
      paused_at: '2026-05-06T08:00:00.000Z',
    });
    mocks.repo.upsert.mockResolvedValueOnce(buildOverride({ override_type: 'sick_day' }));

    const result = await service.setOverride({
      planId: PLAN_ID,
      planItemId: ITEM_ID,
      householdId: HOUSEHOLD_ID,
      input: input('sick_day'),
      requestId: REQUEST_ID,
    });

    expect(mocks.plansRepo.pauseItemById).toHaveBeenCalledWith({
      itemId: ITEM_ID,
      planId: PLAN_ID,
      pausedAt: expect.any(String),
    });
    expect(mocks.briefStateComposer.refreshTree).toHaveBeenCalledTimes(1);
    expect(mocks.regenQueue.add).not.toHaveBeenCalled();
    expect(result.regenTriggered).toBe(false);
  });

  it('pauses the slot for bag_suspended and skips regen', async () => {
    mocks.plansRepo.pauseItemById.mockResolvedValueOnce({
      ...planItem,
      paused_at: '2026-05-06T08:00:00.000Z',
    });
    mocks.repo.upsert.mockResolvedValueOnce(buildOverride({ override_type: 'bag_suspended' }));

    const result = await service.setOverride({
      planId: PLAN_ID,
      planItemId: ITEM_ID,
      householdId: HOUSEHOLD_ID,
      input: input('bag_suspended'),
      requestId: REQUEST_ID,
    });

    expect(mocks.plansRepo.pauseItemById).toHaveBeenCalled();
    expect(mocks.regenQueue.add).not.toHaveBeenCalled();
    expect(result.regenTriggered).toBe(false);
  });

  it('skips brief refresh when pauseItemById is a no-op (already paused)', async () => {
    mocks.plansRepo.pauseItemById.mockResolvedValueOnce(null);
    mocks.repo.upsert.mockResolvedValueOnce(buildOverride({ override_type: 'sick_day' }));

    await service.setOverride({
      planId: PLAN_ID,
      planItemId: ITEM_ID,
      householdId: HOUSEHOLD_ID,
      input: input('sick_day'),
      requestId: REQUEST_ID,
    });

    expect(mocks.briefStateComposer.refreshTree).not.toHaveBeenCalled();
  });

  it('enqueues a day-scope regen for composition-changing overrides (sport_practice)', async () => {
    mocks.repo.upsert.mockResolvedValueOnce(buildOverride({ override_type: 'sport_practice' }));

    const result = await service.setOverride({
      planId: PLAN_ID,
      planItemId: ITEM_ID,
      householdId: HOUSEHOLD_ID,
      input: input('sport_practice'),
      requestId: REQUEST_ID,
    });

    expect(mocks.plansRepo.pauseItemById).not.toHaveBeenCalled();
    expect(mocks.regenQueue.add).toHaveBeenCalledTimes(1);
    const [jobName, jobData, jobOpts] = mocks.regenQueue.add.mock.calls[0]!;
    expect(jobName).toBe('regen-day-override');
    expect(jobData).toMatchObject({
      plan_id: PLAN_ID,
      household_id: HOUSEHOLD_ID,
      week_of: planRow.week_of,
      current_revision: planRow.revision,
      scope: 'day',
      day: planItem.day,
      request_id: REQUEST_ID,
    });
    expect(jobOpts).toMatchObject({
      jobId: `day-override-${ITEM_ID}-2026-05-06`,
    });
    expect(result.regenTriggered).toBe(true);
  });

  it('writes a plan.day_override_set audit event', async () => {
    mocks.repo.upsert.mockResolvedValueOnce(buildOverride({ override_type: 'field_trip' }));

    await service.setOverride({
      planId: PLAN_ID,
      planItemId: ITEM_ID,
      householdId: HOUSEHOLD_ID,
      input: input('field_trip'),
      requestId: REQUEST_ID,
    });

    expect(mocks.auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'plan.day_override_set',
        household_id: HOUSEHOLD_ID,
        request_id: REQUEST_ID,
        metadata: expect.objectContaining({
          plan_id: PLAN_ID,
          plan_item_id: ITEM_ID,
          override_type: 'field_trip',
          override_date: '2026-05-06',
        }),
      }),
    );
  });

  it('does not throw when audit write fails — fire-and-forget at this boundary', async () => {
    mocks.repo.upsert.mockResolvedValueOnce(buildOverride({ override_type: 'sport_practice' }));
    mocks.auditService.write.mockRejectedValueOnce(new Error('audit-down'));

    const result = await service.setOverride({
      planId: PLAN_ID,
      planItemId: ITEM_ID,
      householdId: HOUSEHOLD_ID,
      input: input('sport_practice'),
      requestId: REQUEST_ID,
    });

    expect(result.regenTriggered).toBe(true);
  });
});

describe('DayOverridesService.revertOverride', () => {
  let mocks: Mocks;
  let service: DayOverridesService;

  beforeEach(() => {
    mocks = buildMocks();
    service = buildService(mocks);
    mocks.plansRepo.findByIdForPresentation.mockResolvedValue(planRow);
  });

  it('throws NotFoundError when the override does not belong to the household', async () => {
    mocks.repo.revert.mockResolvedValueOnce(null);

    await expect(
      service.revertOverride({
        planId: PLAN_ID,
        planItemId: ITEM_ID,
        overrideId: OVERRIDE_ID,
        householdId: HOUSEHOLD_ID,
        requestId: REQUEST_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('writes a plan.day_override_reverted audit on success', async () => {
    mocks.repo.revert.mockResolvedValueOnce(
      buildOverride({ reverted_at: '2026-05-06T20:00:00.000Z' }),
    );

    await service.revertOverride({
      planId: PLAN_ID,
      planItemId: ITEM_ID,
      overrideId: OVERRIDE_ID,
      householdId: HOUSEHOLD_ID,
      requestId: REQUEST_ID,
    });

    expect(mocks.auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'plan.day_override_reverted',
        metadata: expect.objectContaining({
          override_id: OVERRIDE_ID,
        }),
      }),
    );
  });
});

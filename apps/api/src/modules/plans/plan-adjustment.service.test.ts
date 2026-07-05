import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { Queue } from 'bullmq';
import type { AuditService } from '../../audit/audit.service.js';
import type { PlansRepository } from './plans.repository.js';
import { PlanAdjustmentService } from './plan-adjustment.service.js';
import type { PlanAdjustmentTrigger } from './plan-adjustment.types.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_A = '33333333-3333-4333-8333-333333333333';
const PLAN_B = '44444444-4444-4444-8444-444444444444';

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
    child: vi.fn().mockReturnThis(), level: 'info', silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

interface Mocks {
  plansRepo: PlansRepository & { findActiveFuturePlanIds: ReturnType<typeof vi.fn> };
  regenQueue: Queue & { add: ReturnType<typeof vi.fn> };
  auditService: AuditService & { write: ReturnType<typeof vi.fn> };
}

function buildMocks(): Mocks {
  return {
    plansRepo: {
      findActiveFuturePlanIds: vi.fn(),
    } as unknown as Mocks['plansRepo'],
    regenQueue: { add: vi.fn().mockResolvedValue({ id: 'job' }) } as unknown as Mocks['regenQueue'],
    auditService: { write: vi.fn().mockResolvedValue(undefined) } as unknown as Mocks['auditService'],
  };
}

function buildService(mocks: Mocks): PlanAdjustmentService {
  return new PlanAdjustmentService({
    plansRepository: mocks.plansRepo,
    regenQueue: mocks.regenQueue,
    auditService: mocks.auditService,
    logger: buildLogger(),
  });
}

const baseTrigger: PlanAdjustmentTrigger = {
  type: 'school_policy_changed',
  householdId: HOUSEHOLD_ID,
  slotScope: 'bag_wide',
  dayScope: null,
  requestId: REQUEST_ID,
  metadata: { policy_id: 'p-1' },
};

describe('PlanAdjustmentService.triggerAdjustment', () => {
  let mocks: Mocks;
  let service: PlanAdjustmentService;

  beforeEach(() => {
    mocks = buildMocks();
    service = buildService(mocks);
  });

  it('returns zero queued and skips audit when no future plans exist', async () => {
    mocks.plansRepo.findActiveFuturePlanIds.mockResolvedValueOnce([]);

    const result = await service.triggerAdjustment(baseTrigger);

    expect(result).toEqual({ plansQueued: 0, enqueuedPlanIds: [], failedPlanIds: [] });
    expect(mocks.regenQueue.add).not.toHaveBeenCalled();
    expect(mocks.auditService.write).not.toHaveBeenCalled();
  });

  it('enqueues one week-scope job per future plan and audits the fanout', async () => {
    mocks.plansRepo.findActiveFuturePlanIds.mockResolvedValueOnce([
      { id: PLAN_A, week_of: '2026-05-04', revision: 2 },
      { id: PLAN_B, week_of: '2026-05-11', revision: 1 },
    ]);

    const result = await service.triggerAdjustment(baseTrigger);

    expect(result.plansQueued).toBe(2);
    expect(result.enqueuedPlanIds).toEqual([PLAN_A, PLAN_B]);
    expect(result.failedPlanIds).toEqual([]);
    expect(mocks.regenQueue.add).toHaveBeenCalledTimes(2);

    const [jobName, jobData, jobOpts] = mocks.regenQueue.add.mock.calls[0]!;
    expect(jobName).toBe('regen-school_policy_changed');
    expect(jobData).toMatchObject({
      plan_id: PLAN_A,
      household_id: HOUSEHOLD_ID,
      week_of: '2026-05-04',
      current_revision: 2,
      scope: 'week',
      request_id: REQUEST_ID,
    });
    expect(jobData).not.toHaveProperty('day');
    expect(jobData).not.toHaveProperty('week_id');
    // jobId dedupes on (type, household, week, dayScope) — request_id excluded
    // so retries collapse to one job.
    expect(jobOpts).toMatchObject({
      jobId: `adjust-school_policy_changed-${HOUSEHOLD_ID}-2026-05-04-week`,
    });

    expect(mocks.auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'plan.adjustment_triggered',
        household_id: HOUSEHOLD_ID,
        request_id: REQUEST_ID,
        metadata: expect.objectContaining({
          trigger_type: 'school_policy_changed',
          slot_scope: 'bag_wide',
          day_scope: null,
          enqueued_plan_ids: [PLAN_A, PLAN_B],
          failed_plan_ids: [],
          policy_id: 'p-1',
        }),
      }),
    );
  });

  it('records dayScope as scope=day with day field and includes it in the dedupe key', async () => {
    mocks.plansRepo.findActiveFuturePlanIds.mockResolvedValueOnce([
      { id: PLAN_A, week_of: '2026-05-04', revision: 1 },
    ]);

    await service.triggerAdjustment({
      ...baseTrigger,
      type: 'cultural_calendar_event',
      slotScope: null,
      dayScope: 'wednesday',
    });

    const [jobName, jobData, jobOpts] = mocks.regenQueue.add.mock.calls[0]!;
    expect(jobName).toBe('regen-cultural_calendar_event');
    expect(jobData).toMatchObject({
      scope: 'day',
      day: 'wednesday',
    });
    expect(jobOpts).toMatchObject({
      jobId: `adjust-cultural_calendar_event-${HOUSEHOLD_ID}-2026-05-04-wednesday`,
    });
  });

  it('continues when one queue.add fails — partial success is reported', async () => {
    mocks.plansRepo.findActiveFuturePlanIds.mockResolvedValueOnce([
      { id: PLAN_A, week_of: '2026-05-04', revision: 1 },
      { id: PLAN_B, week_of: '2026-05-11', revision: 1 },
    ]);
    mocks.regenQueue.add
      .mockRejectedValueOnce(new Error('redis-flake'))
      .mockResolvedValueOnce({ id: 'job-b' });

    const result = await service.triggerAdjustment(baseTrigger);

    expect(result.plansQueued).toBe(1);
    expect(result.enqueuedPlanIds).toEqual([PLAN_B]);
    expect(result.failedPlanIds).toEqual([PLAN_A]);

    expect(mocks.auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          enqueued_plan_ids: [PLAN_B],
          failed_plan_ids: [PLAN_A],
        }),
      }),
    );
  });

  it('returns zero queued and audits full failedPlanIds when all enqueues fail', async () => {
    mocks.plansRepo.findActiveFuturePlanIds.mockResolvedValueOnce([
      { id: PLAN_A, week_of: '2026-05-04', revision: 1 },
      { id: PLAN_B, week_of: '2026-05-11', revision: 1 },
    ]);
    mocks.regenQueue.add
      .mockRejectedValueOnce(new Error('redis-down'))
      .mockRejectedValueOnce(new Error('redis-down'));

    const result = await service.triggerAdjustment(baseTrigger);

    expect(result.plansQueued).toBe(0);
    expect(result.enqueuedPlanIds).toEqual([]);
    expect(result.failedPlanIds).toEqual([PLAN_A, PLAN_B]);

    // Audit is still written — this distinguishes the all-failed case from the
    // "no future plans" early-return branch which skips audit entirely.
    expect(mocks.auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'plan.adjustment_triggered',
        metadata: expect.objectContaining({
          enqueued_plan_ids: [],
          failed_plan_ids: [PLAN_A, PLAN_B],
        }),
      }),
    );
  });

  it('logs and rethrows when findActiveFuturePlanIds rejects; nothing enqueued or audited', async () => {
    mocks.plansRepo.findActiveFuturePlanIds.mockRejectedValueOnce(new Error('db-down'));

    await expect(service.triggerAdjustment(baseTrigger)).rejects.toThrow('db-down');

    expect(mocks.regenQueue.add).not.toHaveBeenCalled();
    expect(mocks.auditService.write).not.toHaveBeenCalled();
  });

  // Story 3.23 — slot_scope propagation into PlanRegenerationJobData.
  it('slotScope=snack enqueues job with slot_scope=snack', async () => {
    mocks.plansRepo.findActiveFuturePlanIds.mockResolvedValueOnce([
      { id: PLAN_A, week_of: '2026-05-04', revision: 1 },
    ]);

    await service.triggerAdjustment({ ...baseTrigger, slotScope: 'snack' });

    const [, jobData] = mocks.regenQueue.add.mock.calls[0]!;
    expect(jobData).toMatchObject({ slot_scope: 'snack' });
  });

  it('slotScope=bag_wide enqueues job without slot_scope field', async () => {
    mocks.plansRepo.findActiveFuturePlanIds.mockResolvedValueOnce([
      { id: PLAN_A, week_of: '2026-05-04', revision: 1 },
    ]);

    await service.triggerAdjustment({ ...baseTrigger, slotScope: 'bag_wide' });

    const [, jobData] = mocks.regenQueue.add.mock.calls[0]!;
    expect(jobData).not.toHaveProperty('slot_scope');
  });

  it('slotScope=null enqueues job without slot_scope field', async () => {
    mocks.plansRepo.findActiveFuturePlanIds.mockResolvedValueOnce([
      { id: PLAN_A, week_of: '2026-05-04', revision: 1 },
    ]);

    await service.triggerAdjustment({ ...baseTrigger, slotScope: null });

    const [, jobData] = mocks.regenQueue.add.mock.calls[0]!;
    expect(jobData).not.toHaveProperty('slot_scope');
  });

  it('does NOT throw when audit write fails — fire-and-forget at this boundary', async () => {
    mocks.plansRepo.findActiveFuturePlanIds.mockResolvedValueOnce([
      { id: PLAN_A, week_of: '2026-05-04', revision: 1 },
    ]);
    mocks.auditService.write.mockRejectedValueOnce(new Error('audit-down'));

    const result = await service.triggerAdjustment(baseTrigger);

    expect(result.plansQueued).toBe(1);
  });
});

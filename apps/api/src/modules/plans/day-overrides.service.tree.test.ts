import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { Queue } from 'bullmq';
import { DayOverridesService } from './day-overrides.service.js';
import type { DayOverridesRepository } from './day-overrides.repository.js';
import type { PlansRepository } from './plans.repository.js';
import type { BriefStateComposer } from './brief-state.composer.js';
import type { AuditService } from '../../audit/audit.service.js';
import type {
  PlanDayRow,
  PlanRow,
  PlanSlotRow,
  SetDayOverrideInput,
} from '@hivekitchen/types';
import { ConflictError, NotFoundError } from '../../common/errors.js';

// Story 3-DM-C1 Phase 6 — setOverrideTree + revertOverrideTree smoke tests.

const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_SLOT_ID = '33333333-3333-4333-8333-333333333333';
const PLAN_DAY_ID = '44444444-4444-4444-8444-444444444444';
const CHILD_A = '55555555-5555-4555-8555-555555555555';
const OVERRIDE_ID = '66666666-6666-4666-8666-666666666666';
const REQ = '77777777-7777-4777-8777-777777777777';

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
    child: vi.fn().mockReturnThis(), level: 'info', silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function buildPlan(): PlanRow {
  return {
    id: PLAN_ID,
    household_id: HOUSEHOLD,
    week_of: '2026-06-01',
    revision: 1,
    generated_at: '2026-05-30T10:00:00.000Z',
    guardrail_cleared_at: '2026-05-30T10:00:01.000Z',
    guardrail_version: '1.1.0',
    prompt_version: 'v1.5.0',
    state: null,
    state_set_at: null,
    state_message: null,
    created_at: '2026-05-30T10:00:00.000Z',
    updated_at: '2026-05-30T10:00:01.000Z',
  };
}

function buildDayRow(): PlanDayRow {
  return {
    id: PLAN_DAY_ID,
    plan_id: PLAN_ID,
    day: 'wednesday',
    paused_at: null,
    paused_reason: null,
    paused_note: null,
    created_at: '2026-05-30T10:00:00.000Z',
    updated_at: '2026-05-30T10:00:00.000Z',
  };
}

function buildSlotRow(): PlanSlotRow {
  return {
    id: PLAN_SLOT_ID,
    plan_day_id: PLAN_DAY_ID,
    slot_kind: 'main',
    main_assignment_id: '88888888-8888-4888-8888-888888888888',
    recipe_id: null,
    extra_kind: null,
    paused_at: null,
    created_at: '2026-05-30T10:00:00.000Z',
    updated_at: '2026-05-30T10:00:00.000Z',
  };
}

function buildService(opts: {
  plan?: PlanRow | null;
  days?: PlanDayRow[];
  slots?: PlanSlotRow[];
  override?: { id: string; override_type: string; override_date: string } | null;
  existing?: { id: string; override_type: string; override_date: string } | null;
} = {}) {
  const findByIdForOps = vi.fn().mockResolvedValue(opts.plan ?? buildPlan());
  const findDaysByPlanId = vi.fn().mockResolvedValue(opts.days ?? [buildDayRow()]);
  const findSlotsByPlanId = vi.fn().mockResolvedValue(opts.slots ?? [buildSlotRow()]);
  const upsertTree = vi.fn().mockResolvedValue(
    opts.override ?? { id: OVERRIDE_ID, override_type: 'field_trip', override_date: '2026-06-03' },
  );
  const revertTree = vi.fn().mockResolvedValue(
    opts.existing ?? { id: OVERRIDE_ID, override_type: 'field_trip', override_date: '2026-06-03' },
  );
  const findActiveByIdTree = vi.fn().mockResolvedValue(opts.existing ?? { id: OVERRIDE_ID });
  const write = vi.fn().mockResolvedValue(undefined);
  const queueAdd = vi.fn().mockResolvedValue(undefined);

  const repo = { upsertTree, revertTree, findActiveByIdTree } as unknown as DayOverridesRepository;
  const plansRepo = { findByIdForOps, findDaysByPlanId, findSlotsByPlanId } as unknown as PlansRepository;
  const composer = { refresh: vi.fn() } as unknown as BriefStateComposer;
  const queue = { add: queueAdd } as unknown as Queue;
  const audit = { write } as unknown as AuditService;

  return {
    service: new DayOverridesService({
      repository: repo,
      plansRepository: plansRepo,
      briefStateComposer: composer,
      regenQueue: queue,
      auditService: audit,
      logger: buildLogger(),
    }),
    mocks: {
      findByIdForOps,
      findDaysByPlanId,
      findSlotsByPlanId,
      upsertTree,
      revertTree,
      findActiveByIdTree,
      write,
      queueAdd,
    },
  };
}

function input(overrides: Partial<SetDayOverrideInput> = {}): SetDayOverrideInput {
  return {
    child_id: CHILD_A,
    override_date: '2026-06-03',
    override_type: 'field_trip',
    is_lumi_proposed: false,
    ...overrides,
  };
}

describe('DayOverridesService.setOverrideTree', () => {
  it('rejects bag_suspended (retired by canonical model)', async () => {
    const { service } = buildService();
    await expect(
      service.setOverrideTree({
        planId: PLAN_ID,
        planSlotId: PLAN_SLOT_ID,
        householdId: HOUSEHOLD,
        input: input({ override_type: 'bag_suspended' }),
        requestId: REQ,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects sick_day (retired by canonical model)', async () => {
    const { service } = buildService();
    await expect(
      service.setOverrideTree({
        planId: PLAN_ID,
        planSlotId: PLAN_SLOT_ID,
        householdId: HOUSEHOLD,
        input: input({ override_type: 'sick_day' }),
        requestId: REQ,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('writes upsertTree with plan_slot_id for a composition-changing override', async () => {
    const { service, mocks } = buildService();
    const result = await service.setOverrideTree({
      planId: PLAN_ID,
      planSlotId: PLAN_SLOT_ID,
      householdId: HOUSEHOLD,
      input: input({ override_type: 'field_trip' }),
      requestId: REQ,
    });
    expect(mocks.upsertTree).toHaveBeenCalledWith(
      expect.objectContaining({
        planSlotId: PLAN_SLOT_ID,
        childId: CHILD_A,
        householdId: HOUSEHOLD,
        overrideType: 'field_trip',
      }),
    );
    expect(result.override.id).toBe(OVERRIDE_ID);
  });

  it('enqueues a day-scope regen for a composition-changing override', async () => {
    const { service, mocks } = buildService();
    const result = await service.setOverrideTree({
      planId: PLAN_ID,
      planSlotId: PLAN_SLOT_ID,
      householdId: HOUSEHOLD,
      input: input({ override_type: 'field_trip' }),
      requestId: REQ,
    });
    expect(mocks.queueAdd).toHaveBeenCalledTimes(1);
    const [name, jobData, jobOpts] = mocks.queueAdd.mock.calls[0]!;
    expect(name).toBe('regen-day-override');
    expect(jobData).toMatchObject({
      plan_id: PLAN_ID,
      day: 'wednesday',
      scope: 'day',
    });
    expect((jobOpts as { jobId?: string }).jobId).toContain(PLAN_SLOT_ID);
    expect(result.regenTriggered).toBe(true);
  });

  it('writes audit metadata with plan_slot_id', async () => {
    const { service, mocks } = buildService();
    await service.setOverrideTree({
      planId: PLAN_ID,
      planSlotId: PLAN_SLOT_ID,
      householdId: HOUSEHOLD,
      input: input(),
      requestId: REQ,
    });
    expect(mocks.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'plan.day_override_set',
        metadata: expect.objectContaining({
          plan_slot_id: PLAN_SLOT_ID,
          override_type: 'field_trip',
        }),
      }),
    );
  });
});

describe('DayOverridesService.revertOverrideTree', () => {
  it('throws NotFoundError when the override does not exist', async () => {
    const { service, mocks } = buildService();
    mocks.findActiveByIdTree.mockResolvedValueOnce(null);
    await expect(
      service.revertOverrideTree({
        planId: PLAN_ID,
        planSlotId: PLAN_SLOT_ID,
        overrideId: OVERRIDE_ID,
        householdId: HOUSEHOLD,
        requestId: REQ,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('calls revertTree and writes the reverted audit event', async () => {
    const { service, mocks } = buildService();
    await service.revertOverrideTree({
      planId: PLAN_ID,
      planSlotId: PLAN_SLOT_ID,
      overrideId: OVERRIDE_ID,
      householdId: HOUSEHOLD,
      requestId: REQ,
    });
    expect(mocks.revertTree).toHaveBeenCalledWith(OVERRIDE_ID, HOUSEHOLD, PLAN_SLOT_ID);
    expect(mocks.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'plan.day_override_reverted',
        metadata: expect.objectContaining({ plan_slot_id: PLAN_SLOT_ID }),
      }),
    );
  });
});

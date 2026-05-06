import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { Queue } from 'bullmq';
import type { SchoolPolicy, UpdateSchoolPolicyInput } from '@hivekitchen/types';
import type { AuditService } from '../../audit/audit.service.js';
import type { ChildrenRepository, DecryptedChildRow } from './children.repository.js';
import type { PlansRepository } from '../plans/plans.repository.js';
import type { SchoolPoliciesRepository } from './school-policies.repository.js';
import { ForbiddenError } from '../../common/errors.js';
import { SchoolPoliciesService } from './school-policies.service.js';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
const CHILD_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const POLICY_ID = '44444444-4444-4444-8444-444444444444';
const PLAN_A = '55555555-5555-4555-8555-555555555555';
const PLAN_B = '66666666-6666-4666-8666-666666666666';

function buildLogger(): FastifyBaseLogger {
  const noop = vi.fn();
  return {
    info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
    child: vi.fn().mockReturnThis(), level: 'info', silent: vi.fn(),
  } as unknown as FastifyBaseLogger;
}

function buildChild(): DecryptedChildRow {
  return {
    id: CHILD_ID,
    household_id: HOUSEHOLD_ID,
    name: 'Asha',
    age_band: 'child',
    school_policy_notes: null,
    declared_allergens: [],
    cultural_identifiers: [],
    dietary_preferences: [],
    allergen_rule_version: 'v1',
    bag_composition: { main: true, snack: true, extra: true },
    created_at: '2026-04-28T10:00:00.000Z',
  };
}

function buildPolicy(overrides: Partial<SchoolPolicy> = {}): SchoolPolicy {
  return {
    id: POLICY_ID,
    child_id: CHILD_ID,
    policy_type: 'nut_free',
    policy_description: null,
    slot_scope: 'bag_wide',
    is_active: true,
    created_at: '2026-05-05T11:00:00.000Z',
    updated_at: '2026-05-05T11:00:00.000Z',
    ...overrides,
  };
}

interface Mocks {
  childrenRepo: ChildrenRepository & { findById: ReturnType<typeof vi.fn> };
  policiesRepo: SchoolPoliciesRepository & {
    upsertPolicy: ReturnType<typeof vi.fn>;
    findActiveByChildId: ReturnType<typeof vi.fn>;
  };
  plansRepo: PlansRepository & { findActiveFuturePlanIds: ReturnType<typeof vi.fn> };
  regenQueue: Queue & { add: ReturnType<typeof vi.fn> };
  auditService: AuditService & { write: ReturnType<typeof vi.fn> };
}

function buildMocks(): Mocks {
  return {
    childrenRepo: { findById: vi.fn() } as unknown as Mocks['childrenRepo'],
    policiesRepo: {
      upsertPolicy: vi.fn(),
      findActiveByChildId: vi.fn(),
    } as unknown as Mocks['policiesRepo'],
    plansRepo: {
      findActiveFuturePlanIds: vi.fn(),
    } as unknown as Mocks['plansRepo'],
    regenQueue: { add: vi.fn().mockResolvedValue({ id: 'job' }) } as unknown as Mocks['regenQueue'],
    auditService: { write: vi.fn().mockResolvedValue(undefined) } as unknown as Mocks['auditService'],
  };
}

function buildService(mocks: Mocks): SchoolPoliciesService {
  return new SchoolPoliciesService({
    repository: mocks.policiesRepo,
    childrenRepository: mocks.childrenRepo,
    plansRepository: mocks.plansRepo,
    regenQueue: mocks.regenQueue,
    auditService: mocks.auditService,
    logger: buildLogger(),
  });
}

const VALID_INPUT: UpdateSchoolPolicyInput = {
  policy_type: 'nut_free',
  slot_scope: 'bag_wide',
  is_active: true,
};

describe('SchoolPoliciesService.updatePolicy', () => {
  let mocks: Mocks;
  let service: SchoolPoliciesService;

  beforeEach(() => {
    mocks = buildMocks();
    service = buildService(mocks);
  });

  it('throws ForbiddenError when child is not in household (findById null)', async () => {
    mocks.childrenRepo.findById.mockResolvedValueOnce(null);

    await expect(
      service.updatePolicy({
        childId: CHILD_ID,
        householdId: HOUSEHOLD_ID,
        input: VALID_INPUT,
        requestId: REQUEST_ID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(mocks.policiesRepo.upsertPolicy).not.toHaveBeenCalled();
    expect(mocks.regenQueue.add).not.toHaveBeenCalled();
  });

  it('deactivation does NOT enqueue regeneration jobs', async () => {
    mocks.childrenRepo.findById.mockResolvedValueOnce(buildChild());
    mocks.policiesRepo.upsertPolicy.mockResolvedValueOnce(
      buildPolicy({ is_active: false }),
    );

    const result = await service.updatePolicy({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      input: { ...VALID_INPUT, is_active: false },
      requestId: REQUEST_ID,
    });

    expect(result.regenerationTriggered).toBe(false);
    expect(result.affectedPlanIds).toEqual([]);
    expect(mocks.plansRepo.findActiveFuturePlanIds).not.toHaveBeenCalled();
    expect(mocks.regenQueue.add).not.toHaveBeenCalled();

    // The policy update itself is still audited.
    expect(mocks.auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'school_policy.updated' }),
    );
  });

  it('activation with no future plans returns regeneration_triggered=false', async () => {
    mocks.childrenRepo.findById.mockResolvedValueOnce(buildChild());
    mocks.policiesRepo.upsertPolicy.mockResolvedValueOnce(buildPolicy());
    mocks.plansRepo.findActiveFuturePlanIds.mockResolvedValueOnce([]);

    const result = await service.updatePolicy({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      input: VALID_INPUT,
      requestId: REQUEST_ID,
    });

    expect(result.regenerationTriggered).toBe(false);
    expect(result.affectedPlanIds).toEqual([]);
    expect(mocks.regenQueue.add).not.toHaveBeenCalled();
  });

  it('activation with future plans enqueues a week-scope regen per plan and audits the fanout', async () => {
    mocks.childrenRepo.findById.mockResolvedValueOnce(buildChild());
    mocks.policiesRepo.upsertPolicy.mockResolvedValueOnce(buildPolicy());
    mocks.plansRepo.findActiveFuturePlanIds.mockResolvedValueOnce([
      { id: PLAN_A, week_id: 'week-a', week_of: '2026-05-04', revision: 2 },
      { id: PLAN_B, week_id: 'week-b', week_of: '2026-05-11', revision: 1 },
    ]);

    const result = await service.updatePolicy({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      input: VALID_INPUT,
      requestId: REQUEST_ID,
    });

    expect(result.regenerationTriggered).toBe(true);
    expect(result.affectedPlanIds).toEqual([PLAN_A, PLAN_B]);
    expect(mocks.regenQueue.add).toHaveBeenCalledTimes(2);

    // First job carries the right shape: scope=week, current_revision passed through.
    const [, jobData] = mocks.regenQueue.add.mock.calls[0]!;
    expect(jobData).toMatchObject({
      plan_id: PLAN_A,
      household_id: HOUSEHOLD_ID,
      week_of: '2026-05-04',
      week_id: 'week-a',
      current_revision: 2,
      scope: 'week',
      request_id: REQUEST_ID,
    });
    expect(jobData).not.toHaveProperty('day');

    // Two audit writes: one for the policy update, one for the propagation fanout.
    expect(mocks.auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'school_policy.updated' }),
    );
    expect(mocks.auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'plan.policy_regeneration_triggered',
        metadata: expect.objectContaining({
          affected_plan_ids: [PLAN_A, PLAN_B],
        }),
      }),
    );
  });

  it('one failed enqueue does not block the others', async () => {
    mocks.childrenRepo.findById.mockResolvedValueOnce(buildChild());
    mocks.policiesRepo.upsertPolicy.mockResolvedValueOnce(buildPolicy());
    mocks.plansRepo.findActiveFuturePlanIds.mockResolvedValueOnce([
      { id: PLAN_A, week_id: 'week-a', week_of: '2026-05-04', revision: 1 },
      { id: PLAN_B, week_id: 'week-b', week_of: '2026-05-11', revision: 1 },
    ]);
    mocks.regenQueue.add
      .mockRejectedValueOnce(new Error('redis-flake'))
      .mockResolvedValueOnce({ id: 'job-b' });

    const result = await service.updatePolicy({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      input: VALID_INPUT,
      requestId: REQUEST_ID,
    });

    expect(result.regenerationTriggered).toBe(true);
    expect(result.affectedPlanIds).toEqual([PLAN_B]);
  });

  it('does NOT swallow upsert errors — caller sees them', async () => {
    mocks.childrenRepo.findById.mockResolvedValueOnce(buildChild());
    mocks.policiesRepo.upsertPolicy.mockRejectedValueOnce(new Error('db-down'));

    await expect(
      service.updatePolicy({
        childId: CHILD_ID,
        householdId: HOUSEHOLD_ID,
        input: VALID_INPUT,
        requestId: REQUEST_ID,
      }),
    ).rejects.toThrow('db-down');
  });

  it('completes when audit write fails — fire-and-forget at this boundary', async () => {
    mocks.childrenRepo.findById.mockResolvedValueOnce(buildChild());
    mocks.policiesRepo.upsertPolicy.mockResolvedValueOnce(buildPolicy());
    mocks.plansRepo.findActiveFuturePlanIds.mockResolvedValueOnce([]);
    mocks.auditService.write.mockRejectedValueOnce(new Error('audit-down'));

    const result = await service.updatePolicy({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      input: VALID_INPUT,
      requestId: REQUEST_ID,
    });
    expect(result.policy.id).toBe(POLICY_ID);
  });
});

describe('SchoolPoliciesService.getPoliciesForChild', () => {
  let mocks: Mocks;
  let service: SchoolPoliciesService;

  beforeEach(() => {
    mocks = buildMocks();
    service = buildService(mocks);
  });

  it('throws Forbidden when child does not belong to the household', async () => {
    mocks.childrenRepo.findById.mockResolvedValueOnce(null);

    await expect(
      service.getPoliciesForChild({
        childId: CHILD_ID,
        householdId: HOUSEHOLD_ID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('returns the active policy list when ownership is verified', async () => {
    mocks.childrenRepo.findById.mockResolvedValueOnce(buildChild());
    mocks.policiesRepo.findActiveByChildId.mockResolvedValueOnce([buildPolicy()]);

    const policies = await service.getPoliciesForChild({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
    });
    expect(policies).toHaveLength(1);
    expect(policies[0]?.policy_type).toBe('nut_free');
  });
});

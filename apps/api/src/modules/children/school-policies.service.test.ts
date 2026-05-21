import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { SchoolPolicy, UpdateSchoolPolicyInput } from '@hivekitchen/types';
import type { AuditService } from '../../audit/audit.service.js';
import type { ChildrenRepository, DecryptedChildRow } from './children.repository.js';
import type { PlanAdjustmentService } from '../plans/plan-adjustment.service.js';
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
    bag_composition_pattern: null,
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
  planAdjustment: PlanAdjustmentService & { triggerAdjustment: ReturnType<typeof vi.fn> };
  auditService: AuditService & { write: ReturnType<typeof vi.fn> };
}

function buildMocks(): Mocks {
  return {
    childrenRepo: { findById: vi.fn() } as unknown as Mocks['childrenRepo'],
    policiesRepo: {
      upsertPolicy: vi.fn(),
      findActiveByChildId: vi.fn(),
    } as unknown as Mocks['policiesRepo'],
    planAdjustment: {
      triggerAdjustment: vi
        .fn()
        .mockResolvedValue({ plansQueued: 0, enqueuedPlanIds: [], failedPlanIds: [] }),
    } as unknown as Mocks['planAdjustment'],
    auditService: { write: vi.fn().mockResolvedValue(undefined) } as unknown as Mocks['auditService'],
  };
}

function buildService(mocks: Mocks): SchoolPoliciesService {
  return new SchoolPoliciesService({
    repository: mocks.policiesRepo,
    childrenRepository: mocks.childrenRepo,
    planAdjustmentService: mocks.planAdjustment,
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
    expect(mocks.planAdjustment.triggerAdjustment).not.toHaveBeenCalled();
  });

  it('deactivation does NOT call planAdjustmentService', async () => {
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
    expect(mocks.planAdjustment.triggerAdjustment).not.toHaveBeenCalled();

    // The policy update itself is still audited.
    expect(mocks.auditService.write).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'school_policy.updated' }),
    );
  });

  it('activation with no plans queued returns regeneration_triggered=false', async () => {
    mocks.childrenRepo.findById.mockResolvedValueOnce(buildChild());
    mocks.policiesRepo.upsertPolicy.mockResolvedValueOnce(buildPolicy());
    mocks.planAdjustment.triggerAdjustment.mockResolvedValueOnce({
      plansQueued: 0,
      enqueuedPlanIds: [],
      failedPlanIds: [],
    });

    const result = await service.updatePolicy({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      input: VALID_INPUT,
      requestId: REQUEST_ID,
    });

    expect(result.regenerationTriggered).toBe(false);
    expect(result.affectedPlanIds).toEqual([]);
    expect(mocks.planAdjustment.triggerAdjustment).toHaveBeenCalledTimes(1);
  });

  it('activation hands off to planAdjustmentService with school_policy_changed trigger', async () => {
    mocks.childrenRepo.findById.mockResolvedValueOnce(buildChild());
    mocks.policiesRepo.upsertPolicy.mockResolvedValueOnce(buildPolicy({ slot_scope: 'main' }));
    mocks.planAdjustment.triggerAdjustment.mockResolvedValueOnce({
      plansQueued: 2,
      enqueuedPlanIds: [PLAN_A, PLAN_B],
      failedPlanIds: [],
    });

    const result = await service.updatePolicy({
      childId: CHILD_ID,
      householdId: HOUSEHOLD_ID,
      input: { ...VALID_INPUT, slot_scope: 'main' },
      requestId: REQUEST_ID,
    });

    expect(result.regenerationTriggered).toBe(true);
    expect(result.affectedPlanIds).toEqual([PLAN_A, PLAN_B]);

    expect(mocks.planAdjustment.triggerAdjustment).toHaveBeenCalledWith({
      type: 'school_policy_changed',
      householdId: HOUSEHOLD_ID,
      slotScope: 'main',
      dayScope: null,
      requestId: REQUEST_ID,
      metadata: {
        child_id: CHILD_ID,
        policy_id: POLICY_ID,
        policy_type: 'nut_free',
      },
    });
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
    mocks.planAdjustment.triggerAdjustment.mockResolvedValueOnce({
      plansQueued: 0,
      enqueuedPlanIds: [],
      failedPlanIds: [],
    });
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

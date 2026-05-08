import type { FastifyBaseLogger } from 'fastify';
import type {
  SchoolPolicy,
  UpdateSchoolPolicyInput,
} from '@hivekitchen/types';
import { ForbiddenError } from '../../common/errors.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { PlanAdjustmentService } from '../plans/plan-adjustment.service.js';
import type { ChildrenRepository } from './children.repository.js';
import type { SchoolPoliciesRepository } from './school-policies.repository.js';

export interface SchoolPoliciesServiceDeps {
  repository: SchoolPoliciesRepository;
  childrenRepository: ChildrenRepository;
  planAdjustmentService: PlanAdjustmentService;
  auditService: AuditService;
  logger: FastifyBaseLogger;
}

export interface UpdatePolicyInput {
  childId: string;
  householdId: string;
  input: UpdateSchoolPolicyInput;
  requestId: string;
}

export interface UpdatePolicyResult {
  policy: SchoolPolicy;
  regenerationTriggered: boolean;
  affectedPlanIds: string[];
}

// Story 3.16 — School policy update + propagation (FR22, FR112).
// Story 3.17 — Regeneration fanout is now delegated to PlanAdjustmentService;
// this service only owns the policy upsert + ownership check + policy-update
// audit. The fanout-level audit (`plan.adjustment_triggered`, with
// trigger_type='school_policy_changed') is written by PlanAdjustmentService.
//
// Deactivation is non-propagating: removing a constraint is always safe for
// existing plans and the next plan-generation cycle picks up the relaxed
// rule set automatically.
export class SchoolPoliciesService {
  private readonly repo: SchoolPoliciesRepository;
  private readonly childrenRepo: ChildrenRepository;
  private readonly planAdjustment: PlanAdjustmentService;
  private readonly auditService: AuditService;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: SchoolPoliciesServiceDeps) {
    this.repo = deps.repository;
    this.childrenRepo = deps.childrenRepository;
    this.planAdjustment = deps.planAdjustmentService;
    this.auditService = deps.auditService;
    this.logger = deps.logger;
  }

  async updatePolicy(opts: UpdatePolicyInput): Promise<UpdatePolicyResult> {
    // 1. Verify the child belongs to this household. Same 403 for missing /
    //    cross-household to avoid leaking existence (matches Story 2.12 pattern).
    const child = await this.childrenRepo.findById(opts.householdId, opts.childId);
    if (child === null) {
      throw new ForbiddenError('Child not in this household');
    }

    // 2. Upsert the policy.
    const policy = await this.repo.upsertPolicy({
      childId: opts.childId,
      policyType: opts.input.policy_type,
      policyDescription: opts.input.policy_description ?? null,
      slotScope: opts.input.slot_scope,
      isActive: opts.input.is_active,
    });

    // 3. Audit the policy change. PII-free — only IDs + non-sensitive flags.
    try {
      await this.auditService.write({
        event_type: 'school_policy.updated',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          child_id: opts.childId,
          policy_id: policy.id,
          policy_type: policy.policy_type,
          slot_scope: policy.slot_scope,
          is_active: policy.is_active,
        },
      });
    } catch (err) {
      this.logger.error(
        { err, policy_id: policy.id },
        'audit write failed for school_policy.updated — continuing',
      );
    }

    // 4. Deactivation never triggers regeneration.
    if (!policy.is_active) {
      return { policy, regenerationTriggered: false, affectedPlanIds: [] };
    }

    // 5. Activation: hand off to PlanAdjustmentService. Slot-level partial
    //    regen is still deferred (see deferred-work.md from 3.16) — the
    //    dispatcher converts a non-bag-wide slot_scope into a full week-scope
    //    regen and surfaces the original slot_scope in the audit metadata.
    const result = await this.planAdjustment.triggerAdjustment({
      type: 'school_policy_changed',
      householdId: opts.householdId,
      slotScope: policy.slot_scope,
      dayScope: null,
      requestId: opts.requestId,
      metadata: {
        child_id: opts.childId,
        policy_id: policy.id,
        policy_type: policy.policy_type,
      },
    });

    return {
      policy,
      regenerationTriggered: result.plansQueued > 0,
      affectedPlanIds: result.enqueuedPlanIds,
    };
  }

  async getPoliciesForChild(opts: {
    childId: string;
    householdId: string;
  }): Promise<SchoolPolicy[]> {
    // Verify ownership before exposing the policy list — RLS would protect the
    // table, but the explicit check keeps the 403 vs 200-with-empty-list
    // distinction intact.
    const child = await this.childrenRepo.findById(opts.householdId, opts.childId);
    if (child === null) {
      throw new ForbiddenError('Child not in this household');
    }
    return this.repo.findActiveByChildId(opts.childId);
  }
}

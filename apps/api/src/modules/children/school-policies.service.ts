import type { Queue } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type {
  SchoolPolicy,
  UpdateSchoolPolicyInput,
} from '@hivekitchen/types';
import { ForbiddenError } from '../../common/errors.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { PlansRepository } from '../plans/plans.repository.js';
import type { PlanRegenerationJobData } from '../../jobs/plan-regeneration.job.js';
import type { ChildrenRepository } from './children.repository.js';
import type { SchoolPoliciesRepository } from './school-policies.repository.js';

export interface SchoolPoliciesServiceDeps {
  repository: SchoolPoliciesRepository;
  childrenRepository: ChildrenRepository;
  plansRepository: PlansRepository;
  regenQueue: Queue;
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
// Activating a policy triggers regeneration of all cleared future plans for
// the household via REGEN_QUEUE (the queue itself is shared with Story 3.13's
// user-initiated regen — same job shape, different cause).
// Deactivation is non-propagating: removing a constraint is always safe for
// existing plans.
export class SchoolPoliciesService {
  private readonly repo: SchoolPoliciesRepository;
  private readonly childrenRepo: ChildrenRepository;
  private readonly plansRepo: PlansRepository;
  private readonly regenQueue: Queue;
  private readonly auditService: AuditService;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: SchoolPoliciesServiceDeps) {
    this.repo = deps.repository;
    this.childrenRepo = deps.childrenRepository;
    this.plansRepo = deps.plansRepository;
    this.regenQueue = deps.regenQueue;
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

    // 4. Deactivation never triggers regeneration. Removing a constraint is
    //    safe for existing plans; the next plan-generation cycle picks up the
    //    relaxed rule set automatically.
    if (!policy.is_active) {
      return { policy, regenerationTriggered: false, affectedPlanIds: [] };
    }

    // 5. Activation: enqueue week-scope regeneration for every cleared future
    //    plan. Slot-level partial regen is deferred (see Dev Notes); week-scope
    //    is a superset and the planner prompt receives slot_scope as context.
    const futurePlans = await this.plansRepo.findActiveFuturePlanIds(opts.householdId);
    if (futurePlans.length === 0) {
      return { policy, regenerationTriggered: false, affectedPlanIds: [] };
    }

    const enqueuedPlanIds: string[] = [];
    for (const plan of futurePlans) {
      const jobData: PlanRegenerationJobData = {
        plan_id: plan.id,
        household_id: opts.householdId,
        week_of: plan.week_of,
        week_id: plan.week_id,
        current_revision: plan.revision,
        scope: 'week',
        request_id: opts.requestId,
      };
      try {
        // Job ID dedupes concurrent retries from the same request: a client
        // double-tap on the toggle for the same policy will land in BullMQ as
        // one job rather than N. policy_type is included so toggling two
        // different policies in the same request still produces distinct jobs.
        const jobId = `policy-regen-${opts.householdId}-${plan.week_id}-${policy.policy_type}-${opts.requestId}`;
        await this.regenQueue.add('regenerate-plan-policy', jobData, {
          attempts: 2,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
          jobId,
        });
        enqueuedPlanIds.push(plan.id);
      } catch (err) {
        // One failed enqueue does not block the others — best-effort propagation.
        // The audit trail below records the per-policy fanout, so ops can
        // detect partial failures.
        this.logger.error(
          { err, plan_id: plan.id, policy_id: policy.id },
          'failed to enqueue policy-triggered regen for plan — continuing',
        );
      }
    }

    if (enqueuedPlanIds.length > 0) {
      try {
        await this.auditService.write({
          event_type: 'plan.policy_regeneration_triggered',
          household_id: opts.householdId,
          request_id: opts.requestId,
          metadata: {
            policy_id: policy.id,
            policy_type: policy.policy_type,
            slot_scope: policy.slot_scope,
            affected_plan_ids: enqueuedPlanIds,
          },
        });
      } catch (err) {
        this.logger.error(
          { err, policy_id: policy.id },
          'audit write failed for plan.policy_regeneration_triggered — jobs enqueued',
        );
      }
    }

    return {
      policy,
      regenerationTriggered: enqueuedPlanIds.length > 0,
      affectedPlanIds: enqueuedPlanIds,
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

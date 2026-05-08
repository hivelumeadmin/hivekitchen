import type { Queue } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type { AuditService } from '../../audit/audit.service.js';
import type { PlansRepository } from './plans.repository.js';
import type { PlanRegenerationJobData } from '../../jobs/plan-regeneration.job.js';
import type { PlanAdjustmentResult, PlanAdjustmentTrigger } from './plan-adjustment.types.js';

export interface PlanAdjustmentServiceDeps {
  plansRepository: PlansRepository;
  regenQueue: Queue;
  auditService: AuditService;
  logger: FastifyBaseLogger;
}

// Story 3.17 — central dispatcher for event-driven plan adjustments.
//
// Existing per-cause services (Story 3.16's SchoolPoliciesService, Epic 6's
// future leftover service, Story 3.18's calendar service) call
// `triggerAdjustment()` after their own commit succeeds. This keeps the
// trigger sources stateless about regen plumbing — they hand off a typed
// PlanAdjustmentTrigger and we own job fanout, dedup, and audit.
//
// Reuses Story 3.13's REGEN_QUEUE shape and worker — no new BullMQ topology.
// Per-job dedupe key is `(trigger.type, householdId, week_id, dayScope)` so a
// burst of identical triggers (e.g. duplicate webhook) collapses to one job
// per affected plan.
export class PlanAdjustmentService {
  private readonly plansRepo: PlansRepository;
  private readonly regenQueue: Queue;
  private readonly auditService: AuditService;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: PlanAdjustmentServiceDeps) {
    this.plansRepo = deps.plansRepository;
    this.regenQueue = deps.regenQueue;
    this.auditService = deps.auditService;
    this.logger = deps.logger;
  }

  async triggerAdjustment(trigger: PlanAdjustmentTrigger): Promise<PlanAdjustmentResult> {
    let futurePlans: Array<{ id: string; week_id: string; week_of: string; revision: number }>;
    try {
      futurePlans = await this.plansRepo.findActiveFuturePlanIds(trigger.householdId);
    } catch (err) {
      this.logger.error(
        { err, module: 'plan-adjustment', trigger_type: trigger.type, household_id: trigger.householdId },
        'plan-adjustment: failed to query future plans — regen not triggered',
      );
      throw err;
    }

    if (futurePlans.length === 0) {
      this.logger.info(
        {
          module: 'plan-adjustment',
          trigger_type: trigger.type,
          household_id: trigger.householdId,
        },
        'plan-adjustment: no active future plans — no regen triggered',
      );
      return { plansQueued: 0, enqueuedPlanIds: [], failedPlanIds: [] };
    }

    // dayScope!=null narrows regen to a single day; otherwise the planner
    // rebuilds the full week. Slot-scope partial regen is deferred (3.16
    // deferred-work entry) — week-scope is a safe superset.
    const scope: 'week' | 'day' = trigger.dayScope !== null ? 'day' : 'week';

    const enqueuedPlanIds: string[] = [];
    const failedPlanIds: string[] = [];

    for (const plan of futurePlans) {
      const jobData: PlanRegenerationJobData = {
        plan_id: plan.id,
        household_id: trigger.householdId,
        week_of: plan.week_of,
        week_id: plan.week_id,
        current_revision: plan.revision,
        scope,
        request_id: trigger.requestId,
        ...(trigger.dayScope !== null ? { day: trigger.dayScope } : {}),
      };
      // jobId dedupes identical triggers within a BullMQ retention window so a
      // duplicate webhook or a retried policy PATCH does not enqueue twice for
      // the same (plan, day). request_id is intentionally NOT in the key —
      // that would defeat dedup across retries.
      const jobId = `adjust-${trigger.type}-${trigger.householdId}-${plan.week_id}-${trigger.dayScope ?? 'week'}`;
      try {
        await this.regenQueue.add(`regen-${trigger.type}`, jobData, {
          attempts: 2,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
          jobId,
        });
        enqueuedPlanIds.push(plan.id);
      } catch (err) {
        // One failed enqueue does not block the others; the audit fanout
        // below distinguishes partial failures from a clean run.
        failedPlanIds.push(plan.id);
        this.logger.error(
          { err, plan_id: plan.id, trigger_type: trigger.type },
          'plan-adjustment: failed to enqueue regen — continuing with remaining plans',
        );
      }
    }

    try {
      await this.auditService.write({
        event_type: 'plan.adjustment_triggered',
        household_id: trigger.householdId,
        request_id: trigger.requestId,
        metadata: {
          ...trigger.metadata,
          trigger_type: trigger.type,
          slot_scope: trigger.slotScope,
          day_scope: trigger.dayScope,
          enqueued_plan_ids: enqueuedPlanIds,
          failed_plan_ids: failedPlanIds,
        },
      });
    } catch (err) {
      this.logger.error(
        { err, trigger_type: trigger.type, household_id: trigger.householdId },
        'audit write failed for plan.adjustment_triggered — continuing',
      );
    }

    return {
      plansQueued: enqueuedPlanIds.length,
      enqueuedPlanIds,
      failedPlanIds,
    };
  }
}

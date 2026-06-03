import type { Queue } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type { AuditService } from '../../audit/audit.service.js';
import { NotFoundError } from '../../common/errors.js';
import type {
  PlanDayContext,
  PlanDayContextType,
  SetPlanDayContextInput,
} from '@hivekitchen/types';
import type { PlanDayContextRepository } from './plan-day-context.repository.js';
import type { PlansRepository } from './plans.repository.js';
import type { BriefStateComposer } from './brief-state.composer.js';
import type { PlanRegenerationJobData } from '../../jobs/plan-regeneration.job.js';
import { REGEN_QUEUE } from '../../jobs/plan-regeneration.job.js';

export interface PlanDayContextServiceDeps {
  repository: PlanDayContextRepository;
  plansRepository: PlansRepository;
  briefStateComposer: BriefStateComposer;
  regenQueue: Queue;
  auditService: AuditService;
  logger: FastifyBaseLogger;
}

// Composition-changing context types trigger a day-scope regeneration so the
// planner can adjust meal content (e.g. field_trip → portable foods).
//
// early_release is intentionally absent from the set: it records the event for
// audit and future use by the Lunch Link delivery pipeline (Epic 4) but has no
// effect on meal composition at this time.
//
// Pause semantics (formerly bag_suspended / sick_day) live on
// plan_days.paused_at + paused_reason and plan_slot_variations.paused_at, not
// here — those values were dropped from the enum by 3-DM-E1.
const COMPOSITION_CHANGING_OVERRIDES = new Set<PlanDayContextType>([
  'half_day',
  'field_trip',
  'post_dentist',
  'sport_practice',
  'test_day',
]);

export class PlanDayContextService {
  private readonly repo: PlanDayContextRepository;
  private readonly plansRepo: PlansRepository;
  private readonly briefStateComposer: BriefStateComposer;
  private readonly regenQueue: Queue;
  private readonly auditService: AuditService;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: PlanDayContextServiceDeps) {
    this.repo = deps.repository;
    this.plansRepo = deps.plansRepository;
    this.briefStateComposer = deps.briefStateComposer;
    this.regenQueue = deps.regenQueue;
    this.auditService = deps.auditService;
    this.logger = deps.logger;
  }

  // The route only carries planSlotId; planDayId is derived here from the slot.
  // Keeping the derivation in the service (not the route) preserves the
  // thin-handler discipline and lets internal callers reuse the same single-arg
  // shape.
  async setOverride(opts: {
    planId: string;
    planSlotId: string;
    householdId: string;
    input: SetPlanDayContextInput;
    requestId: string;
  }): Promise<{ override: PlanDayContext; regenTriggered: boolean }> {
    const plan = await this.plansRepo.findByIdForOps({
      planId: opts.planId,
      householdId: opts.householdId,
    });
    if (!plan) throw new NotFoundError(`plan ${opts.planId}`);

    const slots = await this.plansRepo.findSlotsByPlanId(opts.planId);
    const slot = slots.find((s) => s.id === opts.planSlotId);
    if (!slot) throw new NotFoundError(`plan_slot ${opts.planSlotId}`);
    const planDayId = slot.plan_day_id;

    const override = await this.repo.upsert({
      planSlotId: opts.planSlotId,
      childId: opts.input.child_id,
      householdId: opts.householdId,
      overrideDate: opts.input.override_date,
      contextType: opts.input.context_type,
      isLumiProposed: opts.input.is_lumi_proposed,
    });

    try {
      await this.auditService.write({
        event_type: 'plan.day_override_set',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          plan_id: opts.planId,
          plan_slot_id: opts.planSlotId,
          child_id: opts.input.child_id,
          override_id: override.id,
          context_type: opts.input.context_type,
          override_date: opts.input.override_date,
          is_lumi_proposed: opts.input.is_lumi_proposed,
        },
      });
    } catch (err) {
      this.logger.error(
        { err, plan_id: opts.planId, plan_slot_id: opts.planSlotId },
        'audit write failed for plan.day_override_set — continuing',
      );
    }

    // Composition-changing → day-scope regen. We read the day enum from the
    // slot's day row (planDayId was derived above from the slot).
    let regenTriggered = false;
    if (COMPOSITION_CHANGING_OVERRIDES.has(opts.input.context_type)) {
      if (plan.week_of !== null) {
        const days = await this.plansRepo.findDaysByPlanId(opts.planId);
        const dayRow = days.find((d) => d.id === planDayId);
        if (dayRow !== undefined) {
          const jobData: PlanRegenerationJobData = {
            plan_id: opts.planId,
            household_id: opts.householdId,
            week_of: plan.week_of,
            current_revision: plan.revision,
            scope: 'day',
            day: dayRow.day,
            request_id: opts.requestId,
          };
          const jobId = `day-override-${opts.planSlotId}-${opts.input.override_date}-${opts.input.context_type}`;
          try {
            await this.regenQueue.add('regen-day-override', jobData, {
              attempts: 2,
              backoff: { type: 'exponential', delay: 30_000 },
              removeOnComplete: { count: 100 },
              removeOnFail: { count: 50 },
              jobId,
            });
            regenTriggered = true;
          } catch (err) {
            this.logger.error(
              { err, plan_id: opts.planId, plan_slot_id: opts.planSlotId },
              'failed to enqueue day regen for override — continuing',
            );
          }
        } else {
          this.logger.warn(
            { plan_id: opts.planId, plan_day_id: planDayId },
            'planDayId not found on plan — skipping regen enqueue',
          );
        }
      } else {
        this.logger.warn(
          { plan_id: opts.planId },
          'plan lacks week_of — skipping day-override regen enqueue',
        );
      }
    }

    return { override, regenTriggered };
  }

  async revertOverride(opts: {
    planId: string;
    planSlotId: string;
    overrideId: string;
    householdId: string;
    requestId: string;
  }): Promise<void> {
    const plan = await this.plansRepo.findByIdForOps({
      planId: opts.planId,
      householdId: opts.householdId,
    });
    if (!plan) throw new NotFoundError(`plan ${opts.planId}`);

    const existing = await this.repo.findActiveById(
      opts.overrideId,
      opts.householdId,
      opts.planSlotId,
    );
    if (!existing) {
      throw new NotFoundError(`plan_day_context ${opts.overrideId}`);
    }

    const reverted = await this.repo.revert(
      opts.overrideId,
      opts.householdId,
      opts.planSlotId,
    );
    if (!reverted) {
      throw new NotFoundError(`plan_day_context ${opts.overrideId}`);
    }

    try {
      await this.auditService.write({
        event_type: 'plan.day_override_reverted',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          plan_id: opts.planId,
          plan_slot_id: opts.planSlotId,
          override_id: opts.overrideId,
          context_type: reverted.context_type,
          override_date: reverted.override_date,
        },
      });
    } catch (err) {
      this.logger.error(
        { err, plan_id: opts.planId, override_id: opts.overrideId },
        'audit write failed for plan.day_override_reverted — continuing',
      );
    }
  }
}

export { REGEN_QUEUE };

import type { Queue } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type { AuditService } from '../../audit/audit.service.js';
import { ConflictError, NotFoundError } from '../../common/errors.js';
import type {
  DayOverride,
  DayOverrideType,
  PlanItemRow,
  SetDayOverrideInput,
} from '@hivekitchen/types';
import type { DayOverridesRepository } from './day-overrides.repository.js';
import type { PlansRepository } from './plans.repository.js';
import type { BriefStateComposer } from './brief-state.composer.js';
import type { PlanRegenerationJobData } from '../../jobs/plan-regeneration.job.js';
import { REGEN_QUEUE } from '../../jobs/plan-regeneration.job.js';

export interface DayOverridesServiceDeps {
  repository: DayOverridesRepository;
  plansRepository: PlansRepository;
  briefStateComposer: BriefStateComposer;
  regenQueue: Queue;
  auditService: AuditService;
  logger: FastifyBaseLogger;
}

// Composition-changing overrides trigger a day-scope regeneration so the
// planner can adjust meal content (e.g. field_trip → portable foods). The
// non-composition set (bag_suspended, sick_day, early_release) does not regen:
// bag_suspended and sick_day pause the slot, early_release only changes timing.
//
// early_release is intentionally absent from both sets: it records the event
// for audit and future use by the Lunch Link delivery pipeline (Epic 4) but
// has no effect on meal composition or slot suppression at this time.
const COMPOSITION_CHANGING_OVERRIDES = new Set<DayOverrideType>([
  'half_day',
  'field_trip',
  'post_dentist',
  'sport_practice',
  'test_day',
]);

const PAUSING_OVERRIDES = new Set<DayOverrideType>([
  'bag_suspended',
  'sick_day',
]);

export class DayOverridesService {
  private readonly repo: DayOverridesRepository;
  private readonly plansRepo: PlansRepository;
  private readonly briefStateComposer: BriefStateComposer;
  private readonly regenQueue: Queue;
  private readonly auditService: AuditService;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: DayOverridesServiceDeps) {
    this.repo = deps.repository;
    this.plansRepo = deps.plansRepository;
    this.briefStateComposer = deps.briefStateComposer;
    this.regenQueue = deps.regenQueue;
    this.auditService = deps.auditService;
    this.logger = deps.logger;
  }

  async setOverride(opts: {
    planId: string;
    planItemId: string;
    householdId: string;
    input: SetDayOverrideInput;
    requestId: string;
  }): Promise<{ override: DayOverride; regenTriggered: boolean }> {
    const plan = await this.plansRepo.findByIdForOps({
      planId: opts.planId,
      householdId: opts.householdId,
    });
    if (!plan) throw new NotFoundError(`plan ${opts.planId}`);

    const item = await this.plansRepo.findItemById({
      itemId: opts.planItemId,
      planId: opts.planId,
    });
    if (!item) throw new NotFoundError(`plan_item ${opts.planItemId}`);

    // child_id in the request body must match the item — the body field exists
    // for client clarity but must not be trusted as authoritative.
    if (item.child_id !== opts.input.child_id) {
      throw new NotFoundError(`plan_item ${opts.planItemId}`);
    }

    // DN5: block composition overrides while a day-level suspension is active.
    // Parent must revert sick_day / bag_suspended before setting another type.
    if (!PAUSING_OVERRIDES.has(opts.input.override_type)) {
      const suspension = await this.repo.findActivePausingForChildOnDate(
        item.child_id,
        opts.input.override_date,
      );
      if (suspension) {
        throw new ConflictError(
          `Day is suspended (${suspension.override_type}) — revert it before setting a composition override.`,
        );
      }
    }

    // Upsert the override record before pausing the slot so that a failed
    // pause leaves an existing, retryable record rather than a paused slot
    // with no corresponding override row.
    const override = await this.repo.upsert({
      planItemId: opts.planItemId,
      childId: opts.input.child_id,
      householdId: opts.householdId,
      overrideDate: opts.input.override_date,
      overrideType: opts.input.override_type,
      isLumiProposed: opts.input.is_lumi_proposed,
    });

    let pausedItem: PlanItemRow | null = null;
    if (PAUSING_OVERRIDES.has(opts.input.override_type)) {
      pausedItem = await this.plansRepo.pauseItemById({
        itemId: opts.planItemId,
        planId: opts.planId,
        pausedAt: new Date().toISOString(),
      });
    }

    // If we paused the slot, the brief projection needs to surface the new
    // paused state on the tile. Skip the refresh on the no-op path so we do
    // not burn a projection round-trip on idempotent retries.
    if (pausedItem) {
      await this.briefStateComposer.refresh(
        opts.householdId,
        plan.week_id,
        opts.requestId,
        { userInitiated: true },
      );
    }

    try {
      await this.auditService.write({
        event_type: 'plan.day_override_set',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          plan_id: opts.planId,
          plan_item_id: opts.planItemId,
          child_id: opts.input.child_id,
          override_id: override.id,
          override_type: opts.input.override_type,
          override_date: opts.input.override_date,
          is_lumi_proposed: opts.input.is_lumi_proposed,
          paused: pausedItem !== null,
        },
      });
    } catch (err) {
      this.logger.error(
        { err, plan_id: opts.planId, plan_item_id: opts.planItemId },
        'audit write failed for plan.day_override_set — continuing',
      );
    }

    let regenTriggered = false;
    if (COMPOSITION_CHANGING_OVERRIDES.has(opts.input.override_type)) {
      if (plan.week_of) {
        const jobData: PlanRegenerationJobData = {
          plan_id: opts.planId,
          household_id: opts.householdId,
          week_of: plan.week_of,
          week_id: plan.week_id,
          current_revision: plan.revision,
          scope: 'day',
          day: item.day,
          request_id: opts.requestId,
        };
        // jobId scopes dedup to (plan_item, override_date) — a duplicate
        // POST with the same body collapses to one regen, but a different
        // override_type for the same slot still re-enqueues.
        // Include override_type in the dedup key so rapid type changes (e.g.
        // field_trip → sport_practice for the same slot+date) each enqueue a
        // distinct job rather than re-using the stale job payload.
        const jobId = `day-override-${opts.planItemId}-${opts.input.override_date}-${opts.input.override_type}`;
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
            { err, plan_id: opts.planId, plan_item_id: opts.planItemId },
            'failed to enqueue day regen for override — continuing',
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
    planItemId: string;
    overrideId: string;
    householdId: string;
    requestId: string;
  }): Promise<void> {
    const plan = await this.plansRepo.findByIdForOps({
      planId: opts.planId,
      householdId: opts.householdId,
    });
    if (!plan) throw new NotFoundError(`plan ${opts.planId}`);

    // Look up the override before mutating so we know its type for the unpause
    // decision. If we checked type from revert()'s return value instead, a
    // failed unpause would leave the slot paused with a reverted override row
    // — a stuck state requiring manual intervention.
    const existing = await this.repo.findActiveById(
      opts.overrideId,
      opts.householdId,
      opts.planItemId,
    );
    if (!existing) {
      throw new NotFoundError(`day_override ${opts.overrideId}`);
    }

    // Unpause before reverting: if revert fails, the slot is unblocked and
    // the retry can complete cleanly.
    if (PAUSING_OVERRIDES.has(existing.override_type as DayOverrideType)) {
      await this.plansRepo.unpauseItemById({
        itemId: opts.planItemId,
        planId: opts.planId,
      });
      await this.briefStateComposer.refresh(
        opts.householdId,
        plan.week_id,
        opts.requestId,
        { userInitiated: true },
      );
    }

    const reverted = await this.repo.revert(
      opts.overrideId,
      opts.householdId,
      opts.planItemId,
    );
    if (!reverted) {
      // Race: another request reverted it between our findActiveById and here.
      throw new NotFoundError(`day_override ${opts.overrideId}`);
    }

    try {
      await this.auditService.write({
        event_type: 'plan.day_override_reverted',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          plan_id: opts.planId,
          plan_item_id: opts.planItemId,
          override_id: opts.overrideId,
          override_type: reverted.override_type,
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

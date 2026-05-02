import type { FastifyBaseLogger } from 'fastify';
import type { PlansRepository } from './plans.repository.js';
import type {
  BriefStateRepository,
  BriefStateUpsertInput,
} from './brief-state.repository.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { PlanItemRow, PlanTileSummary } from '@hivekitchen/types';

export interface BriefStateComposerDeps {
  plansRepository: PlansRepository;
  briefStateRepository: BriefStateRepository;
  auditService: AuditService;
  logger: FastifyBaseLogger;
}

const SCHOOL_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
type SchoolDay = (typeof SCHOOL_DAYS)[number];

// Tier B projection writer (architecture §1.5). Refreshes brief_state on
// plan.updated / memory.updated / thread.turn. Story 3.6 wires only the
// plan.updated trigger (PlansService.commit()); memory.updated and thread.turn
// land in Stories 5.11 and Epic 5 respectively — that is why this composer is
// exposed as a Fastify decorator (briefStateComposer) rather than coupled to
// the plans module.
//
// Critical: refresh() MUST NOT throw. The triggering event always succeeds
// regardless of projection write outcome. All errors are caught, logged, and
// audited as brief.projection.failure.
export class BriefStateComposer {
  private readonly plansRepo: PlansRepository;
  private readonly briefStateRepo: BriefStateRepository;
  private readonly auditService: AuditService;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: BriefStateComposerDeps) {
    this.plansRepo = deps.plansRepository;
    this.briefStateRepo = deps.briefStateRepository;
    this.auditService = deps.auditService;
    this.logger = deps.logger;
  }

  async refresh(householdId: string, weekId: string, requestId: string): Promise<void> {
    try {
      // Only guardrail-cleared plans populate the projection (presentation-bind
      // contract). findCurrentByHousehold filters guardrail_cleared_at IS NOT NULL,
      // so a pre-clearance plan returns null and the composer no-ops.
      const plan = await this.plansRepo.findCurrentByHousehold({
        householdId,
        weekId,
      });
      if (!plan) {
        this.logger.debug(
          { household_id: householdId, week_id: weekId },
          'brief_state refresh skipped — no cleared plan found for this week',
        );
        return;
      }

      const items = await this.plansRepo.findItemsByPlanId(plan.id);

      // moment_headline / lumi_note / memory_prose remain '' until the
      // planner agent (Story 3.7) and memory prose composer (Story 5.11) are
      // wired. Empty strings are the correct initial state.
      const upsertInput: BriefStateUpsertInput = {
        household_id: householdId,
        moment_headline: '',
        lumi_note: '',
        memory_prose: '',
        plan_tile_summaries: this.buildTileSummaries(items),
        generated_at: new Date().toISOString(),
        plan_revision: plan.revision,
      };

      await this.briefStateRepo.upsert(upsertInput);

      this.logger.info(
        { household_id: householdId, plan_id: plan.id, revision: plan.revision },
        'brief_state projection refreshed',
      );
    } catch (err) {
      this.logger.error(
        { household_id: householdId, week_id: weekId, err },
        'brief_state projection refresh failed',
      );
      try {
        await this.auditService.write({
          event_type: 'brief.projection.failure',
          household_id: householdId,
          request_id: requestId,
          metadata: {
            week_id: weekId,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      } catch (auditErr) {
        this.logger.error(
          { household_id: householdId, auditErr },
          'audit write failed for brief.projection.failure',
        );
      }
    }
  }

  // plan_items has one row per child × day × slot. Group rows by school day,
  // skipping any non-school day, and emit days in canonical Mon→Fri order.
  // Days with zero items are omitted (school holidays, school-only days a
  // child does not attend, etc.).
  private buildTileSummaries(items: PlanItemRow[]): PlanTileSummary[] {
    const byDay = new Map<SchoolDay, PlanTileSummary['items']>();
    for (const item of items) {
      if (!SCHOOL_DAYS.includes(item.day as SchoolDay)) continue;
      const day = item.day as SchoolDay;
      const existing = byDay.get(day) ?? [];
      existing.push({
        child_id: item.child_id,
        slot: item.slot,
        ingredients: item.ingredients,
        ...(item.recipe_id != null ? { recipe_id: item.recipe_id } : {}),
        ...(item.item_id != null ? { item_id: item.item_id } : {}),
      });
      byDay.set(day, existing);
    }
    return SCHOOL_DAYS.filter((day) => byDay.has(day)).map((day) => ({
      day,
      items: byDay.get(day) ?? [],
    }));
  }
}

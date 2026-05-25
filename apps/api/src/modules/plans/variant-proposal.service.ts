import type { FastifyBaseLogger } from 'fastify';
import type { AuditService } from '../../audit/audit.service.js';
import type { PlanComposeOutput, PlanItemRow } from '@hivekitchen/types';
import type { PlansRepository } from './plans.repository.js';
import type { VariantProposalRepository } from './variant-proposal.repository.js';

export interface VariantProposalServiceDeps {
  repo: VariantProposalRepository;
  plansRepo: PlansRepository;
  auditService: AuditService;
  logger: FastifyBaseLogger;
}

export class VariantProposalService {
  private readonly repo: VariantProposalRepository;
  private readonly plansRepo: PlansRepository;
  private readonly auditService: AuditService;
  private readonly logger: FastifyBaseLogger;

  constructor(deps: VariantProposalServiceDeps) {
    this.repo = deps.repo;
    this.plansRepo = deps.plansRepo;
    this.auditService = deps.auditService;
    this.logger = deps.logger;
  }

  // Called from PlansService after a plan is committed — if the planner
  // returned a variant_proposal. One-proposal-per-plan is enforced here: a
  // second proposal for the same plan_id is a logged no-op so cognitive load
  // stays low (FR127 / Dev Notes: "ONE proposal maximum per plan").
  async createFromPlanOutput(opts: {
    planOutput: PlanComposeOutput;
    planId: string;
    householdId: string;
    requestId: string;
  }): Promise<void> {
    const proposal = opts.planOutput.variant_proposal;
    if (proposal === undefined) return;

    // Variant must be a method change. If the LLM accidentally emits the
    // same method for base and variant, the proposal carries no learning
    // signal — skip and log.
    if (proposal.base_method === proposal.variant_method) {
      this.logger.warn(
        { plan_id: opts.planId, proposal },
        'variant_proposal base_method === variant_method — skipping',
      );
      return;
    }

    // One active proposal per plan — short-circuit if we already created one
    // earlier in the commit retry loop.
    const existing = await this.repo.findActiveByPlan(opts.planId);
    if (existing.length > 0) {
      this.logger.info(
        { plan_id: opts.planId, existing_count: existing.length },
        'variant_proposal already active for plan — skipping duplicate',
      );
      return;
    }

    // Resolve the DB plan_items.id by (plan_id, child_id, day, slot).
    const planItems = await this.plansRepo.findItemsByPlanId(opts.planId);
    const match = planItems.find(
      (it: PlanItemRow) =>
        it.child_id === proposal.child_id &&
        it.day === proposal.day &&
        it.slot === proposal.slot,
    );
    if (match === undefined) {
      this.logger.warn(
        { plan_id: opts.planId, proposal },
        'variant_proposal references unknown (child_id, day, slot) — skipping',
      );
      return;
    }

    const baseRecipeName = deriveBaseRecipeName(match);

    try {
      await this.repo.create({
        householdId: opts.householdId,
        childId: proposal.child_id,
        planItemId: match.id,
        planId: opts.planId,
        baseRecipeName,
        baseMethod: proposal.base_method,
        variantDescription: proposal.variant_description,
        variantMethod: proposal.variant_method,
      });

      await this.auditService.write({
        event_type: 'plan.variant_proposal_created',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: {
          plan_id: opts.planId,
          plan_item_id: match.id,
          child_id: proposal.child_id,
          variant_method: proposal.variant_method,
        },
      });
    } catch (err) {
      this.logger.error(
        { err, plan_id: opts.planId },
        'failed to create variant_proposal — plan is committed; continuing',
      );
    }
  }

  async confirmProposal(opts: {
    proposalId: string;
    householdId: string;
    choice: 'try_variant' | 'keep_original';
    requestId: string;
  }): Promise<void> {
    if (opts.choice === 'try_variant') {
      await this.repo.confirm(opts.proposalId, opts.householdId);
    } else {
      await this.repo.reject(opts.proposalId, opts.householdId);
    }

    try {
      await this.auditService.write({
        event_type:
          opts.choice === 'try_variant'
            ? 'plan.variant_proposal_confirmed'
            : 'plan.variant_proposal_rejected',
        household_id: opts.householdId,
        request_id: opts.requestId,
        metadata: { proposal_id: opts.proposalId },
      });
    } catch (err) {
      this.logger.error(
        { err, proposal_id: opts.proposalId },
        'audit write failed for variant proposal confirm/reject — continuing',
      );
    }
  }

  // Read-through used by GET /v1/plans to surface active proposals to the
  // frontend so the PlanTile can render the pending-input state.
  async findActiveByPlan(planId: string) {
    return this.repo.findActiveByPlan(planId);
  }
}

// Until per-item recipe names are first-class on plan_items (Epic 4 area), we
// derive a human-readable label from the first few ingredients. This is good
// enough for the UI's "oven-baked instead of pan-fried chicken" framing.
function deriveBaseRecipeName(item: PlanItemRow): string {
  const ings = item.ingredients.slice(0, 3).join(', ');
  return ings.length > 0 ? ings : 'Unknown dish';
}

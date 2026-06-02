import type { FastifyBaseLogger } from 'fastify';
import type { AuditService } from '../../audit/audit.service.js';
import type { PlanComposeTreeOutput } from '@hivekitchen/types';
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

  // ==========================================================================
  // Story 3-DM-C1 Phase 6 — tree-shape mirror of createFromPlanOutput.
  // ==========================================================================

  // Consumes PlanComposeTreeOutput.variant_proposal. Resolves the proposal's
  // (child_id, day, slot) to the canonical plan_slot_variation_id by walking
  // the just-committed tree: plan_days[where day=...] → plan_slots[where
  // slot_kind=...] → plan_slot_variations[where child_id=...]. Calls
  // repo.createTree with plan_slot_variation_id instead of plan_item_id.
  //
  // base_recipe_name in tree mode derives from a lookup the caller supplies
  // (recipe-id keyed name table) since the canonical tree no longer carries
  // free-text ingredients on the plan row itself. The fallback string is
  // used when the lookup misses — matches the deriveBaseRecipeName fallback
  // in the flat path.
  async createFromTreePlanOutput(opts: {
    planOutput: PlanComposeTreeOutput;
    planId: string;
    householdId: string;
    requestId: string;
    // (recipe_id → display name) — caller-supplied at the commit boundary
    // so this service doesn't need a RecipesRepository injected. Phase 9
    // wires this from plans.hook.
    recipeNameById?: Map<string, string>;
  }): Promise<void> {
    const proposal = opts.planOutput.variant_proposal;
    if (proposal === undefined) return;

    if (proposal.base_method === proposal.variant_method) {
      this.logger.warn(
        { plan_id: opts.planId, proposal },
        'variant_proposal base_method === variant_method — skipping',
      );
      return;
    }

    const existing = await this.repo.findActiveByPlan(opts.planId);
    if (existing.length > 0) {
      this.logger.info(
        { plan_id: opts.planId, existing_count: existing.length },
        'variant_proposal already active for plan — skipping duplicate',
      );
      return;
    }

    // Resolve the canonical plan_slot_variation_id from the tree-shape
    // output. Walks days → slots → variations in memory; the planner
    // composeTree pass-through guarantees a tree consistent with itself.
    const day = opts.planOutput.days.find((d) => d.day === proposal.day);
    const slot = day?.slots.find((s) => s.slot_kind === proposal.slot);
    const variation = slot?.variations.find((v) => v.child_id === proposal.child_id);
    if (!day || !slot || !variation) {
      this.logger.warn(
        { plan_id: opts.planId, proposal },
        'variant_proposal references unknown (child_id, day, slot) in tree — skipping',
      );
      return;
    }

    // In the tree path, variations don't have stable DB ids until they are
    // committed via commit_plan(). The committed variation id is the
    // canonical FK target. The caller passes the freshly committed tree as
    // planOutput, and the repository-layer commit returns the tree with ids
    // populated — Phase 7's plan-generation.job wires that handoff. Until
    // then this method runs against tree shapes where variations[].id is
    // either present (post-commit) or absent (pre-commit synthetic). When
    // absent, log and skip rather than write a bad FK.
    const variationId = (variation as { id?: string }).id;
    if (variationId === undefined || variationId === '') {
      this.logger.warn(
        { plan_id: opts.planId, proposal },
        'variant_proposal tree variation missing id — caller must pass post-commit tree',
      );
      return;
    }

    const baseRecipeName = deriveBaseRecipeNameTree({
      slot,
      mainAssignmentRecipeId: slot.slot_kind === 'main'
        ? opts.planOutput.main_assignments.find(
            (a) => a.sequence === slot.main_assignment_sequence,
          )?.recipe_id
        : undefined,
      recipeNameById: opts.recipeNameById,
    });

    try {
      await this.repo.createTree({
        householdId: opts.householdId,
        childId: proposal.child_id,
        planSlotVariationId: variationId,
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
          plan_slot_variation_id: variationId,
          child_id: proposal.child_id,
          variant_method: proposal.variant_method,
        },
      });
    } catch (err) {
      this.logger.error(
        { err, plan_id: opts.planId },
        'failed to create variant_proposal (tree path) — plan is committed; continuing',
      );
    }
  }
}

// Story 3-DM-C1 Phase 6 — tree-shape mirror. Resolves the recipe id (from
// main_assignment or slot.recipe_id depending on slot_kind) and looks it up
// in the caller-supplied (recipe_id → name) map. Falls back to the same
// "Unknown dish" sentinel when the lookup misses.
function deriveBaseRecipeNameTree(opts: {
  slot: { slot_kind: 'main' | 'snack' | 'extra'; recipe_id?: string | undefined };
  mainAssignmentRecipeId: string | undefined;
  recipeNameById?: Map<string, string>;
}): string {
  const recipeId =
    opts.slot.slot_kind === 'main' ? opts.mainAssignmentRecipeId : opts.slot.recipe_id;
  if (recipeId === undefined) return 'Unknown dish';
  return opts.recipeNameById?.get(recipeId) ?? 'Unknown dish';
}

import { BaseRepository } from '../../repository/base.repository.js';
import type { VariantProposal } from '@hivekitchen/types';

const VARIANT_PROPOSAL_COLUMNS =
  'id, household_id, child_id, plan_item_id, plan_id, base_recipe_name, base_method, variant_description, variant_method, proposed_at, confirmed_at, rejected_at';

// Story 3-DM-C1 Phase 6 — post-migration column set. The legacy
// plan_item_id column is dropped by the migration and replaced by
// plan_slot_variation_id. Phase 9's atomic-cutover commit deletes the
// flat VARIANT_PROPOSAL_COLUMNS + create() / CreateVariantProposalInput
// and renames the tree variants to drop the Tree suffix.
const VARIANT_PROPOSAL_TREE_COLUMNS =
  'id, household_id, child_id, plan_slot_variation_id, plan_id, base_recipe_name, base_method, variant_description, variant_method, proposed_at, confirmed_at, rejected_at';

export interface CreateVariantProposalInput {
  householdId: string;
  childId: string;
  planItemId: string;
  planId: string;
  baseRecipeName: string;
  baseMethod: string;
  variantDescription: string;
  variantMethod: string;
  baseRating?: number | null;
}

// Tree-shape mirror — plan_item_id → plan_slot_variation_id.
export interface CreateVariantProposalTreeInput {
  householdId: string;
  childId: string;
  planSlotVariationId: string;
  planId: string;
  baseRecipeName: string;
  baseMethod: string;
  variantDescription: string;
  variantMethod: string;
  baseRating?: number | null;
}

export class VariantProposalRepository extends BaseRepository {
  async create(input: CreateVariantProposalInput): Promise<VariantProposal> {
    const { data, error } = await this.client
      .from('variant_proposals')
      .insert({
        household_id: input.householdId,
        child_id: input.childId,
        plan_item_id: input.planItemId,
        plan_id: input.planId,
        base_recipe_name: input.baseRecipeName,
        base_method: input.baseMethod,
        variant_description: input.variantDescription,
        variant_method: input.variantMethod,
        base_rating: input.baseRating ?? null,
      })
      .select(VARIANT_PROPOSAL_COLUMNS)
      .single();
    if (error) throw error;
    return data as VariantProposal;
  }

  async findActiveByPlan(planId: string): Promise<VariantProposal[]> {
    const { data, error } = await this.client
      .from('variant_proposals')
      .select(VARIANT_PROPOSAL_COLUMNS)
      .eq('plan_id', planId)
      .is('confirmed_at', null)
      .is('rejected_at', null);
    if (error) throw error;
    return (data ?? []) as VariantProposal[];
  }

  async confirm(proposalId: string, householdId: string): Promise<void> {
    const { data, error } = await this.client
      .from('variant_proposals')
      .update({ confirmed_at: new Date().toISOString() })
      .eq('id', proposalId)
      .eq('household_id', householdId)
      .is('confirmed_at', null)
      .is('rejected_at', null)
      .select('id');
    if (error) throw error;
    if ((data ?? []).length === 0) {
      throw new Error(`variant_proposal ${proposalId} not found or already resolved`);
    }
  }

  async reject(proposalId: string, householdId: string): Promise<void> {
    const { data, error } = await this.client
      .from('variant_proposals')
      .update({ rejected_at: new Date().toISOString() })
      .eq('id', proposalId)
      .eq('household_id', householdId)
      .is('confirmed_at', null)
      .is('rejected_at', null)
      .select('id');
    if (error) throw error;
    if ((data ?? []).length === 0) {
      throw new Error(`variant_proposal ${proposalId} not found or already resolved`);
    }
  }

  // Story 3-DM-C1 Phase 6 — tree-shape create. Writes plan_slot_variation_id
  // instead of plan_item_id. Runtime-usable only after Phase 9 applies the
  // migration; Vitest-mockable today for the tree-shape consumer (Service
  // layer) to call against.
  async createTree(input: CreateVariantProposalTreeInput): Promise<VariantProposal> {
    const { data, error } = await this.client
      .from('variant_proposals')
      .insert({
        household_id: input.householdId,
        child_id: input.childId,
        plan_slot_variation_id: input.planSlotVariationId,
        plan_id: input.planId,
        base_recipe_name: input.baseRecipeName,
        base_method: input.baseMethod,
        variant_description: input.variantDescription,
        variant_method: input.variantMethod,
        base_rating: input.baseRating ?? null,
      })
      .select(VARIANT_PROPOSAL_TREE_COLUMNS)
      .single();
    if (error) throw error;
    // Story 3-DM-C1 Phase 6 — legacy VariantProposal type carries plan_item_id;
    // tree-shape row carries plan_slot_variation_id. Phase 9 narrows the
    // type definition; cast via unknown for now.
    return data as unknown as VariantProposal;
  }
}

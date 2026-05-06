import type { SchoolPolicy, SlotScope } from '@hivekitchen/types';
import { BaseRepository } from '../../repository/base.repository.js';

const POLICY_COLUMNS =
  'id, child_id, policy_type, policy_description, slot_scope, is_active, created_at, updated_at';

export interface UpsertPolicyParams {
  childId: string;
  policyType: string;
  policyDescription: string | null;
  slotScope: SlotScope;
  isActive: boolean;
}

// Story 3.16 — repository for the school_policies table.
// Upsert is keyed on (child_id, policy_type) — that unique index is created
// by the same migration that creates the table.
export class SchoolPoliciesRepository extends BaseRepository {
  async upsertPolicy(params: UpsertPolicyParams): Promise<SchoolPolicy> {
    const { data, error } = await this.client
      .from('school_policies')
      .upsert(
        {
          child_id: params.childId,
          policy_type: params.policyType,
          policy_description: params.policyDescription,
          slot_scope: params.slotScope,
          is_active: params.isActive,
        },
        { onConflict: 'child_id,policy_type' },
      )
      .select(POLICY_COLUMNS)
      .single();
    if (error) throw error;
    return data as SchoolPolicy;
  }

  async findActiveByChildId(childId: string): Promise<SchoolPolicy[]> {
    const { data, error } = await this.client
      .from('school_policies')
      .select(POLICY_COLUMNS)
      .eq('child_id', childId)
      .eq('is_active', true)
      .order('policy_type', { ascending: true });
    if (error) throw error;
    return (data ?? []) as SchoolPolicy[];
  }
}

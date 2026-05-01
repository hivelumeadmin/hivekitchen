import { BaseRepository } from '../../repository/base.repository.js';
import type { AllergyRule } from './allergy-rules.engine.js';

const RULE_COLUMNS = 'id, household_id, child_id, allergen, rule_type';

export interface WriteDecisionInput {
  plan_id?: string;
  household_id: string;
  verdict: string;
  guardrail_version: string;
  conflicts: unknown[];
  request_id: string;
}

export class AllergyGuardrailRepository extends BaseRepository {
  async getRulesForHousehold(householdId: string): Promise<AllergyRule[]> {
    const { data, error } = await this.client
      .from('allergy_rules')
      .select(RULE_COLUMNS)
      .or(`household_id.eq.${householdId},household_id.is.null`);
    if (error) throw error;
    return (data ?? []) as AllergyRule[];
  }

  async writeDecision(input: WriteDecisionInput): Promise<void> {
    const { error } = await this.client.from('guardrail_decisions').insert({
      plan_id: input.plan_id ?? null,
      household_id: input.household_id,
      verdict: input.verdict,
      guardrail_version: input.guardrail_version,
      conflicts: input.conflicts,
      request_id: input.request_id,
    });
    if (error) throw error;
  }
}

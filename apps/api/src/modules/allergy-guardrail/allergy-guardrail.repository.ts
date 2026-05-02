import { z } from 'zod';
import { BaseRepository } from '../../repository/base.repository.js';
import type { AllergyRule } from './allergy-rules.engine.js';

const RULE_COLUMNS = 'id, household_id, child_id, allergen, rule_type';

const UuidSchema = z.string().uuid();

export type GuardrailVerdict = 'cleared' | 'blocked' | 'uncertain';

export interface WriteDecisionInput {
  plan_id?: string;
  household_id: string;
  verdict: GuardrailVerdict;
  guardrail_version: string;
  conflicts: unknown[];
  request_id: string;
}

export class AllergyGuardrailRepository extends BaseRepository {
  async getRulesForHousehold(householdId: string): Promise<AllergyRule[]> {
    // Defense-in-depth: validate UUID shape before interpolation into the PostgREST
    // .or() filter. Even though all upstream callers should already Zod-parse, the
    // repository is the last line before the query string is built — accept untrusted
    // input as the threat model and fail loudly here.
    UuidSchema.parse(householdId);

    // Two parameterized queries unioned in JS rather than `.or()` interpolation. This
    // avoids any risk of breaking out of the PostgREST filter via a crafted household_id.
    const [household, falcpa] = await Promise.all([
      this.client.from('allergy_rules').select(RULE_COLUMNS).eq('household_id', householdId),
      this.client.from('allergy_rules').select(RULE_COLUMNS).is('household_id', null),
    ]);

    if (household.error) throw household.error;
    if (falcpa.error) throw falcpa.error;

    return [...(household.data ?? []), ...(falcpa.data ?? [])] as AllergyRule[];
  }

  async writeDecision(input: WriteDecisionInput): Promise<void> {
    UuidSchema.parse(input.household_id);
    UuidSchema.parse(input.request_id);

    // ON CONFLICT DO NOTHING via Supabase's upsert with ignoreDuplicates: a retry of the
    // same request_id (network glitch, caller-side retry loop) is idempotent. The
    // unique index on (household_id, request_id) is created in the migration.
    const { error } = await this.client
      .from('guardrail_decisions')
      .upsert(
        {
          plan_id: input.plan_id ?? null,
          household_id: input.household_id,
          verdict: input.verdict,
          guardrail_version: input.guardrail_version,
          conflicts: input.conflicts,
          request_id: input.request_id,
        },
        { onConflict: 'household_id,request_id', ignoreDuplicates: true },
      );
    if (error) throw error;
  }
}

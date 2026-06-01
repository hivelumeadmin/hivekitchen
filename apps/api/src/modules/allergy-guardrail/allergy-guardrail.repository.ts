import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { BaseRepository } from '../../repository/base.repository.js';
import { HouseholdAllergensRepository } from '../households/household-allergens.repository.js';
import type { AllergyRule } from './allergy-rules.engine.js';

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

// Thrown when one or more allergen cells cannot be decrypted. The service
// layer catches this and returns verdict='uncertain' so the plan is never
// silently cleared when allergen data is unreadable.
export class AllergyGuardrailDecryptError extends Error {
  constructor(householdId: string) {
    super(`allergen data decrypt failed for household ${householdId} — evaluation cannot proceed safely`);
    this.name = 'AllergyGuardrailDecryptError';
  }
}

export class AllergyGuardrailRepository extends BaseRepository {
  // Story 3-DM-B2 — single-source allergen read. `household_allergens` now
  // holds both household-wide rules (child_id=NULL) and per-child medical
  // attribution (child_id non-NULL). Both shapes flow through the guardrail
  // as `parent_declared` rules; child_id is preserved as-is so per-child
  // rules continue to scope to that child while household-wide rules apply
  // to every kid. FALCPA seeds still come from `allergen_tags`.
  private readonly householdAllergensRepo: HouseholdAllergensRepository;
  constructor(
    client: SupabaseClient,
    kek: Buffer | null = null,
    householdAllergensRepo?: HouseholdAllergensRepository,
  ) {
    super(client);
    this.householdAllergensRepo =
      householdAllergensRepo ?? new HouseholdAllergensRepository(client, kek);
  }

  async getRulesForHousehold(householdId: string): Promise<AllergyRule[]> {
    // Defense-in-depth: validate UUID shape before interpolation into the PostgREST
    // .or() filter. Even though all upstream callers should already Zod-parse, the
    // repository is the last line before the query string is built — accept untrusted
    // input as the threat model and fail loudly here.
    UuidSchema.parse(householdId);

    const falcpaRes = await this.client
      .from('allergen_tags')
      .select('key')
      .eq('rule_class', 'falcpa')
      .eq('is_active', true);
    if (falcpaRes.error) throw falcpaRes.error;

    const falcpa: AllergyRule[] = ((falcpaRes.data ?? []) as Array<{ key: string }>).map(
      (row) => ({
        id: row.key,
        household_id: null,
        child_id: null,
        allergen: row.key,
        rule_type: 'falcpa' as const,
      }),
    );

    let householdRows;
    try {
      householdRows = await this.householdAllergensRepo.findByHouseholdId(householdId);
    } catch {
      // Any decrypt failure inside the repo is treated as fail-closed: the
      // service surfaces verdict='uncertain' rather than silently clearing a
      // plan with unreadable allergen data.
      throw new AllergyGuardrailDecryptError(householdId);
    }

    if (householdRows.length === 0) return falcpa;

    // `id` is not load-bearing on parent_declared rules (the engine matches on
    // allergen text + child_id scoping); the legacy code path also omitted it
    // via an `as AllergyRule` cast. Preserve that contract here.
    const synthetic = householdRows.map((row) => ({
      household_id: householdId,
      child_id: row.child_id,
      allergen: row.allergen,
      rule_type: 'parent_declared',
    })) as AllergyRule[];

    return [...falcpa, ...synthetic];
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

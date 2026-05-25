import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { BaseRepository } from '../../repository/base.repository.js';
import { decryptField } from '../../lib/envelope-encryption.js';
import { getHouseholdDek } from '../../lib/household-key.js';
import { ChildAllergensRepository } from '../children/child-allergens.repository.js';
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
  // Slice 2-s27 — KEK is required so the repository can derive the household
  // DEK and decrypt parent-declared allergens stored on households.
  // Slice 2.6-s8 — per-child allergens now come from ChildAllergensRepository
  // (structured `child_allergens` table). The legacy per-child decrypt block
  // is gone. KEK is still needed for the household-wide read of
  // `households.declared_allergens` (unchanged).
  private readonly childAllergensRepo: ChildAllergensRepository;
  constructor(
    client: SupabaseClient,
    private readonly kek: Buffer | null = null,
    childAllergensRepo?: ChildAllergensRepository,
  ) {
    super(client);
    // Default: construct one from the same client + KEK. Tests can inject a
    // stub to drive findByHousehold without going through PostgREST.
    this.childAllergensRepo = childAllergensRepo ?? new ChildAllergensRepository(client, kek);
  }

  async getRulesForHousehold(householdId: string): Promise<AllergyRule[]> {
    // Defense-in-depth: validate UUID shape before interpolation into the PostgREST
    // .or() filter. Even though all upstream callers should already Zod-parse, the
    // repository is the last line before the query string is built — accept untrusted
    // input as the threat model and fail loudly here.
    UuidSchema.parse(householdId);

    // Slice 2.6-s7 — FALCPA seeds come from `allergen_tags`
    // (rule_class='falcpa', is_active=true).
    // Slice 2.6-s8 — per-child parent_declared rules come from
    // `child_allergens` via ChildAllergensRepository.findByHousehold.
    // Household-wide parent_declared rules continue to come from the encrypted
    // `households.declared_allergens` JSONB column (canonical store; no
    // structured table yet — see deferred-work.md).
    let childAllergenError: unknown = null;
    let perChildRows: Array<{ child_id: string; allergen: string }> = [];
    const [falcpaRes, householdRow] = await Promise.all([
      this.client
        .from('allergen_tags')
        .select('key')
        .eq('rule_class', 'falcpa')
        .eq('is_active', true),
      this.client
        .from('households')
        .select('declared_allergens')
        .eq('id', householdId)
        .maybeSingle(),
      this.childAllergensRepo
        .findByHousehold(householdId)
        .then((rows) => {
          perChildRows = rows;
        })
        .catch((err: unknown) => {
          childAllergenError = err;
        }),
    ]);

    if (falcpaRes.error) throw falcpaRes.error;
    if (householdRow.error) throw householdRow.error;

    const falcpa: AllergyRule[] = ((falcpaRes.data ?? []) as Array<{ key: string }>).map(
      (row) => ({
        id: row.key,
        household_id: null,
        child_id: null,
        allergen: row.key,
        rule_type: 'falcpa' as const,
      }),
    );

    // Fail-closed on per-child decrypt failures: if any cell could not be
    // decrypted, propagate AllergyGuardrailDecryptError so the service
    // surfaces verdict='uncertain' (matches the legacy per-child path's
    // semantics — never silently clear a plan when allergen data is
    // unreadable).
    if (childAllergenError !== null) {
      throw new AllergyGuardrailDecryptError(householdId);
    }

    const householdStored =
      (householdRow.data as { declared_allergens: string | null } | null)?.declared_allergens ??
      null;

    // Short-circuit: nothing declared anywhere → just the FALCPA seed.
    if (householdStored === null && perChildRows.length === 0) {
      return falcpa;
    }

    const synthetic: AllergyRule[] = [];
    let householdDecryptFailed = false;

    if (householdStored !== null) {
      const dek = await getHouseholdDek(this.client, this.kek, householdId);
      const onDecryptError = (): void => {
        householdDecryptFailed = true;
      };
      for (const allergen of decryptArray(householdStored, dek, onDecryptError)) {
        synthetic.push({
          household_id: householdId,
          child_id: null,
          allergen,
          rule_type: 'parent_declared',
        } as AllergyRule);
      }
    }

    for (const row of perChildRows) {
      synthetic.push({
        household_id: householdId,
        child_id: row.child_id,
        allergen: row.allergen,
        rule_type: 'parent_declared',
      } as AllergyRule);
    }

    if (householdDecryptFailed) {
      throw new AllergyGuardrailDecryptError(householdId);
    }

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

// Slice 2-s27 — decrypt one allergen cell. On failure, calls onError() so
// the caller can track whether any cell in the batch failed and throw
// AllergyGuardrailDecryptError after assembly — producing verdict='uncertain'
// rather than silently clearing a plan that may contain a declared allergen.
function decryptArray(stored: string, dek: Buffer | null, onError: () => void): string[] {
  try {
    return decryptField<string[]>(stored, dek);
  } catch {
    onError();
    return [];
  }
}

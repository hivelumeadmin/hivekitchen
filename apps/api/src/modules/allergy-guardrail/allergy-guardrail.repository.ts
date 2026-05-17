import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { BaseRepository } from '../../repository/base.repository.js';
import { decryptField } from '../../lib/envelope-encryption.js';
import { getHouseholdDek } from '../../lib/household-key.js';
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
  // DEK and decrypt parent-declared allergens stored on households / children.
  // Null is accepted (NODE_ENV=dev with no master key configured); NOOP-
  // prefixed cells decrypt without the DEK and AES cells throw, which is the
  // intended behaviour.
  constructor(
    client: SupabaseClient,
    private readonly kek: Buffer | null = null,
  ) {
    super(client);
  }

  async getRulesForHousehold(householdId: string): Promise<AllergyRule[]> {
    // Defense-in-depth: validate UUID shape before interpolation into the PostgREST
    // .or() filter. Even though all upstream callers should already Zod-parse, the
    // repository is the last line before the query string is built — accept untrusted
    // input as the threat model and fail loudly here.
    UuidSchema.parse(householdId);

    // Slice 2-s27 — rule assembly is now: FALCPA seed (allergy_rules table,
    // household_id IS NULL) UNION synthetic household-scoped rules derived
    // from households.declared_allergens UNION synthetic per-child rules
    // derived from children[i].declared_allergens. The `allergy_rules` table
    // is no longer the source-of-truth for parent_declared rules; the
    // household / children encrypted columns are. We still read the table
    // for the FALCPA reference rows.
    const [falcpaRes, householdRow, childRows] = await Promise.all([
      this.client.from('allergy_rules').select(RULE_COLUMNS).is('household_id', null),
      this.client
        .from('households')
        .select('declared_allergens')
        .eq('id', householdId)
        .maybeSingle(),
      this.client
        .from('children')
        .select('id, declared_allergens')
        .eq('household_id', householdId),
    ]);

    if (falcpaRes.error) throw falcpaRes.error;
    if (householdRow.error) throw householdRow.error;
    if (childRows.error) throw childRows.error;

    const falcpa = (falcpaRes.data ?? []) as AllergyRule[];

    // Short-circuit: if neither household nor any child has encrypted
    // allergens, we don't need the DEK at all.
    const householdStored =
      (householdRow.data as { declared_allergens: string | null } | null)?.declared_allergens ??
      null;
    const childStoredRows = (childRows.data ?? []) as Array<{
      id: string;
      declared_allergens: string | null;
    }>;
    const anyChildHasAllergens = childStoredRows.some((r) => r.declared_allergens !== null);
    if (householdStored === null && !anyChildHasAllergens) {
      return falcpa;
    }

    const dek = await getHouseholdDek(this.client, this.kek, householdId);
    const synthetic: AllergyRule[] = [];
    let decryptFailed = false;
    const onDecryptError = (): void => {
      decryptFailed = true;
    };

    if (householdStored !== null) {
      for (const allergen of decryptArray(householdStored, dek, onDecryptError)) {
        synthetic.push({
          household_id: householdId,
          child_id: null,
          allergen,
          rule_type: 'parent_declared',
        } as AllergyRule);
      }
    }

    for (const row of childStoredRows) {
      if (row.declared_allergens === null) continue;
      for (const allergen of decryptArray(row.declared_allergens, dek, onDecryptError)) {
        synthetic.push({
          household_id: householdId,
          child_id: row.id,
          allergen,
          rule_type: 'parent_declared',
        } as AllergyRule);
      }
    }

    if (decryptFailed) {
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

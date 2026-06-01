import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptField, encryptField, normalizedHash } from '../../lib/envelope-encryption.js';
import { getHouseholdDek, getOrCreateHouseholdDek } from '../../lib/household-key.js';

// Story 3-DM-B2 — single-source store for household-shared allergens.
// Absorbs the prior child_allergens table + households.declared_allergens
// encrypted JSONB column. `child_id` is nullable: NULL = household-wide rule;
// non-NULL = parent-attributed to a specific kid as metadata only (the
// guardrail treats every row the same — kitchen-shared constraint).

export interface HouseholdAllergenRow {
  household_id: string;
  child_id: string | null;
  allergen: string;
  source: string;
}

export class HouseholdAllergensRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly kek: Buffer | null,
  ) {}

  /**
   * Idempotent declare. NEVER overwrites an existing row's `source` —
   * re-declarations are conflict-skipped so the original audit provenance is
   * preserved (matches the 2.6-s8 pattern previously in
   * ChildAllergensRepository.declareIfNew).
   *
   * `childId === null` → household-wide row; `childId !== null` → per-child
   * attribution metadata. The COALESCE-sentinel UNIQUE index treats NULL as a
   * distinct value, so the two scopes don't collide on the same allergen.
   */
  async declareIfNew(params: {
    household_id: string;
    child_id: string | null;
    allergen: string;
    source: string;
  }): Promise<{ inserted: boolean }> {
    const dek = await getOrCreateHouseholdDek(this.client, this.kek, params.household_id);
    const ciphertext = encryptField(params.allergen, dek);
    const hash = normalizedHash(params.allergen);

    const { data, error } = await this.client
      .from('household_allergens')
      .upsert(
        {
          household_id: params.household_id,
          child_id: params.child_id,
          allergen: ciphertext,
          allergen_hash: hash,
          source: params.source,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'household_allergens_scope_hash_uniq',
          ignoreDuplicates: true,
        },
      )
      .select('id')
      .maybeSingle();

    if (error !== null && error !== undefined) {
      throw new Error(`household_allergens.declareIfNew: ${error.message}`);
    }
    return { inserted: data !== null };
  }

  /**
   * Read every allergen row for a household. Returns BOTH household-wide
   * (`child_id=null`) and per-child rows. Each `allergen` cell is decrypted
   * under the household DEK. Throws on any decrypt failure — the guardrail
   * caller catches and surfaces verdict='uncertain' (never silently clear).
   */
  async findByHouseholdId(householdId: string): Promise<HouseholdAllergenRow[]> {
    const { data, error } = await this.client
      .from('household_allergens')
      .select('household_id, child_id, allergen, source')
      .eq('household_id', householdId);
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      household_id: string;
      child_id: string | null;
      allergen: string;
      source: string;
    }>;
    if (rows.length === 0) return [];
    const dek = await getHouseholdDek(this.client, this.kek, householdId);
    return rows.map((row) => ({
      household_id: row.household_id,
      child_id: row.child_id,
      allergen: decryptField<string>(row.allergen, dek),
      source: row.source,
    }));
  }

  /**
   * Per-child convenience: filter the household read to a single child_id.
   * Used by ChildrenRepository to overlay declared_allergens onto child
   * profile reads. Household-wide rows (child_id=null) are intentionally
   * excluded — callers wanting the union read findByHouseholdId.
   */
  async findByHouseholdAndChild(
    householdId: string,
    childId: string,
  ): Promise<string[]> {
    const all = await this.findByHouseholdId(householdId);
    return all.filter((r) => r.child_id === childId).map((r) => r.allergen);
  }

  /**
   * Wipe per-child rows for a specific child. Household-wide rows (child_id
   * NULL) are intentionally left alone. Used by ChildrenRepository.updateProfile
   * to implement replace-semantics on a child's allergen list without
   * clobbering the household-shared kitchen rules.
   */
  async deleteByChild(householdId: string, childId: string): Promise<void> {
    const { error } = await this.client
      .from('household_allergens')
      .delete()
      .eq('household_id', householdId)
      .eq('child_id', childId);
    if (error) throw error;
  }
}

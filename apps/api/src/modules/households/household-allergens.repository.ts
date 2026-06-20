import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptField, encryptField, normalizedHash } from '../../lib/envelope-encryption.js';
import { getHouseholdDek, getOrCreateHouseholdDek } from '../../lib/household-key.js';

// The unique index on household_allergens uses COALESCE(child_id, sentinel),
// which is a functional expression. Supabase upsert's onConflict can fail with
// 42P10 when Postgres cannot infer the functional index from plain column names.
// Same pattern as dietary-preferences.repository.ts.
const UNIQUE_VIOLATION_CODE = '23505';
const NO_UNIQUE_CONSTRAINT_CODE = '42P10';

function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

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

    // Primary path: column-name conflict target. Postgres resolves this against
    // the functional unique index on some PostgREST versions; will fail with
    // 42P10 where it cannot (COALESCE sentinel not inferrable from column names).
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
          onConflict: 'household_id,child_id,allergen_hash',
          ignoreDuplicates: true,
        },
      )
      .select('id')
      .maybeSingle();

    if (error === null || error === undefined) {
      const inserted = data !== null;
      if (inserted) void this.bumpKitchenMapVersion(params.household_id);
      return { inserted };
    }

    if (pgErrorCode(error) !== NO_UNIQUE_CONSTRAINT_CODE) {
      throw new Error(`household_allergens.declareIfNew: ${error.message}`);
    }

    // Fallback: insert directly; treat 23505 unique violation as "already exists".
    return this.declareViaInsertFallback(params, ciphertext, hash);
  }

  private async declareViaInsertFallback(
    params: { household_id: string; child_id: string | null; source: string },
    ciphertext: string,
    hash: string,
  ): Promise<{ inserted: boolean }> {
    const { error: insertErr } = await this.client
      .from('household_allergens')
      .insert({
        household_id: params.household_id,
        child_id: params.child_id,
        allergen: ciphertext,
        allergen_hash: hash,
        source: params.source,
      });

    if (insertErr === null || insertErr === undefined) {
      void this.bumpKitchenMapVersion(params.household_id);
      return { inserted: true };
    }
    if (pgErrorCode(insertErr) !== UNIQUE_VIOLATION_CODE) {
      throw new Error(`household_allergens.declareIfNew: ${insertErr.message}`);
    }
    return { inserted: false };
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
   * Story 7-S14 — remove exactly one per-child allergen, identified by value.
   * The allergen string is hashed (same normalization as declareIfNew) and the
   * row pinned by (household_id, child_id, allergen_hash). household_id +
   * child_id scope is defense-in-depth (a cross-household or wrong-child value
   * matches nothing). Returns true when a row was deleted (→ 200), false when
   * nothing matched (→ 404). The DB trigger bumps kitchen_map_version; the
   * explicit bump here is belt-and-suspenders.
   *
   * Unlike deleteByChild (which wipes ALL of a child's rows), this deletes the
   * single matching row only.
   */
  async deleteOneByAllergen(
    householdId: string,
    childId: string,
    allergen: string,
  ): Promise<boolean> {
    const hash = normalizedHash(allergen);
    const { data, error } = await this.client
      .from('household_allergens')
      .delete()
      .eq('household_id', householdId)
      .eq('child_id', childId)
      .eq('allergen_hash', hash)
      .select('id');
    if (error) throw error;
    const deleted = ((data ?? []) as Array<{ id: string }>).length > 0;
    if (deleted) void this.bumpKitchenMapVersion(householdId);
    return deleted;
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
    void this.bumpKitchenMapVersion(householdId);
  }

  // Belt-and-suspenders alongside migration 20261008000200's DB trigger.
  // Bumps kitchen_map_version so the Redis cache key rotates immediately on
  // any insert or delete — prevents stale allergens from showing in the panel.
  // Non-fatal: swallowed so a Supabase hiccup never breaks the write path.
  private async bumpKitchenMapVersion(householdId: string): Promise<void> {
    try {
      await this.client.rpc('bump_kitchen_map_version_for_household', {
        p_household_id: householdId,
      });
    } catch {
      // non-fatal
    }
  }
}

import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptField, encryptField, normalizedHash } from '../../lib/envelope-encryption.js';
import { getHouseholdDek, getOrCreateHouseholdDek } from '../../lib/household-key.js';

// Slice 2.5-s6 — Structured per-child allergen writes.
// Slice 2.6-s8 — Now also the canonical read source for per-child allergens
// (guardrail + kitchen-map composer + REST children responses). The legacy
// `children.declared_allergens` JSONB column is written as `encryptField([])`
// for column-shape parity and is no longer read by any safety-critical code.
// `allergen` is AES-256-GCM ciphertext under the household DEK; `allergen_hash`
// is SHA-256(lower(trim(plaintext))) and acts as the (child_id, allergen_hash)
// idempotency key.

export class ChildAllergensRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly kek: Buffer | null,
  ) {}

  /**
   * Slice 2.6-s8 — idempotent declare that NEVER overwrites an existing row's
   * `source`. Used by ChildrenRepository.insert / updateProfile to fan an
   * inbound declared_allergens array into structured rows without clobbering
   * audit provenance on re-mentions (the agent flow calls child.upsert
   * multiple times per onboarding turn — re-declaring 'peanut' shouldn't
   * downgrade its original 'onboarding_declared' source to 'parent_edited').
   *
   * Returns { inserted: true } on first declaration, { inserted: false } on
   * conflict-skip. The conflict path keeps the original row intact.
   */
  async declareIfNew(
    householdId: string,
    childId: string,
    allergen: string,
    source: string,
  ): Promise<{ inserted: boolean }> {
    const dek = await getOrCreateHouseholdDek(this.client, this.kek, householdId);
    const ciphertext = encryptField(allergen, dek);
    const hash = normalizedHash(allergen);

    const { data, error } = await this.client
      .from('child_allergens')
      .upsert(
        {
          household_id: householdId,
          child_id: childId,
          allergen: ciphertext,
          allergen_hash: hash,
          source,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'child_id,allergen_hash', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle();

    if (error !== null && error !== undefined) {
      throw new Error(`child_allergens.declareIfNew: ${error.message}`);
    }
    return { inserted: data !== null };
  }

  /**
   * Slice 2.6-s8 — read every per-child allergen row for a household and
   * decrypt each `allergen` cell under the household DEK. The guardrail
   * repository fans these into `parent_declared` AllergyRules; the children
   * repository groups them by `child_id` to populate the GET-side response
   * shape. Throws on any decrypt failure — the caller decides whether to
   * fail-closed (guardrail) or skip-and-log (kitchen-map projection).
   */
  async findByHousehold(
    householdId: string,
  ): Promise<Array<{ child_id: string; allergen: string }>> {
    const { data, error } = await this.client
      .from('child_allergens')
      .select('child_id, allergen')
      .eq('household_id', householdId);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ child_id: string; allergen: string }>;
    if (rows.length === 0) return [];
    const dek = await getHouseholdDek(this.client, this.kek, householdId);
    return rows.map((row) => ({
      child_id: row.child_id,
      allergen: decryptField<string>(row.allergen, dek),
    }));
  }

  async deleteByChild(householdId: string, childId: string): Promise<void> {
    const { error } = await this.client
      .from('child_allergens')
      .delete()
      .eq('household_id', householdId)
      .eq('child_id', childId);
    if (error) throw error;
  }

  async declare(
    householdId: string,
    childId: string,
    allergen: string,
    source: string,
  ): Promise<{ child_allergen_id: string; was_existing: boolean }> {
    const dek = await getOrCreateHouseholdDek(this.client, this.kek, householdId);
    const ciphertext = encryptField(allergen, dek);
    const hash = normalizedHash(allergen);

    const { data, error } = await this.client
      .from('child_allergens')
      .upsert(
        {
          household_id: householdId,
          child_id: childId,
          allergen: ciphertext,
          allergen_hash: hash,
          source,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'child_id,allergen_hash', ignoreDuplicates: false },
      )
      .select('id, created_at, updated_at')
      .maybeSingle();

    if (error !== null && error !== undefined) {
      throw new Error(`child_allergens.declare: ${error.message}`);
    }
    if (data === null) {
      throw new Error(`child_allergens.declare: no row returned for child ${childId}`);
    }
    const row = data as { id: string; created_at: string; updated_at: string };

    // was_existing heuristic: on first insert created_at ≈ updated_at; on
    // conflict-update we explicitly bump updated_at so the timestamps diverge
    // by ≥1ms. A >1s gap is treated as "the row already existed."
    const was_existing =
      Math.abs(new Date(row.updated_at).getTime() - new Date(row.created_at).getTime()) > 1000;

    return { child_allergen_id: row.id, was_existing };
  }
}

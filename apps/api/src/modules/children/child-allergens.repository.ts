import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptField, normalizedHash } from '../../lib/envelope-encryption.js';
import { getOrCreateHouseholdDek } from '../../lib/household-key.js';

// Slice 2.5-s6 — Structured per-child allergen writes.
// Replaces the legacy children.declared_allergens JSONB column for new writes
// (the legacy column remains the read source for the kitchen-map projection
// until the cutover in a later slice). `allergen` is AES-256-GCM ciphertext
// under the household DEK; `allergen_hash` is SHA-256(lower(trim(plaintext)))
// and acts as the (child_id, allergen_hash) idempotency key.

export class ChildAllergensRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly kek: Buffer | null,
  ) {}

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

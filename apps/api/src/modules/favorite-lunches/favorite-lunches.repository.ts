import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptField, normalizedHash } from '../../lib/envelope-encryption.js';
import { getOrCreateHouseholdDek } from '../../lib/household-key.js';

// Slice 2.5-s9 — Household-scoped cold-start seed for plan generation (FR124).
// `item` is AES-256-GCM ciphertext under the household DEK; `item_hash` is
// SHA-256(lower(trim(plaintext))) for idempotency. Unique index is the plain
// composite (household_id, item_hash), so no 42P10 functional-index fallback
// is needed (unlike FoodPreferencesRepository).

const PROVENANCE_ONBOARDING_SEED = 'onboarding_seed';

export class FavoriteLunchesRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly kek: Buffer | null,
  ) {}

  async add(
    householdId: string,
    item: string,
    position?: number,
  ): Promise<{ id: string; position: number }> {
    const dek = await getOrCreateHouseholdDek(this.client, this.kek, householdId);
    const ciphertext = encryptField(item, dek);
    const item_hash = normalizedHash(item);

    let resolvedPosition: number;
    if (position === undefined) {
      const { data: maxRow, error: maxErr } = await this.client
        .from('favorite_lunches')
        .select('position')
        .eq('household_id', householdId)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (maxErr !== null && maxErr !== undefined) {
        throw new Error(
          `favorite_lunches.add: ${(maxErr as { message?: string }).message ?? 'unknown error'}`,
        );
      }
      resolvedPosition =
        maxRow !== null && maxRow !== undefined
          ? (maxRow as { position: number }).position + 1
          : 0;
    } else {
      resolvedPosition = position;
    }

    const { data, error } = await this.client
      .from('favorite_lunches')
      .upsert(
        {
          household_id: householdId,
          item: ciphertext,
          item_hash,
          provenance: PROVENANCE_ONBOARDING_SEED,
          position: resolvedPosition,
        },
        { onConflict: 'household_id,item_hash', ignoreDuplicates: true },
      )
      .select('id, position')
      .maybeSingle();

    if (error !== null && error !== undefined) {
      throw new Error(
        `favorite_lunches.add: ${(error as { message?: string }).message ?? 'unknown error'}`,
      );
    }

    if (data !== null && data !== undefined) {
      const row = data as { id: string; position: number };
      return { id: row.id, position: row.position };
    }

    // Conflict path (ignoreDuplicates returned no row) — fetch the existing row.
    const { data: existing, error: selectErr } = await this.client
      .from('favorite_lunches')
      .select('id, position')
      .eq('household_id', householdId)
      .eq('item_hash', item_hash)
      .single();

    if (selectErr !== null && selectErr !== undefined) {
      throw new Error(
        `favorite_lunches.add: ${(selectErr as { message?: string }).message ?? 'unknown error'}`,
      );
    }
    if (existing === null || existing === undefined) {
      throw new Error('favorite_lunches.add: conflict claimed but no row found');
    }
    const row = existing as { id: string; position: number };
    return { id: row.id, position: row.position };
  }
}

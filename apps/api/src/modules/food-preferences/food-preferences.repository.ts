import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptField, normalizedHash } from '../../lib/envelope-encryption.js';
import { getOrCreateHouseholdDek } from '../../lib/household-key.js';

// Slice 2.5-s7 — Encrypted per-child OR household-scoped food preferences.
// `item` is AES-256-GCM ciphertext under the household DEK; `item_hash` is
// SHA-256(lower(trim(plaintext))) for idempotency. Mirrors the
// DietaryPreferencesRepository 42P10 fallback pattern (functional unique
// index on COALESCE(child_id, sentinel)).

const UNIQUE_VIOLATION_CODE = '23505';
const NO_UNIQUE_CONSTRAINT_CODE = '42P10';

function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export type FoodValence = 'loves' | 'likes' | 'neutral' | 'dislikes' | 'refuses';

export class FoodPreferencesRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly kek: Buffer | null,
  ) {}

  async declare(
    householdId: string,
    childId: string | null,
    item: string,
    valence: FoodValence,
    enforcement: string,
    source: string,
  ): Promise<{ food_preference_id: string; was_existing: boolean }> {
    const dek = await getOrCreateHouseholdDek(this.client, this.kek, householdId);
    const ciphertext = encryptField(item, dek);
    const item_hash = normalizedHash(item);

    const { data, error } = await this.client
      .from('food_preferences')
      .upsert(
        {
          household_id: householdId,
          child_id: childId,
          item: ciphertext,
          item_hash,
          valence,
          enforcement,
          source,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'household_id,child_id,item_hash',
          ignoreDuplicates: false,
        },
      )
      .select('id, created_at, updated_at')
      .maybeSingle();

    if (error === null || error === undefined) {
      if (data === null) {
        throw new Error('food_preferences.declare: no row returned');
      }
      const row = data as { id: string; created_at: string; updated_at: string };
      const was_existing =
        Math.abs(new Date(row.updated_at).getTime() - new Date(row.created_at).getTime()) > 1000;
      return { food_preference_id: row.id, was_existing };
    }

    if (pgErrorCode(error) !== NO_UNIQUE_CONSTRAINT_CODE) {
      throw new Error(
        `food_preferences.declare: ${(error as { message?: string }).message ?? 'unknown error'}`,
      );
    }
    return this.declareViaInsertFallback(
      householdId,
      childId,
      ciphertext,
      item_hash,
      valence,
      enforcement,
      source,
    );
  }

  private async declareViaInsertFallback(
    householdId: string,
    childId: string | null,
    ciphertext: string,
    item_hash: string,
    valence: string,
    enforcement: string,
    source: string,
  ): Promise<{ food_preference_id: string; was_existing: boolean }> {
    const { data: inserted, error: insertErr } = await this.client
      .from('food_preferences')
      .insert({
        household_id: householdId,
        child_id: childId,
        item: ciphertext,
        item_hash,
        valence,
        enforcement,
        source,
      })
      .select('id')
      .maybeSingle();

    if (insertErr === null || insertErr === undefined) {
      if (inserted === null) {
        throw new Error('food_preferences.declare: insert returned no row');
      }
      return {
        food_preference_id: (inserted as { id: string }).id,
        was_existing: false,
      };
    }

    if (pgErrorCode(insertErr) !== UNIQUE_VIOLATION_CODE) {
      throw new Error(
        `food_preferences.declare: ${(insertErr as { message?: string }).message ?? 'unknown error'}`,
      );
    }

    // 23505: scope+item_hash already exists — select it. Household-scoped rows
    // (child_id = NULL) compare against the sentinel UUID in the functional
    // index; .is('child_id', null) is the correct DB-level filter.
    let selectQuery = this.client
      .from('food_preferences')
      .select('id')
      .eq('household_id', householdId)
      .eq('item_hash', item_hash);
    selectQuery = childId === null
      ? selectQuery.is('child_id', null)
      : selectQuery.eq('child_id', childId);
    const { data: existing, error: selectErr } = await selectQuery.maybeSingle();

    if (selectErr !== null && selectErr !== undefined) {
      throw new Error(
        `food_preferences.declare: ${(selectErr as { message?: string }).message ?? 'unknown error'}`,
      );
    }
    if (existing === null) {
      throw new Error('food_preferences.declare: conflict claimed but no row found');
    }
    const existingId = (existing as { id: string }).id;

    // Refresh mutable fields so a re-declare with stronger valence/enforcement
    // is reflected (parent says "loves" then "refuses" → store the latest).
    await this.client
      .from('food_preferences')
      .update({ valence, enforcement, source, updated_at: new Date().toISOString() })
      .eq('id', existingId);

    return { food_preference_id: existingId, was_existing: true };
  }
}


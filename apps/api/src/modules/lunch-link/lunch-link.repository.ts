import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from '../../repository/base.repository.js';

export interface LunchLinkSessionRow {
  id: string;
  child_id: string;
  household_id: string;
  date: string; // YYYY-MM-DD
  nonce: string;
  exp: string | null;
  first_opened_at: string | null;
  rating: 'loved' | 'ok' | 'not-really' | null;
  rating_submitted_at: string | null;
  reopened_after_exp_count: number;
  suppressed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Slice 4-S2 — minimal repository for the dev-only Lunch Link surface.
// Avoids depending on ChildrenRepository (which requires a kek + RepositoryLogger
// for envelope-decryption of allergens/cultural_identifiers). The surface only
// needs the plaintext `name` column, so decryption machinery is unnecessary.
//
// Slice 4-S3 — extended with HMAC token + session + key methods.
export class LunchLinkRepository extends BaseRepository {
  constructor(client: SupabaseClient) {
    super(client);
  }

  async findChildName(childId: string, householdId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('children')
      .select('id, name')
      .eq('id', childId)
      .eq('household_id', householdId)
      .maybeSingle();
    if (error) throw error;
    return (data as { id: string; name: string } | null)?.name ?? null;
  }

  // Public endpoint: find child + household without an ownership check.
  // Returns null if the child UUID doesn't exist (caller maps to 404).
  async findChildPublic(
    childId: string,
  ): Promise<{ name: string; household_id: string } | null> {
    const { data, error } = await this.client
      .from('children')
      .select('name, household_id')
      .eq('id', childId)
      .maybeSingle();
    if (error) throw error;
    return data as { name: string; household_id: string } | null;
  }

  // Generate flow: get timezone for the household (plaintext column, no DEK).
  // Falls back to 'UTC' if the row is missing.
  async findHouseholdTimezone(householdId: string): Promise<string> {
    const { data, error } = await this.client
      .from('households')
      .select('timezone')
      .eq('id', householdId)
      .maybeSingle();
    if (error) throw error;
    return (data as { timezone: string } | null)?.timezone ?? 'UTC';
  }

  // ON CONFLICT (child_id, date): only the nonce + exp columns are updated;
  // first_opened_at / rating / suppression remain untouched because we omit
  // them from the upsert payload.
  async upsertSession(params: {
    childId: string;
    householdId: string;
    date: string;
    nonce: string;
    exp: string;
  }): Promise<LunchLinkSessionRow> {
    const { data, error } = await this.client
      .from('lunch_link_sessions')
      .upsert(
        {
          child_id: params.childId,
          household_id: params.householdId,
          date: params.date,
          nonce: params.nonce,
          exp: params.exp,
        },
        { onConflict: 'child_id,date' },
      )
      .select('*')
      .single();
    if (error) throw error;
    return data as LunchLinkSessionRow;
  }

  async findSession(childId: string, date: string): Promise<LunchLinkSessionRow | null> {
    const { data, error } = await this.client
      .from('lunch_link_sessions')
      .select('*')
      .eq('child_id', childId)
      .eq('date', date)
      .maybeSingle();
    if (error) throw error;
    return data as LunchLinkSessionRow | null;
  }

  // UPDATE only when first_opened_at IS NULL — idempotent on subsequent opens.
  async recordFirstOpen(childId: string, date: string): Promise<void> {
    const { error } = await this.client
      .from('lunch_link_sessions')
      .update({ first_opened_at: new Date().toISOString() })
      .eq('child_id', childId)
      .eq('date', date)
      .is('first_opened_at', null);
    if (error) throw error;
  }

  async incrementReopenedCount(childId: string, date: string): Promise<void> {
    const { error } = await this.client.rpc('increment_lunch_link_reopen_count', {
      p_child_id: childId,
      p_date: date,
    });
    if (error) throw error;
  }

  // Get-or-create a daily HMAC key. Concurrent generate() calls race on the
  // PRIMARY KEY constraint; the loser re-reads the winner's key.
  async findOrCreateHmacKey(keyDate: string): Promise<string> {
    const { data: existing, error: readErr } = await this.client
      .from('lunch_link_keys')
      .select('hmac_key')
      .eq('key_date', keyDate)
      .maybeSingle();
    if (readErr) throw readErr;
    if (existing) return (existing as { hmac_key: string }).hmac_key;

    const candidate = randomBytes(32).toString('hex');

    const { data: inserted, error: upsertErr } = await this.client
      .from('lunch_link_keys')
      .upsert(
        { key_date: keyDate, hmac_key: candidate },
        { onConflict: 'key_date', ignoreDuplicates: true },
      )
      .select('hmac_key')
      .maybeSingle();
    if (upsertErr) throw upsertErr;

    if (inserted !== null) return (inserted as { hmac_key: string }).hmac_key;

    // Race: another writer won — re-read the winner's key.
    const { data: winner, error: fetchErr } = await this.client
      .from('lunch_link_keys')
      .select('hmac_key')
      .eq('key_date', keyDate)
      .single();
    if (fetchErr) throw fetchErr;
    return (winner as { hmac_key: string }).hmac_key;
  }

  async findHmacKey(keyDate: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('lunch_link_keys')
      .select('hmac_key')
      .eq('key_date', keyDate)
      .maybeSingle();
    if (error) throw error;
    return (data as { hmac_key: string } | null)?.hmac_key ?? null;
  }

  // Slice 4-S4: write the child's rating. Overwrites any prior rating —
  // overwrite semantics are intentional; the child can change their mind
  // before 8pm.
  async setRating(
    childId: string,
    date: string,
    rating: 'loved' | 'ok' | 'not-really',
  ): Promise<void> {
    const { error } = await this.client
      .from('lunch_link_sessions')
      .update({
        rating,
        rating_submitted_at: new Date().toISOString(),
      })
      .eq('child_id', childId)
      .eq('date', date)
      .select('id')
      .single();
    if (error) throw error;
  }
}

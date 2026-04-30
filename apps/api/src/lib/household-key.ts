import type { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateDek, unwrapDek, wrapDek } from './envelope-encryption.js';

// Shared by ChildrenRepository (Story 2.10) and HouseholdsRepository
// (caregiver_relationships re-encryption in the same story). Encapsulates the
// "fetch encrypted_dek, unwrap with KEK" round-trip so both call sites stay
// consistent. KEK absent (dev/test NODE_ENV) → returns null and the caller
// falls through to the NOOP path in encryptField/decryptField.

export async function getHouseholdDek(
  client: SupabaseClient,
  kek: Buffer | null,
  householdId: string,
): Promise<Buffer | null> {
  if (kek === null) return null;
  const { data, error } = await client
    .from('households')
    .select('encrypted_dek')
    .eq('id', householdId)
    .maybeSingle();
  if (error) throw error;
  const encryptedDek = (data as { encrypted_dek: string | null } | null)?.encrypted_dek ?? null;
  if (encryptedDek === null) return null;
  return unwrapDek(encryptedDek, kek);
}

export async function getOrCreateHouseholdDek(
  client: SupabaseClient,
  kek: Buffer | null,
  householdId: string,
): Promise<Buffer | null> {
  if (kek === null) return null;
  const existing = await getHouseholdDek(client, kek, householdId);
  if (existing !== null) return existing;

  const dek = generateDek();
  const wrapped = wrapDek(dek, kek);
  // Conditional write: only update if encrypted_dek is still null.
  // Under concurrent requests both observing null, exactly one UPDATE wins;
  // the other affects 0 rows silently. Re-fetching below picks up whichever
  // DEK actually landed in the DB, so both callers encrypt under the same key.
  const { error } = await client
    .from('households')
    .update({ encrypted_dek: wrapped, updated_at: new Date().toISOString() })
    .eq('id', householdId)
    .is('encrypted_dek', null);
  if (error) throw error;

  // Always re-fetch — returns the winner's DEK regardless of which request won.
  // Also detects a missing householdId (UPDATE hit 0 rows → getHouseholdDek returns null).
  const settled = await getHouseholdDek(client, kek, householdId);
  if (settled === null) {
    throw new Error(`Failed to establish DEK for household ${householdId} — household may not exist`);
  }
  return settled;
}

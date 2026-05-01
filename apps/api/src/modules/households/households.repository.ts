import { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository } from '../../repository/base.repository.js';
import { decryptField, encryptField } from '../../lib/envelope-encryption.js';
import { getHouseholdDek, getOrCreateHouseholdDek } from '../../lib/household-key.js';

// Story 2.10 lazy-migration shape: pre-2.10 rows held jsonb that was cast to
// text by `ALTER COLUMN ... TYPE text USING caregiver_relationships::text`.
// Those rows look like raw JSON (e.g. `{"primary":"alice"}`) — no NOOP: prefix
// and not valid AES-GCM base64. Read MUST tolerate that shape until the next
// write re-encrypts the row. New writes always go through encryptField.

export class HouseholdsRepository extends BaseRepository {
  constructor(
    client: SupabaseClient,
    private readonly kek: Buffer | null,
  ) {
    super(client);
  }

  // TODO (Story 5.5): replace `unknown` with a Zod-validated type once the caregiver
  // relationship shape is finalised and this repository is wired into the application.
  async getCaregiverRelationships(householdId: string): Promise<unknown> {
    const { data, error } = await this.client
      .from('households')
      .select('caregiver_relationships')
      .eq('id', householdId)
      .maybeSingle();
    if (error) throw error;
    const stored = (data as { caregiver_relationships: string | null } | null)
      ?.caregiver_relationships ?? null;
    if (stored === null) return null;
    const dek = await getHouseholdDek(this.client, this.kek, householdId);
    return decryptCaregiverRelationships(stored, dek);
  }

  async setCaregiverRelationships(householdId: string, value: unknown): Promise<void> {
    const dek = await getOrCreateHouseholdDek(this.client, this.kek, householdId);
    const ciphertext = encryptField(value, dek);
    const { error } = await this.client
      .from('households')
      .update({ caregiver_relationships: ciphertext, updated_at: new Date().toISOString() })
      .eq('id', householdId);
    if (error) throw error;
  }

  // Story 2.14 — anxiety-leakage flag. Server-written only; the Plan Tile
  // component (Epic 3) reads this to decide whether to render a "saved just
  // now" pip after edits during the first 14 days.
  async getTileGhostFlag(householdId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('households')
      .select('tile_ghost_timestamp_enabled')
      .eq('id', householdId)
      .maybeSingle();
    if (error) throw error;
    return (data as { tile_ghost_timestamp_enabled: boolean } | null)
      ?.tile_ghost_timestamp_enabled ?? false;
  }

  async setTileGhostFlag(householdId: string): Promise<void> {
    const { data, error } = await this.client
      .from('households')
      .update({
        tile_ghost_timestamp_enabled: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', householdId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (data === null) {
      throw new Error(`household not found: ${householdId}`);
    }
  }

  // Returns household age in milliseconds (now - created_at). Used by the
  // tile-retry route to gate the ghost-timestamp escalation to week 1–2.
  // Throws if the household row is missing — no silent zero fallback that
  // could mis-classify an unknown household as fresh.
  async getHouseholdAge(householdId: string): Promise<number> {
    const { data, error } = await this.client
      .from('households')
      .select('created_at')
      .eq('id', householdId)
      .maybeSingle();
    if (error) throw error;
    const row = data as { created_at: string } | null;
    if (row === null) {
      throw new Error(`household not found: ${householdId}`);
    }
    return Date.now() - new Date(row.created_at).getTime();
  }
}

export function decryptCaregiverRelationships(
  stored: string,
  dek: Buffer | null,
): unknown {
  // Empty string: guard against a partial write leaving '' in the text column.
  if (stored.length === 0) return null;
  // Legacy jsonb-cast-to-text rows: objects and arrays always start with { or [.
  // Parse directly — re-encrypted on next write via setCaregiverRelationships.
  if (stored.startsWith('{') || stored.startsWith('[')) {
    return JSON.parse(stored);
  }
  // NOOP:-prefixed (dev/test) or AES-GCM base64 (staging/production).
  // decryptField handles both branches internally.
  return decryptField<unknown>(stored, dek);
}
